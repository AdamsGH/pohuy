#!/usr/bin/env python3
"""Manage plugin settings and emit non-blocking Codex hook context."""

import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shlex
import sys
import tempfile

ROOT = Path(__file__).resolve().parent.parent
TIERS = ("off", "lite", "full", "ultra")
MAX_CONTEXT_CHARS = 24000
TIER_GUIDANCE = {
    "lite": "Use occasional idiomatic emphasis. Keep most sentences neutral.",
    "full": "Use regular idiomatic Russian engineering phrasing.",
    "ultra": "Use greater idiomatic intensity. Rhyming forms are allowed in this mode.",
}
ARTIFACT_RULE = (
    "Apply this style only to conversational prose. Keep authored project artifacts "
    "professional and free of profanity, including code comments, messages, "
    "documentation, commits, and PRs. Preserve the established language and style of "
    "the project and each artifact, including Russian where already used. Established "
    "project language requires no separate user request. Use English when no language "
    "convention exists, and follow explicit language requests or required localization. "
    "Preserve literal values, quotations, language-specific examples, and existing translations. "
    "Keep technical facts, tool calls, structured output, commands, identifiers, and "
    "error strings exact. Use literal, neutral wording for security warnings, data loss, "
    "irreversible operations, and recovery steps."
)


class PohuyError(Exception):
    pass


def data_dir(explicit=None):
    value = explicit or os.environ.get("PLUGIN_DATA")
    if not value:
        raise PohuyError("PLUGIN_DATA is unavailable. Pass the --data-dir supplied by a trusted plugin hook.")
    path = Path(value).expanduser()
    if not path.is_absolute():
        raise PohuyError("The plugin data directory must be an absolute path.")
    return path


def read_settings(directory):
    path = directory / "settings.json"
    try:
        settings = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return {"version": 1, "tier": "full"}
    except (ValueError, UnicodeError) as error:
        raise PohuyError(f"Invalid settings in {path}. Restore or repair this file before changing modes.") from error
    if (
        not isinstance(settings, dict)
        or type(settings.get("version")) is not int
        or settings["version"] != 1
        or settings.get("tier") not in TIERS
    ):
        raise PohuyError(f"Unsupported settings in {path}. Expected version 1 and a supported tier.")
    return settings


def atomic_write(path, content, mode=0o600):
    descriptor, temporary = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
    try:
        with os.fdopen(descriptor, "wb") as stream:
            os.fchmod(stream.fileno(), mode)
            stream.write(content)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def set_tier(directory, tier):
    settings = read_settings(directory)
    settings["tier"] = "off" if tier == "normal" else tier
    directory.mkdir(parents=True, exist_ok=True, mode=0o700)
    atomic_write(directory / "settings.json", (json.dumps(settings, indent=2) + "\n").encode())
    return settings["tier"]


def controller_context(directory):
    command = shlex.join(["python3", str(ROOT / "codex/pohuy.py"), "--data-dir", str(directory)])
    return (
        f"Pohuy controller command prefix: {command}\n"
        f"Pohuy plugin data directory: {directory}\n"
        "Append status to inspect the mode, or set off|lite|full|ultra to change it. "
        "The data directory comes from PLUGIN_DATA and is shared across this plugin's sessions."
    )


def mode_context(tier):
    if tier == "off":
        return (
            "Pohuy mode: off. Use ordinary chat without Pohuy styling. "
            "This supersedes all earlier Pohuy style instructions in this conversation.\n" + ARTIFACT_RULE
        )
    return (
        f"Pohuy mode: {tier}. This is the current authoritative mode and supersedes "
        f"earlier Pohuy mode selections. {TIER_GUIDANCE[tier]}\n{ARTIFACT_RULE}"
    )


def style_context(tier, directory):
    if tier == "off":
        return mode_context(tier) + "\n" + controller_context(directory)
    style = (ROOT / "codex/AGENTS-pohuy.md").read_text(encoding="utf-8")
    references = ROOT / "skills/pohuy/references"
    style = style.replace("~/.codex/pohuy/references/", str(references) + "/")
    style = style.replace("<!-- pohuy:start -->", "").replace("<!-- pohuy:end -->", "").strip()
    context = "\n\n".join([
        style,
        f"Bundled style references: {references}. Read the dictionary, scenes, or ontology "
        "when more examples are needed. Read huenitiv.md only for ultra mode.",
        mode_context(tier),
        controller_context(directory),
    ])
    if len(context) > MAX_CONTEXT_CHARS:
        raise PohuyError("The bundled style exceeds the plugin context limit.")
    return context


