#!/usr/bin/env python3
"""
TABBSS Self-Updater
====================
Checks Gitee Releases for new versions (keyed by edition + OS) and downloads
+ launches the installer for the matching platform.

Also provides line-data merge (union by company→line) applied on upgrade.

Usage:
    python scripts/updater.py --check                     # check for updates only
    python scripts/updater.py --update --url=<URL> --name=<file>  # download + launch installer
    python scripts/updater.py --merge [--app-dir=... --data-root=...]  # merge staged lines
"""

import argparse
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.request
from pathlib import Path

# ── Configuration ──────────────────────────────────────────────
GITEE_REPO = "rjhu/TABBSS"
GITEE_API = f"https://gitee.com/api/v5/repos/{GITEE_REPO}"

ROOT = Path(__file__).resolve().parent.parent
VERSION_FILE = ROOT / "VERSION"

def parse_version(v: str) -> tuple:
    """Parse version string into comparable tuple.

    '1.6.0-build199' → (1, 6, 0, 199)
    '1.6.0' → (1, 6, 0)
    """
    v = v.strip().lstrip("vV")
    base, sep, build = v.partition("-build")
    parts = [int(x) for x in base.split(".") if x.isdigit()]
    if build and build.isdigit():
        parts.append(int(build))
    return tuple(parts)


def get_os_key() -> str:
    """Return the OS token used in release asset names ('windows' / 'macos')."""
    return "macos" if sys.platform == "darwin" else "windows"


def get_edition(root: Path | None = None) -> str:
    """Read edition (release/dev/audit) from web/funct.json."""
    root = root or ROOT
    funct_path = root / "web" / "funct.json"
    try:
        data = json.loads(funct_path.read_text(encoding="utf-8"))
        return data.get("edition", "release")
    except Exception:
        return "release"


def read_version_build(root: Path | None = None) -> tuple:
    """Return (version, build) — version from VERSION, build from web/index.html."""
    root = root or ROOT
    ver_file = root / "VERSION"
    ver_text = ver_file.read_text(encoding="utf-8").strip() if ver_file.exists() else "1.6.0"
    html_path = root / "web" / "index.html"
    build = "0"
    if html_path.exists():
        m = re.search(r'Build (\d+)', html_path.read_text(encoding="utf-8"))
        if m:
            build = m.group(1)
    version = re.sub(r'-build\d+$', '', ver_text)
    return version, build


def local_identity(root: Path | None = None) -> tuple:
    """Return (version_tuple, version, build)."""
    version, build = read_version_build(root)
    return parse_version(f"{version}-build{build}"), version, build


def _http_get_json(url: str, timeout: int = 15):
    req = urllib.request.Request(url)
    req.add_header("User-Agent", "TABBSS-Updater/1.0")
    req.add_header("Accept", "application/json")
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))


def _http_get_text(url: str, timeout: int = 20) -> str:
    req = urllib.request.Request(url)
    req.add_header("User-Agent", "TABBSS-Updater/1.0")
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.read().decode("utf-8", errors="replace")


def _http_get_json_retry(url: str, timeout: int = 15, tries: int = 2):
    """GET JSON with a couple of retries for transient socket errors (WinError 10013)."""
    import time as _t
    last = None
    for attempt in range(tries):
        try:
            return _http_get_json(url, timeout=timeout)
        except Exception as e:
            last = e
            if attempt < tries - 1:
                _t.sleep(0.4)
    raise last


def fetch_gitee_releases():
    """Return the list of Gitee releases (newest first)."""
    return _http_get_json_retry(GITEE_API + "/releases")


def fetch_gitee_attach_files(release_id):
    """Return the list of attached files for a Gitee release."""
    return _http_get_json(f"{GITEE_API}/releases/{release_id}/attach_files")


def fetch_github_releases():
    """Return the latest GitHub release normalized to Gitee shape (single-item list).

    Uses /releases/latest — the GitHub /releases list endpoint can return empty
    even when the latest release is reachable.
    """
    url = "https://api.github.com/repos/R-J-Hu/TABBSS/releases/latest"
    r = _http_get_json_retry(url, tries=2)
    return [{
        "tag_name": r.get("tag_name", ""),
        "id": r.get("id"),
        "name": r.get("name", r.get("tag_name", "")),
        "assets": [
            {"name": a.get("name", ""), "browser_download_url": a.get("browser_download_url", "")}
            for a in r.get("assets", [])
        ],
    }]


