import assert from 'node:assert/strict';
import test from 'node:test';
import { recentMessages, streamChat } from '../dist/aiChat.js';

const messages = [{ role: 'user', content: '你好' }];
function response(text, size = 1) {
  const bytes = new TextEncoder().encode(text);
  return new Response(new ReadableStream({ start(controller) {
    for (let i = 0; i < bytes.length; i += size) controller.enqueue(bytes.slice(i, i + size));
    controller.close();
  } }), { headers: { 'Content-Type': 'text/event-stream' } });
}
test('parses Chinese UTF-8 and CRLF events split across individual bytes', async () => {
  const text = ': ping\r\n\r\nevent: ready\r\ndata: {}\r\n\r\n'
    + 'event: token\r\ndata: {"text":"你好\\n"}\r\n\r\n'
    + 'event: token\r\ndata: {"text":"世界"}\r\n\r\nevent: done\r\ndata: {}\r\n\r\n';
  const updates = [];
  const result = await streamChat(messages, new AbortController().signal, text => updates.push(text), async (url, init) => {
    assert.equal(url, '/api/ai/chat');
    assert.equal(init.method, 'POST');
    assert.equal(init.headers['X-Scene-Actions'], 'v1');
    assert.deepEqual(JSON.parse(init.body), { messages });
    return response(text);
  });
  assert.equal(result, '你好\n世界');
  assert.deepEqual(updates, ['你好\n', '你好\n世界']);
});

test('an action marker is not committed when the stream errors, truncates, or is cancelled before done', async () => {
  const marker = '```SceneAction\n{"actions":["break_glass"]}\n```';
  const token = `event: token\ndata: ${JSON.stringify({ text: marker })}\n\n`;
  for (const ending of ['', 'event: error\ndata: {"code":"INVALID_REPLY_FORMAT"}\n\n']) {
    let committed = false;
    await assert.rejects(streamChat(messages, new AbortController().signal, () => {}, async () => response(token + ending)).then(() => { committed = true; }));
    assert.equal(committed, false);
  }
  const abort = new AbortController();
  await assert.rejects(streamChat(messages, abort.signal, () => abort.abort(), async () => response(token + 'event: done\ndata: {}\n\n')));
});
test('does not treat truncated SSE or a static HTML fallback as a successful answer', async () => {
  for (const value of [response('event: token\ndata: {"text":"部分"}\n\n'), new Response('<html>site</html>')]) {
    await assert.rejects(streamChat(messages, new AbortController().signal, () => {}, async () => value));
  }
});
test('handles rate limits and safe terminal errors', async () => {
  await assert.rejects(streamChat(messages, new AbortController().signal, () => {}, async () => response('event: error\ndata: {"code":"UPSTREAM_ERROR","message":"private debug"}\n\n')), { message: '模型服务暂时不可用，请稍后重试。' });
  await assert.rejects(streamChat(messages, new AbortController().signal, () => {}, async () => new Response('', { status: 429 })), /稍后/);
  await assert.rejects(streamChat(messages, new AbortController().signal, () => {}, async () => response('event: error\ndata: {"code":"TIMEOUT","message":"private debug"}\n\n')), /回答超时/);
  await assert.rejects(streamChat(messages, new AbortController().signal, () => {}, async () => response('event: error\ndata: {"code":"INVALID_REPLY_FORMAT","message":"private debug"}\n\n')), /回答内容不完整/);
});
test('cancelled requests cannot publish additional text', async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(streamChat(messages, controller.signal, () => assert.fail('unexpected text'), async () => response('event: token\ndata: {"text":"旧请求"}\n\n')));
});
test('retains recent complete turns within backend character and message limits', () => {
  const history = Array.from({ length: 16 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: String(i) + '字'.repeat(3000) }));
  const result = recentMessages(history, '新问题');
  assert.ok(result.length <= 12);
  assert.ok(result.every(message => message.content.length <= 2000));
  assert.ok(result.reduce((sum, message) => sum + message.content.length, 0) <= 12000);
  assert.equal(result.at(-1).content, '新问题');
  assert.ok(result.at(-2).content.startsWith('15'));
  assert.equal(result[0].role, 'user');
});

test('an independent consumer selects its own endpoint without negotiating scene actions', async () => {
  const result = await streamChat(messages, new AbortController().signal, () => {}, async (url, init) => {
    assert.equal(url, 'https://ai.example/api/ai/chat');
    assert.equal(init.headers['X-Scene-Actions'], undefined);
    return response('event: token\ndata: {"text":"独立接入"}\n\nevent: done\ndata: {}\n\n');
  }, 'https://ai.example/api/ai/chat', false);
  assert.equal(result, '独立接入');
});
