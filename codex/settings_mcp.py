#!/usr/bin/env python3
"""Expose local Pohuy settings through MCP tools and a native selection form."""

import json
import sys

from pohuy import PohuyError, TIERS, data_dir, read_settings, set_tier, style_context

OPTIONS = (
    ("off", "Выключен", "Обычное общение без стиля Pohuy."),
    ("lite", "Легкий", "Редкие идиоматические акценты."),
    ("full", "Обычный", "Регулярная инженерная лексика Pohuy. Режим по умолчанию."),
    ("ultra", "Интенсивный", "Больше идиом, включая рифмованные формы."),
)
SCHEMA = {
    "type": "object",
    "properties": {
        "data_dir": {
            "type": "string",
            "description": "Exact Pohuy plugin data directory from the trusted hook context. Never guess this path.",
        },
    },
    "required": ["data_dir"],
    "additionalProperties": False,
}


def tool_result(value, error=False):
    return {
        "content": [{"type": "text", "text": json.dumps(value, ensure_ascii=False)}],
        "structuredContent": value,
        "isError": error,
    }


def status(directory):
    return {
        "tier": read_settings(directory)["tier"],
        "scope": "Все проекты и будущие чаты этого плагина.",
        "options": [{"tier": tier, "title": title, "description": description} for tier, title, description in OPTIONS],
    }


def save(directory, tier):
    # Prepare context before writing so a damaged package cannot save an unusable mode.
    context = style_context(tier, directory)
    set_tier(directory, tier)
    return {"tier": tier, "saved": True, "context": context}


