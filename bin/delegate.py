#!/usr/bin/env python3
"""Parallel delegation runner for external-model jobs.

Reads a job JSON file, fans tasks out in parallel through the sibling
ar_call.py, enforces spend caps, writes each result into the output
directory, and appends usage to the spend ledger.

Job file format:
{
  "name": "trial-001",
  "per_run_cap_usd": 0.50,
  "tasks": [
    {"id": "t1", "model": "deepseek-v4-flash",
     "messages": [{"role": "user", "content": "..."}], "max_tokens": 100}
  ]
}

Usage:
    delegate.py --job job.json --out ./results [--ledger ledger.json]
"""

import argparse
import concurrent.futures
import json
import os
import re
import subprocess
import sys
import time

AR_CALL = os.path.join(
    os.path.dirname(os.path.realpath(__file__)), "ar_call.py")
DEFAULT_LEDGER = os.path.expanduser(
    "~/workspace/skills/external-delegate/ledger.json")

# Conservative per-1M-token USD estimates (input+output blended, high side).
# VERIFY against the AgentRouter console/pricing page before trusting these.
PRICE_PER_MTOK = {
    "deepseek-v4-flash": 0.30,
    "gpt-6-astra": 2.00,
    "claude-opus-4-8": 15.00,
    "claude-opus-5": 15.00,
}

# Patterns that must never be sent to an external model.
SECRET_PATTERNS = [
    re.compile(r"sk-[A-Za-z0-9]{16,}"),
    re.compile(r"(?i)(api[_-]?key|bearer)\s*[:=]\s*['\"]?[A-Za-z0-9_\-]{16,}"),
    re.compile(r"(?i)mnemonic\s*[:=].+"),
    re.compile(r"\b([a-z]+\s+){11,23}[a-z]+\b"),  # seed-phrase-like runs
]


def redact(text):
    """Return (redacted_text, [notes]) with secret-looking spans removed."""
    notes = []
    for pat in SECRET_PATTERNS:
        text, n = pat.subn("[REDACTED]", text)
        if n:
            notes.append(f"redacted {n} secret-like span(s)")
    return text, notes


def estimate_cost_usd(model, prompt_tokens_est, max_tokens):
    rate = PRICE_PER_MTOK.get(model, 15.00)  # unknown model -> dearest
    return (prompt_tokens_est + max_tokens) / 1_000_000 * rate


def _call_api(
    model, messages, max_tokens, timeout=600, host=None, api_key=None
):
    """Single API call. Returns (text, usage_dict, error_str).

    If api_key is provided, makes a direct HTTPS call to the given host
    with that key. Otherwise uses ar_call.py with the stored credential.
    """
    payload = json.dumps({
        "model": model,
        "messages": messages,
        "max_tokens": max_tokens,
    })

    # Direct call with raw API key (for second key on backup host)
    if api_key:
        import urllib.request
        target_host = host or "co.agentrouter.org"
        url = f"https://{target_host}/v1/chat/completions"
        try:
            req = urllib.request.Request(
                url, data=payload.encode(),
                headers={
                    "Content-Type": "application/json",
                    "Authorization": f"Bearer {api_key}",
                    "Originator": "codex_cli_rs",
                    "Version": "0.101.0",
                    "User-Agent": (
                        "codex_cli_rs/0.101.0 (Mac OS 26.0.1; arm64) "
                        "Apple_Terminal/464"
                    ),
                },
                method="POST")
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                data = json.loads(resp.read().decode())
        except Exception as e:
            return "", {}, f"direct: {str(e)[:200]}"
    else:
        try:
            cmd = [
                sys.executable, AR_CALL, "--path", "/v1/chat/completions",
                "--method", "POST", "--timeout", str(timeout),
                "--data", payload,
            ]
            if host:
                cmd.extend(["--host", host])
            proc = subprocess.run(
                cmd, capture_output=True, text=True, timeout=timeout + 30)
        except subprocess.TimeoutExpired:
            return "", {}, "runner: ar_call timed out"
        except OSError as e:
            return "", {}, f"runner: {str(e)[:200]}"
        try:
            resp = json.loads(proc.stdout)
        except json.JSONDecodeError:
            error = "runner: bad JSON from ar_call: " + proc.stderr[:200]
            return "", {}, error
        if not isinstance(resp, dict):
            return "", {}, "runner: expected a JSON object from ar_call"
        if not resp.get("ok"):
            return "", {}, str(resp.get("error", "unknown"))[:200]
        data = resp.get("data", {})

    source = "direct" if api_key else "runner"
    if not isinstance(data, dict):
        return "", {}, f"{source}: response data is not a JSON object"
    usage = data.get("usage", {}) or {}
    if not isinstance(usage, dict):
        return "", {}, f"{source}: usage is not a JSON object"
    text = ""
    try:
        msg = data["choices"][0]["message"]
        if not isinstance(msg, dict):
            return "", {}, f"{source}: message is not a JSON object"
        # Some reasoning models put output in reasoning_content with empty
        # content; prefer content, fall back to reasoning_content.
        text = msg.get("content") or msg.get("reasoning_content") or ""
    except (KeyError, IndexError, TypeError):
        pass
    if not isinstance(text, str):
        return "", {}, f"{source}: response content is not a string"
    return text, usage, ""


