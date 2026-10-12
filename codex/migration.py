"""Remove only the legacy Pohuy instruction block and reminder handler."""

from datetime import datetime, timezone
import json
import re
import shlex
import stat
import uuid

from pohuy import atomic_write

LEGACY_REMINDER = (
    "Pohuy style is active. Remember to follow the specific guidelines of the "
    "Pohuy Style section in AGENTS.md."
)


def remove_blocks(content):
    tokens = list(re.finditer(rb"(?m)^<!-- pohuy:(start|end) -->\r?$", content))
    if len(tokens) != content.count(b"<!-- pohuy:start -->") + content.count(b"<!-- pohuy:end -->"):
        raise ValueError("Legacy Pohuy markers must occupy complete lines. Repair AGENTS.md before migration.")
    ranges = []
    start = None
    for token in tokens:
        if token[1] == b"start" and start is None:
            start = token.start()
        elif token[1] == b"end" and start is not None:
            end = token.end()
            if content[end:end + 1] == b"\n":
                end += 1
            ranges.append((start, end))
            start = None
        else:
            raise ValueError("Legacy Pohuy markers are unbalanced or nested. Repair AGENTS.md before migration.")
    if start is not None:
        raise ValueError("Legacy Pohuy markers are unbalanced. Repair AGENTS.md before migration.")
    for start, end in reversed(ranges):
        content = content[:start] + content[end:]
    return content


def is_legacy_reminder(handler):
    if handler.get("type") != "command" or not isinstance(handler.get("command"), str):
        return False
    try:
        parts = shlex.split(handler["command"])
        if len(parts) != 2 or parts[0] != "echo":
            return False
        output = json.loads(parts[1])
    except ValueError:
        return False
    return output == {"hookSpecificOutput": {
        "hookEventName": "UserPromptSubmit", "additionalContext": LEGACY_REMINDER,
    }}


def remove_reminder(content):
    data = json.loads(content)
    if not isinstance(data, dict) or not isinstance(data.get("hooks", {}), dict):
        raise ValueError("Legacy hooks.json must contain a hooks object.")
    groups = data.get("hooks", {}).get("UserPromptSubmit", [])
    if not isinstance(groups, list):
        raise ValueError("UserPromptSubmit must contain an array of hook groups.")
    remaining = []
    changed = False
    for group in groups:
        if not isinstance(group, dict) or not isinstance(group.get("hooks"), list):
            raise ValueError("Each UserPromptSubmit group must contain a hooks array.")
        if any(not isinstance(handler, dict) for handler in group["hooks"]):
            raise ValueError("Each hook handler must be an object.")
        handlers = [handler for handler in group["hooks"] if not is_legacy_reminder(handler)]
        if len(handlers) == len(group["hooks"]):
            remaining.append(group)
        else:
            changed = True
            if handlers:
                remaining.append({**group, "hooks": handlers})
    if not changed:
        return content
    data["hooks"]["UserPromptSubmit"] = remaining
    return (json.dumps(data, indent=2, ensure_ascii=False) + "\n").encode("utf-8")


def migrate(home, apply=False):
    changes = []
    for filename, transform in (("AGENTS.md", remove_blocks), ("hooks.json", remove_reminder)):
        path = home / filename
        if path.is_symlink():
            raise ValueError(f"Refusing to replace the symlink {path}. Migrate its target explicitly.")
        try:
            original = path.read_bytes()
        except FileNotFoundError:
            continue
        updated = transform(original)
        if updated != original:
            changes.append((path, original, updated, stat.S_IMODE(path.stat().st_mode)))
    result = {"applied": False, "changed_files": [str(change[0]) for change in changes], "backup_dir": None}
    if not apply or not changes:
        return result
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    backup = home / "pohuy-migration-backups" / f"{stamp}-{uuid.uuid4().hex[:8]}"
    backup.mkdir(parents=True, mode=0o700)
    for path, original, _, _ in changes:
        atomic_write(backup / path.name, original)
    installed = []
    try:
        for path, original, updated, mode in changes:
            if path.is_symlink() or path.read_bytes() != original:
                raise ValueError(f"{path} changed during migration. Close other writers and retry.")
            atomic_write(path, updated, mode)
            installed.append((path, original, mode))
    except (OSError, ValueError) as error:
        failures = []
        for path, original, mode in reversed(installed):
            try:
                atomic_write(path, original, mode)
            except OSError as restore_error:
                failures.append(str(restore_error))
        detail = f"Migration failed: {error}. Originals are in {backup}."
        if failures:
            detail += " Restore failed: " + "; ".join(failures)
        raise ValueError(detail) from error
    result.update(applied=True, backup_dir=str(backup))
    return result
