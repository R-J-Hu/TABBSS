#!/usr/bin/env python3
import argparse
import json
import re
import shutil
from pathlib import Path
from typing import Any, Dict, List, Optional


TOKENS = {"【无】", "", None}

# 同名不同后缀时优先级（高 → 低）
AUDIO_EXT_PRIORITY = (
    ".wav",
    ".mp3",
    ".wma",
    ".m4a",
    ".aac",
    ".ogg",
    ".opus",
    ".flac",
    ".mp4",
    ".aiff",
    ".aif",
)


def ext_rank(suffix: str) -> int:
    s = suffix.lower()
    try:
        return AUDIO_EXT_PRIORITY.index(s)
    except ValueError:
        return len(AUDIO_EXT_PRIORITY)


def read_ini(path: Path) -> dict[str, dict[str, str]]:
    raw = path.read_bytes()
    last_error = None
    for enc in ("utf-8", "utf-8-sig", "gb18030", "gbk"):
        try:
            text = raw.decode(enc)
            break
        except UnicodeDecodeError as err:
            last_error = err
    else:
        raise last_error

    data: dict[str, dict[str, str]] = {}
    current = ""
    for raw_line in text.splitlines():
        line = raw_line.strip()
        if not line or line.startswith(";") or line.startswith("#"):
            continue
        if line.startswith("[") and line.endswith("]") and len(line) >= 2:
            current = line[1:-1].strip()
            data.setdefault(current, {})
            continue
        if "=" in line and current:
            k, v = line.split("=", 1)
            data[current][k.strip()] = v.strip()
            continue
    return data


def split_stations(raw: str) -> list[str]:
    if not raw:
        return []
    parts = [p.strip() for p in raw.split("|")]
    return [p for p in parts if p]


def parse_special_map(raw: str) -> dict[str, str]:
    out: dict[str, str] = {}
    if not raw:
        return out
    for chunk in raw.split("|"):
        chunk = chunk.strip()
        if not chunk or "→" not in chunk:
            continue
        station, audio = chunk.split("→", 1)
        station = station.strip()
        audio = audio.strip()
        if station and audio:
            out[station] = audio
    return out


def sequence(section: dict[str, str], keys: list[str]) -> list[str]:
    return [section.get(k, "").strip() for k in keys if section.get(k, "").strip() not in TOKENS]


def collect_best_by_stem(route_root: Path) -> dict[str, Path]:
    """同一路线包目录下，按 stem 聚合，保留扩展名优先级最高的文件。"""
    best: dict[str, tuple[int, Path]] = {}
    for p in route_root.rglob("*"):
        if not p.is_file():
            continue
        suf = p.suffix.lower()
        if suf not in AUDIO_EXT_PRIORITY:
            continue
        rank = ext_rank(suf)
        stem = p.stem
        cur = best.get(stem)
        if cur is None or rank < cur[0]:
            best[stem] = (rank, p)
    return {k: v[1] for k, v in best.items()}


def build_station_audio_map(
    station_names: list[str],
    stem_to_path: dict[str, Path],
    route_root: Path,
    prefixes: list[str] | None = None,
) -> dict[str, str]:
    out: dict[str, str] = {}
    prefixes = prefixes or [""]
    for name in station_names:
        if not name:
            continue
        p = None
        for prefix in prefixes:
            p = stem_to_path.get(f"{prefix}{name}")
            if p is not None:
                break
        if p is None:
            continue
        try:
            rel = p.relative_to(route_root).as_posix()
        except ValueError:
            rel = p.name
        out[name] = rel
    return out


def default_first_departure() -> dict:
    return {"shared": [], "up": [], "down": []}


def extract_primary_route_number(line_name: str) -> Optional[int]:
    """从线路名提取主线路号：快1 / L3 / K1 等。"""
    if not line_name:
        return None
    m = re.search(r"快(\d+)", line_name)
    if m:
        return int(m.group(1))
    m = re.search(r"L(\d+)", line_name)
    if m:
        return int(m.group(1))
    m = re.search(r"K(\d+)", line_name)
    if m:
        return int(m.group(1))
    return None


