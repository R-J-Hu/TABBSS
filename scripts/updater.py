#!/usr/bin/env python3
"""
TABBSS Self-Updater
====================
Checks GitHub Releases for new versions and applies updates.

Usage:
    python scripts/updater.py --check              # check for updates only
    python scripts/updater.py --update              # download and apply update
    python scripts/updater.py --update --force      # force update even if same version
    python scripts/updater.py --update --url=<URL>  # update from specific URL
"""

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
# Change these for your GitHub repository
GITHUB_REPO = "your-org/TABBSS"  # TODO: update after creating GitHub repo
GITHUB_API = f"https://api.github.com/repos/{GITHUB_REPO}/releases"

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


def get_local_version() -> str:
    """Read local version from VERSION file."""
    if VERSION_FILE.exists():
        return VERSION_FILE.read_text(encoding="utf-8").strip()
    return "0.0.0"


def check_github_release() -> dict | None:
    """Query GitHub Releases API for the latest release.

    Returns dict with keys: tag_name, name, body, zip_url, sha256_url, version_tuple
    Returns None on error or if no releases found.
    """
    try:
        req = urllib.request.Request(GITHUB_API + "/latest")
        req.add_header("Accept", "application/vnd.github+json")
        req.add_header("User-Agent", "TABBSS-Updater/1.0")
        with urllib.request.urlopen(req, timeout=15) as resp:
            data = json.loads(resp.read().decode("utf-8"))

        tag = data.get("tag_name", "")
        # Find .zip and .sha256 assets
        zip_url = None
        sha256_url = None
        for asset in data.get("assets", []):
            name = asset.get("name", "")
            if name.endswith(".zip"):
                zip_url = asset.get("browser_download_url")
            elif name.endswith(".sha256"):
                sha256_url = asset.get("browser_download_url")

        if not zip_url:
            print("⚠ No .zip asset found in latest release")
            return None

        return {
            "tag_name": tag,
            "name": data.get("name", tag),
            "body": data.get("body", ""),
            "zip_url": zip_url,
            "sha256_url": sha256_url,
            "version_tuple": parse_version(tag),
        }
    except urllib.error.HTTPError as e:
        if e.code == 404:
            print("⚠ No releases found on GitHub")
        else:
            print(f"⚠ GitHub API error: {e.code}")
        return None
    except Exception as e:
        print(f"⚠ Could not check for updates: {e}")
        return None


def check_for_update() -> dict:
    """Check if an update is available.

    Returns dict: {update_available, local_version, latest_version, ...}
    """
    local_ver = get_local_version()
    local_tuple = parse_version(local_ver)

    print(f"Local version:  {local_ver}")
    print(f"Checking {GITHUB_REPO} ...")

    release = check_github_release()
    if release is None:
        return {"update_available": False, "error": "Could not check for updates",
                "local_version": local_ver}

    latest_tuple = release["version_tuple"]
    print(f"Latest release: {release['tag_name']}")

    if latest_tuple > local_tuple:
        print("✓ Update available!")
        return {
            "update_available": True,
            "local_version": local_ver,
            "latest_version": release["tag_name"],
            "release_name": release["name"],
            "changelog": release["body"][:2000],  # truncate for display
            "zip_url": release["zip_url"],
        }
    else:
        print("✓ Already up to date")
        return {
            "update_available": False,
            "local_version": local_ver,
            "latest_version": release["tag_name"],
        }


def verify_sha256(file_path: Path, expected_hash: str) -> bool:
    """Verify SHA256 checksum of a file."""
    sha = hashlib.sha256(file_path.read_bytes()).hexdigest()
    return sha == expected_hash.lower()


def download_file(url: str, dest: Path) -> bool:
    """Download a file with progress indication."""
    print(f"Downloading {url} ...")
    try:
        req = urllib.request.Request(url)
        req.add_header("User-Agent", "TABBSS-Updater/1.0")
        with urllib.request.urlopen(req, timeout=300) as resp:
            total = int(resp.headers.get("Content-Length", 0))
            downloaded = 0
            with open(dest, "wb") as f:
                while True:
                    chunk = resp.read(8192)
                    if not chunk:
                        break
                    f.write(chunk)
                    downloaded += len(chunk)
                    if total:
                        pct = downloaded * 100 // total
                        print(f"\r  {downloaded / 1024 / 1024:.1f} / "
                              f"{total / 1024 / 1024:.1f} MB ({pct}%)", end="")
            print()
        return True
    except Exception as e:
        print(f"\n✗ Download failed: {e}")
        return False


