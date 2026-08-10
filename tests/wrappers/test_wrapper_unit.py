"""Unit tests for ralph-acp (generic ACP transport) internals.

These import the wrapper module directly (via the `wrapper_mod` fixture) to
exercise functions that subprocess tests can't reach — argument parsing,
notification routing, the heartbeat/throttle logic, and error fallbacks. This
is what gives us real line coverage on the wrapper.
"""
import io
import json
import os
import threading
import time

import pytest


# ─────────────────────────────────────────────────────────────────────────────
# parse_args
# ─────────────────────────────────────────────────────────────────────────────
def test_parse_args_basic(wrapper_mod):
    prompt, model, extra, binary_extra = wrapper_mod.parse_args(["hello", "world"])
    assert prompt == "hello world"
    assert model == ""
    assert extra == []
    assert binary_extra == []


def test_parse_args_model_and_extra(wrapper_mod):
    prompt, model, extra, binary_extra = wrapper_mod.parse_args(
        ["--model", "gpt-x", "do", "it", "--", "--flag", "val"]
    )
    assert prompt == "do it"
    assert model == "gpt-x"
    assert extra == ["--flag", "val"]
    assert binary_extra == []


def test_parse_args_full_auto_accepted(wrapper_mod):
    prompt, model, extra, binary_extra = wrapper_mod.parse_args(["--full-auto", "run"])
    assert prompt == "run"
    assert model == ""
    # --full-auto maps to --yolo which the binary accepts
    assert extra == ["--yolo"]
    assert binary_extra == ["--yolo"]


def test_parse_args_model_requires_value(wrapper_mod):
    with pytest.raises(SystemExit):
        wrapper_mod.parse_args(["--model"])


def test_parse_args_profile_passthrough(wrapper_mod):
    """-p <profile> after -- should be extracted into binary_extra."""
    prompt, model, extra, binary_extra = wrapper_mod.parse_args(
        ["do", "it", "--", "-p", "h-user-assist"]
    )
    assert prompt == "do it"
    assert extra == ["-p", "h-user-assist"]
    assert binary_extra == ["-p", "h-user-assist"]


def test_parse_args_profile_equals_passthrough(wrapper_mod):
    """--profile=<name> after -- should be extracted into binary_extra."""
    prompt, model, extra, binary_extra = wrapper_mod.parse_args(
        ["do", "it", "--", "--profile=h-user-assist"]
    )
    assert prompt == "do it"
    assert binary_extra == ["--profile=h-user-assist"]


# ─────────────────────────────────────────────────────────────────────────────
# _tool_name_from_title
# ─────────────────────────────────────────────────────────────────────────────
def test_tool_name_from_title_with_colon(wrapper_mod):
    assert wrapper_mod._tool_name_from_title("terminal: echo hi") == "terminal"


def test_tool_name_from_title_no_colon(wrapper_mod):
    assert wrapper_mod._tool_name_from_title("read") == "read"


def test_tool_name_from_title_empty(wrapper_mod):
    assert wrapper_mod._tool_name_from_title("") == "unknown"


# ─────────────────────────────────────────────────────────────────────────────
# _env_float
# ─────────────────────────────────────────────────────────────────────────────
def test_env_float_default(wrapper_mod, monkeypatch):
    # Clear BOTH canonical and legacy so the fallback path can't falsify
    # the default assertion.
    monkeypatch.delenv("RALPH_ACP_HEARTBEAT_SILENCE", raising=False)
    monkeypatch.delenv("RALPH_HERMES_ACP_HEARTBEAT_SILENCE", raising=False)
    assert wrapper_mod._env_float("RALPH_ACP_HEARTBEAT_SILENCE", 30.0) == 30.0


def test_env_float_parsed(wrapper_mod, monkeypatch):
    monkeypatch.setenv("RALPH_ACP_HEARTBEAT_SILENCE", "0.5")
    assert wrapper_mod._env_float("RALPH_ACP_HEARTBEAT_SILENCE", 30.0) == 0.5


def test_env_float_garbage_falls_back(wrapper_mod, monkeypatch):
    monkeypatch.setenv("RALPH_ACP_HEARTBEAT_SILENCE", "not-a-number")
    assert wrapper_mod._env_float("RALPH_ACP_HEARTBEAT_SILENCE", 30.0) == 30.0


# ─────────────────────────────────────────────────────────────────────────────
# ActivityTracker
# ─────────────────────────────────────────────────────────────────────────────
def test_activity_tracker_touch_resets(wrapper_mod):
    t = wrapper_mod.ActivityTracker(silence_threshold=0.0, interval=0.01)
    t.touch()
    assert t.seconds_since() < 0.5
    time.sleep(0.05)
    assert t.seconds_since() >= 0.05