def fetch_releases_with_fallback():
    """Fetch the release LIST (Gitee preferred, GitHub fallback) WITHOUT per-release
    asset calls. Assets are fetched lazily for only the newest matching release.

    Fetching attach_files for every release used to cost 1 + N anonymous API calls,
    which quickly exhausted Gitee's per-IP anonymous rate limit (403 Rate Limit
    Exceeded, blocked by Gitee's Baidu WAF).
    """
    try:
        releases = fetch_gitee_releases()
        if not releases:
            raise ValueError("empty gitee releases")
        return releases, "gitee"
    except Exception:
        return fetch_github_releases(), "github"


def fetch_release_assets(release, source):
    """Return the assets of a single release.

    GitHub releases already carry inline `assets`; Gitee needs one attach_files call.
    """
    if source == "github":
        return release.get("assets") or []
    try:
        return fetch_gitee_attach_files(release.get("id"))
    except Exception:
        return release.get("assets") or []


def attach_download_url(asset: dict) -> str:
    """Return a direct download URL for an attached file (Gitee or GitHub)."""
    return asset.get("browser_download_url") or asset.get("download_url") or ""


def _build_from_tag(tag: str) -> str:
    m = re.search(r'build(\d+)$', tag or "")
    return m.group(1) if m else "0"


def parse_changelog_diff(text: str, from_build: str, to_build: str):
    """Parse changelog.md and return entries for builds in (from_build, to_build].

    Returns list of {build: int, items: [str, ...]}.
    """
    if not text:
        return []
    try:
        lo = int(from_build or "0")
        hi = int(to_build or "0")
    except (TypeError, ValueError):
        return []

    entries = []
    cur = None
    for line in text.splitlines():
        m = re.match(r'^##\s+Build\s+(\d+)', line)
        if m:
            b = int(m.group(1))
            if cur is not None:
                entries.append(cur)
            cur = {"build": b, "items": []} if lo < b <= hi else None
        elif cur is not None:
            s = line.strip()
            if s:
                cur["items"].append(s)
    if cur is not None:
        entries.append(cur)
    return entries


# Gitee anonymous API is rate-limited; cache successful checks for 10 minutes.
# Keyed by (edition, os_key, force, local_build) so a version bump re-checks.
# Failed/rate-limited checks are also cached briefly so repeated startups do not
# hammer the API (each 403 restart used to re-trigger a full check).
_GITEE_CACHE: dict = {}
_GITEE_TTL = 600   # seconds — successful check
_FAIL_TTL = 120    # seconds — failed / rate-limited check