def filename_conflicts_with_line(filename: str, primary: Optional[int]) -> bool:
    """
    文件名中出现 快N/KN/LN 且 N 与主线路不一致时，视为其它线路素材（如 K3 欢迎语不应匹配快1）。
    """
    if primary is None:
        return False
    for m in re.finditer(r"(?:快|K|L)(\d+)", filename):
        if int(m.group(1)) != primary:
            return True
    return False


def is_welcome_audio_candidate(p: Path) -> bool:
    n = p.name
    if "欢迎语" in n:
        return True
    if n.startswith("W-") and "欢迎" in n:
        return True
    return False


def extract_dest_after_wang(filename: str) -> Optional[str]:
    if "往" not in filename:
        return None
    i = filename.rfind("往")
    rest = filename[i + 1 :]
    rest = re.sub(
        r"\.(mp3|wav|wma|m4a|aac|ogg|opus|flac|mp4|aiff|aif)$",
        "",
        rest,
        flags=re.I,
    )
    return rest.strip() or None


def _strip_station_suffix(s: str) -> str:
    s = s.strip()
    if s.endswith("站") and len(s) > 1:
        return s[:-1]
    return s


def match_terminal(dest: str, terminal: str) -> bool:
    d = dest.strip()
    t = terminal.strip()
    if not d or not t:
        return False
    if d == t:
        return True
    if d in t or t in d:
        return True
    if _strip_station_suffix(d) == _strip_station_suffix(t):
        return True
    return False


def _rel_to_route(route_dir: Path, p: Path) -> str:
    try:
        return p.relative_to(route_dir).as_posix()
    except ValueError:
        return p.name


def infer_first_departure_forecast(
    route_dir: Path,
    line_name: str,
    up_stations: List[str],
    down_stations: List[str],
) -> dict:
    """
    推断首站预报前欢迎语：
    - 仅文件名含「欢迎语」或 W- 且含「欢迎」的音频；
    - 按线路名主线路号过滤（避免快3 欢迎语匹配到快1）；
    - 无「往」且通常仅一条时写入 shared，上下行共用；
    - 含「往终点站」时，与上行/下行列表的终点站（末站）匹配，写入 up/down。
    """
    primary = extract_primary_route_number(line_name)
    welcome_files: List[Path] = []
    for p in route_dir.rglob("*"):
        if not p.is_file():
            continue
        if p.suffix.lower() not in AUDIO_EXT_PRIORITY:
            continue
        if not is_welcome_audio_candidate(p):
            continue
        if filename_conflicts_with_line(p.name, primary):
            continue
        welcome_files.append(p)

    terminal_up = up_stations[-1] if up_stations else ""
    terminal_down = down_stations[-1] if down_stations else ""

    directional = [p for p in welcome_files if "往" in p.name]
    nondirectional = [p for p in welcome_files if "往" not in p.name]

    shared: List[str] = []
    up_list: List[str] = []
    down_list: List[str] = []

    for p in sorted(directional, key=lambda x: x.name.lower()):
        dest = extract_dest_after_wang(p.name)
        if not dest:
            continue
        rel = _rel_to_route(route_dir, p)
        if terminal_up and match_terminal(dest, terminal_up):
            up_list.append(rel)
        if terminal_down and match_terminal(dest, terminal_down):
            down_list.append(rel)

    for p in sorted(nondirectional, key=lambda x: x.name.lower()):
        shared.append(_rel_to_route(route_dir, p))

    return {"shared": shared, "up": up_list, "down": down_list}


def split_tip_audio_segments(raw: str) -> List[str]:
    if not raw:
        return []
    parts = re.split(r"[+|]", raw)
    out: List[str] = []
    for p in parts:
        p = p.strip()
        if not p:
            continue
        if re.search(r"\.(mp3|wav|wma|m4a|aac|ogg|opus|flac|mp4|aiff|aif)$", p, re.I):
            out.append(p)
    return out


def find_file_in_route(route_dir: Path, filename: str) -> Optional[Path]:
    if not filename:
        return None
    fn = filename.strip()
    for p in route_dir.rglob(fn):
        if p.is_file() and p.name == fn:
            return p
    low = fn.lower()
    for p in route_dir.rglob("*"):
        if p.is_file() and p.name.lower() == low:
            return p
    return None


def looks_like_welcome_segment(seg: str) -> bool:
    s = seg.lower()
    return "欢迎" in seg or "wel" in s