def prompt_tier(prompt):
    # Only a standalone command changes persisted settings; quoted commands are task data.
    match = re.fullmatch(r"(?:/pohuy|\$pohuy(?::pohuy)?)\s+(off|normal|lite|full|ultra)", prompt.strip())
    return match[1] if match else None


def session_context_path(directory, session_id):
    if not isinstance(session_id, str) or not session_id:
        raise PohuyError("Hook input must include a non-empty session_id.")
    key = hashlib.sha256(session_id.encode()).hexdigest()
    return directory / "sessions" / f"{key}.json"


def remembered_tier(path):
    try:
        tier = json.loads(path.read_text(encoding="utf-8"))
        return tier if tier in TIERS else None
    except (FileNotFoundError, ValueError, UnicodeError):
        return None


def run_hook(event, directory):
    payload = json.load(sys.stdin)
    if not isinstance(payload, dict) or payload.get("hook_event_name") != event:
        raise PohuyError("Hook input does not match the configured event.")
    session_path = session_context_path(directory, payload.get("session_id"))
    requested = None
    if event == "UserPromptSubmit":
        prompt = payload.get("prompt", "")
        if not isinstance(prompt, str):
            raise PohuyError("Hook prompt must be a string.")
        requested = prompt_tier(prompt)
    tier = read_settings(directory)["tier"]
    if requested:
        next_tier = "off" if requested == "normal" else requested
        context = style_context(next_tier, directory)
        set_tier(directory, requested)
        tier = next_tier
    elif event == "SessionStart" or remembered_tier(session_path) != tier:
        context = style_context(tier, directory)
    else:
        context = mode_context(tier) + "\n" + controller_context(directory)
    if event == "SessionStart" or remembered_tier(session_path) != tier:
        session_path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        atomic_write(session_path, json.dumps(tier).encode())
    return {"hookSpecificOutput": {"hookEventName": event, "additionalContext": context}}


def main(argv=None):
    parser = argparse.ArgumentParser(description="Manage the Pohuy Codex plugin.")
    parser.add_argument("--data-dir", help="Absolute PLUGIN_DATA path supplied by a plugin hook.")
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("status", help="Show the current saved mode.")
    setter = commands.add_parser("set", help="Save a mode and return its current chat context.")
    setter.add_argument("tier", choices=(*TIERS, "normal"))
    hook = commands.add_parser("hook", help="Read a Codex event from stdin and return hook JSON.")
    hook.add_argument("event", choices=("SessionStart", "UserPromptSubmit"))
    migration = commands.add_parser("migrate", help="Preview removal of the legacy installation.")
    migration.add_argument("--apply", action="store_true", help="Back up and apply the previewed changes.")
    migration.add_argument("--codex-home", type=Path, help="Legacy Codex configuration directory.")
    args = parser.parse_args(argv)
    try:
        if args.command == "migrate":
            from migration import migrate
            home = args.codex_home or Path(os.environ.get("CODEX_HOME") or os.environ.get("CODEX_DIR") or Path.home() / ".codex")
            result = migrate(home.expanduser().absolute(), args.apply)
        else:
            directory = data_dir(args.data_dir)
            if args.command == "hook":
                result = run_hook(args.event, directory)
            elif args.command == "status":
                result = {"tier": read_settings(directory)["tier"], "settings": str(directory / "settings.json")}
            else:
                tier = "off" if args.tier == "normal" else args.tier
                context = style_context(tier, directory)
                set_tier(directory, args.tier)
                result = {"tier": tier, "settings": str(directory / "settings.json"), "context": context}
        print(json.dumps(result, ensure_ascii=False))
        return 0
    except (PohuyError, OSError, ValueError, UnicodeError) as error:
        print(f"Pohuy: {error}", file=sys.stderr)
        if args.command == "hook":
            context = "Pohuy could not load its settings or style. Use ordinary chat for this turn; report the hook error. " + ARTIFACT_RULE
            print(json.dumps({"hookSpecificOutput": {"hookEventName": args.event, "additionalContext": context}}))
            return 0
        return 1


if __name__ == "__main__":
    sys.exit(main())
