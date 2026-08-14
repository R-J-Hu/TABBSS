# 档案库报站模拟器（TABBSS）

公交报站模拟与线路数据管理桌面应用。
【该Readme在发布时会再行更新。预计发布时间：8月底】

## 功能

- **报站模拟**：加载公交线路 INI 数据，模拟预报、到站、终点站等全流程语音播报
- **线路编辑器**：可视化三级编辑（公司 → 线路 → 站点），支持新建、导入、导出、拖拽排序
- **海峡报站器兼容模式**：直接读取并播放三方报站器格式线路
- **TABL 文件关联**：双击 `.tabl` 文件自动导入线路数据

## 技术栈

- **前端**：Vanilla JS SPA（无框架），WebView2 桌面窗口
- **后端**：Python HTTP Server（local_server.py），REST API
- **打包**：PyInstaller 单文件 + NSIS Windows 安装程序
- **版本**：V1.6

## 快速开始

### 开发环境

```bash
pip install pywebview
python main.py
```

浏览器访问 `http://127.0.0.1:8940/web/`

### 发布打包

```bash
python RELEASE
```

交互式 TUI 选择线路范围和目标系统，自动生成安装程序。

## 项目结构

```
web/                 前端 SPA（HTML/CSS/JS）
scripts/             服务端脚本（local_server.py, build_release.py, convert_ini.py）
main.py              pywebview 桌面入口
RELEASE              交互式打包 TUI
tabbss.spec          PyInstaller 配置
icon/                应用图标
```

## 线路数据

线路数据（`报站线路文件库/`）和兼容线路（`兼容模式-海峡报站器文件库/`）不包含在本仓库中。线路数据通过 TABL 文件分发或由用户自行添加。

## License

本项目仅供学习交流使用。

---

**项目维护**：[@爱困的RJ（R.J. Hu）](https://space.bilibili.com/3546768098724617)
