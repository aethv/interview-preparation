# Practice Topics — Implementation Plan

## Overview

Add two new admin-managed content libraries:

- **English Topics** — scenario-based conversation topics for English practice sessions
- **Code Topics** — structured coding problems for code practice sessions (with problem statement, discussion hints, review rubric, reference solution)

Both follow the same pattern as the existing **Question Bank**: list → create/edit dialog → import from URL (crawler) or manual input.

---

## Project Context

### Tech Stack
- **Backend**: FastAPI + SQLAlchemy async (asyncpg) + PostgreSQL + pgvector
- **Frontend**: Next.js 14 App Router, React Query, shadcn/ui, Tailwind
- **AI**: OpenAI (gpt-4o-mini for extraction, text-embedding-3-small for embeddings)
- **Crawler**: Playwright headless Chromium + instructor structured output

### Critical SQLAlchemy + asyncpg constraint
> **NEVER use `:vec::vector` syntax in `sqlalchemy.text()` queries.**
> asyncpg cannot register pgvector codec via event hooks.
> Always use `CAST(:vec AS vector)` instead.
> Never map `embedding vector(1536)` columns in ORM models — manage via raw SQL only.

### Existing patterns to follow
- **Model**: `src/models/question_bank.py` — ORM without embedding column
- **Schema**: `src/schemas/question_bank.py` — Pydantic schemas + constants
- **Service**: `src/services/data/question_bank_service.py` — CRUD + embed + similarity
- **Importer**: `src/services/data/question_importer.py` — Playwright + GPT extraction with `log_cb` streaming
- **Endpoint**: `src/api/v1/endpoints/question_bank.py` — CRUD + SSE streaming import
- **Frontend tab**: `frontend/app/dashboard/admin/question-bank-tab.tsx` — full CRUD + import dialog
- **API client**: `frontend/lib/api/question_bank.ts`

### Alembic migration chain
```
4243cd47bcce → add_job_description_to_interviews → add_admin_config_001 → add_question_bank_001
                                                                                        ↑
                                                                          New migrations go after this
```

---

## Data Models

### EnglishTopic

**File**: `src/models/practice_topics.py`

```python
class EnglishTopic(Base):
    __tablename__ = "english_topics"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    skill_focus: Mapped[str] = mapped_column(String(50), nullable=False, index=True)
    # Values: Speaking, Grammar, Vocabulary, Writing, Listening
    level: Mapped[str] = mapped_column(String(30), nullable=False, index=True)
    # Values: Beginner, Intermediate, Advanced, Any
    scenario_prompt: Mapped[str] = mapped_column(Text, nullable=False)
    # Full text the agent uses to open the session
    key_vocabulary: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Comma-separated words/phrases the agent should work in naturally
    evaluation_criteria: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Free text: what the agent evaluates in post-session feedback
    source: Mapped[str | None] = mapped_column(String(500), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
```

### CodeTopic

**File**: `src/models/practice_topics.py` (same file)

```python
class CodeTopic(Base):
    __tablename__ = "code_topics"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    category: Mapped[str] = mapped_column(String(100), nullable=False, index=True)
    # Values: Arrays, Trees, DP, Graph, String, Math, System Design, Database, etc.
    difficulty: Mapped[str] = mapped_column(String(30), nullable=False, index=True)
    # Values: Beginner, Mid, Senior
    languages: Mapped[str] = mapped_column(String(100), nullable=False, default="any")
    # Comma-separated: "python,java,javascript" or "any"
    problem_statement: Mapped[str] = mapped_column(Text, nullable=False)
    # Full problem description the agent reads in INTRO phase
    discussion_hints: Mapped[str | None] = mapped_column(Text, nullable=True)
    # JSON array of strings: ["What is the brute force approach?", "What data structure helps?"]
    review_rubric: Mapped[str | None] = mapped_column(Text, nullable=True)
    # JSON object: {"expected_complexity": "O(n)", "edge_cases": [...], "common_mistakes": [...], "bonus": [...]}
    reference_solution: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Optional working solution — never shown to candidate, used by agent during REVIEW
    source: Mapped[str | None] = mapped_column(String(500), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
```

