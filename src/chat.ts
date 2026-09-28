/**
 * @file chat.ts
 * @description 中文注释：聊天请求的类型定义和验证逻辑。
 */

import { z } from 'zod';

// 前端只能提交最近的 user/assistant 文字历史；system、模型、图片和工具字段均由后端控制。
// 这个 schema 是协议边界，不要为了“灵活”改成 z.any() 或直接透传客户端对象。
export const chatRequestSchema = z.object({
  messages: z.array(z.object({
    role: z.enum(['user', 'assistant']),
    content: z.string().trim().min(1).max(2000),
  }).strict()).min(1).max(12),
}).strict().refine((input) => input.messages.at(-1)?.role === 'user', {
  message: 'The final message must be from the user.',
}).refine((input) => input.messages.reduce((total, item) => total + item.content.length, 0) <= 12000, {
  message: 'Conversation is too long.',
});

export type ChatMessage = z.infer<typeof chatRequestSchema>['messages'][number];
// signal 必须传给实现层，以便浏览器离场或服务器超时时取消上游生成。
export type ChatStream = (messages: ChatMessage[], signal: AbortSignal, sceneActions?: boolean) => AsyncIterable<string>;
