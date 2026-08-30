#!/usr/bin/env python3
"""
TABBSS Release Builder — Standalone build script.
Run after using the RELEASE TUI to configure selections.

Usage:
    python scripts/build_release.py --edition dev --os windows
    python scripts/build_release.py --config .release_build_config.json
"""

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT / "报站线路文件库"
HAIXIA_DIR = ROOT / "兼容模式-海峡报站器文件库"
FUNCT_PATH = ROOT / "web" / "funct.json"
SETUP_OUT = ROOT / "Setup_output"
SPEC_LINES = ROOT / "release_lines.spec"
SPEC_HAIXIA = ROOT / "release_lines_haixia.spec"
SPEC_FUNCT = ROOT / "release_devfunct.spec"


def log(msg):
    print(f"  {msg}")
    sys.stdout.flush()


def header(msg):
    print(f"\n{'='*50}")
    print(f"  {msg}")
    print(f"{'='*50}")


# ── Data helpers ─────────────────────────────────────────────

def _copytree(src, dst, skip_archives=False):
    dst.mkdir(parents=True, exist_ok=True)
    for item in src.iterdir():
        if item.name.startswith(".") and item.name not in (".trash",):
            continue
        if skip_archives and item.suffix.lower() in (".zip", ".7z"):
            continue
        if item.is_dir():
            _copytree(item, dst / item.name, skip_archives)
        else:
            d = dst / item.name
            d.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(item, d)


def _copy_audio_files(ini_path, dst_dir):
    try:
        text = ini_path.read_text(encoding="utf-8", errors="replace")
        for m in re.finditer(r'"([^"]+)"', text):
            fname = m.group(1)
            if re.search(r'\.(mp3|wav|m4a)$', fname, re.IGNORECASE):
                src = ini_path.parent / fname
                if src.exists():
                    shutil.copy2(src, dst_dir / fname)
    except Exception:
        pass


def build_filtered_data(dst, selection, index_path=DATA_DIR / "index.json"):
    """Copy selected companies: ALL files from company dir (audio/service voices),
    but only the selected INI files. Unselected lines = no INI, but audio stays."""
    if not selection:
        (dst / "index.json").write_text(
            json.dumps({"version": "V1.51", "companies": []}, ensure_ascii=False, indent=2), encoding="utf-8")
        (dst / ".trash").mkdir(exist_ok=True)
        return
    index = json.loads(index_path.read_text(encoding="utf-8")) if index_path.exists() else {"companies": []}
    INI_EXT = ".ini"
    filtered = []
    for comp in index.get("companies", []):
        name = comp["name"]
        if name in selection:
            routes = selection[name]
            if not routes:
                continue
            flines = []
            cdir = dst / name
            cdir.mkdir(parents=True, exist_ok=True)
            src_company_dir = DATA_DIR / name
            # Track which INI files to copy (relative path within data dir)
            selected_inis = set(routes)
            if src_company_dir.is_dir():
                for item in src_company_dir.iterdir():
                    if item.name.startswith("."):
                        continue
                    if item.is_dir():
                        continue  # No subdirs per audio conventions
                    rel_path = f"{name}/{item.name}"
                    try:
                        if item.suffix.lower() == INI_EXT:
                            # Only copy selected INI files
                            if rel_path in selected_inis:
                                shutil.copy2(item, cdir / item.name)
                        elif item.suffix.lower() in (".zip", ".7z"):
                            continue  # Skip archives
                        else:
                            # Copy ALL audio/media files unconditionally
                            shutil.copy2(item, cdir / item.name)
                    except (PermissionError, OSError) as e:
                        # Skip locked/unreadable files; log first occurrence
                        if not hasattr(build_filtered_data, "_copy_errs"):
                            build_filtered_data._copy_errs = set()
                        if rel_path not in build_filtered_data._copy_errs:
                            build_filtered_data._copy_errs.add(rel_path)
                            log(f"WARNING: skip {rel_path}: {e}")
            # Build filtered lines list for index.json
            for l in comp.get("lines", []):
                if l["file"] in routes:
                    flines.append(l)
            if flines:
                filtered.append({"name": name, "lines": flines})
    for dname, inc in selection.get("__orphan_dirs__", {}).items():
        if inc:
            src = DATA_DIR / dname
            if src.is_dir():
                _copytree(src, dst / dname, skip_archives=True)
    for inif in selection.get("__orphan_inis__", []):
        src = DATA_DIR / inif
        if src.exists():
            d = dst / inif
            d.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(src, d)
            # For orphan INIs, also copy all sibling audio files
            if src.parent.is_dir():
                for item in src.parent.iterdir():
                    if item.suffix.lower() == INI_EXT:
                        continue
                    if item.suffix.lower() in (".zip", ".7z"):
                        continue
                    if not item.is_dir():
                        shutil.copy2(item, d.parent / item.name)
    (dst / "index.json").write_text(
        json.dumps({"version": "V1.51", "companies": filtered}, ensure_ascii=False, indent=2), encoding="utf-8")
    (dst / ".trash").mkdir(exist_ok=True)


