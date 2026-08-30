#!/usr/bin/env python3
import argparse
import hashlib
import json
import re
import shutil
from datetime import datetime
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

    # Compatibility mode must reproduce the Haixia INI literally.  Older
    # builds scanned unrelated files named "欢迎语" and prepended them to the
    # first forecast even when the INI did not reference those files.  Keep the
    # legacy JSON field empty so old/static consumers remain schema-compatible,
    # but never infer or preserve hidden playback entries.
    return route


def _archive_safe_leaf(value: str, fallback: str = "海峡线路") -> str:
    value = re.sub(r'[\\/:*?"<>|]+', "-", str(value or "")).strip(" .")
    return value or fallback


def _archive_audio_files(route_dir: Path) -> list[Path]:
    return sorted(
        (p for p in route_dir.rglob("*") if p.is_file() and p.suffix.lower() in AUDIO_EXT_PRIORITY),
        key=lambda p: p.relative_to(route_dir).as_posix().casefold(),
    )


def _archive_audio_lookup(route_dir: Path, audio_files: list[Path]):
    by_rel: dict[str, Path] = {}
    by_name: dict[str, list[Path]] = {}
    for path in audio_files:
        rel = path.relative_to(route_dir).as_posix()
        by_rel[rel.casefold()] = path
        by_name.setdefault(path.name.casefold(), []).append(path)
    return by_rel, by_name


def _resolve_archive_audio_reference(
    raw: str,
    route_dir: Path,
    by_rel: dict[str, Path],
    by_name: dict[str, list[Path]],
) -> Optional[Path]:
    """Resolve one Haixia audio reference without guessing unrelated files."""
    value = str(raw or "").strip().strip('"').replace("\\", "/")
    if not value or value in TOKENS:
        return None
    direct = by_rel.get(value.casefold())
    if direct is not None:
        return direct
    matches = by_name.get(Path(value).name.casefold(), [])
    if len(matches) == 1:
        return matches[0]
    if Path(value).suffix.lower() not in AUDIO_EXT_PRIORITY:
        for ext in AUDIO_EXT_PRIORITY:
            candidate = value + ext
            direct = by_rel.get(candidate.casefold())
            if direct is not None:
                return direct
            matches = by_name.get(Path(candidate).name.casefold(), [])
            if len(matches) == 1:
                return matches[0]
    return None


def _resolve_archive_audio_sequence(
    raw: str,
    route_dir: Path,
    by_rel: dict[str, Path],
    by_name: dict[str, list[Path]],
) -> tuple[list[Path], list[str]]:
    """Resolve a Haixia field, preserving a real filename that itself contains '+'."""
    value = str(raw or "").strip()
    if not value or value in TOKENS:
        return [], []
    whole = _resolve_archive_audio_reference(value, route_dir, by_rel, by_name)
    if whole is not None:
        return [whole], []
    if "+" not in value and "|" not in value:
        return [], [value]
    resolved: list[Path] = []
    missing: list[str] = []
    for part in re.split(r"[+|]", value):
        part = part.strip()
        if not part:
            continue
        path = _resolve_archive_audio_reference(part, route_dir, by_rel, by_name)
        if path is None:
            missing.append(part)
        else:
            resolved.append(path)
    return resolved, missing