def check_gitee_update(root: Path | None = None, force: bool = False) -> dict:
    """Check Gitee for an update matching the current edition + OS.

    When force=True (simulated upgrade), always pick the newest release even if
    it is not newer than the local version; the changelog then shows only that
    release's entries when the version is not higher than local.

    Returns dict with update_available, local_version/build, latest_version/build,
    changelog (list of {build, items}), download_url, installer_name — or error.
    """
    root = root or ROOT
    local_tuple, local_version, local_build = local_identity(root)
    edition = get_edition(root)
    os_key = get_os_key()

    _cache_key = (edition, os_key, force, local_build)
    _now = __import__("time").time()
    _cached = _GITEE_CACHE.get(_cache_key)
    if _cached and _cached[0] > _now:
        return _cached[1]

    result = {
        "update_available": False,
        "local_version": local_version,
        "local_build": local_build,
        "latest_version": None,
        "latest_build": None,
        "release_name": "",
        "changelog": [],
        "download_url": "",
        "installer_name": "",
    }

    try:
        releases, source = fetch_releases_with_fallback()
        if not releases:
            return result
        result["source"] = source

        # Pick the newest release; in normal mode skip releases <= local.
        best = None
        for rel in releases:
            if not isinstance(rel, dict):
                continue
            tag = rel.get("tag_name", "")
            tup = parse_version(tag)
            if not force and tup <= local_tuple:
                continue
            if best is None or tup > best[0]:
                best = (tup, rel)
        if best is None:
            return result

        latest_tuple, release = best
        result["update_available"] = latest_tuple > local_tuple
        result["latest_version"] = re.sub(r'-build\d+$', '', release.get("tag_name", ""))
        result["latest_build"] = _build_from_tag(release.get("tag_name", ""))
        result["release_name"] = release.get("name", release.get("tag_name", ""))

        # Fetch assets ONLY for the best release (Gitee: 1 attach_files call;
        # GitHub: inline assets). Keeps each check at ~2 anonymous API calls.
        attach_files = fetch_release_assets(release, source)

        # Match installer by edition + OS prefix; locate changelog.md.
        # In forced (simulated) mode, prefer the release-channel installer so a
        # dev/audit build can exercise the real user upgrade path.
        prefixes = [f"TABBSS_release_{os_key}_"] if force else [f"TABBSS_{edition}_{os_key}_"]
        if force:
            prefixes.append(f"TABBSS_{edition}_{os_key}_")
        installer = None
        changelog_asset = None
        for a in attach_files:
            if not isinstance(a, dict):
                continue
            name = a.get("name", "")
            if installer is None and any(name.startswith(p) for p in prefixes):
                installer = a
            elif name == "changelog.md":
                changelog_asset = a

        if installer is not None:
            result["installer_name"] = installer.get("name", "")
            result["download_url"] = attach_download_url(installer)

        if changelog_asset is not None:
            url = attach_download_url(changelog_asset)
            if url:
                try:
                    # Normal: diff from local build to latest.
                    # Forced and latest not higher than local: show only that version.
                    if force and not result["update_available"]:
                        try:
                            from_build = str(max(0, int(result["latest_build"]) - 1))
                        except (TypeError, ValueError):
                            from_build = local_build
                    else:
                        from_build = local_build
                    result["changelog"] = parse_changelog_diff(
                        _http_get_text(url), from_build, result["latest_build"])
                except Exception:
                    pass

        # Cache successful checks; also briefly cache failures so a rate-limited /
        # offline check does not hammer the API again on every startup.
        if result.get("latest_build"):
            _GITEE_CACHE[_cache_key] = (_now + _GITEE_TTL, result)
        elif result.get("error"):
            _GITEE_CACHE[_cache_key] = (_now + _FAIL_TTL, result)
        return result
    except Exception as e:
        result["update_available"] = False
        result["error"] = str(e)
        _GITEE_CACHE[_cache_key] = (_now + _FAIL_TTL, result)
        return result


# Download progress, shared with the frontend via /api/update_progress.
_DL_STATE = {
    "active": False, "url": "", "dest": "",
    "total": 0, "downloaded": 0,
    "start": 0.0, "done": False, "ok": False, "error": "",
}


def reset_download_state():
    _DL_STATE.update(active=False, url="", dest="", total=0, downloaded=0,
                     start=0.0, done=False, ok=False, error="")


def get_download_state() -> dict:
    return dict(_DL_STATE)


def download_file(url: str, dest: Path) -> bool:
    """Download a file, updating the shared progress state."""
    import time as _t
    print(f"Downloading {url} ...")
    reset_download_state()
    _DL_STATE.update(active=True, url=url, dest=str(dest), start=_t.time())
    try:
        req = urllib.request.Request(url)
        req.add_header("User-Agent", "TABBSS-Updater/1.0")
        # 120s overall timeout: a slow-but-working CDN usually finishes; a truly
        # stuck connection errors out and the UI can offer "重试" instead of
        # sitting at 0% indefinitely.
        with urllib.request.urlopen(req, timeout=120) as resp:
            total = int(resp.headers.get("Content-Length", 0))
            _DL_STATE["total"] = total
            downloaded = 0
            with open(dest, "wb") as f:
                while True:
                    chunk = resp.read(8192)
                    if not chunk:
                        break
                    f.write(chunk)
                    downloaded += len(chunk)
                    _DL_STATE["downloaded"] = downloaded
                    if total:
                        pct = downloaded * 100 // total
                        print(f"\r  {downloaded / 1024 / 1024:.1f} / "
                              f"{total / 1024 / 1024:.1f} MB ({pct}%)", end="")
            print()
        _DL_STATE.update(active=False, done=True, ok=True)
        return True
    except Exception as e:
        print(f"\n✗ Download failed: {e}")
        _DL_STATE.update(active=False, done=True, ok=False, error=str(e))
        return False