def build_filtered_haixia(dst, selection):
    if not selection or not HAIXIA_DIR.exists():
        return
    for name, inc in selection.items():
        if name.startswith("__"):
            continue
        if inc:
            src = HAIXIA_DIR / name
            if src.is_dir():
                _copytree(src, dst / name)
    for f in selection.get("__orphans__", []):
        src = HAIXIA_DIR / f
        if src.exists():
            shutil.copy2(src, dst / f)


def build_haixia_output(build_dir, haixia_selection):
    """Generate output/index.json + packages/ for haixia compat mode.
    Uses normalize_route from convert_ini.py. No audio symlinks needed —
    the frontend resolves audio via ../../兼容模式-海峡报站器文件库/<route>/<filename>."""
    if not haixia_selection or not HAIXIA_DIR.exists():
        return

    # Import convert_ini functions dynamically
    import importlib.util
    convert_ini_path = ROOT / "scripts" / "convert_ini.py"
    if not convert_ini_path.exists():
        log("convert_ini.py not found, skipping haixia output generation")
        return

    spec = importlib.util.spec_from_file_location("convert_ini", convert_ini_path)
    convert_ini = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(convert_ini)
    normalize_route = convert_ini.normalize_route

    output_dir = build_dir / "output"
    packages_dir = output_dir / "packages"
    packages_dir.mkdir(parents=True, exist_ok=True)

    index = []
    for name, inc in haixia_selection.items():
        if name.startswith("__"):
            continue
        if not inc:
            continue
        src_dir = HAIXIA_DIR / name
        ini_path = src_dir / "线路信息.ini"
        if not ini_path.exists():
            continue

        pkg_dir = packages_dir / name
        pkg_dir.mkdir(parents=True, exist_ok=True)
        shutil.copy2(ini_path, pkg_dir / "线路信息.ini")

        try:
            route_json = normalize_route(src_dir, None)
        except Exception as e:
            log(f"WARNING: normalize_route failed for {name}: {e}")
            continue

        (pkg_dir / "converted.route.json").write_text(
            json.dumps(route_json, ensure_ascii=False, indent=2), encoding="utf-8")

        index.append({
            "id": route_json["id"],
            "name": route_json["name"],
            "path": f"packages/{route_json['id']}/converted.route.json",
        })

    (output_dir / "index.json").write_text(
        json.dumps(index, ensure_ascii=False, indent=2), encoding="utf-8")
    log(f"Generated output/ for {len(index)} haixia compat routes")


