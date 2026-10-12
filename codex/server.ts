import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { OpenAIExtensions } from '@openai/mcp-extensions/server';
import { z } from 'zod';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT, readSettings, updateSettings, preferences, serverDataDirectory, styleContext, type Settings, type Tier, type Preferences } from './core.js';

const MODES = { 'Выключен': 'off', 'Лёгкий': 'lite', 'Обычный': 'full', 'Интенсивный': 'ultra' } as const;
const LENGTHS = { 'Кратко': 'short', 'По задаче': 'adaptive', 'Подробно': 'detailed' } as const;
function values(settings: Settings) {
  const p = preferences(settings);
  return { ...p,
    mode: Object.keys(MODES).find(key => MODES[key as keyof typeof MODES] === settings.tier) as keyof typeof MODES,
    answerLength: Object.keys(LENGTHS).find(key => LENGTHS[key as keyof typeof LENGTHS] === p.answerLength) as keyof typeof LENGTHS,
  };
}

export function createServer(directory: string, root = ROOT) {
  const manifest = JSON.parse(readFileSync(path.join(root, '.codex-plugin/plugin.json'), 'utf8'));
  const server = new McpServer({ name: 'pohuy-settings', version: manifest.version });
  const extensions = new OpenAIExtensions(server);
  extensions.settings.register({
    fields: {
      mode: {
        schema: z.enum(['Выключен', 'Лёгкий', 'Обычный', 'Интенсивный']),
        title: 'Интенсивность',
        description: 'От обычного общения до насыщенной инженерной лексики.',
      },
      autoApply: { schema: z.boolean(), title: 'Включать автоматически', description: 'Применять во всех чатах на этом хосте. При отключении вызывай Pohuy вручную.' },
      answerLength: { schema: z.enum(['Кратко', 'По задаче', 'Подробно']), title: 'Длина ответа', description: 'Явная просьба о подробности или краткости имеет приоритет.' },
      dryHumor: { schema: z.boolean(), title: 'Сухая ирония', description: 'Ситуативные шутки и сарказм в обычном разговоре.' },
      workingDictionary: { schema: z.boolean(), title: 'Рабочий словарь', description: 'Базовая лексика и доступ к расширенному словарю.' },
      calibrationExamples: { schema: z.boolean(), title: 'Примеры калибровки', description: 'Эталонные ответы и сцены для настройки тона.' },
      rhymingForms: { schema: z.boolean(), title: 'Рифмованные формы', description: 'Дополнительные формы только в интенсивном режиме.' },
    },
    layout: [
      { kind: 'group', title: 'Общение', items: [{ kind: 'property', property: 'mode' }, { kind: 'property', property: 'autoApply' }] },
      { kind: 'group', title: 'Ответы', items: [{ kind: 'property', property: 'answerLength' }, { kind: 'property', property: 'dryHumor' }] },
      { kind: 'group', title: 'Справочники', items: [{ kind: 'property', property: 'workingDictionary' }, { kind: 'property', property: 'calibrationExamples' }, { kind: 'property', property: 'rhymingForms' }] },
    ],
    read: () => values(readSettings(directory)),
    update: (set) => {
      const { mode, answerLength, ...booleans } = set;
      const patch: Partial<Preferences & { tier: Tier }> = { ...booleans };
      if (mode !== undefined) patch.tier = MODES[mode];
      if (answerLength !== undefined) patch.answerLength = LENGTHS[answerLength];
      return values(updateSettings(directory, patch, root));
    },
  });
  server.registerTool('pohuy.context', {
    title: 'Применить текущий режим',
    description: 'Прочитать сохранённый режим и инструкции Pohuy для текущего чата. Вызови после настройки и при явном включении плагина.',
    inputSchema: z.strictObject({}),
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  }, async () => {
    const settings = readSettings(directory);
    return { content: [{ type: 'text', text: styleContext(settings.tier, root, settings) }], structuredContent: { tier: settings.tier, values: values(settings), scope: 'Будущие чаты этого плагина на текущем хосте.' } };
  });
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try { await createServer(serverDataDirectory()).connect(new StdioServerTransport()); }
  catch (error) { console.error(`Pohuy: ${(error as Error).message}`); process.exitCode = 1; }
}
