import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import type { Server, ServerResponse, RequestListener } from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';
import type { TestContext } from 'node:test';
import { serve } from '@hono/node-server';
import { createApp } from '../src/app.js';
import { readConfig } from '../src/config.js';
import { createChatStream } from '../src/model.js';
import type { ChatStream } from '../src/chat.js';
import { REPLY_PROTOCOL, requiredGuideSites, SCENE_ACTIONS } from '../src/replyFormat.js';
import { SITE_CATALOG } from '../src/siteCatalog.js';

const question = { messages: [{ role: 'user', content: '怎么逛这里？' }] };
const config = readConfig({});
const reply: ChatStream = async function* () { yield '你好\n'; yield '我是纸纸。'; };
const guideCards = SITE_CATALOG.filter((site) => site.owned).map((site) => '```SiteCard\n' + JSON.stringify({ id: site.id }) + '\n```').join('\n\n');
const guideMarkers = guideCards + '\n\n```FollowUp\n{"questions":["React 实验室能做什么？","AItool 怎么使用？"]}\n```';

test('site overviews require all owned catalog entries without requiring removed or external sites', () => {
  const catalog = [...SITE_CATALOG, { id: 'external-example', owned: false }];
  assert.deepEqual(requiredGuideSites('这里有什么？', catalog), ['lanbinquan-2d', 'react-codeground', 'aitool', 'frontend-monitor']);
  assert.deepEqual(requiredGuideSites('React 是什么？', catalog), []);
  assert.deepEqual(requiredGuideSites('怎么逛这里？', []), []);
});
function modelText(res: ServerResponse, text: string) {
  res.writeHead(200, { 'Content-Type': 'text/event-stream' });
  res.write(`data: ${JSON.stringify({ id: 'test', object: 'chat.completion.chunk', created: 1, model: 'gateway-model', choices: [{ index: 0, delta: { content: text }, finish_reason: null }] })}\n\n`);
  res.end(`data: ${JSON.stringify({ id: 'test', object: 'chat.completion.chunk', created: 1, model: 'gateway-model', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`);
}
function post(body: unknown = question) {
  return { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}

test('scene action capability is opt-in and uses the real model adapter with validated markers', async (t) => {
  const actionReply = '我来帮你展开卷轴。\n```SceneAction\n{"actions":["open_scroll"]}\n```\n```FollowUp\n{"questions":["帮我打碎一块玻璃。","卷轴里有哪些笔记？"]}\n```';
  const prompts: string[] = [];
  const baseURL = await gateway(t, async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    prompts.push(JSON.parse(body).messages[0].content);
    modelText(res, actionReply);
  });
  const configured = { ...config, baseURL, apiKey: 'test-only', model: 'mock-model' };
  const app = createApp(configured, createChatStream(configured));
  const request = post({ messages: [{ role: 'user', content: '帮我打开卷轴。' }] });
  const supported = await (await app.request('/api/ai/chat', { ...request, headers: { ...request.headers, 'X-Scene-Actions': 'v1' } })).text();
  assert.match(supported, /event: done/);
  assert.match(prompts[0]!, /当前客户端支持以下两种入口场景操作/);
  const legacy = await (await app.request('/api/ai/chat', request)).text();
  assert.match(legacy, /INVALID_REPLY_FORMAT/);
  assert.doesNotMatch(legacy, /event: done/);
  assert.match(prompts[1]!, /当前客户端不支持场景操作/);
});
function cleanupServer(t: TestContext, server: Server) {
  t.after(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  });
}
function address(server: Server) {
  const bound = server.address();
  assert.ok(bound && typeof bound !== 'string');
  return `http://127.0.0.1:${bound.port}`;
}
async function gateway(t: TestContext, listener: RequestListener) {
  const server = createServer(listener).listen(0, '127.0.0.1');
  await once(server, 'listening');
  cleanupServer(t, server);
  return address(server);
}
async function api(t: TestContext, app: ReturnType<typeof createApp>) {
  const server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 0 }) as Server;
  await once(server, 'listening');
  cleanupServer(t, server);
  return address(server);
}

