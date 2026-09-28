import type { RecommendedSite } from './types';
import { parseReplyFence } from './replyFormat';
export { parseReplyFence, readFollowUpQuestions } from './replyFormat';
export type SiteCardBlock = { kind: 'pending' } | { kind: 'invalid' } | { kind: 'site'; site: RecommendedSite };
export function parseSiteCardFence(source: string, streaming: boolean, sites: readonly RecommendedSite[] = []): SiteCardBlock | undefined {
  const block = parseReplyFence(source, streaming);
  if (!block || block.marker !== 'SiteCard') return;
  if (block.kind !== 'valid') return { kind: block.kind };
  const site = sites.find(site => site.id === block.id);
  return site && safeMarkdownUrl(site.url) ? { kind: 'site', site } : { kind: 'invalid' };
}
export function safeMarkdownUrl(value: string, origin = 'https://example.invalid'): string {
  if (!value.trim()) return '';
  try {
    const url = new URL(value, origin);
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.href : '';
  } catch { return ''; }
}
