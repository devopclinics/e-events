from fastapi import APIRouter, HTTPException
from fastapi.responses import RedirectResponse

from services.shortlinks import resolve_short_url

router = APIRouter()


@router.get("/{code}")
async def resolve(code: str):
    target = await resolve_short_url(code)
    if not target:
        raise HTTPException(404, "Link not found or expired")
    return RedirectResponse(target, status_code=302)
