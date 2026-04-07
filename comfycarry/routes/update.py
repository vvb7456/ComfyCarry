"""
ComfyCarry — 热更新路由

端点:
  GET  /api/update/check    检查是否有新版本
  POST /api/update/apply    执行更新 (SSE 进度流)
"""

import json
import logging
import os
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

_REPO_OWNER = "vvb7456"
_REPO_NAME = "ComfyCarry"
_BRANCH = "main"

_GITHUB_API = f"https://api.github.com/repos/{_REPO_OWNER}/{_REPO_NAME}"
_TARBALL_URL = f"https://github.com/{_REPO_OWNER}/{_REPO_NAME}/archive/refs/heads/{_BRANCH}.tar.gz"
_DIST_URL = f"https://github.com/{_REPO_OWNER}/{_REPO_NAME}/releases/download/frontend-dist/frontend-dist.tar.gz"


def _current_commit() -> str:
    """读取当前部署的 commit hash"""
    version_file = os.path.join(SCRIPT_DIR, ".version")
    try:
        if os.path.exists(version_file):
            with open(version_file) as f:
                for line in f:
                    if line.strip().startswith("commit="):
                        return line.strip().split("=", 1)[1]
    except Exception:
        pass
    # fallback: git
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


# ====================================================================
# 检查更新
# ====================================================================

@bp.route("/api/update/check", methods=["GET"])
def api_update_check():
    """检查是否有新版本可用"""
    try:
        current = _current_commit()

        resp = req_lib.get(
            f"{_GITHUB_API}/commits/{_BRANCH}",
            headers={"Accept": "application/vnd.github.v3+json"},
            timeout=15,
        )
        resp.raise_for_status()
        data = resp.json()
        latest_sha = data.get("sha", "")
        latest_msg = data.get("commit", {}).get("message", "").split("\n")[0]
        latest_date = data.get("commit", {}).get("committer", {}).get("date", "")

        has_update = bool(latest_sha and current and latest_sha != current)

        # 获取远程版本号
        latest_version = ""
        if has_update:
            try:
                import re as _re
                raw = req_lib.get(
                    f"https://raw.githubusercontent.com/{_REPO_OWNER}/{_REPO_NAME}/{_BRANCH}/comfycarry/config.py",
                    timeout=10,
                )
                raw.raise_for_status()
                m = _re.search(r'APP_VERSION\s*=\s*"([^"]+)"', raw.text)
                if m:
                    latest_version = m.group(1)
            except Exception:
                pass

        return jsonify({
            "current_version": APP_VERSION,
            "current_commit": current[:8] if current else "",
            "latest_version": latest_version or APP_VERSION,
            "latest_commit": latest_sha[:8] if latest_sha else "",
            "latest_commit_full": latest_sha,
            "latest_message": latest_msg,
            "latest_date": latest_date,
            "has_update": has_update,
        }), 200

    except Exception as e:
        logger.error("update check failed: %s", e)
        return jsonify({"error": str(e)}), 500


# ====================================================================
# 执行更新
# ====================================================================

_update_lock = threading.Lock()
_update_running = False


