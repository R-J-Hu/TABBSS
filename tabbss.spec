# -*- mode: python ; coding: utf-8 -*-
"""
PyInstaller spec for TABBSS — 档案库报站模拟器

Usage:
    pyinstaller tabbss.spec              # 默认打包
    pyinstaller --distpath ./dist tabbss.spec  # 指定输出目录

On Windows this produces a single TABBSS.exe (--onefile + --windowed).
On macOS it produces TABBSS.app.
"""

import sys
import importlib.util
from pathlib import Path
from PyInstaller.utils.hooks import collect_all, collect_dynamic_libs

# ── 需要打包的数据文件 ──────────────────────────────────────────
_here = Path('.').resolve()

datas = [
    ('web', 'web'),
    ('scripts', 'scripts'),
    ('VERSION', '.'),
    ('port.txt', '.'),
    ('web/funct.json', 'web'),
    ('LICENSE', '.'),
]

# ⚠️ 数据目录（报站线路文件库/、兼容模式-海峡报站器文件库/）不打包进 .exe
# 它们放在 .exe 同级目录，由安装程序附带或用户自行放置。
# main.py 通过 _APP_DIR (sys.executable.parent) 自动定位。

# ── 隐藏导入（PyInstaller 可能检测不到的模块）──────────────────
hiddenimports = [
    'local_server',       # 在 main.py 中动态 import
    'http.server',        # local_server 使用
    'json',
    'pathlib',
    'zipfile',
    'argparse',
    'posixpath',
    'urllib.parse',
    # pywebview Windows edgechromium 后端依赖 pythonnet(clr) + cffi
    # （后端由 webview 动态加载，PyInstaller 静态分析追踪不到 → 运行时缺 _cffi_backend 崩溃）
    'clr',
    'clr_loader',
    'pythonnet',
    '_cffi_backend',
]

# 收集 pythonnet / clr_loader / cffi 的原生库与子模块
binaries = []
for _pkg in ('clr_loader', 'pythonnet', 'cffi'):
    _d, _b, _h = collect_all(_pkg)
    binaries += _b
    hiddenimports += _h

# _cffi_backend 是顶层 C 扩展（.pyd），collect_dynamic_libs 对非 package 无效，
# 需显式定位其文件路径并作为 binary 打入 bundle（否则运行时 import _cffi_backend 崩溃）
_cffi_spec = importlib.util.find_spec('_cffi_backend')
if _cffi_spec and _cffi_spec.origin:
    binaries.append((_cffi_spec.origin, '.'))

# ── Analysis ───────────────────────────────────────────────────
a = Analysis(
    ['main.py'],
    pathex=[],
    binaries=binaries,
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
)

# ── 单文件打包 ─────────────────────────────────────────────────
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    [],
    name='TABBSS',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=False,          # --windowed: 不弹出控制台窗口
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    icon='icon/TABBSS.ico',              # Windows .exe icon
)

# ── macOS .app Bundle ───────────────────────────────────────────
# Only built when running PyInstaller on macOS.
# Uses .icns icon if available, falls back to .ico (PyInstaller converts on macOS).
import sys as _sys
if _sys.platform == 'darwin':
    _icon_path = 'icon/TABBSS.icns'
    if not Path(_icon_path).exists():
        # Fallback: PyInstaller on macOS can read .ico for BUNDLE too
        _icon_path = 'icon/TABBSS.ico'

    app = BUNDLE(
        exe,
        name='TABBSS.app',  # replaced at build time for edition variants
        icon=_icon_path,
        bundle_identifier='com.tabbss.archive-simulator',
        info_plist={
            'CFBundleName': '档案库报站模拟器',
            'CFBundleDisplayName': '档案库报站模拟器',
            'CFBundleShortVersionString': '1.6.0',
            'CFBundleVersion': '1.6.0',
            'NSHighResolutionCapable': True,
            'NSRequiresAquaSystemAppearance': False,
            'LSMinimumSystemVersion': '10.15',
        },
    )
