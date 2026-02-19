# Copilot Instructions for ComfyCarry

## 项目概述

全栈 ComfyUI 云端部署管理平台，面向 RunPod / Vast.ai GPU 实例。提供 Web Dashboard 统一管理 ComfyUI 服务、模型、插件、Tunnel、云同步、JupyterLab 等。

## 架构 (v3.0 — 模块化)

### 后端 (Flask — `comfycarry/` 包)

| 文件 | 角色 |
|------|------|
| **bootstrap.sh** | 最小化入口脚本 — 安装 Python 3.13 / Node.js / PM2 / Cloudflared，下载 Dashboard 文件，启动 PM2 进程 |
| **workspace_manager.py** | 入口文件 — 调用 `comfycarry.app.main()` |
| **comfycarry/app.py** | Flask App 工厂 + `main()` 启动逻辑 |
| **comfycarry/config.py** | 全局配置 (路径常量、持久化配置读写) |
| **comfycarry/auth.py** | 认证中间件 (Flask session + 密码、before_request 拦截) |
| **comfycarry/utils.py** | 工具函数 (_run_cmd 等) |
| **comfycarry/routes/** | 路由蓝图 — system, comfyui, models, plugins, tunnel, sync, jupyter, settings, setup, frontend |
| **comfycarry/services/** | 业务服务 — comfyui_bridge (WS→SSE), comfyui_params (启动参数), deploy_engine (部署引擎), sync_engine (同步引擎) |
| **comfycarry_ws_broadcast/** | ComfyUI 自定义节点 — 实时进度广播 (安装到 ComfyUI custom_nodes 中) |

### 前端 (ES Module SPA)

| 文件 | 角色 |
|------|------|
| **dashboard.html** | HTML + CSS (≈3080 行) — SPA 布局、深色主题、支持 4K |
| **static/js/main.js** | 前端入口 — 导入所有页面模块，初始化路由 |
| **static/js/core.js** | 核心模块 — 页面路由 (`showPage`/`registerPage`)、Toast、剪贴板、图片预览、API Key、全局快捷键 |
| **static/js/page-dashboard.js** | Dashboard 概览页 (系统监控 + 服务状态 + ComfyUI 实时进度) |
| **static/js/page-models.js** | 模型管理页 (本地模型 + CivitAI 搜索 + 下载) |
| **static/js/page-comfyui.js** | ComfyUI 页 (启动参数 + 实时日志/SSE + 队列/历史 + 进度) |
| **static/js/page-plugins.js** | 插件页 (浏览/安装/卸载/更新，代理 ComfyUI-Manager) |
| **static/js/page-tunnel.js** | Tunnel 页 (Cloudflare Tunnel 状态 + 服务链接) |
| **static/js/page-jupyter.js** | JupyterLab 页 (启动/停止/状态/URL + 内核管理) |
| **static/js/page-sync.js** | Cloud Sync 页 (Rclone 配置 + Sync v2 规则引擎 + 实时日志) |
| **static/js/page-settings.js** | 设置页 (密码、CivitAI Key、Debug、配置导入/导出、重新初始化) |
| **setup_wizard.html** | 首次部署向导页 (≈680 行) — 密码、Tunnel、Rclone、CivitAI、插件选择 |
| **dashboard.js** | **已废弃** — 旧版单文件前端 JS，保留但不再被 HTML 引用 |

### 已废弃文件 (在 .gitignore 中)
- `deploy.sh` / `deploy-prebuilt.sh` — 旧版 Bash 部署脚本，功能已迁移至 `deploy_engine.py`
- `auto_generate_csv.py` / `civicomfy_batch_downloader.py` / `civitai_lookup.py` — 旧版独立工具
- `dashboard.js` — 旧版单文件前端 JS (3170 行)，功能已迁移至 `static/js/` 模块

## 部署流程

1. 用户在 Vast.ai / RunPod 创建实例，运行 `bootstrap.sh`
2. bootstrap 安装最小依赖，下载 Dashboard 文件（含 `comfycarry/`、`static/`、`comfycarry_ws_broadcast/`），启动 PM2 `dashboard` 进程 (端口 5000)
3. 用户访问 Dashboard，首次进入 Setup Wizard (`setup_wizard.html`)
4. 用户配置 → 点击部署 → `deploy_engine.py` 的 `_run_deploy()` 在后台线程执行安装逻辑 (日志通过 SSE 实时推送)
5. 部署完成后自动跳转到 Dashboard 主界面

## 服务管理

- **PM2 进程**: `dashboard` (Flask 5000), `comfy` (ComfyUI 8188), `tunnel` (Cloudflare), `sync` (云同步)
- **ComfyUI WebSocket 桥接**: `ComfyWSBridge` 类维持到 ComfyUI 的 WS 连接，通过 SSE `/api/comfyui/events` 向前端广播实时状态
- **插件管理**: 代理 ComfyUI-Manager 的 REST API 端点

## Dashboard 页面结构

| 页面 | 功能 |
|------|------|
| Dashboard | 系统监控 (CPU/GPU/内存/磁盘)、PM2 服务状态、ComfyUI 实时进度 |
| Models | 本地模型管理 + CivitAI 搜索 + Enhanced-Civicomfy 下载 |
| Plugins | 插件浏览/安装/卸载/更新 (代理 ComfyUI-Manager) |
| ComfyUI | 启动参数管理 + 实时日志/事件 (WS→SSE) + 队列/历史 |
| Tunnel | Cloudflare Tunnel 状态、Ingress 解析、服务链接 |
| JupyterLab | JupyterLab 启动/停止、Token/URL、内核/Session/Terminal 管理 |
| Cloud Sync | Rclone 配置编辑、OneDrive/Google Drive/R2 同步偏好、实时日志 |
| Settings | 密码管理、CivitAI Key、Debug 模式、Dashboard 重启 |

## 关键配置文件 (运行时)

| 路径 | 用途 |
|------|------|
| `/workspace/.dashboard_env` | Dashboard 持久化配置 (密码、session secret、debug 等) |
| `/workspace/.setup_state.json` | Setup Wizard 状态 |
| `/workspace/.sync_rules.json` | Sync v2 同步规则 |
| `/workspace/.sync_settings.json` | 全局同步设置 (min_age, watch_interval) |
| `/workspace/.civitai_config.json` | CivitAI API Key |
| `~/.config/rclone/rclone.conf` | Rclone 配置 |

## 环境变量

| 变量 | 用途 |
|------|------|
| `DASHBOARD_PASSWORD` | Dashboard 访问密码 (默认 `comfy2025`) |
| `CF_TUNNEL_TOKEN` | Cloudflare Tunnel Token (bootstrap 阶段可自动启动) |
| `CIVITAI_TOKEN` | CivitAI API Key |
| `RCLONE_CONF_BASE64` | Base64 编码的 rclone.conf |
| `COMFYUI_DIR` | ComfyUI 安装路径 (默认 `/workspace/ComfyUI`) |
| `COMFYUI_URL` | ComfyUI 内部 URL (默认 `http://localhost:8188`) |
| `MANAGER_PORT` | Dashboard 端口 (默认 5000) |

## 日志 & 调试

- Dashboard 日志: `pm2 logs dashboard`
- ComfyUI 日志: `pm2 logs comfy` 或 Dashboard ComfyUI 页实时流
- Tunnel 日志: `pm2 logs tunnel`
- 部署日志: SSE `/api/setup/log_stream` (向导页实时展示)
- 主日志: `/workspace/setup.log`

## 开发注意事项

- 前端无构建步骤，全部为原生 HTML/JS/CSS
- CSS 变量: `--bg`~`--bg4` (背景层级)、`--bd`/`--bd-f` (边框)、`--ac`/`--ac2` (主题色)、`--t1`/`--t2`/`--t3` (文字层级)、`--green`/`--red`/`--amber` 等颜色
- 前端 HTML/JS 通过 Flask 直接 serve，带 `no-cache` 响应头
- WebSocket 依赖: `websocket-client` (pip 包)
- 认证: Flask session + 密码，`/static/*`、`/api/version`、`/api/setup/*` 路由跳过鉴权

---

## 协作开发约定

- **远程测试实例**: 项目的测试实例运行在 vast.ai 上，直接通过 `ssh vast` 连接 (SSH config 已配好)
- **本地 ComfyUI 副本**: `~/ComfyUI` 有一个本地 ComfyUI 安装 (非本项目部署)，可用于验证 API 接口、测试插件功能等
- **完成任务后**: 不要直接结束对话，请使用 ask_questions 向用户寻求反馈
- **遇到问题时**: 不要盲目迭代，使用 ask_questions 请求用户协助 (例如: 帮忙在浏览器查看 UI/控制台、在 vast 上重建实例等)
- **SSH 远程命令**: vast.ai SSH 连接较慢，需要输出一段提示后才执行命令。**不要设置过短的超时时间**（推荐 `timeout=0`），不要因为等待时间长就误判为连接中断或执行失败。如果真的出问题用户会手动 Ctrl+C
