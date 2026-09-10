"""
ComfyCarry — Wizard 草稿 (服务端内存会话态)

架构语义 (与 .setup_state.json 的分工):
- 内存草稿 = 向导会话进行中的唯一事实源 (当前只有 wizard_remotes 凭据计划)
- .setup_state.json = 提交部署时的计划快照; 编辑草稿不覆盖部署计划
- deploy 提交时内存草稿并入 state 落盘 (此刻起它属于部署快照)
- dashboard 判断 setup 完成状态 (_is_setup_complete / _restore_comfyui)
  读文件, 与本模块无关

进程重启 (含 pm2 restart) 后，失败部署会话可从快照懒恢复；无部署进度时重启
更无影响 (会话本就该从头开始)。
"""

import threading
from copy import deepcopy

_lock = threading.Lock()
# 草稿是否已从失败会话快照恢复 (进程启动后懒恢复一次)
_restored = False
_draft_remotes: list[dict] = []


def _restore_from_snapshot():
    """进程启动后的懒恢复: 仅「部署失败」快照才有恢复价值。

    部署成功 → 无会话可恢复; 从未部署 → 无快照凭据。两者都保持空草稿。
    """
    global _restored, _draft_remotes
    if _restored:
        return
    from ..config import _load_setup_state
    state = _load_setup_state()
    # 包含进程被中断、来不及写入 deploy_error 的未完成部署。
    if state.get("deploy_started") and not state.get("deploy_completed"):
        remotes = state.get("wizard_remotes") or []
        _draft_remotes = [r for r in remotes if isinstance(r, dict)]
    _restored = True


def get_remotes() -> list[dict]:
    """读内存草稿 (含失败会话懒恢复)。返回内部引用, 调用方只读。"""
    with _lock:
        _restore_from_snapshot()
        return _draft_remotes


def find_remote(name: str) -> dict | None:
    with _lock:
        _restore_from_snapshot()
        for r in _draft_remotes:
            if isinstance(r, dict) and r.get("name") == name:
                return r
    return None


def upsert_remote(remote: dict):
    """写入/同名原地替换草稿 (单存储语义: 由调用方保证收敛)。"""
    global _draft_remotes
    with _lock:
        _restore_from_snapshot()
        name = remote.get("name")
        _draft_remotes = [r for r in _draft_remotes
                          if not (isinstance(r, dict) and r.get("name") == name)]
        _draft_remotes.append(remote)


def remove_remote(name: str):
    global _draft_remotes
    with _lock:
        _restore_from_snapshot()
        _draft_remotes = [r for r in _draft_remotes
                          if not (isinstance(r, dict) and r.get("name") == name)]


def reset(remotes: list[dict] | None = None):
    """页面加载时放弃未提交编辑；未完成部署的会话从计划快照重新开始。"""
    global _restored, _draft_remotes
    with _lock:
        _restored = True
        _draft_remotes = deepcopy(remotes or [])


def mirror_names(names: list[str]) -> list[dict]:
    """按前端镜像过滤草稿 (deploy 提交: 镜像外的草稿条目 = 用户放弃的)。"""
    global _draft_remotes
    with _lock:
        _restore_from_snapshot()
        _draft_remotes = [r for r in _draft_remotes
                          if isinstance(r, dict) and r.get("name") in set(names)]
        return _draft_remotes
