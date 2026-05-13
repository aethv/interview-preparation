"""Question bank Pydantic schemas."""

from typing import Optional, Literal
from pydantic import BaseModel, Field


CATEGORIES = [
    # Technical — programming
    "Java", "Python", "JavaScript", "Algorithm", "System Design",
    "Database", "Messaging", "Spring", "Cloud", "DevOps", "Security", "Frontend",
    # Language learning
    "English Grammar", "English Vocabulary", "English Speaking", "English Writing", "English Listening",
    # General / other
    "Math", "Soft Skills", "General",
]

LEVELS = ["Beginner", "Junior", "Mid", "Senior", "Advanced", "Any"]


class QuestionCreate(BaseModel):
    category: str = Field(..., max_length=100)
    subcategory: Optional[str] = Field(None, max_length=100)
    level: str = Field(..., max_length=20)
    topic: str = Field(..., max_length=200)
    question: str
    answer: str
    source: Optional[str] = Field(None, max_length=500)


class QuestionUpdate(BaseModel):
    category: Optional[str] = Field(None, max_length=100)
    subcategory: Optional[str] = Field(None, max_length=100)
    level: Optional[str] = Field(None, max_length=20)
    topic: Optional[str] = Field(None, max_length=200)
    question: Optional[str] = None
    answer: Optional[str] = None


class QuestionResponse(BaseModel):
    id: int
    category: str
    subcategory: Optional[str]
    level: str
    topic: str
    question: str
    answer: str
    source: Optional[str]
    created_at: str
    updated_at: str

    class Config:
        from_attributes = True


class QuestionListResponse(BaseModel):
    items: list[QuestionResponse]
    total: int
    page: int
    per_page: int
    pages: int


class QuestionPreview(BaseModel):
    """A Q&A extracted from a document/URL before import."""
    category: str
    subcategory: Optional[str] = None
    level: str
    topic: str
    question: str
    answer: str
    source: Optional[str] = None
    status: Literal["new", "similar", "duplicate"] = "new"
    similar_id: Optional[int] = None
    similarity_score: Optional[float] = None


class ImportExtractRequest(BaseModel):
    url: Optional[str] = None  # mutually exclusive with file upload
    instructions: Optional[str] = None  # LLM guidance: what to focus on, how to navigate


class ImportConfirmRequest(BaseModel):
    questions: list[QuestionPreview]


class ImportConfirmResponse(BaseModel):
    imported: int
    skipped: int


class BankSearchResult(BaseModel):
    """Used internally by orchestrator to inject bank questions."""
    id: int
    category: str
    level: str
    topic: str
    question: str
    answer: str
    similarity: float
