from typing import Optional
from pydantic import BaseModel


ENGLISH_SKILL_FOCUS = ["Speaking", "Grammar", "Vocabulary", "Writing", "Listening"]
ENGLISH_LEVELS = ["Beginner", "Intermediate", "Advanced", "Any"]

CODE_CATEGORIES = [
    "Arrays", "Strings", "Linked List", "Trees", "Graphs",
    "Dynamic Programming", "Recursion", "Sorting", "Math",
    "System Design", "Database", "General",
]
CODE_DIFFICULTIES = ["Beginner", "Mid", "Senior"]
CODE_LANGUAGES = ["python", "javascript", "java", "any"]


# ── English Topics ─────────────────────────────────────────────────────────────

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

    class Config:
        from_attributes = True


class EnglishTopicListResponse(BaseModel):
    items: list[EnglishTopicResponse]
    total: int
    page: int
    per_page: int
    pages: int


class EnglishTopicPreview(BaseModel):
    title: str
    skill_focus: str
    level: str
    scenario_prompt: str
    key_vocabulary: Optional[str] = None
    evaluation_criteria: Optional[str] = None
    source: Optional[str] = None


# ── Code Topics ────────────────────────────────────────────────────────────────

class CodeTopicCreate(BaseModel):
    title: str
    category: str
    difficulty: str
    languages: str = "any"
    problem_statement: str
    discussion_hints: Optional[str] = None
    review_rubric: Optional[str] = None
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

    class Config:
        from_attributes = True


class CodeTopicListResponse(BaseModel):
    items: list[CodeTopicResponse]
    total: int
    page: int
    per_page: int
    pages: int


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


# ── Import shared ──────────────────────────────────────────────────────────────

class TopicImportRequest(BaseModel):
    url: Optional[str] = None
    instructions: Optional[str] = None
    cookies: Optional[str] = None  # raw cookie string for authentication bypass
    item_urls: Optional[list[str]] = None  # individual problem URLs to crawl (from discover phase)


class DiscoverFeedbackRequest(BaseModel):
    session_id: str
    instruction: str


class PageDiscoveryItem(BaseModel):
    title: str
    identifier: Optional[str] = None
    difficulty: Optional[str] = None
    note: Optional[str] = None
    url: Optional[str] = None  # direct link to individual problem page


class PageDiscoveryResponse(BaseModel):
    page_type: str
    page_title: str
    description: str
    items: list[PageDiscoveryItem] = []
    total_count: int = 0
    screenshot_b64: Optional[str] = None


class EnglishTopicImportConfirmRequest(BaseModel):
    topics: list[EnglishTopicPreview]


class CodeTopicImportConfirmRequest(BaseModel):
    topics: list[CodeTopicPreview]


class TopicImportConfirmResponse(BaseModel):
    imported: int
    skipped: int


# ── AI Fill ────────────────────────────────────────────────────────────────────

class EnglishAIFillRequest(BaseModel):
    title: str
    skill_focus: str
    level: str

class EnglishAIFillResponse(BaseModel):
    scenario_prompt: str
    key_vocabulary: Optional[str] = None
    evaluation_criteria: Optional[str] = None


class CodeAIFillRequest(BaseModel):
    title: str
    category: str
    difficulty: str
    languages: str = "any"

class CodeAIFillResponse(BaseModel):
    problem_statement: str
    discussion_hints: Optional[str] = None  # JSON array string
    review_rubric: Optional[str] = None     # JSON object string
    reference_solution: Optional[str] = None


class CodeAIFillFromImageRequest(BaseModel):
    image_b64: str  # base64 JPEG/PNG

class CodeAIFillFromImageResponse(BaseModel):
    title: Optional[str] = None
    category: Optional[str] = None
    difficulty: Optional[str] = None
    languages: Optional[str] = None
    problem_statement: str
    discussion_hints: Optional[str] = None
    review_rubric: Optional[str] = None
    reference_solution: Optional[str] = None


class EnglishAIFillFromImageRequest(BaseModel):
    image_b64: str  # base64 JPEG/PNG

class EnglishAIFillFromImageResponse(BaseModel):
    title: Optional[str] = None
    skill_focus: Optional[str] = None
    level: Optional[str] = None
    scenario_prompt: str
    key_vocabulary: Optional[str] = None
    evaluation_criteria: Optional[str] = None
