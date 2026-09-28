/**
 * @file config.ts
 * @description 中文注释：环境变量的读取、校验与运行配置的生成逻辑。
 */

import { z } from 'zod';
import { readSiteConfig } from './siteConfig.js';

// 环境变量是唯一的运行配置来源。这里先校验再映射成内部命名，避免业务代码到处读取 process.env。
// 默认值针对 2 vCPU / 约 2 GiB 内存的小服务器；调整预算时同步检查 README、compose 和部署脚本。
const environment = z.object({
  ALLOWED_ORIGINS: z.string().default('').transform(value => value.split(',').map(item => item.trim()).filter(Boolean)).refine(values => values.every(value => { try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) && url.origin === value; } catch { return false; } })),
  SITE_CONFIG_FILE: z.string().default(''),
  HOST: z.string().trim().min(1).default('127.0.0.1'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  // 只接受不带凭据、查询串和 fragment 的 HTTP(S) 地址；API key 不能藏在 URL 中。
  SUB2API_BASE_URL: z.string().trim().default('').refine((value) => {
    if (!value) return true;
    try {
      const url = new URL(value);
      return ['http:', 'https:'].includes(url.protocol)
        && !url.username && !url.password && !url.search && !url.hash;
    } catch { return false; }
  }),
  SUB2API_API_KEY: z.string().trim().default(''),
  SUB2API_MODEL: z.string().trim().default(''),
  // provider 表示不发送扩展参数；DeepSeek 快速回复应明确设置 disabled。
  MODEL_THINKING_MODE: z.enum(['provider', 'disabled', 'enabled']).default('provider'),
  MAX_CONCURRENT_REQUESTS: z.coerce.number().int().min(1).max(8).default(2),
  REQUEST_TIMEOUT_MS: z.coerce.number().int().min(1000).max(120000).default(60000),
  MAX_OUTPUT_TOKENS: z.coerce.number().int().min(1).max(4096).default(800),
  REQUESTS_PER_MINUTE: z.coerce.number().int().min(1).max(1000).default(20),
});

export function readConfig(env: NodeJS.ProcessEnv = process.env) {
  const result = environment.safeParse(env);
  if (!result.success) {
    const fields = [...new Set(result.error.issues.map((issue) => issue.path[0]))];
    throw new Error(`Invalid configuration: ${fields.join(', ')}`);
  }
  const value = result.data;
  // 只在这里移除尾部斜杠，model.ts 随后固定拼接 /chat/completions，避免双斜杠或路径漂移。
  return {
    allowedOrigins: value.ALLOWED_ORIGINS,
    site: readSiteConfig(value.SITE_CONFIG_FILE || undefined),
    host: value.HOST,
    port: value.PORT,
    baseURL: value.SUB2API_BASE_URL.replace(/\/+$/, ''),
    apiKey: value.SUB2API_API_KEY,
    model: value.SUB2API_MODEL,
    thinkingMode: value.MODEL_THINKING_MODE,
    maxConcurrent: value.MAX_CONCURRENT_REQUESTS,
    timeoutMs: value.REQUEST_TIMEOUT_MS,
    maxOutputTokens: value.MAX_OUTPUT_TOKENS,
    requestsPerMinute: value.REQUESTS_PER_MINUTE,
  };
}

export type Config = ReturnType<typeof readConfig>;
