/**
 * @file server.ts
 * @description 中文注释：HTTP 服务的依赖装配、启动监听与优雅退出逻辑。
 */

import { serve } from '@hono/node-server';
import { createApp } from './app.js';
import { readConfig } from './config.js';
import { createChatStream } from './model.js';

try {
  // server.ts 只负责装配配置、路由和监听；模型调用细节留在 model.ts，便于测试时注入模拟流。
  const config = readConfig();
  const chatStream = createChatStream(config);
  const app = createApp(config, chatStream);
  const server = serve({ fetch: app.fetch, hostname: config.host, port: config.port }, () => {
    console.info(`3Dai listening on ${config.host}:${config.port}; chat configured: ${Boolean(chatStream)}`);
  });
  let shuttingDown = false;
  function shutdown() {
    // systemd/Docker 停止服务时给正在进行的流最多 10 秒；超时才强制退出，避免半写响应长期占槽。
    if (shuttingDown) return;
    shuttingDown = true;
    const deadline = setTimeout(() => process.exit(1), 10000);
    deadline.unref();
    server.close(() => { clearTimeout(deadline); process.exit(0); });
  }
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  // 监听失败通常是端口占用或 HOST 配置错误；不输出环境对象，避免把密钥带入日志。
  server.on('error', () => { console.error('3Dai failed to listen. Check HOST and PORT.'); process.exit(1); });
} catch (error) {
  // Config validation only reports field names, never their values.
  console.error(error instanceof Error && error.message.startsWith('Invalid configuration:')
    ? error.message : '3Dai failed to start. Check the server configuration.');
  process.exitCode = 1;
}
