"""Practice topics endpoints — English Topics and Code Topics CRUD + SSE import."""

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
from src.schemas.practice_topics import (
    EnglishTopicCreate, EnglishTopicUpdate, EnglishTopicResponse,
    EnglishTopicListResponse, EnglishTopicPreview,
    CodeTopicCreate, CodeTopicUpdate, CodeTopicResponse,
    CodeTopicListResponse, CodeTopicPreview,
    TopicImportRequest, EnglishTopicImportConfirmRequest,
    CodeTopicImportConfirmRequest, TopicImportConfirmResponse,
    EnglishAIFillRequest, EnglishAIFillResponse,
    CodeAIFillRequest, CodeAIFillResponse,
    CodeAIFillFromImageRequest, CodeAIFillFromImageResponse,
    EnglishAIFillFromImageRequest, EnglishAIFillFromImageResponse,
    PageDiscoveryResponse, DiscoverFeedbackRequest,
    ENGLISH_SKILL_FOCUS, ENGLISH_LEVELS,
    CODE_CATEGORIES, CODE_DIFFICULTIES, CODE_LANGUAGES,
)
from src.services.data import practice_topic_service as svc
from src.services.data.practice_topic_importer import (
    extract_english_topics_from_url, extract_english_topics_from_file,
    extract_english_topics_from_urls,
    extract_code_topics_from_url, extract_code_topics_from_file,
    extract_code_topics_from_urls,
    ai_fill_english_topic, ai_fill_code_topic,
    ai_fill_code_topic_from_image, ai_fill_english_topic_from_image,
    agentic_discover,
)

logger = logging.getLogger(__name__)

english_router = APIRouter()
code_router = APIRouter()
public_router = APIRouter()   # authenticated but not admin — used by practice pages

_OVERALL_TIMEOUT = 300          # single-URL extract (5 min)
_MULTI_URL_TIMEOUT = 1800       # multi-URL crawl (30 min — 75 pages × ~15s)


def _require_admin(current_user: User = Depends(get_current_user)) -> User:
    if not current_user.is_admin:
        raise HTTPException(status_code=403, detail="Admin access required")
    return current_user


def _sse(event: dict) -> str:
    return f"data: {json.dumps(event)}\n\n"


# ── English Topics ─────────────────────────────────────────────────────────────

def _english_to_response(t) -> EnglishTopicResponse:
    return EnglishTopicResponse(
        id=t.id,
        title=t.title,
        skill_focus=t.skill_focus,
        level=t.level,
        scenario_prompt=t.scenario_prompt,
        key_vocabulary=t.key_vocabulary,
        evaluation_criteria=t.evaluation_criteria,
        source=t.source,
        is_active=t.is_active,
        created_at=t.created_at.isoformat(),
        updated_at=t.updated_at.isoformat(),
    )


async def _discover_stream(url: str, human_feedback: Optional[str] = None, cookies_raw: Optional[str] = None, topic_type: Optional[str] = None):
    """Shared SSE generator for agentic page discovery.

    The generator may pause internally waiting for human feedback (up to 5 min)
    so the outer timeout is set generously to 600 s.  Only 'error' is terminal;
    'needs_human' pauses the generator — it does NOT close the stream.
    """
    async def generate():
        try:
            async with asyncio.timeout(600):
                async for event in agentic_discover(url, human_feedback=human_feedback, cookies_raw=cookies_raw, topic_type=topic_type):
                    yield _sse(event)
                    if event.get("type") == "error":
                        return
        except asyncio.TimeoutError:
            yield _sse({"type": "error", "message": "Discovery timed out (10 min)"})
        except Exception as exc:
            logger.exception("discover_stream failed")
            yield _sse({"type": "error", "message": str(exc)})

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@english_router.post("/import/discover/stream")
async def discover_english(body: TopicImportRequest, _: User = Depends(_require_admin)):
    if not body.url:
        raise HTTPException(status_code=400, detail="url is required")
    return await _discover_stream(body.url, human_feedback=body.instructions, cookies_raw=body.cookies, topic_type="english")


@english_router.post("/import/discover/feedback")
async def discover_feedback_english(body: DiscoverFeedbackRequest, _: User = Depends(_require_admin)):
    from src.services.data.practice_topic_importer import _discover_sessions
    q = _discover_sessions.get(body.session_id)
    if not q:
        raise HTTPException(status_code=404, detail="Session not found or expired")
    await q.put(body.instruction)
    return {"ok": True}


