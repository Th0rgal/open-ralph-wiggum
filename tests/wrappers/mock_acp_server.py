#!/usr/bin/env python3
"""Mock ACP server for testing ralph-hermes-acp wrapper.

Reads JSON-RPC requests from stdin, emits scripted responses/notifications
to stdout, and records the method sequence to a log file (passed via env
MOCK_LOG). Time-controlled via env MOCK_SCRIPT (path to a JSON file
describing the notification script for session/prompt).
"""
import json
import os
import sys
import threading
import time


def log_event(msg):
    log_path = os.environ.get("MOCK_LOG")
    if not log_path:
        return
    with open(log_path, "a") as f:
        f.write(json.dumps(msg) + "\n")


def send(obj):
    sys.stdout.write(json.dumps(obj) + "\n")
    sys.stdout.flush()


def send_notif(method, params):
    send({"jsonrpc": "2.0", "method": method, "params": params})


def handle_request(req):
    method = req.get("method")
    rid = req.get("id")
    params = req.get("params", {}) or {}

    log_event({"kind": "request", "method": method, "id": rid, "params_keys": list(params.keys())})

    # MOCK_INIT_DELAY: sleep N seconds before responding to initialize.
    # Simulates slow MCP-server loading (the real failure mode when hermes
    # loads a profile with many MCP servers that retry-fail with backoff).
    if method == "initialize":
        init_delay = os.environ.get("MOCK_INIT_DELAY")
        if init_delay:
            try:
                time.sleep(float(init_delay))
            except ValueError:
                pass
        # Capture clientInfo.name when MOCK_CAPTURE_CLIENT_INFO=1 (used by the
        # generic-acp-transport tests to assert dynamic CLIENT_INFO).
        if os.environ.get("MOCK_CAPTURE_CLIENT_INFO") == "1":
            ci = params.get("clientInfo") or {}
            log_event({"kind": "client_info", "clientInfoName": ci.get("name", "")})
        # authMethods configurable via env MOCK_AUTH_METHODS (JSON list of
        # {"id": "...", "kind": "..."}). Empty by default (no auth needed).
        try:
            auth_methods = json.loads(os.environ.get("MOCK_AUTH_METHODS", "[]"))
        except json.JSONDecodeError:
            auth_methods = []
        send({"jsonrpc": "2.0", "id": rid, "result": {
            "protocolVersion": 1,
            "agentInfo": {"name": "mock-hermes", "version": "0.0.1"},
            "agentCapabilities": {},
            "authMethods": auth_methods,
        }})
        return

    if method == "authenticate":
        # If MOCK_AUTH_FAIL=1, return an error to exercise the best-effort
        # auth-failure path in the wrapper.
        if os.environ.get("MOCK_AUTH_FAIL") == "1":
            send({"jsonrpc": "2.0", "id": rid, "error": {"code": -32000, "message": "auth failed"}})
            return
        send({"jsonrpc": "2.0", "id": rid, "result": {}})
        return

    if method == "session/new":
        sid = "mock-session-" + str(int(time.time() * 1000))
        # If MOCK_NO_SESSION_ID=1, return a result without sessionId to
        # exercise the wrapper's error branch.
        if os.environ.get("MOCK_NO_SESSION_ID") == "1":
            send({"jsonrpc": "2.0", "id": rid, "result": {"models": [], "modes": []}})
            return
        send({"jsonrpc": "2.0", "id": rid, "result": {
            "sessionId": sid,
            "models": [],
            "modes": [],
            "_meta": {},
        }})
        # Emit available_commands_update (matches real hermes)
        send_notif("session/update", {"sessionId": sid, "update": {
            "sessionUpdate": "available_commands_update",
            "availableCommands": [],
        }})
        return

    if method in ("session/setModel", "session/unstable_setSessionModel"):
        # MOCK_SET_MODEL_MODE: "ok" (default) | "fail_stable" | "fail_all"
        mode = os.environ.get("MOCK_SET_MODEL_MODE", "ok")
        if mode == "fail_stable" and method == "session/setModel":
            send({"jsonrpc": "2.0", "id": rid, "error": {"code": -32601, "message": "unsupported"}})
            return
        if mode == "fail_all":
            send({"jsonrpc": "2.0", "id": rid, "error": {"code": -32601, "message": "unsupported"}})
            return
        send({"jsonrpc": "2.0", "id": rid, "result": {}})
        return

    if method == "session/prompt":
        sid = params.get("sessionId")
        # Load the notification script
        script_path = os.environ.get("MOCK_SCRIPT")
        events = []
        if script_path and os.path.exists(script_path):
            with open(script_path) as f:
                events = json.load(f)
        # Stream events with small delays
        def emit():
            for ev in events:
                time.sleep(ev.get("delay", 0.05))
                if ev.get("type") == "notification":
                    send_notif("session/update", {"sessionId": sid, "update": ev["update"]})
                elif ev.get("type") == "response":
                    if "error" in ev:
                        send({"jsonrpc": "2.0", "id": rid, "error": ev["error"]})
                    else:
                        send({"jsonrpc": "2.0", "id": rid, "result": ev["result"]})
            # If response not in script, send default end_turn
            if not any(e.get("type") == "response" for e in events):
                time.sleep(0.05)
                send({"jsonrpc": "2.0", "id": rid, "result": {
                    "stopReason": "end_turn",
                    "usage": {"inputTokens": 10, "outputTokens": 5, "totalTokens": 15},
                }})
        threading.Thread(target=emit, daemon=True).start()
        return

    if method == "session/cancel":
        send({"jsonrpc": "2.0", "id": rid, "result": {}})
        return

    if method == "session/dispose":
        send({"jsonrpc": "2.0", "id": rid, "result": {}})
        return

    # Unknown method — error
    send({"jsonrpc": "2.0", "id": rid, "error": {"code": -32601, "message": f"unknown method {method}"}})


def main():
    # MOCK_CAPTURE_ARGS: log raw argv so tests can verify the wrapper forwarded
    # flags (e.g. -p <profile>) to the binary correctly.
    if os.environ.get("MOCK_CAPTURE_ARGS") == "1":
        log_event({"kind": "raw_args", "args": list(sys.argv)})
    log_event({"kind": "start", "pid": os.getpid()})
    buf = ""
    while True:
        ch = sys.stdin.read(1)
        if not ch:
            break
        buf += ch
        if ch == "\n":
            line = buf.strip()
            buf = ""
            if not line:
                continue
            try:
                req = json.loads(line)
            except json.JSONDecodeError:
                continue
            handle_request(req)
    log_event({"kind": "end", "pid": os.getpid()})


if __name__ == "__main__":
    main()
