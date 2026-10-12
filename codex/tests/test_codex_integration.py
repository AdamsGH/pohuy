import importlib.util
import json
import os
from pathlib import Path
import shlex
import shutil
import subprocess
import tempfile
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import unittest
import uuid

from app_server import AppServer

ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location("pohuy_package", ROOT / "codex/package.py")
PACKAGER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(PACKAGER)


@unittest.skipUnless(os.environ.get("POHUY_CODEX_INTEGRATION") == "1" and shutil.which("codex"), "Set POHUY_CODEX_INTEGRATION=1 with codex on PATH to run integration tests.")
class CodexIntegrationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temporary = tempfile.TemporaryDirectory(prefix="pohuy codex integration ")
        cls.addClassCleanup(cls.temporary.cleanup)
        cls.root = Path(cls.temporary.name)
        cls.marketplace = PACKAGER.build(cls.root / "marketplace")
        cls.home = cls.root / "codex home"
        cls.home.mkdir()
        cls.workspace = cls.root / "workspace"
        cls.workspace.mkdir()
        cls.env = {**os.environ, "CODEX_HOME": str(cls.home)}
        cls.env.pop("PLUGIN_DATA", None)
        cls.requests = []

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *args):
                pass

            def do_POST(self):
                cls.requests.append(json.loads(self.rfile.read(int(self.headers["Content-Length"]))))
                response_id = "resp_" + uuid.uuid4().hex
                message = {"id": "msg_" + uuid.uuid4().hex, "type": "message", "role": "assistant", "status": "completed", "content": [{"type": "output_text", "text": "Verified.", "annotations": []}]}
                events = [
                    {"type": "response.created", "response": {"id": response_id, "status": "in_progress", "output": []}},
                    {"type": "response.output_item.added", "output_index": 0, "item": {**message, "status": "in_progress", "content": []}},
                    {"type": "response.output_text.delta", "item_id": message["id"], "output_index": 0, "content_index": 0, "delta": "Verified."},
                    {"type": "response.output_item.done", "output_index": 0, "item": message},
                    {"type": "response.completed", "response": {"id": response_id, "status": "completed", "output": [message], "usage": {"input_tokens": 10, "output_tokens": 2, "total_tokens": 12}}},
                ]
                body = "".join(f"event: {event['type']}\ndata: {json.dumps(event)}\n\n" for event in events).encode()
                self.send_response(200)
                self.send_header("Content-Type", "text/event-stream")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

        cls.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        cls.addClassCleanup(cls.server.server_close)
        cls.addClassCleanup(cls.server.shutdown)
        threading.Thread(target=cls.server.serve_forever, daemon=True).start()
        cls.port = cls.server.server_address[1]
        for args in (("plugin", "marketplace", "add", str(cls.marketplace)), ("plugin", "add", "pohuy@pohuy", "--json")):
            result = cls.codex(*args)
            if result.returncode:
                raise RuntimeError(result.stderr + result.stdout)
        cls.install = json.loads(result.stdout)

    @classmethod
    def codex(cls, *args):
        return subprocess.run(["codex", *args], input="", env=cls.env, cwd=cls.workspace, capture_output=True, text=True, timeout=30)

    def model_request(self, prompt, trust=True, resume=None):
        self.requests.clear()
        args = ["exec", "--json", "--skip-git-repo-check", "-c", 'model="pohuy-test"', "-c", 'model_provider="pohuy-test"', "-c", 'model_providers.pohuy-test.name="Pohuy test"', "-c", f'model_providers.pohuy-test.base_url="http://127.0.0.1:{self.port}/v1"', "-c", 'model_providers.pohuy-test.wire_api="responses"', "-c", 'model_providers.pohuy-test.requires_openai_auth=false', "-c", 'model_providers.pohuy-test.supports_websockets=false', "-c", 'features.apps=false']
        if trust:
            args.append("--dangerously-bypass-hook-trust")
        if resume:
            args.extend(["resume", resume])
        args.append(prompt)
        result = self.codex(*args)
        self.assertEqual(result.returncode, 0, result.stderr + result.stdout)
        self.assertEqual(len(self.requests), 1, result.stderr + result.stdout)
        events = [json.loads(line) for line in result.stdout.splitlines() if line.startswith("{")]
        self.assertTrue(any(event["type"] == "turn.completed" for event in events), result.stdout)
        thread_id = next(event["thread_id"] for event in events if event["type"] == "thread.started")
        text = "\n".join(chunk.get("text", "") for item in self.requests[0].get("input", []) if item.get("role") == "developer" for chunk in item.get("content", []) if isinstance(chunk, dict))
        return text, thread_id

    def test_install_loads_namespaced_skill_and_actual_hook_context(self):
        text, _ = self.model_request("Check plugin context.")
        self.assertIn("- pohuy:pohuy:", text)
        self.assertIn("# Pohuy Style Active", text)
        self.assertIn("Pohuy mode: full.", text)
        self.assertIn("Established project language requires no separate user request.", text)
        self.assertIn(self.install["installedPath"], text)
        self.assertNotIn("hook_outputs/", text)
        prefix = next(line.split(": ", 1)[1] for line in text.splitlines() if line.startswith("Pohuy controller command prefix: "))
        result = subprocess.run([*shlex.split(prefix), "status"], env=self.env, capture_output=True, text=True, timeout=10)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(result.stdout)["tier"], "full")

    def test_mode_commands_persist_and_resume_uses_saved_mode(self):
        text, _ = self.model_request("$pohuy:pohuy lite")
        self.assertIn("Pohuy mode: lite.", text)
        text, _ = self.model_request("$pohuy:pohuy ultra")
        self.assertIn("Pohuy mode: ultra.", text)
        text, _ = self.model_request("$pohuy:pohuy normal")
        self.assertIn("Pohuy mode: off.", text)
        text, thread_id = self.model_request("Check saved mode.")
        self.assertNotIn("# Pohuy Style Active", text)
        self.assertIn("Pohuy mode: off.", text)
        text, _ = self.model_request("Check resumed mode.", resume=thread_id)
        self.assertNotIn("# Pohuy Style Active", text)
        self.assertIn("Pohuy mode: off.", text)
        text, _ = self.model_request("$pohuy:pohuy full")
        self.assertIn("# Pohuy Style Active", text)
        self.assertIn("Pohuy mode: full.", text)

    def test_setup_discovers_onboarding_and_native_form_shares_hook_settings(self):
        text, _ = self.model_request("Check settings directory.")
        directory = next(line.split(": ", 1)[1] for line in text.splitlines() if line.startswith("Pohuy plugin data directory: "))
        client = AppServer(self.env, self.workspace)
        self.addCleanup(client.close)
        detail = client.call("plugin/read", {"marketplacePath": str(self.marketplace / ".agents/plugins/marketplace.json"), "pluginName": "pohuy"})["plugin"]
        installed = client.call("plugin/installed", {})["marketplaces"]
        listing = next(plugin for marketplace in installed for plugin in marketplace["plugins"] if plugin["id"] == "pohuy@pohuy")
        self.assertTrue(listing["installed"])
        self.assertTrue(listing["enabled"])
        interface = listing["interface"]
        self.assertEqual(interface["defaultPrompt"], ["Настрой режим общения Pohuy.", "Покажи текущий режим Pohuy.", "Выключи стиль Pohuy."])
        self.assertLessEqual(len(interface["shortDescription"]), 30)
        for field in ("logo", "composerIcon"):
            self.assertTrue(Path(interface[field]).is_file())
        self.assertTrue(detail["onboardingSkill"]["enabled"])
        self.assertEqual(detail["onboardingSkill"]["name"], "pohuy:pohuy")
        self.assertEqual(detail["onboardingSkill"]["interface"]["displayName"], "Настройка Pohuy")
        thread = client.call("thread/start", {"cwd": str(self.workspace), "ephemeral": True, "config": {"features.apps": False}})["thread"]["id"]
        servers = client.call("mcpServerStatus/list", {"threadId": thread})["data"]
        server = next(item for item in servers if item["name"] == "pohuy-settings")
        self.assertEqual(server["runtimeStatus"], "connected", server)
        self.assertEqual(server["pluginId"], "pohuy@pohuy")
        forms = []

        def choose(action, tier=None):
            def answer(message, app):
                if message.get("method") == "mcpServer/elicitation/request":
                    forms.append(message["params"])
                    content = {"tier": tier} if tier else None
                    app.send({"jsonrpc": "2.0", "id": message["id"], "result": {"action": action, "content": content}})
            return answer

        params = {"threadId": thread, "server": "pohuy-settings", "tool": "configure", "arguments": {"data_dir": directory}}
        path = Path(directory) / "settings.json"
        try:
            result = client.call("mcpServer/tool/call", params, callback=choose("accept", "lite"))
            self.assertTrue(result["structuredContent"]["saved"])
            self.assertEqual(json.loads(path.read_text())["tier"], "lite")
            field = forms[-1]["requestedSchema"]["properties"]["tier"]
            self.assertEqual(field["default"], "full")
            self.assertEqual({option["const"] for option in field["oneOf"]}, {"off", "lite", "full", "ultra"})
            original = path.read_bytes()
            for action in ("cancel", "decline"):
                result = client.call("mcpServer/tool/call", params, callback=choose(action))
                self.assertFalse(result["structuredContent"]["saved"])
                self.assertEqual(forms[-1]["requestedSchema"]["properties"]["tier"]["default"], "lite")
                self.assertEqual(path.read_bytes(), original)
            text, _ = self.model_request("Check mode saved by form.")
            self.assertIn("Pohuy mode: lite.", text)
        finally:
            client.call("mcpServer/tool/call", {**params, "arguments": {"data_dir": directory, "tier": "full"}})

    def test_untrusted_hooks_do_not_inject_or_change_saved_mode(self):
        text, _ = self.model_request("$pohuy:pohuy off", trust=False)
        self.assertNotIn("# Pohuy Style Active", text)
        self.assertNotIn("Pohuy mode: off.", text)
        text, _ = self.model_request("Check unchanged saved mode.")
        self.assertIn("Pohuy mode: full.", text)


if __name__ == "__main__":
    unittest.main()