class Server:
    def __init__(self, emit):
        self.emit = emit
        self.initialized = False
        self.forms = False
        self.pending = {}
        self.sequence = 0

    def reply(self, request_id, result):
        self.emit({"jsonrpc": "2.0", "id": request_id, "result": result})

    def error(self, request_id, code, message):
        self.emit({"jsonrpc": "2.0", "id": request_id, "error": {"code": code, "message": message}})

    def tools(self):
        configure_schema = {**SCHEMA, "properties": {
            **SCHEMA["properties"],
            "tier": {"type": "string", "enum": list(TIERS), "description": "Only supply a mode explicitly selected by the user. Omit to open the selection form."},
        }}
        return [{
            "name": name,
            "description": description,
            "inputSchema": schema,
            "annotations": {"readOnlyHint": readonly, "destructiveHint": False, "idempotentHint": readonly, "openWorldHint": False},
        } for name, description, schema, readonly in (
            ("status", "Показать текущий режим Pohuy и доступные варианты без изменения настроек.", SCHEMA, True),
            ("configure", "Настроить Pohuy: без tier открыть форму выбора; с явно выбранным tier сохранить режим. Отмена формы сохраняет прежние настройки.", configure_schema, False),
        )]

    def call_tool(self, request_id, params):
        name = params.get("name")
        if name not in ("status", "configure"):
            raise PohuyError("Unknown settings tool.")
        arguments = params.get("arguments", {})
        allowed = {"data_dir", "tier"} if name == "configure" else {"data_dir"}
        if not isinstance(arguments, dict) or set(arguments) - allowed:
            raise PohuyError("Invalid settings tool arguments.")
        value = arguments.get("data_dir")
        if not isinstance(value, str) or not value:
            raise PohuyError("Supply the exact plugin data directory from the trusted Pohuy hook context.")
        directory = data_dir(value)
        current = status(directory)
        if name == "status":
            self.reply(request_id, tool_result(current))
        elif "tier" in arguments:
            tier = arguments["tier"]
            if not isinstance(tier, str) or tier not in TIERS:
                raise PohuyError("Unsupported Pohuy mode.")
            self.reply(request_id, tool_result(save(directory, tier)))
        elif not self.forms:
            self.reply(request_id, tool_result({**current, "saved": False, "selectionRequired": True,
                "message": "Клиент не поддерживает форму выбора. Покажи варианты в чате и дождись выбора пользователя."}))
        else:
            self.sequence += 1
            elicitation_id = f"pohuy-selection-{self.sequence}"
            self.pending[elicitation_id] = (request_id, directory)
            self.emit({"jsonrpc": "2.0", "id": elicitation_id, "method": "elicitation/create", "params": {
                "mode": "form",
                "message": f"Настройка Pohuy. Текущий режим: {current['tier']}. Выбор действует во всех проектах и будущих чатах. Отмена оставляет настройки без изменений.",
                "requestedSchema": {
                    "type": "object",
                    "properties": {"tier": {
                        "type": "string", "title": "Режим общения", "default": current["tier"],
                        "oneOf": [{"const": tier, "title": f"{title} ({tier}). {description}"} for tier, title, description in OPTIONS],
                    }},
                    "required": ["tier"],
                },
            }})

    def selection(self, message):
        request_id, directory = self.pending.pop(message["id"])
        try:
            if "error" in message:
                raise PohuyError("The client could not display the selection form. No settings were changed.")
            result = message.get("result")
            if not isinstance(result, dict):
                raise PohuyError("Invalid selection response. No settings were changed.")
            action = result.get("action")
            if action in ("cancel", "decline"):
                self.reply(request_id, tool_result({**status(directory), "saved": False, "cancelled": True}))
            elif action == "accept":
                content = result.get("content")
                if not isinstance(content, dict) or set(content) != {"tier"} or not isinstance(content["tier"], str) or content["tier"] not in TIERS:
                    raise PohuyError("Invalid selected mode. No settings were changed.")
                self.reply(request_id, tool_result(save(directory, content["tier"])))
            else:
                raise PohuyError("Unsupported selection action. No settings were changed.")
        except (PohuyError, OSError, ValueError, UnicodeError) as error:
            self.reply(request_id, tool_result({"error": str(error), "saved": False}, error=True))

    def handle(self, message):
        if not isinstance(message, dict) or message.get("jsonrpc") != "2.0":
            self.error(None, -32600, "Invalid JSON-RPC message.")
            return
        request_id = message.get("id")
        if "method" not in message:
            if isinstance(request_id, (str, int)) and request_id in self.pending:
                self.selection(message)
            return
        method = message["method"]
        params = message.get("params", {})
        if not isinstance(params, dict):
            if "id" in message:
                self.error(request_id, -32602, "Parameters must be an object.")
            return
        if method == "notifications/cancelled":
            cancelled = params.get("requestId")
            self.pending = {key: value for key, value in self.pending.items() if value[0] != cancelled}
            return
        if "id" not in message:
            return
        if method == "initialize":
            version = params.get("protocolVersion")
            version = version if version in ("2025-03-26", "2025-06-18", "2025-11-25") else "2025-11-25"
            capabilities = params.get("capabilities", {})
            elicitation = capabilities.get("elicitation") if isinstance(capabilities, dict) else None
            self.forms = isinstance(elicitation, dict) and ("form" in elicitation or elicitation == {})
            self.initialized = True
            self.reply(request_id, {"protocolVersion": version, "capabilities": {"tools": {}},
                "serverInfo": {"name": "pohuy-settings", "version": "0.1.0"}})
        elif method == "ping":
            self.reply(request_id, {})
        elif not self.initialized:
            self.error(request_id, -32600, "Initialize the settings server first.")
        elif method == "tools/list":
            self.reply(request_id, {"tools": self.tools()})
        elif method == "tools/call":
            try:
                self.call_tool(request_id, params)
            except (PohuyError, OSError, ValueError, UnicodeError) as error:
                self.reply(request_id, tool_result({"error": str(error), "saved": False}, error=True))
        else:
            self.error(request_id, -32601, "Unknown MCP method.")


def main():
    def emit(message):
        print(json.dumps(message, ensure_ascii=False), flush=True)

    server = Server(emit)
    for line in sys.stdin:
        try:
            message = json.loads(line)
        except ValueError:
            server.error(None, -32700, "Invalid JSON.")
            continue
        server.handle(message)


if __name__ == "__main__":
    main()