@english_router.get("/meta")
async def get_english_meta():
    return {"skill_focus_options": ENGLISH_SKILL_FOCUS, "level_options": ENGLISH_LEVELS}


@english_router.get("", response_model=EnglishTopicListResponse)
async def list_english_topics(
    skill_focus: Optional[str] = Query(None),
    level: Optional[str] = Query(None),
    search: Optional[str] = Query(None),
    page: int = Query(1, ge=1),
    per_page: int = Query(20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(_require_admin),
):
    items, total = await svc.list_english_topics(db, skill_focus, level, search, page, per_page)
    return EnglishTopicListResponse(
        items=[_english_to_response(t) for t in items],
        total=total,
        page=page,
        per_page=per_page,
        pages=math.ceil(total / per_page) if total else 1,
    )


@english_router.post("", response_model=EnglishTopicResponse, status_code=201)
async def create_english_topic(
    body: EnglishTopicCreate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(_require_admin),
):
    t = await svc.create_english_topic(db, body)
    return _english_to_response(t)


@english_router.put("/{topic_id}", response_model=EnglishTopicResponse)
async def update_english_topic(
    topic_id: int,
    body: EnglishTopicUpdate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(_require_admin),
):
    t = await svc.update_english_topic(db, topic_id, body)
    if not t:
        raise HTTPException(status_code=404, detail="English topic not found")
    return _english_to_response(t)


@english_router.delete("/{topic_id}", status_code=204)
async def delete_english_topic(
    topic_id: int,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(_require_admin),
):
    deleted = await svc.delete_english_topic(db, topic_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="English topic not found")


@english_router.post("/import/extract-url/stream")
async def stream_english_import(
    body: TopicImportRequest,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(_require_admin),
):
    if not body.url and not body.item_urls:
        raise HTTPException(status_code=400, detail="url or item_urls is required")

    queue: asyncio.Queue = asyncio.Queue()

    async def log_cb(msg: str) -> None:
        await queue.put({"type": "log", "message": msg})

    async def run() -> None:
        try:
            if body.item_urls:
                # Multi-URL crawl: visit each selected problem page individually
                await log_cb(f"→ Crawling {len(body.item_urls)} individual page(s)…")
                extracted = await asyncio.wait_for(
                    extract_english_topics_from_urls(body.item_urls, instructions=body.instructions, log_cb=log_cb),
                    timeout=_MULTI_URL_TIMEOUT,
                )
                source = body.url or body.item_urls[0]
            else:
                extracted, source = await asyncio.wait_for(
                    extract_english_topics_from_url(body.url, instructions=body.instructions, log_cb=log_cb),
                    timeout=_OVERALL_TIMEOUT,
                )
            if not extracted:
                await queue.put({"type": "error", "message": "No English topics found on the page"})
                return
            previews = [
                EnglishTopicPreview(
                    title=item.title,
                    skill_focus=item.skill_focus,
                    level=item.level,
                    scenario_prompt=item.scenario_prompt,
                    key_vocabulary=item.key_vocabulary,
                    evaluation_criteria=item.evaluation_criteria,
                    source=source,
                ).model_dump()
                for item in extracted
            ]
            await log_cb(f"✓ Done — {len(previews)} topic(s) ready for review")
            await queue.put({"type": "result", "data": previews})
        except asyncio.TimeoutError:
            await queue.put({"type": "error", "message": f"Extraction timed out after {_OVERALL_TIMEOUT}s"})
        except Exception as e:
            logger.exception("stream_english_import failed")
            await queue.put({"type": "error", "message": str(e)})
        finally:
            await queue.put(None)

    async def generate():
        task = asyncio.create_task(run())
        try:
            while True:
                try:
                    item = await asyncio.wait_for(queue.get(), timeout=_OVERALL_TIMEOUT + 10)
                except asyncio.TimeoutError:
                    yield _sse({"type": "error", "message": "Stream watchdog timeout"})
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


@english_router.post("/import/extract-file", response_model=list[EnglishTopicPreview])
async def extract_english_from_file(
    file: UploadFile = File(...),
    instructions: Optional[str] = Form(None),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(_require_admin),
):
    ext = os.path.splitext(file.filename or "")[1].lstrip(".").lower()
    if ext not in ("pdf", "docx", "doc", "txt", "md"):
        raise HTTPException(status_code=400, detail="Supported formats: pdf, docx, txt, md")

    content = await file.read()
    with tempfile.NamedTemporaryFile(delete=False, suffix=f".{ext}") as tmp:
        tmp.write(content)
        tmp_path = tmp.name

    try:
        extracted, source = await extract_english_topics_from_file(tmp_path, ext, instructions=instructions)
    except Exception as e:
        raise HTTPException(status_code=422, detail=f"Parsing failed: {e}")
    finally:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass

    if not extracted:
        raise HTTPException(status_code=422, detail="No English topics found in the document")

    return [
        EnglishTopicPreview(
            title=item.title,
            skill_focus=item.skill_focus,
            level=item.level,
            scenario_prompt=item.scenario_prompt,
            key_vocabulary=item.key_vocabulary,
            evaluation_criteria=item.evaluation_criteria,
            source=source,
        )
        for item in extracted
    ]


@english_router.post("/ai-fill", response_model=EnglishAIFillResponse)
async def ai_fill_english(
    body: EnglishAIFillRequest,
    _: User = Depends(_require_admin),
):
    try:
        result = await ai_fill_english_topic(body.title, body.skill_focus, body.level)
        return EnglishAIFillResponse(**result)
    except Exception as e:
        logger.exception("ai_fill_english failed")
        raise HTTPException(status_code=502, detail=f"AI generation failed: {e}")


@english_router.post("/ai-fill-image", response_model=EnglishAIFillFromImageResponse)
async def ai_fill_english_from_image(
    body: EnglishAIFillFromImageRequest,
    _: User = Depends(_require_admin),
):
    try:
        result = await ai_fill_english_topic_from_image(body.image_b64)
        return EnglishAIFillFromImageResponse(**result)
    except Exception as e:
        logger.exception("ai_fill_english_from_image failed")
        raise HTTPException(status_code=502, detail=f"AI vision fill failed: {e}")


@english_router.post("/import/confirm", response_model=TopicImportConfirmResponse)
async def confirm_english_import(
    body: EnglishTopicImportConfirmRequest,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(_require_admin),
):
    imported = 0
    for item in body.topics:
        await svc.create_english_topic(db, EnglishTopicCreate(
            title=item.title,
            skill_focus=item.skill_focus,
            level=item.level,
            scenario_prompt=item.scenario_prompt,
            key_vocabulary=item.key_vocabulary,
            evaluation_criteria=item.evaluation_criteria,
            source=item.source,
        ))
        imported += 1
    return TopicImportConfirmResponse(imported=imported, skipped=0)


# ── Code Topics ────────────────────────────────────────────────────────────────

def _code_to_response(t) -> CodeTopicResponse:
    return CodeTopicResponse(
        id=t.id,
        title=t.title,
        category=t.category,
        difficulty=t.difficulty,
        languages=t.languages,
        problem_statement=t.problem_statement,
        discussion_hints=t.discussion_hints,
        review_rubric=t.review_rubric,
        reference_solution=t.reference_solution,
        source=t.source,
        is_active=t.is_active,
        created_at=t.created_at.isoformat(),
        updated_at=t.updated_at.isoformat(),
    )


@code_router.post("/import/discover/stream")
async def discover_code(body: TopicImportRequest, _: User = Depends(_require_admin)):
    if not body.url:
        raise HTTPException(status_code=400, detail="url is required")
    return await _discover_stream(body.url, human_feedback=body.instructions, cookies_raw=body.cookies, topic_type="code")


@code_router.post("/import/discover/feedback")
async def discover_feedback_code(body: DiscoverFeedbackRequest, _: User = Depends(_require_admin)):
    from src.services.data.practice_topic_importer import _discover_sessions
    q = _discover_sessions.get(body.session_id)
    if not q:
        raise HTTPException(status_code=404, detail="Session not found or expired")
    await q.put(body.instruction)
    return {"ok": True}


@code_router.get("/meta")
async def get_code_meta():
    return {"categories": CODE_CATEGORIES, "difficulties": CODE_DIFFICULTIES, "languages": CODE_LANGUAGES}


@code_router.get("", response_model=CodeTopicListResponse)
async def list_code_topics(
    category: Optional[str] = Query(None),
    difficulty: Optional[str] = Query(None),
    search: Optional[str] = Query(None),
    page: int = Query(1, ge=1),
    per_page: int = Query(20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(_require_admin),
):
    items, total = await svc.list_code_topics(db, category, difficulty, search, page, per_page)
    return CodeTopicListResponse(
        items=[_code_to_response(t) for t in items],
        total=total,
        page=page,
        per_page=per_page,
        pages=math.ceil(total / per_page) if total else 1,
    )


@code_router.post("", response_model=CodeTopicResponse, status_code=201)
async def create_code_topic(
    body: CodeTopicCreate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(_require_admin),
):
    t = await svc.create_code_topic(db, body)
    return _code_to_response(t)


@code_router.put("/{topic_id}", response_model=CodeTopicResponse)
async def update_code_topic(
    topic_id: int,
    body: CodeTopicUpdate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(_require_admin),
):
    t = await svc.update_code_topic(db, topic_id, body)
    if not t:
        raise HTTPException(status_code=404, detail="Code topic not found")
    return _code_to_response(t)


@code_router.delete("/{topic_id}", status_code=204)
async def delete_code_topic(
    topic_id: int,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(_require_admin),
):
    deleted = await svc.delete_code_topic(db, topic_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Code topic not found")


@code_router.post("/import/extract-url/stream")
async def stream_code_import(
    body: TopicImportRequest,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(_require_admin),
):
    if not body.url and not body.item_urls:
        raise HTTPException(status_code=400, detail="url or item_urls is required")

    queue: asyncio.Queue = asyncio.Queue()

    async def log_cb(msg: str) -> None:
        await queue.put({"type": "log", "message": msg})

    async def run() -> None:
        try:
            if body.item_urls:
                # Multi-URL crawl: visit each selected problem page individually
                await log_cb(f"→ Crawling {len(body.item_urls)} individual page(s)…")
                extracted = await asyncio.wait_for(
                    extract_code_topics_from_urls(body.item_urls, instructions=body.instructions, log_cb=log_cb),
                    timeout=_MULTI_URL_TIMEOUT,
                )
                source = body.url or body.item_urls[0]
            else:
                extracted, source = await asyncio.wait_for(
                    extract_code_topics_from_url(body.url, instructions=body.instructions, log_cb=log_cb),
                    timeout=_OVERALL_TIMEOUT,
                )
            if not extracted:
                await queue.put({"type": "error", "message": "No code topics found on the page"})
                return
            previews = [
                CodeTopicPreview(
                    title=item.title,
                    category=item.category,
                    difficulty=item.difficulty,
                    languages=item.languages,
                    problem_statement=item.problem_statement,
                    discussion_hints=item.discussion_hints,
                    review_rubric=item.review_rubric,
                    reference_solution=item.reference_solution,
                    source=source,
                ).model_dump()
                for item in extracted
            ]
            await log_cb(f"✓ Done — {len(previews)} problem(s) ready for review")
            await queue.put({"type": "result", "data": previews})
        except asyncio.TimeoutError:
            await queue.put({"type": "error", "message": f"Extraction timed out after {_OVERALL_TIMEOUT}s"})
        except Exception as e:
            logger.exception("stream_code_import failed")
            await queue.put({"type": "error", "message": str(e)})
        finally:
            await queue.put(None)

    async def generate():
        task = asyncio.create_task(run())
        try:
            while True:
                try:
                    item = await asyncio.wait_for(queue.get(), timeout=_OVERALL_TIMEOUT + 10)
                except asyncio.TimeoutError:
                    yield _sse({"type": "error", "message": "Stream watchdog timeout"})
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


@code_router.post("/import/extract-file", response_model=list[CodeTopicPreview])
async def extract_code_from_file(
    file: UploadFile = File(...),
    instructions: Optional[str] = Form(None),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(_require_admin),
):
    ext = os.path.splitext(file.filename or "")[1].lstrip(".").lower()
    if ext not in ("pdf", "docx", "doc", "txt", "md"):
        raise HTTPException(status_code=400, detail="Supported formats: pdf, docx, txt, md")

    content = await file.read()
    with tempfile.NamedTemporaryFile(delete=False, suffix=f".{ext}") as tmp:
        tmp.write(content)
        tmp_path = tmp.name

    try:
        extracted, source = await extract_code_topics_from_file(tmp_path, ext, instructions=instructions)
    except Exception as e:
        raise HTTPException(status_code=422, detail=f"Parsing failed: {e}")
    finally:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass

    if not extracted:
        raise HTTPException(status_code=422, detail="No code topics found in the document")

    return [
        CodeTopicPreview(
            title=item.title,
            category=item.category,
            difficulty=item.difficulty,
            languages=item.languages,
            problem_statement=item.problem_statement,
            discussion_hints=item.discussion_hints,
            review_rubric=item.review_rubric,
            reference_solution=item.reference_solution,
            source=source,
        )
        for item in extracted
    ]


@code_router.post("/ai-fill", response_model=CodeAIFillResponse)
async def ai_fill_code(
    body: CodeAIFillRequest,
    _: User = Depends(_require_admin),
):
    try:
        result = await ai_fill_code_topic(body.title, body.category, body.difficulty, body.languages)
        return CodeAIFillResponse(**result)
    except Exception as e:
        logger.exception("ai_fill_code failed")
        raise HTTPException(status_code=502, detail=f"AI generation failed: {e}")


@code_router.post("/ai-fill-image", response_model=CodeAIFillFromImageResponse)
async def ai_fill_code_from_image(
    body: CodeAIFillFromImageRequest,
    _: User = Depends(_require_admin),
):
    try:
        result = await ai_fill_code_topic_from_image(body.image_b64)
        return CodeAIFillFromImageResponse(**result)
    except Exception as e:
        logger.exception("ai_fill_code_from_image failed")
        raise HTTPException(status_code=502, detail=f"AI vision fill failed: {e}")


@code_router.post("/import/confirm", response_model=TopicImportConfirmResponse)
async def confirm_code_import(
    body: CodeTopicImportConfirmRequest,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(_require_admin),
):
    imported = 0
    for item in body.topics:
        await svc.create_code_topic(db, CodeTopicCreate(
            title=item.title,
            category=item.category,
            difficulty=item.difficulty,
            languages=item.languages,
            problem_statement=item.problem_statement,
            discussion_hints=item.discussion_hints,
            review_rubric=item.review_rubric,
            reference_solution=item.reference_solution,
            source=item.source,
        ))
        imported += 1
    return TopicImportConfirmResponse(imported=imported, skipped=0)


# ── Public (user-facing) practice endpoints ────────────────────────────────────

@public_router.get("/english-topics", response_model=EnglishTopicListResponse)
async def list_public_english_topics(
    skill_focus: Optional[str] = Query(None),
    level: Optional[str] = Query(None),
    search: Optional[str] = Query(None),
    page: int = Query(1, ge=1),
    per_page: int = Query(20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    items, total = await svc.list_english_topics(
        db, skill_focus, level, search, page, per_page, active_only=True
    )
    return EnglishTopicListResponse(
        items=[_english_to_response(t) for t in items],
        total=total, page=page, per_page=per_page,
        pages=math.ceil(total / per_page) if total else 1,
    )


@public_router.get("/english-topics/meta")
async def get_public_english_meta(_: User = Depends(get_current_user)):
    return {"skill_focus_options": ENGLISH_SKILL_FOCUS, "level_options": ENGLISH_LEVELS}


@public_router.get("/code-topics", response_model=CodeTopicListResponse)
async def list_public_code_topics(
    category: Optional[str] = Query(None),
    difficulty: Optional[str] = Query(None),
    search: Optional[str] = Query(None),
    page: int = Query(1, ge=1),
    per_page: int = Query(20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    items, total = await svc.list_code_topics(
        db, category, difficulty, search, page, per_page, active_only=True
    )
    return CodeTopicListResponse(
        items=[_code_to_response(t) for t in items],
        total=total, page=page, per_page=per_page,
        pages=math.ceil(total / per_page) if total else 1,
    )


@public_router.get("/code-topics/meta")
async def get_public_code_meta(_: User = Depends(get_current_user)):
    return {"categories": CODE_CATEGORIES, "difficulties": CODE_DIFFICULTIES, "languages": CODE_LANGUAGES}
