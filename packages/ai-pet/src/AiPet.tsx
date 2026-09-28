import { useRef } from 'react';
import { PaperPetReply, usePaperPet, type PetOptions } from './dom/PaperPetCompanion';
import type { SceneAction } from './replyFormat';
const noActions = (_actions: SceneAction[]) => [] as string[];
/** Drop-in DOM companion; the optional /three entry exports the existing R3F model. */
export function AiPet({ onSceneActions = noActions, ...options }: PetOptions & { onSceneActions?: (actions: SceneAction[]) => string[] }) {
  const pet = usePaperPet(true, onSceneActions, options);
  const anchor = useRef<HTMLDivElement>(null);
  return <div ref={anchor} className="paper-pet-reply-anchor" style={{ position: 'fixed', right: 40, bottom: 80, zIndex: 1000 }}>
    {pet.panelOpen && <PaperPetReply {...pet} onAsk={pet.ask} onClose={pet.closePanel} />}
    <button type="button" aria-label="打开 AI 向导" onClick={(event) => { event.stopPropagation(); pet.wake(); }} style={{ position: 'absolute', top: 12, right: -16, cursor: 'pointer', borderRadius: 12, padding: '8px 12px', background: '#f6f5ef', color: '#424b48', border: '1px solid #8d958a', whiteSpace: 'nowrap' }}>AI 向导</button>
  </div>;
}