---

## Alembic Migration

**File**: `alembic/versions/add_practice_topics.py`

```python
revision = 'add_practice_topics_001'
down_revision = 'add_question_bank_001'
```

Creates both tables. No vector columns needed (no pgvector for practice topics — topics are small enough for full-text search).

```python
def upgrade():
    op.create_table(
        'english_topics',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('title', sa.String(200), nullable=False),
        sa.Column('skill_focus', sa.String(50), nullable=False, index=True),
        sa.Column('level', sa.String(30), nullable=False, index=True),
        sa.Column('scenario_prompt', sa.Text(), nullable=False),
        sa.Column('key_vocabulary', sa.Text(), nullable=True),
        sa.Column('evaluation_criteria', sa.Text(), nullable=True),
        sa.Column('source', sa.String(500), nullable=True),
        sa.Column('is_active', sa.Boolean(), default=True, nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    op.create_table(
        'code_topics',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('title', sa.String(200), nullable=False),
        sa.Column('category', sa.String(100), nullable=False, index=True),
        sa.Column('difficulty', sa.String(30), nullable=False, index=True),
        sa.Column('languages', sa.String(100), nullable=False, default='any'),
        sa.Column('problem_statement', sa.Text(), nullable=False),
        sa.Column('discussion_hints', sa.Text(), nullable=True),
        sa.Column('review_rubric', sa.Text(), nullable=True),
        sa.Column('reference_solution', sa.Text(), nullable=True),
        sa.Column('source', sa.String(500), nullable=True),
        sa.Column('is_active', sa.Boolean(), default=True, nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

def downgrade():
    op.drop_table('code_topics')
    op.drop_table('english_topics')
```

---

## Backend — Schemas

**File**: `src/schemas/practice_topics.py`

### Constants
```python
ENGLISH_SKILL_FOCUS = ["Speaking", "Grammar", "Vocabulary", "Writing", "Listening"]
ENGLISH_LEVELS = ["Beginner", "Intermediate", "Advanced", "Any"]

CODE_CATEGORIES = [
    "Arrays", "Strings", "Linked List", "Trees", "Graphs",
    "Dynamic Programming", "Recursion", "Sorting", "Math",
    "System Design", "Database", "General"
]
CODE_DIFFICULTIES = ["Beginner", "Mid", "Senior"]
CODE_LANGUAGES = ["python", "javascript", "java", "any"]
```

### English Topic Schemas
```python
class EnglishTopicCreate(BaseModel):
    title: str
    skill_focus: str
    level: str
    scenario_prompt: str
    key_vocabulary: Optional[str] = None
    evaluation_criteria: Optional[str] = None
    source: Optional[str] = None
    is_active: bool = True

class EnglishTopicUpdate(BaseModel):
    title: Optional[str] = None
    skill_focus: Optional[str] = None
    level: Optional[str] = None
    scenario_prompt: Optional[str] = None
    key_vocabulary: Optional[str] = None
    evaluation_criteria: Optional[str] = None
    is_active: Optional[bool] = None

class EnglishTopicResponse(BaseModel):
    id: int
    title: str
    skill_focus: str
    level: str
    scenario_prompt: str
    key_vocabulary: Optional[str]
    evaluation_criteria: Optional[str]
    source: Optional[str]
    is_active: bool
    created_at: str
    updated_at: str

class EnglishTopicListResponse(BaseModel):
    items: list[EnglishTopicResponse]
    total: int
    page: int
    per_page: int
    pages: int
```

### Code Topic Schemas
```python
class CodeTopicCreate(BaseModel):
    title: str
    category: str
    difficulty: str
    languages: str = "any"
    problem_statement: str
    discussion_hints: Optional[str] = None   # stored as JSON string
    review_rubric: Optional[str] = None      # stored as JSON string
    reference_solution: Optional[str] = None
    source: Optional[str] = None
    is_active: bool = True

class CodeTopicUpdate(BaseModel):
    title: Optional[str] = None
    category: Optional[str] = None
    difficulty: Optional[str] = None
    languages: Optional[str] = None
    problem_statement: Optional[str] = None
    discussion_hints: Optional[str] = None
    review_rubric: Optional[str] = None
    reference_solution: Optional[str] = None
    is_active: Optional[bool] = None

class CodeTopicResponse(BaseModel):
    id: int
    title: str
    category: str
    difficulty: str
    languages: str
    problem_statement: str
    discussion_hints: Optional[str]
    review_rubric: Optional[str]
    reference_solution: Optional[str]
    source: Optional[str]
    is_active: bool
    created_at: str
    updated_at: str

class CodeTopicListResponse(BaseModel):
    items: list[CodeTopicResponse]
    total: int
    page: int
    per_page: int
    pages: int
```

