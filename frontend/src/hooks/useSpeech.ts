import { useState, useCallback, useRef, useEffect } from 'react';
import { transcribeAudio, fetchSpeechHealth } from '../lib/api';

export type SpeechState = 'idle' | 'recording' | 'transcribing';

const SILENCE_THRESHOLD = 0.025;
const SILENCE_TO_STOP_MS = 950;
const MIN_RECORDING_MS = 550;

function normalizeJarvisTranscript(text: string): string {
  // Whisper can map the English wake/name "Jarvis" to nearby Portuguese
  // spellings. Keep this deliberately narrow so ordinary words are untouched.
  return text.replace(
    /\b(javes|javis|jarves|jervis|jérvis|gervis|járvis)\b/gi,
    'Jarvis',
  );
}

export function useSpeech() {
  const [state, setState] = useState<SpeechState>('idle');
  const [error, setError] = useState<string | null>(null);
  const [available, setAvailable] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const vadFrameRef = useRef<number | null>(null);
  const heardSpeechRef = useRef(false);
  const lastSpeechAtRef = useRef(0);
  const recordingStartedAtRef = useRef(0);
  const silenceEventSentRef = useRef(false);

  const stopVad = useCallback(() => {
    if (vadFrameRef.current !== null) {
      cancelAnimationFrame(vadFrameRef.current);
      vadFrameRef.current = null;
    }
    const ctx = audioContextRef.current;
    audioContextRef.current = null;
    if (ctx && ctx.state !== 'closed') {
      void ctx.close().catch(() => {});
    }
  }, []);

  useEffect(() => {
    window.dispatchEvent(new CustomEvent('jarvis:speech-state', { detail: { state } }));
  }, [state]);

  // Check if speech backend is available on mount.
  useEffect(() => {
    fetchSpeechHealth()
      .then((health) => setAvailable(health.available))
      .catch(() => setAvailable(false));
  }, []);

  useEffect(() => {
    return () => {
      stopVad();
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    };
  }, [stopVad]);

  const startVoiceActivityDetection = useCallback((stream: MediaStream) => {
    try {
      const ctx = new AudioContext();
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      analyser.smoothingTimeConstant = 0.35;
      source.connect(analyser);
      audioContextRef.current = ctx;

      const samples = new Uint8Array(analyser.fftSize);
      recordingStartedAtRef.current = performance.now();
      lastSpeechAtRef.current = recordingStartedAtRef.current;
      heardSpeechRef.current = false;
      silenceEventSentRef.current = false;

      const tick = () => {
        const recorder = mediaRecorderRef.current;
        if (!recorder || recorder.state !== 'recording') return;

        analyser.getByteTimeDomainData(samples);
        let sumSquares = 0;
        for (let i = 0; i < samples.length; i += 1) {
          const normalized = (samples[i] - 128) / 128;
          sumSquares += normalized * normalized;
        }
        const rms = Math.sqrt(sumSquares / samples.length);
        const now = performance.now();

        if (rms >= SILENCE_THRESHOLD) {
          heardSpeechRef.current = true;
          lastSpeechAtRef.current = now;
        }

        const hasSpokenLongEnough =
          heardSpeechRef.current &&
          now - recordingStartedAtRef.current >= MIN_RECORDING_MS;
        const silenceLongEnough =
          hasSpokenLongEnough &&
          now - lastSpeechAtRef.current >= SILENCE_TO_STOP_MS;

        if (silenceLongEnough && !silenceEventSentRef.current) {
          silenceEventSentRef.current = true;
          window.dispatchEvent(new CustomEvent('jarvis:silence-detected'));
          return;
        }

        vadFrameRef.current = requestAnimationFrame(tick);
      };

      vadFrameRef.current = requestAnimationFrame(tick);
    } catch {
      // Voice recording still works even when Web Audio VAD is unavailable.
    }
  }, []);

  const startRecording = useCallback(async (): Promise<void> => {
    setError(null);

    if (!navigator.mediaDevices?.getUserMedia) {
      setError('Microphone not supported in this browser');
      return;
    }
    if (mediaRecorderRef.current?.state === 'recording') return;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      streamRef.current = stream;

      const recorder = new MediaRecorder(stream);
      chunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      recorder.start();
      mediaRecorderRef.current = recorder;
      setState('recording');
      startVoiceActivityDetection(stream);
    } catch {
      setError('Microphone access denied');
      setState('idle');
    }
  }, [startVoiceActivityDetection]);

  const stopRecording = useCallback(async (): Promise<string> => {
    return new Promise((resolve, reject) => {
      const recorder = mediaRecorderRef.current;
      if (!recorder || recorder.state !== 'recording') {
        reject(new Error('Not recording'));
        return;
      }

      stopVad();

      recorder.onstop = async () => {
        setState('transcribing');

        streamRef.current?.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
        mediaRecorderRef.current = null;

        const blob = new Blob(chunksRef.current, {
          type: recorder.mimeType || 'audio/webm',
        });
        chunksRef.current = [];

        try {
          const result = await transcribeAudio(blob);
          setState('idle');
          resolve(normalizeJarvisTranscript(result.text));
        } catch (err) {
          setState('idle');
          const msg = err instanceof Error ? err.message : 'Transcription failed';
          setError(msg);
          reject(err);
        }
      };

      recorder.stop();
    });
  }, [stopVad]);

  return {
    state,
    error,
    available,
    startRecording,
    stopRecording,
    isRecording: state === 'recording',
    isTranscribing: state === 'transcribing',
  };
}
