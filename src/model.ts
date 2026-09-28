/**
 * @file model.ts
 * @description 中文注释：模型客户端的创建、对话消息的转换与流式文字的提取逻辑。
 */

import { AIMessage, HumanMessage, SystemMessage } from '@langchain/core/messages';
import { ChatOpenAICompletions } from '@langchain/openai';
import type { ChatStream } from './chat.js';
import type { Config } from './config.js';
import { buildSystemPrompt, SCENE_ACTION_PROMPT } from './prompt.js';
import { ReplyFormatError, requiredGuideSites, scanReplyMarkers, validateReplyFormat } from './replyFormat.js';

export function createChatStream(config: Config): ChatStream | undefined {
  // 未完成配置时返回 undefined，让路由返回可诊断的 503；启动阶段不尝试探测上游。
  if (!config.baseURL || !config.apiKey || !config.model) return undefined;

  // 固定使用 Chat Completions：通用 ChatOpenAI 可能根据模型名自动切到 Responses，
  // 而当前 Sub2API 分组必须先明确验证 /chat/completions 兼容性。
  const model = new ChatOpenAICompletions({
    apiKey: config.apiKey,
    model: config.model,
    // DeepSeek 默认思考；显式关闭可避免首字前的推理等待。其他上游默认不传扩展字段。
    modelKwargs: config.thinkingMode === 'provider' ? {} : { thinking: { type: config.thinkingMode } },
    configuration: { baseURL: config.baseURL },
    streamUsage: false,
    maxRetries: 0,
    maxTokens: config.maxOutputTokens,
    timeout: config.timeoutMs,
  });

  return async function* (messages, signal, sceneActions = false) {
    // system prompt 只来自服务端；客户端历史按 role 映射成 LangChain 消息，不接受自定义 system。
    const history = messages.map(({ role, content }) => role === 'user'
      ? new HumanMessage(content) : new AIMessage(content));
    const input = [new SystemMessage(`${buildSystemPrompt(config.site)}\n${sceneActions ? SCENE_ACTION_PROMPT : '当前客户端不支持场景操作，不得输出 SceneAction 标记，也不能声称替用户操作。'}`), ...history];
    const chunks = await model.stream(input, { signal });
    let reply = '';
    for await (const chunk of chunks) {
      // 只输出可展示文字；不要把 reasoning、工具参数、provider metadata 或原始错误泄露给浏览器。
      if (typeof chunk.content === 'string') {
        if (chunk.content) {
          reply += chunk.content;
          if (reply.length > 16000) throw new ReplyFormatError();
          yield chunk.content;
        }
      } else {
        for (const block of chunk.content) {
          if (block.type === 'text' && typeof block.text === 'string' && block.text) {
            reply += block.text;
            if (reply.length > 16000) throw new ReplyFormatError();
            yield block.text;
          }
        }
      }
    }
    signal.throwIfAborted();
    const knownIds = config.site.sites.map((site) => site.id);
    const question = messages.at(-1)?.content ?? '';
    const requiredIds = requiredGuideSites(question, config.site.sites);
    const requireSiteCard = config.site.sites.length > 0 && /推荐.*(?:网站|好站)|(?:有趣|好玩)的网站/.test(question) && !/(?:不要|不用|别).*推荐/.test(question);
    const report = validateReplyFormat(reply, knownIds, requiredIds, requireSiteCard);
    if (!sceneActions && scanReplyMarkers(reply).blocks.some((block) => block.marker === 'SceneAction')) throw new ReplyFormatError();
    if (report.valid) return;
    // 空回答、损坏的标记或截断围栏不能通过追加来修复；交给路由发送 error，不能伪装成 done。
    if (!reply.trim() || report.invalid) throw new ReplyFormatError();
    const repairInstruction = `刚才的回答缺少界面标记。只补写下列缺失标记，不重复正文、已有卡片或已有追问。\n${report.missingSiteIds.length ? `缺少 SiteCard ID：${report.missingSiteIds.join('、')}。` : report.missingSiteCard ? '缺少 SiteCard，请根据用户需求从清单中选择合适的网站生成卡片。' : '不要输出 SiteCard。'}\n${report.missingFollowUp ? '缺少 FollowUp，请根据本轮话题生成 2–3 个不重复的后续问题。' : '不要输出 FollowUp。'}\n必须使用独立围栏和规范 JSON，不要说明修复过程。`;
    // 只允许一次由模型补全标记，共用本次请求的超时/取消信号；不存在固定问题或本地拼卡片降级。
    const repair = await model.stream([...input, new AIMessage(reply), new HumanMessage(repairInstruction)], { signal });
    let supplement = '';
    for await (const chunk of repair) {
      signal.throwIfAborted();
      if (typeof chunk.content === 'string') supplement += chunk.content;
      else for (const block of chunk.content) if (block.type === 'text' && typeof block.text === 'string') supplement += block.text;
      if (supplement.length > 8000) throw new ReplyFormatError();
    }
    signal.throwIfAborted();
    const completed = `${reply}\n\n${supplement.trim()}`;
    if (completed.length > 16000 || scanReplyMarkers(supplement).prose.trim()
      || scanReplyMarkers(supplement).blocks.some((block) => block.marker === 'SceneAction')
      || !validateReplyFormat(completed, knownIds, requiredIds, requireSiteCard).valid) throw new ReplyFormatError();
    yield `\n\n${supplement.trim()}`;
  };
}
