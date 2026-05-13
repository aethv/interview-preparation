"""Question bank endpoints — CRUD + import (URL crawl / document upload)."""

import asyncio
import json
import math
import logging
import os
import tempfile
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form, Query
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession

from src.core.database import get_db
from src.models.user import User
from src.api.v1.dependencies import get_current_user
from src.schemas.question_bank import (
    QuestionCreate, QuestionUpdate, QuestionResponse,
    QuestionListResponse, QuestionPreview,
    ImportExtractRequest, ImportConfirmRequest, ImportConfirmResponse,
    CATEGORIES, LEVELS,
)
from src.services.data import question_bank_service as svc
from src.services.data.question_importer import extract_from_url, extract_from_file

logger = logging.getLogger(__name__)
router = APIRouter()


def _require_admin(current_user: User = Depends(get_current_user)) -> User:
    if not current_user.is_admin:
        raise HTTPException(status_code=403, detail="Admin access required")
    return current_user


def _to_response(q) -> QuestionResponse:
    return QuestionResponse(
        id=q.id,
        category=q.category,
        subcategory=q.subcategory,
        level=q.level,
        topic=q.topic,
        question=q.question,
        answer=q.answer,
        source=q.source,
        created_at=q.created_at.isoformat(),
        updated_at=q.updated_at.isoformat(),
    )


# ── Meta ──────────────────────────────────────────────────────────────────────

@router.get("/meta")
async def get_meta():
    """Return valid categories and levels for UI dropdowns."""
    return {"categories": CATEGORIES, "levels": LEVELS}


# ── CRUD ──────────────────────────────────────────────────────────────────────

