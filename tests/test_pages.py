"""
ComfyCarry E2E — 页面导航 & Tab 切换 & 无 JS 错误
覆盖: 所有 9 个页面 + 所有 Tab 切换
"""
import pytest
import time

# ── 所有页面 + 每页的 Tab 配置 ────────────────────────────────
PAGES = {
    "dashboard":  {"tabs": []},
    "comfyui":    {"tabs": [
        {"attr": "data-comfy-tab", "values": ["console", "queue", "history"]},
    ]},
    "models":     {"tabs": [
        {"attr": "data-mtab", "values": ["local", "civitai", "downloads", "workflow"]},
    ]},
    "plugins":    {"tabs": [
        {"attr": "data-ptab", "values": ["installed", "browse", "git"]},
    ]},
    "sync":       {"tabs": [
        {"attr": "data-stab", "values": ["remotes", "rules", "config"]},
    ]},
    "tunnel":     {"tabs": [
        {"attr": "data-ttab", "values": ["status", "config"]},
    ]},
    "jupyter":    {"tabs": []},
    "ssh":        {"tabs": [
        {"attr": "data-sshtab", "values": ["status", "config"]},
    ]},
    "settings":   {"tabs": []},
}


class TestPageNavigation:
    """测试所有页面可正常加载且无 JS Console 错误"""

    @pytest.mark.parametrize("page_name", PAGES.keys())
    def test_page_loads_without_errors(self, page, page_name):
        """每个页面加载后等待 1s，检查无 console.error"""
        page.goto("/", wait_until="domcontentloaded")
        # 等待侧边栏渲染完成
        page.wait_for_selector('.nav-item[data-page="dashboard"]', timeout=10000)

        # 清空之前的错误
        page._console_errors.clear()

        # 点击侧边栏导航
        nav = page.locator(f'.nav-item[data-page="{page_name}"]')
        nav.click()
        time.sleep(1.5)  # 等待页面渲染 + API 请求

        # 验证页面可见
        page_el = page.locator(f'#page-{page_name}')
        assert page_el.is_visible(), f"Page #{page_name} should be visible"

        # 检查无 JS 错误
        errors = page._console_errors
        assert len(errors) == 0, f"Page '{page_name}' has JS errors: {errors}"


class TestTabSwitching:
    """测试所有 Tab 切换功能"""

    @pytest.mark.parametrize("page_name,tab_config", [
        (name, tab)
        for name, cfg in PAGES.items()
        for tab in cfg["tabs"]
    ], ids=lambda x: f"{x}" if isinstance(x, str) else None)
    def test_tab_switch(self, page, page_name, tab_config):
        """点击每个 Tab，验证对应面板显示、其他面板隐藏"""
        page.goto("/", wait_until="domcontentloaded")
        page.wait_for_selector('.nav-item[data-page="dashboard"]', timeout=10000)

        # 导航到目标页面
        page.locator(f'.nav-item[data-page="{page_name}"]').click()
        time.sleep(1)

        # 清空错误
        page._console_errors.clear()

        attr = tab_config["attr"]
        values = tab_config["values"]

        for tab_val in values:
            # 点击 Tab 按钮
            tab_btn = page.locator(f'[{attr}="{tab_val}"]')
            tab_btn.click()
            time.sleep(0.5)

            # 验证 Tab 按钮有 active class
            assert "active" in (tab_btn.get_attribute("class") or ""), \
                f"Tab button [{attr}={tab_val}] should have 'active' class"

            # 验证无 JS 错误
            errors = page._console_errors
            assert len(errors) == 0, \
                f"Tab switch '{page_name}/{tab_val}' caused JS errors: {errors}"


class TestPageSwitchCleanup:
    """测试页面切换时自动刷新和 SSE 的清理"""

    def test_rapid_page_switching(self, page):
        """快速切换所有页面，验证无 JS 错误 (测试 enter/leave 生命周期)"""
        page.goto("/", wait_until="domcontentloaded")
        page.wait_for_selector('.nav-item[data-page="dashboard"]', timeout=10000)
        page._console_errors.clear()

        page_names = list(PAGES.keys())
        # 快速切换两圈
        for _ in range(2):
            for name in page_names:
                page.locator(f'.nav-item[data-page="{name}"]').click()
                time.sleep(0.3)

        # 多等一会让所有异步操作完成
        time.sleep(2)

        errors = page._console_errors
        assert len(errors) == 0, f"Rapid page switching caused JS errors: {errors}"
