import pytest

from services.shortlinks import shorten_url


@pytest.mark.asyncio
async def test_shorten_then_redirect_round_trips_to_the_original_url(ctx):
    target = "https://festio.events/scan/9f3d7c21-aaaa-bbbb-cccc-1234567890ab"
    short = await shorten_url(target)
    assert short.startswith("https://festio.events/api/s/")
    assert short != target

    resp = await ctx.client.get(
        short.replace("https://festio.events", ""), follow_redirects=False,
    )
    assert resp.status_code == 302
    assert resp.headers["location"] == target


@pytest.mark.asyncio
async def test_unknown_code_404s(ctx):
    resp = await ctx.client.get("/api/s/doesnotexist", follow_redirects=False)
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_shorten_url_without_a_host_is_returned_unchanged(ctx):
    assert await shorten_url("/relative/path") == "/relative/path"
