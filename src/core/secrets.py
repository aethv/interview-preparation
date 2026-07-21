"""Encrypted storage for third-party API keys.

Design rules, in order of importance:

1. A stored secret is NEVER returned in plaintext by any API. Reads return a
   masked preview ("sk-pr…4f2a"); the real value leaves the database only when
   handed to the vendor client that needs it.
2. Ciphertext at rest. The Fernet key is derived from SECRET_KEY, so the
   database alone is not enough to recover the keys.
3. Secrets never reach the logs. Nothing here logs a value, and decryption
   failures report the secret's name only.
4. Failure is soft. If a secret cannot be decrypted (typically SECRET_KEY was
   rotated) we fall back to the environment variable instead of taking the
   application down.

Resolution order for every consumer: stored secret, then env var, then "".
"""

import base64
import hashlib
import logging
from typing import Optional

from cryptography.fernet import Fernet, InvalidToken

from src.core.config import settings

logger = logging.getLogger(__name__)


# Managed secrets: name -> (label, settings attribute used as fallback)
SECRET_DEFINITIONS: dict[str, tuple[str, str]] = {
    "openai_api_key": ("OpenAI API key", "OPENAI_API_KEY"),
    "elevenlabs_api_key": ("ElevenLabs API key", "ELEVENLABS_API_KEY"),
    "livekit_api_key": ("LiveKit API key", "LIVEKIT_API_KEY"),
    "livekit_api_secret": ("LiveKit API secret", "LIVEKIT_API_SECRET"),
}

# Changing these invalidates every stored secret, so treat them as constants.
_KDF_SALT = b"interviewlab.secrets.v1"
_KDF_ITERATIONS = 100_000


def _fernet() -> Fernet:
    """Build the Fernet cipher from SECRET_KEY.

    PBKDF2 rather than the raw key: SECRET_KEY is a human-chosen string of
    arbitrary length, while Fernet needs exactly 32 bytes.
    """
    derived = hashlib.pbkdf2_hmac(
        "sha256", settings.SECRET_KEY.encode("utf-8"), _KDF_SALT, _KDF_ITERATIONS, dklen=32
    )
    return Fernet(base64.urlsafe_b64encode(derived))


def encrypt(value: str) -> str:
    """Encrypt a secret for storage."""
    return _fernet().encrypt(value.encode("utf-8")).decode("ascii")


def decrypt(ciphertext: str, *, name: str = "secret") -> Optional[str]:
    """Decrypt a stored secret, or None if it cannot be read.

    Never raises and never logs the value — a rotated SECRET_KEY should degrade
    to the env fallback, not break startup.
    """
    try:
        return _fernet().decrypt(ciphertext.encode("ascii")).decode("utf-8")
    except (InvalidToken, ValueError, TypeError):
        logger.warning(
            "Stored secret %r could not be decrypted (was SECRET_KEY rotated?). "
            "Falling back to the environment variable.", name,
        )
        return None


def mask(value: Optional[str]) -> str:
    """Render a secret for display: first 4 and last 4 characters kept.

    Short values are fully masked rather than partially revealed — showing 4 of
    6 characters would leak most of the secret.
    """
    if not value:
        return ""
    if len(value) < 12:
        return "•" * len(value)
    return f"{value[:4]}{'•' * 8}{value[-4:]}"


def env_fallback(name: str) -> str:
    """The environment-provided value for a managed secret, or ""."""
    definition = SECRET_DEFINITIONS.get(name)
    if not definition:
        return ""
    return getattr(settings, definition[1], "") or ""


# Decrypted secrets, populated by src.services.data.secret_service.
#
# The cache lives here, in the dependency-free core module, so that the many
# vendor-client call sites can resolve a key with a plain synchronous import and
# no risk of a circular import through the database layer.
_runtime_cache: dict[str, str] = {}


def set_runtime_cache(values: dict[str, str]) -> None:
    """Replace the in-memory secret cache (called after a DB load or a write)."""
    _runtime_cache.clear()
    _runtime_cache.update(values)


def clear_runtime_cache() -> None:
    _runtime_cache.clear()


def get_secret_value(name: str) -> str:
    """Resolve a secret: stored value first, environment variable second.

    Synchronous by design — it is called from vendor client constructors deep in
    the stack. Returns "" when neither source has a value, which the vendor SDK
    surfaces as an auth error rather than crashing at import time.
    """
    return _runtime_cache.get(name) or env_fallback(name)


def openai_api_key() -> str:
    return get_secret_value("openai_api_key")


def elevenlabs_api_key() -> str:
    return get_secret_value("elevenlabs_api_key")
