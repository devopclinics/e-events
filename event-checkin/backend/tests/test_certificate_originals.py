from types import SimpleNamespace
import pytest
from app.routers.live_content import _certificate_html


def sample(layout, version=2):
    return SimpleNamespace(snapshot={'participant_name':'Ada Participant','event_name':'Example Conference','event_date_local':'2026-11-11T10:00:00','event_venue':'Lagos','design':{'layout':layout,'layout_version':version,'theme':'A better future','organisation':'Example Organisation'}}, certificate_number='SAMPLE-42',verification_token='sample-token')


@pytest.mark.parametrize('layout',['royal','heritage','midnight','ivory'])
def test_original_composition_and_safe_dynamic_fields(layout):
    cert=sample(layout)
    preview=_certificate_html(cert,preview=True)
    assert 'class="mast"' in preview and 'class="theme"' in preview and 'class="seal"' in preview
    assert 'Ada Participant' in preview and 'A better future' in preview and 'Example Organisation' in preview
    assert '11 November 2026' in preview and 'Lagos' in preview
    assert '@@' not in preview and 'contenteditable' not in preview and 'paman-logo.png' not in preview
    assert 'DESIGN PREVIEW' in preview and 'data:image/png;base64' not in preview
    issued=_certificate_html(cert)
    assert 'SAMPLE-42' in issued and 'Scan to verify' in issued and 'data:image/png;base64' in issued
    cert.snapshot['participant_name']='<script>alert(1)</script>'
    assert '<script>' not in _certificate_html(cert) and '&lt;script&gt;' in _certificate_html(cert)
    assert 'class="mast"' not in _certificate_html(sample(layout,version=1))


@pytest.mark.asyncio
async def test_studio_preview_is_event_scoped_and_matches_shared_renderer(ctx):
    event_id=ctx.ids['event_a'];ctx.login(ctx.ids['user_a'])
    body={'name':'Preview','design':{'layout':'royal','layout_version':2,'theme':'Reviewed theme'}}
    response=await ctx.client.post(f'/api/events/{event_id}/certificate-preview',json=body)
    assert response.status_code==200,response.text
    assert 'Reviewed theme' in response.json()['html'] and 'DESIGN PREVIEW' in response.json()['html']
    ctx.login(ctx.ids['user_b'])
    assert (await ctx.client.post(f'/api/events/{event_id}/certificate-preview',json=body)).status_code in (403,404)
