"""文件落盘后的模型登记，可在任务恢复后复用。"""

import os

from .model_meta_store import register_downloaded_model


def register_task_file(task):
    from ..utils import _sha256_file
    from .civitai_resolver import download_preview_image, extract_file_trigger_words

    path = os.path.join(task.save_dir, task.filename)
    meta = task.meta
    if meta["source"] == "civitai":
        info = meta["source_data"]
        sha256 = _sha256_file(path)
        if not sha256:
            raise RuntimeError("SHA256 计算失败")
        download_preview_image(path, info.get("images", []))
        words = extract_file_trigger_words(path)
    else:
        info = meta
        sha256 = meta["sha256"]
        words = []
    category = "auxiliary" if meta.get("is_model") is False else meta["category"]
    detail = register_downloaded_model(path, category, info, sha256, words)
    meta["local_model_id"] = detail["id"]
