"""Private issue-linked conversations + WebSocket endpoint + notifications.

Who may start what:
  citizen_admin  — the issue's reporter and admins (an admin can open one with the reporter)
  admin_worker   — admins and the issue's assigned worker
Only participants can read or post. Messages are pushed live to every participant's socket.
Official updates are NOT chat — they're posted with /admin/issues/{id}/official-update so they
appear on the public timeline.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, Request, UploadFile, WebSocket, WebSocketDisconnect, status
from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from app.core import rate_limit
from app.core.deps import ensure_admin_scope, get_current_user, user_from_token
from app.database.session import SessionLocal, get_db
from app.models import Conversation, ConversationParticipant, Issue, IssueAssignment, Message, Notification, User
from app.schemas.inputs import ConversationIn
from app.services import notifications, realtime, storage
from app.services.realtime import hub

router = APIRouter(tags=["communication"])


def _participant(db: Session, conv_id: uuid.UUID, user: User) -> ConversationParticipant:
    p = db.get(ConversationParticipant, (conv_id, user.id))
    if not p:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "You are not part of this conversation.")
    return p


def message_dict(m: Message) -> dict:
    return {"id": str(m.id), "conversation_id": str(m.conversation_id), "sender_id": str(m.sender_id),
            "sender_name": m.sender.full_name, "sender_role": m.sender.role, "body": m.body,
            "image_url": m.image_url, "created_at": m.created_at}


def conversation_dict(db: Session, c: Conversation, me: User) -> dict:
    mine = next((p for p in c.participants if p.user_id == me.id), None)
    last = db.scalar(select(Message).where(Message.conversation_id == c.id).order_by(Message.created_at.desc()).limit(1))
    unread = db.scalar(select(func.count()).select_from(Message).where(
        Message.conversation_id == c.id, Message.sender_id != me.id,
        Message.created_at > (mine.last_read_at if mine and mine.last_read_at else datetime(1970, 1, 1, tzinfo=timezone.utc))))
    issue = db.get(Issue, c.issue_id) if c.issue_id else None
    others = [p for p in c.participants if p.user_id != me.id]
    return {
        "id": str(c.id), "kind": c.kind, "subject": c.subject,
        "issue": {"id": str(issue.id), "tracking_id": issue.tracking_id, "title": issue.title, "status": issue.status} if issue else None,
        "participants": [{"id": str(p.user_id), "name": p.user.full_name, "role": p.user.role,
                          "last_read_at": p.last_read_at, "online": hub.is_online(str(p.user_id))} for p in c.participants],
        "with": ", ".join(p.user.full_name for p in others) or "—",
        "last_message": message_dict(last) if last else None, "unread": unread or 0, "updated_at": c.updated_at,
    }


@router.get("/api/conversations")
def list_conversations(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    convs = db.scalars(select(Conversation).join(ConversationParticipant).where(ConversationParticipant.user_id == user.id)
                       .order_by(Conversation.updated_at.desc())).all()
    return [conversation_dict(db, c, user) for c in convs]


@router.get("/api/conversations/unread")
def unread_total(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    return {"unread": sum(c["unread"] for c in list_conversations(db, user))}


@router.post("/api/conversations", status_code=201)
def start_conversation(body: ConversationIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    issue = db.get(Issue, body.issue_id)
    if not issue:
        raise HTTPException(404, "Issue not found.")
    active_worker = db.scalar(select(IssueAssignment.worker_id).where(IssueAssignment.issue_id == issue.id, IssueAssignment.is_active))
    admins = [u for u in notifications.admins_for(db, issue)]

    if body.kind == "citizen_admin":
        if user.role == "citizen":
            if issue.reporter_id != user.id:
                raise HTTPException(403, "Only the reporter can message officials about this issue.")
            members = [user.id] + admins
        elif user.role == "admin":
            ensure_admin_scope(user, issue)
            if not issue.reporter_id:
                raise HTTPException(409, "This report is anonymous — post an official update instead.")
            members = [user.id, issue.reporter_id]
        else:
            raise HTTPException(403, "Workers talk to citizens through official updates.")
    else:  # admin_worker
        if user.role == "worker":
            if active_worker != user.id:
                raise HTTPException(403, "You are not assigned to this issue.")
            members = [user.id] + admins
        elif user.role == "admin":
            ensure_admin_scope(user, issue)
            target = body.with_user_id or active_worker
            if not target or target != active_worker:
                raise HTTPException(409, "Assign a worker before starting a task conversation.")
            members = [user.id, target]
        else:
            raise HTTPException(403, "Citizens can't join worker conversations.")

    existing = db.scalar(select(Conversation).where(Conversation.issue_id == issue.id, Conversation.kind == body.kind)
                         .join(ConversationParticipant).where(ConversationParticipant.user_id == user.id))
    conv = existing
    if not conv:
        conv = Conversation(kind=body.kind, issue_id=issue.id,
                            subject=body.subject or f"{issue.tracking_id} · {issue.title}"[:200])
        db.add(conv)
        db.flush()
        for uid in dict.fromkeys(members):
            db.add(ConversationParticipant(conversation_id=conv.id, user_id=uid))
        db.flush()
        db.refresh(conv)
    _post(db, conv, user, body.first_message, None)
    db.commit()
    db.refresh(conv)
    return conversation_dict(db, conv, user)


@router.get("/api/conversations/{conv_id}/messages")
def messages(conv_id: uuid.UUID, before: datetime | None = None, limit: int = Query(50, le=200),
             db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    _participant(db, conv_id, user)
    q = select(Message).where(Message.conversation_id == conv_id)
    if before:
        q = q.where(Message.created_at < before)
    rows = list(db.scalars(q.order_by(Message.created_at.desc()).limit(limit)))
    rows.reverse()
    conv = db.get(Conversation, conv_id)
    return {"conversation": conversation_dict(db, conv, user), "messages": [message_dict(m) for m in rows]}


def _post(db: Session, conv: Conversation, user: User, body: str, image_url: str | None) -> Message:
    if not body.strip() and not image_url:
        raise HTTPException(422, "Write a message or attach a photo.")
    m = Message(conversation_id=conv.id, sender_id=user.id, body=body.strip(), image_url=image_url)
    db.add(m)
    conv.updated_at = datetime.now(timezone.utc)
    me = db.get(ConversationParticipant, (conv.id, user.id))
    me.last_read_at = datetime.now(timezone.utc)
    db.flush()
    db.refresh(m)
    others = [p.user_id for p in conv.participants if p.user_id != user.id]
    realtime.queue(db, [p.user_id for p in conv.participants], {"type": "message", "message": message_dict(m)})
    offline = [u for u in others if not hub.is_online(str(u))]
    issue = db.get(Issue, conv.issue_id) if conv.issue_id else None
    notifications.notify(db, offline, kind="message", title=f"New message from {user.full_name}",
                         body=(body or "Photo")[:140], issue=issue,
                         link=f"/messages/{conv.id}")
    return m


@router.post("/api/conversations/{conv_id}/messages", status_code=201)
def send_message(conv_id: uuid.UUID, request: Request, body: str = Form("", max_length=4000),
                 image: UploadFile | None = File(None), db: Session = Depends(get_db),
                 user: User = Depends(get_current_user)):
    rate_limit.check(f"msg:{user.id}", 30, 60)
    _participant(db, conv_id, user)
    conv = db.get(Conversation, conv_id)
    url = storage.save_image(image, "chat") if image and image.filename else None
    m = _post(db, conv, user, body, url)
    db.commit()
    return message_dict(m)


@router.post("/api/conversations/{conv_id}/read")
def mark_read(conv_id: uuid.UUID, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    p = _participant(db, conv_id, user)
    p.last_read_at = datetime.now(timezone.utc)
    conv = db.get(Conversation, conv_id)
    realtime.queue(db, [x.user_id for x in conv.participants],
                   {"type": "read", "conversation_id": str(conv_id), "user_id": str(user.id), "at": p.last_read_at.isoformat()})
    db.commit()
    return {"ok": True}


# ------------------------------------------------------------------ notifications
@router.get("/api/notifications")
def list_notifications(limit: int = Query(30, le=100), db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    rows = db.scalars(select(Notification).where(Notification.user_id == user.id)
                      .order_by(Notification.created_at.desc()).limit(limit)).all()
    unread = db.scalar(select(func.count()).select_from(Notification).where(Notification.user_id == user.id, Notification.read_at.is_(None)))
    return {"unread": unread, "items": [{"id": str(n.id), "kind": n.kind, "title": n.title, "body": n.body, "link": n.link,
                                         "issue_id": str(n.issue_id) if n.issue_id else None,
                                         "read_at": n.read_at, "created_at": n.created_at} for n in rows]}


@router.post("/api/notifications/{nid}/read")
def read_notification(nid: uuid.UUID, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    db.execute(update(Notification).where(Notification.id == nid, Notification.user_id == user.id)
               .values(read_at=datetime.now(timezone.utc)))
    db.commit()
    return {"ok": True}


@router.post("/api/notifications/read-all")
def read_all(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    db.execute(update(Notification).where(Notification.user_id == user.id, Notification.read_at.is_(None))
               .values(read_at=datetime.now(timezone.utc)))
    db.commit()
    return {"ok": True}


# ------------------------------------------------------------------ websocket
@router.websocket("/ws")
async def websocket(ws: WebSocket, token: str = Query("")):
    with SessionLocal() as db:
        user = user_from_token(db, token)
        uid = str(user.id) if user else None
    if not uid:
        await ws.close(code=4401)
        return
    await hub.connect(uid, ws)
    try:
        await ws.send_json({"type": "hello", "user_id": uid})
        while True:
            msg = await ws.receive_text()
            if msg == "ping":
                await ws.send_text('{"type":"pong"}')
    except WebSocketDisconnect:
        pass
    finally:
        hub.disconnect(uid, ws)
