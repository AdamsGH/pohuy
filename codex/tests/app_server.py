"""Bounded app-server client for isolated plugin integration checks."""

import json
import queue
import subprocess
import threading
import time


class AppServer:
    def __init__(self, env, cwd):
        self.process = subprocess.Popen(
            ["codex", "app-server", "--stdio"], env=env, cwd=cwd,
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
            text=True,
        )
        self.messages = queue.Queue()
        self.sequence = 0

        def read():
            for line in self.process.stdout:
                try:
                    self.messages.put(json.loads(line))
                except ValueError:
                    continue

        self.reader = threading.Thread(target=read, daemon=True)
        self.reader.start()
        try:
            self.call("initialize", {"clientInfo": {"name": "pohuy-test", "version": "0.1.0"},
                "capabilities": {"experimentalApi": True}})
            self.send({"jsonrpc": "2.0", "method": "initialized"})
        except Exception:
            self.close()
            raise

    def send(self, message):
        self.process.stdin.write(json.dumps(message) + "\n")
        self.process.stdin.flush()

    def call(self, method, params, callback=None, timeout=25):
        self.sequence += 1
        request_id = self.sequence
        self.send({"jsonrpc": "2.0", "id": request_id, "method": method, "params": params})
        deadline = time.monotonic() + timeout
        while True:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise TimeoutError(f"App-server did not complete {method}.")
            message = self.messages.get(timeout=remaining)
            if message.get("id") == request_id and "method" not in message:
                if "error" in message:
                    raise RuntimeError(message["error"])
                return message["result"]
            if callback:
                callback(message, self)

    def close(self):
        self.process.stdin.close()
        try:
            self.process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            self.process.kill()
            self.process.wait()
        self.reader.join(timeout=2)
        self.process.stdout.close()