def _content_text(content):
    """Extract text from strings or multipart content without stringifying data."""
    if isinstance(content, str):
        return content
    if not isinstance(content, list):
        return ""
    text_parts = []
    for part in content:
        if isinstance(part, dict):
            part = part.get("text")
        if isinstance(part, str):
            text_parts.append(part)
    return "".join(text_parts)


def _reword_prompt(messages):
    """Build a simplified fallback prompt when the original returns empty.

    Certain prompt phrasings intermittently yield empty completions from the
    API despite 200 OK. A shorter, differently-worded prompt recovers them.
    """
    # Find the main user content (longest user message) and extract code block
    user_text = ""
    for m in messages:
        if m.get("role") != "user":
            continue
        content = _content_text(m.get("content", ""))
        if len(content) > len(user_text):
            user_text = content
    code = user_text
    # Try to isolate a CODE: section if present
    idx = user_text.find("CODE:\n")
    if idx >= 0:
        start = idx + len("CODE:\n")
        end = user_text.find("\n\nDo TWO things:", idx)
        code = user_text[start:end] if end >= 0 else user_text[start:]
        code = code.strip()
    return [{
        "role": "user",
        "content": (
            "Code review task. Review the code below for bugs, security issues, "
            "and money-handling risks.\n\n```\n" + code[:12000] + "\n```\n\n"
            "1. List each issue rated P0 (money lost/stuck), P1 (security), "
            "or P2 (correctness) with location and explanation.\n"
            "2. For each P0 and P1, provide the complete corrected code "
            "(full functions, ready to use).\nBe specific and thorough."
        ),
    }]


# Minimum characters for a response to count as successful.
MIN_TEXT_LEN = 1000


def _fsync_dir(path):
    """Best-effort fsync of a directory so a rename inside it is durable."""
    try:
        fd = os.open(path, os.O_RDONLY)
        try:
            os.fsync(fd)
        finally:
            os.close(fd)
    except OSError:
        pass


def _atomic_write_json(path, obj):
    """Atomically replace a JSON file after flushing its contents to disk.

    Write and fsync a temporary file in the same directory, then replace
    the target and attempt to fsync the directory for durability.
    """
    tmp = f"{path}.tmp-{os.getpid()}"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, indent=2)
        f.flush()
        os.fsync(f.fileno())
    os.replace(tmp, path)
    _fsync_dir(os.path.dirname(os.path.abspath(path)))


def _load_completed(out_dir, task_id):
    """Return a previously saved successful result for task_id, or None.

    Only a complete, valid, successful save counts. A truncated or
    failed leftover from a killed run is re-run, never trusted.
    """
    path = os.path.join(out_dir, f"{task_id}.json")
    try:
        with open(path, encoding="utf-8") as f:
            prev = json.load(f)
    except (OSError, UnicodeDecodeError, json.JSONDecodeError):
        return None
    if not isinstance(prev, dict):
        return None
    text = prev.get("text", "")
    if (
        prev.get("id") == task_id
        and prev.get("ok")
        and isinstance(text, str)
        and len(text.strip()) >= MIN_TEXT_LEN
    ):
        return prev
    return None


def _write_progress(out_dir, job, tasks, resumed, fresh):
    """Atomically snapshot batch progress after every finished section."""
    done = {**resumed, **fresh}
    progress = {
        "job": job.get("name", ""),
        "total": len(tasks),
        "completed": len(done),
        "succeeded": sum(1 for r in done.values() if r.get("ok")),
        "failed": sum(1 for r in done.values() if not r.get("ok")),
        "remaining": [t.get("id", "task") for t in tasks
                      if t.get("id", "task") not in done],
        "ts": int(time.time()),
    }
    try:
        _atomic_write_json(os.path.join(out_dir, "progress.json"), progress)
    except OSError:
        pass


