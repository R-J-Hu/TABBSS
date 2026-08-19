#!/usr/bin/env python3
import argparse
import io
import json
import posixpath
import zipfile
from datetime import datetime
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
from urllib.parse import unquote


class LocalHandler(SimpleHTTPRequestHandler):
    root_dir: Path = Path.cwd()
    data_root: Path = Path.cwd() / "userdata" / "local"

    def _send_json(self, code: int, payload: dict):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def translate_path(self, path):
        path = path.split("?", 1)[0].split("#", 1)[0]
        path = posixpath.normpath(unquote(path))
        words = [w for w in path.split("/") if w]
        # If the path starts with a data directory name, serve from the
        # corresponding location (data dirs live next to the exe, not under root_dir).
        data_dirs = ["报站线路文件库", "兼容模式-海峡报站器文件库", "output"]
        if words and words[0] in data_dirs:
            # Resolve relative to data_root's parent (since data_root IS the data dir)
            base = self.data_root.parent if self.data_root.parent != self.data_root else self.root_dir
        else:
            base = self.root_dir
        full = base
        for word in words:
            if word in (".", ".."):
                continue
            full = full / word
        return str(full)

    def do_GET(self):
        # API: check for updates (allow ?force=1 query)
        if self.path.split("?", 1)[0] == "/api/check_update":
            self._api_check_update()
            return
        # API: download progress for the update installer
        if self.path == "/api/update_progress":
            self._api_update_progress()
            return
        # API: pending import (file association double-click)
        if self.path == "/api/pending_import":
            self._api_pending_import()
            return
        # Root → redirect to /web/
        if self.path in ("/", ""):
            self.send_response(302)
            self.send_header("Location", "/web/")
            self.end_headers()
            return
        # /web/ 或 /web → serve web/index.html
        if self.path in ("/web/", "/web"):
            index_path = self.translate_path("/web/index.html")
            if Path(index_path).is_file():
                self.path = "/web/index.html"
            else:
                self.send_error(404, "index.html not found")
                return
        super().do_GET()

    def end_headers(self):
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()

    def do_POST(self):
        # API: trigger update
        if self.path == "/api/update":
            self._api_update()
            return
        if not self.path.startswith("/api/file/") and self.path != "/api/open_folder":
            self.send_error(404, "Not Found")
            return

        api = self.path

        # Upload and import use multipart/form-data, export returns binary — handle before JSON parsing
        if api == "/api/file/upload":
            try:
                self._api_upload()
            except Exception as e:
                self._send_json(500, {"ok": False, "error": str(e)})
            return
        if api == "/api/file/export":
            try:
                self._api_export()
            except Exception as e:
                import traceback
                print(f"[export] ERROR: {e}")
                traceback.print_exc()
                self._send_json(500, {"ok": False, "error": str(e)})
            return
        if api == "/api/file/import":
            try:
                self._api_import()
            except Exception as e:
                self._send_json(500, {"ok": False, "error": str(e)})
            return
        if api == "/api/open_folder":
            try:
                body = self.rfile.read(int(self.headers.get("Content-Length", "0")))
                data = json.loads(body.decode("utf-8") or "{}")
                self._api_open_folder(data)
            except Exception as e:
                self._send_json(500, {"ok": False, "error": str(e)})
            return

        try:
            length = int(self.headers.get("Content-Length", "0"))
            body = self.rfile.read(length) if length > 0 else b"{}"
            data = json.loads(body.decode("utf-8") or "{}")
        except Exception as e:
            self._send_json(400, {"ok": False, "error": f"invalid json: {e}"})
            return

        try:
            if api == "/api/file/read":
                self._api_read(data)
            elif api == "/api/file/write":
                self._api_write(data)
            elif api == "/api/file/delete":
                self._api_delete(data)
            elif api == "/api/file/rename":
                self._api_rename(data)
            elif api == "/api/file/reindex":
                self._api_reindex(data)
            elif api == "/api/file/restore_latest":
                self._api_restore_latest(data)
            elif api == "/api/file/list":
                self._api_list(data)
            elif api == "/api/file/list_media":
                self._api_list_media(data)
            elif api == "/api/file/mkdir":
                self._api_mkdir(data)
            elif api == "/api/file/rmdir":
                self._api_rmdir(data)
            elif api == "/api/file/copy":
                self._api_copy(data)
            elif api == "/api/file/update_index":
                self._api_update_index(data)
            else:
                self._send_json(404, {"ok": False, "error": "unknown api"})
        except Exception as e:
            self._send_json(500, {"ok": False, "error": str(e)})

    def _safe_rel(self, rel_path: str) -> Path:
        rel = Path(rel_path or "")
        if rel.is_absolute():
            raise ValueError("绝对路径不允许")
        target = (self.data_root / rel).resolve()
        data_root = self.data_root.resolve()
        if data_root not in target.parents and target != data_root:
            raise ValueError("路径越界")
        return target

    def _validate_leaf_name(self, name: str):
        if not name or not name.strip():
            raise ValueError("文件名不能为空")
        illegal = set('\\/:*?"<>|')
        if any(ch in illegal for ch in name):
            raise ValueError('文件名包含非法字符：\\ / : * ? " < > |')
        if ".." in name:
            raise ValueError("文件名不能包含 ..")

    def _trash_root(self) -> Path:
        return self.data_root / ".trash"

    def _trash_index_path(self) -> Path:
        return self._trash_root() / "_latest.json"

    def _read_trash_index(self):
        p = self._trash_index_path()
        if not p.exists():
            return []
        try:
            data = json.loads(p.read_text(encoding="utf-8"))
            return data if isinstance(data, list) else []
        except Exception:
            return []

    def _write_trash_index(self, items):
        root = self._trash_root()
        root.mkdir(parents=True, exist_ok=True)
        self._trash_index_path().write_text(json.dumps(items, ensure_ascii=False, indent=2), encoding="utf-8")

    def _api_read(self, data):
        rel = data.get("relPath", "")
        p = self._safe_rel(rel)
        if not p.exists() or not p.is_file():
            self._send_json(404, {"ok": False, "error": "文件不存在"})
            return
        content = p.read_text(encoding="utf-8")
        self._send_json(200, {"ok": True, "content": content})

    def _api_write(self, data):
        rel = data.get("relPath", "")
        content = data.get("content", "")
        print(f"[server] writeFile: relPath={rel}, contentLen={len(content) if content else 0}")
        p = self._safe_rel(rel)
        self._validate_leaf_name(p.name)
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(content, encoding="utf-8")
        print(f"[server] writeFile OK: {p} (exists={p.exists()}, size={p.stat().st_size})")
        self._send_json(200, {"ok": True, "relPath": rel})

    def _api_delete(self, data):
        rel = data.get("relPath", "")
        p = self._safe_rel(rel)
        print(f"[server] deleteFile: relPath={rel}, resolved={p}, exists={p.exists()}")
        if not p.exists() or not p.is_file():
            self._send_json(404, {"ok": False, "error": "文件不存在"})
            return

        rel_posix = p.relative_to(self.data_root).as_posix()
        trash_root = self._trash_root()
        trash_target_dir = trash_root / p.parent.relative_to(self.data_root)
        trash_target_dir.mkdir(parents=True, exist_ok=True)
        stamp = datetime.now().strftime("%Y%m%d_%H%M%S_%f")
        trash_name = f"{stamp}__{p.name}"
        trash_target = trash_target_dir / trash_name
        p.rename(trash_target)

        idx = self._read_trash_index()
        idx.insert(0, {
            "originalRelPath": rel_posix,
            "trashRelPath": trash_target.relative_to(self.data_root).as_posix(),
            "deletedAt": stamp,
        })
        self._write_trash_index(idx[:300])
        self._send_json(200, {"ok": True, "relPath": rel_posix, "trashRelPath": trash_target.relative_to(self.data_root).as_posix()})

    def _api_rename(self, data):
        src_rel = data.get("fromRelPath", "")
        dst_rel = data.get("toRelPath", "")
        src = self._safe_rel(src_rel)
        dst = self._safe_rel(dst_rel)
        self._validate_leaf_name(src.name)
        self._validate_leaf_name(dst.name)
        if not src.exists():
            self._send_json(404, {"ok": False, "error": "源文件/目录不存在"})
            return
        if dst.exists():
            self._send_json(409, {"ok": False, "error": "目标已存在"})
            return
        dst.parent.mkdir(parents=True, exist_ok=True)
        src.rename(dst)
        self._send_json(200, {"ok": True, "fromRelPath": src_rel, "toRelPath": dst_rel})

    def _api_pending_import(self):
        """Handle file association double-click: read pending .tabl, create import session,
        return the SAME preview format as the regular upload flow (used by showImportPreviewDialog)."""
        import uuid as _uuid
        flag = self.data_root / '.pending_import'
        if not flag.exists():
            self._send_json(200, {"ok": True, "pending": False})
            return

        try:
            info = json.loads(flag.read_text(encoding='utf-8'))
            tabl_path = Path(info.get('file', ''))
            if not tabl_path.exists():
                flag.unlink(missing_ok=True)
                self._send_json(200, {"ok": True, "pending": False})
                return

            zip_data = tabl_path.read_bytes()
            # Same logic as _api_import phase 1 (upload preview)
            with zipfile.ZipFile(io.BytesIO(zip_data), 'r') as zf:
                ini_files = []
                media_files = []
                for name in zf.namelist():
                    if name.endswith("/"): continue
                    safe_name = name.replace("\\", "/").lstrip("/")
                    if safe_name.endswith(".ini"): ini_files.append(safe_name)
                    else: media_files.append(safe_name)

                zip_company = ini_files[0].split("/")[0] if ini_files else ""

                # Build preview lines (same as _api_import)
                preview_lines = []
                index_path = self.data_root / "index.json"
                existing_index = {"companies": []}
                if index_path.exists():
                    try: existing_index = json.loads(index_path.read_text(encoding="utf-8-sig"))
                    except Exception: pass
                companies = existing_index.get("companies", [])
                # Check conflicts against zip_company
                target = next((c for c in companies if c["name"] == zip_company), None)
                for ini_rel in ini_files:
                    line_name = ini_rel.split("/")[-1].replace(".ini", "")
                    if ini_rel.startswith(zip_company + "/"):
                        dest_path = zip_company + "/" + ini_rel[len(zip_company) + 1:]
                    elif "/" not in ini_rel:
                        dest_path = zip_company + "/" + ini_rel
                    else:
                        dest_path = ini_rel
                    existing_matches = [l for l in (target["lines"] if target else []) if l["file"] == dest_path]
                    preview_lines.append({
                        "name": line_name,
                        "exists": len(existing_matches) > 0,
                        "sameVersion": len(existing_matches) > 0,
                        "existingVersion": existing_matches[0].get("version", "") if existing_matches else "",
                    })

                # Create import session (so existing POST /api/file/import can use it)
                session_id = str(_uuid.uuid4())[:8]
                self._import_sessions[session_id] = {"zip_data": zip_data, "zip_company": zip_company}

                # Clean up — flag and incoming file are no longer needed
                flag.unlink(missing_ok=True)
                try: tabl_path.unlink()
                except Exception: pass

                # Return SAME format as upload preview
                self._send_json(200, {
                    "ok": True, "pending": True, "preview": True,
                    "sessionId": session_id,
                    "lines": preview_lines,
                    "conflicts": [l for l in preview_lines if l["exists"]],
                    "newLines": [l for l in preview_lines if not l["exists"]],
                    "mediaCount": len(media_files), "iniCount": len(ini_files),
                    "zipCompany": zip_company,
                    "origFileName": info.get('name', tabl_path.name),
                })
        except Exception as e:
            if 'tabl_path' in dir() and not tabl_path.exists():
                flag.unlink(missing_ok=True)
            self._send_json(200, {"ok": True, "pending": False, "error": str(e)})

    def _api_restore_latest(self, _data):
        idx = self._read_trash_index()
        if not idx:
            self._send_json(200, {"ok": True, "restoredRelPath": ""})
            return

        while idx:
            item = idx.pop(0)
            trash_rel = item.get("trashRelPath", "")
            origin_rel = item.get("originalRelPath", "")
            trash_file = self._safe_rel(trash_rel)
            origin_file = self._safe_rel(origin_rel)
            if not trash_file.exists() or not trash_file.is_file():
                continue
            origin_file.parent.mkdir(parents=True, exist_ok=True)
            if origin_file.exists():
                self._send_json(409, {"ok": False, "error": f"无法恢复，目标已存在：{origin_rel}"})
                self._write_trash_index(idx)
                return
            trash_file.rename(origin_file)
            self._write_trash_index(idx)
            self._send_json(200, {"ok": True, "restoredRelPath": origin_rel})
            return

        self._write_trash_index([])
        self._send_json(200, {"ok": True, "restoredRelPath": ""})

    def _api_reindex(self, _data):
        scripts_dir = self.root_dir / "scripts"
        convert_script = scripts_dir / "convert_to_v15_package.py"
        if not convert_script.exists():
            self._send_json(404, {"ok": False, "error": "转换脚本不存在"})
            return

        import subprocess
        import sys
        result = subprocess.run(
            [sys.executable, str(convert_script)],
            cwd=str(self.root_dir),
            capture_output=True,
            text=True,
            check=False,
        )
        if result.returncode != 0:
            self._send_json(500, {"ok": False, "error": result.stderr or result.stdout or "reindex failed"})
            return

        self._send_json(200, {"ok": True, "message": result.stdout.strip()})

    def _api_list(self, data):
        rel = data.get("relPath", "")
        include_meta = data.get("includeMeta", False)
        p = self._safe_rel(rel)
        if not p.exists() or not p.is_dir():
            self._send_json(404, {"ok": False, "error": "目录不存在"})
            return
        items = []
        for item in sorted(p.iterdir(), key=lambda x: (not x.is_dir(), x.name.lower())):
            entry = {"name": item.name, "isDir": item.is_dir()}
            if include_meta and not item.is_dir():
                try:
                    st = item.stat()
                    entry["size"] = st.st_size
                    entry["mtime"] = st.st_mtime
                except Exception:
                    entry["size"] = 0
                    entry["mtime"] = 0
            elif include_meta and item.is_dir():
                try:
                    entry["mtime"] = item.stat().st_mtime
                except Exception:
                    entry["mtime"] = 0
            items.append(entry)
        self._send_json(200, {"ok": True, "items": items})

    def _api_list_media(self, data):
        rel = data.get("relPath", "")
        p = self._safe_rel(rel)
        if not p.exists() or not p.is_dir():
            self._send_json(404, {"ok": False, "error": "目录不存在"})
            return
        AUDIO_EXT = {".wav", ".mp3", ".m4a", ".WAV", ".MP3", ".M4A"}
        EXT_PRIORITY = {".wav": 0, ".WAV": 0, ".mp3": 1, ".MP3": 1, ".m4a": 2, ".M4A": 2}
        seen = {}
        files = sorted(
            [f for f in p.iterdir() if f.is_file() and f.suffix in AUDIO_EXT],
            key=lambda f: f.name.lower(),
        )
        for f in files:
            stem = f.stem
            prio = EXT_PRIORITY.get(f.suffix, 99)
            if stem not in seen or prio < EXT_PRIORITY.get(seen[stem]["ext"], 99):
                try:
                    st = f.stat()
                    seen[stem] = {
                        "name": f.name,
                        "size": st.st_size,
                        "mtime": st.st_mtime,
                        "ext": f.suffix,
                    }
                except Exception:
                    seen[stem] = {"name": f.name, "size": 0, "mtime": 0, "ext": f.suffix}
        items = sorted(seen.values(), key=lambda x: x["name"].lower())
        self._send_json(200, {"ok": True, "items": items})

    def _api_mkdir(self, data):
        rel = data.get("relPath", "")
        p = self._safe_rel(rel)
        self._validate_leaf_name(p.name)
        if p.exists():
            self._send_json(409, {"ok": False, "error": "目录已存在"})
            return
        p.mkdir(parents=True, exist_ok=False)
        self._send_json(200, {"ok": True, "relPath": rel})

    def _api_rmdir(self, data):
        rel = data.get("relPath", "")
        force = data.get("force", False)
        if not force:
            self._send_json(400, {"ok": False, "error": "需要 force=true 确认删除"})
            return
        p = self._safe_rel(rel)
        if not p.exists() or not p.is_dir():
            self._send_json(404, {"ok": False, "error": "目录不存在"})
            return
        if p == self.data_root:
            self._send_json(400, {"ok": False, "error": "不能删除数据根目录"})
            return
        import shutil
        shutil.rmtree(p)
        self._send_json(200, {"ok": True, "relPath": rel})

    def _api_open_folder(self, data):
        rel = data.get("relPath", "")
        # Allow known sibling directories (e.g. 兼容模式-海峡报站器文件库)
        data_dirs = ["兼容模式-海峡报站器文件库", "output"]
        if rel in data_dirs:
            p = (self.data_root.parent / rel).resolve()
        else:
            p = self._safe_rel(rel)
        if not p.exists() or not p.is_dir():
            self._send_json(404, {"ok": False, "error": "目录不存在"})
            return
        import os
        os.startfile(str(p))
        self._send_json(200, {"ok": True, "relPath": rel})

    def _api_copy(self, data):
        src_rel = data.get("fromRelPath", "")
        dst_rel = data.get("toRelPath", "")
        src = self._safe_rel(src_rel)
        dst = self._safe_rel(dst_rel)
        self._validate_leaf_name(dst.name)
        if not src.exists() or not src.is_file():
            self._send_json(404, {"ok": False, "error": "源文件不存在"})
            return
        if dst.exists():
            self._send_json(409, {"ok": False, "error": "目标文件已存在"})
            return
        dst.parent.mkdir(parents=True, exist_ok=True)
        import shutil
        shutil.copy2(src, dst)
        self._send_json(200, {"ok": True, "fromRelPath": src_rel, "toRelPath": dst_rel})

    def _api_update_index(self, data):
        """Add or remove a line entry in index.json without full reindex."""
        company = data.get("company", "")
        line_name = data.get("lineName", "")
        line_file = data.get("lineFile", "")
        action = data.get("action", "add")  # "add" or "remove"
        index_path = self.data_root / "index.json"
        if not index_path.exists():
            self._send_json(404, {"ok": False, "error": "index.json 不存在"})
            return
        try:
            idx = json.loads(index_path.read_text(encoding="utf-8-sig"))
        except Exception:
            try:
                idx = json.loads(index_path.read_text(encoding="utf-8"))
            except Exception as e:
                self._send_json(500, {"ok": False, "error": f"无法解析 index.json: {e}"})
                return

        companies = idx.get("companies", [])
        target = next((c for c in companies if c["name"] == company), None)

        if action == "add":
            if not target:
                target = {"name": company, "lines": []}
                companies.append(target)
            # Avoid duplicates
            existing = [l for l in target["lines"] if l["file"] == line_file]
            if existing:
                self._send_json(200, {"ok": True, "message": "条目已存在"})
                return
            target["lines"].append({"name": line_name, "file": line_file})
            target["lines"].sort(key=lambda x: x["name"])
        elif action == "remove":
            if not target:
                self._send_json(404, {"ok": False, "error": "公司不存在"})
                return
            target["lines"] = [l for l in target["lines"] if l["file"] != line_file]
            if not target["lines"]:
                companies.remove(target)

        idx["companies"] = sorted(companies, key=lambda c: c["name"])
        index_path.write_text(json.dumps(idx, ensure_ascii=False, indent=4), encoding="utf-8")
        self._send_json(200, {"ok": True, "message": f"index.json {action} 成功"})

    def _api_upload(self):
        content_type = self.headers.get("Content-Type", "")
        if "multipart/form-data" not in content_type:
            self._send_json(400, {"ok": False, "error": "需要 multipart/form-data"})
            return
        content_length = int(self.headers.get("Content-Length", "0"))
        body = self.rfile.read(content_length)
        print(f"[upload] received {content_length} bytes, content-type={content_type}")

        # Extract boundary
        boundary = None
        for part in content_type.split(";"):
            part = part.strip()
            if part.startswith("boundary="):
                boundary = part[len("boundary="):].strip('"')
                break
        if not boundary:
            print("[upload] ERROR: no boundary found")
            self._send_json(400, {"ok": False, "error": "缺少 boundary"})
            return
        print(f"[upload] boundary={boundary}")

        boundary_bytes = boundary.encode("utf-8")
        parts = body.split(b"--" + boundary_bytes)
        print(f"[upload] parsed {len(parts)} multipart sections")

        # Two-pass: first find relPath, then process file parts
        target_rel = ""
        file_parts = []  # (headers_raw, file_data) tuples

        for part_bytes in parts:
            if not part_bytes or part_bytes == b"--\r\n" or part_bytes == b"--":
                continue
            header_end = part_bytes.find(b"\r\n\r\n")
            if header_end < 0:
                continue
            headers_raw = part_bytes[:header_end].decode("utf-8", errors="replace")
            file_data = part_bytes[header_end + 4:]
            if file_data.endswith(b"\r\n"):
                file_data = file_data[:-2]

            if 'name="relPath"' in headers_raw:
                target_rel = file_data.decode("utf-8", errors="replace").strip()
                print(f"[upload] found relPath={target_rel}")
            elif 'filename="' in headers_raw:
                file_parts.append((headers_raw, file_data))
                import re
                fn = "?"
                m = re.search(r'filename="([^"]*)"', headers_raw)
                if m: fn = m.group(1)
                print(f"[upload] found file part: {fn}, data_len={len(file_data)}")

        print(f"[upload] target_rel={target_rel}, file_parts={len(file_parts)}")

        saved = []
        for headers_raw, file_data in file_parts:
            import re
            fn_match = re.search(r'filename="([^"]*)"', headers_raw)
            if not fn_match:
                print("[upload] WARN: no filename match in headers")
                continue
            fn = fn_match.group(1)
            if not target_rel:
                print(f"[upload] WARN: no target_rel, skipping {fn}")
                continue
            if not file_data:
                print(f"[upload] WARN: empty file_data for {fn}")
                continue
            target_dir = self._safe_rel(target_rel)
            target_dir.mkdir(parents=True, exist_ok=True)
            file_name = Path(fn).name
            self._validate_leaf_name(file_name)
            dest = target_dir / file_name
            dest.write_bytes(file_data)
            print(f"[upload] SAVED {file_name} ({len(file_data)} bytes) to {dest}")
            saved.append({"name": file_name, "size": len(file_data)})

        if saved:
            self._send_json(200, {"ok": True, "saved": saved, "relPath": target_rel})
        else:
            self._send_json(400, {"ok": False, "error": "没有接收到文件", "debug": str(target_rel), "fileParts": len(file_parts)})

    def _api_export(self):
        """Export lines/company as a zip including referenced audio files."""
        length = int(self.headers.get("Content-Length", "0"))
        body = self.rfile.read(length) if length > 0 else b"{}"
        data = json.loads(body.decode("utf-8") or "{}")
        export_type = data.get("type", "line")
        rel_paths = data.get("relPaths", [])
        company = data.get("company", "")

        if not rel_paths:
            self._send_json(400, {"ok": False, "error": "未指定要导出的线路"})
            return

        # Collect all referenced audio files
        audio_files = set()
        ini_contents = {}
        missing = []
        for rel_path in rel_paths:
            p = self._safe_rel(rel_path)
            if not p.exists() or not p.is_file():
                print(f"[export] SKIP missing file: {rel_path}")
                missing.append(rel_path)
                continue
            text = p.read_text(encoding="utf-8")
            ini_contents[rel_path] = text
            # Collect file references
            files = self._collect_line_files(text)
            print(f"[export] {rel_path}: collected {len(files)} file refs: {sorted(files)}")
            for f in files:
                audio_files.add(f)

        if not ini_contents:
            self._send_json(404, {"ok": False, "error": "所有线路文件都不存在", "missing": missing})
            return

        if missing:
            print(f"[export] WARNING: {len(missing)} files missing, skipped: {missing}")

        # Company export: also include ALL files in the company directory (not just referenced ones)
        if export_type == "company" and company:
            company_dir = self._safe_rel(company)
            if company_dir.exists() and company_dir.is_dir():
                all_files = [f for f in company_dir.rglob("*") if f.is_file() and not f.name.endswith(".ini")]
                for f in all_files:
                    rel = f.relative_to(company_dir).as_posix()
                    if rel not in audio_files:
                        audio_files.add(rel)
                print(f"[export] company scan: {len(audio_files)} total files (including {len(all_files)} from dir scan)")

        # Build zip — use ZipInfo with explicit UTF-8 flag for Chinese paths
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
            for rel_path, content in ini_contents.items():
                zinfo = zipfile.ZipInfo(rel_path)
                # Flag bit 11 = UTF-8 filename, required for non-ASCII characters
                zinfo.flag_bits |= 0x800
                zf.writestr(zinfo, content)
            AUDIO_EXT = [".wav", ".mp3", ".m4a", ".WAV", ".MP3", ".M4A"]
            for fname in sorted(audio_files):
                arcname = (company + "/" + fname) if company else fname
                fp = self._safe_rel(company + "/" + fname if company else fname)
                found = None
                if fp.exists() and fp.is_file():
                    found = fp
                else:
                    # Try with audio extensions (for implicit station-name files)
                    for ext in AUDIO_EXT:
                        fp_ext = self._safe_rel((company + "/" + fname + ext) if company else (fname + ext))
                        if fp_ext.exists() and fp_ext.is_file():
                            found = fp_ext
                            arcname = (company + "/" + fname + ext) if company else (fname + ext)
                            break
                    if not found:
                        # Try without company prefix
                        fp2 = self.data_root / fname
                        if fp2.exists() and fp2.is_file():
                            found = fp2
                        else:
                            for ext in AUDIO_EXT:
                                fp2_ext = self.data_root / (fname + ext)
                                if fp2_ext.exists() and fp2_ext.is_file():
                                    found = fp2_ext
                                    arcname = fname + ext
                                    break
                if found:
                    zinfo = zipfile.ZipInfo(arcname)
                    zinfo.flag_bits |= 0x800
                    with open(found, "rb") as af:
                        zf.writestr(zinfo, af.read())

        zip_data = buf.getvalue()
        print(f"[export] zip len={len(zip_data)}, magic={zip_data[:4].hex()}, ini_files={list(ini_contents.keys())}, audio_files={sorted(audio_files)}")
        fname = (rel_paths[0].split("/")[0] if company else "export") + ".tabl"
        # RFC 5987: encode non-ASCII filename for Content-Disposition header (HTTP headers are latin-1)
        from urllib.parse import quote
        safe_fname = quote(fname, safe='')
        self.send_response(200)
        self.send_header("Content-Type", "application/zip")
        self.send_header("Content-Disposition", f"attachment; filename*=UTF-8''{safe_fname}")
        self.send_header("Content-Length", str(len(zip_data)))
        self.end_headers()
        self.wfile.write(zip_data)

    # Session cache for import: { sessionId: { zip_data, target_company } }
    _import_sessions = {}

    def _api_import(self):
        """Import a .tabl file. Two-phase: 1) upload + preview, 2) confirm with sessionId."""
        content_type = self.headers.get("Content-Type", "")

        # Phase 2: confirm with JSON (sessionId + options)
        if "application/json" in content_type:
            length = int(self.headers.get("Content-Length", "0"))
            body = self.rfile.read(length) if length > 0 else b"{}"
            data = json.loads(body.decode("utf-8") or "{}")
            session_id = data.get("sessionId", "")
            target_company = data.get("company", "")
            conflict_mode = data.get("conflictMode", "skip")
            session = self._import_sessions.pop(session_id, None)
            if not session:
                self._send_json(400, {"ok": False, "error": "会话已过期，请重新导入"})
                return
            zip_data = session["zip_data"]
            zip_company = session["zip_company"]
            if target_company == "__new__":
                target_company = zip_company
            if not target_company:
                self._send_json(400, {"ok": False, "error": "未指定目标公司"})
                return
            return self._do_import_zip(zip_data, target_company, conflict_mode, zip_company)

        # Phase 1: upload multipart file, return preview
        if "multipart/form-data" not in content_type:
            self._send_json(400, {"ok": False, "error": "需要 multipart/form-data"})
            return
        content_length = int(self.headers.get("Content-Length", "0"))
        body = self.rfile.read(content_length)

        # Extract boundary
        boundary = None
        for part in content_type.split(";"):
            part = part.strip()
            if part.startswith("boundary="):
                boundary = part[len("boundary="):].strip('"')
                break
        if not boundary:
            self._send_json(400, {"ok": False, "error": "缺少 boundary"})
            return
        boundary_bytes = boundary.encode("utf-8")

        # Parse multipart parts using same reliable approach as _api_upload
        parts = body.split(b"--" + boundary_bytes)
        print(f"[import] parsed {len(parts)} multipart sections, boundary={boundary}")
        print(f"[import] raw body len={len(body)}, first 200 bytes hex={body[:200].hex()}")

        zip_data = None
        target_company = ""

        for i, part_bytes in enumerate(parts):
            print(f"[import] --- part {i}: len={len(part_bytes)} ---")
            if not part_bytes:
                print(f"[import] part {i}: empty, skip")
                continue
            if part_bytes == b"--\r\n" or part_bytes == b"--":
                print(f"[import] part {i}: closing delimiter, skip")
                continue
            # Show raw preview of this part
            print(f"[import] part {i} raw preview (first 300 bytes): {part_bytes[:300].hex()}")
            header_end = part_bytes.find(b"\r\n\r\n")
            if header_end < 0:
                print(f"[import] part {i}: no \\r\\n\\r\\n header terminator found, skip")
                continue
            headers_raw = part_bytes[:header_end].decode("utf-8", errors="replace")
            file_data = part_bytes[header_end + 4:]
            print(f"[import] part {i} headers: {headers_raw}")
            # Strip trailing \r\n (part terminator before next boundary)
            if file_data.endswith(b"\r\n"):
                file_data = file_data[:-2]
                print(f"[import] part {i}: stripped trailing \\r\\n")
            elif file_data.endswith(b"\r") or file_data.endswith(b"\n"):
                print(f"[import] part {i}: WARN trailing byte = {file_data[-1:].hex()}")

            if 'name="company"' in headers_raw:
                target_company = file_data.decode("utf-8", errors="replace").strip()
                print(f"[import] part {i}: identified as company={target_company}")
            elif 'filename="' in headers_raw:
                import re
                fn_match = re.search(r'filename="([^"]*)"', headers_raw)
                fn = fn_match.group(1) if fn_match else "?"
                print(f"[import] part {i}: identified as file: {fn}, data_len={len(file_data)}")
                print(f"[import] part {i}: file data first 200 bytes hex={file_data[:200].hex()}")
                if len(file_data) < 500:
                    print(f"[import] part {i}: file data FULL AS STRING: {file_data.decode('utf-8', errors='replace')}")
                if not file_data:
                    print("[import] WARN: empty file_data")
                    continue
                zip_data = file_data

        if not zip_data:
            print("[import] ERROR: no file part found in multipart body")
            self._send_json(400, {"ok": False, "error": "未在请求中找到文件"})
            return

        print(f"[import] extracted zip_data len={len(zip_data)}, magic={zip_data[:4].hex()}, company={target_company}")
        print(f"[import] zip_data first 20 bytes hex={zip_data[:20].hex()}")

        try:
            with zipfile.ZipFile(io.BytesIO(zip_data), "r") as zf:
                ini_files = []
                media_files = []
                for name in zf.namelist():
                    if name.endswith("/"): continue
                    safe_name = name.replace("\\", "/").lstrip("/")
                    if safe_name.endswith(".ini"): ini_files.append(safe_name)
                    else: media_files.append(safe_name)

                zip_company = ini_files[0].split("/")[0] if ini_files else ""
                preview_lines = []
                index_path = self.data_root / "index.json"
                existing_index = {"companies": []}
                if index_path.exists():
                    try: existing_index = json.loads(index_path.read_text(encoding="utf-8-sig"))
                    except Exception: pass
                companies = existing_index.get("companies", [])
                target = next((c for c in companies if c["name"] == target_company), None)
                for ini_rel in ini_files:
                    line_name = ini_rel.split("/")[-1].replace(".ini", "")
                    # Compute destination path (same logic as _do_import_zip)
                    if ini_rel.startswith(zip_company + "/"):
                        dest_path = target_company + "/" + ini_rel[len(zip_company) + 1:]
                    elif "/" not in ini_rel:
                        dest_path = target_company + "/" + ini_rel
                    else:
                        dest_path = ini_rel  # fallback
                    existing_matches = [l for l in (target["lines"] if target else []) if l["file"] == dest_path]
                    preview_lines.append({
                        "name": line_name,
                        "exists": len(existing_matches) > 0,
                        "sameVersion": len(existing_matches) > 0,
                        "existingVersion": existing_matches[0].get("version", "") if existing_matches else "",
                    })

                # Cache for phase 2
                import uuid
                session_id = str(uuid.uuid4())[:8]
                self._import_sessions[session_id] = {"zip_data": zip_data, "zip_company": zip_company}
                self._send_json(200, {
                    "ok": True, "preview": True, "sessionId": session_id,
                    "lines": preview_lines,
                    "conflicts": [l for l in preview_lines if l["exists"]],
                    "newLines": [l for l in preview_lines if not l["exists"]],
                    "mediaCount": len(media_files), "iniCount": len(ini_files),
                    "zipCompany": zip_company,
                })
        except zipfile.BadZipFile:
            self._send_json(400, {"ok": False, "error": "无效的 zip 文件"})

    def _do_import_zip(self, zip_data, target_company, conflict_mode, zip_company=""):
        """Execute import of previously uploaded zip data.
        Rewrites the company prefix in zip paths to target_company."""
        try:
            with zipfile.ZipFile(io.BytesIO(zip_data), "r") as zf:
                imported_ini = []
                all_names = zf.namelist()
                print(f"[import] zip contains {len(all_names)} entries: {all_names}")
                for name in all_names:
                    if name.endswith("/"):
                        continue
                    safe_name = name.replace("\\", "/").lstrip("/")
                    # Replace the original company prefix with target company
                    parts = safe_name.split("/", 1)
                    if len(parts) > 1 and parts[0] == zip_company:
                        safe_name = target_company + "/" + parts[1]
                    elif "/" not in safe_name:
                        # File at root level — place under target company
                        safe_name = target_company + "/" + safe_name
                    print(f"[import] writing: {name} -> {safe_name}")
                    try:
                        dest = self._safe_rel(safe_name)
                        self._validate_leaf_name(dest.name)
                        if safe_name.endswith(".ini") and conflict_mode == "skip" and dest.exists():
                            print(f"[import] skip existing: {safe_name}")
                            continue
                        dest.parent.mkdir(parents=True, exist_ok=True)
                        content = zf.read(name)
                        print(f"[import] writing {len(content)} bytes to {dest}")
                        dest.write_bytes(content)
                        if safe_name.endswith(".ini"):
                            imported_ini.append(safe_name)
                    except Exception as fe:
                        print(f"[import] ERROR writing {safe_name}: {fe}")
                        raise

            if imported_ini:
                try:
                    index_path = self.data_root / "index.json"
                    existing_index = {"companies": []}
                    if index_path.exists():
                        try: existing_index = json.loads(index_path.read_text(encoding="utf-8-sig"))
                        except Exception: pass
                    companies = existing_index.get("companies", [])
                    target = next((c for c in companies if c["name"] == target_company), None)
                    if not target:
                        target = {"name": target_company, "lines": []}
                        companies.append(target)
                    for ini_rel in imported_ini:
                        line_name = ini_rel.split("/")[-1].replace(".ini", "")
                        target["lines"] = [l for l in target["lines"] if l["file"] != ini_rel]
                        target["lines"].append({"name": line_name, "file": ini_rel})
                    target["lines"].sort(key=lambda x: x["name"])
                    existing_index["companies"] = sorted(companies, key=lambda c: c["name"])
                    index_path.write_text(json.dumps(existing_index, ensure_ascii=False, indent=4), encoding="utf-8")
                    print(f"[import] index updated: company={target_company}, imported={imported_ini}")
                except Exception as e:
                    print(f"[import] index update error: {e}")
                    import traceback
                    traceback.print_exc()

            self._send_json(200, {"ok": True, "imported": imported_ini, "company": target_company})
        except zipfile.BadZipFile:
            self._send_json(400, {"ok": False, "error": "无效的 zip 文件"})
        except Exception as e:
            print(f"[import] FATAL in _do_import_zip: {e}")
            import traceback
            traceback.print_exc()
            self._send_json(500, {"ok": False, "error": str(e)})

    @staticmethod
    def _collect_line_files(text):
        """Parse INI text and collect all file references — including implicit station-name audio."""
        import re
        files = set()

        def is_file_token(tok):
            tok = tok.strip().strip('[]"').strip()
            if not tok:
                return None
            if tok.startswith("{") or tok.startswith("【"):
                return None
            return tok

        # 1. Quoted file references (covers rules, templates, tips, quoted station audio)
        for match in re.finditer(r'"([^"]+)"', text):
            fname = is_file_token(match.group(1))
            if fname:
                files.add(fname)

        # 2. Unquoted file references on known keys (station audio, rules, templates, tips)
        for match in re.finditer(r'(?:本站中文语音文件|本站英文语音文件|预报规则|到站规则|语音文件|上行首站预报规则|下行首站预报规则|默认上行预报规则|默认上行到站播报规则|默认下行预报规则|默认下行到站播报规则|上行终点站预报规则|上行终点站报站规则|下行终点站预报规则|下行终点站报站规则)=(.+)', text):
            val = match.group(1).strip()
            if not val:
                continue
            tokens = re.split(r'\]\[|><|>', val)
            for tok in tokens:
                fname = is_file_token(tok)
                if fname:
                    files.add(fname)

        # 3. Implicit same-name station audio
        # Rules may reference the current station's name via various params:
        #   新格式: 【本站中文】/【本站英文】
        #   旧格式: {本站}/{本站中文}/{本站英文}
        # When such a param is used and a station has no explicit audio file,
        # the station name itself is the default audio file reference.
        has_zh_ref = ('【本站中文】' in text or '{本站}' in text or '{本站中文}' in text)
        has_en_ref = ('【本站英文】' in text or '{本站英文}' in text)
        if has_zh_ref or has_en_ref:
            # Parse station names from stop lists
            def parse_stop_list(section_label, text):
                """Extract station names from a labeled stop list. Returns list of (name, stopIdx)."""
                names = []
                pattern = rf'{re.escape(section_label)}：?\s*((?:stop_\d+:.*\n?)*)'
                m = re.search(pattern, text)
                if not m:
                    return names
                block = m.group(1)
                for sm in re.finditer(r'stop_(\d+):(.*)', block):
                    idx = int(sm.group(1))
                    name = sm.group(2).strip()
                    if name:
                        names.append((idx, name))
                return names

            up_cn_names = parse_stop_list('上行中文站名', text)
            down_cn_names = parse_stop_list('下行中文站名', text)
            up_en_names = parse_stop_list('上行英文站名', text)
            down_en_names = parse_stop_list('下行英文站名', text)

            # Parse which stops have explicit audio set (to avoid adding implicit for them)
            explicit_zh = set()  # stop indices (from ####StopN： section) that have zh audio
            explicit_en = set()
            for sm in re.finditer(r'####Stop(\d+)：\s*\n(.*?)(?=\n####|\n###|\Z)', text, re.DOTALL):
                stop_idx = int(sm.group(1))
                block = sm.group(2)
                zh_val = re.search(r'本站中文语音文件=(.*)', block)
                if zh_val and zh_val.group(1).strip():
                    explicit_zh.add(stop_idx)
                en_val = re.search(r'本站英文语音文件=(.*)', block)
                if en_val and en_val.group(1).strip():
                    explicit_en.add(stop_idx)

            if has_zh_ref:
                for idx, name in up_cn_names:
                    if idx not in explicit_zh:
                        files.add(name)
                for idx, name in down_cn_names:
                    if idx not in explicit_zh:
                        files.add(name)

            if has_en_ref:
                for idx, name in up_en_names:
                    if idx not in explicit_en:
                        files.add(name)
                for idx, name in down_en_names:
                    if idx not in explicit_en:
                        files.add(name)

        return list(files)

    # ── Update API ────────────────────────────────────────────

    def _api_check_update(self):
        """GET /api/check_update — check Gitee for an update matching edition + OS.

        Query param ?force=1 enables "simulated upgrade": always report the newest
        release even if it is not newer than local.
        """
        try:
            import urllib.parse
            import updater
            qs = urllib.parse.urlparse(self.path).query
            force = "force" in [p.split("=")[0] for p in qs.split("&") if p]
            info = updater.check_gitee_update(self.root_dir, force=force)
            self._send_json(200, info)
        except Exception as e:
            self._send_json(200, {  # 200 even on error — don't block the UI
                "update_available": False,
                "error": str(e),
                "local_version": "unknown",
                "local_build": "0",
                "changelog": [],
                "download_url": "",
            })

    def _api_update_progress(self):
        """GET /api/update_progress — return the in-flight installer download progress."""
        try:
            import updater
            self._send_json(200, updater.get_download_state())
        except Exception as e:
            self._send_json(200, {"active": False, "done": True, "error": str(e)})

    def _api_update(self):
        """POST /api/update — download the matching installer and launch it (background thread)."""
        import tempfile
        import threading
        from pathlib import Path as _Path

        # Read optional {url, installer_name} from request body.
        url = ""
        installer_name = "TABBSS-Setup.exe"
        try:
            length = int(self.headers.get("Content-Length", "0"))
            body = self.rfile.read(length) if length > 0 else b"{}"
            data = json.loads(body.decode("utf-8") or "{}")
            url = data.get("url", "")
            installer_name = data.get("installer_name", installer_name)
        except Exception:
            pass

        if not url:
            try:
                import updater
                info = updater.check_gitee_update(self.root_dir)
                url = info.get("download_url", "")
                installer_name = info.get("installer_name", installer_name)
            except Exception:
                url = ""

        if not url:
            self._send_json(400, {"ok": False, "error": "无可用下载地址"})
            return

        def _download_and_launch():
            try:
                import os as _os
                import updater
                dest = _Path(tempfile.gettempdir()) / installer_name
                if updater.download_file(url, dest):
                    updater.launch_installer(dest, detached=True)
                    # Close the app so the NSIS installer runs without the "running app" prompt.
                    _os._exit(0)
            except Exception as e:
                print(f"[update] download/launch failed: {e}")

        # Run download+launch in a background thread so the request returns immediately.
        # (Do NOT spawn `sys.executable updater.py` — in the frozen app sys.executable is
        # the app exe itself, which would just start a second app instance.)
        try:
            threading.Thread(target=_download_and_launch, daemon=True, name='tabbss-updater').start()
            self._send_json(200, {"ok": True, "status": "launching", "installer": installer_name})
        except Exception as e:
            self._send_json(500, {"ok": False, "error": str(e)})


def create_server(host='127.0.0.1', port=8940, root='.', data_root='报站线路文件库'):
    """Create and configure a TABBSS HTTP server. Returns httpd (not started).

    This function is the programmatic API — used by both main.py (desktop app)
    and the CLI entry point below.  Call httpd.serve_forever() to start.
    """
    LocalHandler.root_dir = Path(root).resolve()
    # If data_root is already absolute, use it directly; otherwise join with root
    dr = Path(data_root)
    if dr.is_absolute():
        LocalHandler.data_root = dr.resolve()
    else:
        LocalHandler.data_root = (LocalHandler.root_dir / dr).resolve()

    httpd = ThreadingHTTPServer((host, port), LocalHandler)
    print(f"项目目录: {LocalHandler.root_dir}")
    print(f"数据目录: {LocalHandler.data_root}")
    print(f"服务地址: http://{host}:{port}/web/")
    return httpd


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8940)
    parser.add_argument("--root", default=".")
    parser.add_argument("--data-root", default="报站线路文件库")
    args = parser.parse_args()

    httpd = create_server(args.host, args.port, args.root, args.data_root)
    httpd.serve_forever()


if __name__ == "__main__":
    main()
