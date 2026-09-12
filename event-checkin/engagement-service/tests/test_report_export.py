"""Focused tests for the survey report PDF export boundary.

The browser is mocked here: these tests protect the resource guard, the
cross-replica lease, and the renderer contract without starting Chromium.
"""
import asyncio
import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock, patch

from fastapi import HTTPException

from app import report_export
from app.auth import Identity
from app.routers import operations


class _AsyncPlaywrightContext:
    def __init__(self, playwright):
        self.playwright = playwright

    async def __aenter__(self):
        return self.playwright

    async def __aexit__(self, exc_type, exc, traceback):
        return False


class LocalConcurrencyGuardTests(unittest.IsolatedAsyncioTestCase):
    async def test_a_second_export_is_rejected_immediately(self):
        release = asyncio.Event()

        async def slow_capture(*_args, **_kwargs):
            await release.wait()
            return b"pdf"

        with (
            patch("app.report_export._acquire_cluster_slot", new=AsyncMock(return_value="owner")),
            patch("app.report_export._release_cluster_slot", new=AsyncMock()),
            patch("app.report_export._capture_unguarded", new=AsyncMock(side_effect=slow_capture)),
        ):
            first = asyncio.create_task(report_export.capture_survey_report_pdf("http://proxy", "activity-a", "token"))
            await asyncio.sleep(0.05)
            with self.assertRaises(HTTPException) as raised:
                await report_export.capture_survey_report_pdf("http://proxy", "activity-a", "token")
            self.assertEqual(raised.exception.status_code, 503)

            release.set()
            self.assertEqual(await first, b"pdf")

    async def test_local_slot_is_released_after_a_failed_export(self):
        with (
            patch("app.report_export._acquire_cluster_slot", new=AsyncMock(return_value="owner")),
            patch("app.report_export._release_cluster_slot", new=AsyncMock()),
            patch("app.report_export._capture_unguarded", new=AsyncMock(side_effect=RuntimeError("boom"))),
        ):
            with self.assertRaisesRegex(RuntimeError, "boom"):
                await report_export.capture_survey_report_pdf("http://proxy", "activity-a", "token")

        with (
            patch("app.report_export._acquire_cluster_slot", new=AsyncMock(return_value="owner")),
            patch("app.report_export._release_cluster_slot", new=AsyncMock()),
            patch("app.report_export._capture_unguarded", new=AsyncMock(return_value=b"pdf")),
        ):
            self.assertEqual(
                await report_export.capture_survey_report_pdf("http://proxy", "activity-a", "token"),
                b"pdf",
            )


class ClusterLeaseTests(unittest.IsolatedAsyncioTestCase):
    async def test_cluster_lease_serializes_renderers_and_releases_only_its_owner(self):
        with (
            patch("app.report_export.secrets.token_urlsafe", return_value="owner-token"),
            patch("app.report_export.redis.set", new=AsyncMock(return_value=True)) as claim,
            patch("app.report_export.redis.eval", new=AsyncMock(return_value=1)) as release,
            patch("app.report_export._capture_unguarded", new=AsyncMock(return_value=b"pdf")) as capture,
        ):
            pdf = await report_export.capture_survey_report_pdf("http://proxy", "activity-a", "token")

        self.assertEqual(pdf, b"pdf")
        claim.assert_awaited_once_with(
            report_export.REPORT_EXPORT_LOCK_KEY,
            "owner-token",
            ex=report_export.REPORT_EXPORT_LOCK_TTL_SECONDS,
            nx=True,
        )
        capture.assert_awaited_once_with("http://proxy", "activity-a", "token")
        release.assert_awaited_once_with(
            report_export._RELEASE_LOCK_IF_OWNER,
            1,
            report_export.REPORT_EXPORT_LOCK_KEY,
            "owner-token",
        )

    async def test_another_replica_holding_the_lease_is_rejected_before_rendering(self):
        with (
            patch("app.report_export.redis.set", new=AsyncMock(return_value=False)),
            patch("app.report_export._capture_unguarded", new=AsyncMock()) as capture,
        ):
            with self.assertRaises(HTTPException) as raised:
                await report_export.capture_survey_report_pdf("http://proxy", "activity-a", "token")

        self.assertEqual(raised.exception.status_code, 503)
        capture.assert_not_awaited()

    async def test_redis_unavailable_fails_closed_before_rendering(self):
        with (
            patch("app.report_export.redis.set", new=AsyncMock(side_effect=ConnectionError("redis unavailable"))),
            patch("app.report_export._capture_unguarded", new=AsyncMock()) as capture,
        ):
            with self.assertRaises(HTTPException) as raised:
                await report_export.capture_survey_report_pdf("http://proxy", "activity-a", "token")

        self.assertEqual(raised.exception.status_code, 503)
        capture.assert_not_awaited()

    async def test_render_failure_releases_the_cluster_lease(self):
        with (
            patch("app.report_export.redis.set", new=AsyncMock(return_value=True)),
            patch("app.report_export.redis.eval", new=AsyncMock(return_value=1)) as release,
            patch("app.report_export._capture_unguarded", new=AsyncMock(side_effect=RuntimeError("render failed"))),
        ):
            with self.assertRaisesRegex(RuntimeError, "render failed"):
                await report_export.capture_survey_report_pdf("http://proxy", "activity-a", "token")

        release.assert_awaited_once()

    async def test_timeout_releases_the_cluster_lease_and_returns_a_controlled_error(self):
        async def slow_capture(*_args, **_kwargs):
            await asyncio.sleep(1)

        with (
            patch("app.report_export.REPORT_EXPORT_TIMEOUT_SECONDS", 0.01),
            patch("app.report_export.redis.set", new=AsyncMock(return_value=True)),
            patch("app.report_export.redis.eval", new=AsyncMock(return_value=1)) as release,
            patch("app.report_export._capture_unguarded", new=AsyncMock(side_effect=slow_capture)),
        ):
            with self.assertRaises(HTTPException) as raised:
                await report_export.capture_survey_report_pdf("http://proxy", "activity-a", "token")

        self.assertEqual(raised.exception.status_code, 504)
        release.assert_awaited_once()


