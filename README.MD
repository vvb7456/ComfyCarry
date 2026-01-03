

# 艾萝工坊 RunPod ComfyUI 自动化部署脚本 

专为 RunPod 优化的 ComfyUI 一键启动脚本。支持 **Blackwell (RTX 5090/B200)** 及 **Hopper (H100)** 架构，

## 核心特性 (v4.5)

1.  **UI 优先 (UI-First)**: 依赖装完立即启动 ComfyUI，**模型下载在后台并行处理**，无需等待即可进入界面。
2.  **新架构适配**: 自动识别 GPU，针对 5090/H100 自动配置 **FlashAttention-3** 和 **SageAttention-3**。
3.  **Wheel 预装**: 优先从 R2 读取预编译加速包，跳过耗时的源码编译过程（需配置 R2）。
4.  **双向同步**: 启动时从 R2 拉取私有流/模型，运行时自动将产出图上传至 OneDrive 并清理本地空间。

## 1. 镜像要求

```
runpod/pytorch:1.0.3-cu1281-torch291-ubuntu2404
```

## 2. 环境变量配置 (Edit Template)

| 变量名 | 必填 | 说明 |
| :--- | :--- | :--- |
| `CIVITAI_TOKEN` | 是 | CivitAI API Key，用于下载模型。 |
| `ALL_MODEL_IDS` | 否 | 逗号分隔的模型 ID（Checkpoint/LoRA/ControlNet 混合填，脚本自动分类）。 |
| `RCLONE_CONF_BASE64` | 否 | Base64 后的 `rclone.conf` 内容。 |
| `R2_REMOTE_NAME` | 否 | Rclone 中 R2 的配置名（用于拉取 Wheel/Workflow）。 |
| `ONEDRIVE_REMOTE_NAME` | 否 | Rclone 中 OneDrive 的配置名（用于上传 Output）。 |
| `PLUGIN_URLS` | 否 | 自定义插件 Git 地址，逗号分隔。 |

## 3. 启动命令

在 **Container Start Command** 中填入：

```bash
bash -c "wget -O deploy.sh https://raw.githubusercontent.com/vvb7456/ComfyUI_RunPod_Sync/refs/heads/main/deploy.sh && chmod +x deploy.sh && ./deploy.sh"
```

## 4. 目录与同步说明

### 模型下载 (CivitDL)
脚本启动后，ComfyUI 会立刻运行。模型下载在后台 `tmux` 会话中进行，下载完成后刷新 UI 即可看到。

### R2 存储结构 (加速包与私货)
如配置了 R2，请保持以下结构以启用数据下载：

```text
[R2_Bucket]/comfyui-assets/
├── wheels/                # 存放 flash_attn/sageattention 的 .whl (大幅缩短启动时间)
├── workflow/              # 私有工作流 -> /user/default/workflows
├── loras/                 # 私有 LoRA -> /models/loras
└── wildcards/             # DynamicPrompts 通配符
```

### OneDrive 产出 (自动归档)
启用同步后，脚本监控 `/output`，文件静止 30 秒即上传至 OneDrive 的 `ComfyUI_Transfer` 目录并删除本地文件。

## 5. 常用指令

*   **看部署日志**: `tail -f /workspace/setup.log`
*   **进 ComfyUI 后台**: `tmux attach -t comfy`
*   **看同步/下载进度**: `tmux attach -t sync`