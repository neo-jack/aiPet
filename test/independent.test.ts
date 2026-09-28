import assert from 'node:assert/strict';
import test from 'node:test';
import { createApp } from '../src/app.js';
import { readConfig } from '../src/config.js';
test('independent service supports allowed browser preflight and rejects unregistered origins', async () => {
  const config = readConfig({ ALLOWED_ORIGINS:'https://consumer.example' });
  const app = createApp(config);
  const response = await app.request('/api/ai/chat', { method:'OPTIONS', headers:{Origin:'https://consumer.example','Access-Control-Request-Method':'POST','Access-Control-Request-Headers':'content-type,x-scene-actions'} });
  assert.equal(response.status,204);
  assert.equal(response.headers.get('access-control-allow-origin'),'https://consumer.example');
  assert.match(response.headers.get('access-control-allow-headers') ?? '', /X-Scene-Actions/i);
  assert.equal((await app.request('/api/ai/config',{headers:{Origin:'https://untrusted.example'}})).status,403);
  const publicResponse = await app.request('/api/ai/config',{headers:{Origin:'https://consumer.example'}});
  assert.equal(publicResponse.headers.get('access-control-allow-origin'),'https://consumer.example');
  const body = await publicResponse.json();
  assert.equal(body.sites.length,config.site.sites.length);
  assert.ok(body.sites.every((site: {url:string}) => /^https?:/.test(site.url)));
  assert.equal(body.instructions,undefined);
  assert.equal(body.apiKey,undefined);
});
test('origins and site configuration fail closed without leaking values', () => {
  assert.throws(() => readConfig({ALLOWED_ORIGINS:'*'}),/ALLOWED_ORIGINS/);
  assert.throws(() => readConfig({SITE_CONFIG_FILE:'missing-file.json'}),/^Error: Invalid configuration: SITE_CONFIG_FILE$/);
});