@router.get("", response_model=QuestionListResponse)
async def list_questions(
    category: Optional[str] = Query(None),
    level: Optional[str] = Query(None),
    search: Optional[str] = Query(None),
    page: int = Query(1, ge=1),
    per_page: int = Query(20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(_require_admin),
):
    items, total = await svc.list_questions(db, category, level, search, page, per_page)
    return QuestionListResponse(
        items=[_to_response(q) for q in items],
        total=total,
        page=page,
        per_page=per_page,
        pages=math.ceil(total / per_page) if total else 1,
    )


@router.post("", response_model=QuestionResponse, status_code=201)
async def create_question(
    body: QuestionCreate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(_require_admin),
):
    q = await svc.create_question(db, body)
    return _to_response(q)


@router.put("/{question_id}", response_model=QuestionResponse)
async def update_question(
    question_id: int,
    body: QuestionUpdate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(_require_admin),
):
    q = await svc.update_question(db, question_id, body)
    if not q:
        raise HTTPException(status_code=404, detail="Question not found")
    return _to_response(q)


@router.delete("/{question_id}", status_code=204)
async def delete_question(
    question_id: int,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(_require_admin),
):
    deleted = await svc.delete_question(db, question_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Question not found")


# ── Import — shared helpers ────────────────────────────────────────────────────

async def _build_preview(extracted, source: str, db: AsyncSession) -> list[QuestionPreview]:
    previews = []
    for item in extracted:
        status, similar_id, score = await svc.check_duplicate_status(
            db, item.question, item.answer
        )
        previews.append(QuestionPreview(
            category=item.category,
            subcategory=item.subcategory,
            level=item.level,
            topic=item.topic,
            question=item.question,
            answer=item.answer,
            source=source,
            status=status,
            similar_id=similar_id,
            similarity_score=round(score, 4) if score else None,
        ))
    return previews


def _sse(event: dict) -> str:
    return f"data: {json.dumps(event)}\n\n"


# ── Import — extract URL (streaming SSE) ──────────────────────────────────────

@router.post("/import/extract-url/stream")
async def extract_from_url_stream(
    body: ImportExtractRequest,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(_require_admin),
):
    """Stream Playwright crawl + GPT extraction progress via Server-Sent Events."""
    if not body.url:
        raise HTTPException(status_code=400, detail="url is required")

    queue: asyncio.Queue = asyncio.Queue()

    async def log_cb(msg: str) -> None:
        await queue.put({"type": "log", "message": msg})

    _OVERALL_TIMEOUT = 300  # 5 minutes hard ceiling

    async def run() -> None:
        try:
            extracted, source = await asyncio.wait_for(
                extract_from_url(body.url, instructions=body.instructions, log_cb=log_cb),
                timeout=_OVERALL_TIMEOUT,
            )
            if not extracted:
                await queue.put({"type": "error", "message": "No Q&A found on the page"})
                return

            n = len(extracted)
            await log_cb(f"→ Checking {n} question(s) against existing bank (pgvector)…")
            previews = await _build_preview(extracted, source, db)
            new_c = sum(1 for p in previews if p.status == "new")
            sim_c = sum(1 for p in previews if p.status == "similar")
            dup_c = sum(1 for p in previews if p.status == "duplicate")
            await log_cb(f"✓ Done — {new_c} new · {sim_c} similar · {dup_c} duplicate")
            await queue.put({"type": "result", "data": [p.model_dump() for p in previews]})
        except asyncio.TimeoutError:
            await queue.put({"type": "error", "message": f"Extraction timed out after {_OVERALL_TIMEOUT}s. Try a smaller page or fewer menu items."})
        except Exception as e:
            logger.exception("extract_from_url_stream failed")
            await queue.put({"type": "error", "message": str(e)})
        finally:
            await queue.put(None)  # sentinel

    async def generate():
        task = asyncio.create_task(run())
        try:
            while True:
                try:
                    item = await asyncio.wait_for(queue.get(), timeout=_OVERALL_TIMEOUT + 10)
                except asyncio.TimeoutError:
                    yield _sse({"type": "error", "message": "Stream watchdog timeout — server may be overloaded."})
                    break
                if item is None:
                    break
                yield _sse(item)
        finally:
            task.cancel()

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


# ── Import — extract URL (legacy non-streaming) ────────────────────────────────

@router.post("/import/extract-url", response_model=list[QuestionPreview])
async def extract_from_url_endpoint(
    body: ImportExtractRequest,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(_require_admin),
):
    if not body.url:
        raise HTTPException(status_code=400, detail="url is required")
    try:
        extracted, source = await extract_from_url(body.url, instructions=body.instructions)
    except Exception as e:
        raise HTTPException(status_code=422, detail=f"Crawl failed: {e}")
    if not extracted:
        raise HTTPException(status_code=422, detail="No Q&A found on the page")
    return await _build_preview(extracted, source, db)


# ── Import — extract file ──────────────────────────────────────────────────────

@router.post("/import/extract-file", response_model=list[QuestionPreview])
async def extract_from_file_endpoint(
    file: UploadFile = File(...),
    instructions: Optional[str] = Form(None),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(_require_admin),
):
    ext = os.path.splitext(file.filename or "")[1].lstrip(".").lower()
    if ext not in ("pdf", "docx", "doc", "txt", "md"):
        raise HTTPException(status_code=400, detail="Supported formats: pdf, docx, txt, md")

    content = await file.read()
    suffix = f".{ext}"
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        tmp.write(content)
        tmp_path = tmp.name

    try:
        extracted, source = await extract_from_file(tmp_path, ext, instructions=instructions)
    except Exception as e:
        raise HTTPException(status_code=422, detail=f"Parsing failed: {e}")
    finally:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass

    if not extracted:
        raise HTTPException(status_code=422, detail="No Q&A found in the document")
    return await _build_preview(extracted, source, db)


# ── Import — confirm ───────────────────────────────────────────────────────────

@router.post("/import/confirm", response_model=ImportConfirmResponse)
async def confirm_import(
    body: ImportConfirmRequest,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(_require_admin),
):
    """Bulk-import the user-selected Q&A items."""
    imported = 0
    skipped = 0
    for item in body.questions:
        if item.status == "duplicate":
            skipped += 1
            continue
        await svc.create_question(db, QuestionCreate(
            category=item.category,
            subcategory=item.subcategory,
            level=item.level,
            topic=item.topic,
            question=item.question,
            answer=item.answer,
            source=item.source,
        ))
        imported += 1
    return ImportConfirmResponse(imported=imported, skipped=skipped)
