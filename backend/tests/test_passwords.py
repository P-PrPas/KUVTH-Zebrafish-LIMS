from concurrent.futures import ThreadPoolExecutor
from threading import Barrier, Event

import pytest

from chronofish.runtime.errors import APIError
from chronofish.services import passwords


def test_password_hash_work_is_bounded_and_releases_capacity(monkeypatch):
    entered = Barrier(3)
    release = Event()

    def derive(*args):
        entered.wait(timeout=5)
        assert release.wait(timeout=5)
        return b"\0" * 32

    monkeypatch.setattr(passwords.hashlib, "pbkdf2_hmac", derive)
    with ThreadPoolExecutor(max_workers=2) as pool:
        pending = [pool.submit(passwords.check_password, "fake password", None) for _ in range(2)]
        try:
            entered.wait(timeout=5)
            with pytest.raises(APIError) as error:
                passwords.hash_password("fake password")
            assert error.value.status == 503
        finally:
            release.set()
        assert [future.result() for future in pending] == [False, False]
    monkeypatch.setattr(passwords.hashlib, "pbkdf2_hmac", lambda *args: b"\0" * 32)
    assert passwords.hash_password("fake password").startswith("pbkdf2_sha256$")


def test_password_hash_failure_releases_capacity(monkeypatch):
    def fail(*args):
        raise OSError("hash failed")

    monkeypatch.setattr(passwords.hashlib, "pbkdf2_hmac", fail)
    for _ in range(3):
        with pytest.raises(OSError, match="hash failed"):
            passwords.hash_password("fake password")
