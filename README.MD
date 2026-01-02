# RunPod ComfyUI Automation Script (v3.2)

针对 RunPod 环境定制的 ComfyUI 全自动化部署脚本。集成 SageAttention 加速（适配 Wan2.2）、CivitDL 并行下载与自动分类、Rclone 双向同步功能。

## 1. 环境要求

必须使用以下 RunPod 官方基础镜像，否则无法保证 CUDA/Python 版本兼容性：

*   **Docker Image**: `runpod/pytorch:1.0.2-cu1281-torch280-ubuntu2404`
*   **Python**: 3.12
*   **CUDA**: 12.8 (System) / 12.4 (Torch)
*   **GPU**: 支持 Ampere,Ada,Blackwell架构

## 2. 核心功能

### 🚀 极速推理
*   **SageAttention V2**: 自动识别 GPU 算力 (sm_xx) 并从源码编译，显著优化 Wan2.2 等 Transformer 模型性能。
*   **Torch 2.x + FlashAttn**: 集成 Flash Attention 2 和 xformers，强制修补 PyTorch CUDA 版本检查机制。

### 📦 智能资源管理 (CivitDL v3)
*   **并行下载**: 通过 `civitdl` 批量并发下载模型，跑满机房带宽。
*   **自动分类**: 内置 Python Sorter，根据元数据自动将 Checkpoint, LoRA, VAE, ControlNet 分流至 ComfyUI 对应目录。
*   **免交互认证**: 自动生成配置文件注入 API Key，无需手动干预。

### 🔄 数据同步
*   **R2/S3 输入**: 启动时从对象存储拉取私有工作流和 LoRA。
*   **OneDrive 输出**: 后台监控 `/output` 目录，生成的图片/视频自动上传至 OneDrive。
*   **Tmux 守护**: 所有服务运行在 Tmux 会话中，SSH 断开不影响运行。

## 3. 配置参数 (Environment Variables)

在 RunPod 模板中设置以下环境变量：

| 变量名 | 必填 | 示例/说明 |
| :--- | :--- | :--- |
| `CIVITAI_TOKEN` | 是 | CivitAI API Key，用于下载模型 (Settings -> API Key)。 |
| `ALL_MODEL_IDS` | 否 | 逗号分隔的模型 ID (Model ID)。支持混合输入 Checkpoint/LoRA/ControlNet，脚本会自动分类。<br>例: `12345,67890,102030` |
| `RCLONE_CONF_BASE64` | 否 | Base64 编码后的 `rclone.conf` 文件内容 (生成方法见下文)。 |
| `R2_REMOTE_NAME` | 否 | Rclone 配置中 R2 存储桶的名称，用于拉取私有资源。 |
| `ONEDRIVE_REMOTE_NAME` | 否 | Rclone 配置中 OneDrive 的名称，用于上传产出物。 |
| `PLUGIN_URLS` | 否 | 自定义插件 Git 地址列表，逗号分隔。如不填则使用脚本内置的默认推荐列表。 |

> **兼容性说明**: 旧版变量 `CHECKPOINT_IDS`, `LORA_IDS` 依然有效，脚本会自动将其合并至 `ALL_MODEL_IDS` 处理。

## 4. 设置指南

### 4.1 获取 Rclone Base64 配置
脚本需要无交互读取 Rclone 配置，请在本地机器（或任意已配置好 Rclone 的环境）执行：

1.  配置 Rclone (如未配置):
    ```bash
    rclone config
    # 按提示配置好 R2 (source) 和 OneDrive (dest)
    ```
2.  导出 Base64 字符串:
    ```bash
    # Linux/Mac
    cat ~/.config/rclone/rclone.conf | base64 -w 0
    
    # Windows PowerShell
    [Convert]::ToBase64String([IO.File]::ReadAllBytes("$env:USERPROFILE\.config\rclone\rclone.conf"))
    ```
3.  复制输出的长字符串，填入 RunPod 的 `RCLONE_CONF_BASE64` 变量。

### 4.2 部署步骤

1.  **RunPod 后台**: Create Pod -> Select Template。
2.  **选择镜像**: 输入 `runpod/pytorch:1.0.2-cu1281-torch280-ubuntu2404`。
3.  **编辑环境变量**: 填入上述 API Token 和模型 ID。
4.  **填入启动脚本**:
    将 `setup.sh` 的内容粘贴至 **Container Start Command** (Docker Command) 中。
    *或者*
    将脚本托管在 Gist/Github，填入:
    ```bash
    bash -c "$(wget -qO- https://your-gist-url/setup.sh)"
    ```
5.  **启动**: 等待约 3-5 分钟（视模型下载量而定）。

### 4.3 验证运行

SSH 连接到 Pod 后：

*   **查看部署日志**:
    ```bash
    tail -f /workspace/setup.log
    ```
*   **查看 ComfyUI 服务**:
    ```bash
    tmux attach -t comfy
    ```
*   **查看同步服务**:
    ```bash
    tmux attach -t sync
    ```

## 5. 目录结构说明

脚本运行后，`/workspace/ComfyUI/models` 将呈现如下结构（由 Sorter 自动整理）：

```text
/models
├── checkpoints/
│   └── [Wan2.1_Model_Name]/       # Checkpoint 文件
├── loras/
│   └── [Detail_Tweaker]/          # LoRA 文件 + 预览图
├── controlnet/
├── vae/
└── ...