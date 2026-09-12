"""Render a survey/feedback activity's full report -- every question, with
real open-text answers -- to a downloadable PDF.

Deliberately independent of LiveDisplay: it drives a headless browser to the
`/live/survey-report/{activity_id}` frontend page, which fetches
`/activities/{activity_id}/report` straight from the database via a
short-lived staff-scoped token (see participate.py's `_mint_report_token`).
There is no display, short_code, or connection lease anywhere in this path,
so generating a report can never conflict with (or be knocked out by) an
actively-connected projector.
"""
from __future__ import annotations

import asyncio

from fastapi import HTTPException
from playwright.async_api import async_playwright

VIEWPORT = {"width": 1240, "height": 1754}

_EXPORT_SLOT = asyncio.Semaphore(1)


async def capture_survey_report_pdf(base_url: str, activity_id: str, token: str) -> bytes:
    if _EXPORT_SLOT.locked():
        raise HTTPException(503, "Another report export is already running on this server. Please try again shortly.")
    async with _EXPORT_SLOT:
        return await _capture_unguarded(base_url, activity_id, token)


async def _capture_unguarded(base_url: str, activity_id: str, token: str) -> bytes:
    async with async_playwright() as playwright:
        browser = await playwright.chromium.launch(args=["--no-sandbox", "--disable-dev-shm-usage"])
        try:
            page = await browser.new_page(viewport=VIEWPORT)
            page.set_default_navigation_timeout(30_000)
            await page.emulate_media(media="print", reduced_motion="reduce")
            # This is a read-only preview route, not the public display --
            # it never opens an SSE connection, so networkidle is safe to
            # wait on.
            await page.goto(f"{base_url}/live/survey-report/{activity_id}?token={token}", wait_until="networkidle", timeout=30_000)
            # The marker div is deliberately display:none (it's not meant to
            # be seen), so wait for it to exist in the DOM rather than the
            # default "visible" state, which display:none can never satisfy.
            await page.locator(".flb-report-ready").wait_for(state="attached", timeout=20_000)
            return await page.pdf(
                format="A4", print_background=True,
                margin={"top": "16mm", "bottom": "20mm", "left": "14mm", "right": "14mm"},
                display_header_footer=True,
                header_template="<span></span>",
                # Real page numbers via Chromium's own pagination -- the page
                # content has no idea how many pages it spans (the front
                # matter's length varies per activity), so this has to come
                # from the PDF renderer, not from anything computed in React.
                footer_template=(
                    '<div style="width:100%;font-size:8px;color:#9ca3af;'
                    'font-family:-apple-system,Arial,sans-serif;text-align:center;">'
                    'Page <span class="pageNumber"></span> of <span class="totalPages"></span></div>'
                ),
            )
        finally:
            await browser.close()
