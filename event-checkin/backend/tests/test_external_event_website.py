import pytest
from pydantic import ValidationError
from app.schemas import EventUpdate
from app.models import Guest
from conftest import _Session

@pytest.mark.parametrize('url', [42, {}, 'javascript:alert(1)', 'data:text/html,x', '//evil.example', 'https://user:secret@example.org', 'https://example.org\\evil', 'https://example.org/\nfoo'])
def test_reject_unsafe_website(url):
    with pytest.raises(ValidationError):
        EventUpdate(external_website_url=url)

@pytest.mark.parametrize('value,expected', [('  https://convention.example/path?x=1#home  ', 'https://convention.example/path?x=1#home'), ('http://convention.example','http://convention.example/'), ('',None), ('   ',None), (None,None)])
def test_normalize_or_clear_website(value,expected):
    assert EventUpdate(external_website_url=value).external_website_url == expected

@pytest.mark.asyncio
async def test_save_guest_exposure_clear_and_tenant_isolation(ctx):
    ctx.login(ctx.ids['user_a'])
    event_id=ctx.ids['event_a']
    response=await ctx.client.put(f'/api/events/{event_id}',json={'external_website_url':'https://convention.example'})
    assert response.status_code==200,response.text
    assert response.json()['external_website_url']=='https://convention.example/'
    async with _Session() as db:
        guest=Guest(event_id=event_id,first_name='Website',last_name='test',invite_token='website-link-test',qr_token='website-pass-test')
        db.add(guest);await db.commit()
    invite=await ctx.client.get('/api/invite/token/website-link-test')
    assert invite.status_code==200,invite.text
    assert invite.json()['event']['external_website_url']=='https://convention.example/'
    ticket=await ctx.client.get('/api/scan/website-pass-test/ticket')
    assert ticket.status_code==200,ticket.text
    assert ticket.json()['event']['external_website_url']=='https://convention.example/'
    invalid=await ctx.client.put(f'/api/events/{event_id}',json={'external_website_url':'javascript:alert(1)'})
    assert invalid.status_code==422
    ctx.login(ctx.ids['user_b'])
    foreign=await ctx.client.put(f'/api/events/{event_id}',json={'external_website_url':'https://foreign.example'})
    assert foreign.status_code in (403,404)
    ctx.login(ctx.ids['user_a'])
    clear=await ctx.client.put(f'/api/events/{event_id}',json={'external_website_url':None})
    assert clear.status_code==200,clear.text
    assert clear.json()['external_website_url'] is None
