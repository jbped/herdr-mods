#!/usr/bin/env python3
"""Claude Code hook: mirror in-process subagents into files the Herdr `agents-plus` mod reads.

One file per running subagent: <STATE_DIR>/<terminal>__<agent_id>.json
Pending Agent-tool descriptions:  <STATE_DIR>/.pending__<terminal>__<ns>.json
Does nothing outside a Herdr terminal (no HC_TERMINAL_ID).
"""
import json
import os
import re
import sys
import time

from pathlib import Path

# The mod reads <home>/.herdr-subagents, where <home> is the profile holding Herdr's config.
# This file lives in <home>/.config/herdr-app/mods/agents-plus/hooks/, so that home is
# five folders up, also when Herdr runs on Windows and Claude in WSL.
STATE_DIR = os.environ.get("HERDR_SUBAGENTS_DIR") or str(Path(__file__).resolve().parents[5] / ".herdr-subagents")
SAFE = re.compile(r"[^A-Za-z0-9_.-]")


def safe(s):
    return SAFE.sub("_", str(s))[:80]


def write_atomic(path, data):
    tmp = f"{path}.tmp{os.getpid()}"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f)
    os.replace(tmp, path)


def claim_pending(term, agent_type):
    """Take the oldest pending description for this terminal, preferring a matching type."""
    prefix = f".pending__{term}__"
    try:
        names = sorted(n for n in os.listdir(STATE_DIR) if n.startswith(prefix) and n.endswith(".json"))
    except OSError:
        return {}
    entries = []
    for n in names:
        try:
            with open(os.path.join(STATE_DIR, n), encoding="utf-8") as f:
                entries.append((n, json.load(f)))
        except (OSError, ValueError):
            continue
    ordered = [e for e in entries if e[1].get("type") == agent_type] + [e for e in entries if e[1].get("type") != agent_type]
    for n, data in ordered:
        src = os.path.join(STATE_DIR, n)
        dst = f"{src}.claimed{os.getpid()}"
        try:
            os.rename(src, dst)  # atomic claim; loses the race if another hook took it
        except OSError:
            continue
        try:
            os.remove(dst)
        except OSError:
            pass
        return data
    return {}


def owns_running_task(payload, agent_id):
    """background_tasks is session-wide, so a running task counts only if its id
    appears in this subagent's own transcript (it started it)."""
    ids = [t.get("id") for t in payload.get("background_tasks") or []
           if isinstance(t, dict) and t.get("status") == "running" and t.get("id") and t.get("id") != agent_id]
    path = payload.get("agent_transcript_path")
    if not ids or not path:
        return False
    try:
        with open(path, encoding="utf-8", errors="replace") as f:
            text = f.read()
    except OSError:
        return False
    return any(i in text for i in ids)


def clear_terminal(term):
    try:
        names = os.listdir(STATE_DIR)
    except OSError:
        return
    for n in names:
        if n.startswith(f"{term}__") or n.startswith(f".pending__{term}__"):
            try:
                os.remove(os.path.join(STATE_DIR, n))
            except OSError:
                pass


def main():
    term = os.environ.get("HC_TERMINAL_ID")
    if not term:
        return
    try:
        payload = json.load(sys.stdin)
    except ValueError:
        return
    term = safe(term)
    event = payload.get("hook_event_name")
    os.makedirs(STATE_DIR, exist_ok=True)
    if os.environ.get("HERDR_SUBAGENTS_DEBUG") or os.path.exists(os.path.join(STATE_DIR, ".debug")):
        with open(os.path.join(STATE_DIR, ".log.jsonl"), "a", encoding="utf-8") as f:
            f.write(json.dumps({"t": time.time(), **{k: v for k, v in payload.items() if k not in ("tool_input", "last_assistant_message")}}) + "\n")

    if event == "PreToolUse":
        if payload.get("tool_name") not in ("Agent", "Task"):
            return
        ti = payload.get("tool_input") or {}
        write_atomic(
            os.path.join(STATE_DIR, f".pending__{term}__{time.time_ns()}.json"),
            {"type": ti.get("subagent_type") or "general-purpose", "description": ti.get("description") or ""},
        )
    elif event == "SubagentStart":
        agent_id = payload.get("agent_id")
        if not agent_id:
            return
        agent_type = payload.get("agent_type") or ""
        path = os.path.join(STATE_DIR, f"{term}__{safe(agent_id)}.json")
        # Resume after waiting on background work: keep its description, just mark it working.
        try:
            with open(path, encoding="utf-8") as f:
                existing = json.load(f)
            existing["status"] = "working"
            write_atomic(path, existing)
            return
        except (OSError, ValueError):
            pass
        pending = claim_pending(term, agent_type)
        write_atomic(
            path,
            {
                "terminal": term,
                "agent_id": agent_id,
                "type": agent_type or pending.get("type") or "agent",
                "description": pending.get("description") or "",
                "status": "working",
                "started": int(time.time() * 1000),
            },
        )
    elif event == "PostToolUse":
        # The final report ends the subagent, even with background work still running
        # (an orphaned Monitor would otherwise keep it "waiting" forever). A later
        # resume makes a new row through SubagentStart.
        agent_id = payload.get("agent_id")
        if payload.get("tool_name") == "SubagentHandback" and agent_id:
            try:
                os.remove(os.path.join(STATE_DIR, f"{term}__{safe(agent_id)}.json"))
            except OSError:
                pass
    elif event == "SubagentStop":
        agent_id = payload.get("agent_id")
        if not agent_id:
            return
        path = os.path.join(STATE_DIR, f"{term}__{safe(agent_id)}.json")
        if owns_running_task(payload, agent_id):
            # Interim stop: it waits on its own background work and will resume (SubagentStart again).
            try:
                with open(path, encoding="utf-8") as f:
                    data = json.load(f)
                data["status"] = "waiting"
                write_atomic(path, data)
            except (OSError, ValueError):
                pass
        else:
            try:
                os.remove(path)
            except OSError:
                pass
    elif event == "SessionEnd" or (event == "SessionStart" and payload.get("source") in ("startup", "resume")):
        clear_terminal(term)


if __name__ == "__main__":
    try:
        main()
    except Exception:
        pass  # never block Claude
