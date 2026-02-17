# Copilot Instructions for ComfyUI_RunPod_Sync

## 项目概述

全栈 ComfyUI 云端部署管理平台，面向 RunPod / Vast.ai GPU 实例。提供 Web Dashboard 统一管理 ComfyUI 服务、模型、插件、Tunnel、云同步等。

## 架构 (v2.0 — Dashboard-first)

| 文件 | 角色 |
|------|------|
| **bootstrap.sh** | 最小化入口脚本 — 安装 Python 3.13 / Node.js / PM2 / Cloudflared，下载 Dashboard 文件，启动 PM2 进程 |
| **workspace_manager.py** | Flask 后端 (≈2800 行) — 系统监控、服务管理、模型管理、CivitAI 代理、插件管理、ComfyUI 参数控制、Setup Wizard 部署引擎、Cloud Sync、Tunnel 管理、SSE 实时推送 |
| **dashboard.html** | 前端 HTML + CSS (≈2100 行) — SPA 单页应用，深色主题，支持 4K |
| **dashboard.js** | 前端 JS (≈2560 行) — 页面路由、API 调用、轮询/SSE 事件流、ComfyUI WebSocket 桥接 |
| **setup_wizard.html** | 首次部署向导页 (≈680 行) — 引导用户配置密码、Tunnel、Rclone、CivitAI、插件选择，然后触发部署 |

### 已废弃文件 (在 .gitignore 中)
- `deploy.sh` / `deploy-prebuilt.sh` — 旧版 Bash 部署脚本，功能已迁移至 `workspace_manager.py` 的 `_run_deploy()` 引擎
- `auto_generate_csv.py` / `civicomfy_batch_downloader.py` / `civitai_lookup.py` — 旧版独立工具，功能已集成到 Dashboard

## 部署流程

1. 用户在 Vast.ai / RunPod 创建实例，运行 `bootstrap.sh`
2. bootstrap 安装最小依赖，启动 Dashboard (PM2 `dashboard` 进程，端口 5000)
3. 用户访问 Dashboard，首次进入 Setup Wizard (`setup_wizard.html`)
4. 用户配置 → 点击部署 → `workspace_manager.py` 的 `_run_deploy()` 在后台线程执行全部安装逻辑 (日志通过 SSE 实时推送)
5. 部署完成后自动跳转到 Dashboard 主界面

## 服务管理

- **PM2 进程**: `dashboard` (Flask 5000), `comfy` (ComfyUI 8188), `tunnel` (Cloudflare), `sync` (云同步)
- **ComfyUI WebSocket 桥接**: `ComfyWSBridge` 类维持到 ComfyUI 的 WS 连接，通过 SSE `/api/comfyui/events` 向前端广播实时状态
- **插件管理**: 代理 ComfyUI-Manager 的 REST API 端点

## Dashboard 页面结构

| 页面 | 功能 |
|------|------|
| Dashboard | 系统监控 (CPU/GPU/内存/磁盘)、PM2 服务状态 |
| Models | 本地模型管理 + CivitAI 搜索 + Enhanced-Civicomfy 下载 |
| Plugins | 插件浏览/安装/卸载/更新 (代理 ComfyUI-Manager) |
| ComfyUI | 启动参数管理 + 实时日志/事件 (WS→SSE) + 队列/历史 |
| Tunnel | Cloudflare Tunnel 状态、Ingress 解析、服务链接 |
| Cloud Sync | Rclone 配置编辑、OneDrive/Google Drive/R2 同步偏好、实时日志 |
| Settings | 密码管理、CivitAI Key、Debug 模式、Dashboard 重启 |

## 关键配置文件 (运行时)

| 路径 | 用途 |
|------|------|
| `/workspace/.dashboard_env` | Dashboard 持久化配置 (密码、session secret、debug 等) |
| `/workspace/.setup_state.json` | Setup Wizard 状态 |
| `/workspace/.sync_prefs.json` | 云同步偏好设置 |
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
- CSS 变量: `--bg` (背景)、`--c1`/`--c2` (卡片)、`--ac` (主题色)、`--tx`/`--t2` (文字)
- 前端 HTML/JS 通过 Flask 直接 serve，带 `no-cache` 响应头
- WebSocket 依赖: `websocket-client` (pip 包)
- 认证: Flask session + 密码，`/dashboard.js` 和 `/api/setup/*` 路由跳过鉴权

---

## 协作开发约定

- **远程测试实例**: 项目的测试实例运行在 vast.ai 上，直接通过 `ssh vast` 连接 (SSH config 已配好)
- **本地 ComfyUI 副本**: `~/ComfyUI` 有一个本地 ComfyUI 安装 (非本项目部署)，可用于验证 API 接口、测试插件功能等
- **完成任务后**: 不要直接结束对话，请使用 ask_questions 向用户寻求反馈
- **遇到问题时**: 不要盲目迭代，使用 ask_questions 请求用户协助 (例如: 帮忙在浏览器查看 UI/控制台、在 vast 上重建实例等)
