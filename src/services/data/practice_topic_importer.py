"""Practice topic importer — extract English/Code topics from URLs or files using GPT."""

import asyncio
import base64
import json
import logging
import re
import time
from typing import Optional, Callable, Awaitable, AsyncGenerator
from openai import AsyncOpenAI
import instructor
from pydantic import BaseModel, Field

from src.core.config import settings
from src.services.data.question_importer import (
    _extract_text_from_file,
    _get_click_targets,
    LogCb,
)

logger = logging.getLogger(__name__)


async def _log(cb: LogCb, msg: str) -> None:
    """Log to both the module logger and the SSE callback (if any)."""
    logger.info(msg)
    if cb:
        await cb(msg)


async def _log_gpt_request(
    model: str,
    system: str,
    user_text: str,
    *,
    has_vision: bool = False,
    log_cb: LogCb = None,
) -> None:
    """Emit GPT request details to the live log so prompts can be tuned."""
    vision_tag = " [+image]" if has_vision else ""
    sys_preview = system.replace("\n", " ").strip()[:200]
    user_preview = user_text.replace("\n", " ").strip()[:300]
    lines = [
        f"┌ GPT [{model}]{vision_tag}",
        f"│ system ({len(system)} chars): {sys_preview}",
        f"│ user   ({len(user_text)} chars): {user_preview}",
    ]
    for line in lines:
        logger.info(line)
        if log_cb:
            await log_cb(line)


async def _log_gpt_response(
    elapsed: float,
    result_repr: str,
    *,
    log_cb: LogCb = None,
) -> None:
    """Emit GPT response summary to the live log."""
    msg = f"└ GPT done in {elapsed:.1f}s → {result_repr[:300]}"
    logger.info(msg)
    if log_cb:
        await log_cb(msg)

_PARSE_MODEL = "gpt-4o-mini"

_BLOCK_KEYWORDS = [
    "security verification", "security check", "verify you are human",
    "please verify", "captcha", "i am not a robot", "cloudflare",
    "access denied", "403 forbidden", "enable javascript",
    "please enable cookies", "unusual traffic",
]


# ── Agentic browser step models ───────────────────────────────────────────────

class BrowserStep(BaseModel):
    action: str = Field(
        description=(
            "One of: wait_for_selector, wait_for_text, click_text, "
            "click_selector, scroll, wait_ms"
        )
    )
    target: Optional[str] = Field(
        None,
        description="CSS selector, visible text to match, or milliseconds string for wait_ms",
    )
    description: str = Field(description="Human-readable: what this step does")
    success_criteria: str = Field(description="What the page looks like on success")
    fail_criteria: str = Field(description="What indicates this step failed")
    optional: bool = Field(
        False,
        description="True if failure should be silently skipped rather than escalated to the user",
    )


class BrowserPlan(BaseModel):
    steps: list[BrowserStep] = Field(
        description="Ordered steps to execute after initial page load. Max 6 steps."
    )
    reasoning: str = Field(description="One sentence explaining the overall plan")


# ── Page discovery result model ───────────────────────────────────────────────

class DiscoveredItem(BaseModel):
    title: str = Field(description="Title or name of the item")
    identifier: Optional[str] = Field(None, description="Problem number, ID or slug if visible")
    difficulty: Optional[str] = Field(None, description="Difficulty level if visible")
    note: Optional[str] = Field(None, description="Any extra label or tag visible next to the item")
    url: Optional[str] = Field(None, description="Direct URL to the individual problem page if discoverable")


class PageDiscovery(BaseModel):
    page_type: str = Field(description="One of: list, single, unknown")
    page_title: str = Field(description="Title or collection name of the page")
    description: str = Field(description="One or two sentences describing what was found")
    items: list[DiscoveredItem] = Field(default_factory=list)
    total_count: int = Field(0)
    screenshot_b64: Optional[str] = Field(None)


# ── Step planning ─────────────────────────────────────────────────────────────

_PLAN_SYSTEM = (
    "You are a browser automation planner. The page has already been navigated to. "
    "Plan the minimal additional Playwright steps to reveal the main content.\n"
    "Available actions:\n"
    "- wait_for_selector: wait for a CSS selector to appear\n"
    "- wait_for_text: wait for visible text to appear on page\n"
    "- click_text: click the first element containing this visible text\n"
    "- click_selector: click element matching CSS selector\n"
    "- scroll: scroll to bottom of page\n"
    "- wait_ms: pause N milliseconds (target = string of ms, e.g. '2000')\n\n"
    "Mark optional=true for steps that may not exist on every load "
    "(cookie banners, overlays, etc). Keep plans to 3–6 steps max."
)


async def _plan_browser_steps(url: str, human_feedback: Optional[str] = None, log_cb: LogCb = None) -> BrowserPlan:
    client = instructor.patch(AsyncOpenAI(api_key=settings.OPENAI_API_KEY, timeout=20.0))
    feedback_block = (
        f"\n\nPrevious attempt needed human help. User feedback: \"{human_feedback}\"\n"
        "Adjust the plan to handle this."
        if human_feedback else ""
    )
    user_msg = (
        f"URL: {url}\n"
        "The page just loaded via domcontentloaded. "
        "Plan steps to reveal the full content (dismiss overlays, wait for JS content, scroll, etc)."
        f"{feedback_block}"
    )
    await _log_gpt_request(_PARSE_MODEL, _PLAN_SYSTEM, user_msg, log_cb=log_cb)
    t0 = time.monotonic()
    result = await client.chat.completions.create(
        model=_PARSE_MODEL,
        response_model=BrowserPlan,
        messages=[
            {"role": "system", "content": _PLAN_SYSTEM},
            {"role": "user", "content": user_msg},
        ],
        temperature=0.1,
        max_retries=1,
    )
    steps_repr = " | ".join(f"{s.action}({s.target or ''})" for s in result.steps)
    await _log_gpt_response(time.monotonic() - t0, f"{len(result.steps)} steps: {steps_repr}", log_cb=log_cb)
    return result


# ── Step execution ────────────────────────────────────────────────────────────

async def _execute_step(page, step: BrowserStep) -> tuple[bool, Optional[str]]:
    """Execute one browser step. Returns (success, error_message)."""
    try:
        action = step.action
        target = step.target or ""

        if action == "wait_for_selector":
            await page.wait_for_selector(target, timeout=8_000)

        elif action == "wait_for_text":
            await page.wait_for_function(
                f"() => document.body.innerText.toLowerCase().includes({json.dumps(target.lower())})",
                timeout=8_000,
            )

        elif action == "click_text":
            locator = page.get_by_text(target, exact=False)
            if await locator.count() == 0:
                return False, f"Text '{target}' not found on page"
            await locator.first.click()
            await page.wait_for_timeout(1_200)

        elif action == "click_selector":
            locator = page.locator(target)
            if await locator.count() == 0:
                return False, f"Selector '{target}' not found"
            await locator.first.click()
            await page.wait_for_timeout(1_200)

        elif action == "scroll":
            await page.evaluate("window.scrollTo(0, document.body.scrollHeight)")
            await page.wait_for_timeout(1_500)

        elif action == "wait_ms":
            ms = int(target) if target.isdigit() else 1_000
            await page.wait_for_timeout(ms)

        return True, None
    except Exception as exc:
        return False, str(exc)


# ── Stealth ───────────────────────────────────────────────────────────────────

