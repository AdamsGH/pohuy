import { createHash, randomUUID } from 'node:crypto';
import { readFileSync, mkdirSync, openSync, writeFileSync, fsyncSync, closeSync, renameSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(moduleDirectory, path.basename(moduleDirectory) === 'dist' ? '../..' : '..');
export const TIERS = ['off', 'lite', 'full', 'ultra'] as const;
export type Tier = typeof TIERS[number];
export type Settings = { version: 1; tier: Tier; [key: string]: unknown };
export type Preferences = {
  autoApply: boolean;
  answerLength: 'short' | 'adaptive' | 'detailed';
  dryHumor: boolean;
  workingDictionary: boolean;
  calibrationExamples: boolean;
  rhymingForms: boolean;
};
export const DEFAULT_PREFERENCES: Preferences = {
  autoApply: true, answerLength: 'short', dryHumor: true,
  workingDictionary: true, calibrationExamples: true, rhymingForms: true,
};
export function preferences(settings: Settings): Preferences {
  const result = { ...DEFAULT_PREFERENCES };
  for (const key of Object.keys(result) as (keyof Preferences)[]) {
    const value = settings[key];
    if (value === undefined) continue;
    if (key === 'answerLength') {
      if (!['short', 'adaptive', 'detailed'].includes(value as string)) throw new Error('Некорректная настройка длины ответа.');
      result.answerLength = value as Preferences['answerLength'];
    } else {
      if (typeof value !== 'boolean') throw new Error(`Некорректная настройка: ${key}.`);
      result[key] = value;
    }
  }
  return result;
}
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
  preferences(settings as Settings);
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

export function updateSettings(directory: string, patch: Partial<Preferences & { tier: Tier }>, root = ROOT): Settings {
  const settings: Settings = { ...readSettings(directory), ...patch };
  if (!isTier(settings.tier)) throw new Error('Неизвестный режим Pohuy.');
  preferences(settings);
  styleContext(settings.tier, root, settings);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  atomicWrite(path.join(directory, 'settings.json'), JSON.stringify(settings, null, 2) + '\n');
  return settings;
}

export function setTier(directory: string, tier: Tier): Settings {
  if (!isTier(tier)) throw new Error('Неизвестный режим Pohuy.');
  return updateSettings(directory, { tier });
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

export function preferenceContext(settings: Settings): string {
  const p = preferences(settings);
  const length = {
    short: 'Keep replies short: lead with the result and include only necessary details. Explicit requests for detail take precedence.',
    adaptive: 'Match reply length to the task. Be concise for simple questions; explain reasoning and evidence when useful.',
    detailed: 'Give thorough explanations with reasoning, evidence, and useful examples. Keep the structure clear and follow explicit requests for brevity.',
  };
  return `Pohuy response preferences: ${length[p.answerLength]} ${p.dryHumor ? 'Dry, situational irony is allowed; keep it proportionate.' : 'Use direct, literal wording without jokes or sarcasm; idiomatic engineering emphasis remains allowed.'} ${p.rhymingForms && settings.tier === 'ultra' ? 'Rhyming forms are allowed in ultra mode.' : 'Rhyming forms are disabled.'} These preferences supersede conflicting conversational examples. Professional artifact wording and serious-warning clarity remain mandatory.`;
}

function filteredStyle(markdown: string, p: Preferences): string {
  const sections = markdown.split(/(?=^## )/m);
  const filtered = sections.filter(section => {
    if (section.startsWith('## Краткость') && p.answerLength !== 'short') return false;
    if (section.startsWith('## Словарь') && !p.workingDictionary) return false;
    if (section.startsWith('## Хуенитивы') && !p.rhymingForms) return false;
    if (section.startsWith('## Примеры калибровки') && !p.calibrationExamples) return false;
    return true;
  }).join('');
  // Replace the broad source pointer with a pointer to the enabled references only.
  return filtered.replace(/^Полный словарь[^\n]*\nтолько если[^\n]*\n/gm, '');
}

export function styleContext(tier: Tier, root = ROOT, settings: Settings = { version: 1, tier }): string {
  if (tier === 'off') return modeContext(tier);
  const references = path.join(root, 'skills/pohuy/references');
  const p = preferences(settings);
  const style = filteredStyle(readFileSync(path.join(root, 'codex/AGENTS-pohuy.md'), 'utf8'), p)
    .replaceAll('~/.codex/pohuy/references/', references + '/')
    .replaceAll('<!-- pohuy:start -->', '').replaceAll('<!-- pohuy:end -->', '').trim();
  const sources = [p.workingDictionary ? 'slovar.md' : '', p.calibrationExamples ? 'sceny.md' : '',
    p.rhymingForms && tier === 'ultra' ? 'huenitiv.md' : ''].filter(Boolean);
  const sourceContext = sources.length ? `Enabled style references in ${references}: ${sources.join(', ')}. Read only when needed.` : 'No optional reference sources are enabled.';
  const context = `${style}\n\n${sourceContext}\n\n${modeContext(tier)}\n${preferenceContext({ ...settings, tier })}`;
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
  const settings = { ...readSettings(directory), ...(requested ? { tier: requested } : {}) };
  const tier = settings.tier;
  const p = preferences(settings);
  const fingerprint = createHash('sha256').update(JSON.stringify({ tier, ...p })).digest('hex');
  let context: string;
  if (!p.autoApply && !requested) context = modeContext('off') + '\nAutomatic Pohuy activation is disabled. Apply the saved profile only when the user invokes Pohuy explicitly in this turn.';
  else context = requested || event === 'SessionStart' || previous !== fingerprint ? styleContext(tier, root, settings) : modeContext(tier) + '\n' + preferenceContext(settings);
  if (requested) updateSettings(directory, { tier }, root);
  if (previous !== fingerprint || event === 'SessionStart') {
    mkdirSync(path.dirname(sessionFile), { recursive: true, mode: 0o700 });
    atomicWrite(sessionFile, JSON.stringify(fingerprint));
  }
  return { hookSpecificOutput: { hookEventName: event, additionalContext: context } };
}