@bp.route("/api/update/apply", methods=["POST"])
def api_update_apply():
    """执行热更新，返回 SSE 事件流"""
    global _update_running

    if _update_running:
        return jsonify({"error": "Update already running"}), 409

    if not _update_lock.acquire(blocking=False):
        return jsonify({"error": "Update already running"}), 409

    def sse_stream():
        global _update_running
        _update_running = True

        try:
            dashboard_dir = SCRIPT_DIR

            # Step 1: 下载仓库源码
            yield _sse("downloading", "Downloading source code...")
            tmp_tar = tempfile.NamedTemporaryFile(suffix=".tar.gz", delete=False)
            tmp_tar_path = tmp_tar.name
            tmp_tar.close()

            try:
                r = req_lib.get(_TARBALL_URL, stream=True, timeout=120)
                r.raise_for_status()
                with open(tmp_tar_path, "wb") as f:
                    for chunk in r.iter_content(65536):
                        f.write(chunk)
            except Exception as e:
                yield _sse("error", f"Download failed: {e}")
                return

            # Step 2: 解压
            yield _sse("extracting", "Extracting files...")
            tmp_extract = tempfile.mkdtemp()
            try:
                with tarfile.open(tmp_tar_path, "r:gz") as tf:
                    tf.extractall(tmp_extract)
            except Exception as e:
                yield _sse("error", f"Extract failed: {e}")
                return
            finally:
                os.unlink(tmp_tar_path)

            extracted = os.path.join(tmp_extract, f"{_REPO_NAME}-{_BRANCH}")
            if not os.path.isdir(extracted):
                yield _sse("error", "Unexpected archive structure")
                return

            # Step 3: 覆盖后端文件
            yield _sse("updating", "Updating backend...")
            src_pkg = os.path.join(extracted, "comfycarry")
            dst_pkg = os.path.join(dashboard_dir, "comfycarry")
            if os.path.isdir(src_pkg):
                shutil.rmtree(dst_pkg, ignore_errors=True)
                shutil.copytree(src_pkg, dst_pkg)

            # workspace_manager.py
            src_wm = os.path.join(extracted, "workspace_manager.py")
            if os.path.isfile(src_wm):
                shutil.copy2(src_wm, os.path.join(dashboard_dir, "workspace_manager.py"))

            # comfycarry_ws_broadcast/
            src_ws = os.path.join(extracted, "comfycarry_ws_broadcast")
            dst_ws = os.path.join(dashboard_dir, "comfycarry_ws_broadcast")
            if os.path.isdir(src_ws):
                shutil.rmtree(dst_ws, ignore_errors=True)
                shutil.copytree(src_ws, dst_ws)

            # data/ (prompt library DB etc.)
            src_data = os.path.join(extracted, "data")
            dst_data = os.path.join(dashboard_dir, "data")
            if os.path.isdir(src_data):
                shutil.rmtree(dst_data, ignore_errors=True)
                shutil.copytree(src_data, dst_data)

            # Step 4: 覆盖前端 dist
            yield _sse("updating", "Updating frontend...")
            src_static = os.path.join(extracted, "static")
            dst_static = os.path.join(dashboard_dir, "static")
            if os.path.isdir(src_static):
                shutil.rmtree(dst_static, ignore_errors=True)
                shutil.copytree(src_static, dst_static)

            # 下载前端构建产物 (从 GitHub Release)
            try:
                r = req_lib.get(_DIST_URL, stream=True, timeout=120)
                r.raise_for_status()
                dist_tar = tempfile.NamedTemporaryFile(suffix=".tar.gz", delete=False)
                for chunk in r.iter_content(65536):
                    dist_tar.write(chunk)
                dist_tar.close()
                with tarfile.open(dist_tar.name, "r:gz") as tf:
                    tf.extractall(os.path.join(dashboard_dir, "static"))
                os.unlink(dist_tar.name)
            except Exception as e:
                logger.warning("Frontend dist download failed (non-fatal): %s", e)
                yield _sse("warning", f"Frontend dist download failed: {e}")

            # Step 5: 更新版本文件
            yield _sse("updating", "Updating version info...")
            try:
                resp = req_lib.get(
                    f"{_GITHUB_API}/commits/{_BRANCH}",
                    headers={"Accept": "application/vnd.github.v3+json"},
                    timeout=10,
                )
                resp.raise_for_status()
                new_commit = resp.json().get("sha", "")
            except Exception:
                new_commit = ""

            # 读取新版本号
            new_config = os.path.join(dashboard_dir, "comfycarry", "config.py")
            new_version = APP_VERSION
            try:
                import re
                with open(new_config) as f:
                    m = re.search(r'APP_VERSION\s*=\s*"([^"]+)"', f.read())
                    if m:
                        new_version = m.group(1)
            except Exception:
                pass

            version_file = os.path.join(dashboard_dir, ".version")
            with open(version_file, "w") as f:
                f.write(f"version={new_version}\n")
                f.write(f"branch={_BRANCH}\n")
                f.write(f"commit={new_commit}\n")

            # Cleanup
            shutil.rmtree(tmp_extract, ignore_errors=True)

            # Step 6: 重启
            yield _sse("restarting", "Restarting dashboard...")
            yield _sse("done", f"Updated to {new_version} ({new_commit[:8]})")

            # 延迟重启，让 SSE 流完成
            def _delayed_restart():
                time.sleep(2)
                subprocess.run("pm2 restart dashboard", shell=True, timeout=15)

            threading.Thread(target=_delayed_restart, daemon=True).start()

        except Exception as e:
            logger.error("update apply error: %s", e)
            yield _sse("error", str(e))
        finally:
            _update_running = False
            _update_lock.release()

    return Response(
        sse_stream(),
        mimetype="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


def _sse(phase: str, message: str) -> str:
    return f"data: {json.dumps({'phase': phase, 'message': message}, ensure_ascii=False)}\n\n"
