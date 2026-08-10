"""Failing-first tests for ralph-acp wrapper.

Run: cd /tmp/ralph-acp-tests && python3 -m pytest -xvs test_wrapper.py
"""
import json
import os
import signal
import subprocess
import sys
import time
from pathlib import Path

import pytest

TEST_DIR = Path(__file__).parent.resolve()
REPO_ROOT = TEST_DIR.parent.parent
# Generic ACP transport wrapper (was ralph-hermes-acp).
WRAPPER = REPO_ROOT / "scripts" / "wrappers" / "ralph-acp"
MOCK_SERVER = TEST_DIR / "mock_acp_server.py"


def _env(tmp_path, script_events=None):
    env = dict(os.environ)
    env["RALPH_HERMES_ACP_BINARY"] = f"{sys.executable} {MOCK_SERVER}"
    env["MOCK_LOG"] = str(tmp_path / "mock.log")
    env["MOCK_SCRIPT"] = str(tmp_path / "mock.script.json")
    events = list(script_events or [])
    with open(env["MOCK_SCRIPT"], "w") as f:
        json.dump(events, f)
    return env


def _run_wrapper(prompt, env, timeout=20):
    """Invoke the wrapper directly with a positional prompt."""
    return subprocess.run(
        [str(WRAPPER), prompt],
        env=env,
        capture_output=True,
        text=True,
        timeout=timeout,
    )


def _read_log(env):
    try:
        with open(env["MOCK_LOG"]) as f:
            return [json.loads(l) for l in f if l.strip()]
    except FileNotFoundError:
        return []


# ──────────────────────────────────────────────────────────────────────────────
# Test (a): text deltas arrive at stdout continuously (NOT buffered until end)
# ──────────────────────────────────────────────────────────────────────────────
def test_stdout_streaming_chunks_arrive_progressively(tmp_path):
    events = [
        {"type": "notification", "delay": 0.1, "update": {"sessionUpdate": "agent_message_chunk", "content": {"type": "text", "text": "Hello"}}},
        {"type": "notification", "delay": 0.5, "update": {"sessionUpdate": "agent_message_chunk", "content": {"type": "text", "text": " "}}},
        {"type": "notification", "delay": 0.5, "update": {"sessionUpdate": "agent_message_chunk", "content": {"type": "text", "text": "world\n"}}},
    ]
    env = _env(tmp_path, events)
    # Stream stdout char-by-char, recording timestamps
    proc = subprocess.Popen(
        [str(WRAPPER), "hi"], env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
    )
    chunks = []
    buf = ""
    while True:
        ch = proc.stdout.read(1)
        if ch == "" and proc.poll() is not None:
            break
        if ch == "":
            continue
        if ch == "\n":
            chunks.append((time.time(), buf))
            buf = ""
        else:
            buf += ch
    proc.wait(timeout=10)
    out_text = "".join(c[1] + "\n" for c in chunks)
    assert "Hello" in out_text, f"expected 'Hello' in stdout, got: {out_text!r}"
    assert "world" in out_text
    # Progressive: gap between first and last chunk should be > 0.3s
    if len(chunks) >= 2:
        gap = chunks[-1][0] - chunks[0][0]
        assert gap > 0.3, f"output appears buffered (gap={gap:.2f}s) — chunks: {chunks}"


# ──────────────────────────────────────────────────────────────────────────────
# Test (b): tool events arrive at stderr as `Tool: <name>`
# ──────────────────────────────────────────────────────────────────────────────
def test_tool_events_on_stderr(tmp_path):
    events = [
        {"type": "notification", "delay": 0.1, "update": {
            "sessionUpdate": "tool_call",
            "toolCallId": "tc-1",
            "title": "terminal: echo hello-world",
            "kind": "execute",
            "content": [{"type": "content", "content": {"text": "$ echo hello-world", "type": "text"}}],
            "locations": [],
        }},
        {"type": "notification", "delay": 0.1, "update": {
            "sessionUpdate": "tool_call_update",
            "toolCallId": "tc-1",
            "status": "completed",
            "kind": "execute",
            "content": [{"type": "content", "content": {"text": "output: hello-world", "type": "text"}}],
        }},
        {"type": "notification", "delay": 0.1, "update": {
            "sessionUpdate": "agent_message_chunk",
            "content": {"type": "text", "text": "done\n"},
        }},
    ]
    env = _env(tmp_path, events)
    result = _run_wrapper("run echo", env)
    assert result.returncode == 0, f"stderr: {result.stderr}"
    assert "Tool: terminal" in result.stderr, f"expected 'Tool: terminal' in stderr, got: {result.stderr!r}"