class BrowserRenderTests(unittest.IsolatedAsyncioTestCase):
    def _browser_fixture(self):
        locator = Mock()
        locator.wait_for = AsyncMock()
        page = Mock()
        page.emulate_media = AsyncMock()
        page.goto = AsyncMock()
        page.pdf = AsyncMock(return_value=b"%PDF-1.7")
        page.locator.return_value = locator

        browser = Mock()
        browser.new_page = AsyncMock(return_value=page)
        browser.close = AsyncMock()

        chromium = Mock()
        chromium.launch = AsyncMock(return_value=browser)
        playwright = Mock(chromium=chromium)
        return playwright, browser, page, locator

    async def test_renderer_waits_for_the_ready_marker_and_prints_landscape_a4(self):
        playwright, browser, page, locator = self._browser_fixture()

        with patch("app.report_export.async_playwright", return_value=_AsyncPlaywrightContext(playwright)):
            pdf = await report_export._capture_unguarded("https://festio.example", "activity-a", "report-token")

        self.assertEqual(pdf, b"%PDF-1.7")
        playwright.chromium.launch.assert_awaited_once_with(args=["--no-sandbox", "--disable-dev-shm-usage"])
        browser.new_page.assert_awaited_once_with(viewport=report_export.VIEWPORT)
        self.assertEqual(page.set_default_navigation_timeout.call_args.args, (30_000,))
        page.emulate_media.assert_awaited_once_with(media="print", reduced_motion="reduce")
        page.goto.assert_awaited_once_with(
            "https://festio.example/live/survey-report/activity-a?token=report-token",
            wait_until="networkidle",
            timeout=30_000,
        )
        locator.wait_for.assert_awaited_once_with(state="attached", timeout=20_000)
        pdf_kwargs = page.pdf.await_args.kwargs
        self.assertEqual(pdf_kwargs["format"], "A4")
        self.assertTrue(pdf_kwargs["landscape"])
        self.assertTrue(pdf_kwargs["print_background"])
        self.assertTrue(pdf_kwargs["display_header_footer"])
        self.assertIn("pageNumber", pdf_kwargs["footer_template"])
        browser.close.assert_awaited_once_with()

    async def test_browser_closes_if_the_report_page_fails_to_load(self):
        playwright, browser, page, _locator = self._browser_fixture()
        page.goto.side_effect = RuntimeError("navigation failed")

        with patch("app.report_export.async_playwright", return_value=_AsyncPlaywrightContext(playwright)):
            with self.assertRaisesRegex(RuntimeError, "navigation failed"):
                await report_export._capture_unguarded("https://festio.example", "activity-a", "report-token")

        browser.close.assert_awaited_once_with()


class ReportEndpointTests(unittest.IsolatedAsyncioTestCase):
    def _owner_identity(self):
        return Identity(
            identity_kind="staff", subject="owner-a", event_id="event-a",
            org_id="org-a", role="owner",
        )

    async def test_export_returns_a_sanitized_pdf_attachment_for_the_owned_activity(self):
        activity = SimpleNamespace(
            event_id="event-a", org_id="org-a", title="MBF Summit: Guest Feedback",
        )
        with (
            patch("app.routers.operations.enforce_rate_limit", new=AsyncMock()) as rate_limit,
            patch("app.routers.operations._fetch_activity", new=AsyncMock(return_value=activity)),
            patch("app.routers.participate._mint_report_token", return_value="report-token"),
            patch("app.routers.operations.capture_survey_report_pdf", new=AsyncMock(return_value=b"%PDF-1.7")) as capture,
        ):
            response = await operations.export_survey_report_pdf(
                "activity-a", request=object(), identity=self._owner_identity(), db=object(),
            )

        rate_limit.assert_awaited_once()
        capture.assert_awaited_once_with(
            operations.settings.internal_display_base_url, "activity-a", "report-token",
        )
        self.assertEqual(response.media_type, "application/pdf")
        self.assertEqual(response.body, b"%PDF-1.7")
        self.assertEqual(
            response.headers["content-disposition"],
            'attachment; filename="MBF_Summit_Guest_Feedback_report.pdf"',
        )

    async def test_export_does_not_render_an_activity_from_another_event(self):
        activity = SimpleNamespace(event_id="other-event", org_id="org-a", title="Other")
        with (
            patch("app.routers.operations.enforce_rate_limit", new=AsyncMock()),
            patch("app.routers.operations._fetch_activity", new=AsyncMock(return_value=activity)),
            patch("app.routers.operations.capture_survey_report_pdf", new=AsyncMock()) as capture,
        ):
            with self.assertRaises(HTTPException) as raised:
                await operations.export_survey_report_pdf(
                    "activity-a", request=object(), identity=self._owner_identity(), db=object(),
                )

        self.assertEqual(raised.exception.status_code, 404)
        capture.assert_not_awaited()


if __name__ == "__main__":
    unittest.main()
