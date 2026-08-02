"""TABBSS Packaging Script — creates release ZIPs for different editions.

Usage:
    python scripts/pack.py                              # auto-detect, pack everything
    python scripts/pack.py --release                    # clean release (exclude dev files)
    python scripts/pack.py --release --edition generic  # neutral public release
    python scripts/pack.py --release --edition internal # full internal release
    python scripts/pack.py --release --edition preload_nanning  # preloaded edition
    python scripts/pack.py --dry                        # dry-run, don't create ZIP
    python scripts/pack.py --open                       # open output folder after
"""

import fnmatch
import json
import os
import re
import shutil
import sys
import tempfile
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent  # CurrentVersion
OUTPUT_DIR = ROOT / "dist"  # release output directory
DATA_DIR = ROOT / "报站线路文件库"

# ── Release exclusion patterns ─────────────────────────────────
# Applied only with --release flag.  Uses fnmatch against relative paths.
RELEASE_EXCLUDES = [
    # Large bundled binaries (user provides these separately)
    "_ffmpeg/**",
    # Dev internals
    ".claude/**",
    "insider_resource/**",
    "insider_image/**",
    "_tmp_sf14/**",
    "新建文件夹/**",
    # Python cache
    "__pycache__/**",
    "**/__pycache__/**",
    "*.pyc",
    # One-off data-generation scripts
    "_gen_*.py",
    "scripts/_gen_*.py",
    "_analyze_*.py",
    "scripts/_analyze_*.py",
    "_merge_cache.py",
    "scripts/_merge_cache.py",
    # Temp / cache
    "_xiamen_web_cache*.json",
    "_final_verify.txt",
    "nul",
    "*.tmp",
    # OS junk
    ".DS_Store",
    "Thumbs.db",
    # Archives in data dirs (huge)
    "报站线路文件库/*.zip",
    "报站线路文件库/*.7z",
    "报站线路文件库/**/*.zip",
    "报站线路文件库/**/*.7z",
    # Legacy compat data — included for all editions (feature parity)
    # Output artifacts
    "output/**",
    # Git
    ".git/**",
    ".github/**",
    ".gitignore",
    # Dev docs
    "AGENTS.md",
    "CLAUDE.md",
    # Reference text files (not runtime)
    "BRT*.txt",
    "厦门BRT*.txt",
    # Build artifacts
    "dist/**",
    "build/**",
    "*.spec.bak",
]


def read_version_build():
    """Extract version and build number from VERSION file + index.html."""
    ver_file = ROOT / "VERSION"
    if ver_file.exists():
        ver_text = ver_file.read_text(encoding="utf-8").strip()
    else:
        ver_text = "1.6.0"

    # Prefer index.html for build number (source of truth per CLAUDE.md)
    html_path = ROOT / "web" / "index.html"
    html = html_path.read_text(encoding="utf-8")
    build_match = re.search(r'Build (\d+)', html)
    build = build_match.group(1) if build_match else "0"

    # Parse version: strip "-buildXXX" suffix, keep "X.Y.Z"
    version = re.sub(r'-build\d+$', '', ver_text)
    return version, build


def load_edition(name):
    """Load edition.json from editions/{name}/."""
    edition_path = ROOT / "editions" / name / "edition.json"
    if not edition_path.exists():
        print(f"⚠ Edition '{name}' not found at {edition_path}")
        return None
    return json.loads(edition_path.read_text(encoding="utf-8"))


def match_exclude(rel_path, patterns):
    """Return True if rel_path matches any fnmatch pattern."""
    for pat in patterns:
        if fnmatch.fnmatch(rel_path, pat):
            return True
        # Also try matching without leading dir for recursive patterns
        if fnmatch.fnmatch(Path(rel_path).name, pat):
            return True
    return False


def collect_referenced_audio(ini_path):
    """Parse an INI file and return set of referenced audio filenames.

    Extracts all "quoted strings" that end with audio extensions (.mp3/.wav/.m4a/.MP3/.WAV/.M4A).
    """
    audio_files = set()
    try:
        text = Path(ini_path).read_text(encoding="utf-8", errors="replace")
        # Find all quoted strings
        for m in re.finditer(r'"([^"]+)"', text):
            fname = m.group(1)
            if re.search(r'\.(mp3|wav|m4a)$', fname, re.IGNORECASE):
                audio_files.add(fname)
    except Exception as e:
        print(f"  ⚠ Could not parse {ini_path}: {e}")
    return audio_files


