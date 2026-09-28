export interface ChatMessage { role: 'user' | 'assistant'; content: string }
export class ChatError extends Error {}

export function recentMessages(history: ChatMessage[], question: string): ChatMessage[] {
  const result: ChatMessage[] = [{ role: 'user', content: question.slice(0, 160) }];
  let total = result[0]!.content.length;
  // Keep complete user/assistant pairs and leave space for the new question.
  for (let i = history.length - 2; i >= 0 && result.length + 2 <= 12; i -= 2) {
    const user = history[i];
    const assistant = history[i + 1];
    if (!user || !assistant || user.role !== 'user' || assistant.role !== 'assistant') break;
    const pair = [user, assistant].map((message) => ({ ...message, content: message.content.slice(0, 2000) }));
    const size = pair.reduce((sum, message) => sum + message.content.length, 0);
    if (total + size > 12000) break;
    total += size;
    result.unshift(...pair);
  }
  return result;
}

export async function streamChat(messages: ChatMessage[], signal: AbortSignal, onText: (text: string) => void,
  request: typeof fetch = fetch, endpoint = '/api/ai/chat', sceneActions = true) {
  const response = await request(endpoint, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...(sceneActions ? { 'X-Scene-Actions': 'v1' } : {}) },
    body: JSON.stringify({ messages }), signal,
  });
  if (!response.ok) {
    throw new ChatError(response.status === 429 ? '提问有点多，请稍后再试。' : '暂时无法连接服务，请稍后重试。');
  }
  if (!response.body || !response.headers.get('content-type')?.includes('text/event-stream')) {
    throw new ChatError('暂时无法连接服务，请稍后重试。');
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let reply = '';
  let done = false;
  function parse(frame: string) {
    let event = '';
    const data: string[] = [];
    for (const line of frame.split(/\r?\n/)) {
      if (line.startsWith('event:')) event = line.slice(6).trim();
      else if (line.startsWith('data:')) data.push(line.slice(5).trimStart());
    }
    if (!data.length) return;
    const payload = JSON.parse(data.join('\n'));
    if (event === 'error') throw new ChatError(payload.code === 'TIMEOUT'
      ? '回答超时，请重试。' : payload.code === 'INVALID_REPLY_FORMAT'
        ? '回答内容不完整，请重新提问。' : payload.code === 'UPSTREAM_ERROR'
          ? '模型服务暂时不可用，请稍后重试。' : '暂时无法连接服务，请稍后重试。');
    if (event === 'done') { done = true; return; }
    if (event === 'token' && typeof payload.text === 'string') {
      reply += payload.text;
      if (reply.length > 16000) throw new ChatError('回答太长了，请换个简短的问题。');
      onText(reply);
    }
  }
  try {
    while (!done) {
      signal.throwIfAborted();
      const chunk = await reader.read();
      buffer += decoder.decode(chunk.value, { stream: !chunk.done });
      let boundary: RegExpExecArray | null;
      while ((boundary = /\r?\n\r?\n/.exec(buffer))) {
        parse(buffer.slice(0, boundary.index));
        buffer = buffer.slice(boundary.index + boundary[0].length);
        if (done) break;
      }
      if (buffer.length > 65536) throw new ChatError('回答连接异常，请再试一次。');
      if (chunk.done) break;
    }
    signal.throwIfAborted();
    if (!done || !reply) throw new ChatError('回答中断了，请再试一次。');
    return reply;
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