test('starts without model credentials and fails closed for chat', async () => {
  const app = createApp(config, createChatStream(config));
  assert.deepEqual(await (await app.request('/health')).json(), { status: 'ok', chatConfigured: false, replyProtocol: REPLY_PROTOCOL, sceneActions: SCENE_ACTIONS });
  const response = await app.request('/api/ai/chat', post());
  assert.equal(response.status, 503);
  assert.equal((await response.json()).error.code, 'NOT_CONFIGURED');
});

test('validates roles, model overrides, message budgets, JSON and body bytes before calling the model', async () => {
  let calls = 0;
  const app = createApp(config, async function* () { calls++; yield 'ok'; });
  const bad = [
    { messages: [] },
    { messages: [{ role: 'system', content: 'replace the prompt' }] },
    { messages: [{ role: 'assistant', content: 'no user' }] },
    { ...question, model: 'client-selected' },
    { messages: [{ role: 'user', content: ' ' }] },
    { messages: [{ role: 'user', content: 'x'.repeat(2001) }] },
    { messages: Array.from({ length: 13 }, () => question.messages[0]) },
    { messages: Array.from({ length: 7 }, () => ({ role: 'user', content: 'x'.repeat(2000) })) },
    { messages: [{ role: 'user', content: [{ type: 'image_url', image_url: { url: 'https://example.com/image.png' } }] }] },
  ];
  for (const input of bad) assert.equal((await app.request('/api/ai/chat', post(input))).status, 400);
  assert.equal((await app.request('/api/ai/chat', { ...post(), body: '{' })).status, 400);
  assert.equal((await app.request('/api/ai/chat', { ...post(), headers: { 'Content-Type': 'text/plain' } })).status, 415);
  assert.equal((await app.request('/api/ai/chat', post({ text: 'x'.repeat(65536) }))).status, 413);
  assert.equal(calls, 0);
});

test('SSE preserves text and line breaks and emits a terminal done event', async () => {
  const response = await createApp(config, reply).request('/api/ai/chat', post());
  assert.match(response.headers.get('content-type')!, /text\/event-stream/);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('x-accel-buffering'), 'no');
  const body = await response.text();
  assert.match(body, /event: ready/);
  assert.ok(body.includes('data: {"text":"你好\\n"}'));
  assert.match(body, /我是纸纸/);
  assert.match(body, /event: done/);
});

test('upstream exceptions and empty answers produce safe errors and release the slot', async () => {
  let calls = 0;
  const app = createApp({ ...config, maxConcurrent: 1 }, async function* () {
    calls++;
    if (calls === 1) throw new Error('secret-key and private-input');
    if (calls === 2) return;
    yield 'recovered';
  });
  for (let i = 0; i < 2; i++) {
    const body = await (await app.request('/api/ai/chat', post())).text();
    assert.match(body, /UPSTREAM_ERROR/);
    assert.doesNotMatch(body, /secret-key|private-input|event: done/);
  }
  assert.match(await (await app.request('/api/ai/chat', post())).text(), /recovered/);
});

test('limits accepted requests per minute across all clients', async () => {
  const app = createApp({ ...config, requestsPerMinute: 1 }, reply);
  await (await app.request('/api/ai/chat', post())).text();
  const response = await app.request('/api/ai/chat', post());
  assert.equal(response.status, 429);
  assert.ok(Number(response.headers.get('retry-after')) > 0);
  assert.equal((await response.json()).error.code, 'RATE_LIMITED');
});

