"""Email notifications (optional extension of the in-app notifications).

How it works
------------
`notifications.notify()` calls `queue()` for notification kinds worth an email (status changes,
official updates, assignments, deadline warnings, announcements…). Emails are only sent **after the
database transaction commits**, on a background thread, so a slow mail server never delays a request
and nothing is emailed for a change that was rolled back.

Backends (EMAIL_BACKEND):
  outbox  (default) write each email as a .eml file in OUTBOX_DIR — open them with any mail client.
          Lets you demonstrate email without configuring a mail server.
  smtp    send through SMTP_HOST (e.g. Gmail app password, Mailtrap, SendGrid SMTP).
  none    disabled.

Users can switch emails off (users.email_notifications); in-app notifications continue regardless.
"""
from __future__ import annotations

import logging
import smtplib
import ssl
import threading
import uuid
from datetime import datetime, timezone
from email.message import EmailMessage
from html import escape
from pathlib import Path

from sqlalchemy import event, select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models import User

log = logging.getLogger("openward.email")

# Notification kinds that also send an email. Chatty kinds (comments, read receipts) stay in-app only.
EMAIL_KINDS = {
    "submitted", "status_changed", "official_update", "progress_update", "assignment", "acknowledged",
    "escalation", "sla_warning", "announcement", "feedback_negative", "message", "new_issue",
}


def queue(db: Session, user_ids: list[uuid.UUID], *, kind: str, title: str, body: str | None, link: str | None) -> None:
    if settings.email_backend == "none" or kind not in EMAIL_KINDS or not user_ids:
        return
    rows = db.execute(select(User.email, User.full_name).where(
        User.id.in_(user_ids), User.is_active.is_(True), User.email_notifications.is_(True))).all()
    pending = db.info.setdefault("email_pending", [])
    for email, name in rows:
        pending.append(build(email, name, title, body, link))


# Kinds that also go to people who follow a single report by email (no account).
SUBSCRIBER_KINDS = {"status_changed", "official_update", "progress_update"}


def queue_subscribers(db: Session, issue_id, *, kind: str, title: str, body: str | None, link: str | None) -> None:
    """Email confirmed 'Get updates on this report' subscribers, each with their own unsubscribe link."""
    if settings.email_backend == "none" or kind not in SUBSCRIBER_KINDS or issue_id is None:
        return
    from app.models import IssueEmailSubscription  # local import keeps model loading order simple
    subs = db.scalars(select(IssueEmailSubscription).where(
        IssueEmailSubscription.issue_id == issue_id, IssueEmailSubscription.confirmed_at.is_not(None))).all()
    pending = db.info.setdefault("email_pending", [])
    for sub in subs:
        pending.append(build(sub.email, "", title, body, link, unsubscribe=f"/updates/unsubscribe/{sub.token}"))


def build(to: str, name: str, title: str, body: str | None, link: str | None, unsubscribe: str | None = None,
          cta: str = "Open on Commons") -> EmailMessage:
    url = f"{settings.frontend_url}{link}" if link else settings.frontend_url
    msg = EmailMessage()
    msg["Subject"] = f"Commons: {title}"
    msg["From"] = settings.smtp_from
    msg["To"] = to
    msg["Date"] = datetime.now(timezone.utc).strftime("%a, %d %b %Y %H:%M:%S +0000")
    first = name.split()[0] if name else "there"
    footer = (f"Stop these emails: {settings.frontend_url}{unsubscribe}" if unsubscribe
              else "You can turn off email updates from your account menu on Commons.")
    text = f"Hello {first},\n\n{title}\n" + (f"\n{body}\n" if body else "") + f"\n{cta}: {url}\n\n{footer}\n"
    msg.set_content(text)
    foot = (f'<a href="{escape(settings.frontend_url + unsubscribe)}" style="color:#5c5c57">Stop these emails</a>' if unsubscribe
            else "You can turn off email updates from your account menu on Commons.")
    msg.add_alternative(f"""<div style="background:#fbfaf7;padding:32px 16px">
<div style="max-width:560px;margin:0 auto;font-family:'Work Sans',Arial,sans-serif;font-size:15px;line-height:24px;color:#1d1d1b">
  <p style="font-family:'Libre Baskerville',Georgia,serif;font-size:22px;margin:0 0 4px">Commons</p>
  <div style="width:64px;height:1px;background:#1d1d1b;margin:8px 0 4px"></div><div style="width:32px;height:1px;background:#dcdbd4;margin:0 0 24px"></div>
  <p style="margin:0 0 12px">Hello {escape(first)},</p>
  <p style="font-family:'Libre Baskerville',Georgia,serif;font-weight:700;font-size:16px;line-height:22px;margin:0 0 8px">{escape(title)}</p>
  {f'<p style="color:#5c5c57;margin:0 0 24px">{escape(body)}</p>' if body else ''}
  <p style="margin:24px 0"><a href="{escape(url)}" style="background:#2f6b41;color:#ffffff;padding:12px 16px;border-radius:3px;text-decoration:none;font-weight:500;font-size:13px">{escape(cta)}</a></p>
  <p style="font-size:11px;line-height:16px;color:#5c5c57;border-top:1px solid #dcdbd4;padding-top:12px">{foot}</p>
</div></div>""", subtype="html")
    return msg


def send(messages: list[EmailMessage]) -> None:
    if not messages:
        return
    try:
        if settings.email_backend == "smtp":
            ctx = ssl.create_default_context()
            with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=20) as s:
                if settings.smtp_starttls:
                    s.starttls(context=ctx)
                if settings.smtp_user:
                    s.login(settings.smtp_user, settings.smtp_password)
                for m in messages:
                    s.send_message(m)
        elif settings.email_backend == "outbox":
            out = Path(settings.outbox_dir)
            out.mkdir(parents=True, exist_ok=True)
            for m in messages:
                stamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
                (out / f"{stamp}-{uuid.uuid4().hex[:8]}.eml").write_bytes(bytes(m))
    except Exception:  # email must never break the app
        log.exception("sending %d email(s) failed", len(messages))


@event.listens_for(Session, "after_commit")
def _send_after_commit(session: Session) -> None:
    pending = session.info.pop("email_pending", [])
    if not pending:
        return
    if settings.email_sync:
        send(pending)
    else:
        threading.Thread(target=send, args=(pending,), daemon=True).start()


@event.listens_for(Session, "after_rollback")
def _drop_after_rollback(session: Session) -> None:
    session.info.pop("email_pending", None)