def fetch_sha256(sha256_url: str) -> str | None:
    """Download and parse SHA256 checksum file."""
    if not sha256_url:
        return None
    try:
        req = urllib.request.Request(sha256_url)
        req.add_header("User-Agent", "TABBSS-Updater/1.0")
        with urllib.request.urlopen(req, timeout=15) as resp:
            text = resp.read().decode("utf-8").strip()
            # Format: "abcd1234...  TABBSS_*.zip"
            return text.split()[0]
    except Exception:
        return None


def apply_update(zip_path: Path) -> bool:
    """Apply an update from a ZIP file.

    1. Extract to temp directory
    2. Backup current installation
    3. Replace files (preserve 报站线路文件库/)
    4. Write restart script (Windows only)
    """
    import zipfile

    temp_dir = Path(tempfile.mkdtemp(prefix="tabbss_update_"))
    try:
        # Extract new version
        print("Extracting update ...")
        with zipfile.ZipFile(zip_path, 'r') as zf:
            zf.extractall(temp_dir)

        # Backup current files
        backup_dir = ROOT / "_update_backup"
        if backup_dir.exists():
            shutil.rmtree(backup_dir, ignore_errors=True)
        backup_dir.mkdir(parents=True)

        # Files to replace (not user data)
        dirs_to_replace = ["web", "scripts"]
        files_to_replace = ["main.py", "VERSION", "port.txt"]

        # Backup
        print("Backing up current version ...")
        for d in dirs_to_replace:
            src = ROOT / d
            if src.exists():
                shutil.copytree(src, backup_dir / d)
        for f in files_to_replace:
            src = ROOT / f
            if src.exists():
                shutil.copy2(src, backup_dir / f)

        # Replace
        print("Installing new version ...")
        for d in dirs_to_replace:
            dst = ROOT / d
            if dst.exists():
                shutil.rmtree(dst, ignore_errors=True)
            src = temp_dir / d
            if src.exists():
                shutil.copytree(src, dst)

        for f in files_to_replace:
            src = temp_dir / f
            if src.exists():
                shutil.copy2(src, dst=ROOT / f)

        # Update VERSION file if present
        new_version = temp_dir / "VERSION"
        if new_version.exists():
            shutil.copy2(new_version, ROOT / "VERSION")

        print("✓ Update installed successfully!")
        print(f"  Backup saved to: {backup_dir}")
        print()
        print("⚠ TABBSS needs to restart. Please close and reopen the application.")

        return True

    except Exception as e:
        print(f"✗ Update failed: {e}")
        print("  Attempting rollback from backup ...")
        # Rollback
        backup_dir = ROOT / "_update_backup"
        if backup_dir.exists():
            for d in dirs_to_replace:
                dst = ROOT / d
                if dst.exists():
                    shutil.rmtree(dst, ignore_errors=True)
                src = backup_dir / d
                if src.exists():
                    shutil.copytree(src, dst)
            for f in files_to_replace:
                src = backup_dir / f
                if src.exists():
                    shutil.copy2(src, ROOT / f)
            print("  Rollback complete.")
        return False
    finally:
        shutil.rmtree(temp_dir, ignore_errors=True)


def main():
    import argparse
    parser = argparse.ArgumentParser(description="TABBSS Self-Updater")
    parser.add_argument("--check", action="store_true",
                        help="Check for updates only")
    parser.add_argument("--update", action="store_true",
                        help="Download and apply update")
    parser.add_argument("--force", action="store_true",
                        help="Force update even if same version")
    parser.add_argument("--url", help="Download from specific URL")
    args = parser.parse_args()

    if args.check:
        result = check_for_update()
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return

    if args.update:
        # Check first
        result = check_for_update()

        if not result.get("update_available") and not args.force:
            print("No update needed.")
            return

        if args.force:
            print("Force update mode — skipping version check")

        # Download
        zip_url = args.url or result.get("zip_url")
        if not zip_url:
            print("✗ No download URL available")
            sys.exit(1)

        zip_dest = ROOT / "_update_temp.zip"
        if not download_file(zip_url, zip_dest):
            sys.exit(1)

        # Verify SHA256 if available
        if result.get("sha256_url") and not args.url:
            expected = fetch_sha256(result["sha256_url"])
            if expected:
                print(f"Verifying SHA256: {expected[:16]}...")
                if not verify_sha256(zip_dest, expected):
                    print("✗ SHA256 mismatch! Update aborted.")
                    zip_dest.unlink()
                    sys.exit(1)
                print("✓ SHA256 verified")

        # Apply
        if apply_update(zip_dest):
            zip_dest.unlink()  # clean up
        else:
            sys.exit(1)


if __name__ == "__main__":
    main()
