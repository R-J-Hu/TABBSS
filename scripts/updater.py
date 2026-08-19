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
import urllib.request
from pathlib import Path

# ── Configuration ──────────────────────────────────────────────
GITEE_REPO = "rjhu/TABBSS"
GITEE_API = f"https://gitee.com/api/v5/repos/{GITEE_REPO}"

ROOT = Path(__file__).resolve().parent.parent
VERSION_FILE = ROOT / "VERSION"

AUDIO_RE = re.compile(r'\.(mp3|wav|m4a)$', re.IGNORECASE)


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
        with urllib.request.urlopen(req, timeout=300) as resp:
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


def _collect_referenced_audio(ini_path: Path) -> set:
    """Parse an INI and return referenced audio filenames."""
    audio = set()
    try:
        text = ini_path.read_text(encoding="utf-8", errors="replace")
        for m in re.finditer(r'"([^"]+)"', text):
            fname = m.group(1)
            if AUDIO_RE.search(fname):
                audio.add(fname)
    except Exception:
        pass
    return audio


def _copy_line_from_staging(staging_data: Path, data_root: Path, file_rel: str):
    """Copy a line's .ini + referenced audio from staging into the real data dir.

    Existing files are never overwritten (union semantics).
    """
    src_ini = staging_data / file_rel
    if not src_ini.exists():
        return
    dst_ini = data_root / file_rel
    if not dst_ini.exists():
        dst_ini.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(src_ini, dst_ini)

    company = Path(file_rel).parts[0] if "/" in file_rel else ""
    for fname in _collect_referenced_audio(src_ini):
        src_audio = (staging_data / company / fname) if company else (staging_data / fname)
        if not src_audio.exists():
            continue
        dst_audio = (data_root / company / fname) if company else (data_root / fname)
        if not dst_audio.exists():
            dst_audio.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(src_audio, dst_audio)


def merge_update_lines(app_dir: Path, data_root: Path) -> dict:
    """Merge new lines from `app_dir/.update_package/报站线路文件库` into `data_root`.

    Union by (company, line file). Existing lines are never overwritten.
    Returns {merged: [file_rel], removed_staging: bool}.
    """
    app_dir = Path(app_dir)
    data_root = Path(data_root)
    staging = app_dir / ".update_package" / "报站线路文件库"
    if not staging.exists():
        return {"merged": [], "removed_staging": False}

    index_path = data_root / "index.json"
    existing = {"companies": []}
    if index_path.exists():
        try:
            existing = json.loads(index_path.read_text(encoding="utf-8-sig"))
        except Exception:
            existing = {"companies": []}

    staging_index_path = staging / "index.json"
    staging_index = {"companies": []}
    if staging_index_path.exists():
        try:
            staging_index = json.loads(staging_index_path.read_text(encoding="utf-8-sig"))
        except Exception:
            staging_index = {"companies": []}

    existing_keys = set()
    for c in existing.get("companies", []):
        for l in c.get("lines", []):
            existing_keys.add((c.get("name", ""), l.get("file", "")))

    merged = []
    for c in staging_index.get("companies", []):
        company = c.get("name", "")
        for l in c.get("lines", []):
            file_rel = l.get("file", "")
            key = (company, file_rel)
            if key in existing_keys:
                continue
            _copy_line_from_staging(staging, data_root, file_rel)
            target = next((x for x in existing.get("companies", []) if x.get("name") == company), None)
            if not target:
                target = {"name": company, "lines": []}
                existing["companies"].append(target)
            target["lines"].append({"name": l.get("name", ""), "file": file_rel})
            existing_keys.add(key)
            merged.append(file_rel)

    if merged:
        for c in existing.get("companies", []):
            c["lines"] = sorted(c.get("lines", []), key=lambda x: x.get("name", ""))
        existing["companies"] = sorted(existing.get("companies", []), key=lambda c: c.get("name", ""))
        index_path.write_text(json.dumps(existing, ensure_ascii=False, indent=4), encoding="utf-8")

    shutil.rmtree(app_dir / ".update_package", ignore_errors=True)
    return {"merged": merged, "removed_staging": True}


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
