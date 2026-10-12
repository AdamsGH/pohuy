import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const available = spawnSync('codex', ['--version']).status === 0;

class AppServer {
  child;
  sequence = 0;
  pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }>();
  constructor(env: NodeJS.ProcessEnv, cwd: string) {
    this.child = spawn('codex', ['app-server', '--stdio'], { env, cwd, stdio: ['pipe', 'pipe', 'pipe'] });
    this.child.stderr.resume();
    createInterface({ input: this.child.stdout }).on('line', line => {
      const message = JSON.parse(line);
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id); clearTimeout(pending.timer);
      if (message.error) pending.reject(new Error(JSON.stringify(message.error))); else pending.resolve(message.result);
    });
    this.child.on('exit', () => {
      for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(new Error('App server exited.')); }
      this.pending.clear();
    });
  }
  call(method: string, params: unknown): Promise<any> {
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`Timeout: ${method}`)); }, 20000);
      this.pending.set(id, { resolve, reject, timer });
      this.child.stdin.write(JSON.stringify({ id, method, params }) + '\n');
    });
  }
  close() { this.child.stdin.end(); this.child.kill(); }
}

test('Codex discovers compatibility hooks and onboarding from a clean installed package', { skip: !available, timeout: 60000 }, async t => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'pohuy-codex-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const market = path.join(dir, 'market'); const home = path.join(dir, 'home');
  mkdirSync(home); writeFileSync(path.join(home, 'config.toml'), '[features]\nhooks = true\n');
  const env: NodeJS.ProcessEnv = { ...process.env, CODEX_HOME: home };
  delete env.PLUGIN_DATA; delete env.POHUY_DATA_DIR;
  for (const [command, args] of [
    [process.execPath, [path.join(ROOT, 'codex/package.mjs'), market, '--compat']],
    ['codex', ['plugin', 'marketplace', 'add', market]],
    ['codex', ['plugin', 'add', 'pohuy@pohuy', '--json']],
  ] as const) {
    const result = spawnSync(command, [...args], { env, cwd: dir, encoding: 'utf8', timeout: 20000 });
    assert.equal(result.status, 0, result.stderr);
  }
  const app = new AppServer(env, dir); t.after(() => app.close());
  await app.call('initialize', { clientInfo: { name: 'pohuy-test', version: '1.0.0' }, capabilities: { experimentalApi: true } });
  const result = await app.call('hooks/list', { cwds: [dir] });
  const hooks = result.data.flatMap((item: any) => item.hooks);
  assert.equal(hooks.length, 2, JSON.stringify(result));
  assert.ok(hooks.every((h: any) => h.handlerType === 'command' && h.command.startsWith('node ')));
  const detail = (await app.call('plugin/read', { marketplacePath: path.join(market, '.agents/plugins/marketplace.json'), pluginName: 'pohuy' })).plugin;
  assert.equal(detail.onboardingSkill.name, 'pohuy:setup');
  assert.equal(detail.onboardingSkill.enabled, true);
  const thread = (await app.call('thread/start', { cwd: dir, ephemeral: true, config: { 'features.apps': false } })).thread.id;
  const servers = await app.call('mcpServerStatus/list', { threadId: thread });
  assert.equal(servers.data.find((s: any) => s.name === 'pohuy-settings')?.runtimeStatus, 'connected', JSON.stringify(servers));
  const resultRead = await app.call('mcpServer/tool/call', { threadId: thread, server: 'pohuy-settings', tool: 'settings.read', arguments: {} });
  assert.equal(resultRead.structuredContent.values.tier, 'full');
  const update = await app.call('mcpServer/tool/call', { threadId: thread, server: 'pohuy-settings', tool: 'settings.update', arguments: { set: { tier: 'lite' } } });
  assert.equal(update.structuredContent.values.tier, 'lite');
});
