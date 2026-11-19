from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest

from chronofish.domain import signin as policy
from chronofish.runtime.errors import APIError

NOW = datetime(2026, 1, 1, 12, 0, tzinfo=UTC)


def challenge(**overrides):
    base = {
        "code_hash": "abc",
        "expires_at": NOW + timedelta(minutes=5),
        "attempts": 0,
        "last_sent_at": NOW - timedelta(minutes=5),
        "window_started_at": NOW - timedelta(minutes=5),
        "send_count": 1,
        "failed_count": 0,
        "failed_window_started_at": NOW - timedelta(minutes=5),
        "locked_until": None,
    }
    return base | overrides


def expired(**overrides):
    return challenge(expires_at=NOW - timedelta(seconds=1), **overrides)


def error_code(call):
    with pytest.raises(APIError) as caught:
        call()
    return caught.value.code


def test_first_code_opens_a_window():
    fields = policy.plan_code_issue(None, "d", NOW)
    assert fields == {
        "code_hash": "d",
        "expires_at": NOW + policy.OTP_TTL,
        "attempts": 0,
        "last_sent_at": NOW,
        "window_started_at": NOW,
        "send_count": 1,
    }


def test_cooldown_boundary():
    last = NOW - policy.OTP_COOLDOWN + timedelta(seconds=1)
    assert error_code(lambda: policy.plan_code_issue(expired(last_sent_at=last), "d", NOW)) == "otp_cooldown"
    assert policy.plan_code_issue(expired(last_sent_at=NOW - policy.OTP_COOLDOWN), "d", NOW)


def test_usable_code_is_kept_but_expired_or_exhausted_codes_are_replaced():
    assert policy.plan_code_issue(challenge(), "d", NOW) is None
    assert policy.plan_code_issue(expired(), "d", NOW)
    assert policy.plan_code_issue(challenge(attempts=policy.OTP_MAX_ATTEMPTS), "d", NOW)
    assert policy.plan_code_issue(challenge(attempts=policy.OTP_MAX_ATTEMPTS - 1), "d", NOW) is None
    assert policy.plan_code_issue(challenge(code_hash=""), "d", NOW)


def test_max_sends_per_window_and_window_reset():
    start = NOW - policy.OTP_WINDOW + timedelta(seconds=1)
    full = expired(send_count=policy.OTP_MAX_SENDS, window_started_at=start)
    assert error_code(lambda: policy.plan_code_issue(full, "d", NOW)) == "otp_rate_limited"
    below = expired(send_count=policy.OTP_MAX_SENDS - 1, window_started_at=start)
    assert policy.plan_code_issue(below, "d", NOW)["send_count"] == policy.OTP_MAX_SENDS
    reset = policy.plan_code_issue(full | {"window_started_at": NOW - policy.OTP_WINDOW}, "d", NOW)
    assert reset["send_count"] == 1
    assert reset["window_started_at"] == NOW


def test_locked_challenge_refuses_new_codes_until_lock_expires():
    assert policy.plan_code_issue(expired(locked_until=NOW + timedelta(seconds=1)), "d", NOW) is None
    assert policy.plan_code_issue(expired(locked_until=NOW), "d", NOW)


def test_lock_is_derived_from_failed_count_for_legacy_rows():
    started = NOW - policy.OTP_DAILY_WINDOW + timedelta(seconds=1)
    legacy = challenge(failed_count=policy.OTP_DAILY_MAX_FAILURES, failed_window_started_at=started)
    assert policy.locked_until(legacy, NOW) == started + policy.OTP_DAILY_WINDOW
    assert policy.locked_until(legacy | {"failed_window_started_at": NOW - policy.OTP_DAILY_WINDOW}, NOW) is None
    assert policy.locked_until(legacy | {"failed_count": policy.OTP_DAILY_MAX_FAILURES - 1}, NOW) is None
    assert policy.locked_until(None, NOW) is None


def check(row=None, recorded=(), digest="abc", now=NOW, has_password=True):
    return policy.check_code(row or challenge(), list(recorded), digest, now, has_password=has_password)


def test_correct_code_is_consumed_and_clears_failures():
    result = check(challenge(attempts=3, failed_count=4))
    assert result.status == "accepted"
    assert result.challenge == {
        "code_hash": "",
        "expires_at": NOW,
        "attempts": 0,
        "failed_count": 0,
        "locked_until": None,
        "failed_window_started_at": NOW,
    }


def test_correct_code_requires_a_password_but_wrong_code_does_not_reveal_it():
    assert error_code(lambda: check(has_password=False)) == "password_required"
    assert check(digest="nope", has_password=False).status == "wrong"


def test_unusable_codes_are_rejected_without_recording_a_failure():
    assert check(expired(), digest="nope").status == "rejected"
    assert check(challenge(attempts=policy.OTP_MAX_ATTEMPTS), digest="nope").status == "rejected"
    assert check(challenge(code_hash=""), digest="").status == "rejected"
    assert check(challenge(locked_until=NOW + timedelta(seconds=1))).status == "rejected"


