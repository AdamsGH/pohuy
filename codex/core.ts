import { createHash, randomUUID } from 'node:crypto';
import { readFileSync, mkdirSync, openSync, writeFileSync, fsyncSync, closeSync, renameSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = fileURLToPath(new URL('../../', import.meta.url));
export const TIERS = ['off', 'lite', 'full', 'ultra'] as const;
export type Tier = typeof TIERS[number];
export type Settings = { version: 1; tier: Tier; [key: string]: unknown };
export const ARTIFACT_RULE = 'Apply this style only to conversational prose. Keep authored project artifacts professional and free of profanity. Preserve the established language, style, terminology, literal values, quotations, examples, and translations of each artifact. Established Russian requires no separate request. Use English when no language convention exists. Follow explicit language and localization requests. Use neutral, literal wording for security, irreversible actions, and recovery.';

export function isTier(value: unknown): value is Tier {
  return TIERS.includes(value as Tier);
}

export function dataDirectory(explicit?: string): string {
  const value = explicit ?? process.env.PLUGIN_DATA ?? process.env.POHUY_DATA_DIR;
  if (!value || !path.isAbsolute(value)) throw new Error('Не задан абсолютный каталог данных плагина.');
  return path.resolve(value);
}

// Codex does not pass PLUGIN_DATA to bundled MCP processes in 0.162.1.
// Accept only its installed cache layout; source checkouts need an explicit directory.
export function serverDataDirectory(root = ROOT): string {
  if (process.env.PLUGIN_DATA || process.env.POHUY_DATA_DIR) return dataDirectory();
  const version = path.basename(root);
  const plugin = path.dirname(root);
  const marketplace = path.dirname(plugin);
  const cache = path.dirname(marketplace);
  if (!/^\d+\.\d+\.\d+(?:[-+].*)?$/.test(version) || path.basename(plugin) !== 'pohuy' ||
      path.basename(cache) !== 'cache' || path.basename(path.dirname(cache)) !== 'plugins') {
    throw new Error('Сервер запущен вне установленного пакета. Задай POHUY_DATA_DIR.');
  }
  return path.join(path.dirname(cache), 'data', `pohuy-${path.basename(marketplace)}`);
}

export function readSettings(directory: string): Settings {
  let settings: unknown;
  try { settings = JSON.parse(readFileSync(path.join(directory, 'settings.json'), 'utf8')); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { version: 1, tier: 'full' };
    throw new Error('Не удалось прочитать настройки Pohuy. Исправь файл до смены режима.', { cause: error });
  }
  if (!settings || typeof settings !== 'object' || Array.isArray(settings) ||
      (settings as Settings).version !== 1 || !isTier((settings as Settings).tier)) {
    throw new Error('Неподдерживаемый формат настроек Pohuy. Ожидается version: 1 и допустимый tier.');
  }
  return settings as Settings;
}

export function atomicWrite(filename: string, bytes: string | Buffer, mode = 0o600): void {
  const temporary = path.join(path.dirname(filename), `.${path.basename(filename)}.${randomUUID()}`);
  let fd: number | undefined;
  try {
    fd = openSync(temporary, 'wx', mode);
    writeFileSync(fd, bytes);
    fsyncSync(fd);
    closeSync(fd);
    fd = undefined;
    renameSync(temporary, filename);
  } finally {
    if (fd !== undefined) closeSync(fd);
    try { unlinkSync(temporary); } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
}

export function setTier(directory: string, tier: Tier): Settings {
  if (!isTier(tier)) throw new Error('Неизвестный режим Pohuy.');
  const settings = { ...readSettings(directory), tier };
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  atomicWrite(path.join(directory, 'settings.json'), JSON.stringify(settings, null, 2) + '\n');
  return settings;
}

export function modeContext(tier: Tier): string {
  const guidance = {
    off: 'Use ordinary chat without Pohuy styling. This supersedes earlier style instructions.',
    lite: 'Use occasional idiomatic Russian engineering emphasis. Keep most sentences neutral.',
    full: 'Use regular idiomatic Russian engineering phrasing.',
    ultra: 'Use greater idiomatic intensity, including the rhyming forms in the references.',
  };
  return `Pohuy mode: ${tier}. This is authoritative and supersedes earlier mode selections. ${guidance[tier]}\n${ARTIFACT_RULE}`;
}

export function styleContext(tier: Tier, root = ROOT): string {
  if (tier === 'off') return modeContext(tier);
  const references = path.join(root, 'skills/pohuy/references');
  const style = readFileSync(path.join(root, 'codex/AGENTS-pohuy.md'), 'utf8')
    .replaceAll('~/.codex/pohuy/references/', references + '/')
    .replaceAll('<!-- pohuy:start -->', '').replaceAll('<!-- pohuy:end -->', '').trim();
  const context = `${style}\n\nBundled style references: ${references}. Read huenitiv.md only for ultra mode.\n\n${modeContext(tier)}`;
  if (context.length > 24000) throw new Error('Стиль превышает лимит контекста плагина.');
  return context;
}

export function promptTier(prompt: string): Tier | undefined {
  const match = /^(?:\/pohuy|\$pohuy(?::pohuy)?)\s+(off|normal|lite|full|ultra)$/.exec(prompt.trim());
  return match ? match[1] === 'normal' ? 'off' : match[1] as Tier : undefined;
}

export function hook(event: string, payload: Record<string, unknown>, directory: string, root = ROOT) {
  if (!['SessionStart', 'UserPromptSubmit'].includes(event) || payload.hook_event_name !== event ||
      typeof payload.session_id !== 'string' || !payload.session_id) throw new Error('Некорректное событие хука.');
  if (event === 'UserPromptSubmit' && typeof payload.prompt !== 'string') throw new Error('Некорректный prompt хука.');
  const sessionFile = path.join(directory, 'sessions', createHash('sha256').update(payload.session_id).digest('hex') + '.json');
  let previous: unknown;
  try { previous = JSON.parse(readFileSync(sessionFile, 'utf8')); } catch { previous = undefined; }
  const requested = event === 'UserPromptSubmit' ? promptTier(payload.prompt as string) : undefined;
  const tier = requested ?? readSettings(directory).tier;
  const context = requested || event === 'SessionStart' || previous !== tier ? styleContext(tier, root) : modeContext(tier);
  if (requested) setTier(directory, tier);
  if (previous !== tier || event === 'SessionStart') {
    mkdirSync(path.dirname(sessionFile), { recursive: true, mode: 0o700 });
    atomicWrite(sessionFile, JSON.stringify(tier));
  }
  return { hookSpecificOutput: { hookEventName: event, additionalContext: context } };
}
