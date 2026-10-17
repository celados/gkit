#!/usr/bin/env python3
"""Create a Gmail draft through gws without exposing raw MIME in shell code."""

from __future__ import annotations

import argparse
import base64
import json
import subprocess
import sys
from email.message import EmailMessage
from email.utils import getaddresses
from pathlib import Path


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Create, but never send, one Gmail draft.")
    parser.add_argument("--to", action="append", required=True, help="Recipient email; repeatable")
    parser.add_argument("--cc", action="append", default=[], help="CC email; repeatable")
    parser.add_argument("--bcc", action="append", default=[], help="BCC email; repeatable")
    parser.add_argument("--subject", required=True)
    parser.add_argument("--body-file", required=True, help="Plain-text body path, or - for stdin")
    parser.add_argument("--dry-run", action="store_true")
    return parser.parse_args()


def validate_header(name: str, value: str) -> str:
    normalized = value.strip()
    if not normalized or "\n" in normalized or "\r" in normalized:
        raise ValueError(f"{name} must be non-empty and contain no newlines")
    return normalized


def validate_addresses(name: str, values: list[str]) -> list[str]:
    normalized = [validate_header(name, value) for value in values]
    parsed = getaddresses(normalized)
    if len(parsed) != len(normalized) or any(not address or "@" not in address for _, address in parsed):
        raise ValueError(f"{name} contains an invalid email address")
    return normalized


def read_body(path: str) -> str:
    body = sys.stdin.read() if path == "-" else Path(path).read_text(encoding="utf-8")
    body = body.strip()
    if not body:
        raise ValueError("body must not be empty")
    return body + "\n"


def main() -> int:
    args = parse_args()
    recipients = validate_addresses("to", args.to)
    cc = validate_addresses("cc", args.cc)
    bcc = validate_addresses("bcc", args.bcc)

    message = EmailMessage()
    message["To"] = ", ".join(recipients)
    if cc:
        message["Cc"] = ", ".join(cc)
    if bcc:
        message["Bcc"] = ", ".join(bcc)
    message["Subject"] = validate_header("subject", args.subject)
    message.set_content(read_body(args.body_file))

    raw = base64.urlsafe_b64encode(message.as_bytes()).decode("ascii").rstrip("=")
    command = [
        "gws",
        "gmail",
        "users",
        "drafts",
        "create",
        "--params",
        json.dumps({"userId": "me"}, separators=(",", ":")),
        "--json",
        json.dumps({"message": {"raw": raw}}, separators=(",", ":")),
    ]
    if args.dry_run:
        command.append("--dry-run")

    completed = subprocess.run(command, check=False)
    return completed.returncode


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (OSError, ValueError) as error:
        print(f"error: {error}", file=sys.stderr)
        raise SystemExit(2) from error
