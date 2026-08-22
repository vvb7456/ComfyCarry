"""
ComfyCarry — ComfyUI 启动参数校验

以磁盘上已安装的 ComfyUI 源码 (comfy/cli_args.py) 为准, 实时提取 argparse
定义, 对启动参数做全量校验: 当前版本不存在的 flag (无论面板生成还是用户在
extra_args 里手写) 都会让 ComfyUI 因 unrecognized arguments 起不来并被
pm2 反复拉起, 启动/重启前先在这里拦截。

与面板参数表完全解耦 —— 上游文件是唯一事实来源。
"""

import json
import shlex
import subprocess

from ..config import COMFYUI_DIR


# cli_args.py 自 2023-04 起就是模块级 parser + 模块级 parse_args(), 且刻意
# 不 import torch (dump 耗时 <0.1s)。必须先把 sys.argv 清成 main.py 再
# import —— 模块级 parse_args() 会吃掉本进程的命令行参数。
_DUMP_SCRIPT = r"""
import json, sys
sys.argv = ["main.py"]
try:
    from comfy import cli_args
except Exception:
    print(json.dumps(None))
    raise SystemExit(0)
flags = set()
for a in cli_args.parser._actions:
    flags.update(a.option_strings)
print(json.dumps(sorted(flags)))
"""


def dump_cli_flags(python: str) -> set[str]:
    """从已安装的 ComfyUI 提取全部 CLI flag。任何失败都抛 RuntimeError。

    dump 失败只有一种解释: 磁盘上的 ComfyUI 安装损坏/缺失 —— 这种环境里
    ComfyUI 本身也起不来, 由调用方按校验不通过拒绝操作。
    """
    try:
        r = subprocess.run(
            [python, "-c", _DUMP_SCRIPT],
            cwd=COMFYUI_DIR, capture_output=True, text=True, timeout=15,
        )
    except (OSError, subprocess.TimeoutExpired) as e:
        raise RuntimeError(f"dump cli args failed: {e}") from e
    try:
        data = json.loads(r.stdout.strip() or "null")
    except ValueError as e:
        raise RuntimeError(f"dump cli args bad output: {r.stdout[:200]!r}") from e
    if data is None:
        raise RuntimeError("cannot import comfy.cli_args")
    return set(data)


def check_comfyui_args(args_str: str, python: str) -> tuple[bool, list[str]]:
    """校验 args_str 中全部 flag 是否被当前安装的 ComfyUI 支持。

    返回 (ok, unsupported):
      ok=False          — 无法读取 ComfyUI 参数定义 (安装损坏等), 一律拒绝;
      ok=True, []       — 全部通过;
      ok=True, [flags]  — 当前版本不存在的 flag, 应拒绝并提示用户。
    """
    try:
        available = dump_cli_flags(python)
    except Exception:
        return False, []
    try:
        tokens = shlex.split(args_str or "")
    except ValueError:
        return True, []
    # "--flag=value" 取 = 前半段比对; 裸 "-" / "--" 是分隔符不是 flag
    flags = [t.split("=", 1)[0] for t in tokens
             if t.startswith("-") and t not in ("-", "--")]
    return True, sorted(f for f in set(flags) if f not in available)
