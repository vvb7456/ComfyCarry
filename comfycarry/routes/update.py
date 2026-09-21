# 更新源为 GitHub 正式 Release (release.yml 发布的 latest), main 分支 push
# 不再触发更新 —— commit 与 release 解耦。
import json
import logging
import os
import re
import shutil
import subprocess
import tarfile
import tempfile
import threading
import time

import requests as req_lib
from flask import Blueprint, Response, jsonify

from ..config import APP_VERSION, SCRIPT_DIR

logger = logging.getLogger(__name__)

bp = Blueprint("update", __name__)


def _err(key: str, status: int = 400, /, **params):
    return jsonify({"error_key": f"settings.err.update.{key}",
                    "error_params": params}), status


_REPO_OWNER = "vvb7456"
_REPO_NAME = "ComfyCarry"

_GITHUB_API = f"https://api.github.com/repos/{_REPO_OWNER}/{_REPO_NAME}"
_LATEST_RELEASE_API = f"{_GITHUB_API}/releases/latest"

# Release asset 固定文件名 (release.yml 打包的完整部署 tarball)
_ASSET_NAME = "comfycarry-dist.tar.gz"

# tarball 内顶层目录名 (打包时 -C 父目录 comfycarry/)
_TARBALL_ROOT = "comfycarry"

_SEMVER_RE = re.compile(r"^v?(\d+)\.(\d+)\.(\d+)")


def _parse_semver(ver: str):
    m = _SEMVER_RE.match((ver or "").strip())
    if not m:
        return None
    return tuple(int(x) for x in m.groups())


def _is_newer(latest: str, current: str) -> bool:
    l, c = _parse_semver(latest), _parse_semver(current)
    if l is None or c is None:
        return bool(latest) and latest != current
    return l > c


def _read_version_file() -> dict:
    info = {}
    try:
        path = os.path.join(SCRIPT_DIR, ".version")
        if os.path.exists(path):
            with open(path) as f:
                for line in f:
                    line = line.strip()
                    if "=" in line:
                        k, v = line.split("=", 1)
                        info[k.strip().lower()] = v.strip()
    except Exception:
        pass
    return info


def _current_version() -> str:
    return _read_version_file().get("version") or APP_VERSION


def _current_commit() -> str:
    commit = _read_version_file().get("commit", "")
    if commit:
        return commit
    try:
        r = subprocess.run(
            ["git", "rev-parse", "HEAD"],
            capture_output=True, text=True, cwd=SCRIPT_DIR, timeout=3,
        )
        if r.returncode == 0:
            return r.stdout.strip()
    except Exception:
        pass
    return ""


def _fetch_latest_release() -> dict | None:
    resp = req_lib.get(
        _LATEST_RELEASE_API,
        headers={"Accept": "application/vnd.github.v3+json"},
        timeout=15,
    )
    resp.raise_for_status()
    return resp.json()


@bp.route("/api/update/check", methods=["GET"])
def api_update_check():
    try:
        current = _current_version()

        data = _fetch_latest_release()
        if not data:
            return _err("check_failed", 500, detail="no release found")

        latest_tag = data.get("tag_name", "")
        latest_name = data.get("name", "")
        latest_date = data.get("published_at", "")
        latest_msg = (data.get("body") or "").strip().split("\n")[0]

        asset_url = ""
        for asset in data.get("assets", []):
            if asset.get("name") == _ASSET_NAME:
                asset_url = asset.get("browser_download_url", "")
                break

        has_update = bool(latest_tag and asset_url and _is_newer(latest_tag, current))

        return jsonify({
            "current_version": current,
            "current_commit": _current_commit()[:8],
            "latest_version": latest_tag,
            "latest_name": latest_name,
            "latest_message": latest_msg,
            "latest_date": latest_date,
            "has_update": has_update,
        }), 200

    except Exception as e:
        logger.error("update check failed: %s", e)
        return _err("check_failed", 500, detail=str(e))


_update_lock = threading.Lock()
_update_running = False

# 部署包内的目录型组件 (相对路径)
_PACKAGE_DIRS = ("comfycarry", "comfycarry_ws_broadcast", "data", os.path.join("static", "dist"))
# 部署包内的单文件组件
_PACKAGE_FILES = ("workspace_manager.py", "favicon.ico")


def _swap_dir(src: str, dst: str) -> None:
    """目录级原子交换: dst → dst.bak, src → dst, 成功后删 bak; 失败自动还原 dst。

    交换期间 dst 短暂不存在 (几十毫秒, 同一分区内 rename), 相比
    rmtree+copytree 的长窗口已大幅收窄; 且任一步失败不会留下半新半旧状态。
    """
    bak = dst + ".bak"
    shutil.rmtree(bak, ignore_errors=True)
    had_old = os.path.isdir(dst)
    if had_old:
        os.rename(dst, bak)
    try:
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        os.rename(src, dst)
    except OSError:
        # 落位失败: 还原旧目录, 保证面板仍可运行
        if had_old and not os.path.isdir(dst):
            os.rename(bak, dst)
        raise
    shutil.rmtree(bak, ignore_errors=True)


def _swap_file(src: str, dst: str) -> None:
    os.replace(src, dst)


