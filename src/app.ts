/**
 * @file app.ts
 * @description 中文注释：HTTP 路由、请求限流与 SSE 流式响应的处理逻辑。
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { publicSiteConfig } from './siteConfig.js';
import { bodyLimit } from 'hono/body-limit';
import { streamSSE } from 'hono/streaming';
import { chatRequestSchema } from './chat.js';
import type { ChatStream } from './chat.js';
import type { Config } from './config.js';
import { REPLY_PROTOCOL, ReplyFormatError, SCENE_ACTIONS } from './replyFormat.js';

export function createApp(config: Config, chatStream?: ChatStream) {
  const app = new Hono();
  app.use('/api/ai/*', async (c, next) => {
    const origin = c.req.header('Origin');
    const sameOrigin = origin === new URL(c.req.url).origin;
    if (origin && !sameOrigin && !config.allowedOrigins.includes(origin)) return c.json({ error: { code: 'ORIGIN_DENIED', message: '该网站未获准接入。' } }, 403);
    await next();
  });
  app.use('/api/ai/*', cors({ origin: origin => config.allowedOrigins.includes(origin) ? origin : '', allowMethods: ['GET', 'POST', 'OPTIONS'], allowHeaders: ['Content-Type', 'X-Scene-Actions'], maxAge: 600 }));
  app.get('/api/ai/config', c => { c.header('Cache-Control', 'no-store'); return c.json(publicSiteConfig(config.site)); });
  // 这些计数器刻意保存在进程内：当前服务是单实例小型后端，重启后限流窗口会清空；
  // 多实例部署时必须把限流和并发控制移到共享网关或外部存储，不能把这里当成分布式锁。
  let activeRequests = 0;
  let acceptedAt: number[] = [];

  // 该接口只表示 Node 进程存活；chatConfigured 只表示模型配置字段齐全，
  // 不主动请求上游，避免健康探测消耗额度或把上游故障放大成重启风暴。
  app.get('/health', (c) => c.json({ status: 'ok', chatConfigured: Boolean(chatStream), replyProtocol: REPLY_PROTOCOL, sceneActions: SCENE_ACTIONS }));

  // 先限制原始请求体，再解析 JSON，防止超大或分块请求先进入 JSON 解析器。
  app.use('/api/ai/chat', bodyLimit({
    maxSize: 64 * 1024,
    onError: (c) => c.json({ error: { code: 'PAYLOAD_TOO_LARGE', message: '请求体不能超过 64 KiB。' } }, 413),
  }));

  app.post('/api/ai/chat', async (c) => {
    c.header('Cache-Control', 'no-store');
    // 未配置时保持明确的 503；不要降级成虚构回答，也不要让请求绕过服务端密钥边界。
    if (!chatStream) {
      return c.json({ error: { code: 'NOT_CONFIGURED', message: '聊天服务尚未配置。' } }, 503);
    }
    if (c.req.header('content-type')?.split(';')[0]?.trim().toLowerCase() !== 'application/json') {
      return c.json({ error: { code: 'INVALID_CONTENT_TYPE', message: '请使用 application/json。' } }, 415);
    }
    let body: unknown;
    try { body = await c.req.json(); }
    catch { return c.json({ error: { code: 'INVALID_JSON', message: '请求必须是有效 JSON。' } }, 400); }
    const parsed = chatRequestSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: { code: 'INVALID_MESSAGES', message: '请提供 1–12 条文字消息，每条不超过 2000 字符，总计不超过 12000 字符，最后一条须为用户提问。' } }, 400);
    }

    // 并发满时立即拒绝，不排队：小服务器没有足够内存承受无界的待处理请求。
    if (activeRequests >= config.maxConcurrent) {
      c.header('Retry-After', '3');
      return c.json({ error: { code: 'BUSY', message: '当前提问较多，请稍后重试。' } }, 429);
    }
    const now = Date.now();
    acceptedAt = acceptedAt.filter((time) => now - time < 60000);
    if (acceptedAt.length >= config.requestsPerMinute) {
      c.header('Retry-After', String(Math.max(1, Math.ceil(((acceptedAt[0] ?? now) + 60000 - now) / 1000))));
      return c.json({ error: { code: 'RATE_LIMITED', message: '提问太频繁，请稍后重试。' } }, 429);
    }
    acceptedAt.push(now);
    activeRequests += 1;
    // SSE 由 Nginx 直接转发；该响应头配合 proxy_buffering off，避免 token 被攒到结尾才发送。
    c.header('X-Accel-Buffering', 'no');

    const response = streamSSE(c, async (stream) => {
      const controller = new AbortController();
      // 同时监听浏览器断开和服务端超时，任一发生都要中断 LangChain 的上游请求。
      const signal = AbortSignal.any([c.req.raw.signal, controller.signal]);
      let timedOut = false;
      let hasText = false;
      let forceClose: ReturnType<typeof setTimeout> | undefined;
      const timeout = setTimeout(() => {
        timedOut = true;
        controller.abort();
        // A client that stops reading must not hold a slot indefinitely.
        forceClose = setTimeout(() => stream.abort(), 1000);
      }, config.timeoutMs);
      stream.onAbort(() => controller.abort());
      // 注释心跳不进入回答正文，只用于保持反向代理和浏览器连接活跃。
      const heartbeat = setInterval(() => {
        void stream.write(': ping\n\n').catch(() => controller.abort());
      }, 15000);

      try {
        // ready 让前端确认流已经建立；只有随后收到 token 和 done 才算完整回答。
        await stream.writeSSE({ event: 'ready', data: JSON.stringify({ replyProtocol: REPLY_PROTOCOL,
          sceneActions: c.req.header('X-Scene-Actions') === 'v1' ? SCENE_ACTIONS : [] }) });
        for await (const text of chatStream(parsed.data.messages, signal, c.req.header('X-Scene-Actions') === 'v1')) {
          signal.throwIfAborted();
          if (!text) continue;
          hasText = true;
          await stream.writeSSE({ event: 'token', data: JSON.stringify({ text }) });
        }
        signal.throwIfAborted();
        if (!hasText) throw new Error('Empty model response');
        await stream.writeSSE({ event: 'done', data: '{}' });
      } catch (error) {
        if (!stream.aborted && !c.req.raw.signal.aborted) {
          await stream.writeSSE({ event: 'error', data: JSON.stringify({
            code: timedOut ? 'TIMEOUT' : error instanceof ReplyFormatError ? 'INVALID_REPLY_FORMAT' : 'UPSTREAM_ERROR',
            message: timedOut ? '回答超时，请稍后重试。' : error instanceof ReplyFormatError ? '回答内容不完整，请重新提问。' : '暂时无法获取回答，请稍后重试。',
          }) });
        }
      } finally {
        // 所有退出路径都要释放定时器、AbortController 和并发槽位；否则一次断线会永久占名额。
        clearTimeout(timeout);
        clearTimeout(forceClose);
        clearInterval(heartbeat);
        controller.abort();
        activeRequests -= 1;
      }
    }, async (error) => { error.message = 'Stream closed.'; });
    response.headers.set('Cache-Control', 'no-store');
    return response;
  });

  app.notFound((c) => c.json({ error: { code: 'NOT_FOUND', message: '接口不存在。' } }, 404));
  app.onError((_error, c) => c.json({ error: { code: 'INTERNAL_ERROR', message: '服务暂时不可用。' } }, 500));
  return app;
}
