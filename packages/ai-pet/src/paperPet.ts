export type PaperPetMode = 'waking' | 'idle' | 'thinking' | 'answering';
export const GUIDE_GREETING = '嗨，我是这里的 AI 向导，点我聊聊。';
export interface PetRecommendation { id: string; label: string; question: string }
export const WELCOME_QUESTIONS: readonly PetRecommendation[] = [{ id: 'intro', label: '这里有什么？', question: '这里有什么？' }];
