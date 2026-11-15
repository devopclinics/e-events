import hashlib
import pytest
from app.routers.invoice_library import FILES

BASE = '/api/media/invoices'

@pytest.mark.asyncio
async def test_invoice_archive_is_staff_only(ctx):
    ctx.login(ctx.ids['user_b'])
    assert (await ctx.client.get(BASE)).status_code == 403
    assert (await ctx.client.get(BASE + '/honeybols-50th-birthday-150/download')).status_code == 403

@pytest.mark.asyncio
async def test_catalog_and_exact_download(ctx):
    ctx.login(ctx.ids['superadmin'])
    response = await ctx.client.get(BASE)
    assert response.status_code == 200
    assert response.headers['cache-control'] == 'private, no-store'
    rows = response.json()
    assert len({r['id'] for r in rows}) == len(rows)
    current = next(r for r in rows if r['id'] == 'honeybols-50th-birthday-150')
    assert current['total'] == 275000 and current['currency'] == 'NGN'
    assert current['event_date'] is None
    assert current['status'] == 'Issued'
    assert current['reference'] == 'FES-20261115-H150'
    assert current['issued_date'] == '2026-11-15'
    assert current['sha256'] == hashlib.sha256((FILES / current['filename']).read_bytes()).hexdigest()
    for row in rows:
        result = await ctx.client.get(BASE + '/' + row['id'] + '/download')
        assert result.status_code == 200
        assert result.headers['content-type'] == 'application/pdf'
        assert 'attachment' in result.headers['content-disposition']
        assert row['filename'] in result.headers['content-disposition']
        assert result.headers['cache-control'] == 'private, no-store'
        assert result.content == (FILES / row['filename']).read_bytes()
        assert result.content.startswith(b'%PDF-')

@pytest.mark.asyncio
async def test_unknown_invoice_cannot_read_arbitrary_file(ctx):
    ctx.login(ctx.ids['superadmin'])
    for value in ['unknown', 'catalog.json', '%2e%2e%2fconfig.py']:
        assert (await ctx.client.get(BASE + '/' + value + '/download')).status_code == 404
