import { createContext, useContext, type ComponentProps } from 'react';
import Markdown, { type Components, type ExtraProps } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { parseReplyFence, parseSiteCardFence, safeMarkdownUrl } from '../siteCards';
import type { RecommendedSite } from '../types';
import { SiteCard } from './SiteCard';

interface MarkdownContextValue {
  text: string;
  streaming: boolean;
  sites?: readonly RecommendedSite[];
  siteOrigin?: string;
}

// 渲染器身份必须稳定：面板 pointerdown 更新活跃状态时不能重建按钮，否则随后的 click 会丢失。
const MarkdownCardContext = createContext<MarkdownContextValue | null>(null);

function MarkdownPre({ node, children }: ComponentProps<'pre'> & ExtraProps) {
  const context = useContext(MarkdownCardContext);
  const start = node?.position?.start.offset;
  const end = node?.position?.end.offset;
  const source = context && start !== undefined && end !== undefined ? context.text.slice(start, end) : '';
  // 追问由面板在成功 done 后展示为按钮，半截标记和 JSON 不进入回答正文。
  const marker = parseReplyFence(source, context?.streaming ?? false)?.marker;
  if (marker === 'FollowUp' || marker === 'SceneAction') return null;
  const block = parseSiteCardFence(source, context?.streaming ?? false, context?.sites);
  if (block?.kind === 'pending') return <div aria-label="网站推荐加载中" className="my-3 rounded-sm border border-[#b7b3a3]/65 bg-[#f7f4eb]/70 p-3 motion-safe:animate-pulse"><div className="mb-3 h-4 w-2/3 bg-[#e7e8dc]" /><p className="text-xs text-[#858e7e]">正在整理网站推荐…</p></div>;
  if (block?.kind === 'invalid') return <p className="rounded-lg bg-[#eeeee6] p-3 text-xs text-[#7b8275]">这条网站推荐暂时无法显示，请重新提问。</p>;
  if (block?.kind === 'site') return <SiteCard site={block.site} />;
  return <pre className="my-3 max-w-full overflow-x-auto rounded-lg bg-[#e9ece3] p-3 text-[11px] leading-relaxed [&_code]:bg-transparent [&_code]:p-0">{children}</pre>;
}

const markdownComponents: Components = {
  a: ({ href, children }) => href ? <a href={href} target="_blank" rel="noopener noreferrer" className="text-[#547a8b]! underline decoration-[#93aeba] underline-offset-2 hover:text-[#355c6e]!">{children}</a> : <span>{children}</span>,
  pre: MarkdownPre,
  code: ({ className, children }) => <code className={`${className ?? ''} rounded bg-[#e9ece3] px-1 py-0.5 font-mono text-[0.9em]`}>{children}</code>,
  table: ({ children }) => <div role="region" aria-label="回答表格" tabIndex={0} className="my-3 max-w-full overflow-x-auto rounded-lg border border-[#d7dccf]"><table className="w-full border-collapse text-left text-xs">{children}</table></div>,
  th: ({ children }) => <th className="border-b border-[#d7dccf] bg-[#e9ede2] px-3 py-2 font-semibold whitespace-nowrap">{children}</th>,
  td: ({ children }) => <td className="border-b border-[#e0e3d8] px-3 py-2">{children}</td>,
  input: ({ checked }) => <input type="checkbox" checked={Boolean(checked)} disabled className="mr-1 accent-[#626c58]" />,
};

export function AssistantMarkdown(props: MarkdownContextValue) {
  return (
    <div className="min-w-0 text-[13px] leading-relaxed wrap-break-word [&>p]:my-2 [&_h1]:my-3 [&_h1]:text-lg [&_h1]:font-semibold [&_h2]:my-3 [&_h2]:text-base [&_h2]:font-semibold [&_h3]:font-semibold [&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5 [&_li]:my-1 [&_blockquote]:my-3 [&_blockquote]:border-l-2 [&_blockquote]:border-[#a5ae99] [&_blockquote]:pl-3 [&_blockquote]:text-[#737d71] [&_hr]:my-3 [&_hr]:border-[#d6d9ce]">
      <MarkdownCardContext value={props}>
      <Markdown remarkPlugins={[remarkGfm]} skipHtml urlTransform={(url) => safeMarkdownUrl(url, props.siteOrigin)}
        allowedElements={['p', 'br', 'hr', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'strong', 'em', 'del', 'blockquote', 'ul', 'ol', 'li', 'a', 'pre', 'code', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'input']}
        components={markdownComponents}>{props.text}</Markdown>
      </MarkdownCardContext>
    </div>
  );
}
