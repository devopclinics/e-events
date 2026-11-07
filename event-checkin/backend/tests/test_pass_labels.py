import io
import pytest
from sqlalchemy import select
from PIL import Image
from conftest import _Session
from test_group_passes import setup
from app.models import Guest,GuestSessionAccess,Event
from app.services.pass_labels import pass_labels
from services.ticket_card import generate_ticket_card
from services.qr_service import generate_qr_for_url

@pytest.mark.asyncio
async def test_reusable_group_role_access_and_current_changes(ctx):
    i=await setup(ctx)
    async with _Session() as db:
        guest=await db.get(Guest,i['guest']);guest.first_name='Media';guest.last_name='Group';guest.rsvp_guest_type='Panelist';qr=guest.qr_token;await db.commit()
    response=await ctx.client.get(f'/api/scan/{qr}/labels');assert response.status_code==200,response.text
    assert response.headers['cache-control']=='no-store'
    assert set(response.json()['labels'])=={'Panelist','Media Group','Admits up to 3 people','Conference + Dinner'}
    async with _Session() as db:
        rule=await db.scalar(select(GuestSessionAccess).where(GuestSessionAccess.guest_id==i['guest'],GuestSessionAccess.zone_id==i['dinner']));rule.decision='block';await db.commit()
    response=await ctx.client.get(f'/api/scan/{qr}/labels')
    assert 'Conference only' in response.json()['labels']
    assert 'Conference + Dinner' not in response.json()['labels']
    async with _Session() as db:
        guest=await db.get(Guest,i['guest']);assert guest.qr_token==qr
        guest.rsvp_status='declined';await db.commit()
    assert (await ctx.client.get(f'/api/scan/{qr}/labels')).status_code==404
    assert (await ctx.client.get('/api/scan/invalid/labels')).status_code==404

def test_card_reserves_space_for_wrapped_pass_labels():
    qr=generate_qr_for_url('https://example.invalid/scan/opaque-token')
    plain=generate_ticket_card(event_name='Conference',guest_first_name='QA',qr_png_bytes=qr)
    labelled=generate_ticket_card(event_name='Conference',guest_first_name='QA',qr_png_bytes=qr,pass_labels=['Keynote Speaker','Conference + Dinner','Admits up to 10 people'])
    a=Image.open(io.BytesIO(plain));b=Image.open(io.BytesIO(labelled))
    assert b.width==a.width==640
    assert b.height>a.height
