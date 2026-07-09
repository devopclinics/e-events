"""Upload storage abstraction.

Files (event cover images, floor-plan backgrounds) are written through here so
the app can run either single-host (local disk, the default) or multi-replica
(shared S3). The stored reference URL — `/api/uploads/<subpath>` — is identical
across both backends, so existing DB values, the frontend, and OG link previews
keep working unchanged; only where the bytes live differs.

S3 is enabled by setting UPLOADS_S3_BUCKET. Without it, behavior is byte-for-byte
the original local-disk path.
"""
import os

UPLOADS_DIR = os.environ.get("UPLOADS_DIR", "/app/uploads")
S3_BUCKET = os.environ.get("UPLOADS_S3_BUCKET", "").strip()
# Optional key prefix inside the bucket (keeps uploads namespaced from other data).
S3_PREFIX = os.environ.get("UPLOADS_S3_PREFIX", "uploads").strip("/")
AWS_REGION = os.environ.get("AWS_REGION", "us-east-1")
# Set to a MinIO/S3-compatible endpoint (e.g. http://minio:9000) to use in-cluster
# object storage instead of AWS S3 — zero cloud cost. Empty = real AWS S3.
S3_ENDPOINT = os.environ.get("UPLOADS_S3_ENDPOINT", "").strip()

_URL_PREFIX = "/api/uploads/"
_s3_client = None


def s3_enabled() -> bool:
    return bool(S3_BUCKET)


def _client():
    global _s3_client
    if _s3_client is None:
        import boto3
        kwargs = {"region_name": AWS_REGION}
        if S3_ENDPOINT:
            # MinIO/S3-compatible: custom endpoint + path-style addressing.
            from botocore.config import Config
            kwargs["endpoint_url"] = S3_ENDPOINT
            kwargs["config"] = Config(s3={"addressing_style": "path"})
        _s3_client = boto3.client("s3", **kwargs)
        # For self-hosted endpoints (MinIO), create the bucket if missing so the
        # deployment is zero-touch. Never auto-create on real AWS S3 (bucket
        # naming/region/ownership are deliberate there).
        if S3_ENDPOINT:
            try:
                _s3_client.head_bucket(Bucket=S3_BUCKET)
            except Exception:
                try:
                    _s3_client.create_bucket(Bucket=S3_BUCKET)
                except Exception:
                    pass
    return _s3_client


def _s3_key(subpath: str) -> str:
    return f"{S3_PREFIX}/{subpath}" if S3_PREFIX else subpath


def subpath_from_url(url: str) -> str:
    """'/api/uploads/events/x.jpg' -> 'events/x.jpg' (safe prefix strip)."""
    return url[len(_URL_PREFIX):] if url.startswith(_URL_PREFIX) else url.lstrip("/")


def save(subpath: str, data: bytes, content_type: str) -> str:
    """Persist bytes at a logical subpath (e.g. 'events/cover.jpg').
    Returns the stable reference URL '/api/uploads/<subpath>'."""
    if s3_enabled():
        _client().put_object(
            Bucket=S3_BUCKET, Key=_s3_key(subpath), Body=data, ContentType=content_type
        )
    else:
        path = os.path.join(UPLOADS_DIR, subpath)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "wb") as f:
            f.write(data)
    return f"{_URL_PREFIX}{subpath}"


def delete(subpath: str) -> None:
    """Best-effort delete; never raises (mirrors the original os.remove behavior)."""
    if s3_enabled():
        try:
            _client().delete_object(Bucket=S3_BUCKET, Key=_s3_key(subpath))
        except Exception:
            pass
    else:
        try:
            os.remove(os.path.join(UPLOADS_DIR, subpath))
        except OSError:
            pass


def open_stream(subpath: str):
    """For the S3 serving route: return (chunk-iterator, content_type) or None if
    missing. Local disk returns None — it is served by StaticFiles instead."""
    if not s3_enabled():
        return None
    try:
        obj = _client().get_object(Bucket=S3_BUCKET, Key=_s3_key(subpath))
    except Exception:
        return None
    body = obj["Body"]
    return body.iter_chunks(chunk_size=8192), obj.get("ContentType", "application/octet-stream")