_STEALTH_JS = """
// Remove the webdriver flag Cloudflare checks first
Object.defineProperty(navigator, 'webdriver', {get: () => undefined});

// Make plugins non-empty (headless has none)
Object.defineProperty(navigator, 'plugins', {get: () => [1,2,3,4,5]});
Object.defineProperty(navigator, 'mimeTypes', {get: () => [1,2,3]});

// Set realistic language list
Object.defineProperty(navigator, 'languages', {get: () => ['en-US', 'en']});

// Fake the chrome runtime object that headless lacks
window.chrome = {
  runtime: { onConnect: null, onMessage: null },
  loadTimes: function(){},
  csi: function(){},
  app: {}
};

// Permissions API spoofing
const _origQuery = window.navigator.permissions && window.navigator.permissions.query;
if (_origQuery) {
  window.navigator.permissions.query = (p) =>
    p.name === 'notifications'
      ? Promise.resolve({state: Notification.permission})
      : _origQuery(p);
}
"""


def _parse_cookies(raw: str) -> list[dict]:
    """Parse cookie string (Netscape format, JSON array, or key=value pairs) into Playwright dicts."""
    raw = raw.strip()
    if not raw:
        return []
    # JSON array: [{"name": ..., "value": ..., "domain": ...}, ...]
    if raw.startswith('['):
        import json as _json
        items = _json.loads(raw)
        return [
            {k: v for k, v in c.items() if k in ("name", "value", "domain", "path", "secure", "httpOnly", "expires")}
            for c in items if "name" in c and "value" in c
        ]
    # Netscape format: lines starting with domain
    cookies = []
    for line in raw.splitlines():
        line = line.strip()
        if not line or line.startswith('#'):
            continue
        parts = line.split('\t')
        if len(parts) >= 7:
            cookies.append({
                "domain": parts[0].lstrip('.') if parts[0].startswith('.') else parts[0],
                "path": parts[2],
                "secure": parts[3].upper() == 'TRUE',
                "expires": int(parts[4]) if parts[4].isdigit() else -1,
                "name": parts[5],
                "value": parts[6],
            })
    # Simple key=value pairs (browser copy-paste: name=value; name2=value2)
    if not cookies and '=' in raw:
        for pair in raw.split(';'):
            pair = pair.strip()
            if '=' in pair:
                name, _, value = pair.partition('=')
                cookies.append({"name": name.strip(), "value": value.strip()})
    return cookies


# ── Verification auto-bypass ──────────────────────────────────────────────────

async def _try_bypass_verification(page) -> bool:
    """
    Attempt to auto-click common human-verification challenges (Cloudflare checkbox,
    reCAPTCHA checkbox, generic 'Verify' buttons). Returns True if the page appears
    to have cleared after the click.
    """
    clicked = False

    # 1. Look for a checkbox inside every frame (Cloudflare Turnstile lives in an iframe)
    for frame in page.frames:
        try:
            cb = await frame.query_selector('input[type="checkbox"]')
            if cb and await cb.is_visible():
                await cb.click()
                clicked = True
                break
        except Exception:
            pass

    # 2. Fall back to clicking by visible text on the main frame
    if not clicked:
        for phrase in ["Verify you are human", "I'm not a robot", "I am not a robot", "Verify"]:
            try:
                el = page.get_by_text(phrase, exact=False)
                if await el.count() > 0 and await el.first.is_visible():
                    await el.first.click()
                    clicked = True
                    break
            except Exception:
                pass

    # 3. Wait for redirect / page change and re-check
    if clicked:
        await page.wait_for_timeout(4_000)
        text_after = (await page.evaluate("() => document.body.innerText")).lower()
        return not any(kw in text_after for kw in _BLOCK_KEYWORDS)

    return False


# ── GPT Vision: suggest next action ──────────────────────────────────────────

async def _ask_gpt_next_action(screenshot_b64: str, page_snippet: str) -> str:
    """Send screenshot to GPT Vision and ask what the browser should do next."""
    client = AsyncOpenAI(api_key=settings.OPENAI_API_KEY, timeout=20.0)
    response = await client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[
            {
                "role": "system",
                "content": (
                    "You are a browser automation assistant. A headless browser got stuck on a web page. "
                    "Analyze the screenshot and suggest ONE specific next action in plain English. "
                    "Be concrete and brief — e.g. 'Click the Verify checkbox', 'Click Accept cookies', "
                    "'The page needs login — enter credentials', 'Select all problems then click Next', "
                    "'This CAPTCHA requires a human to solve the image puzzle'."
                ),
            },
            {
                "role": "user",
                "content": [
                    {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{screenshot_b64}"}},
                    {"type": "text", "text": f"Browser is stuck. Page text: {page_snippet[:400]}\n\nWhat should I do next?"},
                ],
            },
        ],
        max_tokens=120,
    )
    return response.choices[0].message.content.strip()


# ── GPT page analysis ─────────────────────────────────────────────────────────

_ANALYSE_SYSTEM = (
    "You analyze web page content to classify its structure and list its items. "
    "Set page_type to 'list' when the page contains multiple linked problems/topics/exercises, "
    "'single' for a single detailed problem or article, 'unknown' otherwise."
)


async def _analyse_page_text(url: str, text: str, log_cb: LogCb = None) -> PageDiscovery:
    client = instructor.patch(AsyncOpenAI(api_key=settings.OPENAI_API_KEY, timeout=30.0))
    user_content = (
        f"URL: {url}\n\n"
        "Analyze the page content below. Identify:\n"
        "1. page_type: 'list' if multiple problems/topics, 'single' if one item\n"
        "2. page_title: the collection or page title\n"
        "3. description: one sentence describing what was found\n"
        "4. items: all items visible in the list (title, number/ID, difficulty)\n"
        "5. total_count: total number of items\n\n"
        f"--- Page content ---\n{text[:20_000]}\n---"
    )
    await _log_gpt_request(_PARSE_MODEL, _ANALYSE_SYSTEM, user_content, log_cb=log_cb)
    t0 = time.monotonic()
    result = await client.chat.completions.create(
        model=_PARSE_MODEL,
        response_model=PageDiscovery,
        messages=[
            {"role": "system", "content": _ANALYSE_SYSTEM},
            {"role": "user", "content": user_content},
        ],
        temperature=0.1,
        max_retries=1,
    )
    item_titles = ", ".join(f'"{it.title}"' for it in result.items[:3])
    if len(result.items) > 3:
        item_titles += f" +{len(result.items)-3}"
    await _log_gpt_response(
        time.monotonic() - t0,
        f"page_type={result.page_type!r} title={result.page_title!r} items={result.total_count} [{item_titles}]",
        log_cb=log_cb,
    )
    return result


# ── Link→item URL matching ────────────────────────────────────────────────────

