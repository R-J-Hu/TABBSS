#!/usr/bin/env python3
import sys
from pathlib import Path

# -- Determine app directory NOW, before any 3rd-party imports ---------
def _is_frozen():
    return getattr(sys, 'frozen', False) and hasattr(sys, '_MEIPASS')

if _is_frozen():
    _APP_DIR = Path(sys.executable).parent
    _RES_DIR = Path(sys._MEIPASS)
else:
    _APP_DIR = Path(__file__).resolve().parent
    _RES_DIR = _APP_DIR

# -- Open log file IMMEDIATELY, before any other import -----------------
# Program Files is not writable without admin; use LOCALAPPDATA instead.
import os
_LOG_DIR = Path(os.environ.get('LOCALAPPDATA', str(Path.home() / 'AppData' / 'Local'))) / 'TABBSS'
_LOG_DIR.mkdir(parents=True, exist_ok=True)
_LOG_PATH = _LOG_DIR / 'tabbss_startup.log'
try:
    sys.stdout = open(str(_LOG_PATH), 'w', encoding='utf-8', buffering=1)
    sys.stderr = sys.stdout
    print('LOG START')
except Exception as e:
    # Last resort: redirect to nul and try to show error
    sys.stdout = open('nul' if sys.platform == 'win32' else '/dev/null', 'w')
    sys.stderr = sys.stdout
    # Can't print anything useful here - just move on

print('APP_DIR=' + str(_APP_DIR))
print('FROZEN=' + str(_is_frozen()))

# -- Now safe to import everything else ---------------------------------
try:
    import threading
    import time
    import urllib.request
    print('stdlib imports OK')
except Exception as e:
    print('stdlib import FAILED: ' + str(e))
    sys.exit(1)

try:
    import webview
    print('webview import OK')
    print('webview version: ' + str(getattr(webview, '__version__', 'unknown')))
except Exception as e:
    print('webview import FAILED: ' + str(e))
    # Continue anyway - we can still start the server without GUI
    webview = None


def _safe(s):
    return str(s).encode('ascii', errors='replace').decode('ascii')


# -- Start HTTP server in background thread ---------------------------
_HTTPD = None


def _start_server(host, port, root, data_root):
    global _HTTPD
    scripts_dir = str(Path(root) / 'scripts')
    if scripts_dir not in sys.path:
        sys.path.insert(0, scripts_dir)
    from local_server import create_server
    _HTTPD = create_server(host, port, root, data_root)
    _HTTPD.serve_forever()


# -- Main entry -------------------------------------------------------
def _port_has_listener(port):
    """Check if a process is already listening on the given port."""
    import socket as _sk
    try:
        s = _sk.socket(_sk.AF_INET, _sk.SOCK_STREAM)
        s.settimeout(0.5)
        result = s.connect_ex(('127.0.0.1', port))
        s.close()
        return result == 0
    except Exception:
        return False


def _kill_old_server(port):
    """Kill any process listening on the given port."""
    try:
        import subprocess as _sp
        _CF = _sp.CREATE_NO_WINDOW if sys.platform == 'win32' else 0
        if sys.platform == 'win32':
            r = _sp.run(['netstat', '-ano'], capture_output=True, text=True,
                        timeout=10, creationflags=_CF)
            for line in r.stdout.splitlines():
                if f':{port}' in line and 'LISTENING' in line:
                    parts = line.strip().split()
                    pid = parts[-1]
                    if pid.isdigit() and pid != str(os.getpid()):
                        print(f'Killing old server on port {port} (PID {pid})')
                        _sp.run(['taskkill', '/F', '/PID', pid],
                                capture_output=True, timeout=10, creationflags=_CF)
                        time.sleep(0.5)
                        return True
    except Exception as e:
        print(f'Port kill attempt failed: {e}')
    return False