def build_nsis(edition, exe_name, version, build_no, build_dir):
    app_names = {"release": "档案库报站模拟器", "dev": "档案库报站模拟器Dev", "audit": "档案库报站模拟器Audit"}
    dirs = {"release": "TABBSS", "dev": "TABBSS DEV", "audit": "TABBSS AUDIT"}
    start_menus = {"release": "交通档案库", "dev": "交通档案库 Dev", "audit": "交通档案库 Audit"}
    keys = {"release": "TABBSS_release", "dev": "TABBSS_dev", "audit": "TABBSS_audit"}

    # Convert tabl_icon.png → .ico for file association
    tabl_ico_path = ""
    png_src = ROOT / "insider_image" / "tabl_icon.png"
    if png_src.exists():
        try:
            from PIL import Image
            img = Image.open(png_src)
            ico_dst = build_dir / "tabl_icon.ico"
            # Save as .ico with multiple sizes for best display
            sizes = [(16, 16), (32, 32), (48, 48), (256, 256)]
            img.save(str(ico_dst), format="ICO", sizes=[s for s in sizes if s[0] <= img.width])
            tabl_ico_path = str(ico_dst)
            log(f"Converted {png_src.name} → {ico_dst.name}")
        except Exception as e:
            log(f"WARNING: tabl icon conversion failed: {e}")

    tpl_path = ROOT / "scripts" / "installer" / "installer.nsi.template"
    if not tpl_path.exists():
        log("NSIS template not found, skipping installer")
        return None
    tpl = tpl_path.read_text(encoding="utf-8")
    # Strip trailing -buildNNN from VERSION (e.g. "1.6.0-build203" → "1.6.0")
    base_ver = version.split("-")[0]
    ph = {
        "{{APP_NAME}}": app_names[edition], "{{APP_EXE}}": f"{exe_name}.exe",
        "{{INSTALLER_OUTPUT}}": str(SETUP_OUT / f"{app_names[edition]}V{base_ver}-Build{build_no}-安装程序.exe"),
        "{{DEFAULT_INSTALL_DIR}}": f"$PROGRAMFILES\\{dirs[edition]}",
        "{{EDITION_ID}}": keys[edition], "{{VERSION}}": version,
        "{{PUBLISHER}}": "哔哩哔哩@交通档案库",
        "{{APP_URL}}": "https://space.bilibili.com/3546768098724617",
        "{{START_MENU_GROUP}}": start_menus[edition],
        "{{BUILD_DIR}}": str(build_dir), "{{ROOT_DIR}}": str(ROOT),
        "{{LICENSE_PATH}}": str(ROOT / "LICENSE"),
        "{{WEBVIEW2_BOOTSTRAPPER}}": str(ROOT / "dist" / "MicrosoftEdgeWebView2RuntimeInstallerX64.exe"),
        "{{TABL_ICON_PATH}}": tabl_ico_path,
    }
    nsi = tpl
    for k, v in ph.items():
        nsi = nsi.replace(k, v)
    # Fix exe path: PyInstaller outputs to SETUP_OUT, not build_dir
    nsi = nsi.replace(str(build_dir / f"{exe_name}.exe"), str(SETUP_OUT / f"{exe_name}.exe"))
    nsi = nsi.replace(str(ROOT / "TABBSS.exe"), str(SETUP_OUT / f"{exe_name}.exe"))
    gbk_lic = build_dir / "LICENSE_gbk.txt"
    lic = ROOT / "LICENSE"
    if lic.exists():
        gbk_lic.write_text(lic.read_text(encoding="utf-8"), encoding="gbk")
        nsi = nsi.replace(str(ROOT / "LICENSE"), str(gbk_lic))
    nsi_path = build_dir / "installer.nsi"
    nsi_path.write_text(nsi, encoding="utf-8-sig")

    makensis = shutil.which("makensis")
    if not makensis:
        for p in [r"C:\Program Files (x86)\NSIS\makensis.exe", r"C:\Program Files\NSIS\makensis.exe"]:
            if Path(p).exists():
                makensis = p; break
    if makensis:
        result = subprocess.run([makensis, str(nsi_path)], capture_output=True, text=True)
        if result.returncode != 0:
            raise RuntimeError(f"NSIS failed: {result.stderr[-500:]}")
        log(f"Installer: {ph['{{INSTALLER_OUTPUT}}']}")
        return ph["{{INSTALLER_OUTPUT}}"]
    else:
        log("makensis not found, skip NSIS")
    return None