def build_edition_data(edition, temp_dir):
    """Build the 报站线路文件库/ directory for a specific edition.

    Returns the path to the built data directory (inside temp_dir).
    """
    data_src = DATA_DIR
    data_dst = temp_dir / "报站线路文件库"
    routes = edition.get("data", {}).get("routes", [])

    if routes == "all":
        # Full copy both data directories (excluding archives)
        print(f"  Copying all route data from {data_src} ...")
        _copytree_filtered(data_src, data_dst, exclude_archives=True)
        # Also copy 兼容模式 data
        compat_src = ROOT / "兼容模式-海峡报站器文件库"
        compat_dst = temp_dir / "兼容模式-海峡报站器文件库"
        if compat_src.exists() and compat_src.is_dir():
            print(f"  Copying compatible-mode data from {compat_src} ...")
            _copytree_filtered(compat_src, compat_dst, exclude_archives=True)
        return data_dst

    # Create empty directory structure
    data_dst.mkdir(parents=True, exist_ok=True)

    if not routes:
        # Generic edition: empty directories, minimal index.json
        print("  Creating empty data directories (generic edition) ...")
        empty_index = {"version": "V1.51", "companies": []}
        (data_dst / "index.json").write_text(
            json.dumps(empty_index, ensure_ascii=False, indent=2), encoding="utf-8")
        (data_dst / ".trash").mkdir(exist_ok=True)
        # Empty 兼容模式 directory
        compat_dst = temp_dir / "兼容模式-海峡报站器文件库"
        compat_dst.mkdir(parents=True, exist_ok=True)
        return data_dst

    # Preload edition: specific routes only
    print(f"  Building preload edition with {len(routes)} route(s) ...")
    index_path = data_src / "index.json"
    if not index_path.exists():
        print("  ⚠ index.json not found in data directory")
        return data_dst

    full_index = json.loads(index_path.read_text(encoding="utf-8"))
    all_audio = set()
    selected_companies = {}

    for route_path in routes:
        # route_path format: "公司名/线路文件.ini"
        parts = route_path.replace("\\", "/").split("/", 1)
        if len(parts) != 2:
            print(f"  ⚠ Invalid route path: {route_path}")
            continue
        company_name, ini_filename = parts

        # Find the route in index
        for comp in full_index.get("companies", []):
            if comp["name"] == company_name:
                for line in comp.get("lines", []):
                    if line["file"] == route_path:
                        # Copy INI file
                        src_ini = data_src / route_path
                        dst_ini = data_dst / route_path
                        dst_ini.parent.mkdir(parents=True, exist_ok=True)
                        if src_ini.exists():
                            shutil.copy2(src_ini, dst_ini)
                            # Collect referenced audio
                            audio = collect_referenced_audio(src_ini)
                            all_audio.update(audio)
                            print(f"    ✓ {route_path} ({len(audio)} audio refs)")
                        else:
                            print(f"    ⚠ INI not found: {src_ini}")

                        # Track for filtered index
                        if company_name not in selected_companies:
                            selected_companies[company_name] = []
                        selected_companies[company_name].append(line)
                        break
                break

    # Copy referenced audio files
    if all_audio:
        print(f"  Copying {len(all_audio)} referenced audio file(s) ...")
        copied_audio = 0
        for company_dir in data_src.iterdir():
            if not company_dir.is_dir() or company_dir.name.startswith("."):
                continue
            for f in company_dir.iterdir():
                if not f.is_file():
                    continue
                if f.name in all_audio:
                    dst = data_dst / company_dir.name / f.name
                    dst.parent.mkdir(parents=True, exist_ok=True)
                    shutil.copy2(f, dst)
                    copied_audio += 1
        print(f"    {copied_audio} audio file(s) copied")

    # Write filtered index.json
    filtered_index = {
        "version": full_index.get("version", "V1.51"),
        "companies": [
            {"name": name, "lines": lines}
            for name, lines in selected_companies.items()
        ]
    }
    (data_dst / "index.json").write_text(
        json.dumps(filtered_index, ensure_ascii=False, indent=2), encoding="utf-8")
    (data_dst / ".trash").mkdir(exist_ok=True)

    return data_dst


def _copytree_filtered(src, dst, exclude_archives=False):
    """Copy directory tree, optionally skipping .zip/.7z files."""
    if not src.is_dir():
        return
    dst.mkdir(parents=True, exist_ok=True)
    for item in src.iterdir():
        if item.name.startswith(".") and item.name != ".trash":
            continue
        if exclude_archives and item.suffix.lower() in (".zip", ".7z"):
            continue
        if item.is_dir():
            _copytree_filtered(item, dst / item.name, exclude_archives)
        else:
            shutil.copy2(item, dst / item.name)