def run_task(task):
    """Run one task through ar_call.py; return a result dict.

    Retries on empty/short responses (up to 3 attempts, last with a reworded
    prompt) so intermittent blank completions never masquerade as success.
    """
    task_id = task.get("id", "task")
    model = task.get("model")
    messages = task["messages"]
    max_tokens = int(task.get("max_tokens", 500))
    task_host = task.get("host")  # e.g. "co.agentrouter.org" for backup
    task_api_key = task.get("api_key")  # raw key for direct calls

    # Redact secrets from every message.
    clean_messages, redactions = [], []
    for m in messages:
        content = m.get("content", "")
        if isinstance(content, str):
            content, notes = redact(content)
            redactions.extend(notes)
        elif isinstance(content, list):
            clean_parts = []
            for part in content:
                part_text = (
                    part.get("text") if isinstance(part, dict) else part
                )
                if isinstance(part_text, str):
                    part_text, notes = redact(part_text)
                    redactions.extend(notes)
                    if isinstance(part, dict):
                        part = {**part, "text": part_text}
                    else:
                        part = part_text
                clean_parts.append(part)
            content = clean_parts
        clean_messages.append({**m, "content": content})

    started = time.time()
    result = {"id": task_id, "model": model, "redactions": redactions}
    last_error = ""
    attempts = 0
    for attempt in range(3):
        attempts = attempt + 1
        if attempt < 2 or task.get("no_reword"):
            use_messages = clean_messages
        else:
            use_messages = _reword_prompt(clean_messages)
        text, usage, err = _call_api(model, use_messages, max_tokens,
                                     host=task_host, api_key=task_api_key)
        if err:
            last_error = err
            continue
        text = _content_text(text)
        text_len = len(text.strip())
        if text_len >= MIN_TEXT_LEN:
            result.update({
                "ok": True,
                "text": text,
                "prompt_tokens": usage.get("prompt_tokens", 0),
                "completion_tokens": usage.get("completion_tokens", 0),
                "total_tokens": usage.get("total_tokens", 0),
                "attempts": attempts,
                "reworded": attempt == 2 and not task.get("no_reword"),
            })
            result["elapsed_s"] = round(time.time() - started, 1)
            return result
        last_error = (
            f"empty/short response ({text_len} chars, attempt {attempts})"
        )
    # All attempts failed or returned blank: report failure, never fake success.
    result.update({
        "ok": False,
        "error": last_error or "all attempts returned empty text",
        "text": "",
        "attempts": attempts,
    })
    result["elapsed_s"] = round(time.time() - started, 1)
    return result


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--job", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--ledger", default=DEFAULT_LEDGER)
    ap.add_argument("--monthly-cap-usd", type=float, default=None)
    ap.add_argument("--workers", type=int, default=4)
    ap.add_argument("--no-resume", action="store_true",
                    help="ignore sections already saved in the output "
                         "directory and re-run every task")
    args = ap.parse_args()
    if args.workers <= 0:
        ap.error("--workers must be greater than 0")

    with open(args.job) as f:
        job = json.load(f)
    tasks = job.get("tasks", [])
    if not tasks:
        print(json.dumps({"ok": False, "error": "job has no tasks"}))
        return 1
    per_run_cap = float(job.get("per_run_cap_usd", 0) or 0)
    if per_run_cap <= 0:
        print(json.dumps({"ok": False,
                          "error": "per_run_cap_usd must be set and > 0"}))
        return 1

    task_ids = [t.get("id", "task") for t in tasks]
    if len(set(task_ids)) != len(task_ids):
        print("WARNING: duplicate task ids in job; per-section save "
              "files are keyed by id and will collide", file=sys.stderr)

    os.makedirs(args.out, exist_ok=True)

    # Crash-resume: sections already saved as successful by an earlier
    # (possibly VM-killed) run are kept — never re-run, never re-billed.
    # The scan runs before the cost estimate so saved sections do not
    # count against the caps either.
    resumed = {}
    if not args.no_resume:
        for t in tasks:
            task_id = t.get("id", "task")
            prev = _load_completed(args.out, task_id)
            if prev is not None:
                resumed[task_id] = prev
    pending = [t for t in tasks if t.get("id", "task") not in resumed]
    if resumed:
        print(f"resume: keeping {len(resumed)} saved section(s); "
              f"{len(pending)} to run", file=sys.stderr)

    # Pre-flight cost estimate (pending tasks only).
    estimate = 0.0
    for t in pending:
        prompt_est = sum(len(str(m.get("content", ""))) // 4
                         for m in t.get("messages", []))
        estimate += estimate_cost_usd(t.get("model"), prompt_est,
                                      int(t.get("max_tokens", 500)))
    if estimate > per_run_cap:
        print(json.dumps({"ok": False, "error": "cap_exceeded",
                          "estimated_usd": round(estimate, 4),
                          "per_run_cap_usd": per_run_cap}))
        return 1
    # Monthly cap check from ledger.
    month_spend = 0.0
    if args.monthly_cap_usd and os.path.exists(args.ledger):
        try:
            with open(args.ledger) as f:
                ledger = json.load(f)
            if not isinstance(ledger, dict) or not isinstance(
                    ledger.get("runs", []), list):
                print(json.dumps({"ok": False,
                                  "error": "invalid ledger format"}))
                return 1
            month_spend = sum(
                r.get("cost_usd_est", 0)
                for r in ledger.get("runs", []))
        except json.JSONDecodeError:
            pass
        except (AttributeError, TypeError):
            print(json.dumps({"ok": False,
                              "error": "invalid ledger run data"}))
            return 1
    if args.monthly_cap_usd and month_spend + estimate > args.monthly_cap_usd:
        print(json.dumps({"ok": False, "error": "monthly_cap_exceeded",
                          "month_spend_usd": round(month_spend, 4),
                          "estimated_usd": round(estimate, 4)}))
        return 1

    _write_progress(args.out, job, tasks, resumed, {})
    results = list(resumed.values())
    fresh = {}
    if pending:
        with concurrent.futures.ThreadPoolExecutor(
                max_workers=args.workers) as pool:
            future_map = {pool.submit(run_task, t): t for t in pending}
            for fut in concurrent.futures.as_completed(future_map):
                try:
                    res = fut.result()
                except Exception as exc:  # noqa: BLE001
                    t = future_map[fut]
                    res = {"id": t.get("id", "task"), "ok": False,
                           "error": f"runner: {exc}"}
                results.append(res)
                fresh[res["id"]] = res
                # Save the moment a section finishes: atomic + fsync, so
                # a VM wipe can never lose or corrupt completed work.
                try:
                    _atomic_write_json(
                        os.path.join(args.out, f"{res['id']}.json"), res)
                except OSError as exc:
                    print(f"WARNING: could not save {res['id']}: {exc}",
                          file=sys.stderr)
                _write_progress(args.out, job, tasks, resumed, fresh)
    results.sort(key=lambda r: str(r.get("id")))

    total_tokens = sum(r.get("total_tokens", 0) for r in results)
    actual_cost = sum(
        (r.get("total_tokens", 0) / 1_000_000)
        * PRICE_PER_MTOK.get(r.get("model", ""), 15.00)
        for r in results)
    summary = {
        "job": job.get("name", ""),
        "ok": all(r.get("ok") for r in results),
        "tasks": len(results),
        "succeeded": sum(1 for r in results if r.get("ok")),
        "resumed": len(resumed),
        "total_tokens": total_tokens,
        "estimated_usd": round(estimate, 4),
        "cost_usd_est": round(actual_cost, 4),
        "ts": int(time.time()),
    }
    _atomic_write_json(os.path.join(args.out, "summary.json"), summary)

    # Append to ledger. The write is atomic: a crash here must not
    # corrupt the whole ledger and silently zero the monthly-cap check.
    ledger = {"runs": []}
    if os.path.exists(args.ledger):
        try:
            with open(args.ledger) as f:
                ledger = json.load(f)
        except json.JSONDecodeError:
            pass
    if not isinstance(ledger, dict) or not isinstance(
            ledger.get("runs", []), list):
        print(json.dumps({"ok": False, "error": "invalid ledger format"}))
        return 1
    ledger.setdefault("runs", []).append(summary)
    _atomic_write_json(args.ledger, ledger)

    print(json.dumps({"ok": summary["ok"], "summary": summary}))
    return 0 if summary["ok"] else 1


if __name__ == "__main__":
    sys.exit(main())
