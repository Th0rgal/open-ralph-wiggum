#!/usr/bin/env python3
"""Tests for the non-ACP ralph-hermes bash wrapper (oneshot mode).

The ralph-hermes wrapper is a bash script that translates Ralph's generic
wrapper args into hermes's oneshot CLI (`hermes -z <prompt>`). These tests
exercise it against a fake `hermes` binary on PATH.
"""
import json
import os
import subprocess
import sys
from pathlib import Path

import pytest

TEST_DIR = Path(__file__).parent.resolve()
REPO_ROOT = TEST_DIR.parent.parent
WRAPPER = REPO_ROOT / "scripts" / "wrappers" / "ralph-hermes"


def _make_fake_hermes(tmp_path):
    """Create a fake hermes binary that logs argv to a JSONL file and exits 0."""
    fake_dir = tmp_path / "bin"
    fake_dir.mkdir()
    log_file = tmp_path / "hermes_calls.jsonl"
    fake_bin = fake_dir / "hermes"
    log_str = str(log_file)
    fake_bin.write_text(
        "#!/usr/bin/env python3\n"
        "import json, sys, os\n"
        f"LOG = {log_str!r}\n"
        "with open(LOG, 'a') as f:\n"
        "    f.write(json.dumps({'argv': sys.argv, 'env': dict(os.environ)}) + '\\n')\n"
    )
    fake_bin.chmod(0o755)
    return fake_dir, log_file


def _read_calls(log_file):
    if not log_file.exists():
        return []
    with open(log_file) as f:
        return [json.loads(l) for l in f if l.strip()]


@pytest.mark.skipif(not WRAPPER.exists(), reason="ralph-hermes wrapper not in repo")
def test_oneshot_invokes_hermes_with_z_flag(tmp_path):
    """ralph-hermes must invoke hermes in oneshot mode: `hermes ... -z <prompt>`."""
    fake_dir, log_file = _make_fake_hermes(tmp_path)
    env = dict(os.environ)
    env["PATH"] = f"{fake_dir}:{env.get('PATH', '')}"
    result = subprocess.run(
        [str(WRAPPER), "do it"],
        env=env, capture_output=True, text=True, timeout=10,
    )
    assert result.returncode == 0, f"stderr: {result.stderr}"
    calls = _read_calls(log_file)
    assert len(calls) == 1, f"expected 1 hermes call, got {len(calls)}"
    argv = calls[0]["argv"]
    assert argv[1] == "-z", f"expected -z oneshot flag, got argv: {argv}"
    assert argv[2] == "do it", f"prompt not passed correctly, got argv: {argv}"


@pytest.mark.skipif(not WRAPPER.exists(), reason="ralph-hermes wrapper not in repo")
def test_oneshot_forwards_profile_flag(tmp_path):
    """`-p <profile>` must be forwarded to hermes so profile env is loaded."""
    fake_dir, log_file = _make_fake_hermes(tmp_path)
    env = dict(os.environ)
    env["PATH"] = f"{fake_dir}:{env.get('PATH', '')}"
    result = subprocess.run(
        [str(WRAPPER), "task", "--", "-p", "test-profile"],
        env=env, capture_output=True, text=True, timeout=10,
    )
    assert result.returncode == 0, f"stderr: {result.stderr}"
    calls = _read_calls(log_file)
    assert len(calls) == 1
    argv = calls[0]["argv"]
    assert "-p" in argv, f"-p not forwarded, argv: {argv}"
    p_idx = argv.index("-p")
    assert argv[p_idx + 1] == "test-profile", f"profile value wrong, argv: {argv}"


@pytest.mark.skipif(not WRAPPER.exists(), reason="ralph-hermes wrapper not in repo")
def test_oneshot_forwards_model(tmp_path):
    """`--model X` must be forwarded as `-m X` to hermes."""
    fake_dir, log_file = _make_fake_hermes(tmp_path)
    env = dict(os.environ)
    env["PATH"] = f"{fake_dir}:{env.get('PATH', '')}"
    result = subprocess.run(
        [str(WRAPPER), "--model", "role-smart", "task"],
        env=env, capture_output=True, text=True, timeout=10,
    )
    assert result.returncode == 0, f"stderr: {result.stderr}"
    calls = _read_calls(log_file)
    assert len(calls) == 1
    argv = calls[0]["argv"]
    assert "-m" in argv, f"-m not forwarded, argv: {argv}"
    m_idx = argv.index("-m")
    assert argv[m_idx + 1] == "role-smart", f"model value wrong, argv: {argv}"
