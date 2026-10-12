import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { OpenAIExtensions } from '@openai/mcp-extensions/server';
import { z } from 'zod';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT, TIERS, readSettings, setTier, serverDataDirectory, styleContext } from './core.js';

export function createServer(directory: string, root = ROOT) {
  const manifest = JSON.parse(readFileSync(path.join(root, '.codex-plugin/plugin.json'), 'utf8'));
  const server = new McpServer({ name: 'pohuy-settings', version: manifest.version });
  const extensions = new OpenAIExtensions(server);
  extensions.settings.register({
    fields: {
      tier: {
        schema: z.enum(TIERS),
        title: 'Режим общения',
        description: 'off: выключен; lite: лёгкий; full: обычный; ultra: интенсивный. Сохраняется для будущих чатов этого плагина на текущем хосте.',
      },
    },
    layout: [{ kind: 'group', title: 'Pohuy', items: [{ kind: 'property', property: 'tier' }, { kind: 'tool', tool: 'pohuy.context', title: 'Применить текущий режим' }] }],
    read: () => ({ tier: readSettings(directory).tier }),
    update: (set) => {
      const tier = set.tier ?? readSettings(directory).tier;
      styleContext(tier, root);
      return { tier: setTier(directory, tier).tier };
    },
  });
  server.registerTool('pohuy.context', {
    title: 'Применить текущий режим',
    description: 'Прочитать сохранённый режим и инструкции Pohuy для текущего чата. Вызови после настройки и при явном включении плагина.',
    inputSchema: z.strictObject({}),
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  }, async () => {
    const tier = readSettings(directory).tier;
    return { content: [{ type: 'text', text: styleContext(tier, root) }], structuredContent: { tier, scope: 'Будущие чаты этого плагина на текущем хосте.' } };
  });
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try { await createServer(serverDataDirectory()).connect(new StdioServerTransport()); }
  catch (error) { console.error(`Pohuy: ${(error as Error).message}`); process.exitCode = 1; }
}
