# ==============================================================================
# ComfyCarry Modal E2E — 在 Modal 免费额度 ($30/月) 上完整运行生产镜像
#
# 用途: 开发机无 GPU 时的端到端测试。直接拉取 CI 构建的生产镜像,
#       走 entrypoint.sh → bootstrap.sh 的真实启动链路 (代码来自 GitHub main,
#       前端 dist 来自 frontend-dist Release), 与 RunPod 部署路径完全一致。
#
# 前置 (本地一次性):
#   pip install modal
#   modal setup          # 浏览器完成认证
#
# 使用:
#   modal run docker/modal_e2e.py                # 默认 4 小时会话
#   modal run docker/modal_e2e.py --hours 1.5    # 自定义时长
#   Ctrl+C 随时结束 (按秒计费, 结束即停止扣费)
#
# 启动后终端会打印两个公网 HTTPS 隧道地址:
#   Panel  → ComfyCarry 面板 (5000), 打开后走向导部署 ComfyUI
#   ComfyUI → 8188, 面板部署完成前访问会 502, 属正常
#
# 持久化 (跨会话保留, 不占 GPU 费用, 少量存储费):
#   comfycarry-workspace → /workspace       (面板代码/配置/日志)
#   comfycarry-models    → /opt/ComfyUI/models (模型文件, 避免重复下载)
#
# 注意:
#   - 首次运行 Modal 需转换 ~20GB 镜像, 冷启动可能 10-20 分钟, 之后有缓存
#   - GPU 选 L4 (Ada sm89, 24GB): 在镜像支持矩阵内 (SA2 sm89 wheel 可用),
#     ≈$0.80/h, $30 额度约 37 小时/月。切勿选 T4 (Turing sm75, 低于矩阵下限)
#   - Modal 不执行镜像 CMD, 由本脚本显式拉起 entrypoint.sh
#   - SSH (22) 用不上, 调试用: modal shell docker/modal_e2e.py::e2e
# ==============================================================================
import subprocess
import time

import modal

IMAGE_REF = "ghcr.io/vvb7456/comfycarry:latest"
GPU = "L4"
HARD_TIMEOUT_H = 8  # 决定 timeout 上限, --hours 不能超过它

app = modal.App("comfycarry-e2e")

# 不用 add_python: 镜像自带 Ubuntu 24.04 系统 python3 (=3.12, 预装全部依赖),
# 注入独立 python 会遮蔽它, 导致 bootstrap 的 pm2 用裸解释器起面板 (缺 flask)
image = modal.Image.from_registry(IMAGE_REF)

workspace_vol = modal.Volume.from_name("comfycarry-workspace", create_if_missing=True)
models_vol = modal.Volume.from_name("comfycarry-models", create_if_missing=True)


@app.function(
    image=image,
    gpu=GPU,
    cpu=4,
    memory=16384,
    timeout=HARD_TIMEOUT_H * 3600,
    volumes={
        "/workspace": workspace_vol,
        "/opt/ComfyUI/models": models_vol,
    },
)
def e2e(hours: float = 4.0):
    hours = min(hours, HARD_TIMEOUT_H - 0.1)
    deadline = time.time() + hours * 3600

    with modal.forward(5000) as panel, modal.forward(8188) as comfy:
        print("=" * 60)
        print("  ComfyCarry E2E 会话已启动")
        print(f"  Panel   : {panel.url}")
        print(f"  ComfyUI : {comfy.url}  (面板部署完成前 502 属正常)")
        print(f"  时长    : {hours:.1f}h (Ctrl+C 提前结束)")
        print("=" * 60)

        # 真实生产启动链路: sshd → bootstrap.sh (GitHub main) → pm2 dashboard:5000
        boot = subprocess.Popen(["bash", "/opt/entrypoint.sh"])

        try:
            while time.time() < deadline:
                time.sleep(300)
                # 定期落盘, 防止会话被硬杀时丢失面板配置/已下载模型
                workspace_vol.commit()
                models_vol.commit()
        finally:
            boot.terminate()
            workspace_vol.commit()
            models_vol.commit()
            print("会话结束, Volume 已保存")
