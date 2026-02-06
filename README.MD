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

**模型配置（推荐）**：

```bash
# 方式1：统一变量（支持模型 ID 和 URL 混合）
ALL_MODEL_IDS=206886,https://civitai.com/models/789012?modelVersionId=123456,1102581
```

**工作原理**：
- 脚本自动调用 CivitAI API 查询每个模型的类型（checkpoint/lora/controlnet/vae/upscaler）
- 支持纯 ID（如 `206886`）和完整 URL（如 `https://civitai.com/models/789012`）
- 如 URL 中包含 `modelVersionId` 参数，优先使用该版本；否则使用 API 返回的默认版本
- 自动生成临时 CSV 文件并调用 Civicomfy 下载，无需手动创建文件

**可选配置**：

```bash
# Rclone 云同步（上传 rclone.conf 到 GitHub Secret Gist）
RCLONE_CONF_URL=https://gist.githubusercontent.com/your-username/xxx/raw/xxx/rclone.conf

# R2 同步细粒度控制
R2_SYNC_WORKFLOWS=true    # 工作流
R2_SYNC_LORAS=false       # LoRA 模型
R2_SYNC_WILDCARDS=true    # 通配符

# 自定义插件
PLUGIN_URLS=https://github.com/user/plugin1,https://github.com/user/plugin2
```

### 3. 启动命令

```bash
bash -c "wget -O deploy.sh https://raw.githubusercontent.com/vvb7456/ComfyUI_RunPod_Sync/main/deploy.sh && chmod +x deploy.sh && ./deploy.sh"
```

## 模型配置

### 环境变量自动生成（推荐）

直接在环境变量中填写模型 ID 或 URL：

```bash
# 混合使用模型 ID 和完整 URL（脚本自动识别类型）
ALL_MODEL_IDS=206886,https://civitai.com/models/789012?modelVersionId=123456,1102581
```

**工作原理**：
1. 脚本自动调用 CivitAI API 查询每个模型的类型和默认版本
2. URL 中的 `modelVersionId` 参数会覆盖 API 默认版本
3. 自动生成临时 CSV 文件并传递给 Civicomfy
4. 无需手动创建或托管 CSV 文件

**支持格式**：
- 纯 ID：`1162518`
- 完整 URL（无版本）：`https://civitai.com/models/1162518/plant-milk-model-suite`
- 完整 URL（指定版本）：`https://civitai.com/models/1162518?modelVersionId=1714002`

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
└── wildcards/           # DynamicPrompts 通配符
    └── *.txt
```

**上传示例**：
```bash
# 上传私有 LoRA
rclone copy my_loras/ r2:comfyui-assets/loras/ -P

# 上传工作流
rclone copy workflows/ r2:comfyui-assets/workflow/ -P
```

## 功能特性

-  **GPU 优化**：自动配置 FlashAttention-3/SageAttention-3（5090/H100）
-  **模型管理**：Civicomfy Web UI，搜索/下载/管理模型
-  **无人值守**：API Key 自动配置，批量下载模型
-  **云同步**：R2 拉取私有资源，OneDrive/Google Drive 上传输出
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
 output/             # 输出图片（自动同步到 OneDrive/Google Drive）
 user/default/workflows/  # 工作流（从 R2 同步）
```

## 环境变量完整列表

| 变量 | 说明 |
|------|------|
| `CIVITAI_TOKEN` | CivitAI API Key（必填） |
| `ALL_MODEL_IDS` | 模型 ID 或 URL 列表，逗号分隔 |
| `RCLONE_CONF_URL` | rclone.conf 文件的 URL（GitHub Secret Gist） |
| `R2_SYNC_WORKFLOWS` | 是否拉取工作流（默认 true） |
| `R2_SYNC_LORAS` | 是否拉取 LoRA 模型（默认 true） |
| `R2_SYNC_WILDCARDS` | 是否拉取通配符（默认 true） |
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

## 配置 Rclone 云存储

### 上传到 GitHub Secret Gist

**步骤：**

1. **在本地配置 rclone**（R2/OneDrive/GDrive）
   ```bash
   rclone config
   ```
   按提示配置 R2、OneDrive、Google Drive 等

2. **上传配置到 GitHub Gist**
   - 访问 https://gist.github.com/
   - 点击 "+ New secret gist"（⚠️ 必须选 Secret）
   - 文件名：`rclone.conf`
   - 内容：复制 `~/.config/rclone/rclone.conf` (Linux) 或 `%APPDATA%\rclone\rclone.conf` (Windows)
   - 点击 "Create secret gist"

3. **获取 Raw URL**
   - 点击文件右上角 "Raw" 按钮
   - 复制完整 URL：`https://gist.githubusercontent.com/username/.../raw/.../rclone.conf`

4. **设置环境变量**
   ```bash
   RCLONE_CONF_URL=https://gist.githubusercontent.com/username/.../raw/.../rclone.conf
   ```

完成！脚本会自动识别配置中的所有 remote 并启用对应功能。

---

## 文件说明

- `deploy.sh` - 主部署脚本
- `civicomfy_batch_downloader.py` - 批量下载工具
- `auto_generate_csv.py` - CSV 自动生成工具（查询 CivitAI API）
- `models.csv.template` - CSV 模板
- `models.csv.example` - CSV 示例

## 版本

- **v4.6.1** - 支持远程 CSV 配置（Gist/URL/Base64）
- **v4.6** - 集成 Civicomfy Web UI
- **v4.5** - GPU 架构自适应、UI 优先启动
