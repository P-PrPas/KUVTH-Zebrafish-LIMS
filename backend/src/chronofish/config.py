from __future__ import annotations

import ipaddress
import os
import re
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True, slots=True)
class Config:
    port: int
    app_env: str
    db_driver: str
    database_url: str
    allowed_origins: tuple[str, ...]
    ip_allowlist: tuple[ipaddress.IPv4Network | ipaddress.IPv6Network, ...]
    migrations_dir: Path
    db_pool_size: int
    db_max_overflow: int
    bootstrap_admin_email: str = ""
    auth_secret: str = "development-only-change-me"
    session_cookie_secure: bool = True
    app_base_url: str = "http://localhost:5173"
    mail_smtp_host: str = ""
    mail_smtp_port: int = 587
    mail_smtp_username: str = ""
    mail_smtp_password: str = ""
    mail_sender_email: str = ""
    mail_use_ssl: bool = False
    mail_use_starttls: bool = True


def _integer(name: str, default: int, minimum: int = 0) -> int:
    try:
        value = int(os.getenv(name, str(default)))
    except ValueError as error:
        raise ValueError(f"{name} must be an integer") from error
    if value < minimum:
        raise ValueError(f"{name} must be at least {minimum}")
    return value


def _networks(value: str) -> tuple[ipaddress.IPv4Network | ipaddress.IPv6Network, ...]:
    result = []
    for raw in filter(None, (item.strip() for item in value.split(","))):
        try:
            result.append(ipaddress.ip_network(raw if "/" in raw else f"{raw}/32", strict=False))
        except ValueError as error:
            raise ValueError(f"IP_ALLOWLIST contains invalid address {raw!r}") from error
    return tuple(result)


def load_config() -> Config:
    app_env = os.getenv("APP_ENV", "production").strip().lower()
    default_driver = "memory" if app_env in {"dev", "development", "test"} else "postgres"
    driver = os.getenv("DB_DRIVER", default_driver).strip().lower()
    if driver not in {"memory", "postgres", "mysql"}:
        raise ValueError("DB_DRIVER must be memory, postgres, or mysql")
    if driver == "memory" and app_env not in {"dev", "development", "test"}:
        raise ValueError("DB_DRIVER=memory is only allowed for development or test")
    auth_secret = os.getenv("AUTH_SECRET", "").strip()
    if not auth_secret and app_env not in {"dev", "development", "test"}:
        raise ValueError("AUTH_SECRET is required outside development and test")
    if auth_secret and len(auth_secret) < 32 and app_env not in {"dev", "development", "test"}:
        raise ValueError("AUTH_SECRET must be at least 32 characters outside development and test")
    bootstrap_email = os.getenv("BOOTSTRAP_ADMIN_EMAIL", "").strip().lower()
    sender_email = os.getenv("MAIL_SENDER_EMAIL", "").strip().lower()
    if app_env not in {"dev", "development", "test"}:
        if not bootstrap_email:
            raise ValueError("BOOTSTRAP_ADMIN_EMAIL is required outside development and test")
        if not sender_email:
            raise ValueError("MAIL_SENDER_EMAIL is required outside development and test")
    if bootstrap_email:
        local_part = bootstrap_email.partition("@")[0]
        if (
            len(bootstrap_email) > 254
            or not re.fullmatch(r"[^\s@]+@ku\.th", bootstrap_email)
            or local_part.startswith(".")
            or local_part.endswith(".")
            or ".." in local_part
        ):
            raise ValueError("BOOTSTRAP_ADMIN_EMAIL must be a valid @ku.th address")
    if sender_email and not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", sender_email):
        raise ValueError("MAIL_SENDER_EMAIL must be a valid email address")
    mail_use_ssl = os.getenv("MAIL_USE_SSL", "false").strip().lower() in {"1", "true", "yes"}
    mail_use_starttls = os.getenv("MAIL_USE_STARTTLS", "true").strip().lower() in {"1", "true", "yes"}
    if app_env not in {"dev", "development", "test"} and not (mail_use_ssl or mail_use_starttls):
        raise ValueError("SMTP TLS is required outside development and test")
    database_url = os.getenv("DATABASE_URL", "").strip()
    if driver != "memory" and not database_url:
        raise ValueError("DATABASE_URL is required when DB_DRIVER is not memory")
    migrations_default = Path(__file__).resolve().parents[2] / "db" / "migrations" / driver
    return Config(
        port=_integer("PORT", 8080, 1),
        app_env=app_env,
        db_driver=driver,
        database_url=database_url,
        allowed_origins=tuple(
            filter(None, (item.strip() for item in os.getenv("CORS_ALLOWED_ORIGINS", "").split(",")))
        ),
        ip_allowlist=_networks(os.getenv("IP_ALLOWLIST", "")),
        migrations_dir=Path(os.getenv("MIGRATIONS_DIR", migrations_default)),
        db_pool_size=_integer("DB_POOL_SIZE", 10, 1),
        db_max_overflow=_integer("DB_MAX_OVERFLOW", 5),
        bootstrap_admin_email=bootstrap_email,
        auth_secret=auth_secret or "development-only-change-me",
        session_cookie_secure=os.getenv("SESSION_COOKIE_SECURE", "true").strip().lower() not in {"0", "false", "no"},
        app_base_url=os.getenv("APP_BASE_URL", "http://localhost:5173").strip().rstrip("/"),
        mail_smtp_host=os.getenv("MAIL_SMTP_HOST", "").strip(),
        mail_smtp_port=_integer("MAIL_SMTP_PORT", 587, 1),
        mail_smtp_username=os.getenv("MAIL_SMTP_USERNAME", "").strip(),
        mail_smtp_password=os.getenv("MAIL_SMTP_PASSWORD", ""),
        mail_sender_email=sender_email,
        mail_use_ssl=mail_use_ssl,
        mail_use_starttls=mail_use_starttls,
    )
