#!/usr/bin/env python3
"""refresh_component_sizes.py — 校对/刷新前端配置中组件文件的 HuggingFace 真实体积。

扫描 frontend/src/config/component-registry.ts 与
frontend/src/composables/generate/modelDepConfigs.ts，用正则提取所有
HuggingFace 下载 URL，调用 HF API 批量查询每个文件真实体积，
与源码中声明的体积做比对并打印对照表。

默认只读不写；传入 --write 时才会就地回写实测体积 (最小化正则替换，
保持其余字符不变)。有任一文件超出 5% 容差时退出码 1，便于 CI 卡点。

用法示例:
  python3 scripts/refresh_component_sizes.py          # 只校验, 打印对照表
  python3 scripts/refresh_component_sizes.py --write  # 校验并回写实测体积
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import urllib.error
import urllib.request
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
TARGETS = [
    REPO_ROOT / "frontend" / "src" / "config" / "component-registry.ts",
    REPO_ROOT / "frontend" / "src" / "composables" / "generate" / "modelDepConfigs.ts",
]
TOLERANCE = 0.05  # 5%
TIMEOUT = 25

# HuggingFace 下载 URL 正则: 捕获 owner/repo / revision / path
# path 部分排除 '?' 使其贪婪匹配到 ?download=true 之前
HF_URL_RE = re.compile(
    r"https://huggingface\.co/([^/\s]+/[^/\s]+)/resolve/([^/\s]+)/([^\s'\"?]+)(?:\?download=true)?"
)

# component-registry.ts: bytes: <整数>
BYTES_RE = re.compile(r"bytes:\s*(\d+)")

# modelDepConfigs.ts: size: '~X.X GB' 或 '~XXX MB'
SIZE_STR_RE = re.compile(r"size:\s*'~([\d.]+)\s*(GB|MB)'", re.IGNORECASE)


def human_to_bytes(value: float, unit: str) -> int:
    if unit.upper() == "GB":
        return int(round(value * 1_000_000_000))
    return int(round(value * 1_000_000))


def bytes_to_human(v: int) -> str:
    if v >= 1_000_000_000:
        return f"~{v / 1e9:.2f} GB"
    return f"~{round(v / 1e6)} MB"


def parse_hf_url(url: str) -> tuple[str, str, str] | None:
    m = HF_URL_RE.search(url)
    if not m:
        return None
    return m.group(1), m.group(2), m.group(3)


def fetch_sizes(repo_id: str, revision: str, paths: list[str]) -> dict[str, int | None]:
    """调用 HF paths-info API 批量查询体积。返回 {path: size or None}。"""
    api_url = f"https://huggingface.co/api/models/{repo_id}/paths-info/{revision}"
    body = json.dumps({"paths": paths}).encode("utf-8")
    headers = {"Content-Type": "application/json"}
    token = os.environ.get("HF_TOKEN")
    if token:
        headers["Authorization"] = f"Bearer {token}"
    req = urllib.request.Request(api_url, data=body, headers=headers, method="POST")
    result: dict[str, int | None] = {p: None for p in paths}
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
            data = json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        print(f"  [错误] {repo_id}@{revision} HTTP {e.code}: {e.reason}")
        return result
    except Exception as e:  # noqa: BLE001
        print(f"  [错误] {repo_id}@{revision} 请求失败: {e}")
        return result
    if isinstance(data, list):
        for item in data:
            p = item.get("path")
            s = item.get("size")
            if p and s is not None:
                result[p] = int(s)
    return result


def extract_entries(text: str, source_name: str) -> list[dict]:
    """从源码文本提取每个 HF URL 及其关联的体积声明。

    - component-registry.ts: 每个文件条目内有 bytes: <整数> (在 URL 之后)。
      向前搜索下一个 URL (或文件末尾) 之前最近的 bytes:。
    - modelDepConfigs.ts: size: '~X GB' 在模型级别、files 数组之前 (即 URL 之前)。
      向后搜索 URL 之前最近的 size: 声明。多文件模型共享同一 size:。
    """
    is_component_registry = "component-registry" in source_name
    url_matches = list(HF_URL_RE.finditer(text))
    if not url_matches:
        return []

    entries: list[dict] = []
    n = len(url_matches)

    if is_component_registry:
        for i, um in enumerate(url_matches):
            url = um.group(0)
            url_end = um.end()
            next_url_start = url_matches[i + 1].start() if i + 1 < n else len(text)
            sm = BYTES_RE.search(text, url_end, next_url_start)
            if not sm:
                print(f"  [警告] {source_name}: URL 后未找到 bytes 声明 ({url})")
                continue
            line_no = text.count("\n", 0, um.start()) + 1
            entries.append(
                {
                    "url": url,
                    "declared": int(sm.group(1)),
                    "declared_raw": sm.group(1),
                    "span": (sm.start(1), sm.end(1)),
                    "kind": "bytes",
                    "line": line_no,
                }
            )
    else:
        size_matches = list(SIZE_STR_RE.finditer(text))
        for um in url_matches:
            url = um.group(0)
            url_start = um.start()
            # 向后搜索: URL 之前最近的 size: 声明
            best_sm = None
            for sm in size_matches:
                if sm.end() <= url_start:
                    if best_sm is None or sm.start() > best_sm.start():
                        best_sm = sm
            if best_sm is None:
                print(f"  [警告] {source_name}: URL 前未找到 size 声明 ({url})")
                continue
            val = float(best_sm.group(1))
            unit = best_sm.group(2)
            line_no = text.count("\n", 0, url_start) + 1
            entries.append(
                {
                    "url": url,
                    "declared": human_to_bytes(val, unit),
                    "declared_raw": best_sm.group(0),
                    "span": (best_sm.start(0), best_sm.end(0)),
                    "kind": "string",
                    "line": line_no,
                }
            )
    return entries


def main() -> int:
    parser = argparse.ArgumentParser(
        description="校对/刷新前端配置中组件文件的 HuggingFace 真实体积"
    )
    parser.add_argument(
        "--write",
        action="store_true",
        help="回写实测体积到源码文件 (默认只读不写)",
    )
    args = parser.parse_args()

    all_entries: list[tuple[Path, dict]] = []
    file_texts: dict[Path, str] = {}

    for tgt in TARGETS:
        if not tgt.exists():
            print(f"[跳过] 文件不存在: {tgt.relative_to(REPO_ROOT)}")
            continue
        text = tgt.read_text(encoding="utf-8")
        file_texts[tgt] = text
        entries = extract_entries(text, tgt.name)
        for e in entries:
            all_entries.append((tgt, e))
        print(f"[扫描] {tgt.relative_to(REPO_ROOT)}: 提取到 {len(entries)} 个 URL")

    if not all_entries:
        print("\n未提取到任何 HuggingFace URL，退出。")
        return 0

    # 按 repo_id + revision 聚合，查询体积
    groups: dict[tuple[str, str], list[tuple[Path, dict]]] = {}
    for path, e in all_entries:
        parsed = parse_hf_url(e["url"])
        if not parsed:
            print(f"  [跳过] 无法解析 URL: {e['url']}")
            continue
        repo_id, revision, _ = parsed
        groups.setdefault((repo_id, revision), []).append((path, e))

    size_lookup: dict[str, int | None] = {}  # hf_path -> size
    for (repo_id, revision), items in groups.items():
        paths = []
        for _, e in items:
            parsed = parse_hf_url(e["url"])
            assert parsed is not None
            paths.append(parsed[2])
        unique_paths = list(dict.fromkeys(paths))
        print(f"\n[查询] {repo_id}@{revision}: {len(unique_paths)} 个文件")
        fetched = fetch_sizes(repo_id, revision, unique_paths)
        size_lookup.update(fetched)

    # 按 (path, span) 分组: modelDepConfigs.ts 中多文件模型共享同一 size: 声明
    # 同一声明 span 下的多个 URL 实测体积求和后与声明值比对
    groups_by_decl: dict[tuple[Path, int, int], list[dict]] = {}
    for path, e in all_entries:
        key = (path, e["span"][0], e["span"][1])
        groups_by_decl.setdefault(key, []).append(e)

    # 对照表
    print("\n" + "=" * 120)
    print(f"{'文件名':<55} {'声明值':>16} {'实测值':>16} {'偏差':>10} {'超容差':>8}")
    print("-" * 120)

    over_tolerance = False
    write_patches: dict[Path, list[tuple[int, int, str]]] = {}

    for (path, span_start, span_end), entries in groups_by_decl.items():
        # 收集所有 URL 的实测体积
        actuals: list[tuple[str, int | None]] = []
        for e in entries:
            parsed = parse_hf_url(e["url"])
            assert parsed is not None
            hf_path = parsed[2]
            actual = size_lookup.get(hf_path)
            actuals.append((Path(hf_path).name, actual))

        declared = entries[0]["declared"]
        declared_raw = entries[0]["declared_raw"]
        kind = entries[0]["kind"]

        # 求和
        total_actual = 0
        all_found = True
        for _name, actual in actuals:
            if actual is None:
                all_found = False
                break
            total_actual += actual

        # 文件名: 单文件显示文件名，多文件显示 "file1 + file2"
        display_names = [name for name, _ in actuals]
        if len(display_names) == 1:
            display_name = display_names[0]
        else:
            display_name = " + ".join(display_names)

        # 声明值的显示形式: bytes 显示数值；string 显示原始 '~X GB'
        if kind == "bytes":
            decl_disp = f"{declared:,}"
        else:
            m = re.match(r"size:\s*'([^']*)'", declared_raw)
            decl_disp = m.group(1) if m else declared_raw

        if not all_found:
            print(f"{display_name:<55} {decl_disp:>16} {'N/A':>16} {'N/A':>10} {'':>8}")
            continue

        if declared > 0:
            dev = (total_actual - declared) / declared
            dev_pct = dev * 100
        else:
            dev_pct = float("inf") if total_actual > 0 else 0.0
        over = abs(dev) > TOLERANCE if declared > 0 else False
        if over:
            over_tolerance = True

        print(
            f"{display_name:<55} {decl_disp:>16} {total_actual:>16,} {dev_pct:>+9.1f}% {'是' if over else '否':>8}"
        )

        if args.write and over:
            if kind == "bytes":
                new_val = str(total_actual)
            else:
                new_val = f"size: '{bytes_to_human(total_actual)}'"
            write_patches.setdefault(path, []).append(
                (span_start, span_end, new_val)
            )

    print("=" * 120)

    # 回写
    if args.write and write_patches:
        print("\n[回写] 更新以下文件:")
        for path, patches in write_patches.items():
            text = file_texts[path]
            # 倒序替换避免偏移失效
            for start, end, new in sorted(patches, key=lambda x: x[0], reverse=True):
                text = text[:start] + new + text[end:]
            path.write_text(text, encoding="utf-8")
            print(f"  - {path.relative_to(REPO_ROOT)} ({len(patches)} 处)")
    elif args.write:
        print("\n[回写] 无需更新 (全部在容差内或查询失败)。")

    if over_tolerance:
        print("\n存在超出容差的文件，退出码 1。")
        return 1
    print("\n全部在容差内，退出码 0。")
    return 0


if __name__ == "__main__":
    sys.exit(main())
