import { create } from 'zustand';
import { apiFetch } from './api';

export type JarvisLiveState =
  | 'idle'
  | 'connecting'
  | 'live'
  | 'closing'
  | 'error';

export type JarvisBackendMode = 'economy' | 'analysis';

interface JarvisLiveStore {
  state: JarvisLiveState;
  available: boolean | null;
  sessionId: string | null;
  error: string | null;
  lastEvent: string | null;
  backendMode: JarvisBackendMode;
  backendModel: string;
  livePricePerMinuteUsd: number;
  liveSeconds: number;
  liveCostUsd: number;
  backendCostUsd: number;
  sessionCostUsd: number;
  monthCostUsd: number;
  idleRemaining: number;
  userCaption: string;
  assistantCaption: string;
  ensureStatus: () => Promise<void>;
  setBackendMode: (mode: JarvisBackendMode) => void;
  connect: () => Promise<void>;
  disconnect: () => void;
}

const IDLE_TIMEOUT_SECONDS = 60;
const COST_STORAGE_KEY = 'jarvis-live-cost-v1';

const BACKEND_PROFILES = {
  economy: {
    model: 'gpt-5.6-luna',
    reasoning: { effort: 'low' },
    max_output_tokens: 700,
    input: 0.2,
    cached: 0.02,
    output: 1.2,
  },
  analysis: {
    model: 'gpt-5.6-terra',
    reasoning: { effort: 'medium' },
    max_output_tokens: 2200,
    input: 2,
    cached: 0.2,
    output: 12,
  },
} as const;

let peer: RTCPeerConnection | null = null;
let events: RTCDataChannel | null = null;
let microphone: MediaStream | null = null;
let audio: HTMLAudioElement | null = null;
let closeTimer: number | null = null;
let sessionTimer: number | null = null;
let sessionStartedAt = 0;
let lastActivityAt = 0;
let reportedLiveSeconds = 0;
let sessionPersisted = false;
const chargedResponses = new Set<string>();

function currentMonthKey(): string {
  return new Date().toISOString().slice(0, 7);
}

function loadMonthCost(): number {
  try {
    const parsed = JSON.parse(localStorage.getItem(COST_STORAGE_KEY) || '{}');
    return parsed.month === currentMonthKey() ? Number(parsed.total || 0) : 0;
  } catch {
    return 0;
  }
}

function saveMonthCost(amount: number): number {
  const total = loadMonthCost() + Math.max(0, amount);
  try {
    localStorage.setItem(
      COST_STORAGE_KEY,
      JSON.stringify({ month: currentMonthKey(), total }),
    );
  } catch {}
  return total;
}

function trimCaption(value: string): string {
  const clean = value.replace(/\s+/g, ' ').trim();
  return clean.length > 240 ? clean.slice(-240) : clean;
}

function cleanupTimers() {
  if (closeTimer !== null) {
    window.clearTimeout(closeTimer);
    closeTimer = null;
  }
  if (sessionTimer !== null) {
    window.clearInterval(sessionTimer);
    sessionTimer = null;
  }
}

function cleanup() {
  cleanupTimers();
  microphone?.getTracks().forEach((track) => track.stop());
  microphone = null;
  events?.close();
  events = null;
  peer?.close();
  peer = null;
  if (audio) {
    audio.pause();
    audio.srcObject = null;
    audio.remove();
    audio = null;
  }
}

function backendCostFromResponse(event: any): number {
  const nested = event?.event;
  const response = nested?.response;
  const usage = response?.usage;
  if (!usage) return 0;

  const responseId = String(response.id || event.delegation_id || '');
  if (responseId && chargedResponses.has(responseId)) return 0;

  const eventType = String(nested?.type || '');
  if (!eventType.includes('completed') && !eventType.includes('done')) return 0;
  if (responseId) chargedResponses.add(responseId);

  const model = String(response.model || '');
  const profile =
    model.includes('terra') ? BACKEND_PROFILES.analysis : BACKEND_PROFILES.economy;

  const input = Number(usage.input_tokens || 0);
  const cached = Number(usage.input_tokens_details?.cached_tokens || 0);
  const output = Number(usage.output_tokens || 0);
  const uncached = Math.max(0, input - cached);

  return (
    (uncached / 1_000_000) * profile.input +
    (cached / 1_000_000) * profile.cached +
    (output / 1_000_000) * profile.output
  );
}