### Import Schemas (shared)
```python
class TopicImportRequest(BaseModel):
    url: Optional[str] = None
    instructions: Optional[str] = None

class EnglishTopicPreview(BaseModel):
    title: str
    skill_focus: str
    level: str
    scenario_prompt: str
    key_vocabulary: Optional[str] = None
    evaluation_criteria: Optional[str] = None
    source: Optional[str] = None

class CodeTopicPreview(BaseModel):
    title: str
    category: str
    difficulty: str
    languages: str = "any"
    problem_statement: str
    discussion_hints: Optional[str] = None
    review_rubric: Optional[str] = None
    reference_solution: Optional[str] = None
    source: Optional[str] = None

class TopicImportConfirmResponse(BaseModel):
    imported: int
    skipped: int
```

---

## Backend — Services

**File**: `src/services/data/practice_topic_service.py`

Standard CRUD for both models. No embedding needed. Pattern exactly mirrors question_bank_service.py but simpler (no vector operations).

### Functions to implement
```python
# English Topics
async def list_english_topics(db, skill_focus=None, level=None, search=None, page=1, per_page=20, active_only=False)
async def get_english_topic(db, topic_id)
async def create_english_topic(db, data: EnglishTopicCreate)
async def update_english_topic(db, topic_id, data: EnglishTopicUpdate)
async def delete_english_topic(db, topic_id)

# Code Topics
async def list_code_topics(db, category=None, difficulty=None, search=None, page=1, per_page=20, active_only=False)
async def get_code_topic(db, topic_id)
async def create_code_topic(db, data: CodeTopicCreate)
async def update_code_topic(db, topic_id, data: CodeTopicUpdate)
async def delete_code_topic(db, topic_id)
```

---

## Backend — Importer (GPT extraction)

**File**: `src/services/data/practice_topic_importer.py`

Same pattern as `question_importer.py`:
- Playwright crawl with `log_cb` streaming
- Instructor + gpt-4o-mini structured output
- `timeout=90.0` on OpenAI client
- `max_retries=1`

### Pydantic extraction schemas for GPT

```python
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
```

### Public functions
```python
async def extract_english_topics_from_url(url, instructions=None, log_cb=None) -> tuple[list[ExtractedEnglishTopic], str]
async def extract_english_topics_from_file(file_path, file_type, instructions=None) -> tuple[list[ExtractedEnglishTopic], str]
async def extract_code_topics_from_url(url, instructions=None, log_cb=None) -> tuple[list[ExtractedCodeTopic], str]
async def extract_code_topics_from_file(file_path, file_type, instructions=None) -> tuple[list[ExtractedCodeTopic], str]
```

Internally reuse `_extract_text_from_url` and `_extract_text_from_file` from `question_importer.py` (import them directly — no duplication needed). Only the GPT prompt and output schema differ.

---

## Backend — API Endpoints

**File**: `src/api/v1/endpoints/practice_topics.py`

Two routers in one file: `english_router` and `code_router`. All routes admin-protected.

### English Topics routes
```
GET    /admin/english-topics/meta           → {skill_focus_options, level_options}
GET    /admin/english-topics               → EnglishTopicListResponse
POST   /admin/english-topics               → EnglishTopicResponse (201)
PUT    /admin/english-topics/{id}          → EnglishTopicResponse
DELETE /admin/english-topics/{id}          → 204
POST   /admin/english-topics/import/extract-url/stream  → SSE stream
POST   /admin/english-topics/import/extract-file        → list[EnglishTopicPreview]
POST   /admin/english-topics/import/confirm             → TopicImportConfirmResponse
```

