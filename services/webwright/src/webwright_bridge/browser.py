"""Playwright browser manager for the Webwright Bridge sidecar."""

from __future__ import annotations

import asyncio
import base64
from typing import Any

from playwright.async_api import async_playwright

from webwright_bridge.models import Action, ActionResult, ActionType


class BrowserManager:
    """Manages a single Playwright browser session for one task."""

    async def run_task(self, url: str, actions: list[Action]) -> list[ActionResult]:
        """Launch a browser, navigate to url, execute actions, then close."""
        results: list[ActionResult] = []

        async with async_playwright() as pw:
            browser = await pw.chromium.launch(headless=True)
            try:
                page = await browser.new_page()

                # Always navigate to the initial URL first
                try:
                    await page.goto(url, wait_until="domcontentloaded")
                    results.append(
                        ActionResult(
                            type=ActionType.navigate,
                            success=True,
                            data={"url": url},
                        )
                    )
                except Exception as exc:
                    results.append(
                        ActionResult(
                            type=ActionType.navigate,
                            success=False,
                            error=str(exc),
                        )
                    )
                    return results

                for action in actions:
                    result = await self._execute_action(page, action)
                    results.append(result)
                    if not result.success:
                        break
            finally:
                await browser.close()

        return results

    async def _execute_action(self, page: Any, action: Action) -> ActionResult:
        """Execute a single action on the given page."""

        try:
            if action.type == ActionType.navigate:
                target = action.value or action.selector or ""
                await page.goto(target, wait_until="domcontentloaded")
                return ActionResult(
                    type=action.type, success=True, data={"url": target}
                )

            elif action.type == ActionType.click:
                if not action.selector:
                    return ActionResult(
                        type=action.type,
                        success=False,
                        error="selector is required for click",
                    )
                await page.click(action.selector)
                return ActionResult(type=action.type, success=True)

            elif action.type == ActionType.fill:
                if not action.selector:
                    return ActionResult(
                        type=action.type,
                        success=False,
                        error="selector is required for fill",
                    )
                await page.fill(action.selector, action.value or "")
                return ActionResult(type=action.type, success=True)

            elif action.type == ActionType.screenshot:
                png_bytes: bytes = await page.screenshot()
                encoded = base64.b64encode(png_bytes).decode()
                return ActionResult(
                    type=action.type,
                    success=True,
                    data={"screenshot": encoded},
                )

            elif action.type == ActionType.wait:
                ms = int(action.value or "1000")
                await asyncio.sleep(ms / 1000)
                return ActionResult(
                    type=action.type, success=True, data={"waited_ms": ms}
                )

            else:
                return ActionResult(
                    type=action.type,
                    success=False,
                    error=f"unknown action type: {action.type}",
                )

        except Exception as exc:
            return ActionResult(type=action.type, success=False, error=str(exc))