def _title_to_slug(title: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", title.lower().strip()).strip("-")


def _match_item_url(title: str, links: list[dict], page_url: str = "") -> Optional[str]:
    """
    Given a problem title and a list of {text, href} dicts from the page,
    return the best-matching link URL or None.

    Tries in order:
    1. Link text contains the item title (case-insensitive)
    2. URL slug derived from the title appears in the href
    3. (LeetCode) Construct https://leetcode.com/problems/{slug}/ from parent URL
    4. (HackerRank) Construct from known pattern
    """
    title_lower = title.lower().strip()
    slug = _title_to_slug(title)

    # Pass 1: text match
    for link in links:
        if title_lower in link["text"].lower() or link["text"].lower() in title_lower:
            return link["href"]

    # Pass 2: slug in href
    for link in links:
        if slug and slug in link["href"].lower():
            return link["href"]

    # Pass 3: construct URL from known domain patterns
    if slug and page_url:
        if "leetcode.com" in page_url:
            return f"https://leetcode.com/problems/{slug}/"
        if "hackerrank.com" in page_url:
            # e.g. https://www.hackerrank.com/challenges/{slug}/problem
            return f"https://www.hackerrank.com/challenges/{slug}/problem"

    return None


# ── Session registry (maps session_id → feedback Queue) ──────────────────────

_discover_sessions: dict[str, asyncio.Queue] = {}


async def _plan_recovery_steps(instruction: str, page_text: str) -> BrowserPlan:
    """Plan browser steps to recover from a stuck state given a user instruction."""
    client = instructor.patch(AsyncOpenAI(api_key=settings.OPENAI_API_KEY, timeout=20.0))
    return await client.chat.completions.create(
        model=_PARSE_MODEL,
        response_model=BrowserPlan,
        messages=[
            {
                "role": "system",
                "content": (
                    "You are a browser automation planner. The browser is currently stuck. "
                    "Plan the minimal Playwright steps to carry out the user's instruction and move past the obstacle. "
                    "Available actions: wait_for_selector, wait_for_text, click_text, click_selector, scroll, wait_ms. "
                    "Mark optional=true if a step may not be needed on every attempt."
                ),
            },
            {
                "role": "user",
                "content": (
                    f"Current page text (first 500 chars): {page_text[:500]}\n\n"
                    f"User instruction: {instruction}\n\n"
                    "Plan the steps to carry out this instruction."
                ),
            },
        ],
        temperature=0.1,
        max_retries=1,
    )


# ── Agentic discover (SSE event generator) ────────────────────────────────────

async def agentic_discover(
    url: str,
    human_feedback: Optional[str] = None,
    cookies_raw: Optional[str] = None,
    topic_type: Optional[str] = None,  # "code" or "english" — enables inline extraction
) -> AsyncGenerator[dict, None]:
    """
    Async generator that yields SSE-style dicts driving the frontend UI.

    Event types:
      session      – {session_id}  emitted first so client can send feedback later
      log          – {message}
      plan         – {steps: [...], reasoning}
      step         – {index, status: running|done|failed|skipped, description, error?}
      needs_human  – {session_id, screenshot_b64, message, gpt_suggestion}  stream PAUSES here
      discovered   – {data: PageDiscovery dict, form_data: [...] | null}
      error        – {message}

    When needs_human is emitted the generator waits (up to 5 min) for the client to POST
    a feedback instruction to /discover/feedback.  The same browser session is reused.

    If topic_type is "code" or "english" and the page is a single item, inline extraction
    is attempted from the already-open browser — no second Playwright session needed.
    """
    import uuid as _uuid

    try:
        from playwright.async_api import async_playwright
    except ImportError:
        yield {"type": "error", "message": "playwright is not installed"}
        return

    # Register session so the feedback endpoint can send instructions back
    session_id = str(_uuid.uuid4())
    feedback_queue: asyncio.Queue[str] = asyncio.Queue()
    _discover_sessions[session_id] = feedback_queue
    yield {"type": "session", "session_id": session_id}

    # ── 1. Plan ──────────────────────────────────────────────────────────────
    yield {"type": "log", "message": f"→ GPT [{_PARSE_MODEL}] planning browser steps for: {url}"}
    _gpt_buf: list[str] = []
    async def _buf_log(msg: str) -> None:
        _gpt_buf.append(msg)

    try:
        plan = await _plan_browser_steps(url, human_feedback, log_cb=_buf_log)
    except Exception as exc:
        yield {"type": "error", "message": f"Failed to build plan: {exc}"}
        _discover_sessions.pop(session_id, None)
        return

    for _msg in _gpt_buf:
        yield {"type": "log", "message": _msg}
    _gpt_buf.clear()

    yield {
        "type": "plan",
        "reasoning": plan.reasoning,
        "steps": [
            {
                "action": s.action,
                "target": s.target,
                "description": s.description,
                "success_criteria": s.success_criteria,
                "fail_criteria": s.fail_criteria,
                "optional": s.optional,
            }
            for s in plan.steps
        ],
    }
    yield {"type": "log", "message": f"✓ GPT plan ({len(plan.steps)} steps): {plan.reasoning}"}
    for i, s in enumerate(plan.steps):
        opt = " [optional]" if s.optional else ""
        yield {"type": "log", "message": f"  {i+1}. [{s.action}]{opt} {s.description}"}

    # ── 2. Execute (browser stays alive across human pauses) ──────────────────
    text = ""
    full_page_b64: Optional[str] = None  # captured before browser closes, used for inline extraction
    parsed_cookies = _parse_cookies(cookies_raw or "")

    async with async_playwright() as p:
        browser = await p.chromium.launch(
            headless=True,
            args=[
                "--disable-blink-features=AutomationControlled",
                "--no-sandbox",
                "--disable-setuid-sandbox",
                "--disable-dev-shm-usage",
            ],
        )
        try:
            context = await browser.new_context(
                user_agent=(
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                    "AppleWebKit/537.36 (KHTML, like Gecko) "
                    "Chrome/124.0.0.0 Safari/537.36"
                ),
                locale="en-US",
                timezone_id="America/New_York",
            )
            if parsed_cookies:
                yield {"type": "log", "message": f"→ Injecting {len(parsed_cookies)} cookie(s)…"}
                await context.add_cookies(parsed_cookies)

            page = await context.new_page()
            await page.add_init_script(_STEALTH_JS)

            async def _screenshot_b64() -> Optional[str]:
                try:
                    shot = await page.screenshot(type="jpeg", quality=65, full_page=False)
                    return base64.b64encode(shot).decode()
                except Exception:
                    return None

            # Navigate
            yield {"type": "log", "message": f"→ Navigating to {url}…"}
            try:
                await page.goto(url, wait_until="domcontentloaded", timeout=30_000)
                await page.wait_for_timeout(2_500)
                yield {"type": "log", "message": "✓ Page loaded"}
                sc = await _screenshot_b64()
                if sc:
                    yield {"type": "screenshot", "screenshot_b64": sc}
            except Exception as exc:
                yield {"type": "error", "message": f"Navigation failed: {exc}"}
                return

            async def _pause_for_human(cur_text: str, step_desc: str = "") -> bool:
                """
                Take screenshot, ask GPT, emit needs_human, WAIT for user feedback,
                then plan + execute recovery steps.  Returns True if recovered OK.
                Browser session stays alive the whole time.
                """
                shot = await page.screenshot(type="png", full_page=False)
                screenshot_b64 = base64.b64encode(shot).decode()
                yield {"type": "log", "message": "→ Asking GPT what to do next…"}
                try:
                    gpt_suggestion = await _ask_gpt_next_action(screenshot_b64, cur_text)
                except Exception:
                    gpt_suggestion = "Describe what you see and what the browser should do next."
                yield {"type": "log", "message": f"💡 GPT suggests: {gpt_suggestion}"}
                yield {
                    "type": "needs_human",
                    "session_id": session_id,
                    "screenshot_b64": screenshot_b64,
                    "message": f"Stuck{f' after: {step_desc}' if step_desc else ''}.",
                    "gpt_suggestion": gpt_suggestion,
                }

                # Wait for user instruction (5 min timeout)
                try:
                    instruction = await asyncio.wait_for(feedback_queue.get(), timeout=300)
                except asyncio.TimeoutError:
                    yield {"type": "error", "message": "Timed out waiting for human input (5 min)"}
                    return

                yield {"type": "log", "message": f"→ Applying your instruction: {instruction}"}
                yield {"type": "resuming"}

                # Plan recovery steps for this specific situation
                try:
                    recovery = await _plan_recovery_steps(instruction, cur_text)
                except Exception as exc:
                    yield {"type": "log", "message": f"⚠ Could not plan recovery: {exc}"}
                    return

                yield {
                    "type": "plan",
                    "reasoning": recovery.reasoning,
                    "steps": [
                        {"action": s.action, "target": s.target, "description": s.description,
                         "success_criteria": s.success_criteria, "fail_criteria": s.fail_criteria,
                         "optional": s.optional}
                        for s in recovery.steps
                    ],
                }

                for ri, rs in enumerate(recovery.steps):
                    yield {"type": "step", "index": ri, "status": "running", "description": rs.description}
                    ok, err = await _execute_step(page, rs)
                    sc = await _screenshot_b64()
                    if ok:
                        yield {"type": "step", "index": ri, "status": "done", "description": rs.description, "screenshot_b64": sc}
                    elif rs.optional:
                        yield {"type": "step", "index": ri, "status": "skipped", "description": rs.description, "screenshot_b64": sc}
                    else:
                        yield {"type": "step", "index": ri, "status": "failed", "description": rs.description, "error": err, "screenshot_b64": sc}
                        new_text = await page.evaluate("() => document.body.innerText")
                        async for evt in _pause_for_human(new_text, rs.description):
                            yield evt
                        return

            async def _check_and_bypass(page_text: str, step_desc: str = ""):
                """Try auto-bypass first; if it fails, pause for human."""
                if not any(kw in page_text.lower() for kw in _BLOCK_KEYWORDS):
                    return
                yield {"type": "log", "message": "⚠ Verification wall — attempting auto-click…"}
                if await _try_bypass_verification(page):
                    yield {"type": "log", "message": "✓ Verification passed automatically — continuing…"}
                    return
                async for evt in _pause_for_human(page_text, step_desc):
                    yield evt

            # Post-navigation block check
            post_nav_text = await page.evaluate("() => document.body.innerText")
            async for evt in _check_and_bypass(post_nav_text):
                yield evt

            # Execute planned steps
            for i, step in enumerate(plan.steps):
                yield {"type": "step", "index": i, "status": "running", "description": step.description}
                success, error = await _execute_step(page, step)
                sc = await _screenshot_b64()

                if success:
                    yield {"type": "step", "index": i, "status": "done", "description": step.description, "screenshot_b64": sc}
                elif step.optional:
                    yield {"type": "step", "index": i, "status": "skipped", "description": step.description, "error": error, "screenshot_b64": sc}
                else:
                    yield {"type": "step", "index": i, "status": "failed", "description": step.description, "error": error, "screenshot_b64": sc}
                    cur_text = await page.evaluate("() => document.body.innerText")
                    is_blocked = any(kw in cur_text.lower() for kw in _BLOCK_KEYWORDS)
                    if is_blocked:
                        async for evt in _check_and_bypass(cur_text, step.description):
                            yield evt
                    elif len(cur_text.strip()) > 500:
                        # Page has meaningful content despite the step failing — skip and continue
                        yield {"type": "log", "message": f"⚠ Step failed but page has content — continuing anyway"}
                    else:
                        async for evt in _pause_for_human(cur_text, step.description):
                            yield evt

            # ── 3. Extract text + full-page screenshot ────────────────────────
            yield {"type": "log", "message": "→ Extracting page content…"}
            await page.evaluate("window.scrollTo(0, document.body.scrollHeight)")
            await page.wait_for_timeout(1_500)
            text = await page.evaluate("() => document.body.innerText")
            yield {"type": "log", "message": f"✓ Extracted {len(text):,} characters"}

            if topic_type:
                yield {"type": "log", "message": "→ Capturing full-page screenshot for inline extraction…"}
                try:
                    shot = await page.screenshot(type="jpeg", quality=70, full_page=True)
                    full_page_b64 = base64.b64encode(shot).decode()
                    yield {"type": "log", "message": f"✓ Screenshot captured ({len(shot)//1024}KB)"}
                except Exception as exc:
                    yield {"type": "log", "message": f"⚠ Full-page screenshot failed: {exc}"}

            # Multi-pass link collection: scroll through the full page so virtual lists
            # (LeetCode, HackerRank, etc.) reveal all their items before we scrape links.
            yield {"type": "log", "message": "→ Collecting page links (multi-pass scroll for virtual lists)…"}
            try:
                _link_js = """() =>
                    [...document.querySelectorAll('a[href]')]
                        .filter(a => a.href
                            && !a.href.startsWith('javascript:')
                            && !a.href.startsWith('mailto:'))
                        .map(a => ({ text: a.innerText.trim().replace(/\\s+/g, ' '), href: a.href }))
                        .filter(a => a.text.length > 0 && a.href.length > 0)
                """
                seen_hrefs: dict[str, dict] = {}
                # Scroll to top first, then through the page in 5 passes
                for pct in [0, 20, 40, 60, 80, 100]:
                    await page.evaluate(
                        f"window.scrollTo(0, document.body.scrollHeight * {pct} / 100)"
                    )
                    await page.wait_for_timeout(600)
                    batch = await page.evaluate(_link_js)
                    for link in batch:
                        seen_hrefs[link["href"]] = link
                page_links = list(seen_hrefs.values())
                yield {"type": "log", "message": f"✓ Collected {len(page_links)} unique links across scroll passes"}
            except Exception as exc:
                page_links = []
                yield {"type": "log", "message": f"⚠ Link extraction failed: {exc}"}

        finally:
            await context.close()
            _discover_sessions.pop(session_id, None)
            await browser.close()

    if not text.strip():
        yield {"type": "error", "message": "No content found on page after all steps"}
        return

    # ── 4. Analyse with GPT ───────────────────────────────────────────────────
    yield {"type": "log", "message": f"→ GPT [{_PARSE_MODEL}] analyzing page structure ({len(text):,} chars)…"}
    try:
        result = await _analyse_page_text(url, text, log_cb=_buf_log)
    except Exception as exc:
        yield {"type": "error", "message": f"GPT analysis failed: {exc}"}
        return

    for _msg in _gpt_buf:
        yield {"type": "log", "message": _msg}
    _gpt_buf.clear()

    yield {"type": "log", "message": f"✓ GPT: page_type={result.page_type!r} title={result.page_title!r} items={result.total_count}"}
    if result.description:
        yield {"type": "log", "message": f"  {result.description}"}
    if result.items:
        preview = result.items[:5]
        for it in preview:
            diff_tag = f" [{it.difficulty}]" if it.difficulty else ""
            num_tag = f"{it.identifier}. " if it.identifier else ""
            yield {"type": "log", "message": f"  • {num_tag}{it.title}{diff_tag}"}
        if len(result.items) > 5:
            yield {"type": "log", "message": f"  … and {len(result.items)-5} more"}

    # ── 5. Inline extraction (skip second browser for single pages) ───────────
    form_data: Optional[list] = None
    if topic_type and result.page_type == "single":
        yield {"type": "log", "message": f"→ Single-page detected — inline extraction ({topic_type}, no second browser)…"}
        try:
            if topic_type == "code":
                items_extracted = await _parse_code_topics_with_vision(
                    text, full_page_b64, url, log_cb=None
                )
            else:
                items_extracted = await _parse_text_to_english_topics(text, url, log_cb=None)

            if items_extracted:
                form_data = [it.model_dump() for it in items_extracted]
                titles = ", ".join(f'"{i.title}"' for i in items_extracted[:3])
                if len(items_extracted) > 3:
                    titles += f" +{len(items_extracted)-3}"
                yield {"type": "log", "message": f"✓ Inline extracted {len(form_data)} item(s): {titles}"}
                for it in items_extracted:
                    if topic_type == "code":
                        yield {"type": "log", "message": f"  [{it.category}/{it.difficulty}] {it.title}"}
                        yield {"type": "log", "message": f"    statement: {it.problem_statement[:120].replace(chr(10), ' ')}…"}
                    else:
                        yield {"type": "log", "message": f"  [{it.skill_focus}/{it.level}] {it.title}"}
            else:
                yield {"type": "log", "message": "⚠ Inline extraction found 0 items — use Extract step as fallback"}
        except Exception as exc:
            yield {"type": "log", "message": f"⚠ Inline extraction failed ({exc}) — use Extract step as fallback"}

    # Match discovered items to their individual page URLs
    matched_urls = 0
    constructed_urls = 0
    items_with_urls = []
    for it in result.items:
        item_url = _match_item_url(it.title, page_links, page_url=url)
        if item_url:
            matched_urls += 1
            # Track how many were constructed vs actually found in the DOM
            slug = _title_to_slug(it.title)
            if slug and item_url.endswith(f"{slug}/") and not any(
                link["href"] == item_url for link in page_links
            ):
                constructed_urls += 1
        items_with_urls.append({
            "title": it.title, "identifier": it.identifier,
            "difficulty": it.difficulty, "note": it.note,
            "url": item_url,
        })

    if result.items:
        dom_matched = matched_urls - constructed_urls
        msg = f"✓ Matched {matched_urls}/{len(result.items)} items to direct URLs"
        if constructed_urls:
            msg += f" ({dom_matched} from DOM, {constructed_urls} slug-constructed)"
        yield {"type": "log", "message": msg}
        if matched_urls < len(result.items):
            unmatched = [it["title"] for it in items_with_urls if not it["url"]][:3]
            yield {"type": "log", "message": f"  Unmatched: {', '.join(unmatched)}{' …' if len(unmatched) == 3 else ''}"}

    yield {
        "type": "discovered",
        "data": {
            "page_type": result.page_type,
            "page_title": result.page_title,
            "description": result.description,
            "items": items_with_urls,
            "total_count": result.total_count,
            "screenshot_b64": None,
            "form_data": form_data,
        },
    }


# ── LLM extraction schemas ─────────────────────────────────────────────────────

class ExtractedEnglishTopic(BaseModel):
    title: str = Field(description="Short descriptive title for this English practice topic")
    skill_focus: str = Field(description="One of: Speaking, Grammar, Vocabulary, Writing, Listening")
    level: str = Field(description="One of: Beginner, Intermediate, Advanced, Any")
    scenario_prompt: str = Field(description="Full scenario/prompt the agent uses to open the practice session")
    key_vocabulary: Optional[str] = Field(None, description="Comma-separated key words or phrases to target")
    evaluation_criteria: Optional[str] = Field(None, description="What to evaluate: fluency, grammar accuracy, vocabulary range, etc.")


class ExtractedEnglishTopicList(BaseModel):
    items: list[ExtractedEnglishTopic]


class ExtractedCodeTopic(BaseModel):
    title: str = Field(description="Problem title, e.g. 'Two Sum', 'LRU Cache Design'")
    category: str = Field(description="One of: Arrays, Strings, Linked List, Trees, Graphs, Dynamic Programming, Recursion, Sorting, Math, System Design, Database, General")
    difficulty: str = Field(description="One of: Beginner, Mid, Senior")
    languages: str = Field(default="any", description="Comma-separated: python, javascript, java — or 'any'")
    problem_statement: str = Field(description="Full problem description with constraints and examples")
    discussion_hints: Optional[str] = Field(None, description="JSON array of clarifying questions the interviewer asks")
    review_rubric: Optional[str] = Field(None, description='JSON: {"expected_complexity": "O(n)", "edge_cases": [], "common_mistakes": [], "bonus": []}')
    reference_solution: Optional[str] = Field(None, description="A working reference solution (optional)")


class ExtractedCodeTopicList(BaseModel):
    items: list[ExtractedCodeTopic]


# ── LLM parsing ───────────────────────────────────────────────────────────────

_ENGLISH_EXTRACT_SYSTEM = "You are an expert at extracting structured English language practice topics from educational content. Be thorough."


async def _parse_text_to_english_topics(
    raw_text: str, source: str, instructions: str | None = None, log_cb: LogCb = None,
) -> list[ExtractedEnglishTopic]:
    chars = min(len(raw_text), 30_000)
    await _log(log_cb, f"→ GPT [{_PARSE_MODEL}] English extraction: {chars:,} chars from {source}")

    client = instructor.patch(AsyncOpenAI(api_key=settings.OPENAI_API_KEY, timeout=90.0))

    instructions_block = ""
    if instructions and instructions.strip():
        instructions_block = f"\n\nUser instructions (follow these carefully):\n{instructions.strip()}\n"

    prompt = f"""Extract English practice topics from the text below.

For each topic you find, produce:
- **title**: Short descriptive title (e.g. "Describing a memorable trip", "IELTS Part 2: Hometown")
- **skill_focus**: One of Speaking, Grammar, Vocabulary, Writing, Listening — infer from context
- **level**: One of Beginner, Intermediate, Advanced, Any — use Any when unclear
- **scenario_prompt**: Full scenario or prompt the AI conversation agent uses to open the session
- **key_vocabulary**: Comma-separated key words/phrases to work in naturally (optional)
- **evaluation_criteria**: What to evaluate — fluency, accuracy, vocabulary range, etc. (optional)
{instructions_block}
Source: {source}

---
{raw_text[:30_000]}
---

Extract every distinct English practice topic. No artificial limit."""

    await _log_gpt_request(_PARSE_MODEL, _ENGLISH_EXTRACT_SYSTEM, prompt, log_cb=log_cb)
    t0 = time.monotonic()
    try:
        result = await client.chat.completions.create(
            model=_PARSE_MODEL,
            response_model=ExtractedEnglishTopicList,
            messages=[
                {"role": "system", "content": _ENGLISH_EXTRACT_SYSTEM},
                {"role": "user", "content": prompt},
            ],
            temperature=0.1,
            max_retries=1,
        )
        elapsed = time.monotonic() - t0
        items_repr = " | ".join(f'{it.title} [{it.skill_focus}/{it.level}]' for it in result.items[:3])
        if len(result.items) > 3:
            items_repr += f" +{len(result.items)-3}"
        await _log_gpt_response(elapsed, f"{len(result.items)} topic(s): {items_repr}", log_cb=log_cb)
        for it in result.items:
            await _log(log_cb, f"  [{it.skill_focus}/{it.level}] {it.title}")
        return result.items
    except Exception as e:
        elapsed = time.monotonic() - t0
        logger.error(f"LLM parsing failed after {elapsed:.1f}s: {e}")
        await _log(log_cb, f"✗ GPT parsing failed after {elapsed:.1f}s: {e}")
        return []


_CODE_EXTRACT_SYSTEM = "You are an expert at extracting structured coding interview problems from technical content. Be thorough and produce well-structured JSON fields."


async def _parse_text_to_code_topics(
    raw_text: str, source: str, instructions: str | None = None, log_cb: LogCb = None,
) -> list[ExtractedCodeTopic]:
    chars = min(len(raw_text), 30_000)
    await _log(log_cb, f"→ GPT [{_PARSE_MODEL}] code extraction (text-only): {chars:,} chars from {source}")

    client = instructor.patch(AsyncOpenAI(api_key=settings.OPENAI_API_KEY, timeout=90.0))

    instructions_block = ""
    if instructions and instructions.strip():
        instructions_block = f"\n\nUser instructions (follow these carefully):\n{instructions.strip()}\n"

    prompt = f"""Extract coding interview problems from the text below.

For each problem you find, produce:
- **title**: Problem name (e.g. "Two Sum", "LRU Cache")
- **category**: One of Arrays, Strings, Linked List, Trees, Graphs, Dynamic Programming, Recursion, Sorting, Math, System Design, Database, General
- **difficulty**: One of Beginner, Mid, Senior
- **languages**: Comma-separated target languages or "any"
- **problem_statement**: Full problem description with constraints and examples
- **discussion_hints**: JSON array of 3-5 clarifying questions the interviewer asks (e.g. ["What is the brute force?", "Can we sort first?"])
- **review_rubric**: JSON with expected_complexity, edge_cases array, common_mistakes array, bonus array
- **reference_solution**: A working solution code (optional)
{instructions_block}
Source: {source}

---
{raw_text[:30_000]}
---

Extract every distinct coding problem. No artificial limit."""

    await _log_gpt_request(_PARSE_MODEL, _CODE_EXTRACT_SYSTEM, prompt, log_cb=log_cb)
    t0 = time.monotonic()
    try:
        result = await client.chat.completions.create(
            model=_PARSE_MODEL,
            response_model=ExtractedCodeTopicList,
            messages=[
                {"role": "system", "content": _CODE_EXTRACT_SYSTEM},
                {"role": "user", "content": prompt},
            ],
            temperature=0.1,
            max_retries=1,
        )
        elapsed = time.monotonic() - t0
        items_repr = " | ".join(f'{it.title} [{it.category}/{it.difficulty}]' for it in result.items[:3])
        if len(result.items) > 3:
            items_repr += f" +{len(result.items)-3}"
        await _log_gpt_response(elapsed, f"{len(result.items)} problem(s): {items_repr}", log_cb=log_cb)
        for it in result.items:
            await _log(log_cb, f"  [{it.category}/{it.difficulty}] {it.title}")
            await _log(log_cb, f"    {it.problem_statement[:100].replace(chr(10), ' ')}…")
        return result.items
    except Exception as e:
        elapsed = time.monotonic() - t0
        logger.error(f"LLM parsing failed after {elapsed:.1f}s: {e}")
        await _log(log_cb, f"✗ GPT parsing failed after {elapsed:.1f}s: {e}")
        return []


# ── Vision-aware page extraction ─────────────────────────────────────────────

async def _fetch_page_content(
    url: str,
    instructions: Optional[str] = None,
    log_cb: LogCb = None,
) -> tuple[str, Optional[str]]:
    """
    Shared Playwright session for all practice-topic URL extraction.

    Returns (page_text, jpeg_screenshot_b64).

    Features:
    - Stealth JS to bypass bot detection
    - If instructions mention clicking/navigation, GPT extracts target labels and
      clicks each one in turn, collecting text from every view (same logic as the
      old question-importer navigator, but with stealth + screenshot).
    - Full-page JPEG screenshot captured for vision-based GPT parsing.
    """
    try:
        from playwright.async_api import async_playwright
    except ImportError:
        raise RuntimeError("playwright package is not installed")

    # Check if instructions ask us to navigate by clicking menu items
    click_targets: list[str] = []
    if instructions and instructions.strip():
        instr_lower = instructions.lower()
        if any(kw in instr_lower for kw in ("click", "menu", "category", "tab", "navigate", "open")):
            await _log(log_cb, "→ Instructions mention navigation — asking GPT for click targets…")
            click_targets = await _get_click_targets(instructions)
            if click_targets:
                await _log(log_cb, f"✓ Will click: {', '.join(click_targets)}")

    await _log(log_cb, f"→ Navigating to {url}…")
    async with async_playwright() as p:
        browser = await p.chromium.launch(
            headless=True,
            args=[
                "--disable-blink-features=AutomationControlled",
                "--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage",
            ],
        )
        try:
            context = await browser.new_context(
                user_agent=(
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
                ),
                locale="en-US",
                timezone_id="America/New_York",
            )
            page = await context.new_page()
            await page.add_init_script(_STEALTH_JS)
            await page.goto(url, wait_until="domcontentloaded", timeout=30_000)
            await page.wait_for_timeout(3_000)
            await _log(log_cb, "✓ Page loaded")

            if not click_targets:
                # Simple mode: scroll + extract once
                await page.evaluate("window.scrollTo(0, document.body.scrollHeight)")
                await page.wait_for_timeout(1_500)
                await page.evaluate("window.scrollTo(0, 0)")
                await page.wait_for_timeout(500)
                text = await page.evaluate("() => document.body.innerText")
            else:
                # Navigation mode: click each target, accumulate text
                texts: list[str] = []
                for target in click_targets:
                    try:
                        locator = page.get_by_text(target, exact=False)
                        if await locator.count() == 0:
                            await _log(log_cb, f"✗ '{target}' not found — skipping")
                            continue
                        await _log(log_cb, f"→ Clicking '{target}'…")
                        await locator.first.click()
                        try:
                            await page.wait_for_load_state("domcontentloaded", timeout=4_000)
                        except Exception:
                            pass
                        await page.wait_for_timeout(1_500)
                        section = await page.evaluate("() => document.body.innerText")
                        texts.append(section)
                        await _log(log_cb, f"✓ Collected {len(section):,} chars after '{target}'")
                    except Exception as exc:
                        await _log(log_cb, f"✗ Error clicking '{target}': {exc}")
                if not texts:
                    await _log(log_cb, "⚠ No text from clicks — falling back to full page")
                    texts.append(await page.evaluate("() => document.body.innerText"))
                text = "\n\n---\n\n".join(texts)

            # Full-page screenshot for vision extraction
            screenshot_b64: Optional[str] = None
            sc_kb = 0
            try:
                shot = await page.screenshot(type="jpeg", quality=70, full_page=True)
                screenshot_b64 = base64.b64encode(shot).decode()
                sc_kb = len(shot) // 1024
            except Exception:
                pass

            await _log(log_cb, f"✓ Extracted {len(text):,} chars" + (f" + screenshot ({sc_kb}KB)" if screenshot_b64 else ""))
            return text, screenshot_b64
        finally:
            await context.close()
            await browser.close()


_CODE_VISION_SYSTEM = (
    "You are an expert at extracting structured coding interview problems. "
    "When you see tree, graph, or matrix diagrams in the screenshot, "
    "convert them to clear text descriptions inside problem_statement so the "
    "problem is fully understandable without images."
)


async def _parse_code_topics_with_vision(
    raw_text: str,
    screenshot_b64: Optional[str],
    source: str,
    instructions: str | None = None,
    log_cb: LogCb = None,
) -> list[ExtractedCodeTopic]:
    """
    Extract code topics using GPT-4o-mini vision so tree/graph diagrams in
    screenshots are understood and described in the problem_statement.
    Falls back to text-only if no screenshot is available.
    """
    has_vision = bool(screenshot_b64)
    model = _PARSE_MODEL
    sc_kb = len(screenshot_b64) * 3 // 4 // 1024 if screenshot_b64 else 0
    await _log(log_cb, f"→ GPT [{model}] code extraction (vision={has_vision}): {min(len(raw_text),20_000):,} chars{f' + screenshot {sc_kb}KB' if has_vision else ''} from {source}")

    client = instructor.patch(AsyncOpenAI(api_key=settings.OPENAI_API_KEY, timeout=120.0))

    instructions_block = ""
    if instructions and instructions.strip():
        instructions_block = f"\n\nUser instructions (follow these carefully):\n{instructions.strip()}\n"

    prompt = f"""Extract coding interview problems from the content below.

For each problem produce:
- **title**: Problem name
- **category**: One of Arrays, Strings, Linked List, Trees, Graphs, Dynamic Programming, Recursion, Sorting, Math, System Design, Database, General
- **difficulty**: One of Beginner, Mid, Senior
- **languages**: Comma-separated or "any"
- **problem_statement**: Full problem with constraints and examples. IMPORTANT: if you see tree/graph diagrams or visual examples in the screenshot, describe them clearly using text (e.g. "Tree structure: root=3, left=9, right=20, 20's left=15, right=7") so the problem is fully self-contained.
- **discussion_hints**: JSON array of 3-5 clarifying questions
- **review_rubric**: JSON with expected_complexity, edge_cases[], common_mistakes[], bonus[]
- **reference_solution**: Working solution code (optional)
{instructions_block}
Source: {source}

--- Page text ---
{raw_text[:20_000]}
---

Extract every distinct coding problem found."""

    content: list = []
    if has_vision:
        content.append({
            "type": "image_url",
            "image_url": {"url": f"data:image/jpeg;base64,{screenshot_b64}", "detail": "high"},
        })
    content.append({"type": "text", "text": prompt})

    await _log_gpt_request(model, _CODE_VISION_SYSTEM, prompt, has_vision=has_vision, log_cb=log_cb)
    t0 = time.monotonic()
    try:
        result = await client.chat.completions.create(
            model=model,
            response_model=ExtractedCodeTopicList,
            messages=[
                {"role": "system", "content": _CODE_VISION_SYSTEM},
                {"role": "user", "content": content},
            ],
            temperature=0.1,
            max_retries=1,
        )
        elapsed = time.monotonic() - t0
        items_repr = " | ".join(f'{it.title} [{it.category}/{it.difficulty}]' for it in result.items[:3])
        if len(result.items) > 3:
            items_repr += f" +{len(result.items)-3}"
        await _log_gpt_response(elapsed, f"{len(result.items)} problem(s): {items_repr}", log_cb=log_cb)
        for it in result.items:
            await _log(log_cb, f"  [{it.category}/{it.difficulty}] {it.title}")
            await _log(log_cb, f"    {it.problem_statement[:100].replace(chr(10), ' ')}…")
        return result.items
    except Exception as e:
        elapsed = time.monotonic() - t0
        logger.error(f"Vision extraction failed after {elapsed:.1f}s: {e}")
        await _log(log_cb, f"⚠ Vision extraction failed ({e}) — retrying text-only…")
        return await _parse_text_to_code_topics(raw_text, source, instructions, log_cb)


# ── Multi-URL crawl (parallel with concurrency cap) ───────────────────────────

_CRAWL_CONCURRENCY = 5  # simultaneous Playwright sessions


async def _crawl_one_code(
    idx: int,
    total: int,
    url: str,
    instructions: str | None,
    log_cb: LogCb,
    sem: asyncio.Semaphore,
) -> list[ExtractedCodeTopic]:
    async with sem:
        await _log(log_cb, f"→ [{idx}/{total}] {url}")
        try:
            text, screenshot_b64 = await _fetch_page_content(url, instructions=instructions, log_cb=None)
            if not text.strip():
                await _log(log_cb, f"  [{idx}] ⚠ No text — skipping")
                return []
            items = await _parse_code_topics_with_vision(
                text, screenshot_b64, url, instructions=instructions, log_cb=None
            )
            await _log(log_cb, f"  [{idx}] ✓ {len(items)} problem(s): {', '.join(it.title for it in items)}")
            return items
        except Exception as exc:
            await _log(log_cb, f"  [{idx}] ✗ Failed: {exc}")
            return []


async def _crawl_one_english(
    idx: int,
    total: int,
    url: str,
    instructions: str | None,
    log_cb: LogCb,
    sem: asyncio.Semaphore,
) -> list[ExtractedEnglishTopic]:
    async with sem:
        await _log(log_cb, f"→ [{idx}/{total}] {url}")
        try:
            text, _sc = await _fetch_page_content(url, instructions=instructions, log_cb=None)
            if not text.strip():
                await _log(log_cb, f"  [{idx}] ⚠ No text — skipping")
                return []
            items = await _parse_text_to_english_topics(text, url, instructions=instructions, log_cb=None)
            await _log(log_cb, f"  [{idx}] ✓ {len(items)} topic(s): {', '.join(it.title for it in items)}")
            return items
        except Exception as exc:
            await _log(log_cb, f"  [{idx}] ✗ Failed: {exc}")
            return []


async def extract_code_topics_from_urls(
    urls: list[str],
    instructions: str | None = None,
    log_cb: LogCb = None,
) -> list[ExtractedCodeTopic]:
    """
    Crawl each URL in parallel (up to _CRAWL_CONCURRENCY at a time) and extract
    code topics.  Used when the discover phase resolved individual problem links.
    """
    await _log(log_cb, f"→ Parallel crawl: {len(urls)} URL(s) (concurrency={_CRAWL_CONCURRENCY})…")
    sem = asyncio.Semaphore(_CRAWL_CONCURRENCY)
    tasks = [
        _crawl_one_code(i, len(urls), url, instructions, log_cb, sem)
        for i, url in enumerate(urls, 1)
    ]
    results = await asyncio.gather(*tasks, return_exceptions=True)
    all_items: list[ExtractedCodeTopic] = []
    for r in results:
        if isinstance(r, list):
            all_items.extend(r)
    await _log(log_cb, f"✓ Crawl complete — {len(all_items)} problem(s) extracted from {len(urls)} page(s)")
    return all_items


async def extract_english_topics_from_urls(
    urls: list[str],
    instructions: str | None = None,
    log_cb: LogCb = None,
) -> list[ExtractedEnglishTopic]:
    """Same as above but for English topics."""
    await _log(log_cb, f"→ Parallel crawl: {len(urls)} URL(s) (concurrency={_CRAWL_CONCURRENCY})…")
    sem = asyncio.Semaphore(_CRAWL_CONCURRENCY)
    tasks = [
        _crawl_one_english(i, len(urls), url, instructions, log_cb, sem)
        for i, url in enumerate(urls, 1)
    ]
    results = await asyncio.gather(*tasks, return_exceptions=True)
    all_items: list[ExtractedEnglishTopic] = []
    for r in results:
        if isinstance(r, list):
            all_items.extend(r)
    await _log(log_cb, f"✓ Crawl complete — {len(all_items)} topic(s) extracted from {len(urls)} page(s)")
    return all_items


# ── Public API ─────────────────────────────────────────────────────────────────

async def extract_english_topics_from_url(
    url: str, instructions: str | None = None, log_cb: LogCb = None,
) -> tuple[list[ExtractedEnglishTopic], str]:
    text, _sc = await _fetch_page_content(url, instructions=instructions, log_cb=log_cb)
    if not text.strip():
        raise ValueError(f"No text content found at {url}")
    items = await _parse_text_to_english_topics(text, url, instructions=instructions, log_cb=log_cb)
    return items, url


async def extract_english_topics_from_file(
    file_path: str, file_type: str, instructions: str | None = None,
) -> tuple[list[ExtractedEnglishTopic], str]:
    import os
    loop = asyncio.get_event_loop()
    text = await loop.run_in_executor(None, _extract_text_from_file, file_path, file_type)
    if not text.strip():
        raise ValueError("No text content found in file")
    source = os.path.basename(file_path)
    items = await _parse_text_to_english_topics(text, source, instructions=instructions)
    return items, source


async def extract_code_topics_from_url(
    url: str, instructions: str | None = None, log_cb: LogCb = None,
) -> tuple[list[ExtractedCodeTopic], str]:
    text, screenshot_b64 = await _fetch_page_content(url, instructions=instructions, log_cb=log_cb)
    if not text.strip():
        raise ValueError(f"No text content found at {url}")
    items = await _parse_code_topics_with_vision(text, screenshot_b64, url, instructions=instructions, log_cb=log_cb)
    return items, url


async def extract_code_topics_from_file(
    file_path: str, file_type: str, instructions: str | None = None,
) -> tuple[list[ExtractedCodeTopic], str]:
    import os
    loop = asyncio.get_event_loop()
    text = await loop.run_in_executor(None, _extract_text_from_file, file_path, file_type)
    if not text.strip():
        raise ValueError("No text content found in file")
    source = os.path.basename(file_path)
    items = await _parse_text_to_code_topics(text, source, instructions=instructions)
    return items, source


# ── AI Fill ────────────────────────────────────────────────────────────────────

class _AIEnglishFill(BaseModel):
    scenario_prompt: str = Field(description="Rich, detailed scenario prompt the AI tutor uses to open the session. 3-5 sentences.")
    key_vocabulary: str = Field(description="5-10 comma-separated vocabulary words relevant to the topic")
    evaluation_criteria: str = Field(description="3-5 comma-separated evaluation criteria, e.g. 'Fluency, Vocabulary range, Grammar accuracy'")


class _AICodeFill(BaseModel):
    problem_statement: str = Field(description="Full problem description with constraints, input/output format, and 2-3 examples")
    discussion_hints: list[str] = Field(description="3-5 guiding questions the interviewer asks the candidate", min_length=1)
    expected_complexity: str = Field(description="Expected time and space complexity, e.g. O(n) time, O(1) space")
    edge_cases: list[str] = Field(description="3-5 edge cases to test", min_length=1)
    common_mistakes: list[str] = Field(description="3-5 common mistakes candidates make", min_length=1)
    bonus_criteria: list[str] = Field(description="2-3 bonus evaluation points", default_factory=list)
    reference_solution: str = Field(description="A clean, well-commented reference solution in the primary language")


async def ai_fill_english_topic(title: str, skill_focus: str, level: str) -> dict:
    client = instructor.patch(AsyncOpenAI(api_key=settings.OPENAI_API_KEY, timeout=60.0))
    result = await client.chat.completions.create(
        model=_PARSE_MODEL,
        response_model=_AIEnglishFill,
        messages=[
            {"role": "system", "content": "You are an expert English language coach designing practice topics for non-native speakers."},
            {"role": "user", "content": (
                f"Create a complete English practice topic for:\n"
                f"- Title: {title}\n"
                f"- Skill Focus: {skill_focus}\n"
                f"- Level: {level}\n\n"
                f"Generate a rich scenario_prompt (the AI tutor's opening message), relevant key_vocabulary, "
                f"and clear evaluation_criteria."
            )},
        ],
        temperature=0.7,
        max_retries=1,
    )
    return {
        "scenario_prompt": result.scenario_prompt,
        "key_vocabulary": result.key_vocabulary,
        "evaluation_criteria": result.evaluation_criteria,
    }


class _AICodeFillFromImage(BaseModel):
    title: str = Field(description="Problem title extracted from the image")
    category: str = Field(description="One of: Arrays, Strings, Linked List, Trees, Graphs, Dynamic Programming, Recursion, Sorting, Math, System Design, Database, General")
    difficulty: str = Field(description="One of: Beginner, Mid, Senior — infer from easy/medium/hard labels")
    languages: str = Field(default="any", description="Comma-separated languages or 'any'")
    problem_statement: str = Field(description="Full problem description with constraints and examples. Describe any visible diagrams in text.")
    discussion_hints: list[str] = Field(description="3-5 guiding clarifying questions", min_length=1)
    expected_complexity: str = Field(description="Expected time and space complexity, e.g. O(n) time, O(1) space")
    edge_cases: list[str] = Field(description="3-5 edge cases", min_length=1)
    common_mistakes: list[str] = Field(description="3-5 common mistakes", min_length=1)
    bonus_criteria: list[str] = Field(description="2-3 bonus points", default_factory=list)
    reference_solution: Optional[str] = Field(None, description="Reference solution if visible in screenshot")


class _AIEnglishFillFromImage(BaseModel):
    title: str = Field(description="Short descriptive title for the English practice topic")
    skill_focus: str = Field(description="One of: Speaking, Grammar, Vocabulary, Writing, Listening")
    level: str = Field(description="One of: Beginner, Intermediate, Advanced, Any")
    scenario_prompt: str = Field(description="Full scenario/prompt the AI tutor uses to open the session. 3-5 sentences.")
    key_vocabulary: str = Field(description="5-10 comma-separated vocabulary words")
    evaluation_criteria: str = Field(description="3-5 comma-separated evaluation criteria")


async def ai_fill_code_topic_from_image(image_b64: str) -> dict:
    """Extract all code topic fields from a screenshot using GPT-4o-mini vision."""
    import json
    client = instructor.patch(AsyncOpenAI(api_key=settings.OPENAI_API_KEY, timeout=90.0))
    result = await client.chat.completions.create(
        model=_PARSE_MODEL,
        response_model=_AICodeFillFromImage,
        messages=[
            {
                "role": "system",
                "content": (
                    "You are an expert coding interview coach. Extract a complete structured coding problem "
                    "from the screenshot. If the screenshot shows a LeetCode/HackerRank/etc. problem, "
                    "extract all visible fields. Infer difficulty: Easy→Beginner, Medium→Mid, Hard→Senior. "
                    "Describe any visible tree/graph/matrix diagrams as text in problem_statement."
                ),
            },
            {
                "role": "user",
                "content": [
                    {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{image_b64}", "detail": "high"}},
                    {"type": "text", "text": "Extract all fields from this coding problem screenshot to fill a practice topic form."},
                ],
            },
        ],
        temperature=0.2,
        max_retries=1,
    )
    rubric = json.dumps({
        "expected_complexity": result.expected_complexity,
        "edge_cases": result.edge_cases,
        "common_mistakes": result.common_mistakes,
        "bonus": result.bonus_criteria,
    })
    return {
        "title": result.title,
        "category": result.category,
        "difficulty": result.difficulty,
        "languages": result.languages,
        "problem_statement": result.problem_statement,
        "discussion_hints": json.dumps(result.discussion_hints),
        "review_rubric": rubric,
        "reference_solution": result.reference_solution,
    }


async def ai_fill_english_topic_from_image(image_b64: str) -> dict:
    """Extract all English topic fields from a screenshot using GPT-4o-mini vision."""
    client = instructor.patch(AsyncOpenAI(api_key=settings.OPENAI_API_KEY, timeout=60.0))
    result = await client.chat.completions.create(
        model=_PARSE_MODEL,
        response_model=_AIEnglishFillFromImage,
        messages=[
            {
                "role": "system",
                "content": "You are an expert English language coach. Extract a complete English practice topic from the screenshot.",
            },
            {
                "role": "user",
                "content": [
                    {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{image_b64}", "detail": "high"}},
                    {"type": "text", "text": "Extract all English practice topic fields from this screenshot."},
                ],
            },
        ],
        temperature=0.2,
        max_retries=1,
    )
    return {
        "title": result.title,
        "skill_focus": result.skill_focus,
        "level": result.level,
        "scenario_prompt": result.scenario_prompt,
        "key_vocabulary": result.key_vocabulary,
        "evaluation_criteria": result.evaluation_criteria,
    }


async def ai_fill_code_topic(title: str, category: str, difficulty: str, languages: str) -> dict:
    import json
    client = instructor.patch(AsyncOpenAI(api_key=settings.OPENAI_API_KEY, timeout=60.0))
    result = await client.chat.completions.create(
        model=_PARSE_MODEL,
        response_model=_AICodeFill,
        messages=[
            {"role": "system", "content": "You are an expert coding interview coach creating structured interview problems."},
            {"role": "user", "content": (
                f"Create a complete coding interview problem for:\n"
                f"- Title: {title}\n"
                f"- Category: {category}\n"
                f"- Difficulty: {difficulty}\n"
                f"- Languages: {languages}\n\n"
                f"Generate the problem_statement (with constraints and examples), discussion_hints "
                f"(guiding questions), review rubric fields, and a reference_solution."
            )},
        ],
        temperature=0.5,
        max_retries=1,
    )
    rubric = json.dumps({
        "expected_complexity": result.expected_complexity,
        "edge_cases": result.edge_cases,
        "common_mistakes": result.common_mistakes,
        "bonus": result.bonus_criteria,
    })
    return {
        "problem_statement": result.problem_statement,
        "discussion_hints": json.dumps(result.discussion_hints),
        "review_rubric": rubric,
        "reference_solution": result.reference_solution,
    }
