/**
 * @file replyFormat.ts
 * @description 中文注释：前后端共用的回答标记解析、追问验证与输出协议校验。
 */

// 此模块直接供浏览器导入，保持无环境配置、无 Node.js 依赖；只能解析数据，不能补写内容。
export const REPLY_PROTOCOL = 'markdown-sites-followups-v1';
export class ReplyFormatError extends Error {
  constructor() { super('Invalid reply format'); }
}
export const SCENE_ACTIONS = ['open_scroll', 'break_glass'] as const;
export type SceneAction = typeof SCENE_ACTIONS[number];
export type ReplyMarker = 'SiteCard' | 'FollowUp' | 'SceneAction';
export type ReplyBlock =
  | { marker: ReplyMarker; kind: 'pending' | 'invalid' }
  | { marker: 'SiteCard'; kind: 'valid'; id: string }
  | { marker: 'FollowUp'; kind: 'valid'; questions: string[] }
  | { marker: 'SceneAction'; kind: 'valid'; actions: SceneAction[] };

export function parseReplyFence(source: string, streaming: boolean): ReplyBlock | undefined {
  const lines = source.split(/\r?\n/);
  const opening = /^ {0,3}(`{3,}|~{3,})([^\r\n]*)$/.exec(lines[0] ?? '');
  if (!opening) return;
  const fence = opening[1]!;
  const info = opening[2]!.trim();
  const marker = (['SiteCard', 'FollowUp', 'SceneAction'] as const).find((name) => info === name || info.startsWith(`${name} `)
    || info.startsWith(`${name}\t`) || (streaming && lines.length === 1 && info.length > 0 && name.startsWith(info)));
  if (!marker) return;
  if (streaming && lines.length === 1 && marker.startsWith(info)) return { marker, kind: 'pending' };
  if (info !== marker || source.length > 2048) return { marker, kind: 'invalid' };
  while (lines.length > 1 && !lines[lines.length - 1]!.trim()) lines.pop();
  const closing = /^[ \t]*(`{3,}|~{3,})[ \t]*$/.exec(lines[lines.length - 1] ?? '');
  if (!(lines.length > 1 && closing && closing[1]![0] === fence[0] && closing[1]!.length >= fence.length)) {
    return { marker, kind: streaming ? 'pending' : 'invalid' };
  }
  try {
    const value: unknown = JSON.parse(lines.slice(1, -1).join('\n'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) return { marker, kind: 'invalid' };
    const record = value as Record<string, unknown>;
    if (Object.keys(record).length !== 1) return { marker, kind: 'invalid' };
    if (marker === 'SceneAction') {
      const actions = record.actions;
      return Array.isArray(actions) && actions.length >= 1 && actions.length <= 2
        && actions.every((action): action is SceneAction => SCENE_ACTIONS.includes(action))
        && new Set(actions).size === actions.length
        ? { marker, kind: 'valid', actions } : { marker, kind: 'invalid' };
    }
    if (marker === 'SiteCard') return typeof record.id === 'string' && record.id.length <= 64
      ? { marker, kind: 'valid', id: record.id } : { marker, kind: 'invalid' };
    if (!Array.isArray(record.questions) || record.questions.length < 2 || record.questions.length > 3) return { marker, kind: 'invalid' };
    if (!record.questions.every((item): item is string => typeof item === 'string'
      && item.trim().length >= 2 && item.trim().length <= 60 && !/[\r\n\x00-\x1f]/.test(item))) return { marker, kind: 'invalid' };
    const questions = record.questions.map((item) => item.trim());
    return new Set(questions).size === questions.length
      ? { marker, kind: 'valid', questions } : { marker, kind: 'invalid' };
  } catch { return { marker, kind: 'invalid' }; }
}

export function scanReplyMarkers(text: string) {
  const blocks: ReplyBlock[] = [];
  const prose: string[] = [];
  let fence: { marker: string; lines: string[] } | undefined;
  for (const line of text.split(/\r?\n/)) {
    if (fence) {
      fence.lines.push(line);
      const closing = /^[ \t]*(`{3,}|~{3,})[ \t]*$/.exec(line);
      if (closing && closing[1]![0] === fence.marker[0] && closing[1]!.length >= fence.marker.length) {
        const block = parseReplyFence(fence.lines.join('\n'), false);
        if (block) blocks.push(block);
        fence = undefined;
      }
    } else {
      const opening = /^ {0,3}(`{3,}|~{3,})/.exec(line);
      if (opening) fence = { marker: opening[1]!, lines: [line] };
      else prose.push(line);
    }
  }
  if (fence) {
    const block = parseReplyFence(fence.lines.join('\n'), false);
    if (block) blocks.push(block);
  }
  return { blocks, unclosedFence: Boolean(fence), prose: prose.join('\n') };
}

export function readFollowUpQuestions(text: string): string[] {
  const blocks = scanReplyMarkers(text).blocks.filter((block) => block.marker === 'FollowUp');
  const block = blocks[0];
  return blocks.length === 1 && block?.marker === 'FollowUp' && block.kind === 'valid' ? block.questions : [];
}

export function readSceneActions(text: string): SceneAction[] {
  const { blocks, unclosedFence } = scanReplyMarkers(text);
  const actions = blocks.filter((block) => block.marker === 'SceneAction');
  const block = actions[0];
  return !unclosedFence && !blocks.some((item) => item.kind !== 'valid') && actions.length === 1
    && block?.marker === 'SceneAction' && block.kind === 'valid' ? block.actions : [];
}

// 这是导览接口的输出约束，仅用于服务端校验/要求模型补全，不会自行生成卡片。
export function requiredGuideSites(question: string, catalog: readonly { id: string; owned: boolean }[]): string[] {
  const input = question.trim().replace(/[？?。！!]+$/, '');
  return /^(?:这里有什么|怎么逛这里|这个网站(?:是做什么的|有什么|是什么)|介绍(?:一下)?(?:这里|本站|这个网站))$/.test(input)
    ? catalog.filter((site) => site.owned).map((site) => site.id) : [];
}

export function validateReplyFormat(text: string, knownIds: readonly string[], requiredIds: readonly string[] = [], requireSiteCard = false) {
  const { blocks, unclosedFence } = scanReplyMarkers(text);
  const followups = blocks.filter((block) => block.marker === 'FollowUp');
  const sites = blocks.flatMap((block) => block.marker === 'SiteCard' && block.kind === 'valid' ? [block.id] : []);
  const invalid = unclosedFence || blocks.some((block) => block.kind !== 'valid') || followups.length > 1
    || blocks.filter((block) => block.marker === 'SceneAction').length > 1
    || sites.some((id) => !knownIds.includes(id)) || new Set(sites).size !== sites.length;
  const missingSiteIds = requiredIds.filter((id) => !sites.includes(id));
  const missingFollowUp = followups.length === 0;
  const missingSiteCard = requireSiteCard && sites.length === 0;
  return { valid: !invalid && !missingFollowUp && !missingSiteIds.length && !missingSiteCard, invalid, missingFollowUp, missingSiteIds, missingSiteCard };
}