def launch_installer(path: Path, detached: bool = False) -> bool:
    """Launch a downloaded installer for the current platform.

    Windows: os.startfile (ShellExecute) triggers UAC for the
    requireAdministrator NSIS installer. Verified working in the full app.
    macOS: `open` mounts/exposes a .dmg for manual install.
    Linux: xdg-open for generic launchers.
    """
    try:
        if sys.platform == "win32":
            os.startfile(str(path))
        elif sys.platform == "darwin":
            subprocess.Popen(["open", str(path)])
        elif sys.platform.startswith("linux"):
            subprocess.Popen(["xdg-open", str(path)])
        else:
            return False
        return True
    except Exception as e:
        print(f"✗ Failed to launch installer: {e}")
        return False


def _read_data_index(index_path: Path) -> tuple[dict, bool]:
    """Read an index and report whether it was structurally usable."""
    if not index_path.exists():
        return {"version": "V1.6.1", "companies": []}, False
    try:
        loaded = json.loads(index_path.read_text(encoding="utf-8-sig"))
        if not isinstance(loaded, dict) or not isinstance(loaded.get("companies", []), list):
            raise ValueError("invalid index structure")
        loaded.setdefault("version", "V1.6.1")
        loaded.setdefault("companies", [])
        return loaded, True
    except Exception:
        return {"version": "V1.6.1", "companies": []}, False


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _atomic_copy(source: Path, target: Path):
    target.parent.mkdir(parents=True, exist_ok=True)
    tmp = target.with_name(target.name + ".installing")
    shutil.copy2(source, tmp)
    os.replace(tmp, target)


def _copy_missing_tree(source: Path, target: Path) -> list[str]:
    """Union-copy every payload file except index.json; never replace user files."""
    copied = []
    if not source.exists():
        return copied
    for src in sorted(source.rglob("*"), key=lambda p: str(p).lower()):
        if not src.is_file() or src.relative_to(source).as_posix() == "index.json":
            continue
        rel = src.relative_to(source)
        dst = target / rel
        if dst.exists():
            continue
        _atomic_copy(src, dst)
        copied.append(rel.as_posix())
    return copied


def _migrate_legacy_output_to_compat(app_dir: Path) -> list[str]:
    """Recover original Haixia route files from legacy output packages.

    Build 204-264 treated ``output`` as a converted runtime index. Some old or
    abnormal installations therefore retained a usable 线路信息.ini (and
    occasionally an ``audio`` copy/link) only below output/packages. Build 265
    makes the original compatibility library authoritative, so upgrades
    union-copy recoverable source files there without modifying or deleting
    the legacy output tree.
    """
    output_root = app_dir / "output"
    compat_root = app_dir / "兼容模式-海峡报站器文件库"
    if not output_root.is_dir():
        return []

    copied = []
    for ini_path in sorted(output_root.rglob("线路信息.ini"), key=lambda p: str(p).lower()):
        rel_ini = ini_path.relative_to(output_root)
        if any(part.lower() == "audio" for part in rel_ini.parts[:-1]):
            continue
        route_parts = rel_ini.parts[:-1]
        if route_parts and route_parts[0].lower() == "packages":
            route_parts = route_parts[1:]
        if not route_parts or any(part in ("", ".", "..") for part in route_parts):
            continue

        package_dir = ini_path.parent
        target_dir = compat_root.joinpath(*route_parts)

        def copy_missing(src: Path, rel: Path):
            dst = target_dir / rel
            if dst.exists():
                return
            _atomic_copy(src, dst)
            copied.append((Path("兼容模式-海峡报站器文件库") / Path(*route_parts) / rel).as_posix())

        copy_missing(ini_path, Path("线路信息.ini"))

        # Preserve any non-generated original files stored directly beside the
        # converted JSON. The legacy "audio" directory is handled separately
        # because its contents belong at the route root, not under audio/.
        for src in sorted(package_dir.rglob("*"), key=lambda p: str(p).lower()):
            if not src.is_file():
                continue
            rel = src.relative_to(package_dir)
            if rel.parts and rel.parts[0].lower() == "audio":
                continue
            if rel.as_posix() in ("线路信息.ini", "converted.route.json"):
                continue
            copy_missing(src, rel)

        audio_dir = package_dir / "audio"
        try:
            audio_source = audio_dir.resolve()
            same_as_target = audio_source == target_dir.resolve()
        except OSError:
            audio_source = audio_dir
            same_as_target = False
        if audio_source.is_dir() and not same_as_target:
            for src in sorted(audio_source.rglob("*"), key=lambda p: str(p).lower()):
                if src.is_file():
                    copy_missing(src, src.relative_to(audio_source))
    return copied


