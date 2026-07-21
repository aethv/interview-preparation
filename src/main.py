"""Main FastAPI application entry point."""

from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from src.api.v1.router import api_router
from src.core.config import settings
from src.core.database import engine
from src.core.logging import setup_logging


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan events."""
    # Startup
    setup_logging()

    # Schema is owned by Alembic — see Dockerfile CMD / railway.json startCommand,
    # both of which run `alembic upgrade head` before the server starts.
    #
    # Base.metadata.create_all() used to run here and caused a production outage:
    # it creates MISSING TABLES but never adds COLUMNS to existing ones, so new
    # model fields silently never appeared, while tables it created behind
    # Alembic's back left alembic_version empty. A later `alembic upgrade head`
    # then tried to replay every migration against a live schema.
    #
    # If a table is missing, run: alembic upgrade head
    await _warn_if_schema_behind()
    await _load_secrets()

    yield
    # Shutdown
    pass


async def _load_secrets() -> None:
    """Warm the secret cache so admin-managed keys apply from the first request.

    Without this, the first call in each process would fall back to the
    environment variable until something triggered a database load.
    """
    import logging

    logger = logging.getLogger(__name__)
    try:
        from src.core.database import AsyncSessionLocal
        from src.services.data.secret_service import load_secrets

        async with AsyncSessionLocal() as db:
            loaded = await load_secrets(db)
        if loaded:
            # Names only — never values
            logger.info("Loaded managed secrets: %s", ", ".join(sorted(loaded)))
    except Exception as e:
        logger.warning(f"Could not load managed secrets, using environment: {e}")


async def _warn_if_schema_behind() -> None:
    """Log loudly when the database is not migrated to the current head.

    Read-only: it never changes the schema, it just turns a confusing runtime
    error into an obvious startup message.
    """
    import logging

    logger = logging.getLogger(__name__)
    try:
        from alembic.config import Config
        from alembic.script import ScriptDirectory
        from sqlalchemy import text

        head = ScriptDirectory.from_config(Config("alembic.ini")).get_current_head()

        async with engine.connect() as conn:
            result = await conn.execute(
                text("SELECT version_num FROM alembic_version LIMIT 1")
            )
            current = result.scalar()

        if current != head:
            logger.warning(
                "Database schema is at %r but code expects %r. "
                "Run `alembic upgrade head` — endpoints touching new columns will fail.",
                current or "(unstamped)", head,
            )
    except Exception as e:
        # Never block startup on a diagnostic
        logger.warning(f"Could not verify schema version: {e}")


app = FastAPI(
    title="InterviewLab API",
    description="Voice-based interview preparation platform",
    version="0.1.0",
    lifespan=lifespan,
)

# CORS middleware - must be added before routes
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Allow all origins
    allow_credentials=False,  # Must be False when allow_origins is ["*"]
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["*"],
    expose_headers=["*"],
)

# Include API router
app.include_router(api_router, prefix="/api/v1")


@app.get("/health")
async def health_check():
    """Health check endpoint."""
    return {"status": "healthy", "service": "interviewlab"}


@app.get("/")
async def root():
    """Root endpoint."""
    return {"message": "InterviewLab API", "version": "0.1.0"}


