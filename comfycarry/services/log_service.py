"""
ComfyCarry - 日志服务

统一各处日志面板的取数逻辑:
- history: 按行号游标分页读取日志文件 (末尾 N 行 / 某行之前 N 行), strip ANSI。
- stream:  tail -f 文件追加, strip ANSI, 空文件也立刻 onopen (不卡 loading)。

"历史"语义: 不按进程启动边界裁剪, 而是初始给末尾 N 行, 用户往上滚懒加载更早的,
边界交还用户决定 (排障时上下文肉眼可辨)。服务没跑时日志文件仍在磁盘, 照常读/tail,
用户总能看到日志 -- 比判断进程状态再决定显不显示更简单也更实用。
"""
import json
import os
import re
import subprocess

ANSI_RE = re.compile(r'\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07]*\x07|\x1b[()][AB012]|\x1b[=>]|\x1b.')

# pm2 注入到被管理进程环境变量的日志路径 key, 调 pm2 start 时需清掉这些,
# 否则它们覆盖 --log 命令行参数, 导致新进程日志写到调用者的路径而非指定路径。
_PM2_ENV_KEYS = ("pm_log_path", "pm_out_log_path", "pm_err_log_path", "pm_pid_path")


def clean_pm2_env(env: dict | None = None) -> dict:
    """返回去掉了 pm2 注入日志路径的环境变量副本。"""
    src = env if env is not None else os.environ
    out = {k: v for k, v in src.items() if not k.startswith(_PM2_ENV_KEYS)}
    out.pop("merge_logs", None)
    return out


def strip_ansi(s: str) -> str:
    return ANSI_RE.sub('', s)


def _classify(line: str) -> str:
    """优先尝试 JSON parse 取 level (sync JSONL), 否则正则匹配 (纯文本日志)。"""
    try:
        obj = json.loads(line)
        if isinstance(obj, dict) and 'level' in obj:
            return obj['level']
    except (ValueError, TypeError):
        pass
    if re.search(r'error|exception|traceback|fatal', line, re.I):
        return 'error'
    if re.search(r'warn', line, re.I):
        return 'warn'
    return 'info'


_line_count_cache: dict[str, tuple[int, int]] = {}  # path -> (size, total_lines)


def _count_lines(path: str) -> int:
    """数文件行数, append-only 场景下增量计数 (记住上次 size/total, 只数新增部分)。
    文件缩小 (轮转) 时重新全量计数。"""
    try:
        size = os.path.getsize(path)
    except OSError:
        return 0
    cached = _line_count_cache.get(path)
    if cached and cached[0] <= size:
        # 增量: 从上次读到的位置继续数新增行
        prev_size, prev_total = cached
        if prev_size == size:
            return prev_total
        try:
            with open(path, 'rb') as f:
                f.seek(prev_size)
                new_lines = sum(1 for _ in f)
            total = prev_total + new_lines
        except OSError:
            total = 0
    else:
        # 全量或轮转后重数
        try:
            with open(path, 'rb') as f:
                total = sum(1 for _ in f)
        except OSError:
            total = 0
    _line_count_cache[path] = (size, total)
    return total


def read_history(path: str, before: int | None = None, lines: int = 100, filter_re: re.Pattern | None = None) -> dict:
    """读日志文件 history。

    - before=None: 返回文件末尾 ``lines`` 行。
    - before=K:    返回第 K 行 (1-based, 含) 之前的 ``lines`` 行, 即 [K-lines, K)。

    返回 ``{"entries": [{"line": 行号, "text": ..., "level": ...}], "total": 文件总行数}``。
    文件不存在或为空时 entries 为空, total 为 0。
    """
    lines = max(1, min(lines, 1000))
    if not os.path.exists(path):
        return {"entries": [], "total": 0}

    total = _count_lines(path)

    if total == 0:
        return {"entries": [], "total": 0}

    if before is None:
        start = max(1, total - lines + 1)
        end = total
    else:
        end = max(0, min(before - 1, total))
        start = max(1, end - lines + 1)
        if end < start:
            return {"entries": [], "total": total}

    # sed -n 'start,end p'  (1-based, 含两端)
    try:
        proc = subprocess.run(
            ["sed", "-n", f"{start},{end}p", path],
            capture_output=True, text=True, timeout=5,
        )
        raw = proc.stdout
    except Exception:
        return {"entries": [], "total": total}

    entries = []
    lineno = start
    for ln in raw.splitlines():
        text = strip_ansi(ln)
        if text:
            if filter_re and filter_re.search(text):
                lineno += 1
                continue
            entries.append({"line": lineno, "text": text, "level": _classify(text)})
        lineno += 1
    return {"entries": entries, "total": total}


def stream_tail(path: str, filter_re: re.Pattern | None = None):
    """tail -f 生成器: 先回吐末尾 0 行 (仅新行), 持续追加。

    文件不存在时先 touch, 保证 tail -f 能立刻打开 -> SSE onopen 触发, 不卡 loading。
    strip ANSI + level 分类, yield SSE data 行。
    filter_re: 可选正则, 匹配的行被过滤掉 (如 cloudflared 噪音)。
    """
    if not os.path.exists(path):
        try:
            open(path, "w").close()
        except OSError:
            pass

    proc = None
    try:
        proc = subprocess.Popen(
            ["tail", "-n", "0", "-F", path],
            stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
            text=True, bufsize=1,
        )
        for line in iter(proc.stdout.readline, ''):
            if not line:
                break
            text = strip_ansi(line.rstrip('\n'))
            if not text:
                continue
            if filter_re and filter_re.search(text):
                continue
            yield f"data: {json.dumps({'line': text, 'level': _classify(text)}, ensure_ascii=False)}\n\n"
    except GeneratorExit:
        pass
    finally:
        if proc:
            try:
                proc.kill()
                proc.stdout.close()
                proc.wait(timeout=5)
            except Exception:
                pass
