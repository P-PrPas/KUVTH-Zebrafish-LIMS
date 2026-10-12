import hashlib
import hmac
import secrets

from ..runtime.errors import APIError

ITERATIONS = 600_000


def validate_password(value: object) -> str:
    if not isinstance(value, str) or not 8 <= len(value) <= 128:
        raise APIError(400, "invalid_password", "Use at least 8 characters")
    return value


def hash_password(password: str) -> str:
    salt = secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), bytes.fromhex(salt), ITERATIONS).hex()
    return f"pbkdf2_sha256${ITERATIONS}${salt}${digest}"


def check_password(password: str, encoded: str | None) -> bool:
    # Spend the same work on accounts without credentials to avoid an email timing oracle.
    fallback = f"pbkdf2_sha256${ITERATIONS}${'00' * 16}${'00' * 32}"
    algorithm, iterations, salt, expected = (encoded or fallback).split("$")
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), bytes.fromhex(salt), int(iterations)).hex()
    return algorithm == "pbkdf2_sha256" and hmac.compare_digest(digest, expected) and encoded is not None