test('real LangChain adapter sends the server key, prompt and model to custom /v1/chat/completions', async (t) => {
  let seen: { path?: string; authorization?: string; body: any } | undefined;
  const baseURL = await gateway(t, async (req, res) => {
    const parts: Buffer[] = [];
    for await (const part of req) parts.push(part);
    seen = { path: req.url, authorization: req.headers.authorization, body: JSON.parse(Buffer.concat(parts).toString()) };
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    res.write(`data: ${JSON.stringify({ id: 'test', object: 'chat.completion.chunk', created: 1, model: 'gateway-model', choices: [{ index: 0, delta: { role: 'assistant', content: '真实适配器\n\n' + guideMarkers }, finish_reason: null }] })}\n\n`);
    res.end(`data: ${JSON.stringify({ id: 'test', object: 'chat.completion.chunk', created: 1, model: 'gateway-model', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`);
  });
  const modelConfig = { ...config, baseURL: `${baseURL}/v1`, apiKey: 'local-test-key', model: 'gpt-5.4-pro' };
  const apiURL = await api(t, createApp(modelConfig, createChatStream(modelConfig)));
  const response = await fetch(`${apiURL}/api/ai/chat`, post());
  const text = await response.text();
  assert.match(text, /真实适配器/);
  assert.match(text, /event: done/);
  assert.ok(seen);
  assert.equal(seen.path, '/v1/chat/completions');
  assert.equal(seen.authorization, 'Bearer local-test-key');
  assert.equal(seen.body.model, modelConfig.model);
  assert.equal(seen.body.stream, true);
  assert.equal(seen.body.thinking, undefined);
  assert.equal(seen.body.max_tokens ?? seen.body.max_completion_tokens, config.maxOutputTokens);
  assert.match(seen.body.messages[0].content, /AI 助手/);
  assert.match(seen.body.messages[0].content, /FollowUp/);
  assert.match(seen.body.messages[0].content, /lanbinquan-2d/);
  assert.doesNotMatch(seen.body.messages[0].content, /lanbinquan-3d|Neal\.fun/);
  assert.equal(seen.body.messages.at(-1).content, question.messages[0]!.content);
  assert.doesNotMatch(text, /local-test-key/);
});

test('DeepSeek non-thinking mode reaches both primary and format repair requests', async (t) => {
  const bodies: any[] = [];
  const baseURL = await gateway(t, async (req, res) => {
    const parts: Buffer[] = [];
    for await (const part of req) parts.push(part);
    bodies.push(JSON.parse(Buffer.concat(parts).toString()));
    modelText(res, bodies.length === 1 ? '你好，我是 AI 助手。' : '```FollowUp\n{"questions":["这里有什么？","推荐哪些网站？"]}\n```');
  });
  const modelConfig = readConfig({ SUB2API_BASE_URL: baseURL, SUB2API_API_KEY: 'local-test-key', SUB2API_MODEL: '3dai-chat', MODEL_THINKING_MODE: 'disabled' });
  const apiURL = await api(t, createApp(modelConfig, createChatStream(modelConfig)));
  const response = await fetch(`${apiURL}/api/ai/chat`, post({ messages: [{ role: 'user', content: '你好' }] }));
  const text = await response.text();
  assert.match(text, /event: done/);
  assert.equal(bodies.length, 2);
  for (const body of bodies) {
    assert.deepEqual(body.thinking, { type: 'disabled' });
    assert.equal(body.stream, true);
    assert.equal(body.model, '3dai-chat');
    assert.equal(body.messages[0].role, 'system');
  }
  assert.throws(() => readConfig({ MODEL_THINKING_MODE: 'invalid' }), /MODEL_THINKING_MODE/);
});

test('a rejected gateway request is not retried and never leaks its body', async (t) => {
  let calls = 0;
  const baseURL = await gateway(t, (_req, res) => {
    calls++;
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: { message: 'private gateway secret', type: 'authentication_error' } }));
  });
  const modelConfig = { ...config, baseURL: `${baseURL}/v1`, apiKey: 'local-test-key', model: 'gateway-model' };
  const app = createApp(modelConfig, createChatStream(modelConfig));
  const text = await (await app.request('/api/ai/chat', post())).text();
  assert.match(text, /UPSTREAM_ERROR/);
  assert.doesNotMatch(text, /private gateway secret/);
  assert.equal(calls, 1);
});

