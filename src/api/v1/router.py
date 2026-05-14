"""Main API v1 router."""

from fastapi import APIRouter

from src.api.v1.endpoints import auth, resumes, interviews, voice, sandbox, admin, question_bank
from src.api.v1.endpoints.practice_topics import english_router, code_router, public_router

api_router = APIRouter()

api_router.include_router(auth.router, prefix="/auth", tags=["authentication"])
api_router.include_router(resumes.router, prefix="/resumes", tags=["resumes"])
api_router.include_router(interviews.router, prefix="/interviews", tags=["interviews"])
api_router.include_router(voice.router, prefix="/voice", tags=["voice"])
api_router.include_router(sandbox.router, prefix="/sandbox", tags=["sandbox"])
api_router.include_router(admin.router, prefix="/admin", tags=["admin"])
api_router.include_router(question_bank.router, prefix="/admin/questions", tags=["question-bank"])
api_router.include_router(english_router, prefix="/admin/english-topics", tags=["english-topics"])
api_router.include_router(code_router, prefix="/admin/code-topics", tags=["code-topics"])
api_router.include_router(public_router, prefix="/practice", tags=["practice"])


