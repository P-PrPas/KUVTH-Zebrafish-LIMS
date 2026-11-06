from __future__ import annotations

import re
from typing import Any

from .errors import APIError


def validated_email(value: Any) -> str:
    if not isinstance(value, str):
        raise APIError(400, "invalid_email", "Enter a valid email address")
    email = value.strip().lower()
    if len(email) > 254 or not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", email):
        raise APIError(400, "invalid_email", "Enter a valid email address")
    local = email.partition("@")[0]
    if not local or local.startswith(".") or local.endswith(".") or ".." in local:
        raise APIError(400, "invalid_email", "Enter a valid email address")
    return email
