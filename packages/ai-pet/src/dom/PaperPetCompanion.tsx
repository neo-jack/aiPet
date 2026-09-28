import type { AssistantConfig } from '../types';
import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import paperUrl from '../assets/paper.webp?url';
import { GUIDE_GREETING, WELCOME_QUESTIONS, type PaperPetMode, type PetRecommendation } from '../paperPet';
import { ChatError, recentMessages, streamChat, type ChatMessage } from '../aiChat';
import { readFollowUpQuestions } from '../siteCards';
import { readSceneActions, type SceneAction } from '../replyFormat';

const AssistantMarkdown = lazy(() => import('./AssistantMarkdown').then((module) => ({ default: module.AssistantMarkdown })));

export interface PetOptions extends AssistantConfig {
  endpoint: string;
  configEndpoint?: string;
  sceneActions?: boolean;
}

export function usePaperPet(enabled: boolean, onSceneActions: (actions: SceneAction[]) => string[], options: PetOptions = { endpoint: '/api/ai/chat' }) {
  const [remoteConfig, setRemoteConfig] = useState<AssistantConfig>({});
  const settings = { ...remoteConfig, ...options };
  const greeting = settings.greeting ?? GUIDE_GREETING;
  const welcome = settings.welcomeQuestions ?? WELCOME_QUESTIONS;
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  useEffect(() => {
    const controller = new AbortController();
    setRemoteConfig({});
    const configEndpoint = options.configEndpoint ?? options.endpoint.replace(/\/chat\/?$/, '/config');
    if (configEndpoint === options.endpoint) return;
    void fetch(configEndpoint, { signal: controller.signal }).then(async response => {
      if (!response.ok) return;
      const config = await response.json();
      if (!controller.signal.aborted && config && Array.isArray(config.sites)) setRemoteConfig(config);
    }).catch(() => {});
    return () => controller.abort();
  }, [options.endpoint, options.configEndpoint]);
  const [mode, setMode] = useState<PaperPetMode>('idle');
  const [reply, setReply] = useState(greeting);
  const [introduced, setIntroduced] = useState(false);
  const [actionResult, setActionResult] = useState('');
  const actionHandler = useRef(onSceneActions);
  actionHandler.current = onSceneActions;
  const [panelOpen, setPanelOpen] = useState(false);
  const [recommendations, setRecommendations] = useState<readonly PetRecommendation[]>(welcome);
  const pending = useRef<AbortController | null>(null);
  const history = useRef<ChatMessage[]>([]);
  const modeRef = useRef(mode);
  const changeMode = useCallback((next: PaperPetMode) => {
    modeRef.current = next;
    setMode(next);
  }, []);
  const reset = useCallback(() => {
    pending.current?.abort();
    pending.current = null;
    history.current = [];
    setPanelOpen(false);
    setRecommendations(settingsRef.current.welcomeQuestions ?? WELCOME_QUESTIONS);
    changeMode('idle');
    setReply(settingsRef.current.greeting ?? GUIDE_GREETING);
    setActionResult('');
  }, [changeMode]);
  const wake = useCallback(() => {
    if (!enabled) return;
    setIntroduced(true);
    setActionResult('');
    setPanelOpen(true);
    if (modeRef.current !== 'idle') return;
    changeMode('waking');
  }, [enabled, changeMode]);
  const closePanel = useCallback(() => setPanelOpen(false), []);
  const ask = useCallback((value: string) => {
    const trimmed = value.trim().slice(0, 160);
    if (!enabled || !trimmed || pending.current) return;
    const controller = new AbortController();
    pending.current = controller;
    const messages = recentMessages(history.current, trimmed);
    setReply('');
    setRecommendations([]);
    setActionResult('');
    changeMode('thinking');
    const timeout = window.setTimeout(() => controller.abort(new Error('回答超时，请再试一次。')), 75000);
    void streamChat(messages, controller.signal, (text) => {
      if (pending.current !== controller) return;
      setReply(text);
      changeMode('answering');
    }, fetch, settingsRef.current.endpoint, settingsRef.current.sceneActions ?? false).then((text) => {
      if (pending.current === controller) {
        const actions = readSceneActions(text);
        const results = actions.length ? actionHandler.current(actions) : [];
        const receipt = results.join('；');
        const completed = receipt ? `${text}\n\n${receipt}。` : text;
        history.current = [...messages, { role: 'assistant', content: completed }];
        setReply(completed);
        if (receipt) {
          setActionResult(receipt);
        }
        setRecommendations(readFollowUpQuestions(text).map((question, index) => ({ id: `followup-${index}`, label: question, question })));
      }
    }).catch((error: unknown) => {
      if (pending.current !== controller) return;
      setReply(controller.signal.aborted ? '回答超时，请再试一次。'
        : error instanceof ChatError ? error.message : '暂时无法连接服务，请稍后重试。');
    }).finally(() => {
      window.clearTimeout(timeout);
      if (pending.current !== controller) return;
      pending.current = null;
      changeMode('idle');
    });
  }, [enabled, changeMode]);
  useEffect(() => { if (!enabled) reset(); }, [enabled, reset]);
  useEffect(() => { reset(); }, [options.endpoint, reset]);
  useEffect(() => { if (!history.current.length && !pending.current) { setReply(greeting); setRecommendations(welcome); } }, [greeting, welcome]);
  useEffect(() => () => { pending.current?.abort(); pending.current = null; }, []);
  useEffect(() => {
    if (!enabled || mode !== 'waking') return;
    const timeout = window.setTimeout(() => changeMode('idle'), 1250);
    return () => window.clearTimeout(timeout);
  }, [enabled, mode, changeMode]);
  return {
    mode,
    reply,
    panelOpen,
    recommendations,
    wake,
    greeting: actionResult || (!introduced ? greeting : ''),
    sites: settings.sites,
    siteOrigin: settings.siteOrigin,
    closePanel,
    ask,
  };
}

