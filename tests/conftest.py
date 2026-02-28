"""
ComfyCarry E2E 测试 — Pytest + Playwright 配置
"""
import os
import pytest
from playwright.sync_api import sync_playwright

# ── 配置 (可通过环境变量覆盖) ────────────────────────────────
BASE_URL = os.environ.get("TEST_BASE_URL", "http://localhost:5000")
PASSWORD = os.environ.get("TEST_PASSWORD", "comfy2025")
API_KEY  = os.environ.get("TEST_API_KEY", "")

# ── Fixtures ────────────────────────────────────────────────────

@pytest.fixture(scope="session")
def browser():
    """Session-scoped browser instance (headless Chromium)."""
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        yield browser
        browser.close()


@pytest.fixture(scope="session")
def auth_context(browser):
    """Session-scoped authenticated browser context.
    Logs in once and shares cookies across all tests.
    """
    context = browser.new_context(
        base_url=BASE_URL,
        ignore_https_errors=True,
    )
    page = context.new_page()

    # Login
    page.goto("/login", wait_until="domcontentloaded")
    page.fill('input[name="password"]', PASSWORD)
    page.click('button[type="submit"]')
    # 等待跳转到 Dashboard 主页 (不再匹配 /login)
    page.wait_for_selector('.nav-item[data-page="dashboard"]', timeout=15000)

    page.close()
    yield context
    context.close()


@pytest.fixture
def page(auth_context):
    """Per-test page with console error collection."""
    page = auth_context.new_page()
    errors = []
    page.on("console", lambda msg: errors.append(msg.text) if msg.type == "error" else None)
    page.on("pageerror", lambda exc: errors.append(str(exc)))
    page._console_errors = errors
    yield page
    page.close()
