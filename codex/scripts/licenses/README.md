# Лицензии сборочных зависимостей

`cfworker.txt` содержит MIT License для `@cfworker/json-schema` 4.1.1.
Пакет используется валидатором форм в `@openai/mcp-extensions` и нашими тестами
JSON Schema. Это библиотека проверки схем, без подключения к Cloudflare.

В опубликованный npm-пакет 4.1.1 файл лицензии не включён. Копия взята из
[исходного репозитория](https://github.com/cfworker/cfworker/blob/master/LICENSE.md).
Сборщик добавляет её в `dist/THIRD_PARTY_LICENSES.txt`, только если библиотека
попала в bundle. Лицензии остальных зависимостей читаются из их npm-пакетов.