# ─────────────────────────────────────────────────────────────────────────────
# _heartbeat_loop emits on silence, stops on flag, resets after emit
# ─────────────────────────────────────────────────────────────────────────────
def test_heartbeat_loop_emits_on_silence(wrapper_mod, capsys):
    beats = []

    real_emit = wrapper_mod._emit_stderr

    def fake_emit(text):
        beats.append(text)
        real_emit(text)

    wrapper_mod._emit_stderr = fake_emit
    try:
        t = wrapper_mod.ActivityTracker(silence_threshold=0.05, interval=0.02)
        stop = {"stop": False}
        th = threading.Thread(target=wrapper_mod._heartbeat_loop, args=(stop, t), daemon=True)
        th.start()
        time.sleep(0.2)
        stop["stop"] = True
        th.join(timeout=1)
    finally:
        wrapper_mod._emit_stderr = real_emit
    assert len(beats) >= 1, f"expected heartbeat, got {beats}"


def test_heartbeat_loop_resets_after_emit(wrapper_mod):
    """After emitting once, the tracker should be reset so the NEXT heartbeat
    waits a full silence-threshold window (not fire continuously)."""
    beats = []
    real_emit = wrapper_mod._emit_stderr
    wrapper_mod._emit_stderr = beats.append
    try:
        t = wrapper_mod.ActivityTracker(silence_threshold=0.1, interval=0.02)
        stop = {"stop": False}
        th = threading.Thread(target=wrapper_mod._heartbeat_loop, args=(stop, t), daemon=True)
        th.start()
        time.sleep(0.5)
        stop["stop"] = True
        th.join(timeout=1)
    finally:
        wrapper_mod._emit_stderr = real_emit
    # With 0.1s silence threshold over 0.5s, we expect roughly 4-6 beats, NOT 25.
    assert 2 <= len(beats) <= 8, f"expected ~5 beats (reset cadence), got {len(beats)}: {beats}"


def test_heartbeat_loop_stops_immediately_when_flag_set(wrapper_mod):
    beats = []
    real_emit = wrapper_mod._emit_stderr
    wrapper_mod._emit_stderr = beats.append
    # Pre-set the flag so the loop never sleeps-and-emits.
    stop = {"stop": True}
    try:
        t = wrapper_mod.ActivityTracker(silence_threshold=0.0, interval=0.01)
        th = threading.Thread(target=wrapper_mod._heartbeat_loop, args=(stop, t), daemon=True)
        th.start()
        th.join(timeout=1)
    finally:
        wrapper_mod._emit_stderr = real_emit
    assert beats == []


# ─────────────────────────────────────────────────────────────────────────────
# _process_notification routing (thought suppression + activity touches)
# ─────────────────────────────────────────────────────────────────────────────
def _notif(su, **fields):
    return {"jsonrpc": "2.0", "method": "session/update",
            "params": {"sessionId": "s", "update": {"sessionUpdate": su, **fields}}}


def test_process_notification_message_to_stdout(wrapper_mod, capsys, monkeypatch):
    wrapper_mod._reset_activity()
    t = wrapper_mod.ActivityTracker(silence_threshold=10, interval=1)
    monkeypatch.setattr(wrapper_mod, "_ACTIVITY", t)
    pre = t.seconds_since()
    time.sleep(0.05)
    # Prove silence has grown before the notification arrives
    assert t.seconds_since() >= 0.04
    ret = wrapper_mod._process_notification(
        _notif("agent_message_chunk", content={"type": "text", "text": "hi\n"})
    )
    captured = capsys.readouterr()
    assert ret is None
    assert captured.out == "hi\n"
    # Activity touched: seconds_since reset to near-zero (touch happened)
    assert t.seconds_since() < 0.03


def test_process_notification_thought_suppressed(wrapper_mod, capsys, monkeypatch):
    """agent_thought_chunk must NOT emit to stderr (flood fix)."""
    wrapper_mod._reset_activity()
    t = wrapper_mod.ActivityTracker(silence_threshold=10, interval=1)
    monkeypatch.setattr(wrapper_mod, "_ACTIVITY", t)
    ret = wrapper_mod._process_notification(
        _notif("agent_thought_chunk", content={"type": "text", "text": "thinking..."})
    )
    captured = capsys.readouterr()
    assert ret is None
    assert captured.out == ""
    assert captured.err == ""
    # Still touched the tracker so heartbeat doesn't fire mid-thought-stream.
    assert t.seconds_since() < 0.5


def test_process_notification_tool_call(wrapper_mod, capsys, monkeypatch):
    wrapper_mod._reset_activity()
    t = wrapper_mod.ActivityTracker(silence_threshold=10, interval=1)
    monkeypatch.setattr(wrapper_mod, "_ACTIVITY", t)
    ret = wrapper_mod._process_notification(
        _notif("tool_call", toolCallId="tc1", title="terminal: ls", kind="execute",
               content=[], locations=[])
    )
    captured = capsys.readouterr()
    assert ret is None
    assert "Tool: terminal" in captured.err