def _read_release_manifest(data_root: Path) -> dict[str, str]:
    manifest_path = data_root / ".release_manifest.json"
    try:
        loaded = json.loads(manifest_path.read_text(encoding="utf-8-sig"))
        files = loaded.get("files", {})
        if isinstance(files, dict):
            return {str(k): str(v) for k, v in files.items()}
    except Exception:
        pass
    return {}


def _merge_release_tree(source: Path, target: Path, old_manifest: dict[str, str]):
    """Install release files while preserving anything the user changed.

    A file is overwritten only when its current hash matches the hash recorded
    at the previous successful release install. This lets later releases fix
    bundled data without reviving Build 262's blanket overwrite risk.
    """
    copied = []
    updated = []
    managed = {}
    considered = set()
    if not source.exists():
        return copied, updated, managed, considered
    for src in sorted(source.rglob("*"), key=lambda p: str(p).lower()):
        if not src.is_file() or src.relative_to(source).as_posix() == "index.json":
            continue
        rel = src.relative_to(source)
        rel_posix = rel.as_posix()
        considered.add(rel_posix)
        dst = target / rel
        src_hash = _sha256_file(src)
        if not dst.exists():
            _atomic_copy(src, dst)
            copied.append(rel_posix)
            managed[rel_posix] = src_hash
            continue
        dst_hash = _sha256_file(dst)
        if dst_hash == src_hash:
            managed[rel_posix] = src_hash
        elif old_manifest.get(rel_posix) == dst_hash:
            _atomic_copy(src, dst)
            updated.append(rel_posix)
            managed[rel_posix] = src_hash
        # Otherwise the file predates manifests or was edited by the user. It
        # remains untouched and is deliberately not managed by future updates.
    return copied, updated, managed, considered


def _write_release_manifest(data_root: Path, files: dict[str, str]):
    manifest_path = data_root / ".release_manifest.json"
    rendered = json.dumps({"version": 1, "files": files}, ensure_ascii=False, indent=2) + "\n"
    tmp = manifest_path.with_name(manifest_path.name + ".installing")
    tmp.write_text(rendered, encoding="utf-8")
    os.replace(tmp, manifest_path)


