#!/usr/bin/env bash
set -Eeuo pipefail

if [[ ${1:-} == --help || ${1:-} == -h ]]; then
    echo "用法：bash colab-forward.sh [本地端口] [远端面板端口]"
    echo "默认：本地 15000 → 远端 5000；按 Ctrl+C 结束转发。"
    exit 0
fi
if (( $# > 2 )); then
    echo "最多指定本地端口和远端面板端口。" >&2
    exit 2
fi
local_port="${1:-15000}"
remote_port="${2:-5000}"
for port in "$local_port" "$remote_port"; do
    if [[ ! "$port" =~ ^[0-9]{1,5}$ ]] || (( 10#$port < 1 || 10#$port > 65535 )); then
        echo "端口必须是 1–65535 的整数。" >&2
        exit 2
    fi
done
local_port=$((10#$local_port))
remote_port=$((10#$remote_port))

if ! cli_path="$(command -v colab)" || ! command -v ssh >/dev/null; then
    echo "需要已安装并登录的 Google Colab CLI，以及 ssh 命令。" >&2
    exit 1
fi
cli_path="$(readlink -f "$cli_path")"
python="$(head -n 1 "$cli_path")"
python="${python#\#!}"
if [[ "$python" == "/usr/bin/env "* ]]; then
    python="$(command -v "${python##* }")"
fi
if [[ ! -x "$python" ]]; then
    echo "无法定位 Colab CLI 的 Python，请使用 pip 或 uv 安装的 colab 命令。" >&2
    exit 1
fi

temp_dir="$(mktemp -d "${TMPDIR:-/tmp}/comfycarry-colab-forward.XXXXXX")"
trap 'rm -rf -- "$temp_dir"' EXIT
session_file="$temp_dir/sessions.json"

"$python" - "$session_file" <<'PY'
import json
import sys
from pathlib import Path

from colab_cli.common import state
from colab_cli.state import SessionState

try:
    runtimes = sorted(state.client.list_assignments(), key=lambda item: item.endpoint)
except Exception:
    raise SystemExit("无法读取运行时列表，请先确认 colab sessions 能正常执行。")
if not runtimes:
    raise SystemExit("当前登录账号没有正在运行的运行时；未创建任何实例。")

print("当前运行时：", flush=True)
for index, runtime in enumerate(runtimes, 1):
    hardware = "CPU" if runtime.accelerator.value == "NONE" else runtime.accelerator.value
    shape = "高内存" if runtime.machine_shape.name == "HIGH_RAM" else "标准内存"
    print(f"  {index}. {runtime.endpoint} | {hardware} | {shape}", flush=True)

# Python 源码由标准输入传入，交互选择必须从终端读取。
try:
    terminal = open("/dev/tty")
except OSError:
    raise SystemExit("请在本机 WSL/Linux 的交互终端运行此脚本。")
with terminal:
    while True:
        print(f"选择运行时编号（1–{len(runtimes)}，q 退出）：", end="", flush=True)
        answer = terminal.readline().strip()
        if not answer or answer.lower() == "q":
            raise SystemExit(0)
        if answer.isascii() and answer.isdigit() and 1 <= int(answer) <= len(runtimes):
            runtime = runtimes[int(answer) - 1]
            break
        print("请输入列表中的编号。", flush=True)

session = SessionState(
    name="comfycarry-forward",
    endpoint=runtime.endpoint,
    token=runtime.runtime_proxy_info.token,
    url=runtime.runtime_proxy_info.url,
    variant=runtime.variant.name,
    accelerator=runtime.accelerator.value,
    machine_shape=runtime.machine_shape.name,
)
Path(sys.argv[1]).write_text(
    json.dumps({session.name: session.model_dump(mode="json")}), encoding="utf-8"
)
print(f"已选择：{runtime.endpoint}", flush=True)
PY

[[ -s "$session_file" ]] || exit 0
printf -v proxy '%q --config %q ssh --proxy-mode -s comfycarry-forward' "$cli_path" "$session_file"
echo "连接成功后访问：http://localhost:$local_port"
echo "远端面板端口：$remote_port；保持本终端打开，按 Ctrl+C 结束，不会停止运行时。"
ssh -N -T \
    -L "127.0.0.1:$local_port:127.0.0.1:$remote_port" \
    -o ExitOnForwardFailure=yes \
    -o ServerAliveInterval=30 \
    -o ServerAliveCountMax=3 \
    -o StrictHostKeyChecking=no \
    -o UserKnownHostsFile=/dev/null \
    -o "ProxyCommand=$proxy" \
    root@colab-runtime
