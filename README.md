# Pohuy для Codex

Готовый пакет 0.5.1 из [исходников a5ce200](https://github.com/AdamsGH/pohuy/tree/a5ce2002a9e3b27387334d3cf723776d59efa916).
Для запуска нужен Node.js 22.19 или новее. npm и ручная сборка не требуются.

Установка:

```sh
codex plugin marketplace add AdamsGH/pohuy --ref release/codex-plugin
codex plugin add pohuy@pohuy
```

После установки перезапусти открытый Codex Desktop, включи хуки и подтверди
доверие к двум хукам Pohuy. В новом чате выбери Pohuy и запусти настройку.
Параметры доступны в карточке плагина на клиентах с поддержкой openai/settings.

Подробности: [codex/README.md](./codex/README.md).