def _merge_index_records(base: dict, additions: list[dict], data_root: Path) -> tuple[dict, list[str]]:
    """Merge index metadata and register every real top-level company INI.

    Existing company/line records win. The final disk scan is deliberate: it
    recovers custom routes that survived on disk after an older installer
    replaced or corrupted index.json.
    """
    result = dict(base)
    companies = []
    company_map = {}
    recovered = []

    def ensure_company(name: str, template: dict | None = None) -> dict | None:
        name = str(name or "").strip()
        if not name:
            return None
        if name in company_map:
            return company_map[name]
        company = dict(template or {})
        company["name"] = name
        company["lines"] = []
        companies.append(company)
        company_map[name] = company
        return company

    line_keys = set()
    for source_index in [base, *additions]:
        for company_src in source_index.get("companies", []):
            if not isinstance(company_src, dict):
                continue
            company = ensure_company(company_src.get("name", ""), company_src)
            if company is None:
                continue
            for line_src in company_src.get("lines", []):
                if not isinstance(line_src, dict):
                    continue
                file_rel = str(line_src.get("file", "")).replace("\\", "/").lstrip("/")
                if not file_rel or file_rel in line_keys:
                    continue
                line = dict(line_src)
                line["file"] = file_rel
                line.setdefault("name", Path(file_rel).stem)
                company["lines"].append(line)
                line_keys.add(file_rel)

    if data_root.exists():
        for company_dir in sorted(data_root.iterdir(), key=lambda p: p.name.lower()):
            if not company_dir.is_dir() or company_dir.name.startswith("."):
                continue
            company = None
            for ini_path in sorted(company_dir.glob("*.ini"), key=lambda p: p.name.lower()):
                file_rel = f"{company_dir.name}/{ini_path.name}"
                if file_rel in line_keys:
                    continue
                company = company or ensure_company(company_dir.name)
                company["lines"].append({"name": ini_path.stem, "file": file_rel})
                line_keys.add(file_rel)
                recovered.append(file_rel)

    result["companies"] = companies
    return result, recovered


def _write_index_atomic(index_path: Path, index_obj: dict) -> str | None:
    """Back up the previous index and atomically publish the merged index."""
    index_path.parent.mkdir(parents=True, exist_ok=True)
    rendered = json.dumps(index_obj, ensure_ascii=False, indent=4) + "\n"
    if index_path.exists():
        try:
            if index_path.read_text(encoding="utf-8-sig") == rendered:
                return None
        except Exception:
            pass
        stamp = time.strftime("%Y%m%d-%H%M%S")
        backup = index_path.with_name(f"index.json.pre-install-{stamp}.bak")
        counter = 1
        while backup.exists():
            backup = index_path.with_name(f"index.json.pre-install-{stamp}-{counter}.bak")
            counter += 1
        shutil.copy2(index_path, backup)
        backup_name = backup.name
    else:
        backup_name = None
    tmp = index_path.with_name(index_path.name + ".installing")
    tmp.write_text(rendered, encoding="utf-8")
    os.replace(tmp, index_path)
    return backup_name


def _remove_staging_after_success(staging_root: Path) -> bool:
    for _attempt in range(5):
        try:
            shutil.rmtree(staging_root)
            return True
        except FileNotFoundError:
            return True
        except OSError:
            time.sleep(0.5)
    return not staging_root.exists()