def main():
    import urllib.request as _ur
    import json as _json
    import shutil as _shutil

    HOST = '127.0.0.1'
    PORT = 8940
    ROOT = str(_RES_DIR)
    DATA_ROOT = str((_APP_DIR / '报站线路文件库').resolve())

    # Merge staged installer data before the HTTP server can observe it.
    merge_error = None
    try:
        _scripts_dir = str(Path(_RES_DIR) / 'scripts')
        if _scripts_dir not in sys.path:
            sys.path.insert(0, _scripts_dir)
        import updater
        _merge = updater.merge_update_lines(Path(_APP_DIR), Path(DATA_ROOT))
        if _merge.get('merged'):
            print('Merged update lines: ' + str(_merge['merged']))
    except Exception as e:
        merge_error = e
        print('Merge update lines skipped: ' + str(e))

    # The NSIS installer uses this mode to finish its data transaction without
    # opening the application window. A non-zero exit leaves staging intact so
    # the next launch can retry; no existing user file is removed.
    if '--merge-update-only' in sys.argv[1:]:
        if merge_error is not None:
            raise SystemExit(2)
        return

    # Parse --open-tabl argument for file association
    pending_tabl = None
    args = sys.argv[1:] if len(sys.argv) > 1 else []
    for i, arg in enumerate(args):
        if arg == '--open-tabl' and i + 1 < len(args):
            src = Path(args[i + 1])
            if src.exists() and src.suffix.lower() == '.tabl':
                incoming = Path(DATA_ROOT) / '.incoming'
                incoming.mkdir(parents=True, exist_ok=True)
                dest = incoming / src.name
                _shutil.copy2(str(src), str(dest))
                pending_tabl = str(dest)
                print(f'Pending import: {src} → {dest}')
            break

    # If launched with a .tabl file and the app is already running,
    # write pending import flag, notify the existing server, and exit.
    if pending_tabl and _port_has_listener(PORT):
        flag = Path(DATA_ROOT) / '.pending_import'
        flag.write_text(_json.dumps({
            'file': pending_tabl,
            'name': Path(pending_tabl).name,
        }), encoding='utf-8')
        print('App already running — pending import flag written, exiting')
        sys.exit(0)

    print('DATA_ROOT=' + _safe(DATA_ROOT))

    dr = Path(DATA_ROOT)
    print('DataDirExists=' + str(dr.exists()))
    if dr.exists():
        idx = dr / 'index.json'
        print('IndexExists=' + str(idx.exists()))
        if not idx.exists():
            items = list(dr.iterdir())[:30]
            print('DataContents: ' + str([i.name for i in items]))
    else:
        print('ERROR: Data dir missing')
        parent = dr.parent
        print('ParentExists=' + str(parent.exists()))
        if parent.exists():
            print('ParentContents: ' + str([i.name for i in list(parent.iterdir())[:30]]))

    # Write pending import flag for the server/frontend
    if pending_tabl:
        import json as _json
        flag = Path(DATA_ROOT) / '.pending_import'
        flag.write_text(_json.dumps({
            'file': pending_tabl,
            'name': Path(pending_tabl).name,
        }), encoding='utf-8')
        print('Pending import flag written')

    # Kill any old/stale server on our port (e.g. other edition left running)
    _kill_old_server(PORT)

    server_thread = threading.Thread(
        target=_start_server, args=(HOST, PORT, ROOT, DATA_ROOT),
        daemon=True, name='tabbss-server')
    server_thread.start()

    url = 'http://{}:{}/web/'.format(HOST, PORT)
    # Verify our server is serving from OUR root, not an old one
    our_token = str(ROOT)[-20:]  # last 20 chars of our resource path as fingerprint
    for i in range(50):
        try:
            resp = urllib.request.urlopen(url, timeout=0.5)
            # Quick check: read a tiny bit to confirm it's fresh
            _ = resp.read(256)
            break
        except Exception:
            time.sleep(0.1)
    else:
        print('ERROR: Server did not start')
        sys.exit(1)

    print('ServerReady: ' + url)

    if webview is None:
        print('ERROR: webview not available, exiting')
        sys.exit(1)

    window = webview.create_window(
        title='档案库报站模拟器 V1.6', url=url,
        width=1280, height=800, min_size=(900, 600), text_select=True)
    webview.settings['ALLOW_DOWNLOADS'] = True  # enable .tabl export downloads
    webview.start()

    # Clean shutdown: stop the HTTP server so the PyInstaller onefile temp dir can be removed.
    if _HTTPD is not None:
        try:
            _HTTPD.shutdown()
            _HTTPD.server_close()
        except Exception:
            pass
    print('Done.')


if __name__ == '__main__':
    main()
