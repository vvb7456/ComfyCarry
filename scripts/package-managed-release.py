#!/usr/bin/env python3
"""打包托管开通用的固定部署包。

与 .github/workflows/release.yml 的白名单保持一致 (comfycarry/、
comfycarry_ws_broadcast/、data 仅 git tracked、static/dist、workspace_manager.py、
favicon.ico), 额外包含 bootstrap.sh、docker/entrypoint.sh、.version 与
manifest.json, 供托管实例按内容摘要固定启动。

产物为 tar.gz, 顶层目录固定为 comfycarry/, 解压后即可作为
COMFYCARRY_BUNDLE_DIR。dirty 工作区会如实写入 .version/manifest, 不冒充
某个 git 提交。
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import shutil
import subprocess
import sys
import tarfile
import tempfile
from datetime import UTC, datetime
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
BUNDLE_ROOT_NAME = "comfycarry"

# release.yml 的应用白名单 (树)
INCLUDE_TREES = ("comfycarry", "comfycarry_ws_broadcast")
# release.yml 的应用白名单 (单文件) + 托管包启动所需文件
INCLUDE_FILES = ("workspace_manager.py", "favicon.ico", "bootstrap.sh", "docker/entrypoint.sh")

EXCLUDE_DIRS = {"__pycache__", ".pytest_cache", ".git", "node_modules", ".comfycarry-agent"}
EXCLUDE_SUFFIXES = (".pyc", ".pyo", ".log")
EXCLUDE_NAMES = {".env", ".civitai_config.json", ".dashboard_env", ".DS_Store"}


def _excluded(rel: Path) -> bool:
    if any(part in EXCLUDE_DIRS for part in rel.parts):
        return True
    name = rel.name
    if name in EXCLUDE_NAMES or name.startswith(".env"):
        return True
    return any(name.endswith(suffix) for suffix in EXCLUDE_SUFFIXES)


def _copy_tree(src: Path, dst: Path) -> None:
    shutil.copytree(src, dst, ignore=lambda _dir, names: [n for n in names if _excluded(Path(n))])


def _tracked_files(prefix: str) -> list[Path]:
    out = subprocess.run(
        ["git", "-C", str(REPO_ROOT), "ls-files", "-z", "--", prefix],
        check=True, capture_output=True, text=True,
    ).stdout
    return [REPO_ROOT / p for p in out.split("\0") if p and not _excluded(Path(p))]


def _app_version() -> str:
    config = (REPO_ROOT / "comfycarry" / "config.py").read_text(encoding="utf-8")
    match = re.search(r'APP_VERSION\s*=\s*"([^"]+)"', config)
    return match.group(1) if match else "unknown"


def _git(*args: str) -> str:
    try:
        return subprocess.run(["git", "-C", str(REPO_ROOT), *args],
                              check=True, capture_output=True, text=True).stdout.strip()
    except (subprocess.CalledProcessError, FileNotFoundError):
        return ""


def _content_sha256(stage: Path) -> str:
    digest = hashlib.sha256()
    files = sorted((p for p in stage.rglob("*") if p.is_file()),
                   key=lambda p: p.relative_to(stage).as_posix())
    for path in files:
        rel = path.relative_to(stage).as_posix().encode("utf-8")
        digest.update(rel + b"\0")
        with path.open("rb") as stream:
            for chunk in iter(lambda: stream.read(1024 * 1024), b""):
                digest.update(chunk)
        digest.update(b"\0")
    return digest.hexdigest()


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _require_build() -> None:
    dist = REPO_ROOT / "static" / "dist"
    if not (dist / "index.html").is_file() or not (dist / "wizard.html").is_file():
        sys.exit("static/dist 缺少构建产物, 请先在 frontend/ 运行 npm run build 后再打包")


def build(output_dir: Path, *, tar_name: str | None = None) -> Path:
    _require_build()
    output_dir.mkdir(parents=True, exist_ok=True)

    with tempfile.TemporaryDirectory() as tmp:
        stage = Path(tmp) / BUNDLE_ROOT_NAME
        stage.mkdir()

        for tree in INCLUDE_TREES:
            src = REPO_ROOT / tree
            if src.is_dir():
                _copy_tree(src, stage / tree)
        if (REPO_ROOT / "static" / "dist").is_dir():
            _copy_tree(REPO_ROOT / "static" / "dist", stage / "static" / "dist")
        for name in INCLUDE_FILES:
            src = REPO_ROOT / name
            if not src.is_file():
                if name == "docker/entrypoint.sh":
                    sys.exit(f"缺少 {name}, 托管启动需要它")
                continue
            dst = stage / name
            dst.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(src, dst)

        # data 只包含 git tracked 文件, 排除本地临时/未跟踪内容
        for src in _tracked_files("data"):
            dst = stage / src.relative_to(REPO_ROOT)
            dst.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(src, dst)

        content_sha = _content_sha256(stage)
        version = _app_version()
        base_commit = _git("rev-parse", "HEAD")
        branch = _git("rev-parse", "--abbrev-ref", "HEAD")
        dirty = bool(_git("status", "--porcelain"))
        built_at = datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")

        (stage / ".version").write_text(
            "\n".join([
                f"version={version}+managed.{content_sha[:12]}",
                f"branch={branch}",
                "commit=",
                "managed=true",
                f"dirty={'true' if dirty else 'false'}",
                f"base_commit={base_commit}",
                f"bundle_sha256={content_sha}",
                f"built_at={built_at}",
                "",
            ]),
            encoding="utf-8",
        )
        (stage / "manifest.json").write_text(
            json.dumps({
                "schema": 1,
                "name": "comfycarry-managed-release",
                "version": version,
                "managed": True,
                "dirty": dirty,
                "base_commit": base_commit,
                "content_sha256": content_sha,
                "built_at": built_at,
            }, indent=2, sort_keys=True) + "\n",
            encoding="utf-8",
        )

        packed = Path(tmp) / "client.tar.gz"
        with tarfile.open(packed, "w:gz") as archive:
            archive.add(stage, arcname=BUNDLE_ROOT_NAME)
        archive_sha = _sha256_file(packed)
        name = tar_name or f"comfycarry-managed-{archive_sha}.tar.gz"
        if Path(name).name != name:
            sys.exit("归档名不能包含目录")
        target = output_dir / name
        with packed.open("rb") as source, target.open("xb") as destination:
            shutil.copyfileobj(source, destination)

        print(f"包: {target}")
        print(f"内容摘要 (content_sha256): {content_sha}")
        print(f"tar.gz sha256: {archive_sha}")
        print(f"大小: {target.stat().st_size} 字节")
        print(f"版本: {version} (base_commit={base_commit or 'unknown'}, dirty={str(dirty).lower()})")
        return target


def main() -> None:
    parser = argparse.ArgumentParser(description="打包托管开通用的固定部署包")
    parser.add_argument("--output-dir", required=True, type=Path, help="tar.gz 输出目录")
    parser.add_argument("--tar-name", default=None, help="自定义归档文件名")
    args = parser.parse_args()
    build(args.output_dir, tar_name=args.tar_name)


if __name__ == "__main__":
    main()
