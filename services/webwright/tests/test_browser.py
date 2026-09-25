"""Tests for the BrowserManager (Playwright mocked — no real browser needed)."""

from __future__ import annotations

import base64
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from webwright_bridge.browser import BrowserManager
from webwright_bridge.models import Action, ActionType


def _make_page(
    *,
    goto_raises: Exception | None = None,
    click_raises: Exception | None = None,
    fill_raises: Exception | None = None,
    screenshot_bytes: bytes = b"PNG",
) -> AsyncMock:
    page = AsyncMock()
    if goto_raises:
        page.goto.side_effect = goto_raises
    if click_raises:
        page.click.side_effect = click_raises
    if fill_raises:
        page.fill.side_effect = fill_raises
    page.screenshot.return_value = screenshot_bytes
    return page


def _make_browser(page: AsyncMock) -> AsyncMock:
    browser = AsyncMock()
    browser.new_page.return_value = page
    return browser


def _make_pw(browser: AsyncMock) -> MagicMock:
    pw = MagicMock()
    pw.chromium.launch = AsyncMock(return_value=browser)
    return pw


def _make_async_playwright_ctx(pw: MagicMock) -> MagicMock:
    """Return a context manager mock that yields pw."""
    ctx = MagicMock()
    ctx.__aenter__ = AsyncMock(return_value=pw)
    ctx.__aexit__ = AsyncMock(return_value=False)
    return ctx


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


@pytest.fixture()
def manager() -> BrowserManager:
    return BrowserManager()


# ---------------------------------------------------------------------------
# navigate (initial URL)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_run_task_navigate_success(manager: BrowserManager) -> None:
    page = _make_page()
    browser = _make_browser(page)
    pw = _make_pw(browser)
    ctx = _make_async_playwright_ctx(pw)

    with patch("webwright_bridge.browser.async_playwright", return_value=ctx):
        results = await manager.run_task("https://example.com", [])

    assert len(results) == 1
    assert results[0].success is True
    assert results[0].type == ActionType.navigate


@pytest.mark.asyncio
async def test_run_task_navigate_failure_stops_execution(manager: BrowserManager) -> None:
    page = _make_page(goto_raises=Exception("net::ERR_NAME_NOT_RESOLVED"))
    browser = _make_browser(page)
    pw = _make_pw(browser)
    ctx = _make_async_playwright_ctx(pw)

    with patch("webwright_bridge.browser.async_playwright", return_value=ctx):
        results = await manager.run_task(
            "https://bad.invalid",
            [Action(type=ActionType.click, selector="#btn")],
        )

    # Only the initial navigate result — execution stopped
    assert len(results) == 1
    assert results[0].success is False
    assert "ERR_NAME_NOT_RESOLVED" in (results[0].error or "")


# ---------------------------------------------------------------------------
# click action
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_click_action_success(manager: BrowserManager) -> None:
    page = _make_page()
    browser = _make_browser(page)
    pw = _make_pw(browser)
    ctx = _make_async_playwright_ctx(pw)

    with patch("webwright_bridge.browser.async_playwright", return_value=ctx):
        results = await manager.run_task(
            "https://example.com",
            [Action(type=ActionType.click, selector="#submit")],
        )

    click_result = results[1]
    assert click_result.type == ActionType.click
    assert click_result.success is True


@pytest.mark.asyncio
async def test_click_action_missing_selector(manager: BrowserManager) -> None:
    page = _make_page()
    browser = _make_browser(page)
    pw = _make_pw(browser)
    ctx = _make_async_playwright_ctx(pw)

    with patch("webwright_bridge.browser.async_playwright", return_value=ctx):
        results = await manager.run_task(
            "https://example.com",
            [Action(type=ActionType.click)],
        )

    click_result = results[1]
    assert click_result.success is False
    assert "selector" in (click_result.error or "")


@pytest.mark.asyncio
async def test_click_action_playwright_error(manager: BrowserManager) -> None:
    page = _make_page(click_raises=Exception("Element not found"))
    browser = _make_browser(page)
    pw = _make_pw(browser)
    ctx = _make_async_playwright_ctx(pw)

    with patch("webwright_bridge.browser.async_playwright", return_value=ctx):
        results = await manager.run_task(
            "https://example.com",
            [Action(type=ActionType.click, selector="#missing")],
        )

    assert results[1].success is False
    assert "Element not found" in (results[1].error or "")


# ---------------------------------------------------------------------------
# fill action
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_fill_action_success(manager: BrowserManager) -> None:
    page = _make_page()
    browser = _make_browser(page)
    pw = _make_pw(browser)
    ctx = _make_async_playwright_ctx(pw)

    with patch("webwright_bridge.browser.async_playwright", return_value=ctx):
        results = await manager.run_task(
            "https://example.com",
            [Action(type=ActionType.fill, selector="#name", value="Alice")],
        )

    assert results[1].type == ActionType.fill
    assert results[1].success is True
    page.fill.assert_awaited_once_with("#name", "Alice")


@pytest.mark.asyncio
async def test_fill_action_missing_selector(manager: BrowserManager) -> None:
    page = _make_page()
    browser = _make_browser(page)
    pw = _make_pw(browser)
    ctx = _make_async_playwright_ctx(pw)

    with patch("webwright_bridge.browser.async_playwright", return_value=ctx):
        results = await manager.run_task(
            "https://example.com",
            [Action(type=ActionType.fill, value="hello")],
        )

    assert results[1].success is False


# ---------------------------------------------------------------------------
# screenshot action
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_screenshot_action_returns_base64(manager: BrowserManager) -> None:
    png = b"\x89PNG\r\n\x1a\n"
    page = _make_page(screenshot_bytes=png)
    browser = _make_browser(page)
    pw = _make_pw(browser)
    ctx = _make_async_playwright_ctx(pw)

    with patch("webwright_bridge.browser.async_playwright", return_value=ctx):
        results = await manager.run_task(
            "https://example.com",
            [Action(type=ActionType.screenshot)],
        )

    ss_result = results[1]
    assert ss_result.success is True
    assert ss_result.data is not None
    encoded = ss_result.data["screenshot"]
    assert base64.b64decode(encoded) == png


# ---------------------------------------------------------------------------
# wait action
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_wait_action_success(manager: BrowserManager) -> None:
    page = _make_page()
    browser = _make_browser(page)
    pw = _make_pw(browser)
    ctx = _make_async_playwright_ctx(pw)

    with patch("webwright_bridge.browser.async_playwright", return_value=ctx), \
         patch("webwright_bridge.browser.asyncio.sleep", new_callable=AsyncMock) as mock_sleep:
        results = await manager.run_task(
            "https://example.com",
            [Action(type=ActionType.wait, value="500")],
        )

    wait_result = results[1]
    assert wait_result.success is True
    assert wait_result.data == {"waited_ms": 500}
    mock_sleep.assert_awaited_once_with(0.5)


# ---------------------------------------------------------------------------
# navigate action (explicit, mid-flow)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_navigate_action_mid_flow(manager: BrowserManager) -> None:
    page = _make_page()
    browser = _make_browser(page)
    pw = _make_pw(browser)
    ctx = _make_async_playwright_ctx(pw)

    with patch("webwright_bridge.browser.async_playwright", return_value=ctx):
        results = await manager.run_task(
            "https://example.com",
            [Action(type=ActionType.navigate, value="https://other.com")],
        )

    nav_result = results[1]
    assert nav_result.type == ActionType.navigate
    assert nav_result.success is True
    assert nav_result.data == {"url": "https://other.com"}