### Code Topics routes
```
GET    /admin/code-topics/meta             → {categories, difficulties, languages}
GET    /admin/code-topics                  → CodeTopicListResponse
POST   /admin/code-topics                  → CodeTopicResponse (201)
PUT    /admin/code-topics/{id}             → CodeTopicResponse
DELETE /admin/code-topics/{id}             → 204
POST   /admin/code-topics/import/extract-url/stream  → SSE stream
POST   /admin/code-topics/import/extract-file        → list[CodeTopicPreview]
POST   /admin/code-topics/import/confirm             → TopicImportConfirmResponse
```

### SSE streaming pattern (same as question_bank.py)
```python
@english_router.post("/import/extract-url/stream")
async def stream_english_import(body, db, _):
    queue = asyncio.Queue()
    _TIMEOUT = 300

    async def log_cb(msg): await queue.put({"type": "log", "message": msg})

    async def run():
        try:
            extracted, source = await asyncio.wait_for(
                extract_english_topics_from_url(body.url, body.instructions, log_cb),
                timeout=_TIMEOUT
            )
            # build previews, put result on queue
        except asyncio.TimeoutError:
            await queue.put({"type": "error", "message": "Timed out after 300s"})
        except Exception as e:
            await queue.put({"type": "error", "message": str(e)})
        finally:
            await queue.put(None)

    async def generate():
        task = asyncio.create_task(run())
        try:
            while True:
                try:
                    item = await asyncio.wait_for(queue.get(), timeout=310)
                except asyncio.TimeoutError:
                    yield f"data: {json.dumps({'type':'error','message':'Watchdog timeout'})}\n\n"
                    break
                if item is None: break
                yield f"data: {json.dumps(item)}\n\n"
        finally:
            task.cancel()

    return StreamingResponse(generate(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})
```

---

## Backend — Router Registration

**File**: `src/api/v1/router.py`

Add two new includes:
```python
from src.api.v1.endpoints.practice_topics import english_router, code_router

api_router.include_router(english_router, prefix="/admin/english-topics", tags=["english-topics"])
api_router.include_router(code_router, prefix="/admin/code-topics", tags=["code-topics"])
```

---

## Backend — Models Init

**File**: `src/models/__init__.py`

Add the new models so `create_all()` picks them up:
```python
from src.models.practice_topics import EnglishTopic, CodeTopic
```

---

## Frontend — API Client

**File**: `frontend/lib/api/practice_topics.ts`

```typescript
import { apiClient } from './client';

// ── English Topics ─────────────────────────────────────────────────────────

export interface EnglishTopic {
  id: number;
  title: string;
  skill_focus: string;
  level: string;
  scenario_prompt: string;
  key_vocabulary: string | null;
  evaluation_criteria: string | null;
  source: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface EnglishTopicListResponse {
  items: EnglishTopic[];
  total: number;
  page: number;
  per_page: number;
  pages: number;
}

export interface EnglishTopicPreview {
  title: string;
  skill_focus: string;
  level: string;
  scenario_prompt: string;
  key_vocabulary: string | null;
  evaluation_criteria: string | null;
  source: string | null;
}

export interface EnglishTopicMeta {
  skill_focus_options: string[];
  level_options: string[];
}

export const englishTopicsApi = {
  getMeta: (): Promise<EnglishTopicMeta> =>
    apiClient.get('/api/v1/admin/english-topics/meta'),

  list: (params: { skill_focus?: string; level?: string; search?: string; page?: number; per_page?: number }) =>
    // build URLSearchParams, call apiClient.get

  create: (body: Omit<EnglishTopic, 'id' | 'created_at' | 'updated_at'>): Promise<EnglishTopic> =>
    apiClient.post('/api/v1/admin/english-topics', body),

  update: (id: number, body: Partial<EnglishTopic>): Promise<EnglishTopic> =>
    apiClient.put(`/api/v1/admin/english-topics/${id}`, body),

  delete: (id: number): Promise<void> =>
    apiClient.delete(`/api/v1/admin/english-topics/${id}`),

  extractFromUrlStream: (url, instructions?, onLog?) => /* SSE fetch — same as question_bank.ts */,

  extractFromFile: (file, instructions?, onProgress?) => /* XHR FormData — same as question_bank.ts */,

  confirmImport: (topics: EnglishTopicPreview[]): Promise<{ imported: number; skipped: number }> =>
    apiClient.post('/api/v1/admin/english-topics/import/confirm', { topics }),
};

// ── Code Topics ────────────────────────────────────────────────────────────

export interface CodeTopic {
  id: number;
  title: string;
  category: string;
  difficulty: string;
  languages: string;
  problem_statement: string;
  discussion_hints: string | null;   // JSON string
  review_rubric: string | null;      // JSON string
  reference_solution: string | null;
  source: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface CodeTopicListResponse { /* same pagination shape */ }
export interface CodeTopicPreview { /* same fields minus id/dates/is_active */ }
export interface CodeTopicMeta {
  categories: string[];
  difficulties: string[];
  languages: string[];
}

export const codeTopicsApi = {
  getMeta, list, create, update, delete,
  extractFromUrlStream, extractFromFile, confirmImport
  // all same pattern as englishTopicsApi
};
```