def _apply_update(extracted: str, dashboard_dir: str) -> None:
    """把解压出的部署包内容交换进面板根。

    先做一遍「存在性 + 可读」预检, 再逐项交换; 交换顺序为低风险文件
    (favicon/workspace_manager) → 前端 dist → 后端包, 全程失败即抛出,
    已交换的目录项由 _swap_dir 自身的还原逻辑兜底。
    """
    # 预检: 所有待交换内容都在解压目录里就位 (提前暴露打包缺项, 避免中途失败)
    for rel in _PACKAGE_DIRS:
        src = os.path.join(extracted, rel)
        if os.path.isdir(src):
            # 触发实际读取, 确保解压产物可访问
            for _root, _dirs, files in os.walk(src):
                for f in files:
                    os.stat(os.path.join(_root, f))
    for rel in _PACKAGE_FILES:
        src = os.path.join(extracted, rel)
        if os.path.isfile(src):
            with open(src, "rb") as f:
                f.read(1)

    # 单文件: 低风险先换
    for rel in _PACKAGE_FILES:
        src = os.path.join(extracted, rel)
        if os.path.isfile(src):
            _swap_file(src, os.path.join(dashboard_dir, rel))

    # 目录: 前端 dist 先换 (纯静态, 不影响运行中的后端), 后端包最后
    for rel in (os.path.join("static", "dist"), "data", "comfycarry_ws_broadcast", "comfycarry"):
        src = os.path.join(extracted, rel)
        dst = os.path.join(dashboard_dir, rel)
        if os.path.isdir(src):
            _swap_dir(src, dst)


@bp.route("/api/update/apply", methods=["POST"])
def api_update_apply():
    global _update_running

    if _update_running:
        return _err("already_running", 409)

    if not _update_lock.acquire(blocking=False):
        return _err("already_running", 409)

    def sse_stream():
        global _update_running
        _update_running = True

        tmp_extract = None
        tmp_tar_path = None
        try:
            dashboard_dir = SCRIPT_DIR

            yield _sse("downloading", "Fetching latest release...")
            try:
                release = _fetch_latest_release()
                latest_tag = (release or {}).get("tag_name", "")
                asset_url = ""
                for asset in (release or {}).get("assets", []):
                    if asset.get("name") == _ASSET_NAME:
                        asset_url = asset.get("browser_download_url", "")
                        break
                if not latest_tag or not asset_url:
                    yield _sse("error", "Release asset not found")
                    return
            except Exception as e:
                yield _sse("error", f"Fetch release failed: {e}")
                return

            yield _sse("downloading", f"Downloading {latest_tag}...")
            tmp_tar = tempfile.NamedTemporaryFile(suffix=".tar.gz", delete=False)
            tmp_tar_path = tmp_tar.name
            tmp_tar.close()

            try:
                r = req_lib.get(asset_url, stream=True, timeout=300)
                r.raise_for_status()
                with open(tmp_tar_path, "wb") as f:
                    for chunk in r.iter_content(65536):
                        f.write(chunk)
            except Exception as e:
                yield _sse("error", f"Download failed: {e}")
                return

            yield _sse("extracting", "Extracting files...")
            tmp_extract = tempfile.mkdtemp()
            try:
                with tarfile.open(tmp_tar_path, "r:gz") as tf:
                    tf.extractall(tmp_extract)
            except Exception as e:
                yield _sse("error", f"Extract failed: {e}")
                return

            extracted = os.path.join(tmp_extract, _TARBALL_ROOT)
            if not os.path.isdir(extracted):
                yield _sse("error", "Unexpected archive structure")
                return

            # Step 4/5: 逐项交换覆盖 —— 先把新内容挪到面板根旁的 .staging,
            # 再 备份旧目录 → rename 新目录落位 → 任一步失败回滚,
            # 避免 rmtree 后 copytree 中途失败留下半新半旧的损坏状态
            yield _sse("updating", "Updating files...")
            _apply_update(extracted, dashboard_dir)

            yield _sse("updating", "Updating version info...")
            new_version = latest_tag
            new_commit = ""
            try:
                resp = req_lib.get(
                    f"{_GITHUB_API}/commits/{latest_tag}",
                    headers={"Accept": "application/vnd.github.v3+json"},
                    timeout=10,
                )
                resp.raise_for_status()
                new_commit = resp.json().get("sha", "")
            except Exception:
                pass

            version_file = os.path.join(dashboard_dir, ".version")
            with open(version_file, "w") as f:
                f.write(f"version={new_version}\n")
                f.write(f"branch=\n")
                f.write(f"commit={new_commit}\n")

            shutil.rmtree(tmp_extract, ignore_errors=True)
            tmp_extract = None

            yield _sse("restarting", "Restarting dashboard...")
            yield _sse("done", f"Updated to {new_version}")

            # 延迟重启，让 SSE 流完成
            def _delayed_restart():
                time.sleep(2)
                subprocess.run("pm2 restart dashboard", shell=True, timeout=15)

            threading.Thread(target=_delayed_restart, daemon=True).start()

        except Exception as e:
            logger.error("update apply error: %s", e)
            yield _sse("error", str(e))
        finally:
            if tmp_tar_path:
                try:
                    os.unlink(tmp_tar_path)
                except OSError:
                    pass
            if tmp_extract:
                shutil.rmtree(tmp_extract, ignore_errors=True)
            _update_running = False
            _update_lock.release()

    return Response(
        sse_stream(),
        mimetype="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


def _sse(phase: str, message: str) -> str:
    return f"data: {json.dumps({'phase': phase, 'message': message}, ensure_ascii=False)}\n\n"