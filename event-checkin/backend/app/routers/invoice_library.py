"""Staff invoice archive. PDF bytes are served only after staff authorization."""
import json
from pathlib import Path
from fastapi import APIRouter, Depends, HTTPException, Response
from fastapi.responses import FileResponse
from ..auth import require_superadmin

router = APIRouter(dependencies=[Depends(require_superadmin)])
FILES = Path(__file__).resolve().parents[1] / "invoice_files"

def catalog():
    return json.loads((FILES / "catalog.json").read_text())

@router.get("")
async def list_invoices(response: Response):
    response.headers["Cache-Control"] = "private, no-store"
    return catalog()

@router.get("/{invoice_id}/download")
async def download_invoice(invoice_id: str):
    record = next((row for row in catalog() if row["id"] == invoice_id), None)
    if record is None:
        raise HTTPException(404, "Invoice not found")
    path = (FILES / record["filename"]).resolve()
    if path.parent != FILES.resolve() or not path.is_file():
        raise HTTPException(404, "Invoice file not found")
    return FileResponse(path, media_type="application/pdf", filename=record["filename"],
                        headers={"Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff"})
