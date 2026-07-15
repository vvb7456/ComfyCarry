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
# 使用 (两种模式, 计费按容器存活时间, 与 GPU 利用率无关):
#   modal run docker/modal_e2e.py::e2e              # GPU L4, ≈$1.12/h — 真实出图
#   modal run docker/modal_e2e.py::e2e_cpu          # 纯 CPU, ≈$0.11/h — 挂 UI 验证交互/逻辑
#   不加 --hours 则一直运行, 手动结束; 加 --hours N 到点自动收尾。
#   结束方式: Ctrl+C, 或 --detach 后用 modal app stop comfycarry-e2e。
#   兜底: Modal 函数硬上限 24h 强杀 (GPU 模式跑满一天 ≈$27, 建议 GPU 会话给 --hours)
#
# 启动后终端会打印两个公网 HTTPS 隧道地址:
#   Panel  → ComfyCarry 面板 (5000), 打开后走向导部署 ComfyUI
#   ComfyUI → 8188, 面板部署完成前访问会 502, 属正常
#
# 持久化 (跨会话保留, 不占 GPU 费用, 存储费 1TiB 内免费):
#   comfycarry-workspace 卷挂在 /vol/workspace, 会话启动时将 /workspace 软链过去。
#   (Modal 禁止把卷挂到镜像内非空路径, 而基础镜像的 /workspace 和
#    /opt/ComfyUI/models 都非空, 故不能直接挂载)
#   部署引擎首次部署会 cp -a /opt/ComfyUI → /workspace/ComfyUI (RunPod 网络卷模式),
#   之后面板代码/配置/插件/模型全部落在 /workspace 下, 单卷即覆盖全部持久化。
#
# 注意:
#   - 首次运行 Modal 需转换 ~20GB 镜像, 冷启动可能 10-20 分钟, 之后有缓存
#   - GPU 选 L4 (Ada sm89, 24GB): 在镜像支持矩阵内 (SA2 sm89 wheel 可用),
#     ≈$0.80/h, $30 额度约 37 小时/月。切勿选 T4 (Turing sm75, 低于矩阵下限)
#   - Modal 不执行镜像 CMD, 由本脚本显式拉起 entrypoint.sh
#   - SSH (22) 用不上, 调试用: modal shell docker/modal_e2e.py::e2e
# ==============================================================================
import os
import subprocess
import time

import modal

IMAGE_REF = "ghcr.io/vvb7456/comfycarry:latest"
GPU = "L4"
HARD_TIMEOUT_H = 24  # Modal 函数 timeout 上限即 24h, 也是 --hours 的封顶值

app = modal.App("comfycarry-e2e")

# 不用 add_python: 镜像自带 Ubuntu 24.04 系统 python3 (=3.12, 预装全部依赖),
# 注入独立 python 会遮蔽它, 导致 bootstrap 的 pm2 用裸解释器起面板 (缺 flask)
image = modal.Image.from_registry(IMAGE_REF)

workspace_vol = modal.Volume.from_name("comfycarry-workspace", create_if_missing=True)

VOLUMES = {
    "/vol/workspace": workspace_vol,
}


def _prepare_workspace():
    """把 /workspace 替换为指向卷 (/vol/workspace) 的软链。

    每个容器都是全新镜像文件系统, /workspace 初始为镜像自带目录;
    先用 cp -an 把镜像内容并入卷 (不覆盖卷中已有文件), 再替换为软链,
    使 entrypoint/bootstrap/部署引擎写入 /workspace 的一切都落在卷上。
    """
    if not os.path.islink("/workspace"):
        subprocess.run("cp -an /workspace/. /vol/workspace/ 2>/dev/null || true", shell=True)
        subprocess.run(["rm", "-rf", "/workspace"], check=True)
        os.symlink("/vol/workspace", "/workspace")
    # 镜像 WORKDIR=/workspace, rm 后当前进程 cwd 悬空会让子进程
    # (PM2/Node 的 uv_cwd) 直接崩溃, 必须切回有效目录
    os.chdir("/vol/workspace")


def _session(hours: float, label: str):
    """公共会话逻辑: 开双隧道 → 走生产启动链路 → 挂住直到超时/Ctrl+C

    hours <= 0 表示不限时: 一直运行到手动结束 (或 Modal 24h 硬上限强杀)。
    """
    if hours > 0:
        deadline = time.time() + min(hours, HARD_TIMEOUT_H - 0.1) * 3600
        duration_desc = f"{min(hours, HARD_TIMEOUT_H - 0.1):.1f}h (Ctrl+C 提前结束)"
    else:
        deadline = None
        duration_desc = "不限时 — Ctrl+C 或 modal app stop 结束 (24h 硬上限兜底)"

    _prepare_workspace()

    with modal.forward(5000) as panel, modal.forward(8188) as comfy:
        print("=" * 60)
        print(f"  ComfyCarry E2E 会话已启动 [{label}]")
        print(f"  Panel   : {panel.url}")
        print(f"  ComfyUI : {comfy.url}  (面板部署完成前 502 属正常)")
        print(f"  时长    : {duration_desc}")
        print("=" * 60)

        # 真实生产启动链路: sshd → bootstrap.sh (GitHub main) → pm2 dashboard:5000
        boot = subprocess.Popen(["bash", "/opt/entrypoint.sh"])

        try:
            while deadline is None or time.time() < deadline:
                time.sleep(300)
                # 定期落盘, 防止会话被硬杀时丢失面板配置/已下载模型
                workspace_vol.commit()
        finally:
            boot.terminate()
            workspace_vol.commit()
            print("会话结束, Volume 已保存")


@app.function(
    image=image,
    gpu=GPU,
    cpu=4,
    memory=16384,
    timeout=HARD_TIMEOUT_H * 3600,
    volumes=VOLUMES,
)
def e2e(hours: float = 0):
    """GPU 会话 (L4, ≈$1.12/h) — 真实出图的端到端验证。
    hours=0 (默认) 不限时, 手动结束; 传 --hours N 到点自动收尾。"""
    _session(hours, f"GPU {GPU}")


@app.function(
    image=image,
    cpu=2,
    memory=8192,
    timeout=HARD_TIMEOUT_H * 3600,
    volumes=VOLUMES,
)
def e2e_cpu(hours: float = 0):
    """纯 CPU 会话 (≈$0.11/h) — 挂 WebUI 验证交互/逻辑, 不跑真实生成。
    ComfyUI 无 GPU 时以 CPU 模式运行, 生成极慢但接口/交互完整。
    hours=0 (默认) 不限时, 手动结束; 传 --hours N 到点自动收尾。"""
    _session(hours, "CPU only")