# ── Main build ────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="TABBSS Release Builder")
    parser.add_argument("--edition", default="dev", choices=["release", "dev", "audit"])
    parser.add_argument("--os", default="windows", help="Comma-separated: windows,macos")
    parser.add_argument("--config", help="Path to .release_build_config.json")
    args = parser.parse_args()

    # Load config if provided
    if args.config:
        cfg = json.loads(Path(args.config).read_text(encoding="utf-8"))
        edition = cfg.get("edition", args.edition)
        target_os = cfg.get("target_os", args.os).split(",")
        features = cfg.get("features", {})
    else:
        edition = args.edition
        target_os = [o.strip() for o in args.os.split(",")]
        features = {}

    # Load persisted selections
    archive_sel = {}
    haixia_sel = {}
    if SPEC_LINES.exists():
        archive_sel = json.loads(SPEC_LINES.read_text(encoding="utf-8")).get("archive", {})
    if SPEC_HAIXIA.exists():
        haixia_sel = json.loads(SPEC_HAIXIA.read_text(encoding="utf-8")).get("haixia", {})

    # Version info
    ver = (ROOT / "VERSION").read_text(encoding="utf-8").strip() if (ROOT / "VERSION").exists() else "1.6.0"
    html = (ROOT / "web" / "index.html").read_text(encoding="utf-8")
    bm = re.search(r"Build (\d+)", html)
    build_no = bm.group(1) if bm else "0"

    exe_names = {"release": "TABBSS", "dev": "TABBSS_dev", "audit": "TABBSS_audit"}
    exe_name = exe_names[edition]

    header(f"TABBSS Builder — {edition} edition — V{ver} Build {build_no}")

    # Step 1: Prepare
    log("Step 1/5: Preparing...")
    SETUP_OUT.mkdir(parents=True, exist_ok=True)
    build_dir = SETUP_OUT / f"build_{edition}"
    if build_dir.exists():
        def _on_rm_error(func, path, exc_info):
            """Clear read-only flag and retry; skip if still locked."""
            import stat as _st
            try:
                os.chmod(path, _st.S_IWRITE | _st.S_IREAD)
                func(path)
            except OSError:
                pass  # skip locked files, will be overwritten
        shutil.rmtree(build_dir, onerror=_on_rm_error)
        # If rmtree partially failed, remove what remains
        if build_dir.exists():
            try:
                shutil.rmtree(build_dir, ignore_errors=True)
            except Exception:
                pass
    build_dir.mkdir(parents=True, exist_ok=True)

    # Step 2: Data
    log("Step 2/5: Building data directories...")
    data_dst = build_dir / "报站线路文件库"
    haixia_dst = build_dir / "兼容模式-海峡报站器文件库"
    data_dst.mkdir(parents=True, exist_ok=True)
    haixia_dst.mkdir(parents=True, exist_ok=True)
    if edition == "dev":
        if DATA_DIR.exists():
            _copytree(DATA_DIR, data_dst, skip_archives=True)
        if HAIXIA_DIR.exists():
            _copytree(HAIXIA_DIR, haixia_dst, skip_archives=True)
    else:
        build_filtered_data(data_dst, archive_sel)
        build_filtered_haixia(haixia_dst, haixia_sel)

    # Step 2.5: Generate output/ for haixia compat mode
    if haixia_sel:
        build_haixia_output(build_dir, haixia_sel)

    # Step 3: Runtime
    log("Step 3/5: Copying runtime files...")
    excludes = {"__pycache__", ".git", ".github", ".claude", ".gitignore",
                "dist", "build", "Setup_output", "nul", "_tmp_sf14", "新建文件夹",
                "报站线路文件库", "兼容模式-海峡报站器文件库", "output", "editions", "_ffmpeg"}
    for item in ROOT.iterdir():
        name = item.name
        if name in excludes or name.startswith("."):
            continue
        if edition != "dev":
            skip = ["insider_resource", "insider_image", "_gen_", "_analyze_",
                    "_merge_cache", "_xiamen_web_cache", "_final_verify",
                    "BRT", "AGENTS.md", "CLAUDE.md", "RELEASE", "RELEASE.bat", "RELEASE.command"]
            if any(p in name for p in skip):
                continue
        if item.is_dir():
            _copytree(item, build_dir / name, skip_archives=True)
        else:
            shutil.copy2(item, build_dir / name)

    # Write config
    funct = json.loads(FUNCT_PATH.read_text(encoding="utf-8"))
    funct["edition"] = edition
    for k, v in features.items():
        funct[k] = v

    # Edition-specific defaults (force override)
    if edition == "release":
        funct["show_dev_panel"] = False
        funct["show_dev_track_module"] = False
        funct["show_update_log"] = False
        funct["show_build_number"] = False
        funct["check_updates"] = True
        funct["allow_compat_import_archive"] = False
    elif edition == "dev":
        funct["show_dev_panel"] = True
        funct["show_dev_track_module"] = True
        funct["show_update_log"] = True
        funct["show_build_number"] = True
        funct["check_updates"] = False
    elif edition == "audit":
        funct["show_dev_panel"] = False
        funct["show_dev_track_module"] = False
        funct["show_update_log"] = True
        funct["show_build_number"] = True
        funct["check_updates"] = False
        funct["allow_compat_import_archive"] = False
    (build_dir / "web" / "funct.json").parent.mkdir(parents=True, exist_ok=True)
    (build_dir / "web" / "funct.json").write_text(json.dumps(funct, ensure_ascii=False, indent=2), encoding="utf-8")
    (build_dir / "VERSION").write_text(ver, encoding="utf-8")

    # Step 4: PyInstaller
    total_steps = 5
    if "macos" in target_os:
        total_steps += 1  # Extra step for DMG

    log(f"Step 4/{total_steps}: PyInstaller (may take several minutes)...")
    spec_src = (ROOT / "tabbss.spec").read_text(encoding="utf-8")
    spec_src = spec_src.replace("name='TABBSS'", f"name='{exe_name}'")
    # Also replace BUNDLE name for macOS edition variants
    spec_src = spec_src.replace("name='TABBSS.app'", f"name='{exe_name}.app'")
    spec_tmp = build_dir / "tabbss.spec"
    spec_tmp.write_text(spec_src, encoding="utf-8")
    main_content = (ROOT / "main.py").read_text(encoding="utf-8")
    (build_dir / "main.py").write_text(main_content, encoding="utf-8")

    pyi_args = [sys.executable, "-m", "PyInstaller", str(spec_tmp), "--noconfirm",
                "--distpath", str(SETUP_OUT), "--workpath", str(build_dir / "pyi_work")]
    result = subprocess.run(pyi_args, cwd=str(build_dir), capture_output=True)
    if result.returncode != 0:
        log(f"ERROR: PyInstaller failed")
        log(result.stderr.decode("utf-8", errors="replace")[-500:])
        log(result.stdout.decode("utf-8", errors="replace")[-500:])
        sys.exit(1)
    log(f"OK: {exe_name}.exe")

    # Step 5: Platform-specific packaging
    step = 5
    base_ver = ver.split("-")[0]

    if "windows" in target_os:
        log(f"Step {step}/{total_steps}: Building NSIS installer...")
        build_nsis(edition, exe_name, ver, build_no, build_dir)
        step += 1

    if "macos" in target_os:
        log(f"Step {step}/{total_steps}: macOS packaging...")

        if sys.platform != "darwin":
            log("")
            log("⚠️  WARNING: Cannot build macOS package from Windows!")
            log("    PyInstaller does NOT support cross-compilation.")
            log("    To build for macOS, run this script on a Mac with:")
            log(f"      python scripts/build_release.py --edition {edition} --os macos")
            log("    The .app bundle and .dmg will only be produced on macOS.")
            log("")
        else:
            # Locate .app bundle from PyInstaller output
            app_path = SETUP_OUT / f"{exe_name}.app"
            if not app_path.exists():
                log(f"ERROR: .app bundle not found at {app_path}")
                log("PyInstaller BUNDLE step may have failed. Check PyInstaller output above.")
                sys.exit(1)
            log(f"OK: {app_path}")

            # Create DMG
            app_names = {"release": "档案库报站模拟器", "dev": "档案库报站模拟器Dev", "audit": "档案库报站模拟器Audit"}
            dmg_name = f"{app_names[edition]}V{base_ver}-Build{build_no}.dmg"
            dmg_path = SETUP_OUT / dmg_name
            volname = app_names[edition]

            # Remove existing DMG if any
            if dmg_path.exists():
                dmg_path.unlink()

            log(f"Creating DMG: {dmg_name}...")
            hdiutil_result = subprocess.run(
                ["hdiutil", "create", "-volname", volname,
                 "-srcfolder", str(app_path), "-ov", "-format", "UDZO",
                 str(dmg_path)],
                capture_output=True, text=True)
            if hdiutil_result.returncode != 0:
                log(f"WARNING: hdiutil create failed")
                log(hdiutil_result.stderr[-500:])
                # Attempt fallback: just zip the .app
                import zipfile as _zf
                zip_path = SETUP_OUT / f"{app_names[edition]}V{base_ver}-Build{build_no}.app.zip"
                log(f"Falling back to .app.zip: {zip_path.name}...")
                with _zf.ZipFile(zip_path, 'w', _zf.ZIP_DEFLATED) as zf:
                    for root, dirs, files in os.walk(app_path):
                        for f in sorted(files):
                            fp = Path(root) / f
                            arcname = str(fp.relative_to(SETUP_OUT))
                            # Preserve macOS resource forks + symlinks
                            zi = _zf.ZipInfo(arcname)
                            zi.compress_type = _zf.ZIP_DEFLATED
                            try:
                                zf.writestr(zi, fp.read_bytes())
                            except (IsADirectoryError, OSError):
                                pass
                log(f"OK: {zip_path.name}")
            else:
                log(f"OK: {dmg_name}")
            step += 1

    header("BUILD COMPLETE")
    log(f"Output: {SETUP_OUT}")
    for f in sorted(SETUP_OUT.glob("*")):
        if f.is_file() and f.suffix.lower() in (".exe", ".dmg", ".zip"):
            size_mb = f.stat().st_size / (1024 * 1024)
            log(f"  {f.name} ({size_mb:.1f} MB)")
    if not any(f for f in sorted(SETUP_OUT.glob("*")) if f.is_file() and f.suffix.lower() in (".exe", ".dmg", ".zip")):
        # Fallback: list all exe files
        for f in sorted(SETUP_OUT.glob("*.exe")):
            size_mb = f.stat().st_size / (1024 * 1024)
            log(f"  {f.name} ({size_mb:.1f} MB)")


if __name__ == "__main__":
    main()
