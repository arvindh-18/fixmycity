"""Image storage with validation and privacy cleaning.

Every upload is:
  1. checked against an allow-list of content types and a size limit,
  2. decoded with Pillow (proves it is really an image, not a renamed script),
  3. re-encoded without metadata — this strips EXIF, including the GPS position of the person
     who took the photo,
  4. stored under a random UUID filename (users never control paths).

Backends: local folder (default, served at /media) or Supabase Storage (set STORAGE_BACKEND=supabase).
"""
from __future__ import annotations

import io
import uuid
from pathlib import Path

import httpx
from fastapi import HTTPException, UploadFile, status
from PIL import Image, ImageOps, UnidentifiedImageError

from app.core.config import settings

ALLOWED_TYPES = {"image/jpeg", "image/png", "image/webp"}
MAX_DIMENSION = 2400


def _clean_image(raw: bytes) -> tuple[bytes, str]:
    try:
        img = Image.open(io.BytesIO(raw))
        img.verify()  # structural check
        img = Image.open(io.BytesIO(raw))
        img = ImageOps.exif_transpose(img)  # keep orientation, then drop EXIF
    except (UnidentifiedImageError, OSError, SyntaxError):
        raise HTTPException(422, "That file isn't a readable image.")
    if img.mode not in ("RGB", "L"):
        img = img.convert("RGB")
    img.thumbnail((MAX_DIMENSION, MAX_DIMENSION))
    out = io.BytesIO()
    img.save(out, format="JPEG", quality=85, optimize=True)  # no exif= argument -> metadata dropped
    return out.getvalue(), "jpg"


def validate_and_read(upload: UploadFile) -> bytes:
    if upload.content_type not in ALLOWED_TYPES:
        raise HTTPException(status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, "Upload a JPEG, PNG or WebP photo.")
    raw = upload.file.read(settings.max_upload_mb * 1024 * 1024 + 1)
    if len(raw) > settings.max_upload_mb * 1024 * 1024:
        raise HTTPException(413, f"Photos must be under {settings.max_upload_mb} MB.")
    if not raw:
        raise HTTPException(422, "The uploaded file is empty.")
    return raw


def clean_upload(upload: UploadFile) -> bytes:
    """Validate and clean an upload without storing it (EXIF removed)."""
    return _clean_image(validate_and_read(upload))[0]


def save_image(upload: UploadFile, folder: str = "issues") -> str:
    return save_image_with_bytes(upload, folder)[0]


def save_image_with_bytes(upload: UploadFile, folder: str = "issues") -> tuple[str, bytes]:
    """Like save_image, but also returns the cleaned JPEG bytes (used for AI photo analysis)."""
    data, ext = _clean_image(validate_and_read(upload))
    return save_bytes(data, folder, ext), data


def save_bytes(data: bytes, folder: str, ext: str = "jpg") -> str:
    name = f"{folder}/{uuid.uuid4().hex}.{ext}"
    if settings.storage_backend == "supabase" and settings.supabase_url and settings.supabase_service_key:
        url = f"{settings.supabase_url}/storage/v1/object/{settings.supabase_bucket}/{name}"
        resp = httpx.post(url, content=data, timeout=30, headers={
            "Authorization": f"Bearer {settings.supabase_service_key}", "Content-Type": "image/jpeg"})
        if resp.status_code >= 300:
            raise HTTPException(status.HTTP_502_BAD_GATEWAY, "Photo storage is unavailable. Try again shortly.")
        return f"{settings.supabase_url}/storage/v1/object/public/{settings.supabase_bucket}/{name}"
    path = Path(settings.media_dir) / name
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)
    return f"/media/{name}"
