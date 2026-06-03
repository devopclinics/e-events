import asyncio
import psutil
from fastapi import APIRouter, Depends
from ..auth import require_admin
from ..models import User

router = APIRouter()


@router.get("/health")
async def system_health(_: User = Depends(require_admin)):
    mem = psutil.virtual_memory()
    disk = psutil.disk_usage("/")
    # cpu_percent with interval=None is non-blocking; it returns the
    # cumulative CPU usage since the previous call (or since boot).
    cpu_percent = await asyncio.to_thread(psutil.cpu_percent, 0.2)

    return {
        "cpu": {
            "percent": cpu_percent,
        },
        "memory": {
            "total_mb":     round(mem.total     / 1024 / 1024, 1),
            "used_mb":      round(mem.used      / 1024 / 1024, 1),
            "available_mb": round(mem.available / 1024 / 1024, 1),
            "percent":      mem.percent,
        },
        "disk": {
            "total_gb":  round(disk.total / 1024 / 1024 / 1024, 2),
            "used_gb":   round(disk.used  / 1024 / 1024 / 1024, 2),
            "free_gb":   round(disk.free  / 1024 / 1024 / 1024, 2),
            "percent":   disk.percent,
        },
    }
