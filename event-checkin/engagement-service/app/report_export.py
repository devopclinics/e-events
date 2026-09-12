"""Render a survey/feedback activity's full report -- every question, with
real open-text answers -- to a downloadable PDF.

Deliberately independent of LiveDisplay: it drives a headless browser to the
`/live/survey-report/{activity_id}` frontend page, which fetches
`/activities/{activity_id}/report` straight from the database via a
short-lived staff-scoped token (see participate.py's `_mint_report_token`).
There is no display, short_code, or connection lease anywhere in this path,
so generating a report can never conflict with (or be knocked out by) an
actively-connected projector. A Redis lease also ensures that, across service
replicas, only one resource-intensive Chromium render runs at a time.
"""
from __future__ import annotations

import asyncio
import secrets

from fastapi import HTTPException
from playwright.async_api import async_playwright

from .realtime import redis

VIEWPORT = {"width": 1240, "height": 1754}
REPORT_EXPORT_LOCK_KEY = "engagement:export-lock:survey-report-pdf"
REPORT_EXPORT_LOCK_TTL_SECONDS = 150
REPORT_EXPORT_TIMEOUT_SECONDS = 120

# The in-process semaphore is a fast local rejection for concurrent requests
# hitting the same pod; the Redis lease below is what actually keeps two
# replicas from both launching Chromium at once.
_EXPORT_SLOT = asyncio.Semaphore(1)
_RELEASE_LOCK_IF_OWNER = (
    "if redis.call('get', KEYS[1]) == ARGV[1] then "
    "return redis.call('del', KEYS[1]) else return 0 end"
)


async def _acquire_cluster_slot() -> str:
    """Claim the cross-replica renderer lease or fail before opening Chromium.

    Report generation is optional and expensive, so Redis trouble fails closed
    here rather than letting multiple pods consume CPU and memory at once.
    """
    owner = secrets.token_urlsafe(24)
    try:
        claimed = await redis.set(REPORT_EXPORT_LOCK_KEY, owner, ex=REPORT_EXPORT_LOCK_TTL_SECONDS, nx=True)
    except Exception as exc:
        raise HTTPException(503, "Report export is temporarily unavailable. Please try again shortly.") from exc
    if not claimed:
        raise HTTPException(503, "Another report export is already running. Please try again shortly.")
    return owner


async def _release_cluster_slot(owner: str) -> None:
    """Release only the lease this render owns; its TTL is the recovery path."""
    try:
        await redis.eval(_RELEASE_LOCK_IF_OWNER, 1, REPORT_EXPORT_LOCK_KEY, owner)
    except Exception:
        # A successfully generated PDF remains successful if Redis goes away
        # during cleanup. The lease expires shortly afterwards.
        return


async def capture_survey_report_pdf(base_url: str, activity_id: str, token: str) -> bytes:
    """Render one report, enforcing local and cross-replica resource limits."""
    if _EXPORT_SLOT.locked():
        raise HTTPException(503, "Another report export is already running on this server. Please try again shortly.")
    async with _EXPORT_SLOT:
        owner = await _acquire_cluster_slot()
        try:
            try:
                async with asyncio.timeout(REPORT_EXPORT_TIMEOUT_SECONDS):
                    return await _capture_unguarded(base_url, activity_id, token)
            except TimeoutError as exc:
                raise HTTPException(504, "The report took too long to render. Please try again shortly.") from exc
        finally:
            await _release_cluster_slot(owner)


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
