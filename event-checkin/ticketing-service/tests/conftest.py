"""Ticketing regression tests cannot contact real providers or a live database."""
import os
import httpx
import pytest

os.environ["DATABASE_URL"]="sqlite+aiosqlite://"


@pytest.fixture(autouse=True)
def no_real_provider_transport(monkeypatch):
    def reject(*args,**kwargs):
        raise AssertionError("Real provider HTTP forbidden in synthetic ticketing tests")
    async def reject_async(*args,**kwargs):
        raise AssertionError("Real provider HTTP forbidden in synthetic ticketing tests")
    monkeypatch.setattr(httpx.HTTPTransport,"handle_request",reject)
    monkeypatch.setattr(httpx.AsyncHTTPTransport,"handle_async_request",reject_async)