def test_process_notification_tool_call_update_with_status(wrapper_mod, capsys, monkeypatch):
    wrapper_mod._reset_activity()
    t = wrapper_mod.ActivityTracker(silence_threshold=10, interval=1)
    monkeypatch.setattr(wrapper_mod, "_ACTIVITY", t)
    ret = wrapper_mod._process_notification(
        _notif("tool_call_update", toolCallId="tc1", status="completed", content=[])
    )
    captured = capsys.readouterr()
    assert ret is None
    assert "[tool tc1] completed" in captured.err


def test_process_notification_tool_call_update_no_status(wrapper_mod, capsys, monkeypatch):
    wrapper_mod._reset_activity()
    t = wrapper_mod.ActivityTracker(silence_threshold=10, interval=1)
    monkeypatch.setattr(wrapper_mod, "_ACTIVITY", t)
    ret = wrapper_mod._process_notification(
        _notif("tool_call_update", toolCallId="tc1")
    )
    captured = capsys.readouterr()
    assert ret is None
    assert captured.err == ""


def test_process_notification_unknown_update_ignored(wrapper_mod, capsys, monkeypatch):
    wrapper_mod._reset_activity()
    t = wrapper_mod.ActivityTracker(silence_threshold=10, interval=1)
    monkeypatch.setattr(wrapper_mod, "_ACTIVITY", t)
    ret = wrapper_mod._process_notification(_notif("usage_update", size=1, used=0))
    captured = capsys.readouterr()
    assert ret is None
    assert captured.out == ""
    assert captured.err == ""


def test_process_notification_message_empty_text_no_emit(wrapper_mod, capsys, monkeypatch):
    wrapper_mod._reset_activity()
    monkeypatch.setattr(wrapper_mod, "_ACTIVITY", None)
    ret = wrapper_mod._process_notification(
        _notif("agent_message_chunk", content={"type": "text", "text": ""})
    )
    assert ret is None
    assert capsys.readouterr().out == ""


# ─────────────────────────────────────────────────────────────────────────────
# run() error paths
# ─────────────────────────────────────────────────────────────────────────────
def test_run_no_prompt_returns_2(wrapper_mod, capsys):
    rc = wrapper_mod.run("", "", [], "hermes acp")
    assert rc == 2
    assert "no prompt" in capsys.readouterr().err


def test_run_binary_not_found(wrapper_mod, monkeypatch, capsys):
    # A binary that doesn't exist → Popen raises FileNotFoundError (shell=False
    # path). We force shell=False by patching Popen to raise directly.
    import subprocess

    def fake_popen(*a, **kw):
        raise FileNotFoundError("nope")

    monkeypatch.setattr(subprocess, "Popen", fake_popen)
    rc = wrapper_mod.run("hi", "", [], "nonexistent-binary-xyz")
    assert rc == 127
    assert "failed to spawn" in capsys.readouterr().err


# ─────────────────────────────────────────────────────────────────────────────
# main() arg wiring
# ─────────────────────────────────────────────────────────────────────────────
def test_main_no_args_returns_2(wrapper_mod, monkeypatch, capsys):
    monkeypatch.setattr("sys.argv", ["ralph-acp"])
    rc = wrapper_mod.main()
    assert rc == 2


def test_main_uses_env_binary(wrapper_mod, monkeypatch, tmp_path):
    """main() should honor RALPH_ACP_BINARY and reach run()."""
    monkeypatch.setattr("sys.argv", ["ralph-acp", "hi"])
    monkeypatch.setenv("RALPH_ACP_BINARY", "echo")
    # `echo` is not a JSON-RPC server — the wrapper should fail fast on
    # initialize timeout and return non-zero (1), NOT crash.
    rc = wrapper_mod.main()
    assert rc == 1


# ─────────────────────────────────────────────────────────────────────────────
# Configurable initialize/session timeouts (RED — constants/functions absent)
#
# Root cause: hermes acp -p <profile> loads MCP servers during startup; failed
# connections retry with exponential backoff (1+2+4=7s each), pushing init past
# the wrapper's HARDCODED 30s initialize timeout. Fix: make timeouts env-driven
# with defaults that tolerate profile/MCP loading (init=120s, session=60s).
# ─────────────────────────────────────────────────────────────────────────────
def test_default_init_timeout_constant_exists(wrapper_mod):
    """DEFAULT_INIT_TIMEOUT module constant must exist and be >= 120s.

    30s was too short for profile-driven MCP loading; 120s gives headroom for
    ~15 failing MCP servers (7s backoff each) plus normal init overhead.
    """
    assert hasattr(wrapper_mod, "DEFAULT_INIT_TIMEOUT"), (
        "DEFAULT_INIT_TIMEOUT constant missing — needed for configurable init timeout"
    )
    assert wrapper_mod.DEFAULT_INIT_TIMEOUT >= 120.0, (
        f"DEFAULT_INIT_TIMEOUT={getattr(wrapper_mod, 'DEFAULT_INIT_TIMEOUT', 'MISSING')!r} "
        "must be >= 120s to survive profile MCP-server loading"
    )


