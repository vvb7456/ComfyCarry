"""PromptExpander wildcard 文件变更回归测试。"""

from comfycarry.services.prompt_expander import PromptExpander


def test_wildcard_created_after_missing_expand_is_visible(tmp_path):
    expander = PromptExpander(tmp_path)

    assert expander.expand("__color__", seed=0)["text"] == "__color__"

    (tmp_path / "color.txt").write_text("red\n", encoding="utf-8")
    assert expander.expand("__color__", seed=0)["text"] == "red"


def test_wildcard_content_change_is_visible_on_next_expand(tmp_path):
    wildcard = tmp_path / "color.txt"
    wildcard.write_text("red\n", encoding="utf-8")
    expander = PromptExpander(tmp_path)

    assert expander.expand("__color__", seed=0)["text"] == "red"

    wildcard.write_text("blue\n", encoding="utf-8")
    assert expander.expand("__color__", seed=0)["text"] == "blue"


def test_deleted_wildcard_falls_back_to_original_on_next_expand(tmp_path):
    wildcard = tmp_path / "color.txt"
    wildcard.write_text("red\n", encoding="utf-8")
    expander = PromptExpander(tmp_path)

    assert expander.expand("__color__", seed=0)["text"] == "red"

    wildcard.unlink()
    assert expander.expand("__color__", seed=0)["text"] == "__color__"
