"""Complaint history PDF ("RTI-ready" supporting document) built with ReportLab.

The document states plainly that it is NOT an official RTI application or legal document — it is a
record the citizen can attach to their own formal enquiry.
"""
from __future__ import annotations

import io
from datetime import datetime, timezone
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import Image, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

from app.core.config import settings

NAVY = colors.HexColor("#1d1d1b")  # Commons ink
SLATE = colors.HexColor("#5c5c57")  # ink-muted
LINE = colors.HexColor("#dcdbd4")  # rule


def _styles():
    ss = getSampleStyleSheet()
    return {
        "title": ParagraphStyle("t", parent=ss["Title"], fontName="Times-Roman", fontSize=22, textColor=NAVY, alignment=0, spaceAfter=4),
        "h": ParagraphStyle("h", parent=ss["Heading2"], fontName="Helvetica-Bold", fontSize=11, textColor=NAVY, spaceBefore=10, spaceAfter=4),
        "p": ParagraphStyle("p", parent=ss["BodyText"], fontName="Helvetica", fontSize=9.5, leading=13),
        "small": ParagraphStyle("s", parent=ss["BodyText"], fontName="Helvetica", fontSize=8, leading=10, textColor=SLATE),
        "cell": ParagraphStyle("c", parent=ss["BodyText"], fontName="Helvetica", fontSize=8.5, leading=11),
    }


def _esc(s) -> str:
    return (str(s) if s is not None else "—").replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def _fmt(dt) -> str:
    return dt.strftime("%d %b %Y, %H:%M UTC") if dt else "—"


def _local_image(url: str):
    if url.startswith("/media/"):
        p = Path(settings.media_dir) / url.removeprefix("/media/")
        if p.exists():
            try:
                return Image(str(p), width=55 * mm, height=40 * mm, kind="proportional")
            except Exception:
                return None
    return None


def build(issue: dict, timeline: list[dict], evidence: list[dict]) -> bytes:
    st = _styles()
    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=A4, leftMargin=18 * mm, rightMargin=18 * mm,
                            topMargin=16 * mm, bottomMargin=16 * mm,
                            title=f"Complaint history {issue['tracking_id']}", author="Commons")
    flow = [
        Paragraph("Complaint history record", st["title"]),
        Paragraph(f"Tracking ID <b>{_esc(issue['tracking_id'])}</b> · generated {_fmt(datetime.now(timezone.utc))}", st["small"]),
        Spacer(1, 4),
        Paragraph("This record was exported from the Commons civic issue platform. It is supporting documentation "
                  "for your own enquiries. It is <b>not</b> an official RTI application, government certificate or "
                  "legal document.", st["small"]),
        Paragraph("Complaint", st["h"]),
    ]
    rows = [
        ("Title", issue["title"]), ("Description", issue["description"]),
        ("Category", (issue.get("category") or {}).get("name")), ("Department", (issue.get("department") or {}).get("name") or "Not yet assigned"),
        ("Location", f"{issue.get('address') or ''} ({issue['lat']:.5f}, {issue['lng']:.5f})"),
        ("Locality", (issue.get("locality") or {}).get("name")),
        ("Submitted", _fmt(issue["created_at"])), ("Current status", issue["status_label"]),
        ("Priority", (issue.get("priority") or "not set").title()),
        ("Resolution deadline", _fmt(issue["sla"]["due_at"]) if issue["sla"]["due_at"] else "No SLA rule applied"),
        ("Resolved", _fmt(issue.get("resolved_at"))), ("Citizens supporting", issue.get("support_count", 0)),
    ]
    t = Table([[Paragraph(f"<b>{k}</b>", st["cell"]), Paragraph(_esc(v), st["cell"])] for k, v in rows],
              colWidths=[40 * mm, 134 * mm])
    t.setStyle(TableStyle([("LINEBELOW", (0, 0), (-1, -1), 0.4, LINE), ("VALIGN", (0, 0), (-1, -1), "TOP"),
                           ("TOPPADDING", (0, 0), (-1, -1), 4), ("BOTTOMPADDING", (0, 0), (-1, -1), 4)]))
    flow += [t, Paragraph("Status history and public responses", st["h"])]
    trows = [[Paragraph("<b>When</b>", st["cell"]), Paragraph("<b>Event</b>", st["cell"]),
              Paragraph("<b>By</b>", st["cell"]), Paragraph("<b>Details</b>", st["cell"])]]
    for item in timeline:
        trows.append([Paragraph(_fmt(item["at"]), st["cell"]), Paragraph(_esc(item["title"]), st["cell"]),
                      Paragraph(_esc(item.get("actor")), st["cell"]), Paragraph(_esc(item.get("body") or ""), st["cell"])])
    tt = Table(trows, colWidths=[34 * mm, 42 * mm, 28 * mm, 70 * mm], repeatRows=1)
    tt.setStyle(TableStyle([("LINEBELOW", (0, 0), (-1, -1), 0.4, LINE), ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#e9e8e2")),
                            ("VALIGN", (0, 0), (-1, -1), "TOP")]))
    flow.append(tt)
    if evidence:
        flow.append(Paragraph("Resolution evidence", st["h"]))
        for e in evidence:
            flow.append(Paragraph(f"<b>{_fmt(e['submitted_at'])}</b> — {_esc(e['description'])} "
                                  f"(review: {_esc(e['review_status'])})", st["p"]))
            pics = [img for img in (_local_image(u) for u in (e["before"] + e["after"])[:4]) if img]
            if pics:
                flow.append(Table([pics], hAlign="LEFT"))
            flow.append(Spacer(1, 4))
    flow += [Spacer(1, 10), Paragraph(f"Public issue page: {settings.frontend_url}/issues/{issue['tracking_id']}", st["small"])]
    doc.build(flow)
    return buf.getvalue()