# ──────────────────────────────────────────────────────────────────────────────
# Test (c): exit code propagation — 0 on end_turn, non-zero on error
# ──────────────────────────────────────────────────────────────────────────────
def test_exit_code_zero_on_success(tmp_path):
    events = [
        {"type": "notification", "delay": 0.1, "update": {"sessionUpdate": "agent_message_chunk", "content": {"type": "text", "text": "ok\n"}}},
        {"type": "response", "delay": 0.1, "result": {"stopReason": "end_turn", "usage": {}}},
    ]
    env = _env(tmp_path, events)
    result = _run_wrapper("hi", env)
    assert result.returncode == 0, f"expected 0, got {result.returncode}; stderr={result.stderr}"


def test_exit_code_nonzero_on_error(tmp_path):
    events = [
        {"type": "response", "delay": 0.1, "result": {"stopReason": "error", "usage": {}}},
    ]
    env = _env(tmp_path, events)
    result = _run_wrapper("hi", env)
    assert result.returncode != 0, f"expected non-zero, got {result.returncode}; stdout={result.stdout}"


# ──────────────────────────────────────────────────────────────────────────────
# Test (d): <promise> passthrough unchanged (wrapper must NOT add/synthesize)
# ──────────────────────────────────────────────────────────────────────────────
def test_promise_passthrough_unchanged(tmp_path):
    events = [
        {"type": "notification", "delay": 0.1, "update": {"sessionUpdate": "agent_message_chunk", "content": {"type": "text", "text": "Done. <promise>COMPLETE</promise>\n"}}},
        {"type": "response", "delay": 0.1, "result": {"stopReason": "end_turn", "usage": {}}},
    ]
    env = _env(tmp_path, events)
    result = _run_wrapper("do it", env)
    assert "<promise>COMPLETE</promise>" in result.stdout, f"stdout: {result.stdout!r}"
    # Ensure wrapper didn't synthesize a SECOND promise
    assert result.stdout.count("<promise>") == 1, f"stdout has multiple promises: {result.stdout!r}"


def test_no_promise_no_synthesis(tmp_path):
    events = [
        {"type": "notification", "delay": 0.1, "update": {"sessionUpdate": "agent_message_chunk", "content": {"type": "text", "text": "no completion here\n"}}},
        {"type": "response", "delay": 0.1, "result": {"stopReason": "end_turn", "usage": {}}},
    ]
    env = _env(tmp_path, events)
    result = _run_wrapper("hi", env)
    assert "<promise>" not in result.stdout


# ──────────────────────────────────────────────────────────────────────────────
# Test (e): lifecycle sequence — initialize → (auth) → session/new → session/prompt
# ──────────────────────────────────────────────────────────────────────────────
def test_lifecycle_request_sequence(tmp_path):
    events = [
        {"type": "notification", "delay": 0.1, "update": {"sessionUpdate": "agent_message_chunk", "content": {"type": "text", "text": "x\n"}}},
        {"type": "response", "delay": 0.1, "result": {"stopReason": "end_turn", "usage": {}}},
    ]
    env = _env(tmp_path, events)
    result = _run_wrapper("hi", env)
    assert result.returncode == 0
    log = _read_log(env)
    methods = [e["method"] for e in log if e.get("kind") == "request"]
    # Must include initialize, session/new, session/prompt in order
    assert "initialize" in methods, f"methods: {methods}"
    assert "session/new" in methods
    assert "session/prompt" in methods
    i_init = methods.index("initialize")
    i_new = methods.index("session/new")
    i_prompt = methods.index("session/prompt")
    assert i_init < i_new < i_prompt, f"order wrong: {methods}"


