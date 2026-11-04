"""AI endpoints. All return `mode` ("llm" or "rules") so the UI can label demonstration mode."""
from __future__ import annotations

from fastapi import APIRouter, Depends, File, Form, Request, UploadFile
from sqlalchemy.orm import Session

from app.core import rate_limit
from app.core.deps import client_ip, optional_user
from app.database.session import get_db
from app.integrations.ai import assistant, classifier, provider
from app.services import storage
from app.models import User
from app.schemas.inputs import AssistantIn, ClassifyIn
from app.services.issue_service import category_payload

router = APIRouter(prefix="/api/ai", tags=["ai"])


@router.get("/status")
def status():
    return {"mode": provider.mode(), "provider": provider.provider_name(),
            "note": None if provider.llm_configured() else
            "Demonstration mode: suggestions come from transparent rules, not a language model."}


@router.post("/classify")
def classify(body: ClassifyIn, request: Request, db: Session = Depends(get_db)):
    """Used by the report form to suggest a category. The citizen picks the final one."""
    rate_limit.check(f"classify:{client_ip(request)}", 30, 60)
    result = classifier.classify(body.title, body.description, category_payload(db))
    cat = next((c for c in category_payload(db) if c["slug"] == result["category_slug"]), None)
    result["category_id"] = str(cat["id"]) if cat else None
    result["category_name"] = cat["name"] if cat else None
    return result


@router.post("/assistant")
def ask(body: AssistantIn, request: Request, db: Session = Depends(get_db), user: User | None = Depends(optional_user)):
    rate_limit.check(f"assistant:{user.id if user else client_ip(request)}", 20, 60)
    return assistant.answer(db, body.question, user, body.lat, body.lng)


@router.post("/classify-photo")
def classify_photo(request: Request, title: str = Form("", max_length=140), description: str = Form(..., min_length=5, max_length=5000),
                   photo: UploadFile = File(...), db: Session = Depends(get_db)):
    """Report form: once a photo is attached, check what it shows (vision model only; nothing is stored)."""
    rate_limit.check(f"classify-photo:{client_ip(request)}", 10, 60)
    data = storage.clean_upload(photo)
    result = classifier.classify(title, description, category_payload(db), image=data)
    cat = next((c for c in category_payload(db) if c["slug"] == result["category_slug"]), None)
    result["category_id"] = str(cat["id"]) if cat else None
    result["category_name"] = cat["name"] if cat else None
    return result
