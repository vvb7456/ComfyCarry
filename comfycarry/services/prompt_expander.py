"""
提示词模板展开引擎 — 基于 dynamicprompts 库

支持语法:
  - 变体选择: {red|green|blue}
  - 权重变体: {0.8::a|0.2::b}
  - 多选: {2$$cat|dog|bird}
  - 通配符: __hair_color__  (从 wildcards/ 目录读取)
  - 子目录通配符: __sdxl/quality__
  - 变量: ${c=!{red|blue}} ${c} dress
  - 嵌套: {a {big|small} cat|a {red|blue} ball}
"""

import logging
import os
from pathlib import Path

from dynamicprompts.generators import RandomPromptGenerator
from dynamicprompts.wildcards import WildcardManager

logger = logging.getLogger(__name__)

MAX_TEMPLATE_LENGTH = 10_000
MAX_EXPANDED_LENGTH = 5_000


class PromptExpander:
    """管理 wildcard 目录和模板展开"""

    def __init__(self, wildcards_dir: str | Path):
        self._wildcards_dir = Path(wildcards_dir)
        self._wildcards_dir.mkdir(parents=True, exist_ok=True)
        self._wm = WildcardManager(self._wildcards_dir)

    def expand(self, template: str, seed: int = -1) -> str:
        """
        展开一个提示词模板 (单次)。返回展开后的文本。
        如果无动态语法或展开失败，返回原文。
        """
        if not template or not template.strip():
            return ""
        template = template.strip()

        if len(template) > MAX_TEMPLATE_LENGTH:
            raise ValueError(f"提示词模板过长 ({len(template)} > {MAX_TEMPLATE_LENGTH})")

        actual_seed = seed if seed >= 0 else None
        generator = RandomPromptGenerator(
            wildcard_manager=self._wm,
            seed=actual_seed,
            ignore_whitespace=True,
        )

        try:
            results = generator.generate(template, num_images=1)
        except RecursionError:
            logger.warning("[PromptExpander] 检测到递归引用，回退为原文")
            return template
        except Exception as e:
            logger.warning(f"[PromptExpander] 展开失败，回退为原文: {e}")
            return template

        text = results[0] if results else template
        truncated = len(text) > MAX_EXPANDED_LENGTH
        if truncated:
            logger.info(f"[PromptExpander] 扩展结果被截断: {len(text)} → {MAX_EXPANDED_LENGTH}")
            text = text[:MAX_EXPANDED_LENGTH]
        return {"text": text, "truncated": truncated}

    def reload(self):
        """刷新 WildcardManager 缓存 (文件变更后调用)"""
        self._wm = WildcardManager(self._wildcards_dir)

    # ── Wildcard 文件管理 ──────────────────────────────────────────────

    def list_wildcards(self) -> list[dict]:
        """列出所有可用 wildcard 文件 (含子文件夹)"""
        wildcards = []
        if not self._wildcards_dir.exists():
            return wildcards
        for f in sorted(self._wildcards_dir.rglob("*")):
            if f.is_file() and f.suffix in (".txt", ".yaml", ".yml", ".json"):
                rel = f.relative_to(self._wildcards_dir)
                name = str(rel.with_suffix("")).replace("\\", "/")
                line_count = 0
                if f.suffix == ".txt":
                    try:
                        line_count = sum(
                            1 for line in f.read_text(errors="ignore").splitlines()
                            if line.strip() and not line.strip().startswith("#")
                        )
                    except Exception:
                        pass
                wildcards.append({
                    "name": name,
                    "file": str(rel),
                    "format": f.suffix[1:],
                    "entries": line_count,
                    "size": f.stat().st_size,
                })
        return wildcards

    def get_wildcard_content(self, name: str) -> str:
        """获取指定 wildcard 文件原始内容"""
        safe = Path(name).as_posix()
        if ".." in safe:
            raise ValueError("Invalid wildcard name")
        for ext in (".txt", ".yaml", ".yml", ".json"):
            fpath = self._wildcards_dir / (safe + ext)
            if fpath.is_file() and fpath.resolve().is_relative_to(self._wildcards_dir.resolve()):
                return fpath.read_text(errors="ignore")
        raise FileNotFoundError(f"Wildcard not found: {name}")

    def save_wildcard(self, name: str, content: str) -> None:
        """保存/创建一个 wildcard 文件 (默认 .txt)"""
        safe = Path(name).as_posix()
        if ".." in safe:
            raise ValueError("Invalid wildcard name")
        fpath = self._wildcards_dir / (safe + ".txt")
        if not fpath.resolve().is_relative_to(self._wildcards_dir.resolve()):
            raise ValueError("Invalid wildcard path")
        fpath.parent.mkdir(parents=True, exist_ok=True)
        fpath.write_text(content, encoding="utf-8")
        self.reload()

    def list_folders(self) -> list[str]:
        """列出 wildcards 目录下所有子文件夹 (含空目录，排除隐藏目录)"""
        folders = []
        if not self._wildcards_dir.exists():
            return folders
        for d in sorted(self._wildcards_dir.rglob("*")):
            if d.is_dir():
                rel = str(d.relative_to(self._wildcards_dir)).replace("\\", "/")
                # 跳过隐藏目录 (任一层级以 . 开头)
                if any(part.startswith(".") for part in rel.split("/")):
                    continue
                folders.append(rel)
        return folders

    def create_folder(self, name: str) -> None:
        """在 wildcards 目录下创建子文件夹"""
        safe = Path(name).as_posix()
        if ".." in safe:
            raise ValueError("Invalid folder name")
        dpath = self._wildcards_dir / safe
        if not dpath.resolve().is_relative_to(self._wildcards_dir.resolve()):
            raise ValueError("Invalid folder path")
        dpath.mkdir(parents=True, exist_ok=True)

    def rename_wildcard(self, old_name: str, new_name: str) -> None:
        """重命名一个 wildcard 文件 (保留扩展名)"""
        old_safe = Path(old_name).as_posix()
        new_safe = Path(new_name).as_posix()
        if ".." in old_safe or ".." in new_safe:
            raise ValueError("Invalid wildcard name")
        # 找到源文件
        src = None
        for ext in (".txt", ".yaml", ".yml", ".json"):
            fpath = self._wildcards_dir / (old_safe + ext)
            if fpath.is_file() and fpath.resolve().is_relative_to(self._wildcards_dir.resolve()):
                src = fpath
                break
        if not src:
            raise FileNotFoundError(f"Wildcard not found: {old_name}")
        dst = self._wildcards_dir / (new_safe + src.suffix)
        if not dst.resolve().is_relative_to(self._wildcards_dir.resolve()):
            raise ValueError("Invalid target path")
        dst.parent.mkdir(parents=True, exist_ok=True)
        src.rename(dst)
        self.reload()

    def delete_wildcard(self, name: str) -> None:
        """删除一个 wildcard 文件"""
        safe = Path(name).as_posix()
        if ".." in safe:
            raise ValueError("Invalid wildcard name")
        for ext in (".txt", ".yaml", ".yml", ".json"):
            fpath = self._wildcards_dir / (safe + ext)
            if fpath.is_file() and fpath.resolve().is_relative_to(self._wildcards_dir.resolve()):
                fpath.unlink()
                self.reload()
                return
        raise FileNotFoundError(f"Wildcard not found: {name}")


# ── 模块级单例 ─────────────────────────────────────────────────────────────
_expander: PromptExpander | None = None


def get_expander() -> PromptExpander:
    """获取 PromptExpander 单例 (延迟初始化)"""
    global _expander
    if _expander is None:
        from ..config import COMFYUI_DIR
        wildcards_dir = os.path.join(COMFYUI_DIR, "wildcards")
        _expander = PromptExpander(wildcards_dir)
    return _expander