def merge_welcome_from_tips(
    fd: dict,
    tips_list: List[str],
    route_dir: Path,
    line_name: str,
    up_stations: List[str],
    down_stations: List[str],
) -> dict:
    """
    海峡 ini 常把欢迎语写在提示语3、4：若文件名含「欢迎」或 wel，则并入 first_departure_forecast。
    """
    primary = extract_primary_route_number(line_name)
    terminal_up = up_stations[-1] if up_stations else ""
    terminal_down = down_stations[-1] if down_stations else ""

    def add_unique(bucket: str, rel: str) -> None:
        lst = fd.setdefault(bucket, [])
        if rel not in lst:
            lst.append(rel)

    # 提示语3、4 → 索引 2、3
    for idx in (2, 3):
        if idx >= len(tips_list):
            continue
        raw = tips_list[idx]
        if not raw:
            continue
        for seg in split_tip_audio_segments(raw):
            if not looks_like_welcome_segment(seg):
                continue
            if filename_conflicts_with_line(seg, primary):
                continue
            p = find_file_in_route(route_dir, seg)
            if p is None:
                continue
            rel = _rel_to_route(route_dir, p)
            if "往" in seg:
                dest = extract_dest_after_wang(seg)
                if dest and terminal_up and match_terminal(dest, terminal_up):
                    add_unique("up", rel)
                elif dest and terminal_down and match_terminal(dest, terminal_down):
                    add_unique("down", rel)
            else:
                add_unique("shared", rel)
    return fd


def dedupe_first_departure(fd: dict) -> dict:
    for key in ("shared", "up", "down"):
        lst = fd.get(key) or []
        seen: set[str] = set()
        out: List[str] = []
        for x in lst:
            if x not in seen:
                seen.add(x)
                out.append(x)
        fd[key] = out
    return fd


def build_display_config(cfg: dict[str, dict[str, str]]) -> dict:
    wai = cfg.get("外显", {})
    return {
        "front_raw": (wai.get("前显") or "").strip(),
        "side_raw": (wai.get("侧显") or "").strip(),
        "rear_raw": (wai.get("后显") or "").strip(),
    }


def normalize_route(route_dir: Path, previous: Optional[Dict[str, Any]]) -> dict:
    ini_path = route_dir / "线路信息.ini"
    cfg = read_ini(ini_path)

    line = cfg.get("线路", {})
    up = cfg.get("上行", {})
    down = cfg.get("下行", {})
    tips = cfg.get("报站器提示语", {})
    arrive = cfg.get("报站器到站设置", {})
    depart = cfg.get("报站器出站设置", {})
    terminal = cfg.get("报站器终点设置", {})

    up_stations = split_stations(up.get("上行车站", ""))
    down_stations = split_stations(down.get("下行车站", ""))
    all_names: list[str] = []
    seen: set[str] = set()
    for n in up_stations + down_stations:
        if n and n not in seen:
            seen.add(n)
            all_names.append(n)

    stem_to_path = collect_best_by_stem(route_dir)
    station_audio_map = build_station_audio_map(all_names, stem_to_path, route_dir)
    station_audio_map_en = build_station_audio_map(all_names, stem_to_path, route_dir, prefixes=["E+", "En+", "E", "En"])

    tips_list = [tips.get(f"提示语{i}", "").strip() for i in range(1, 6)]

    route = {
        "id": route_dir.name,
        "name": line.get("线路名", route_dir.name),
        "company": line.get("所属公司", ""),
        "author": line.get("编写者", ""),
        "display": build_display_config(cfg),
        "directions": {
            "up": {
                "label": "上行",
                "stations": up_stations,
                "special_audio_map": parse_special_map(up.get("上行特殊服务语", "")),
            },
            "down": {
                "label": "下行",
                "stations": down_stations,
                "special_audio_map": parse_special_map(down.get("下行特殊服务语", "")),
            },
        },
        "templates": {
            "arrive": sequence(arrive, ["前奏", "到站报站1", "到站报站2", "到站报站3", "到站报站4"]),
            "depart": sequence(depart, ["前奏", "出站报站1", "出站报站2", "出站报站3", "出站报站4"]),
            # 终点站预报：与 depart 同源（海峡多数共用出站链）；若后续自有格式可单独拆段
            "terminal_depart": sequence(depart, ["前奏", "出站报站1", "出站报站2", "出站报站3", "出站报站4"]),
            "terminal_arrive": sequence(terminal, ["前奏", "终点报站1", "终点报站2", "终点报站3", "终点报站4", "终点报站5"]),
        },
        "tips": tips_list,
        "station_audio_map": station_audio_map,
        "station_audio_map_en": station_audio_map_en,
        "first_departure_forecast": default_first_departure(),
    }

    fd = infer_first_departure_forecast(
        route_dir,
        line.get("线路名", ""),
        up_stations,
        down_stations,
    )
    fd = merge_welcome_from_tips(fd, tips_list, route_dir, line.get("线路名", ""), up_stations, down_stations)
    dedupe_first_departure(fd)
    route["first_departure_forecast"] = fd

    fd = route["first_departure_forecast"]
    if (
        previous
        and not any(fd.get("shared") or [])
        and not any(fd.get("up") or [])
        and not any(fd.get("down") or [])
    ):
        prev_fd = previous.get("first_departure_forecast")
        if isinstance(prev_fd, dict):
            route["first_departure_forecast"] = {
                "shared": list(prev_fd.get("shared") or []),
                "up": list(prev_fd.get("up") or []),
                "down": list(prev_fd.get("down") or []),
            }
    return route


