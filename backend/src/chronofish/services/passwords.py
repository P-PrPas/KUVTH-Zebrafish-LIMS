import hashlib
import hmac
import secrets
import threading

from ..runtime.errors import APIError

ITERATIONS = 600_000
PASSWORD_WORK = threading.BoundedSemaphore(2)


def _derive(password: str, salt: bytes, iterations: int) -> str:
    if not PASSWORD_WORK.acquire(blocking=False):
        raise APIError(503, "authentication_busy", "Sign-in is busy. Try again shortly")
    try:
        return hashlib.pbkdf2_hmac("sha256", password.encode(), salt, iterations).hex()
    finally:
        PASSWORD_WORK.release()


def validate_password(value: object) -> str:
    if not isinstance(value, str) or not 8 <= len(value) <= 128:
        raise APIError(400, "invalid_password", "Use at least 8 characters")
    return value


def hash_password(password: str) -> str:
    salt = secrets.token_hex(16)
    digest = _derive(password, bytes.fromhex(salt), ITERATIONS)
    return f"pbkdf2_sha256${ITERATIONS}${salt}${digest}"


def check_password(password: str, encoded: str | None) -> bool:
    # Spend the same work on accounts without credentials to avoid an email timing oracle.
    fallback = f"pbkdf2_sha256${ITERATIONS}${'00' * 16}${'00' * 32}"
    algorithm, iterations, salt, expected = (encoded or fallback).split("$")
    digest = _derive(password, bytes.fromhex(salt), int(iterations))
    return algorithm == "pbkdf2_sha256" and hmac.compare_digest(digest, expected) and encoded is not None
