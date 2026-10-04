#!/usr/bin/env python3
"""Authenticated AgentRouter caller for the secure-vault/Hatch runtime.

This version follows the attached build record: credentials are obtained through
 dynamic_credentials as short-lived hsurr:* surrogates and are pinned to the
AgentRouter host allowlist. The raw key is never read by this script.
"""
from __future__ import annotations

import argparse
import json
import sys
import urllib.error
import urllib.request

sys.path.insert(0, "/opt/hatch/skills/skill-creator/bin")
from dynamic_credentials import (  # type: ignore # noqa: E402
    DynamicCredentialError,
    add_surrogate_to_request,
    read_json_response,
)

ALLOWED_HOSTS = ("agentrouter.org", "co.agentrouter.org")
CREDENTIAL_NAME = "custom.agentrouter"
CLIENT_HEADERS = {
    "Originator": "codex_cli_rs",
    "Version": "0.101.0",
    "User-Agent": "codex_cli_rs/0.101.0 (Mac OS 26.0.1; arm64) Apple_Terminal/464",
}


def main() -> int:
    parser = argparse.ArgumentParser(description="Call AgentRouter using the connected secure credential.")
    parser.add_argument("--host", default="agentrouter.org", choices=ALLOWED_HOSTS)
    parser.add_argument("--path", required=True)
    parser.add_argument("--method", default="GET", choices=("GET", "POST"))
    parser.add_argument("--data", default=None)
    parser.add_argument("--timeout", type=float, default=120.0)
    args = parser.parse_args()

    path = args.path if args.path.startswith("/") else "/" + args.path
    req = urllib.request.Request(
        f"https://{args.host}{path}",
        data=args.data.encode("utf-8") if args.data is not None else None,
        method=args.method,
    )
    for name, value in CLIENT_HEADERS.items():
        req.add_header(name, value)
    if args.data is not None:
        req.add_header("Content-Type", "application/json")

    try:
        add_surrogate_to_request(req, CREDENTIAL_NAME, allowed_hosts=ALLOWED_HOSTS)
    except DynamicCredentialError as exc:
        print(json.dumps({"ok": False, "error": f"credential: {exc}"}))
        return 2

    try:
        with urllib.request.urlopen(req, timeout=args.timeout) as resp:
            payload = read_json_response(resp)
            print(json.dumps({"ok": True, "status": resp.status, "data": payload}, ensure_ascii=False))
            return 0
    except urllib.error.HTTPError as exc:
        try:
            err = exc.read().decode("utf-8", "replace")
        except Exception:
            err = ""
        print(json.dumps({"ok": False, "status": exc.code, "error": err[:2000]}, ensure_ascii=False))
        return 1
    except Exception as exc:
        print(json.dumps({"ok": False, "error": f"transport: {exc}"}, ensure_ascii=False))
        return 3


if __name__ == "__main__":
    raise SystemExit(main())