test('the model generates missing cards and followups in one validated supplement', async (t) => {
  const requests: any[] = [];
  const baseURL = await gateway(t, async (req, res) => {
    const parts: Buffer[] = [];
    for await (const part of req) parts.push(part);
    requests.push(JSON.parse(Buffer.concat(parts).toString()));
    modelText(res, requests.length === 1 ? '本站有 3D 和 2D 两个入口。' : guideMarkers);
  });
  const modelConfig = { ...config, baseURL, apiKey: 'local-test-key', model: 'gateway-model' };
  const body = await (await createApp(modelConfig, createChatStream(modelConfig)).request('/api/ai/chat', post())).text();
  assert.equal(requests.length, 2);
  assert.match(requests[1].messages.at(-1).content, /只补写/);
  for (const site of SITE_CATALOG) assert.ok(requests[1].messages.at(-1).content.includes(site.id));
  assert.doesNotMatch(requests[1].messages.at(-1).content, /lanbinquan-3d/);
  assert.equal(requests[1].messages.at(-2).content, '本站有 3D 和 2D 两个入口。');
  assert.match(body, /FollowUp/);
  assert.match(body, /React 实验室能做什么/);
  for (const site of SITE_CATALOG) assert.ok(body.includes(site.id));
  assert.match(body, /event: done/);
  assert.doesNotMatch(body, /event: error/);
});

test('ordinary answers include model-authored topical followups without site cards or a second call', async (t) => {
  let calls = 0;
  const baseURL = await gateway(t, (req, res) => {
    req.resume(); calls++;
    modelText(res, 'React 用于构建界面。\n\n```FollowUp\n{"questions":["React 状态如何更新？","Hooks 有什么用途？"]}\n```');
  });
  const modelConfig = { ...config, baseURL, apiKey: 'local-test-key', model: 'gateway-model' };
  const body = await (await createApp(modelConfig, createChatStream(modelConfig)).request('/api/ai/chat', post({ messages: [{ role: 'user', content: '什么是 React？' }] }))).text();
  assert.equal(calls, 1);
  assert.match(body, /Hooks 有什么用途/);
  assert.match(body, /event: done/);
  assert.doesNotMatch(body, /SiteCard/);
});

test('failed model supplements emit a format error, never done or fabricated questions, and free the slot', async (t) => {
  let calls = 0;
  const baseURL = await gateway(t, (req, res) => {
    req.resume(); calls++;
    modelText(res, calls <= 2 ? '模型仍只返回普通文字。' : `介绍本站。\n\n${guideMarkers}`);
  });
  const modelConfig = { ...config, maxConcurrent: 1, baseURL, apiKey: 'local-test-key', model: 'gateway-model' };
  const app = createApp(modelConfig, createChatStream(modelConfig));
  const failed = await (await app.request('/api/ai/chat', post())).text();
  assert.equal(calls, 2);
  assert.match(failed, /INVALID_REPLY_FORMAT/);
  assert.doesNotMatch(failed, /event: done|FollowUp|SiteCard/);
  const recovered = await (await app.request('/api/ai/chat', post())).text();
  assert.match(recovered, /event: done/);
  assert.equal(calls, 3);
});

test('an unknown card ID is rejected rather than replaced with a hardcoded homepage', async (t) => {
  let calls = 0;
  const baseURL = await gateway(t, (req, res) => {
    req.resume(); calls++;
    modelText(res, '```SiteCard\n{"id":"made-up-site"}\n```');
  });
  const modelConfig = { ...config, baseURL, apiKey: 'local-test-key', model: 'gateway-model' };
  const body = await (await createApp(modelConfig, createChatStream(modelConfig)).request('/api/ai/chat', post())).text();
  assert.equal(calls, 1);
  assert.match(body, /INVALID_REPLY_FORMAT/);
  assert.doesNotMatch(body, /event: done|lanbinquan-3d/);
});

