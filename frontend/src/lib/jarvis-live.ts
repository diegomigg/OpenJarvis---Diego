import { create } from 'zustand';
import { apiFetch } from './api';

export type JarvisLiveState =
  | 'idle'
  | 'connecting'
  | 'live'
  | 'closing'
  | 'error';

interface JarvisLiveStore {
  state: JarvisLiveState;
  available: boolean | null;
  sessionId: string | null;
  error: string | null;
  lastEvent: string | null;
  ensureStatus: () => Promise<void>;
  connect: () => Promise<void>;
  disconnect: () => void;
}

let peer: RTCPeerConnection | null = null;
let events: RTCDataChannel | null = null;
let microphone: MediaStream | null = null;
let audio: HTMLAudioElement | null = null;
let closeTimer: number | null = null;

function cleanup() {
  if (closeTimer !== null) {
    window.clearTimeout(closeTimer);
    closeTimer = null;
  }
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

  ensureStatus: async () => {
    try {
      const response = await apiFetch('/api/jarvis/live/status');
      if (!response.ok) throw new Error('Jarvis Live indisponível');
      const data = await response.json();
      set({ available: Boolean(data.available) });
    } catch {
      set({ available: false });
    }
  },

  connect: async () => {
    if (get().state === 'connecting' || get().state === 'live') return;
    cleanup();
    set({ state: 'connecting', error: null, sessionId: null });

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

          if (type === 'session.started') {
            set({
              state: 'live',
              sessionId: event.session?.id ?? null,
              error: null,
            });
          } else if (type === 'session.closed') {
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
        body: JSON.stringify({ sdp }),
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
      events.send(JSON.stringify({ type: 'session.close' }));
      closeTimer = window.setTimeout(() => {
        cleanup();
        set({ state: 'idle', sessionId: null });
      }, 5000);
      return;
    }
    cleanup();
    set({ state: 'idle', sessionId: null });
  },
}));
