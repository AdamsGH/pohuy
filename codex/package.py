#!/usr/bin/env python3
"""Build a clean local marketplace without copying unrelated workspace files."""

import argparse
from pathlib import Path
import shutil
import sys
from zipfile import ZipFile, ZIP_DEFLATED

ROOT = Path(__file__).resolve().parent.parent
FILES = (
    ".codex-plugin/plugin.json",
    "assets/icon.svg",
    "assets/icon.png",
    "docs/assets/pohuy.webp",
    "codex/mcp.json",
    ".agents/plugins/marketplace.json",
    "codex/AGENTS-pohuy.md",
    "codex/hooks.json",
    "codex/pohuy.py",
    "codex/settings_mcp.py",
    "codex/skills/pohuy/agents/openai.yaml",
    "codex/migration.py",
    "codex/README.md",
    "codex/skills/pohuy/SKILL.md",
    "skills/pohuy/references/slovar.md",
    "skills/pohuy/references/sceny.md",
    "skills/pohuy/references/ontologia.md",
    "skills/pohuy/references/huenitiv.md",
    "LICENSE",
)


def build(destination):
    for relative in FILES:
        if not (ROOT / relative).is_file():
            raise FileNotFoundError(f"Required package file is missing: {relative}")
    destination.mkdir(parents=True, exist_ok=False)
    try:
        for relative in FILES:
            target = destination / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(ROOT / relative, target)
    except OSError:
        shutil.rmtree(destination)
        raise
    return destination


def archive_plugin(source, destination):
    source = source.resolve()
    destination = destination.resolve()
    if destination.is_relative_to(source):
        raise ValueError("The archive must be outside the plugin directory.")
    with ZipFile(destination, "x", ZIP_DEFLATED) as archive:
        try:
            for relative in FILES:
                if relative != ".agents/plugins/marketplace.json":
                    archive.write(source / relative, str(Path("pohuy") / relative))
        except OSError:
            destination.unlink()
            raise
    return destination


def main():
    parser = argparse.ArgumentParser(description="Build a clean Pohuy Codex marketplace.")
    parser.add_argument("destination", type=Path, help="A new directory for the installable marketplace.")
    parser.add_argument("--archive", type=Path, help="Also write a new plugin ZIP outside the marketplace, without its catalog.")
    args = parser.parse_args()
    try:
        source = build(args.destination.expanduser().absolute())
        print(f"Marketplace ready: {source}")
        if args.archive:
            print(f"Plugin archive ready: {archive_plugin(source, args.archive.expanduser().absolute())}")
        return 0
    except (OSError, ValueError) as error:
        print(f"Pohuy package: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