def test_per_code_attempt_limit():
    row = challenge(attempts=policy.OTP_MAX_ATTEMPTS - 1)
    wrong = check(row, digest="nope")
    assert wrong.status == "wrong"
    assert wrong.challenge["attempts"] == policy.OTP_MAX_ATTEMPTS
    assert check(row | wrong.challenge, digest="abc").status == "rejected"


def test_wrong_code_records_failure_and_window_start():
    first = NOW - timedelta(hours=2)
    result = check(recorded=[first], digest="nope")
    assert result.failures == [first, NOW]
    assert result.challenge["failed_count"] == 2
    assert result.challenge["failed_window_started_at"] == first
    assert result.challenge["locked_until"] is None
    assert not result.lock_reached


def test_lock_is_reached_exactly_on_the_fifteenth_failure():
    earlier = [NOW - timedelta(minutes=i + 1) for i in range(policy.OTP_DAILY_MAX_FAILURES - 2)]
    before = check(recorded=earlier, digest="nope")
    assert len(before.failures) == policy.OTP_DAILY_MAX_FAILURES - 1
    assert not before.lock_reached
    reached = check(recorded=[*earlier, NOW - timedelta(seconds=1)], digest="nope")
    assert reached.lock_reached
    assert reached.challenge["locked_until"] == NOW + policy.OTP_DAILY_WINDOW
    assert policy.locked_until(challenge() | reached.challenge, NOW)


def test_failures_age_out_after_exactly_one_day():
    boundary = NOW - policy.OTP_DAILY_WINDOW
    assert policy.recent_failures(challenge(), [boundary], NOW) == []
    inside = boundary + timedelta(seconds=1)
    assert policy.recent_failures(challenge(), [inside], NOW) == [inside]


def test_legacy_failure_counter_is_expanded_into_timestamps():
    started = NOW - timedelta(hours=1)
    legacy = challenge(failed_count=3, failed_window_started_at=started)
    assert policy.recent_failures(legacy, [], NOW) == [started] * 3
    capped = challenge(failed_count=99, failed_window_started_at=started)
    assert len(policy.recent_failures(capped, [], NOW)) == policy.OTP_DAILY_MAX_FAILURES
    assert policy.recent_failures(legacy, [NOW], NOW) == [NOW]


def test_lock_expires_after_one_day_and_correct_code_works_again():
    row = challenge(locked_until=NOW)
    assert policy.locked_until(row, NOW) is None
    assert check(row).status == "accepted"


def guest(**overrides):
    return {"active": True, "verified_at": NOW, "password_attempts": 0, "password_locked_until": None} | overrides


def test_password_login_eligibility():
    assert policy.may_password_login(guest(), NOW)
    assert not policy.may_password_login(None, NOW)
    assert not policy.may_password_login(guest(active=False), NOW)
    assert not policy.may_password_login(guest(verified_at=None), NOW)
    assert not policy.may_password_login(guest(password_locked_until=NOW + timedelta(seconds=1)), NOW)
    assert policy.may_password_login(guest(password_locked_until=NOW), NOW)


def test_password_lockout_after_five_failures_for_fifteen_minutes():
    four = policy.password_lockout(guest(password_attempts=3), False, NOW)
    assert four == {"password_attempts": 4, "password_locked_until": None}
    five = policy.password_lockout(guest(password_attempts=4), False, NOW)
    assert five == {"password_attempts": 5, "password_locked_until": NOW + timedelta(minutes=15)}


def test_password_success_resets_counter_and_locked_account_is_untouched():
    assert policy.password_lockout(guest(password_attempts=4), True, NOW) == {
        "password_attempts": 0,
        "password_locked_until": None,
    }
    assert policy.password_lockout(guest(password_locked_until=NOW + timedelta(seconds=1)), False, NOW) is None


def test_expired_password_lock_restarts_the_count():
    expired_lock = guest(password_attempts=5, password_locked_until=NOW)
    assert policy.password_lockout(expired_lock, False, NOW) == {"password_attempts": 1, "password_locked_until": None}
    assert policy.password_lockout(expired_lock, True, NOW)["password_attempts"] == 0
    assert policy.password_lockout({"password_attempts": None}, False, NOW)["password_attempts"] == 1


def test_session_idle_and_absolute_expiry_boundaries():
    far = NOW + policy.ABSOLUTE_TTL
    assert not policy.session_expired(NOW - policy.IDLE_TTL + timedelta(seconds=1), far, NOW)
    assert policy.session_expired(NOW - policy.IDLE_TTL, far, NOW)
    assert not policy.session_expired(NOW, NOW + timedelta(seconds=1), NOW)
    assert policy.session_expired(NOW, NOW, NOW)


def test_session_touch_interval_boundary():
    assert not policy.session_needs_touch(NOW - policy.SESSION_TOUCH_INTERVAL + timedelta(seconds=1), NOW)
    assert policy.session_needs_touch(NOW - policy.SESSION_TOUCH_INTERVAL, NOW)


def test_naive_datetimes_are_treated_as_utc():
    naive = NOW.replace(tzinfo=None)
    assert policy.session_expired(naive - policy.IDLE_TTL, NOW + policy.ABSOLUTE_TTL, NOW)
    assert policy.as_utc(naive) == NOW