function finalizeSessionCost(
  set: (partial: Partial<JarvisLiveStore>) => void,
  get: () => JarvisLiveStore,
) {
  if (sessionPersisted) return;
  sessionPersisted = true;
  const state = get();
  const monthCostUsd = saveMonthCost(state.sessionCostUsd);
  set({ monthCostUsd });
}

async function waitForIce(connection: RTCPeerConnection): Promise<void> {
  if (connection.iceGatheringState === 'complete') return;
  await new Promise<void>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      connection.removeEventListener('icegatheringstatechange', onState);
      reject(new Error('Tempo esgotado ao preparar a conexão de voz.'));
    }, 10_000);

    function onState() {
      if (connection.iceGatheringState !== 'complete') return;
      window.clearTimeout(timer);
      connection.removeEventListener('icegatheringstatechange', onState);
      resolve();
    }

    connection.addEventListener('icegatheringstatechange', onState);
    onState();
  });
}

export const useJarvisLiveStore = create<JarvisLiveStore>((set, get) => ({
  state: 'idle',
  available: null,
  sessionId: null,
  error: null,
  lastEvent: null,
  backendMode: 'economy',
  backendModel: BACKEND_PROFILES.economy.model,
  livePricePerMinuteUsd: 0.05,
  liveSeconds: 0,
  liveCostUsd: 0,
  backendCostUsd: 0,
  sessionCostUsd: 0,
  monthCostUsd: loadMonthCost(),
  idleRemaining: IDLE_TIMEOUT_SECONDS,
  userCaption: '',
  assistantCaption: '',

  ensureStatus: async () => {
    try {
      const response = await apiFetch('/api/jarvis/live/status');
      if (!response.ok) throw new Error('Jarvis Live indisponível');
      const data = await response.json();
      const mode = get().backendMode;
      set({
        available: Boolean(data.available),
        livePricePerMinuteUsd: Number(data.live_price_per_minute_usd || 0.05),
        backendModel:
          data.backend_models?.[mode] || BACKEND_PROFILES[mode].model,
      });
    } catch {
      set({ available: false });
    }
  },

  setBackendMode: (mode) => {
    const profile = BACKEND_PROFILES[mode];
    set({ backendMode: mode, backendModel: profile.model });

    if (get().state !== 'live' || events?.readyState !== 'open') return;

    events.send(
      JSON.stringify({
        type: 'session.update',
        event_id: `backend_${mode}_${Date.now()}`,
        session: {
          delegation: {
            responses: {
              model: profile.model,
              reasoning: profile.reasoning,
              max_output_tokens: profile.max_output_tokens,
            },
          },
        },
      }),
    );
  },

  connect: async () => {
    if (get().state === 'connecting' || get().state === 'live') return;
    cleanup();
    chargedResponses.clear();
    reportedLiveSeconds = 0;
    sessionPersisted = false;
    set({
      state: 'connecting',
      error: null,
      sessionId: null,
      liveSeconds: 0,
      liveCostUsd: 0,
      backendCostUsd: 0,
      sessionCostUsd: 0,
      idleRemaining: IDLE_TIMEOUT_SECONDS,
      userCaption: '',
      assistantCaption: '',
      monthCostUsd: loadMonthCost(),
    });

    try {
      const connection = new RTCPeerConnection();
      peer = connection;

      audio = document.createElement('audio');
      audio.autoplay = true;
      audio.setAttribute('playsinline', 'true');
      audio.style.display = 'none';
      document.body.appendChild(audio);

      connection.addEventListener('track', (event) => {
        if (!audio) return;
        audio.srcObject = new MediaStream([event.track]);
        void audio.play().catch(() => {});
      });

      microphone = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      for (const track of microphone.getAudioTracks()) {
        connection.addTrack(track, microphone);
      }

      events = connection.createDataChannel('oai-events');
      events.addEventListener('message', ({ data }) => {
        try {
          const event = JSON.parse(String(data));
          const type = typeof event.type === 'string' ? event.type : 'event';
          set({ lastEvent: type });
          window.dispatchEvent(
            new CustomEvent('jarvis:live-event', { detail: event }),
          );

          const now = Date.now();
          if (
            type.includes('input_transcript') ||
            type.includes('output_transcript') ||
            type === 'session.delegation.created' ||
            type === 'response.event'
          ) {
            lastActivityAt = now;
          }

          if (type === 'session.input_transcript.delta') {
            set({
              userCaption: trimCaption(
                `${get().userCaption} ${String(event.delta || '')}`,
              ),
            });
          }

          if (type === 'session.output_transcript.delta') {
            set({
              assistantCaption: trimCaption(
                `${get().assistantCaption} ${String(event.delta || '')}`,
              ),
            });
          }

          if (type === 'session.started') {
            sessionStartedAt = now;
            lastActivityAt = now;
            set({
              state: 'live',
              sessionId: event.session?.id ?? null,
              error: null,
            });

            sessionTimer = window.setInterval(() => {
              const elapsed = Math.max(
                reportedLiveSeconds,
                (Date.now() - sessionStartedAt) / 1000,
              );
              const liveCostUsd =
                (elapsed / 60) * get().livePricePerMinuteUsd;
              const idleRemaining = Math.max(
                0,
                IDLE_TIMEOUT_SECONDS -
                  Math.floor((Date.now() - lastActivityAt) / 1000),
              );
              set({
                liveSeconds: elapsed,
                liveCostUsd,
                idleRemaining,
                sessionCostUsd: liveCostUsd + get().backendCostUsd,
              });

              if (idleRemaining <= 0 && get().state === 'live') {
                get().disconnect();
              }
            }, 1000);
          } else if (type === 'session.usage.updated') {
            reportedLiveSeconds = Math.max(
              reportedLiveSeconds,
              Number(event.usage?.seconds || 0),
            );
          } else if (type === 'response.event') {
            const deltaCost = backendCostFromResponse(event);
            if (deltaCost > 0) {
              const backendCostUsd = get().backendCostUsd + deltaCost;
              set({
                backendCostUsd,
                sessionCostUsd: get().liveCostUsd + backendCostUsd,
              });
            }
          } else if (type === 'session.updated') {
            const updatedModel =
              event.session?.delegation?.responses?.model;
            if (updatedModel) set({ backendModel: String(updatedModel) });
          } else if (type === 'session.closed') {
            const seconds = Number(event.usage?.seconds || reportedLiveSeconds || 0);
            const liveCostUsd =
              (seconds / 60) * get().livePricePerMinuteUsd;
            set({
              liveSeconds: seconds,
              liveCostUsd,
              sessionCostUsd: liveCostUsd + get().backendCostUsd,
            });
            finalizeSessionCost(set, get);
            cleanup();
            set({ state: 'idle', sessionId: null });
          } else if (type === 'error') {
            const message =
              event.error?.message || event.message || 'Erro na sessão Live';
            set({ state: 'error', error: String(message) });
          }
        } catch {
          // Ignore non-JSON diagnostic events.
        }
      });

      events.addEventListener('close', () => {
        if (get().state === 'closing') return;
        if (!sessionPersisted && get().sessionCostUsd > 0) {
          finalizeSessionCost(set, get);
        }
        cleanup();
        if (get().state !== 'idle') {
          set({ state: 'idle', sessionId: null });
        }
      });

      const offer = await connection.createOffer();
      await connection.setLocalDescription(offer);
      await waitForIce(connection);

      const sdp = connection.localDescription?.sdp;
      if (!sdp) throw new Error('Não foi possível gerar a oferta de áudio.');

      const response = await apiFetch('/api/jarvis/live/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sdp,
          backend_mode: get().backendMode,
        }),
      });
      if (!response.ok) {
        let detail = 'Falha ao iniciar Jarvis Live';
        try {
          const data = await response.json();
          detail = data.detail || detail;
        } catch {}
        throw new Error(detail);
      }

      const result = await response.json();
      const answer = result?.transport?.sdp;
      if (!answer) throw new Error('A sessão Live não retornou áudio.');

      await connection.setRemoteDescription({
        type: 'answer',
        sdp: answer,
      });
    } catch (error) {
      cleanup();
      set({
        state: 'error',
        sessionId: null,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  },

  disconnect: () => {
    if (events?.readyState === 'open' && get().state === 'live') {
      set({ state: 'closing' });
      events.send(
        JSON.stringify({
          type: 'session.close',
          event_id: `close_${Date.now()}`,
        }),
      );
      closeTimer = window.setTimeout(() => {
        if (!sessionPersisted && get().sessionCostUsd > 0) {
          finalizeSessionCost(set, get);
        }
        cleanup();
        set({ state: 'idle', sessionId: null });
      }, 5000);
      return;
    }
    if (!sessionPersisted && get().sessionCostUsd > 0) {
      finalizeSessionCost(set, get);
    }
    cleanup();
    set({ state: 'idle', sessionId: null });
  },
}));