export function PaperPetTrigger({ onWake }: { onWake: () => void }) {
  return (
    <button type="button" onClick={onWake} aria-label="点击宠物提问"
      className="sr-only focus-visible:not-sr-only focus-visible:absolute focus-visible:size-20 focus-visible:-translate-x-1/2 focus-visible:-translate-y-1/2 focus-visible:rounded-xl focus-visible:outline-1 focus-visible:outline-dashed focus-visible:outline-[#73786c]" />
  );
}

export function PaperPetReply({ mode, reply, recommendations, onAsk, onClose, sites, siteOrigin }: AssistantConfig & {
  mode: PaperPetMode;
  reply: string;
  recommendations: readonly import('../paperPet').PetRecommendation[];
  onAsk: (question: string) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState('');
  const panel = useRef<HTMLElement>(null);
  const answer = useRef<HTMLDivElement>(null);
  const tail = useRef<HTMLDivElement>(null);
  const busy = mode === 'thinking' || mode === 'answering';
  const visibleRecommendations = recommendations.slice(0, 2);

  useEffect(() => {
    if (mode === 'thinking' && answer.current) answer.current.scrollTop = 0;
  }, [mode]);

  useLayoutEffect(() => {
    const element = panel.current;
    const anchor = element?.closest<HTMLElement>('.paper-pet-reply-anchor');
    if (!element || !anchor) return;
    let frame = 0;
    const place = () => {
      const viewport = window.visualViewport;
      const viewportLeft = viewport?.offsetLeft ?? 0;
      const viewportTop = viewport?.offsetTop ?? 0;
      const viewportWidth = viewport?.width ?? window.innerWidth;
      const viewportHeight = viewport?.height ?? window.innerHeight;
      const { x, y } = anchor.getBoundingClientRect();
      const width = Math.min(420, viewportWidth - 32);
      // Keep the bottom edge above the pet, including space for the paper tail.
      const bottom = Math.min(y - 12, viewportTop + viewportHeight - 16);
      // Use all space above the pet, keeping only a small gap at the visible screen top.
      const top = viewportTop + 8;
      const height = Math.max(0, bottom - top);
      element.style.width = `${width}px`;
      element.style.height = `${height}px`;
      element.dataset.compact = String(height < 180);
      const minLeft = viewportLeft + 16;
      const maxLeft = viewportLeft + viewportWidth - width - 16;
      const left = Math.max(minLeft, Math.min(maxLeft, x - width / 2));
      const panelTop = bottom - height;
      element.style.transform = `translate(${left - x}px, ${panelTop - y}px)`;
      if (tail.current) {
        tail.current.style.left = `${Math.max(16, Math.min(width - 32, x - left - 8))}px`;
      }
    };
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(place);
    };
    // Observe the projected HTML anchor, not the Three.js scene or every animation frame.
    const movement = new MutationObserver(schedule);
    movement.observe(anchor, { attributes: true, attributeFilter: ['style'] });
    window.addEventListener('resize', schedule);
    window.visualViewport?.addEventListener('resize', schedule);
    window.visualViewport?.addEventListener('scroll', schedule);
    place();
    return () => {
      cancelAnimationFrame(frame);
      movement.disconnect();
      window.removeEventListener('resize', schedule);
      window.visualViewport?.removeEventListener('resize', schedule);
      window.visualViewport?.removeEventListener('scroll', schedule);
    };
  }, []);

  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || document.querySelector('dialog[open]')) return;
      const restore = panel.current?.contains(document.activeElement);
      onClose();
      if (restore) requestAnimationFrame(() => document.querySelector<HTMLButtonElement>('button.sr-only[aria-label="点击宠物提问"]')?.focus());
    };
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [onClose]);

  useEffect(() => {
    // The portal root is interactive only while the panel is open. Capture clicks outside
    // the section here because the Drei Html wrapper creates a transformed containing block
    // and would otherwise prevent a fixed backdrop from covering the viewport.
    const handleOutsidePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && panel.current?.contains(target)) return;
      onClose();
    };
    document.addEventListener('pointerdown', handleOutsidePointerDown, true);
    return () => document.removeEventListener('pointerdown', handleOutsidePointerDown, true);
  }, [onClose]);

  return (
    <>
    <section ref={panel} aria-label="AI 对话"
      className="group/pet pointer-events-auto relative z-1 w-105 rounded-[3px_12px_4px_9px] border border-[#8d958a]/60 bg-[#f6f5ef] text-[#424b48] shadow-[3px_5px_0_#454b4220]"
      style={{ backgroundImage: `linear-gradient(#f6f5efc9, #f6f5efc9), url(${paperUrl})`, backgroundSize: '320px',
        fontFamily: '"tiktok", "Microsoft YaHei", sans-serif' }}>
      <div ref={tail} aria-hidden="true" className="absolute -bottom-2 left-1/2 h-4 w-4 rotate-45 border-b border-r border-[#8d958a]/60 bg-[#eeeee7]" />
      <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-[inherit] px-4 pb-3 group-data-[compact=true]/pet:pb-1.5">
      <div className="relative z-1 flex shrink-0 items-center justify-between gap-3 border-b border-[#727d6d]/20 pb-2 pt-3 group-data-[compact=true]/pet:py-1">
        <span className="flex-1 text-xs tracking-widest">AI 对话</span>
        <button type="button" aria-label="关闭对话" onClick={onClose}
          className="cursor-pointer rounded p-1 text-lg! leading-none opacity-65 hover:opacity-100 focus-visible:outline-1">×</button>
      </div>
      <span role="status" aria-live="polite" className="sr-only">{mode === 'thinking' ? '正在思考' : mode === 'answering' ? '正在回答' : '可以继续提问'}</span>
      <div ref={answer} role="region" aria-label="回答内容" tabIndex={0}
        className="min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain pr-2 focus-visible:outline-1 focus-visible:outline-offset-[-1px] [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-button]:hidden [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-[#8b8c7b]/60 [&::-webkit-scrollbar-track]:bg-transparent"
        style={{ scrollbarWidth: 'thin', scrollbarColor: '#9b9d8d transparent', scrollbarGutter: 'stable' }}>
      <div className="flex min-h-full flex-col">
      <div className="my-3 min-h-14 shrink-0">
          {mode === 'thinking' ? <p aria-hidden="true" className="text-xs text-[#737d71]">正在思考…</p> : <Suspense fallback={<p className="text-xs text-[#7c856f]">正在准备对话…</p>}>
            <AssistantMarkdown text={reply} streaming={mode === 'answering'} sites={sites} siteOrigin={siteOrigin} />
          </Suspense>}
          {mode === 'answering' && <span aria-hidden="true" className="ml-0.5 inline-block animate-pulse text-[#737d71]">▍</span>}
      </div>
      {visibleRecommendations.length > 0 && <div className="mt-auto">{visibleRecommendations.map((recommendation) => <button key={recommendation.id} type="button" aria-label={`快捷提问：${recommendation.label}`} disabled={busy} onClick={() => onAsk(recommendation.question)}
        className="mt-auto mb-2 flex min-h-8 w-full shrink-0 cursor-default items-center justify-between gap-2 rounded-[2px_5px_3px_4px] border! border-[#899587]/40! bg-white/20! px-2.5 py-1.5 text-left text-[11px]! leading-relaxed wrap-anywhere focus-visible:outline-1 disabled:opacity-40 group-data-[compact=true]/pet:mb-1 group-data-[compact=true]/pet:min-h-6 group-data-[compact=true]/pet:py-0.5">
        <span className="min-w-0 group-data-[compact=true]/pet:truncate">{recommendation.label}</span><span aria-hidden="true" className="shrink-0 text-[#7d8477]">↳</span>
      </button>)}</div>}
      </div>
      </div>
      <div className="shrink-0">
      <form className="flex gap-2 border-t border-[#727d6d]/20 pt-2 group-data-[compact=true]/pet:pt-1" onSubmit={(event) => {
        event.preventDefault();
        if (busy || !draft.trim()) return;
        onAsk(draft);
        setDraft('');
      }}>
        <input aria-label="提问" value={draft} onChange={(event) => setDraft(event.target.value)} maxLength={160}
          onKeyDown={(event) => { if (event.key !== 'Escape') event.stopPropagation(); }}
          placeholder="有什么想问的……" className="min-w-0 flex-1 border-b border-[#899587]/60 bg-transparent py-1 text-xs! outline-none placeholder:text-[#737d71] focus:outline-none focus-visible:outline-none" />
        <button type="submit" disabled={busy || !draft.trim()} className="cursor-pointer rounded px-1 text-xs! outline-none focus:outline-none focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#899587]/45 disabled:cursor-default disabled:opacity-35">发送</button>
      </form>
      </div>
      </div>
    </section>
    </>
  );
}
