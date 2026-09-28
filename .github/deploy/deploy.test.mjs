import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const shell = process.env.DEPLOY_TEST_SHELL || 'sh';
const names = { '3d': '100my-page', '2d': '100my-page-2d', ai: '100my-page-ai' };
const script = fileURLToPath(new URL('deploy.sh', import.meta.url));
function shellPath(value) {
  if (process.platform !== 'win32') return value;
  const result = spawnSync(shell, ['-c', 'cygpath -u "$1"', 'probe', value], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}
async function deployment(t, component, failure = '', options = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'split-deploy-test-'));
  t.after(async () => {
    assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
    assert.match(path.basename(root), /^split-deploy-test-/);
    await rm(root, { recursive: true, force: true });
  });
  await mkdir(path.join(root, 'state'));
  const initial = { '100my-page': 'old-web', '100my-page-2d': 'old-2d', '100my-page-ai': 'old-ai', '102my-react-playground': 'untouched' };
  for (const missing of options.missing || []) delete initial[missing];
  if (options.backup) initial[names[component] + '-previous'] = 'retained-backup';
  for (const [name, value] of Object.entries(initial)) await writeFile(path.join(root, 'state', name), value);
  await writeFile(path.join(root, '3dai.env'), 'MOCK_ONLY=1\n');
  await writeFile(path.join(root, 'sleep'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  await writeFile(path.join(root, 'flock'), '#!/bin/sh\nprintf "lock\\n" >> "$MOCK_ROOT/commands"\n[ "$FAILURE" != lock ]\n', { mode: 0o755 });
  await writeFile(path.join(root, 'docker'), `#!/bin/sh
printf '%s\\n' "$*" >> "$MOCK_ROOT/commands"
if [ "$1" = --config ]; then shift 2; fi
state="$MOCK_ROOT/state"
case "$1" in
 container) test -f "$state/$3" ;;
 network) if [ "$2" = connect ] && [ "$FAILURE" = network ]; then exit 1; fi ;;
 login) cat >/dev/null ;;
 pull) [ "$FAILURE" != pull ] ;;
 run) [ "$FAILURE" != validate ] ;;
 inspect)
   if [ "$3" = '{{.State.Running}}' ]; then printf true
   elif [ "$3" = '{{.Image}}' ]; then printf sha256:exact-previous
   elif [ "$FAILURE" = health ] && [ "$4" = "$TARGET" ]; then printf unhealthy
   elif [ "$FAILURE" = seed-health ] && [ "$4" = 100my-page-2d ]; then printf unhealthy
   else printf healthy; fi ;;
 rename) mv "$state/$2" "$state/$3" ;;
 stop) exit 0 ;;
 create)
   shift; while [ "$1" != --name ]; do shift; done
   if [ "$FAILURE" = create ] && [ "$2" = "$TARGET" ]; then exit 1; fi
   printf new > "$state/$2" ;;
 start)
   if [ "$FAILURE" = start ] && [ "$2" = "$TARGET" ] && [ "$(cat "$state/$2")" = new ]; then exit 1; fi ;;
 exec)
   case "$*" in
     *'test -s'*) [ "$FAILURE" != legacy-missing ] ;;
     *check-assets.sh*) [ "$FAILURE" != assets ] ;;
     *curl*) [ "$FAILURE" != proxy ] ;;
     *'node -e'*) [ "$FAILURE" != app-probe ] ;;
   esac ;;
 rm)
   shift; if [ "$1" = -f ]; then shift; fi
   rm "$state/$1" ;;
 *) exit 98 ;;
esac
`, { mode: 0o755 });
  const result = spawnSync(shell, ['-c', 'PATH="$1:$PATH"; export PATH; [ "$(command -v docker)" = "$1/docker" ] || exit 99; exec sh "$2"',
    'probe', shellPath(root), shellPath(script)], {
    encoding: 'utf8', timeout: 20000,
    env: { ...process.env, MOCK_ROOT: shellPath(root), FAILURE: failure, TARGET: names[component] || 'invalid',
      AI_ENV_FILE: shellPath(path.join(root, '3dai.env')), DEPLOY_LOCK_FILE: shellPath(path.join(root, 'deploy.lock')),
      GHCR_USER: 'fixture', GHCR_TOKEN: 'fixture', DEPLOY_COMPONENT: component, DEPLOY_IMAGE: 'fixture:sha' },
  });
  assert.equal(result.error, undefined, String(result.error));
  assert.notEqual(result.status, 99, 'Never use the real Docker daemon');
  const state = Object.fromEntries(await Promise.all((await readdir(path.join(root, 'state'))).map(async name => [name, await readFile(path.join(root, 'state', name), 'utf8')])));
  const commands = await readFile(path.join(root, 'commands'), 'utf8').catch(() => '');
  return { ...result, state, initial, commands };
}

for (const component of ['3d', '2d', 'ai']) {
  test(`${component} updates only its own container`, async t => {
    const r = await deployment(t, component);
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(r.state, { ...r.initial, [names[component]]: 'new' });
    const create = r.commands.split('\n').find(l => l.startsWith('create --name ' + names[component] + ' '));
    if (component === '3d') assert.match(create, / -p 80:80 /);
    else assert.doesNotMatch(create, / -p /);
    if (component === 'ai') assert.match(create, /--read-only --cap-drop ALL/);
    if (component === '2d') assert.match(create, /--network-alias page-2d/);
    assert.ok(r.commands.indexOf('lock') < r.commands.indexOf('rename'));
    assert.doesNotMatch(r.commands, /stop 102my-react|rm .*tls/);
  });
  for (const failure of ['lock', 'pull', 'validate', 'create', 'start', 'health', 'proxy', ...(component === 'ai' ? ['network', 'app-probe'] : []), ...(component === '3d' ? ['assets'] : [])]) {
    test(`${component} restores only its own previous release after ${failure}`, async t => {
      const r = await deployment(t, component, failure);
      assert.notEqual(r.status, 0);
      assert.deepEqual(r.state, r.initial);
    });
  }
}
test('first 3D release seeds 2D from the immutable previous image', async t => {
  const r = await deployment(t, '3d', '', { missing: ['100my-page-2d'] });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.state['100my-page-2d'], 'new');
  const create = r.commands.split('\n').find(l => l.startsWith('create --name 100my-page-2d'));
  assert.match(create, /sha256:exact-previous$/);
  assert.doesNotMatch(create, / -p /);
  assert.ok(r.commands.indexOf('start 100my-page-2d') < r.commands.indexOf('stop 100my-page-previous'));
});
for (const failure of ['legacy-missing', 'seed-health', 'assets']) {
  test(`legacy migration preserves original state after ${failure}`, async t => {
    const r = await deployment(t, '3d', failure, { missing: ['100my-page-2d'] });
    assert.notEqual(r.status, 0); assert.deepEqual(r.state, r.initial);
  });
}
test('fresh installation without either frontend gives an actionable error', async t => {
  const r = await deployment(t, '3d', '', { missing: ['100my-page', '100my-page-2d'] });
  assert.notEqual(r.status, 0); assert.match(r.stderr, /deploy 2Dpage first/); assert.deepEqual(r.state, r.initial);
});
test('first API deployment failure leaves no extra container', async t => {
  const r = await deployment(t, 'ai', 'app-probe', { missing: ['100my-page-ai'] });
  assert.notEqual(r.status, 0); assert.deepEqual(r.state, r.initial);
});
test('rejects unresolved rollback backup', async t => {
  const r = await deployment(t, '2d', '', { backup: true });
  assert.notEqual(r.status, 0); assert.deepEqual(r.state, r.initial); assert.doesNotMatch(r.commands, /stop|rename|create/);
});
test('rejects unknown components before doing any Docker work', async t => {
  const r = await deployment(t, 'unknown');
  assert.notEqual(r.status, 0); assert.equal(r.commands, ''); assert.deepEqual(r.state, r.initial);
});
