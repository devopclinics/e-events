"""Small provider boundary for Resend's Received Emails API."""
import httpx

from ..config import settings


async def fetch_received_email(email_id: str, *, transport=None) -> dict:
    if not settings.resend_api_key:
        raise RuntimeError("RESEND_API_KEY is not configured")
    async with httpx.AsyncClient(
        timeout=settings.inbound_email_fetch_timeout_seconds,
        transport=transport,
    ) as client:
        response = await client.get(
            f"https://api.resend.com/emails/receiving/{email_id}",
            headers={"Authorization": f"Bearer {settings.resend_api_key}"},
        )
    response.raise_for_status()
    data = response.json()
    if not isinstance(data, dict):
        raise RuntimeError("Resend returned an invalid received-email payload")
    return data