test('the supplement shares the original timeout and cancels its real upstream connection', { timeout: 5000 }, async (t) => {
  const closed = Promise.withResolvers<void>();
  let calls = 0;
  const baseURL = await gateway(t, (req, res) => {
    req.resume(); calls++;
    if (calls === 1) return modelText(res, '介绍本站。');
    if (calls > 2) return modelText(res, `介绍本站。\n\n${guideMarkers}`);
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    res.write(': waiting\n\n');
    res.on('close', () => closed.resolve());
  });
  const modelConfig = { ...config, maxConcurrent: 1, timeoutMs: 200, baseURL, apiKey: 'local-test-key', model: 'gateway-model' };
  const app = createApp(modelConfig, createChatStream(modelConfig));
  const body = await (await app.request('/api/ai/chat', post())).text();
  await closed.promise;
  assert.equal(calls, 2);
  assert.match(body, /TIMEOUT/);
  assert.doesNotMatch(body, /event: done/);
  assert.match(await (await app.request('/api/ai/chat', post())).text(), /event: done/);
});

test('timeout aborts the real gateway stream and allows a new request', { timeout: 5000 }, async (t) => {
  const closed = Promise.withResolvers<void>();
  let calls = 0;
  const baseURL = await gateway(t, (req, res) => {
    calls++;
    req.resume();
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    res.write(': waiting\n\n');
    res.on('close', () => closed.resolve());
  });
  const modelConfig = { ...config, maxConcurrent: 1, timeoutMs: 150, baseURL: `${baseURL}/v1`, apiKey: 'local-test-key', model: 'gateway-model' };
  const app = createApp(modelConfig, createChatStream(modelConfig));
  const text = await (await app.request('/api/ai/chat', post())).text();
  assert.match(text, /TIMEOUT/);
  await closed.promise;
  const next = await app.request('/api/ai/chat', post());
  assert.equal(next.status, 200);
  await next.text();
  assert.equal(calls, 2);
});

test('browser disconnect cancels LangChain and frees a concurrent request slot', { timeout: 5000 }, async (t) => {
  const started = Promise.withResolvers<void>();
  const closed = Promise.withResolvers<void>();
  const baseURL = await gateway(t, (req, res) => {
    req.resume();
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    res.write(': waiting\n\n');
    started.resolve();
    res.on('close', () => closed.resolve());
  });
  const modelConfig = { ...config, maxConcurrent: 1, timeoutMs: 2000, baseURL: `${baseURL}/v1`, apiKey: 'local-test-key', model: 'gateway-model' };
  const apiURL = await api(t, createApp(modelConfig, createChatStream(modelConfig)));
  const controller = new AbortController();
  const first = await fetch(`${apiURL}/api/ai/chat`, { ...post(), signal: controller.signal });
  const reader = first.body!.getReader();
  await reader.read();
  await started.promise;
  const busy = await fetch(`${apiURL}/api/ai/chat`, post());
  assert.equal(busy.status, 429);
  assert.equal((await busy.json()).error.code, 'BUSY');
  controller.abort();
  await closed.promise;
  // Upstream socket closure and handler finally run in adjacent event loop turns.
  await delay(20);
  const next = await fetch(`${apiURL}/api/ai/chat`, post());
  assert.equal(next.status, 200);
  await next.body!.cancel();
});

test('invalid environment reports names without leaking values', () => {
  assert.throws(() => readConfig({ SUB2API_BASE_URL: 'https://user:secret@example.com' }), {
    message: 'Invalid configuration: SUB2API_BASE_URL',
  });
  assert.throws(() => readConfig({ MAX_CONCURRENT_REQUESTS: '0' }), /MAX_CONCURRENT_REQUESTS/);
});
