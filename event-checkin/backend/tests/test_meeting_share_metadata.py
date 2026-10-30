"""Link previews must identify the meeting without exposing the invitation body."""
from html.parser import HTMLParser

import pytest
from sqlalchemy import select, func

from app.models import MeetingAttendee, MeetingDelivery
from conftest import _Session
from test_meetings import create, publish, setup_meetings

pytestmark = pytest.mark.asyncio


class Metadata(HTMLParser):
    def __init__(self, document):
        super().__init__()
        self.tags = {}
        self.feed(document)

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == "meta":
            self.tags[attrs.get("property") or attrs.get("name")] = attrs.get("content")


def check_card(response, title):
    assert response.status_code == 200, response.text
    tags = Metadata(response.text).tags
    assert tags["og:title"] == title
    assert tags["twitter:title"] == title
    assert tags["og:image"].endswith("/media/og-image.png")
    assert response.headers["cache-control"] == "no-store"
    assert response.headers["referrer-policy"] == "no-referrer"
    assert response.headers["x-robots-tag"] == "noindex, nofollow"
    for private_value in ["Alex", "Jamie", "alex@example.com", "Review progress", "https://example.com/meeting"]:
        assert private_value not in response.text
    return tags


async def test_personal_card_shows_published_title_without_changing_response_or_delivery(ctx):
    title = 'Board <Review> & "Planning"'
    meeting = await publish(ctx, await create(ctx, title=title))
    attendee = meeting["attendees"][0]
    token = (await ctx.client.get(f'/api/meetings/{meeting["id"]}/attendees/{attendee["id"]}/link')).json()["url"].rsplit("/", 1)[1]
    async with _Session() as db:
        before = await db.scalar(select(func.count(MeetingDelivery.id)))
    ctx.login(None)
    response = await ctx.client.get('/api/og/meeting-response/' + token + '?response=accepted')
    tags = check_card(response, title)
    assert tags["og:url"].endswith('/meeting-response/' + token)
    assert "<Review>" not in response.text
    async with _Session() as db:
        assert (await db.get(MeetingAttendee, attendee["id"])).response == "pending"
        assert await db.scalar(select(func.count(MeetingDelivery.id))) == before


async def test_reusable_card_shows_draft_title_without_creating_attendees_or_deliveries(ctx):
    meeting = await create(ctx, title="Community planning")
    token = (await ctx.client.post(f'/api/meetings/{meeting["id"]}/share-link')).json()["url"].rsplit("/", 1)[1]
    ctx.login(None)
    tags = check_card(await ctx.client.get('/api/og/meeting-invitation/' + token), "Community planning")
    assert tags["og:url"].endswith('/meeting-invitation/' + token)
    async with _Session() as db:
        assert await db.scalar(select(func.count(MeetingAttendee.id))) == 0
        assert await db.scalar(select(func.count(MeetingDelivery.id))) == 0
    assert (await ctx.client.get('/api/og/meeting-response/' + token)).status_code == 410


async def test_share_card_rejects_changed_or_cancelled_invitation(ctx):
    meeting = await create(ctx)
    token = (await ctx.client.post(f'/api/meetings/{meeting["id"]}/share-link')).json()["url"].rsplit("/", 1)[1]
    updated = await ctx.client.put(f'/api/meetings/{meeting["id"]}', json={**meeting['draft'], 'title': 'A revised meeting', 'revision': meeting['revision']})
    assert updated.status_code == 200
    response = await ctx.client.get('/api/og/meeting-invitation/' + token)
    assert response.status_code == 410
    assert "Project catch-up" not in response.text and "A revised meeting" not in response.text
    token = (await ctx.client.post(f'/api/meetings/{meeting["id"]}/share-link')).json()["url"].rsplit("/", 1)[1]
    assert (await ctx.client.post(f'/api/meetings/{meeting["id"]}/cancel', json={'revision': updated.json()['revision']})).status_code == 200
    assert (await ctx.client.get('/api/og/meeting-invitation/' + token)).status_code == 410


@pytest.mark.parametrize('kind', ['meeting-response', 'meeting-invitation'])
async def test_invalid_metadata_links_keep_privacy_headers(ctx, kind):
    response = await ctx.client.get('/api/og/' + kind + '/invalid')
    assert response.status_code == 410
    assert response.headers['cache-control'] == 'no-store'
    assert response.headers['referrer-policy'] == 'no-referrer'
    assert response.headers['x-robots-tag'] == 'noindex, nofollow'
