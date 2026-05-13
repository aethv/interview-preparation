"""Question importer — extract Q&A from URLs (Playwright) or uploaded files (PDF/DOCX)."""

import asyncio
import logging
import time
from typing import Optional, Callable, Awaitable
from openai import AsyncOpenAI
import instructor
from pydantic import BaseModel, Field

from src.core.config import settings

logger = logging.getLogger(__name__)

_PARSE_MODEL = "gpt-4o-mini"

LogCb = Optional[Callable[[str], Awaitable[None]]]


async def _log(cb: LogCb, msg: str) -> None:
    logger.info(msg)
    if cb:
        await cb(msg)


# ── LLM schemas ───────────────────────────────────────────────────────────────

class ExtractedQA(BaseModel):
    category: str = Field(
        description=(
            "Main subject area of this Q&A. For technical content use specific domains "
            "(e.g. Java, Algorithm, System Design, Database, Messaging, Spring, Cloud, DevOps, "
            "Security, Frontend, Python, JavaScript). For non-technical content use the broad topic "
            "(e.g. English Grammar, English Vocabulary, English Speaking, Math, History, General). "
            "Infer from context — do not force a tech category if the content is not technical."
        )
    )
    subcategory: Optional[str] = Field(
        None,
        description=(
            "More specific area within the category, if applicable. "
            "Examples: Spring Boot, Kafka, JVM, Collections, SQL, Tenses, Idioms, IELTS Speaking."
        )
    )
    level: str = Field(
        description=(
            "Difficulty or target audience. Use: Beginner, Junior, Mid, Senior, Advanced, Any. "
            "For language learning use Beginner / Intermediate / Advanced. "
            "Default to 'Any' when level is unclear."
        )
    )
    topic: str = Field(max_length=200, description="Concise name for the specific topic this Q&A covers")
    question: str = Field(description="The question text, preserved verbatim or faithfully paraphrased")
    answer: str = Field(description="The answer or explanation, preserved verbatim or faithfully summarised")


class ExtractedQAList(BaseModel):
    items: list[ExtractedQA]


class ClickTargets(BaseModel):
    items: list[str] = Field(
        default_factory=list,
        description="Exact visible text labels of menu items or categories to click, in the order they should be clicked",
    )


# ── Navigation plan ───────────────────────────────────────────────────────────

async def _get_click_targets(instructions: str) -> list[str]:
    """Ask GPT to extract menu-item labels to click from user instructions."""
    client = instructor.patch(AsyncOpenAI(api_key=settings.OPENAI_API_KEY))
    try:
        result = await client.chat.completions.create(
            model=_PARSE_MODEL,
            response_model=ClickTargets,
            messages=[
                {
                    "role": "system",
                    "content": (
                        "You extract a list of menu item labels to click from user instructions about web scraping. "
                        "Return only the visible text labels (e.g. category names) that should be clicked. "
                        "If instructions don't mention clicking menus or specific categories, return an empty list."
                    ),
                },
                {"role": "user", "content": instructions},
            ],
            temperature=0,
            max_retries=1,
        )
        return result.items
    except Exception as e:
        logger.warning(f"Could not extract click targets: {e}")
        return []


# ── Text extraction ────────────────────────────────────────────────────────────

async def _extract_text_from_url(url: str, instructions: str | None = None, log_cb: LogCb = None) -> str:
    """Render page with Playwright, optionally clicking JS menu items, then return text."""
    try:
        from playwright.async_api import async_playwright
    except ImportError:
        raise RuntimeError("playwright package is not installed")

    # Determine if we need to click menu items
    click_targets: list[str] = []
    if instructions and instructions.strip():
        instr_lower = instructions.lower()
        if any(kw in instr_lower for kw in ("click", "menu", "category", "tab", "navigate", "open")):
            await _log(log_cb, "→ Analyzing instructions for navigation targets…")
            click_targets = await _get_click_targets(instructions)
            if click_targets:
                await _log(log_cb, f"✓ Will click {len(click_targets)} menu item(s): {', '.join(click_targets)}")
            else:
                await _log(log_cb, "  No specific click targets found in instructions")

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        try:
            page = await browser.new_page()
            await _log(log_cb, f"→ Navigating to {url}")
            await page.goto(url, wait_until="networkidle", timeout=30_000)
            await _log(log_cb, "✓ Page loaded (JavaScript executed)")

            if not click_targets:
                # Simple mode: scroll and extract
                await _log(log_cb, "→ Scrolling to reveal lazy content…")
                await page.evaluate("window.scrollTo(0, document.body.scrollHeight)")
                await page.wait_for_timeout(1000)
                text = await page.evaluate("() => document.body.innerText")
                await _log(log_cb, f"✓ Extracted {len(text):,} characters of page text")
                return text[:50_000]

            # Navigation mode: click each target and collect text
            texts: list[str] = []
            for target in click_targets:
                try:
                    locator = page.get_by_text(target, exact=False)
                    count = await locator.count()
                    if count == 0:
                        await _log(log_cb, f"✗ '{target}' not found on page — skipping")
                        continue

                    await _log(log_cb, f"→ Clicking '{target}'…")
                    await locator.first.click()

                    try:
                        await page.wait_for_load_state("networkidle", timeout=4_000)
                    except Exception:
                        await page.wait_for_timeout(800)

                    section_text = await page.evaluate("() => document.body.innerText")
                    texts.append(section_text)
                    await _log(log_cb, f"✓ Collected {len(section_text):,} chars after clicking '{target}'")

                except Exception as e:
                    await _log(log_cb, f"✗ Error clicking '{target}': {e}")

            if not texts:
                await _log(log_cb, "⚠ No text collected via clicks — falling back to full page text")
                texts.append(await page.evaluate("() => document.body.innerText"))

            combined = "\n\n---\n\n".join(texts)
            await _log(log_cb, f"→ Total combined text: {len(combined):,} characters")
            return combined[:50_000]

        finally:
            await browser.close()


