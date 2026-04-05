"""
ComfyCarry — ComfyUI 版本管理服务

基于 git 操作实现版本列表、切换、更新功能。
参考 ComfyUI-Manager 的实现，增加了完整版本列表和依赖安装选项。
"""

import logging
import os
import re
import subprocess
from pathlib import Path

from ..config import COMFYUI_DIR

log = logging.getLogger(__name__)

# ── semver 解析 ──────────────────────────────────────────────

_SEMVER_RE = re.compile(r'^v(\d+)\.(\d+)\.(\d+)$')


def _parse_semver(tag: str) -> tuple[int, ...] | None:
    m = _SEMVER_RE.match(tag)
    return tuple(int(x) for x in m.groups()) if m else None


def _git(args: list[str], cwd: str | None = None, timeout: int = 60) -> str:
    """运行 git 命令并返回 stdout"""
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
        pass  # 没有配置也 OK
    try:
        _git(["config", "--global", "--add", "safe.directory", COMFYUI_DIR], cwd="/")
    except RuntimeError:
        pass


# ── 公开 API ─────────────────────────────────────────────────

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

    # fetch latest tags from remote
    if fetch:
        try:
            _git(["fetch", "--tags", "--force"])
        except (RuntimeError, subprocess.TimeoutExpired):
            log.warning("git fetch failed, using local tags only")

    # collect all semver tags, sorted descending
    raw_tags = _git(["tag", "--sort=-v:refname"]).splitlines()
    semver_tags = [t for t in raw_tags if _parse_semver(t)]

    latest = semver_tags[0] if semver_tags else None

    # detect current version
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
        {"ok": True, "message": "...", "previous": "...", "current": "..."}
    """
    if not Path(COMFYUI_DIR, ".git").exists():
        return {"ok": False, "error": "ComfyUI 不是 git 仓库，无法切换版本"}

    _ensure_safe_directory()

    previous = _detect_current_version()

    try:
        # stash dirty changes
        _stash_if_dirty()

        if tag == "nightly":
            # nightly = checkout master + pull
            _checkout_default_branch()
            _git(["pull", "--ff-only"])
            log.info("ComfyUI switched to nightly (master HEAD)")
        else:
            _git(["checkout", tag])
            log.info(f"ComfyUI switched to {tag}")

        # optional: install dependencies
        if install_deps:
            _install_requirements()

        current = _detect_current_version()
        return {
            "ok": True,
            "message": f"已切换到 {current}" + (" (已安装依赖)" if install_deps else ""),
            "previous": previous,
            "current": current,
        }
    except Exception as e:
        log.error(f"版本切换失败: {e}")
        return {"ok": False, "error": str(e)}


# ── 内部辅助 ─────────────────────────────────────────────────

def _detect_current_version() -> str:
    """检测当前 ComfyUI 版本"""
    try:
        # exact tag match
        return _git(["describe", "--tags", "--exact-match"])
    except RuntimeError:
        pass

    try:
        # nearest tag + offset
        described = _git(["describe", "--tags"])
        # check if HEAD is on default branch → nightly
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

    # fallback: short commit hash
    try:
        return _git(["rev-parse", "--short", "HEAD"])
    except RuntimeError:
        return "unknown"


def _stash_if_dirty():
    """如果工作区有未提交修改，自动 stash"""
    try:
        status = _git(["status", "--porcelain"])
        if status:
            _git(["stash"])
            log.info("Auto-stashed dirty changes")
    except RuntimeError:
        pass


def _checkout_default_branch():
    """切换到默认分支 (master/main)"""
    # try master first (ComfyUI uses master)
    for branch in ("master", "main"):
        try:
            _git(["checkout", branch])
            return
        except RuntimeError:
            continue
    raise RuntimeError("无法切换到默认分支 (master/main)")


def _install_requirements():
    """运行 pip install -r requirements.txt"""
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
    """检测可用的 Python 解释器"""
    for candidate in ("python3.12", "python3.11", "python3", "python"):
        try:
            subprocess.run([candidate, "--version"], capture_output=True, timeout=5)
            return candidate
        except (FileNotFoundError, subprocess.TimeoutExpired):
            continue
    return "python3"