# ──────────────────────────────────────────────────────────────────────────────
# Test (f): graceful shutdown on SIGTERM mid-prompt
# ──────────────────────────────────────────────────────────────────────────────
def test_sigterm_graceful_shutdown(tmp_path):
    # Long-running prompt — never emits response; wrapper should handle SIGTERM
    events = [
        {"type": "notification", "delay": 0.5, "update": {"sessionUpdate": "agent_message_chunk", "content": {"type": "text", "text": "."}}},
    ] * 50  # ~25s of activity, no final response
    env = _env(tmp_path, events)
    proc = subprocess.Popen(
        [str(WRAPPER), "hi"], env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
    )
    time.sleep(1.5)  # let it get into the prompt
    proc.send_signal(signal.SIGTERM)
    try:
        proc.wait(timeout=10)
    except subprocess.TimeoutExpired:
        proc.kill()
        pytest.fail("wrapper did not exit within 10s of SIGTERM")
    # 143 = 128+15 (SIGTERM), 130 = SIGINT — either acceptable for signal-induced exit
    assert proc.returncode in (0, 130, 143, -15), f"unexpected exit code: {proc.returncode}"


# ─────────────────────────────────────────────────────────────────────────────
# Throttle tests (RED-first): agent_thought_chunk must NOT flood stderr.
# ─────────────────────────────────────────────────────────────────────────────

def test_thought_chunks_do_not_flood_stderr(tmp_path):
    """50 thought tokens streamed rapidly must emit ≤2 stderr lines total.

    Hermes streams thought deltas char-by-char; the old wrapper emitted one
    `[thought]` line per token, flooding stderr. The fix suppresses per-token
    emission so stderr stays quiet during the thinking phase.
    """
    events = [
        {"type": "notification", "delay": 0.01, "update": {
            "sessionUpdate": "agent_thought_chunk",
            "content": {"type": "text", "text": tok},
        }}
        for tok in ("to ", "redirect ", "T", "DD", "now", ".")
    ] * 9  # 54 thought tokens, ~0.5s total
    events.append({"type": "notification", "delay": 0.05, "update": {
        "sessionUpdate": "agent_message_chunk",
        "content": {"type": "text", "text": "done\n"},
    }})
    events.append({"type": "response", "delay": 0.05, "result": {"stopReason": "end_turn", "usage": {}}})
    env = _env(tmp_path, events)
    result = _run_wrapper("think hard", env, timeout=30)
    assert result.returncode == 0, f"stderr: {result.stderr}"
    stderr_lines = [l for l in result.stderr.splitlines() if l.strip()]
    assert len(stderr_lines) <= 2, (
        f"stderr flooded with {len(stderr_lines)} lines during 50+ thought tokens "
        f"(expected ≤2). stderr={result.stderr!r}"
    )


def test_heartbeat_emitted_during_silence(tmp_path):
    """During a quiet window (no stdout/stderr activity) the wrapper must emit
    a heartbeat to stderr so ralph's pre-start stall detector stays fed.

    Uses env override to shrink the silence threshold for a fast test.
    """
    # No notifications at all — just a response after a 1s silence.
    events = [
        {"type": "response", "delay": 1.0, "result": {"stopReason": "end_turn", "usage": {}}},
    ]
    env = _env(tmp_path, events)
    # Shrink thresholds for test speed (defaults are 30s / 1s)
    env["RALPH_HERMES_ACP_HEARTBEAT_SILENCE"] = "0.3"
    env["RALPH_HERMES_ACP_HEARTBEAT_INTERVAL"] = "0.1"
    result = _run_wrapper("silent task", env, timeout=30)
    assert result.returncode == 0, f"stderr: {result.stderr}"
    heartbeat_lines = [l for l in result.stderr.splitlines() if "[thinking]" in l]
    assert len(heartbeat_lines) >= 1, (
        f"expected ≥1 heartbeat during silence, got {len(heartbeat_lines)}. "
        f"stderr={result.stderr!r}"
    )