def test_default_session_timeout_constant_exists(wrapper_mod):
    """DEFAULT_SESSION_TIMEOUT module constant must exist and be >= 60s."""
    assert hasattr(wrapper_mod, "DEFAULT_SESSION_TIMEOUT"), (
        "DEFAULT_SESSION_TIMEOUT constant missing — needed for configurable session/new timeout"
    )
    assert wrapper_mod.DEFAULT_SESSION_TIMEOUT >= 60.0, (
        f"DEFAULT_SESSION_TIMEOUT={getattr(wrapper_mod, 'DEFAULT_SESSION_TIMEOUT', 'MISSING')!r} "
        "must be >= 60s"
    )


def test_resolve_init_timeout_exists(wrapper_mod):
    """_resolve_init_timeout helper must exist."""
    assert hasattr(wrapper_mod, "_resolve_init_timeout"), (
        "_resolve_init_timeout() missing — wrapper needs this to read RALPH_ACP_INIT_TIMEOUT"
    )


def test_resolve_init_timeout_from_canonical_env(wrapper_mod):
    """RALPH_ACP_INIT_TIMEOUT=180 → 180.0."""
    val = wrapper_mod._resolve_init_timeout({"RALPH_ACP_INIT_TIMEOUT": "180"})
    assert val == 180.0, f"expected 180.0, got {val!r}"


def test_resolve_init_timeout_from_legacy_env(wrapper_mod):
    """RALPH_HERMES_ACP_INIT_TIMEOUT=200 (deprecated) → 200.0 (backward compat)."""
    val = wrapper_mod._resolve_init_timeout({"RALPH_HERMES_ACP_INIT_TIMEOUT": "200"})
    assert val == 200.0, f"legacy env should still work, got {val!r}"


def test_resolve_init_timeout_canonical_wins_over_legacy(wrapper_mod):
    """When both envs set, canonical RALPH_ACP_* wins."""
    env = {"RALPH_ACP_INIT_TIMEOUT": "150", "RALPH_HERMES_ACP_INIT_TIMEOUT": "200"}
    val = wrapper_mod._resolve_init_timeout(env)
    assert val == 150.0, f"canonical should win, got {val!r}"


def test_resolve_init_timeout_default_when_unset(wrapper_mod):
    """No env set → DEFAULT_INIT_TIMEOUT (>=120s)."""
    val = wrapper_mod._resolve_init_timeout({})
    assert val == wrapper_mod.DEFAULT_INIT_TIMEOUT, (
        f"expected default {wrapper_mod.DEFAULT_INIT_TIMEOUT}, got {val!r}"
    )


def test_resolve_init_timeout_garbage_falls_back(wrapper_mod):
    """Non-numeric env → default (fail-soft, never crash the loop)."""
    val = wrapper_mod._resolve_init_timeout({"RALPH_ACP_INIT_TIMEOUT": "garbage"})
    assert val == wrapper_mod.DEFAULT_INIT_TIMEOUT


def test_resolve_session_timeout_exists(wrapper_mod):
    """_resolve_session_timeout helper must exist."""
    assert hasattr(wrapper_mod, "_resolve_session_timeout"), (
        "_resolve_session_timeout() missing — wrapper needs this for session/new + auth"
    )


def test_resolve_session_timeout_from_env(wrapper_mod):
    val = wrapper_mod._resolve_session_timeout({"RALPH_ACP_SESSION_TIMEOUT": "90"})
    assert val == 90.0


def test_resolve_session_timeout_legacy_env(wrapper_mod):
    val = wrapper_mod._resolve_session_timeout({"RALPH_HERMES_ACP_SESSION_TIMEOUT": "80"})
    assert val == 80.0


def test_resolve_session_timeout_default(wrapper_mod):
    val = wrapper_mod._resolve_session_timeout({})
    assert val == wrapper_mod.DEFAULT_SESSION_TIMEOUT


def test_resolve_session_timeout_garbage_falls_back(wrapper_mod):
    val = wrapper_mod._resolve_session_timeout({"RALPH_ACP_SESSION_TIMEOUT": "abc"})
    assert val == wrapper_mod.DEFAULT_SESSION_TIMEOUT