def make_zip(version, build, dry=False, release=False, edition_name=None):
    """Create release ZIP, optionally filtered by edition and release mode."""
    # Determine output name
    if edition_name:
        zip_name = f"TABBSS_{edition_name}_V{version}_Build{build}.zip"
    else:
        zip_name = f"TABBSS_V{version}_Build{build}.zip"

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    zip_path = OUTPUT_DIR / zip_name

    if dry:
        print(f"[dry-run] Would create: {zip_path}")
        return zip_path

    # ── Build in temp directory ──────────────────────────────
    temp_dir = Path(tempfile.mkdtemp(prefix="tabbss_build_"))
    try:
        print(f"Packaging: {zip_name}")

        if release:
            print("  Mode: release (clean)")
            # When building an edition, skip both data dirs — will be rebuilt
            extra_excludes = ["报站线路文件库/**", "兼容模式-海峡报站器文件库/**"] if edition_name else []
            _copy_release_files(ROOT, temp_dir, extra_excludes=extra_excludes)
        else:
            print("  Mode: full (everything)")
            # Copy everything (legacy behavior, but still skip .zip at root)
            _copytree_filtered(ROOT, temp_dir, exclude_archives=True)

        # Apply edition data
        if edition_name:
            edition = load_edition(edition_name)
            if edition is None:
                print(f"  ✗ Edition '{edition_name}' not found, aborting.")
                return None
            print(f"  Edition: {edition['name']}")

            # Replace data directory with edition-specific version
            edition_data_dir = temp_dir / "报站线路文件库"
            if edition_data_dir.exists():
                shutil.rmtree(edition_data_dir, ignore_errors=True)
            build_edition_data(edition, temp_dir)

            # Override funct.json with edition features
            funct_path = temp_dir / "web" / "funct.json"
            if funct_path.exists():
                funct = json.loads(funct_path.read_text(encoding="utf-8"))
                funct.update(edition.get("features", {}))
                funct_path.write_text(
                    json.dumps(funct, ensure_ascii=False, indent=2), encoding="utf-8")
                print(f"  Features: {edition.get('features', {})}")

        # ── Create ZIP ──────────────────────────────────────
        print(f"  Creating ZIP ...")
        with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
            count = 0
            for f in sorted(temp_dir.rglob("*")):
                if f.is_file():
                    arcname = str(f.relative_to(temp_dir))
                    zf.write(f, arcname)
                    count += 1
                    if count % 200 == 0:
                        print(f"    ... {count} files")

        size_mb = zip_path.stat().st_size / (1024 * 1024)
        print(f"  Done: {count} files → {zip_name} ({size_mb:.1f} MB)")

        # Generate SHA256
        import hashlib
        sha = hashlib.sha256(zip_path.read_bytes()).hexdigest()
        sha_path = zip_path.with_suffix(zip_path.suffix + ".sha256")
        sha_path.write_text(f"{sha}  {zip_name}\n", encoding="utf-8")
        print(f"  SHA256: {sha[:16]}... → {sha_path.name}")

        return zip_path

    finally:
        shutil.rmtree(temp_dir, ignore_errors=True)


def _copy_release_files(src, dst, extra_excludes=None):
    """Copy runtime files from src to dst, respecting RELEASE_EXCLUDES + optional extras."""
    excludes = list(RELEASE_EXCLUDES)
    if extra_excludes:
        excludes.extend(extra_excludes)
    count = 0
    for item in sorted(src.rglob("*")):
        rel = str(item.relative_to(src)).replace("\\", "/")

        if match_exclude(rel, excludes):
            continue

        if item.is_file():
            dst_file = dst / rel
            dst_file.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(item, dst_file)
            count += 1

    print(f"  {count} runtime files copied to build dir")


def main():
    dry = "--dry" in sys.argv
    open_folder = "--open" in sys.argv
    release = "--release" in sys.argv
    edition_name = None

    # Parse --edition <name>
    for i, arg in enumerate(sys.argv):
        if arg == "--edition" and i + 1 < len(sys.argv):
            edition_name = sys.argv[i + 1]
            break

    version, build = read_version_build()
    print(f"TABBSS V{version} Build {build}")

    if edition_name:
        print(f"Edition: {edition_name}")

    zip_path = make_zip(version, build, dry=dry,
                        release=release, edition_name=edition_name)

    if zip_path and not dry and open_folder:
        import subprocess
        subprocess.Popen(["explorer", "/select,", str(zip_path)])


if __name__ == "__main__":
    main()
