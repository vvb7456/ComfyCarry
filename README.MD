# ComfyUI RunPod 自动化部署

RunPod/Vast.ai 快速部署 ComfyUI，RTX 5090/H100 优化。

---

## 快速开始

### 方式一：预构建镜像（推荐，65秒启动）

**镜像**：
```
ghcr.io/vvb7456/comfyui-runpod:latest
```

**预装**：Python 3.13 + PyTorch 2.9.1 + CUDA 13.0 + FlashAttention-3 + SageAttention-3 + ComfyUI + 15插件

**预装插件**：
- ComfyUI-Manager
- comfyui_controlnet_aux
- ComfyUI-Impact-Pack
- ComfyUI-Easy-Use
- ComfyUI-Crystools
- ComfyUI_UltimateSDUpscale
- comfyui-dynamicprompts
- WeiLin-Comfyui-Tools
- AuraSR-ComfyUI
- was-node-suite-comfyui
- ComfyUI-KJNodes
- Enhanced-Civicomfy
- ComfyUI-WD14-Tagger
- rgthree-comfy
- ComfyUI-Inspire-Pack

**启动命令**：
```bash
bash -c "wget -O d.sh https://raw.githubusercontent.com/vvb7456/ComfyCarry/main/deploy-prebuilt.sh && bash d.sh"
```

### 方式二：从零安装（20分钟）

**镜像**：
```
runpod/pytorch:1.0.3-cu1281-torch291-ubuntu2404
```

**启动命令**：
```bash
bash -c "wget -O d.sh https://raw.githubusercontent.com/vvb7456/ComfyCarry/main/deploy.sh && bash d.sh"
```

---

## 环境变量

### 必填

| 变量 | 用途 | 示例 |
|------|------|------|
| `CIVITAI_TOKEN` | CivitAI API Key | `abc123def456...` |

### 可选
| 变量 | 默认值 | 说明 |
|------|--------|------|
| **模型下载** |||
| `ALL_MODEL_IDS` | 无 | 逗号分隔的模型ID或URL，自动识别类型 |
| **更新控制** |||
| `UPDATE_COMFYUI` | `false` | 是否更新ComfyUI到最新版 |
| `UPDATE_PLUGINS` | `false` | 是否更新所有插件 |
|**插件** |||
| `PLUGIN_URLS` | 无 | 额外插件，逗号分隔GitHub URL |
| **Rclone配置** |||
| `RCLONE_CONF_URL` | 无 | rclone.conf下载地址（GitHub Gist Raw URL） |
| `ENABLE_R2` | `true` | 启用R2资产同步 |
| `ENABLE_ONEDRIVE` | `true` | 启用OneDrive输出同步 |
| `ENABLE_GDRIVE` | `true` | 启用Google Drive输出同步 |
| **R2同步细粒度** |||
| `R2_SYNC_WORKFLOWS` | `true` | 同步工作流JSON |
| `R2_SYNC_LORAS` | `true` | 同步LoRA模型 |
| `R2_SYNC_WILDCARDS` | `true` | 同步通配符文件 |
| **其他** |||
| `CLOUDFLARED_TOKEN` | 无 | Cloudflare Tunnel令牌 |
| `JUPYTER_TOKEN` | 自动生成 | Jupyter Lab访问令牌 |

---

## 配置指南

### 1. 模型下载

设置 `ALL_MODEL_IDS`，支持：
- 纯ID：`1162518,206886`
- URL：`https://civitai.com/models/1162518`
- 指定版本：`https://civitai.com/models/1162518?modelVersionId=1714002`

脚本自动调用CivitAI API识别模型类型（checkpoint/lora/controlnet/vae/upscaler）。

### 2. Rclone云同步

**准备rclone.conf**：
```bash
# 本地配置remote（r2/onedrive/gdrive）
rclone config

# 找到配置文件
# Linux: ~/.config/rclone/rclone.conf
# Windows: %APPDATA%\rclone\rclone.conf
```

**上传到GitHub Secret Gist**：
1. https://gist.github.com/ → "+ New secret gist"
2. 文件名：`rclone.conf`
3. 粘贴配置内容 → "Create secret gist"
4. 点击"Raw"按钮获取URL

**设置环境变量**：
```bash
RCLONE_CONF_URL=https://gist.githubusercontent.com/user/xxx/raw/xxx/rclone.conf
```

**R2资产结构**（bucket名：comfyui-assets）：
```
comfyui-assets/
├── workflow/*.json       # 工作流
├── loras/*.safetensors   # LoRA模型
└── wildcards/*.txt       # 通配符
```

**控制同步内容**：
```bash
ENABLE_R2=true                # 总开关
R2_SYNC_WORKFLOWS=true        # 工作流
R2_SYNC_LORAS=false           # 不同步LoRA
R2_SYNC_WILDCARDS=true        # 通配符
```

**Output自动上传**（OneDrive/Google Drive）：
- 设置 `RCLONE_CONF_URL` 且配置中有对应remote
- 生成的图片/视频自动移动到 `ComfyUI_Transfer` 文件夹
- 控制：`ENABLE_ONEDRIVE=false` 或 `ENABLE_GDRIVE=false`

### 3. 额外插件

15个默认插件外需要更多插件：

```bash
PLUGIN_URLS=https://github.com/author/plugin1,https://github.com/author/plugin2
```

脚本自动克隆并安装requirements.txt依赖。

### 4. Cloudflare Tunnel

**获取Token**：
1. https://one.dash.cloudflare.com/ → Zero Trust → Access → Tunnels
2. Create a tunnel → 复制token

**设置环境变量**：
```bash
CLOUDFLARED_TOKEN=eyJhIjoixxxx...
```

启动后通过Cloudflare域名访问ComfyUI（端口8188）。

---

## 目录结构

```
/workspace/ComfyUI/
├── models/
│   ├── checkpoints/      # Checkpoint
│   ├── loras/            # LoRA（含R2同步）
│   ├── controlnet/       # ControlNet
│   ├── vae/              # VAE
│   └── upscale_models/   # 放大器
├── output/               # 输出（自动同步）
└── user/default/workflows/  # 工作流（R2同步）
```

---

## 常用命令

```bash
# 日志
tail -f /workspace/setup.log

# PM2管理
pm2 list
pm2 logs comfy
pm2 restart comfy

# 模型列表
find /workspace/ComfyUI/models -name "*.safetensors"
```

---

## 故障排查

| 问题 | 解决 |
|------|------|
| 模型未下载 | 检查 `CIVITAI_TOKEN` 有效性，查看 `/workspace/setup.log` |
| Rclone同步失败 | 验证 `RCLONE_CONF_URL` 可访问，检查remote名称 |
| 磁盘满 | `df -h /workspace`，删除不需要的模型 |

---

## 文件

- `deploy-prebuilt.sh` - 预构建镜像部署
- `deploy.sh` - 完整安装部署
- `civicomfy_batch_downloader.py` - 批量下载器
- `auto_generate_csv.py` - 模型信息查询

**版本**：v5.0