def _extract_text_from_pdf(file_path: str) -> str:
    import pdfplumber
    parts = []
    with pdfplumber.open(file_path) as pdf:
        for page in pdf.pages:
            t = page.extract_text()
            if t:
                parts.append(t)
    return "\n\n".join(parts)[:50_000]


def _extract_text_from_docx(file_path: str) -> str:
    from docx import Document
    doc = Document(file_path)
    return "\n".join(p.text for p in doc.paragraphs if p.text.strip())[:50_000]


def _extract_text_from_file(file_path: str, file_type: str) -> str:
    ft = file_type.lower().lstrip(".")
    if ft == "pdf":
        return _extract_text_from_pdf(file_path)
    if ft in ("docx", "doc"):
        return _extract_text_from_docx(file_path)
    if ft in ("txt", "md"):
        with open(file_path, encoding="utf-8", errors="replace") as f:
            return f.read()[:50_000]
    raise ValueError(f"Unsupported file type: {file_type}")


# ── LLM parsing ───────────────────────────────────────────────────────────────

async def _parse_text_to_qa(
    raw_text: str, source: str, instructions: str | None = None, log_cb: LogCb = None,
) -> list[ExtractedQA]:
    """Ask GPT to extract structured Q&A pairs from raw text."""
    await _log(log_cb, f"→ Sending {min(len(raw_text), 30_000):,} chars to GPT ({_PARSE_MODEL}) for Q&A extraction…")

    client = instructor.patch(AsyncOpenAI(api_key=settings.OPENAI_API_KEY, timeout=90.0))

    instructions_block = ""
    if instructions and instructions.strip():
        instructions_block = f"\n\nUser instructions (follow these carefully):\n{instructions.strip()}\n"

    prompt = f"""Extract Q&A pairs from the text below.

The content may be from any domain — technical interviews, language learning, academic subjects, general knowledge, etc. Adapt your extraction accordingly.

For each question-answer pair you find:
- **category**: the main subject area (e.g. Java, English Grammar, English Vocabulary, Algorithm, System Design, Math, History, General — infer from content, never force a category that does not fit)
- **subcategory**: a more specific area if applicable (e.g. Tenses, Idioms, Spring Boot, Kafka, SQL — omit if not relevant)
- **level**: difficulty or audience (Beginner / Junior / Mid / Senior / Advanced / Any — use Any when unclear)
- **topic**: a concise label for the specific concept covered (e.g. "Present Perfect vs Simple Past", "HashMap vs Hashtable", "Kafka consumer groups")
- **question**: the question text, verbatim or faithfully paraphrased
- **answer**: the answer or explanation, verbatim or faithfully summarised
{instructions_block}
Source: {source}

---
{raw_text[:30_000]}
---

Be thorough — extract every question-answer pair present. No minimum, no artificial limit."""

    t0 = time.monotonic()
    try:
        result = await client.chat.completions.create(
            model=_PARSE_MODEL,
            response_model=ExtractedQAList,
            messages=[
                {"role": "system", "content": "You are an expert at extracting structured Q&A pairs from any kind of educational or informational content. Be thorough and domain-agnostic — adapt the category, level, and topic to match whatever subject the content covers."},
                {"role": "user", "content": prompt},
            ],
            temperature=0.1,
            max_retries=1,
        )
        elapsed = time.monotonic() - t0
        await _log(log_cb, f"✓ GPT extracted {len(result.items)} Q&A pairs in {elapsed:.1f}s")
        return result.items
    except Exception as e:
        elapsed = time.monotonic() - t0
        logger.error(f"LLM parsing failed after {elapsed:.1f}s: {e}")
        await _log(log_cb, f"✗ GPT parsing failed after {elapsed:.1f}s: {e}")
        return []


# ── Public API ─────────────────────────────────────────────────────────────────

async def extract_from_url(
    url: str, instructions: str | None = None, log_cb: LogCb = None,
) -> tuple[list[ExtractedQA], str]:
    """Crawl a URL and extract Q&A. Returns (items, source_label)."""
    text = await _extract_text_from_url(url, instructions=instructions, log_cb=log_cb)
    if not text.strip():
        raise ValueError(f"No text content found at {url}")
    items = await _parse_text_to_qa(text, url, instructions=instructions, log_cb=log_cb)
    return items, url


async def extract_from_file(
    file_path: str, file_type: str, instructions: str | None = None,
) -> tuple[list[ExtractedQA], str]:
    """Extract Q&A from an uploaded document. Returns (items, source_label)."""
    import os
    loop = asyncio.get_event_loop()
    text = await loop.run_in_executor(None, _extract_text_from_file, file_path, file_type)
    if not text.strip():
        raise ValueError("No text content found in file")
    source = os.path.basename(file_path)
    items = await _parse_text_to_qa(text, source, instructions=instructions)
    return items, source