def build_route_entries(src: Path, dst: Path) -> list[dict]:
    route_dirs = sorted({ini_path.parent for ini_path in src.rglob("线路信息.ini")})
    routes = []
    for source_route in route_dirs:
        target = dst / source_route.name
        target.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source_route / "线路信息.ini", target / "线路信息.ini")

        audio_link = target / "audio"
        if audio_link.exists() or audio_link.is_symlink():
            audio_link.unlink()
        audio_link.symlink_to(source_route, target_is_directory=True)

        routes.append({"source": source_route, "target": target})
    return routes


def main() -> None:
    parser = argparse.ArgumentParser(description="Copy and convert old INI bus stop packs to JSON.")
    parser.add_argument("--source", required=True, help="source folder, e.g. /Users/.../报站音")
    parser.add_argument("--output", required=True, help="output root, e.g. /Users/.../报站模拟器V1/output")
    args = parser.parse_args()

    source = Path(args.source).expanduser().resolve()
    output = Path(args.output).expanduser().resolve()
    packages_dir = output / "packages"
    packages_dir.mkdir(parents=True, exist_ok=True)

    route_entries = build_route_entries(source, packages_dir)

    index = []
    for route_entry in route_entries:
        prev_path = route_entry["target"] / "converted.route.json"
        previous = None
        if prev_path.exists():
            try:
                previous = json.loads(prev_path.read_text(encoding="utf-8"))
            except (json.JSONDecodeError, OSError):
                previous = None

        route_json = normalize_route(route_entry["source"], previous)
        (route_entry["target"] / "converted.route.json").write_text(
            json.dumps(route_json, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        index.append(
            {
                "id": route_json["id"],
                "name": route_json["name"],
                "path": f"packages/{route_json['id']}/converted.route.json",
            }
        )

    (output / "index.json").write_text(json.dumps(index, ensure_ascii=False, indent=2), encoding="utf-8")

    missing_welcome: List[str] = []
    for route_entry in route_entries:
        p = route_entry["target"] / "converted.route.json"
        data = json.loads(p.read_text(encoding="utf-8"))
        fd0 = data.get("first_departure_forecast") or {}
        if not (fd0.get("shared") or fd0.get("up") or fd0.get("down")):
            missing_welcome.append(data.get("id", route_entry["target"].name))
    report_path = output / "routes_missing_welcome.txt"
    report_path.write_text(
        "以下线路在合并「文件名推断 + 提示语3/4」后仍无任何首站欢迎语条目（可手工补 first_departure_forecast）：\n"
        + ("\n".join(missing_welcome) if missing_welcome else "（无，已全部匹配或留空）\n"),
        encoding="utf-8",
    )
    print(f"Converted {len(index)} routes into: {output}")
    print(f"欢迎语未匹配列表: {report_path} （共 {len(missing_welcome)} 条）")


if __name__ == "__main__":
    main()
