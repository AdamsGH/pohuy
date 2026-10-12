import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "codex"))
import pohuy
import settings_mcp


class SettingsTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="pohuy settings ")
        self.addCleanup(self.temporary.cleanup)
        self.data = Path(self.temporary.name) / "plugin data"
        self.messages = []
        self.server = settings_mcp.Server(self.messages.append)
        self.initialize({"elicitation": {"form": {}}})

    def initialize(self, capabilities):
        self.server.handle({"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {
            "protocolVersion": "2025-11-25", "capabilities": capabilities}})
        self.messages.clear()

    def call(self, name="configure", request_id=2, **arguments):
        self.server.handle({"jsonrpc": "2.0", "id": request_id, "method": "tools/call", "params": {
            "name": name, "arguments": {"data_dir": str(self.data), **arguments}}})
        return self.messages[-1]

    def select(self, form, action="accept", content=None):
        self.server.handle({"jsonrpc": "2.0", "id": form["id"], "result": {
            "action": action, "content": content}})
        return self.messages[-1]["result"]

    def test_read_and_open_form_do_not_write_settings(self):
        result = self.call("status")["result"]["structuredContent"]
        self.assertEqual(result["tier"], "full")
        self.assertEqual(len(result["options"]), 4)
        form = self.call()
        self.assertEqual(form["method"], "elicitation/create")
        field = form["params"]["requestedSchema"]["properties"]["tier"]
        self.assertEqual(field["default"], "full")
        self.assertEqual({option["const"] for option in field["oneOf"]}, set(pohuy.TIERS))
        self.assertFalse(self.data.exists())

    def test_accepted_modes_persist_and_reach_hooks_after_restart(self):
        for tier in pohuy.TIERS:
            form = self.call()
            result = self.select(form, content={"tier": tier})
            self.assertFalse(result["isError"])
            self.assertTrue(result["structuredContent"]["saved"])
            process = subprocess.run([sys.executable, str(ROOT / "codex/pohuy.py"), "--data-dir", str(self.data), "hook", "SessionStart"],
                input=json.dumps({"hook_event_name": "SessionStart", "session_id": "restart"}),
                capture_output=True, text=True, timeout=5)
            self.assertEqual(process.returncode, 0, process.stderr)
            self.assertIn(f"Pohuy mode: {tier}.", json.loads(process.stdout)["hookSpecificOutput"]["additionalContext"])

    def test_cancel_and_decline_preserve_exact_settings(self):
        pohuy.set_tier(self.data, "off")
        original = (self.data / "settings.json").read_bytes()
        for action in ("cancel", "decline"):
            result = self.select(self.call(), action=action)
            self.assertFalse(result["structuredContent"]["saved"])
            self.assertTrue(result["structuredContent"]["cancelled"])
            self.assertEqual((self.data / "settings.json").read_bytes(), original)

    def test_invalid_form_responses_and_client_errors_cannot_write(self):
        for response in (None, {}, {"tier": "invalid"}, {"tier": []}, {"tier": "full", "extra": True}):
            self.assertTrue(self.select(self.call(), content=response)["isError"])
            self.assertFalse(self.data.exists())
        form = self.call()
        self.server.handle({"jsonrpc": "2.0", "id": form["id"], "error": {"code": -32601, "message": "Unsupported form"}})
        self.assertTrue(self.messages[-1]["result"]["isError"])
        self.assertFalse(self.data.exists())

    def test_unsupported_client_returns_choices_without_mutation(self):
        for capabilities in ({}, {"elicitation": {"url": {}}}):
            self.initialize(capabilities)
            result = self.call()["result"]["structuredContent"]
            self.assertTrue(result["selectionRequired"])
            self.assertFalse(result["saved"])
            self.assertEqual(len(result["options"]), 4)
            self.assertFalse(self.data.exists())

    def test_corrupt_settings_and_missing_style_are_preserved(self):
        self.data.mkdir()
        path = self.data / "settings.json"
        path.write_text("{invalid")
        self.assertTrue(self.call(tier="lite")["result"]["isError"])
        self.assertEqual(path.read_text(), "{invalid")
        path.unlink()
        with patch.object(settings_mcp, "style_context", side_effect=OSError("Missing style")):
            self.assertTrue(self.select(self.call(), content={"tier": "lite"})["isError"])
        self.assertFalse(path.exists())

    def test_protocol_cancellation_discards_late_accept_and_allows_ping(self):
        form = self.call()
        self.server.handle({"jsonrpc": "2.0", "id": 3, "method": "ping"})
        self.assertEqual(self.messages[-1]["result"], {})
        self.server.handle({"jsonrpc": "2.0", "method": "notifications/cancelled", "params": {"requestId": 2}})
        self.select(form, content={"tier": "ultra"})
        self.assertFalse(self.data.exists())
        self.assertFalse(self.server.pending)

    def test_explicit_mode_and_invalid_arguments(self):
        result = self.call(tier="off")["result"]["structuredContent"]
        self.assertTrue(result["saved"])
        self.assertEqual(pohuy.read_settings(self.data)["tier"], "off")
        for arguments in ({"tier": "normal"}, {"tier": None}, {"data_dir": "relative"}, {"data_dir": None}, {"unknown": True}):
            self.assertTrue(self.call(**arguments)["result"]["isError"])
        self.assertEqual(pohuy.read_settings(self.data)["tier"], "off")


if __name__ == "__main__":
    unittest.main()