def merge_update_lines(app_dir: Path, data_root: Path) -> dict:
    """Safely merge legacy and current installer payloads into user data.

    The operation is union-only for user files, semantically merges index.json,
    recovers on-disk INIs omitted by a damaged index, and removes staging only
    after all copied files and index entries have been verified.
    """
    app_dir = Path(app_dir)
    data_root = Path(data_root)
    staging_roots = [p for p in (app_dir / ".update_package", app_dir / ".install_payload") if p.exists()]
    if not staging_roots:
        return {"merged": [], "copied_files": [], "recovered_lines": [], "removed_staging": True}

    index_path = data_root / "index.json"
    existing_index, existing_valid = _read_data_index(index_path)
    staging_indexes = []
    copied_files = []
    updated_files = []
    old_manifest = _read_release_manifest(data_root)
    next_manifest = dict(old_manifest)
    saw_release_payload = False

    for staging_root in staging_roots:
        staging_data = staging_root / "报站线路文件库"
        if staging_data.exists():
            staging_index, _ = _read_data_index(staging_data / "index.json")
            staging_indexes.append(staging_index)
            if staging_root.name == ".install_payload":
                saw_release_payload = True
                copied, updated, managed, considered = _merge_release_tree(staging_data, data_root, old_manifest)
                copied_files.extend(copied)
                updated_files.extend(updated)
                for rel in considered:
                    next_manifest.pop(rel, None)
                next_manifest.update(managed)
            else:
                copied_files.extend(_copy_missing_tree(staging_data, data_root))

        # Other mutable data directories also use union semantics. They have no
        # archive index and must never overwrite files created by the user.
        for dirname in ("兼容模式-海峡报站器文件库", "output"):
            copied = _copy_missing_tree(staging_root / dirname, app_dir / dirname)
            copied_files.extend(f"{dirname}/{name}" for name in copied)

    # Upgrades keep output intact for rollback/legacy compatibility, but move
    # any recoverable original Haixia source into the now-authoritative folder.
    migrated_compat_files = _migrate_legacy_output_to_compat(app_dir)

    merged_index, recovered_lines = _merge_index_records(existing_index, staging_indexes, data_root)
    backup_name = _write_index_atomic(index_path, merged_index)

    # Verification is intentionally done before cleanup. Any exception leaves
    # both the original user files and installer payload available for retry.
    verified_index, verified_valid = _read_data_index(index_path)
    if not verified_valid:
        raise RuntimeError("merged index.json could not be read back")
    indexed = {
        str(line.get("file", "")).replace("\\", "/")
        for company in verified_index.get("companies", [])
        for line in company.get("lines", [])
    }
    disk_inis = {
        f"{company_dir.name}/{ini.name}"
        for company_dir in data_root.iterdir()
        if company_dir.is_dir() and not company_dir.name.startswith(".")
        for ini in company_dir.glob("*.ini")
    }
    if not disk_inis.issubset(indexed):
        raise RuntimeError("merged index.json omitted on-disk route files")
    for staging_root in staging_roots:
        for src in staging_root.rglob("*"):
            if not src.is_file() or src.name == "index.json":
                continue
            rel = src.relative_to(staging_root)
            if rel.parts and rel.parts[0] == "报站线路文件库":
                dst = data_root.joinpath(*rel.parts[1:])
            else:
                dst = app_dir / rel
            if not dst.exists():
                raise RuntimeError(f"installer payload file was not preserved: {rel.as_posix()}")

    if saw_release_payload:
        _write_release_manifest(data_root, next_manifest)

    cleanup_ok = all(_remove_staging_after_success(root) for root in staging_roots)
    if not cleanup_ok:
        print("WARN: installer staging is locked; it will be retried on next launch")
    merged = [
        str(line.get("file", ""))
        for addition in staging_indexes
        for company in addition.get("companies", [])
        for line in company.get("lines", [])
    ]
    return {
        "merged": merged,
        "copied_files": copied_files,
        "updated_files": updated_files,
        "migrated_compat_files": migrated_compat_files,
        "recovered_lines": recovered_lines,
        "existing_index_valid": existing_valid,
        "index_backup": backup_name,
        "removed_staging": cleanup_ok,
    }


def main():
    parser = argparse.ArgumentParser(description="TABBSS Self-Updater")
    parser.add_argument("--check", action="store_true", help="Check for updates (Gitee, edition+OS)")
    parser.add_argument("--update", action="store_true", help="Download installer from --url and launch it")
    parser.add_argument("--url", help="Installer download URL (for --update)")
    parser.add_argument("--name", default="TABBSS-Setup.exe", help="Installer filename (for --update)")
    parser.add_argument("--merge", action="store_true", help="Merge .update_package staging into data dir")
    parser.add_argument("--app-dir", default=None, help="App install dir (default: ROOT)")
    parser.add_argument("--data-root", default=None, help="Data root dir (default: app-dir/报站线路文件库)")
    args = parser.parse_args()

    if args.check:
        print(json.dumps(check_gitee_update(), ensure_ascii=False, indent=2))
        return

    if args.update:
        if not args.url:
            print("✗ --url required for --update")
            sys.exit(1)
        dest = Path(tempfile.gettempdir()) / args.name
        if not download_file(args.url, dest):
            sys.exit(1)
        if not launch_installer(dest):
            sys.exit(1)
        print("✓ Installer launched")
        return

    if args.merge:
        app_dir = Path(args.app_dir).resolve() if args.app_dir else ROOT
        data_root = Path(args.data_root).resolve() if args.data_root else app_dir / "报站线路文件库"
        print(json.dumps(merge_update_lines(app_dir, data_root), ensure_ascii=False, indent=2))
        return

    parser.print_help()


if __name__ == "__main__":
    main()