def build_archive_import(route_dir: Path, route_id: str = "") -> dict:
    """Build a V1.6 archive-mode INI and a collision-resistant flat audio payload.

    This function is intentionally side-effect free. The caller owns preview,
    confirmation, filesystem writes, index registration, and rollback.
    """
    route_dir = route_dir.resolve()
    cfg = read_ini(route_dir / "线路信息.ini")
    route = normalize_route(route_dir, None)
    up_stations = list(route.get("directions", {}).get("up", {}).get("stations", []) or [])
    down_stations = list(route.get("directions", {}).get("down", {}).get("stations", []) or [])
    if not up_stations and not down_stations:
        raise ValueError("该海峡线路没有可导入的上行或下行站点")

    raw_line_name = str(route.get("name") or route_dir.name).strip()
    line_name = _archive_safe_leaf(raw_line_name, route_dir.name)
    if line_name.lower().endswith(".ini"):
        line_name = line_name[:-4].rstrip(" .") or route_dir.name
    line_file_name = _archive_safe_leaf(line_name) + ".ini"

    audio_files = _archive_audio_files(route_dir)
    by_rel, by_name = _archive_audio_lookup(route_dir, audio_files)
    stable_key = (route_id or route_dir.name).replace("\\", "/")
    prefix = "HX" + hashlib.sha1(stable_key.encode("utf-8")).hexdigest()[:8] + "_"
    audio_names: dict[Path, str] = {}
    used_names: set[str] = set()
    for path in audio_files:
        original = path.name
        stem = path.stem
        suffix = path.suffix
        max_stem = max(16, 220 - len(prefix) - len(suffix))
        candidate = prefix + stem[:max_stem] + suffix
        folded = candidate.casefold()
        if folded in used_names:
            rel_hash = hashlib.sha1(path.relative_to(route_dir).as_posix().encode("utf-8")).hexdigest()[:8]
            max_stem = max(16, 211 - len(prefix) - len(suffix))
            candidate = prefix + stem[:max_stem] + "_" + rel_hash + suffix
            folded = candidate.casefold()
        used_names.add(folded)
        audio_names[path.resolve()] = candidate

    warnings: list[str] = []

    def add_warning(raw: str) -> None:
        msg = "找不到音频：" + str(raw)
        if msg not in warnings:
            warnings.append(msg)

    def audio_tokens(raw: str) -> list[str]:
        paths, missing = _resolve_archive_audio_sequence(raw, route_dir, by_rel, by_name)
        for item in missing:
            add_warning(item)
        return ['"' + audio_names[p.resolve()].replace('"', "") + '"' for p in paths]

    parameter_map = {
        "【本站】": "{本站中文}",
        "【下站】": "{下站中文}",
        "【英文本站】": "{本站英文}",
        "【本站英文】": "{本站英文}",
        "【英文下站】": "{下站英文}",
        "【下站英文】": "{下站英文}",
        "【起点】": "{起始站中文}",
        "【终点】": "{终点站中文}",
    }

    def render_rule(parts: list[str], special_audio: str = "") -> str:
        tokens: list[str] = []
        for part in parts or []:
            value = str(part or "").strip()
            if not value or value in TOKENS:
                continue
            if value in parameter_map:
                tokens.append(parameter_map[value])
            elif value == "【特殊语句】":
                tokens.extend(audio_tokens(special_audio))
            else:
                tokens.extend(audio_tokens(value))
        return ">".join(tokens)

    up_cfg = cfg.get("上行", {})
    down_cfg = cfg.get("下行", {})
    up_en = split_stations(up_cfg.get("上行车站英文", ""))
    down_en = split_stations(down_cfg.get("下行车站英文", ""))
    up_en += [""] * max(0, len(up_stations) - len(up_en))
    down_en += [""] * max(0, len(down_stations) - len(down_en))

    templates = route.get("templates", {})
    arrive_parts = list(templates.get("arrive", []) or [])
    depart_parts = list(templates.get("depart", []) or [])
    terminal_depart_parts = list(templates.get("terminal_depart", []) or depart_parts)
    terminal_arrive_parts = list(templates.get("terminal_arrive", []) or arrive_parts)
    arrive_rule = render_rule(arrive_parts)
    depart_rule = render_rule(depart_parts)
    terminal_depart_rule = render_rule(terminal_depart_parts)
    terminal_arrive_rule = render_rule(terminal_arrive_parts)

    station_audio_map = route.get("station_audio_map", {}) or {}
    station_audio_map_en = route.get("station_audio_map_en", {}) or {}

    def mapped_audio(raw: str, fallback: str) -> str:
        if not raw:
            return fallback
        path = _resolve_archive_audio_reference(raw, route_dir, by_rel, by_name)
        if path is None:
            add_warning(raw)
            return fallback
        return '"' + audio_names[path.resolve()].replace('"', "") + '"'

    now = datetime.now().strftime("%Y/%m/%d %H:%M:%S")
    lines: list[str] = []
    add = lines.append
    add("#线路信息")
    add("")
    add(f"线路名称={line_name}")
    add("版本=V1.51")
    add(f"作者={route.get('author', '')}")
    add(f"创建时间={now}")
    add(f"更新时间={now}")
    add("更新日志=由海峡兼容模式导入")
    add("")
    add("")
    add("#车站信息")
    add(f"环线模式={'true' if up_stations and not down_stations else 'false'}")

    def add_station_list(title: str, values: list[str]) -> None:
        add("")
        add(title + "：")
        add("")
        for index, value in enumerate(values, 1):
            add(f"stop_{index}:{value}")
        add("")

    add_station_list("上行中文站名", up_stations)
    add_station_list("上行英文站名", up_en[:len(up_stations)])
    add_station_list("下行中文站名", down_stations)
    add_station_list("下行英文站名", down_en[:len(down_stations)])
    add("")
    add("#显示屏格式")
    add("")
    add("（此段本版本暂时放空，后续补充）")
    add("")
    add("")
    add("#报站规则")
    add("##全局默认模版类")
    add("上下行相同=true")
    add(f"上行首站预报规则={depart_rule}")
    add(f"下行首站预报规则={depart_rule}")
    add(f"默认上行到站播报规则={arrive_rule}")
    add(f"默认上行预报规则={depart_rule}")
    add(f"默认下行预报规则={depart_rule}")
    add(f"默认下行到站播报规则={arrive_rule}")
    add(f"上行终点站预报规则={terminal_depart_rule}")
    add(f"上行终点站报站规则={terminal_arrive_rule}")
    add(f"下行终点站预报规则={terminal_depart_rule}")
    add(f"下行终点站报站规则={terminal_arrive_rule}")
    add("")
    add("")
    add("##各站规则类")

    def add_station_rules(direction: str, stations: list[str]) -> None:
        special_map = route.get("directions", {}).get(direction, {}).get("special_audio_map", {}) or {}
        add("###上行站点" if direction == "up" else "###下行站点")
        for index, station in enumerate(stations, 1):
            special = special_map.get(station, "")
            is_terminal = index == len(stations)
            forecast_parts = terminal_depart_parts if is_terminal else depart_parts
            arrival_parts = terminal_arrive_parts if is_terminal else arrive_parts
            forecast = render_rule(forecast_parts, special) if special and "【特殊语句】" in forecast_parts else "{默认模版}"
            arrival = render_rule(arrival_parts, special) if special and "【特殊语句】" in arrival_parts else "{默认模版}"
            add(f"####Stop{index}：")
            add(f"预报规则={forecast}")
            add(f"到站规则={arrival}")
            add("本站中文语音文件=" + mapped_audio(station_audio_map.get(station, ""), "{本站中文同名文件}"))
            add("本站英文语音文件=" + mapped_audio(station_audio_map_en.get(station, ""), "{本站英文同名文件}"))
            add("")

    add_station_rules("up", up_stations)
    add_station_rules("down", down_stations)
    add("##手按提示语类")
    tips = list(route.get("tips", []) or [])
    for index in range(10):
        raw = tips[index] if index < len(tips) else ""
        add(f"###提示语{index + 1}:")
        add(f"显示名称=提示语{index + 1}")
        add("语音文件=" + ">".join(audio_tokens(raw)))
        add("")

    return {
        "line_name": line_name,
        "line_file_name": line_file_name,
        "ini_text": "\n".join(lines).rstrip() + "\n",
        "media": [(audio_names[p.resolve()], p) for p in audio_files],
        "warnings": warnings,
        "source_company": str(route.get("company") or "").strip(),
    }


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

    print(f"Converted {len(index)} routes into: {output}")


if __name__ == "__main__":
    main()
