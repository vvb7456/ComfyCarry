# 艾萝工坊 RunPod ComfyUI 自动化部署脚本

RunPod/Vast.ai 一键部署 ComfyUI，支持 RTX 5090/H100 GPU 优化和自动模型下载。

## 快速开始

### 1. 镜像
```
runpod/pytorch:1.0.3-cu1281-torch291-ubuntu2404
```

### 2. 环境变量

**必填**：
```bash
CIVITAI_TOKEN=your_civitai_api_key
```

**模型配置（选一种）**：

```bash
# 方式1：Gist URL（推荐）
MODEL_CSV_URL=https://gist.githubusercontent.com/username/xxx/raw/models.csv

# 方式2：环境变量
CHECKPOINT_IDS=206886,123456
LORA_IDS=789012,654321

# 方式3：Base64编码
MODEL_CSV_BASE64=MjA2ODg2LGNoZWNrcG9pbnQsLAo=
```

**可选配置**：
```bash
# R2/OneDrive 同步
RCLONE_CONF_BASE64=your_rclone_config_base64
R2_REMOTE_NAME=r2
ONEDRIVE_REMOTE_NAME=onedrive

# R2 同步细粒度控制（可选，默认全部启用）
R2_SYNC_WHEELS=true       # 预编译包（推荐启用）
R2_SYNC_WORKFLOWS=true    # 工作流
R2_SYNC_LORAS=false       # 如不需要私有 LoRA，可关闭
R2_SYNC_WILDCARDS=true    # DynamicPrompts 通配符

# 自定义插件
PLUGIN_URLS=https://github.com/user/plugin1,https://github.com/user/plugin2
```

### 3. 启动命令

```bash
bash -c "wget -O deploy.sh https://raw.githubusercontent.com/vvb7456/ComfyUI_RunPod_Sync/main/deploy.sh && chmod +x deploy.sh && ./deploy.sh"
```

## 模型配置

### CSV 格式

创建 `models.csv` 文件：

```csv
# model_id, type, version_id(可选), custom_name(可选)
206886,checkpoint,,
789012,lora,,
555666,controlnet,98765,MyControlNet
https://civitai.com/models/123456,lora,,  # 支持URL
```

**支持的模型类型**：`checkpoint`, `lora`, `controlnet`, `vae`, `upscaler`

### 托管方式

**GitHub Gist**（推荐）：
1. 访问 https://gist.github.com
2. 创建 `models.csv`
3. 点击 Raw 获取 URL
4. 设置 `MODEL_CSV_URL`

**GitHub 仓库**：
```
https://raw.githubusercontent.com/username/repo/main/models.csv
```

**R2/S3**：
```bash
rclone copy models.csv r2:comfyui-assets/csv/
# 脚本自动检测
```

### R2 存储桶目录结构

```
comfyui-assets/
├── wheels/              # GPU 架构预编译包
│   ├── flash_attn_3-3.0.0b1-cp39-abi3-linux_x86_64.whl
│   └── sageattn3-1.0.0-cp313-*.whl
├── workflow/            # ComfyUI 工作流 JSON
│   └── *.json
├── loras/               # 私有 LoRA 模型
│   └── *.safetensors
├── wildcards/           # DynamicPrompts 通配符
│   └── *.txt
└── csv/                 # 配置文件
    └── models.csv       # CivitAI 模型下载列表
```

**上传示例**：
```bash
# 上传模型列表
rclone copy models.csv r2:comfyui-assets/csv/

# 上传私有 LoRA
rclone copy my_loras/ r2:comfyui-assets/loras/ -P

# 上传工作流
rclone copy workflows/ r2:comfyui-assets/workflow/ -P
```

## 功能特性

-  **GPU 优化**：自动配置 FlashAttention-3/SageAttention-3（5090/H100）
-  **模型管理**：Civicomfy Web UI，搜索/下载/管理模型
-  **无人值守**：API Key 自动配置，批量下载模型
-  **云同步**：R2 拉取私有资源，OneDrive 上传输出
-  **预编译包**：优先使用 Wheel，跳过耗时编译

## 常用命令

```bash
# 查看日志
tail -f /workspace/setup.log

# 进入 ComfyUI 后台
tmux attach -t comfy

# 查看模型
find /workspace/ComfyUI/models -name "*.safetensors"
```

## 目录结构

```
/workspace/ComfyUI/
 models/
    checkpoints/    # Checkpoint 模型
    loras/          # LoRA 模型
    controlnet/     # ControlNet
    vae/            # VAE
    upscale_models/ # 放大器
 output/             # 输出图片（自动同步到 OneDrive）
 user/default/workflows/  # 工作流（从 R2 同步）
```

## 环境变量完整列表

| 变量 | 说明 |
|------|------|
| `CIVITAI_TOKEN` | CivitAI API Key（必填） |
| `MODEL_CSV_URL` | 模型列表 CSV 的 URL |
| `MODEL_CSV_BASE64` | Base64 编码的 CSV 内容 |
| `CHECKPOINT_IDS` | Checkpoint 模型 ID，逗号分隔 |
| `LORA_IDS` | LoRA 模型 ID，逗号分隔 |
| `CONTROLNET_IDS` | ControlNet 模型 ID，逗号分隔 |
| `ALL_MODEL_IDS` | 统一模型 ID 列表 |
| `RCLONE_CONF_BASE64` | Base64 编码的 rclone.conf |
| `R2_REMOTE_NAME` | R2 远程名称 |
| `R2_SYNC_WHEELS` | 是否拉取预编译包（默认 true） |
| `R2_SYNC_WORKFLOWS` | 是否拉取工作流（默认 true） |
| `R2_SYNC_LORAS` | 是否拉取 LoRA 模型（默认 true） |
| `R2_SYNC_WILDCARDS` | 是否拉取通配符（默认 true） |
| `ONEDRIVE_REMOTE_NAME` | OneDrive 远程名称 |
| `PLUGIN_URLS` | 自定义插件 URL，逗号分隔 |

## 故障排查

**模型未下载**：
- 检查 `CIVITAI_TOKEN` 是否有效
- 查看日志：`grep "\|error" /workspace/setup.log`
- 验证模型 ID：访问 `https://civitai.com/models/{ID}`

**CSV 下载失败**：
- 测试 URL：`curl -I your_csv_url`
- 确保 URL 公开可访问

**磁盘空间不足**：
- 查看占用：`df -h /workspace`
- 删除不需要的模型

## 获取 CivitAI API Key

1. 访问 https://civitai.com/user/account
2. 找到 "API Tokens" 部分
3. 点击 "Create" 生成
4. 复制 Token

## 文件说明

- `deploy.sh` - 主部署脚本
- `civicomfy_batch_downloader.py` - 批量下载工具
- `models.csv.template` - CSV 模板
- `models.csv.example` - CSV 示例

## 版本

- **v4.6.1** - 支持远程 CSV 配置（Gist/URL/Base64）
- **v4.6** - 集成 Civicomfy Web UI
- **v4.5** - GPU 架构自适应、UI 优先启动
