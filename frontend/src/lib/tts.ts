import { create } from 'zustand';
import { synthesizeSpeech, fetchTtsHealth } from './api';
import { toSpeechText } from './message-text';

export type TtsState = 'idle' | 'loading' | 'speaking';

interface TtsStore {
  state: TtsState;
  speakingId: string | null;
  error: string | null;
  errorId: string | null;
  available: boolean | null;
  autoSpokenId: string | null;
  speak: (id: string, text: string) => Promise<void>;
  enqueue: (id: string, text: string) => void;
  stop: () => void;
  ensureHealth: () => Promise<void>;
  markAutoSpoken: (id: string) => void;
}

let audio: HTMLAudioElement | null = null;
let objectUrl: string | null = null;
let controller: AbortController | null = null;
let token = 0;
let healthProbe: Promise<void> | null = null;

interface QueueItem {
  id: string;
  text: string;
}

let speechQueue: QueueItem[] = [];
let queueRunning = false;
let queueRunId = 0;

export function shouldAutoplayFinishedReply(
  previousStreamingConversationId: string | null,
  activeId: string | null,
  streamIsActive: boolean,
  lastMessage: { id: string; role: string } | undefined,
  autoSpokenId: string | null,
): boolean {
  return previousStreamingConversationId !== null
    && previousStreamingConversationId === activeId
    && !streamIsActive
    && lastMessage !== undefined
    && lastMessage.role === 'assistant'
    && lastMessage.id !== autoSpokenId;
}

function clearPlayback(): void {
  if (audio) {
    audio.onended = null;
    audio.onerror = null;
    audio.pause();
    audio.src = '';
    audio = null;
  }
  if (objectUrl) {
    URL.revokeObjectURL(objectUrl);
    objectUrl = null;
  }
}

function abortSynthesis(): void {
  if (controller) {
    controller.abort();
    controller = null;
  }
}

function teardown(): void {
  clearPlayback();
  abortSynthesis();
}

function cancelQueue(): void {
  queueRunId += 1;
  speechQueue = [];
  queueRunning = false;
}

async function pumpQueue(
  set: (partial: Partial<TtsStore>) => void,
): Promise<void> {
  if (queueRunning) return;
  queueRunning = true;
  const runId = queueRunId;

  const playNext = async (): Promise<void> => {
    if (runId !== queueRunId) {
      queueRunning = false;
      return;
    }

    const item = speechQueue.shift();
    if (!item) {
      queueRunning = false;
      set({ state: 'idle', speakingId: null });
      return;
    }

    clearPlayback();
    abortSynthesis();
    set({
      state: 'loading',
      speakingId: item.id,
      error: null,
      errorId: null,
    });

    const ac = new AbortController();
    controller = ac;

    try {
      const blob = await synthesizeSpeech(item.text, { signal: ac.signal });
      if (runId !== queueRunId) return;
      controller = null;

      const url = URL.createObjectURL(blob);
      objectUrl = url;
      const el = new Audio(url);
      audio = el;

      el.onended = () => {
        if (runId !== queueRunId) return;
        clearPlayback();
        void playNext();
      };
      el.onerror = () => {
        if (runId !== queueRunId) return;
        clearPlayback();
        queueRunning = false;
        speechQueue = [];
        set({
          state: 'idle',
          speakingId: null,
          error: 'Playback failed',
          errorId: item.id,
        });
      };

      await el.play();
      if (runId === queueRunId) {
        set({ state: 'speaking', speakingId: item.id });
      }
    } catch (err) {
      if (runId !== queueRunId) return;
      if (err instanceof DOMException && err.name === 'AbortError') return;
      controller = null;
      queueRunning = false;
      speechQueue = [];
      set({
        state: 'idle',
        speakingId: null,
        error: err instanceof Error ? err.message : 'Speech synthesis failed',
        errorId: item.id,
      });
    }
  };

  await playNext();
}

export const useTtsStore = create<TtsStore>((set) => ({
  state: 'idle',
  speakingId: null,
  error: null,
  errorId: null,
  available: null,
  autoSpokenId: null,

  ensureHealth: () => {
    if (healthProbe) return healthProbe;
    healthProbe = fetchTtsHealth()
      .then((health) => {
        set({ available: health.available });
        if (!health.available) healthProbe = null;
      })
      .catch(() => {
        set({ available: false });
        healthProbe = null;
      });
    return healthProbe;
  },

  markAutoSpoken: (id: string) => set({ autoSpokenId: id }),

  enqueue: (id: string, text: string) => {
    const cleaned = toSpeechText(text);
    if (!cleaned) return;
    speechQueue.push({ id, text: cleaned });
    void pumpQueue(set);
  },

  speak: async (id: string, text: string) => {
    const trimmed = toSpeechText(text);
    if (!trimmed) return;

    cancelQueue();
    token += 1;
    const mine = token;
    teardown();
    set({ state: 'loading', speakingId: id, error: null, errorId: null });

    const ac = new AbortController();
    controller = ac;

    try {
      const blob = await synthesizeSpeech(trimmed, { signal: ac.signal });
      if (mine !== token) return;
      controller = null;

      const url = URL.createObjectURL(blob);
      objectUrl = url;
      const el = new Audio(url);
      audio = el;

      el.onended = () => {
        if (mine !== token) return;
        clearPlayback();
        set({ state: 'idle', speakingId: null });
      };
      el.onerror = () => {
        if (mine !== token) return;
        clearPlayback();
        set({ state: 'idle', speakingId: null, error: 'Playback failed', errorId: id });
      };

      await el.play();
      if (mine === token) set({ state: 'speaking', speakingId: id });
    } catch (err) {
      if (mine !== token) return;
      if (err instanceof DOMException && err.name === 'AbortError') return;
      teardown();
      set({
        state: 'idle',
        speakingId: null,
        error: err instanceof Error ? err.message : 'Speech synthesis failed',
        errorId: id,
      });
    }
  },

  stop: () => {
    cancelQueue();
    token += 1;
    teardown();
    set({ state: 'idle', speakingId: null, error: null, errorId: null });
  },
}));

export function __resetTtsForTests(): void {
  cancelQueue();
  teardown();
  token = 0;
  healthProbe = null;
  useTtsStore.setState({
    state: 'idle',
    speakingId: null,
    error: null,
    errorId: null,
    available: null,
    autoSpokenId: null,
  });
}
