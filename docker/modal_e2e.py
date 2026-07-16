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
#   modal run docker/modal_e2e.py::e2e_cpu          # 纯 CPU, ≈$0.11/h — 仅面板 UI 验证
#                                                     (无 GPU 时 ComfyUI 拒绝启动, 属预期)
#   不加 --hours 则一直运行, 手动结束; 加 --hours N 到点自动收尾。
#   结束方式: Ctrl+C, 或 --detach 后用 modal app stop comfycarry-e2e。
#   兜底: Modal 函数硬上限 24h 强杀 (GPU 模式跑满一天 ≈$27, 建议 GPU 会话给 --hours)
#
# 启动后终端会打印两个公网 HTTPS 隧道地址:
#   Panel  → ComfyCarry 面板 (5000), 打开后走向导部署 ComfyUI
#   ComfyUI → 8188, 面板部署完成前访问会 502, 属正常
#
# 存储布局 (混合: 代码本地盘 + 重资产落卷):
#   生产架构是无状态的 (无持久卷, 模型靠 rclone/CivitAI 同步), /workspace 本就是
#   容器本地盘。e2e 挂卷只为免去每次重新下载模型的痛苦。代码若放 FUSE 卷上,
#   Python import 小文件 I/O 会让 ComfyUI 启动慢至 ~4 分钟, 故:
#   - 容器本地盘 (每会话全新): ComfyUI 代码 (/opt/ComfyUI, /workspace/ComfyUI
#     软链指向它, 部署引擎因此跳过 20GB 复制)、面板代码 (每会话拉最新 main)、插件
#   - 卷 /vol/workspace (跨会话): models/ (模型)、comfy_output/ (出图)、
#     comfy_user/ (工作流)、panel_state/ (向导配置/部署进度/同步规则)、rclone/ (rclone 配置)
#   (Modal 禁止把卷挂到镜像内非空路径, 故通过软链接入而非直接挂载)
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


def _link_to_vol(local_path: str, vol_dir: str):
    """把镜像内目录替换为指向卷内目录的软链, 首次把镜像自带内容并入卷 (不覆盖)。"""
    if os.path.islink(local_path):
        return
    os.makedirs(vol_dir, exist_ok=True)
    subprocess.run(f"cp -an {local_path}/. {vol_dir}/ 2>/dev/null || true", shell=True)
    subprocess.run(["rm", "-rf", local_path], check=True)
    os.symlink(vol_dir, local_path)


def _prepare_workspace():
    """混合布局: 代码留容器本地盘 (贴近生产的无状态架构), 仅重资产落卷。

    /workspace 保持为容器本地目录 (与生产一致), ComfyUI 代码从本地盘
    import (FUSE 卷上启动要 ~4 分钟); 模型/出图/工作流/面板状态软链到卷。
    """
    vol = "/vol/workspace"

    # ── 旧布局迁移: 曾把整个 /workspace 落卷 (含 20GB ComfyUI 代码副本),
    #    抢救模型/出图/工作流后清理代码副本, 释放卷空间 ──
    old_comfy = f"{vol}/ComfyUI"
    if os.path.isdir(old_comfy) and not os.path.islink(old_comfy):
        for src, dst in ((f"{old_comfy}/models", f"{vol}/models"),
                         (f"{old_comfy}/output", f"{vol}/comfy_output"),
                         (f"{old_comfy}/user", f"{vol}/comfy_user")):
            if os.path.isdir(src) and not os.path.exists(dst):
                os.rename(src, dst)
        subprocess.run(["rm", "-rf", old_comfy, f"{vol}/ComfyCarry"], check=False)
    os.makedirs(f"{vol}/panel_state", exist_ok=True)
    for fname in (".setup_state.json", ".dashboard_env",
                  ".sync_rules.json", ".sync_settings.json"):
        old = f"{vol}/{fname}"
        if os.path.isfile(old) and not os.path.islink(old):
            os.rename(old, f"{vol}/panel_state/{fname}")

    # ── 模型 / 出图 / 工作流 → 卷 ──
    _link_to_vol("/opt/ComfyUI/models", f"{vol}/models")
    _link_to_vol("/opt/ComfyUI/output", f"{vol}/comfy_output")
    _link_to_vol("/opt/ComfyUI/user", f"{vol}/comfy_user")
    # 分离式架构 (Anima 等) 用到的目录, 镜像未预建
    for sub in ("diffusion_models", "text_encoders", "unet", "clip", "embeddings"):
        os.makedirs(f"{vol}/models/{sub}", exist_ok=True)

    # ── ComfyUI 本体: 软链让部署引擎跳过 cp -a /opt→/workspace 的 20GB 复制 ──
    if not os.path.exists("/workspace/ComfyUI"):
        os.symlink("/opt/ComfyUI", "/workspace/ComfyUI")

    # ── 面板状态 (向导配置/部署进度/同步规则) → 卷, 免每会话重跑向导 ──
    for fname in (".setup_state.json", ".dashboard_env",
                  ".sync_rules.json", ".sync_settings.json"):
        link = f"/workspace/{fname}"
        if not os.path.islink(link):
            if os.path.exists(link):
                subprocess.run(["mv", link, f"{vol}/panel_state/{fname}"], check=True)
            os.symlink(f"{vol}/panel_state/{fname}", link)
    # CivitAI 配置存于面板代码目录内 (config.py: CONFIG_FILE), 单独软链
    os.makedirs("/workspace/ComfyCarry", exist_ok=True)
    civ = "/workspace/ComfyCarry/.civitai_config.json"
    if not os.path.islink(civ):
        os.symlink(f"{vol}/panel_state/.civitai_config.json", civ)

    # ── rclone 配置 → 卷, 同步模块 e2e 免重配 ──
    _link_to_vol("/root/.config/rclone", f"{vol}/rclone")


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
        # 面板代码在容器本地盘, 每个会话都是全新下载的最新 main
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
    """纯 CPU 会话 (≈$0.11/h) — 仅验证面板 UI/交互。
    无 GPU 环境不做降级, ComfyUI 会拒绝启动 (崩溃退出), 属预期行为。
    hours=0 (默认) 不限时, 手动结束; 传 --hours N 到点自动收尾。"""
    _session(hours, "CPU only")