---

## Frontend — English Topics Tab

**File**: `frontend/app/dashboard/admin/english-topics-tab.tsx`

### Structure (same shell as question-bank-tab.tsx)

```
EnglishTopicsTab
  ├── Filters row: skill_focus select, level select, search input, + Add button, Import button
  ├── Topics table: Title | Skill | Level | Scenario (truncated) | Active | Actions (Edit/Delete)
  ├── Pagination
  ├── EnglishTopicFormDialog (Add/Edit)
  │     Fields: title, skill_focus (select), level (select),
  │             scenario_prompt (textarea large), key_vocabulary (textarea),
  │             evaluation_criteria (textarea), is_active (checkbox)
  └── ImportDialog (URL + File + Instructions + SSE live log + editable preview table)
        Preview table columns: Title | Skill | Level | Scenario | Key Vocab | Eval Criteria
```

### Key implementation notes
- Reuse `useProgressSim`, `JobStatusIcon`, `EditableCell` patterns from question-bank-tab.tsx
- Import dialog: same multi-step flow (input → loading with live log → editable preview → done)
- Preview table: fewer columns than question bank, all editable inline
- `skill_focus` and `level` are dropdowns populated from `/meta`

---

## Frontend — Code Topics Tab

**File**: `frontend/app/dashboard/admin/code-topics-tab.tsx`

### Structure

```
CodeTopicsTab
  ├── Filters row: category select, difficulty select, search input, + Add button, Import button
  ├── Topics table: Title | Category | Difficulty | Languages | Active | Actions
  ├── Pagination
  ├── CodeTopicFormDialog (Add/Edit)  ← tabbed form
  │     Tab 1 — Basic: title, category, difficulty, languages (checkboxes), is_active
  │     Tab 2 — Problem: problem_statement (large textarea)
  │     Tab 3 — Discussion: discussion_hints (textarea, displayed as bullet list)
  │     Tab 4 — Review: review_rubric fields (expected complexity, edge cases, mistakes, bonus)
  │     Tab 5 — Solution: reference_solution (code editor or textarea with monospace font)
  └── ImportDialog (same SSE streaming pattern as English)
        Preview table columns: Title | Category | Difficulty | Languages | Problem (truncated)
        Click row to expand and edit all fields
```

### Review Rubric UI detail
The `review_rubric` JSON is stored as a string in DB. In the form, show it as structured fields:
```
Expected complexity: [input]
Edge cases:         [textarea — one per line]
Common mistakes:    [textarea — one per line]
Bonus criteria:     [textarea — one per line]
```
On save, serialize to JSON. On load, parse and populate fields.

### discussion_hints UI detail
`discussion_hints` is a JSON array stored as string. In the form, show as a textarea with one hint per line. On save, serialize lines to JSON array.

---

## Frontend — Admin Page Update

**File**: `frontend/app/dashboard/admin/page.tsx`

