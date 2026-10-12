import concurrent.futures
import importlib.util
import io
import json
import os
from pathlib import Path
import shlex
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch
from zipfile import ZipFile

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "codex"))
import migration
import pohuy

package_spec = importlib.util.spec_from_file_location("pohuy_package", ROOT / "codex/package.py")
packager = importlib.util.module_from_spec(package_spec)
package_spec.loader.exec_module(packager)


class PluginTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="pohuy test ")
        self.addCleanup(self.temporary.cleanup)
        self.home = Path(self.temporary.name)
        self.data = self.home / "plugin data"
        self.env = {key: value for key, value in os.environ.items() if key != "PLUGIN_DATA"}
        self.env["PLUGIN_DATA"] = str(self.data)

    def controller(self, *args, payload=None, env=None):
        return subprocess.run(
            [sys.executable, str(ROOT / "codex/pohuy.py"), *args],
            input=json.dumps(payload) if payload is not None else "",
            env=self.env if env is None else env, capture_output=True, text=True,
            cwd=self.home, timeout=10,
        )

    def hook(self, event="SessionStart", prompt=None, source="startup"):
        payload = {"hook_event_name": event, "session_id": "test", "source": source}
        if prompt is not None:
            payload["prompt"] = prompt
        result = self.controller("hook", event, payload=payload)
        self.assertEqual(result.returncode, 0, result.stderr)
        data = json.loads(result.stdout)
        self.assertEqual(data["hookSpecificOutput"]["hookEventName"], event)
        self.assertNotIn("decision", data)
        self.assertNotIn("continue", data)
        return data["hookSpecificOutput"]["additionalContext"], result.stderr

    def test_default_is_full_without_creating_settings(self):
        result = self.controller("status")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(result.stdout)["tier"], "full")
        self.assertFalse(self.data.exists())

    def test_all_modes_persist_and_apply_to_later_hooks(self):
        for tier in ("lite", "ultra", "off", "normal", "full"):
            with self.subTest(tier=tier):
                result = self.controller("set", tier)
                self.assertEqual(result.returncode, 0, result.stderr)
                expected = "off" if tier == "normal" else tier
                self.assertEqual(json.loads(self.controller("status").stdout)["tier"], expected)
                context, errors = self.hook()
                self.assertFalse(errors)
                self.assertIn(f"Pohuy mode: {expected}.", context)
                self.assertEqual("# Pohuy Style Active" in context, expected != "off")
        self.assertEqual((self.data / "settings.json").stat().st_mode & 0o777, 0o600)

    def test_context_restored_for_each_session_source(self):
        for source in ("startup", "resume", "clear", "compact"):
            with self.subTest(source=source):
                context, errors = self.hook(source=source)
                self.assertFalse(errors)
                self.assertIn("# Pohuy Style Active", context)
                self.assertIn("Established project language requires no separate user request.", context)
                self.assertNotIn("~/.codex/pohuy", context)
                self.assertNotIn("<!-- pohuy:", context)
                self.assertIn(str(ROOT / "skills/pohuy/references"), context)

    def test_prompt_reminder_is_shorter_than_full_style(self):
        full, _ = self.hook()
        reminder, _ = self.hook("UserPromptSubmit", "Explain the failing test.")
        self.assertLess(len(reminder), len(full) / 2)
        self.assertIn("Pohuy mode: full.", reminder)

    def test_standalone_commands_switch_without_model_execution(self):
        for command in ("/pohuy lite", "$pohuy off", "$pohuy:pohuy ultra", "  /pohuy normal\n"):
            with self.subTest(command=command):
                context, errors = self.hook("UserPromptSubmit", command)
                self.assertFalse(errors)
                expected = command.split()[-1]
                expected = "off" if expected == "normal" else expected
                self.assertEqual(json.loads(self.controller("status").stdout)["tier"], expected)
                self.assertIn(f"Pohuy mode: {expected}.", context)
                self.assertEqual("# Pohuy Style Active" in context, expected != "off")

    def test_task_data_does_not_switch_modes(self):
        for prompt in ('Review the command /pohuy off', '"/pohuy off"', '```\n/pohuy off\n```', '/pohuy off\nExplain this', '/pohuy invalid'):
            with self.subTest(prompt=prompt):
                self.hook("UserPromptSubmit", prompt)
                self.assertFalse((self.data / "settings.json").exists())

    def test_corrupt_or_unsupported_settings_do_not_reenable_or_overwrite(self):
        self.data.mkdir()
        path = self.data / "settings.json"
        for content in ('{', '[]', '{"version":2,"tier":"off"}', '{"version":true,"tier":"full"}', '{"version":1,"tier":null}'):
            with self.subTest(content=content):
                path.write_text(content)
                context, errors = self.hook("UserPromptSubmit", "/pohuy full")
                self.assertIn("ordinary chat", context)
                self.assertTrue(errors)
                self.assertNotIn("# Pohuy Style Active", context)
                self.assertEqual(self.controller("set", "full").returncode, 1)
                self.assertEqual(path.read_text(), content)

    def test_unknown_setting_keys_survive(self):
        self.data.mkdir()
        path = self.data / "settings.json"
        path.write_text(json.dumps({"version": 1, "tier": "off", "extra": {"enabled": False}}))
        self.assertEqual(self.controller("set", "lite").returncode, 0)
        self.assertEqual(json.loads(path.read_text())["extra"], {"enabled": False})

    def test_no_guessed_data_directory(self):
        env = {key: value for key, value in self.env.items() if key != "PLUGIN_DATA"}
        result = self.controller("set", "off", env=env)
        self.assertEqual(result.returncode, 1)
        self.assertIn("--data-dir", result.stderr)
        self.assertFalse(self.data.exists())
        result = self.controller("--data-dir", str(self.data), "set", "off", env=env)
        self.assertEqual(result.returncode, 0, result.stderr)
        result = self.controller("--data-dir", "relative", "status", env=env)
        self.assertEqual(result.returncode, 1)

    def test_controller_command_quotes_shell_metacharacters(self):
        directory = self.home / "data '$test`value"
        command = pohuy.controller_context(directory).splitlines()[0].split(": ", 1)[1]
        result = subprocess.run(command + " status", shell=True, env=self.env, cwd=self.home, capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(result.stdout)["settings"], str(directory / "settings.json"))

    def test_hook_bad_input_does_not_block_the_task(self):
        for payload in ([], {"hook_event_name": "Stop"}, {"hook_event_name": "UserPromptSubmit", "prompt": []}):
            result = self.controller("hook", "UserPromptSubmit", payload=payload)
            self.assertEqual(result.returncode, 0)
            self.assertTrue(result.stderr)
            self.assertIn("hookSpecificOutput", json.loads(result.stdout))

    def test_parallel_mode_changes_leave_valid_complete_json(self):
        with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
            results = list(pool.map(lambda tier: self.controller("set", tier), ["off", "full", "lite", "ultra"] * 4))
        self.assertTrue(all(result.returncode == 0 for result in results))
        self.assertIn(json.loads((self.data / "settings.json").read_text())["tier"], pohuy.TIERS)
        self.assertEqual(sorted(path.name for path in self.data.iterdir()), ["settings.json"])

    def test_source_failure_does_not_save_requested_mode(self):
        with patch.object(pohuy, "ROOT", self.home):
            with patch("sys.stdin", io.StringIO(json.dumps({"hook_event_name": "UserPromptSubmit", "session_id": "test", "prompt": "/pohuy ultra"}))):
                with self.assertRaises(FileNotFoundError):
                    pohuy.run_hook("UserPromptSubmit", self.data)
        self.assertFalse(self.data.exists())

    def test_mode_change_from_another_session_restores_the_style(self):
        self.controller("set", "off")
        context, _ = self.hook()
        self.assertNotIn("# Pohuy Style Active", context)
        self.controller("set", "full")
        context, _ = self.hook("UserPromptSubmit", "Continue working.")
        self.assertIn("# Pohuy Style Active", context)
        context, _ = self.hook("UserPromptSubmit", "Continue working.")
        self.assertNotIn("# Pohuy Style Active", context)

    def test_clean_package_contains_all_runtime_sources_and_no_workspace_files(self):
        destination = self.home / "marketplace"
        packager.build(destination)
        self.assertEqual(
            {str(path.relative_to(destination)) for path in destination.rglob("*") if path.is_file()},
            set(packager.FILES),
        )
        result = subprocess.run([sys.executable, str(destination / "codex/pohuy.py"), "set", "ultra"], env=self.env, capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn(str(destination / "skills/pohuy/references"), json.loads(result.stdout)["context"])
        with self.assertRaises(FileExistsError):
            packager.build(destination)

    def test_account_archive_excludes_marketplace_and_preserves_existing_files(self):
        source = packager.build(self.home / "marketplace")
        destination = self.home / "pohuy.zip"
        packager.archive_plugin(source, destination)
        with ZipFile(destination) as archive:
            self.assertIn("pohuy/.codex-plugin/plugin.json", archive.namelist())
            self.assertNotIn("pohuy/.agents/plugins/marketplace.json", archive.namelist())
            self.assertEqual(archive.read("pohuy/codex/pohuy.py"), (source / "codex/pohuy.py").read_bytes())
        original = destination.read_bytes()
        with self.assertRaises(FileExistsError):
            packager.archive_plugin(source, destination)
        self.assertEqual(destination.read_bytes(), original)
        with self.assertRaises(ValueError):
            packager.archive_plugin(source, source / "pohuy.zip")
        self.assertFalse((source / "pohuy.zip").exists())


class MigrationTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.home = Path(self.temporary.name)
        self.agents = self.home / "AGENTS.md"
        self.hooks = self.home / "hooks.json"
        output = {"hookSpecificOutput": {"hookEventName": "UserPromptSubmit", "additionalContext": migration.LEGACY_REMINDER}}
        self.handler = {"type": "command", "command": "echo " + shlex.quote(json.dumps(output)), "timeout": 5}

    def fixtures(self):
        self.agents.write_bytes(b"Keep before.\r\n\n<!-- pohuy:start -->\r\nLegacy style.\r\n<!-- pohuy:end -->\r\nKeep after.\n")
        self.other = {"type": "command", "command": "echo 'Keep this hook'"}
        self.hook_data = {"description": "Keep metadata.", "hooks": {
            "UserPromptSubmit": [{"matcher": "keep", "hooks": [self.handler, self.other]}, {"hooks": [self.handler]}],
            "SessionStart": [{"hooks": [self.other]}],
        }}
        self.hooks.write_text(json.dumps(self.hook_data))
        self.originals = {path.name: path.read_bytes() for path in (self.agents, self.hooks)}

    def test_preview_is_read_only(self):
        self.fixtures()
        result = migration.migrate(self.home)
        self.assertEqual(len(result["changed_files"]), 2)
        self.assertFalse(result["applied"])
        for path in (self.agents, self.hooks):
            self.assertEqual(path.read_bytes(), self.originals[path.name])
        self.assertFalse((self.home / "pohuy-migration-backups").exists())

    def test_apply_preserves_unrelated_text_and_mixed_hook_handlers(self):
        self.fixtures()
        self.agents.chmod(0o640)
        result = migration.migrate(self.home, apply=True)
        self.assertTrue(result["applied"])
        self.assertEqual(self.agents.read_bytes(), b"Keep before.\r\n\nKeep after.\n")
        data = json.loads(self.hooks.read_bytes())
        self.assertEqual(data["hooks"]["UserPromptSubmit"], [{"matcher": "keep", "hooks": [self.other]}])
        self.assertEqual(data["hooks"]["SessionStart"], self.hook_data["hooks"]["SessionStart"])
        self.assertEqual(data["description"], self.hook_data["description"])
        self.assertEqual(self.agents.stat().st_mode & 0o777, 0o640)
        for path in (self.agents, self.hooks):
            backup = Path(result["backup_dir"]) / path.name
            self.assertEqual(backup.read_bytes(), self.originals[path.name])
            self.assertEqual(backup.stat().st_mode & 0o777, 0o600)
        self.assertEqual(migration.migrate(self.home, apply=True)["changed_files"], [])

    def test_malformed_hook_file_prevents_instruction_write(self):
        self.fixtures()
        for content in ("{", "[]", '{"hooks":[]}', '{"hooks":{"UserPromptSubmit":[{"hooks":[1]}]}}'):
            with self.subTest(content=content):
                self.hooks.write_text(content)
                with self.assertRaises(ValueError):
                    migration.migrate(self.home, apply=True)
                self.assertEqual(self.agents.read_bytes(), self.originals["AGENTS.md"])
                self.assertFalse((self.home / "pohuy-migration-backups").exists())

    def test_unpaired_nested_or_inline_markers_stop_migration(self):
        for content in (b"<!-- pohuy:start -->\n", b"<!-- pohuy:end -->\n", b"<!-- pohuy:start -->\n<!-- pohuy:start -->\n<!-- pohuy:end -->", b"Prefix <!-- pohuy:start -->\n<!-- pohuy:end -->"):
            with self.subTest(content=content):
                self.agents.write_bytes(content)
                with self.assertRaises(ValueError):
                    migration.migrate(self.home, apply=True)
                self.assertEqual(self.agents.read_bytes(), content)

    def test_multiple_complete_blocks_are_removed(self):
        block = b"<!-- pohuy:start -->\nLegacy.\n<!-- pohuy:end -->\n"
        self.agents.write_bytes(block + b"Keep.\n" + block.rstrip(b"\n"))
        migration.migrate(self.home, apply=True)
        self.assertEqual(self.agents.read_bytes(), b"Keep.\n")

    def test_similar_unrelated_hook_is_preserved_byte_for_byte(self):
        self.hooks.write_text(json.dumps({"hooks": {"UserPromptSubmit": [{"hooks": [
            {"type": "command", "command": "echo 'Pohuy style is active but this is a different hook'"},
            {"type": "command", "command": self.handler["command"] + " && echo keep"},
        ]}]}}))
        original = self.hooks.read_bytes()
        self.assertEqual(migration.migrate(self.home, apply=True)["changed_files"], [])
        self.assertEqual(self.hooks.read_bytes(), original)

    def test_failure_on_second_write_restores_the_first(self):
        self.fixtures()
        writer = migration.atomic_write
        def fail_second(path, content, mode=0o600):
            if path == self.hooks:
                raise OSError("Simulated write failure")
            writer(path, content, mode)
        with patch.object(migration, "atomic_write", fail_second):
            with self.assertRaisesRegex(ValueError, "Originals are in"):
                migration.migrate(self.home, apply=True)
        for path in (self.agents, self.hooks):
            self.assertEqual(path.read_bytes(), self.originals[path.name])

    def test_symlink_is_preserved(self):
        target = self.home / "target.md"
        target.write_text("Keep.")
        self.agents.symlink_to(target)
        with self.assertRaisesRegex(ValueError, "symlink"):
            migration.migrate(self.home, apply=True)
        self.assertTrue(self.agents.is_symlink())
        self.assertEqual(target.read_text(), "Keep.")

    def test_empty_installation_is_noop(self):
        result = migration.migrate(self.home, apply=True)
        self.assertFalse(result["applied"])
        self.assertEqual(result["changed_files"], [])
        self.assertEqual(list(self.home.iterdir()), [])

    def test_actual_legacy_installer_can_be_migrated(self):
        self.agents.write_text("Keep the project instructions.\n")
        self.hooks.write_text(json.dumps({"hooks": {"SessionStart": []}}))
        result = subprocess.run(
            ["bash", str(ROOT / "install-codex.sh")],
            env={**os.environ, "CODEX_DIR": str(self.home)},
            cwd=ROOT, capture_output=True, text=True, timeout=10,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("<!-- pohuy:start -->", self.agents.read_text())
        result = subprocess.run(
            [sys.executable, str(ROOT / "codex/pohuy.py"), "migrate", "--codex-home", str(self.home), "--apply"],
            capture_output=True, text=True, timeout=10,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertTrue(json.loads(result.stdout)["applied"])
        self.assertNotIn("<!-- pohuy:", self.agents.read_text())
        self.assertTrue(self.agents.read_text().startswith("Keep the project instructions.\n"))
        self.assertEqual(json.loads(self.hooks.read_text())["hooks"], {"SessionStart": [], "UserPromptSubmit": []})
        self.assertTrue((self.home / "pohuy/references/slovar.md").is_file())


if __name__ == "__main__":
    unittest.main()
