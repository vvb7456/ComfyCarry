"""
ComfyCarry — ComfyUI 版本管理服务

参考 ComfyUI-Manager 的实现，增加了完整版本列表和依赖安装选项。
"""

import logging
import os
import re
import subprocess
from pathlib import Path

from ..config import COMFYUI_DIR

log = logging.getLogger(__name__)

_SEMVER_RE = re.compile(r'^v(\d+)\.(\d+)\.(\d+)$')


def _parse_semver(tag: str) -> tuple[int, ...] | None:
    m = _SEMVER_RE.match(tag)
    return tuple(int(x) for x in m.groups()) if m else None


def _git(args: list[str], cwd: str | None = None, timeout: int = 60) -> str:
    result = subprocess.run(
        ["git"] + args,
        cwd=cwd or COMFYUI_DIR,
        capture_output=True, text=True, timeout=timeout,
    )
    if result.returncode != 0:
        raise RuntimeError(f"git {' '.join(args)} failed: {result.stderr.strip()}")
    return result.stdout.strip()


def _ensure_safe_directory():
    """确保 COMFYUI_DIR 在 git safe.directory 中 (Docker uid 不匹配修复)"""
    try:
        _git(["config", "--global", "--get-all", "safe.directory"], cwd="/")
    except RuntimeError:
        pass
    try:
        _git(["config", "--global", "--add", "safe.directory", COMFYUI_DIR], cwd="/")
    except RuntimeError:
        pass


def get_versions(fetch: bool = True) -> dict:
    """
    获取所有可用的 ComfyUI 版本。

    Returns:
        {
            "versions": ["v0.18.5", "v0.18.4", ...],  # semver 降序
            "current": "v0.18.5" | "nightly" | "v0.16.4-3-ge4b0bb83",
            "latest": "v0.18.5" | null,
            "has_git": true
        }
    """
    if not Path(COMFYUI_DIR, ".git").exists():
        return {"versions": [], "current": None, "latest": None, "has_git": False}

    _ensure_safe_directory()

    if fetch:
        try:
            _git(["fetch", "--tags", "--force"])
        except (RuntimeError, subprocess.TimeoutExpired):
            log.warning("git fetch failed, using local tags only")

    raw_tags = _git(["tag", "--sort=-v:refname"]).splitlines()
    semver_tags = [t for t in raw_tags if _parse_semver(t)]

    latest = semver_tags[0] if semver_tags else None

    current = _detect_current_version()

    return {
        "versions": semver_tags,
        "current": current,
        "latest": latest,
        "has_git": True,
    }


def switch_version(tag: str, install_deps: bool = False) -> dict:
    """
    切换 ComfyUI 到指定版本。

    Args:
        tag: 版本 tag (e.g. "v0.18.5") 或 "nightly"
        install_deps: 切换后是否运行 pip install -r requirements.txt

    Returns:
        {"ok": True, "message_key": "...", "message_params": {...},
         "previous": "...", "current": "..."}
        {"ok": False, "error_key": "..."}  (error_params 里的 detail 是原始异常)

        文案一律 key + params: 这个结果由路由原样回传给面板, 回中文成品文案
        的话英文 locale 下 toast 里会冒中文。
    """
    if not Path(COMFYUI_DIR, ".git").exists():
        return {"ok": False, "error_key": "comfyui.err.switch_not_git"}

    _ensure_safe_directory()

    previous = _detect_current_version()

    try:
        _stash_if_dirty()

        if tag == "nightly":
            _checkout_default_branch()
            _git(["pull", "--ff-only"])
            log.info("ComfyUI switched to nightly (master HEAD)")
        else:
            _git(["checkout", tag])
            log.info(f"ComfyUI switched to {tag}")

        if install_deps:
            _install_requirements()

        current = _detect_current_version()
        return {
            "ok": True,
            "message_key": ("comfyui.msg.switched_with_deps" if install_deps
                            else "comfyui.msg.switched"),
            "message_params": {"version": current},
            "previous": previous,
            "current": current,
        }
    except Exception as e:
        log.error(f"版本切换失败: {e}")
        return {"ok": False, "error_key": "comfyui.err.switch_failed",
                "error_params": {"detail": str(e)}}


# ── 内部辅助 ─────────────────────────────────────────────────

def _detect_current_version() -> str:
    try:
        return _git(["describe", "--tags", "--exact-match"])
    except RuntimeError:
        pass

    try:
        described = _git(["describe", "--tags"])
        try:
            remote_head = _git(["rev-parse", "origin/HEAD"]).strip()
            local_head = _git(["rev-parse", "HEAD"]).strip()
            if remote_head == local_head:
                return "nightly"
        except RuntimeError:
            pass
        return described
    except RuntimeError:
        pass

    try:
        return _git(["rev-parse", "--short", "HEAD"])
    except RuntimeError:
        return "unknown"


def _stash_if_dirty():
    try:
        status = _git(["status", "--porcelain"])
        if status:
            _git(["stash"])
            log.info("Auto-stashed dirty changes")
    except RuntimeError:
        pass


def _checkout_default_branch():
    # try master first (ComfyUI uses master)
    for branch in ("master", "main"):
        try:
            _git(["checkout", branch])
            return
        except RuntimeError:
            continue
    raise RuntimeError("无法切换到默认分支 (master/main)")


def _install_requirements():
    req_path = Path(COMFYUI_DIR, "requirements.txt")
    if not req_path.exists():
        return

    python = _detect_python_bin()
    try:
        subprocess.run(
            [python, "-m", "pip", "install", "-r", str(req_path)],
            cwd=COMFYUI_DIR, timeout=300,
            capture_output=True, text=True,
        )
        log.info("pip install -r requirements.txt completed")
    except subprocess.TimeoutExpired:
        log.warning("pip install timed out after 300s")


def _detect_python_bin() -> str:
    for candidate in ("python3.12", "python3.11", "python3", "python"):
        try:
            subprocess.run([candidate, "--version"], capture_output=True, timeout=5)
            return candidate
        except (FileNotFoundError, subprocess.TimeoutExpired):
            continue
    return "python3"