# ──────────────────────────────────────────────────────────────────────────────
# Configurable init timeout (RED — subprocess test with slow mock)
# ──────────────────────────────────────────────────────────────────────────────
def test_slow_initialize_succeeds_with_configured_timeout(tmp_path):
    """35s initialize delay should succeed when RALPH_ACP_INIT_TIMEOUT=60.
    
    Simulates hermes acp -p <profile> loading MCP servers with retry backoff.
    Without this fix, the wrapper times out at 30s hardcoded. With the fix,
    the timeout is env-driven and ralph can survive slow init.
    """
    events = [
        {"type": "notification", "delay": 0.1, "update": {
            "sessionUpdate": "agent_message_chunk",
            "content": {"type": "text", "text": "done\n"},
        }},
        {"type": "response", "delay": 0.1, "result": {"stopReason": "end_turn", "usage": {}}},
    ]
    env = _env(tmp_path, events)
    # Mock initialize takes 35s (exceeds old 30s hardcoded timeout)
    env["MOCK_INIT_DELAY"] = "35"
    # New env-driven timeout = 60s (should succeed)
    env["RALPH_ACP_INIT_TIMEOUT"] = "60"
    result = _run_wrapper("hi", env, timeout=90)
    assert result.returncode == 0, (
        f"wrapper should succeed with 60s timeout when init takes 35s. "
        f"stderr: {result.stderr}"
    )
    # Verify initialize actually happened (wasn't skipped)
    log = _read_log(env)
    methods = [e["method"] for e in log if e.get("kind") == "request"]
    assert "initialize" in methods, f"initialize request missing in log: {log}"


def test_slow_initialize_times_out_when_env_too_short(tmp_path):
    """35s initialize delay FAILS when RALPH_ACP_INIT_TIMEOUT=10 (too short)."""
    events = []  # Won't reach prompt phase
    env = _env(tmp_path, events)
    env["MOCK_INIT_DELAY"] = "35"
    env["RALPH_ACP_INIT_TIMEOUT"] = "10"  # Way too short
    result = _run_wrapper("hi", env, timeout=60)
    assert result.returncode != 0, "should time out when init_timeout < init_delay"
    assert "timeout waiting for response to initialize" in result.stderr


def test_profile_flag_forwarded_to_binary(tmp_path):
    """Verify -p <profile> reaches the spawned binary (hermes needs it before 'acp' subcommand).
    
    The wrapper extracts -p from passthrough args and injects it into the spawn
    command as a GLOBAL flag before the subcommand: `hermes -p prof acp`.
    """
    events = [
        {"type": "notification", "delay": 0.05, "update": {
            "sessionUpdate": "agent_message_chunk",
            "content": {"type": "text", "text": "ok\n"},
        }},
        {"type": "response", "delay": 0.05, "result": {"stopReason": "end_turn", "usage": {}}},
    ]
    env = _env(tmp_path, events)
    # Mock captures its argv
    env["MOCK_CAPTURE_ARGS"] = "1"
    # Invoke wrapper with -p after -- (ralph injects passthrough flags before prompt)
    result = subprocess.run(
        [str(WRAPPER), "do task", "-p", "test-profile"],
        env=env,
        capture_output=True,
        text=True,
        timeout=20,
    )
    assert result.returncode == 0, f"stderr: {result.stderr}"
    log = _read_log(env)
    # Find the raw_args event
    args_events = [e for e in log if e.get("kind") == "raw_args"]
    assert len(args_events) == 1, f"expected 1 raw_args log event, got {len(args_events)}"
    raw_args = args_events[0]["args"]
    # The mock is invoked as: python3 /path/to/mock_acp_server.py
    # If wrapper forwarded -p correctly, argv should contain ["-p", "test-profile"]
    assert "-p" in raw_args, f"-p missing in mock argv: {raw_args}"
    p_idx = raw_args.index("-p")
    assert p_idx + 1 < len(raw_args), "profile value missing after -p"
    assert raw_args[p_idx + 1] == "test-profile", (
        f"expected profile 'test-profile', got {raw_args[p_idx+1]!r}"
    )