Add two new imports and tabs:
```tsx
import { EnglishTopicsTab } from './english-topics-tab';
import { CodeTopicsTab } from './code-topics-tab';

// In TabsList:
<TabsTrigger value="config">Agent Config</TabsTrigger>
<TabsTrigger value="questions">Question Bank</TabsTrigger>
<TabsTrigger value="english">English Topics</TabsTrigger>   {/* NEW */}
<TabsTrigger value="code">Code Topics</TabsTrigger>         {/* NEW */}
<TabsTrigger value="users">Users</TabsTrigger>

// In TabsContent:
<TabsContent value="english" className="mt-4">
  <EnglishTopicsTab />
</TabsContent>
<TabsContent value="code" className="mt-4">
  <CodeTopicsTab />
</TabsContent>
```

---

## Implementation Order

### Step 1 — Backend models + migration
1. Create `src/models/practice_topics.py` with `EnglishTopic` and `CodeTopic`
2. Add both to `src/models/__init__.py`
3. Create `alembic/versions/add_practice_topics.py` migration
4. Run migration: `docker compose exec api alembic upgrade head`

### Step 2 — Backend schemas + service
1. Create `src/schemas/practice_topics.py`
2. Create `src/services/data/practice_topic_service.py` (CRUD only, no embeddings)

### Step 3 — Backend importer
1. Create `src/services/data/practice_topic_importer.py`
2. Import `_extract_text_from_url`, `_extract_text_from_file`, `_get_click_targets`, `_log` from `question_importer.py`
3. Write GPT prompt + extraction schemas for both topic types

### Step 4 — Backend endpoints + router
1. Create `src/api/v1/endpoints/practice_topics.py` with both routers
2. Update `src/api/v1/router.py` to register both

### Step 5 — Restart API + verify routes
```bash
docker compose restart api
curl http://localhost:8003/api/v1/admin/english-topics/meta   # should return 401 (auth works)
```

### Step 6 — Frontend API client
1. Create `frontend/lib/api/practice_topics.ts`
2. Implement both `englishTopicsApi` and `codeTopicsApi` following question_bank.ts pattern exactly

### Step 7 — English Topics tab
1. Create `frontend/app/dashboard/admin/english-topics-tab.tsx`
2. Add to admin page

### Step 8 — Code Topics tab
1. Create `frontend/app/dashboard/admin/code-topics-tab.tsx`
2. Add to admin page

### Step 9 — End-to-end test
1. Manual create an English Topic via the form
2. Import from a URL via SSE stream — watch live log
3. Manual create a Code Topic via the tabbed form
4. Import a LeetCode problem URL — verify GPT fills all fields

---

## Import URL Examples

### English Topics
- IELTS speaking topics: `https://ielts.org/take-a-test/test-types/ielts-speaking-test/ielts-speaking-topics`
- ESL discussion topics: any ESL resource site
- Instructions: `"Extract each topic as a separate entry. Set skill_focus to Speaking. Level IELTS = Advanced."`

### Code Topics
- LeetCode: `https://leetcode.com/problems/two-sum/description/`
- Instructions: `"Extract the problem as a single Code Topic. Fill discussion_hints with 3-4 clarifying questions. Fill review_rubric with expected O(n) complexity and common mistakes."`
- GeeksForGeeks: `https://www.geeksforgeeks.org/...`

---

## Files to Create

| File | Type |
|------|------|
| `src/models/practice_topics.py` | New |
| `alembic/versions/add_practice_topics.py` | New |
| `src/schemas/practice_topics.py` | New |
| `src/services/data/practice_topic_service.py` | New |
| `src/services/data/practice_topic_importer.py` | New |
| `src/api/v1/endpoints/practice_topics.py` | New |
| `frontend/lib/api/practice_topics.ts` | New |
| `frontend/app/dashboard/admin/english-topics-tab.tsx` | New |
| `frontend/app/dashboard/admin/code-topics-tab.tsx` | New |

## Files to Modify

| File | Change |
|------|--------|
| `src/models/__init__.py` | Add EnglishTopic, CodeTopic imports |
| `src/api/v1/router.py` | Register english_router, code_router |
| `frontend/app/dashboard/admin/page.tsx` | Add two tab triggers + tab contents |
