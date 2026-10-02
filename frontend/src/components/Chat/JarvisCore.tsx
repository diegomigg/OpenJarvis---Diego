import { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  BrainCircuit,
  Clock3,
  Cpu,
  Database,
  Maximize2,
  Mic,
  Minimize2,
  Radio,
  Search,
  ShieldCheck,
  Sparkles,
  SunMedium,
  Volume2,
  Waves,
  Zap,
} from 'lucide-react';
import { useAppStore } from '../../lib/store';
import { stripThinkTags } from '../../lib/message-text';
import { useTtsStore } from '../../lib/tts';
import { useJarvisLiveStore } from '../../lib/jarvis-live';

type JarvisMode = 'idle' | 'listening' | 'thinking' | 'speaking' | 'live';

interface JarvisCoreProps {
  compact?: boolean;
}

interface QuickAction {
  label: string;
  prompt: string;
  icon: typeof Sparkles;
  send?: boolean;
}

const QUICK_ACTIONS: QuickAction[] = [
  {
    label: 'Bom dia, Jarvis',
    icon: SunMedium,
    send: true,
    prompt:
      'Bom dia, Jarvis. Inicie meu briefing da manhã. Primeiro confirme a data e a hora locais usando as ferramentas disponíveis. Depois resuma o que merece minha atenção hoje, usando somente fontes realmente acessíveis. Se agenda, e-mail, clima ou outras fontes ainda não estiverem conectadas, diga objetivamente o que falta sem inventar informações.',
  },
  {
    label: 'Prioridades de hoje',
    icon: BrainCircuit,
    send: true,
    prompt:
      'Jarvis, faça uma análise objetiva das minhas prioridades de hoje usando as informações e ferramentas disponíveis. Separe fatos confirmados, pendências e sugestões.',
  },
  {
    label: 'Pesquisar na web',
    icon: Search,
    prompt: 'Jarvis, pesquise na web: ',
  },
  {
    label: 'Consultar meus dados',
    icon: Database,
    prompt: 'Jarvis, consulte minhas fontes e arquivos para responder: ',
  },
];

function greetingFor(date: Date): string {
  const hour = date.getHours();
  if (hour < 12) return 'Bom dia, senhor.';
  if (hour < 18) return 'Boa tarde, senhor.';
  return 'Boa noite, senhor.';
}

function modeCopy(mode: JarvisMode, phase: string, currentTool?: string) {
  if (mode === 'live') {
    return {
      title: 'JARVIS LIVE',
      detail: 'Conversa full-duplex conectada. Pode falar naturalmente e interromper quando quiser.',
    };
  }
  if (mode === 'listening') {
    return { title: 'OUVINDO', detail: 'Pode falar. Estou acompanhando.' };
  }
  if (mode === 'speaking') {
    return { title: 'FALANDO', detail: 'Resposta por voz em reprodução.' };
  }
  if (mode === 'thinking') {
    return {
      title: 'PROCESSANDO',
      detail: currentTool
        ? `Executando ${currentTool}`
        : phase || 'Analisando contexto e preparando a resposta.',
    };
  }
  return { title: 'ONLINE', detail: 'Aguardando seu comando.' };
}

function shortText(value: string | undefined, max = 118): string {
  if (!value) return 'Nenhum contexto recente.';
  const clean = stripThinkTags(value).replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return clean;
  return `${clean.slice(0, max - 1)}…`;
}

export function JarvisCore({ compact = false }: JarvisCoreProps) {
  const selectedModel = useAppStore((s) => s.selectedModel);
  const serverInfo = useAppStore((s) => s.serverInfo);
  const streamState = useAppStore((s) => s.streamState);
  const deepResearch = useAppStore((s) => s.deepResearch);
  const settings = useAppStore((s) => s.settings);
  const updateSettings = useAppStore((s) => s.updateSettings);
  const messages = useAppStore((s) => s.messages);
  const savings = useAppStore((s) => s.savings);
  const liveEnergy = useAppStore((s) => s.liveEnergy);
  const sidebarOpen = useAppStore((s) => s.sidebarOpen);
  const systemPanelOpen = useAppStore((s) => s.systemPanelOpen);
  const setSidebarOpen = useAppStore((s) => s.setSidebarOpen);
  const setSystemPanelOpen = useAppStore((s) => s.setSystemPanelOpen);
  const ttsState = useTtsStore((s) => s.state);
  const liveState = useJarvisLiveStore((s) => s.state);
  const liveAvailable = useJarvisLiveStore((s) => s.available);
  const liveError = useJarvisLiveStore((s) => s.error);
  const liveSessionId = useJarvisLiveStore((s) => s.sessionId);
  const liveBackendMode = useJarvisLiveStore((s) => s.backendMode);
  const liveBackendModel = useJarvisLiveStore((s) => s.backendModel);
  const liveSessionCost = useJarvisLiveStore((s) => s.sessionCostUsd);
  const liveMonthCost = useJarvisLiveStore((s) => s.monthCostUsd);
  const liveSeconds = useJarvisLiveStore((s) => s.liveSeconds);
  const liveIdleRemaining = useJarvisLiveStore((s) => s.idleRemaining);
  const liveUserCaption = useJarvisLiveStore((s) => s.userCaption);
  const liveAssistantCaption = useJarvisLiveStore((s) => s.assistantCaption);
  const setLiveBackendMode = useJarvisLiveStore((s) => s.setBackendMode);
  const ensureLiveStatus = useJarvisLiveStore((s) => s.ensureStatus);
  const connectLive = useJarvisLiveStore((s) => s.connect);
  const disconnectLive = useJarvisLiveStore((s) => s.disconnect);
  const [speechState, setSpeechState] = useState('idle');
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const onSpeechState = (event: Event) => {
      const detail = (event as CustomEvent<{ state?: string }>).detail;
      setSpeechState(detail?.state || 'idle');
    };
    window.addEventListener('jarvis:speech-state', onSpeechState as EventListener);
    return () =>
      window.removeEventListener('jarvis:speech-state', onSpeechState as EventListener);
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    void ensureLiveStatus();
  }, [ensureLiveStatus]);

  const mode: JarvisMode =
    liveState === 'live'
      ? 'live'
      : liveState === 'connecting'
        ? 'thinking'
        : ttsState === 'speaking' || ttsState === 'loading'
          ? 'speaking'
      : speechState === 'recording' || speechState === 'transcribing'
        ? 'listening'
        : streamState.isStreaming
          ? 'thinking'
          : 'idle';

  const currentTool = streamState.activeToolCalls.find((tool) => tool.status === 'running')?.tool;
  const copy = modeCopy(mode, streamState.phase, currentTool);
  const voiceMode = settings.speechEnabled && settings.voiceOutputEnabled && settings.voiceAutoplay;
  const conversationMode = settings.voiceConversationMode && voiceMode;
  const immersive = !sidebarOpen && !systemPanelOpen;
  const model = selectedModel || serverInfo?.model || 'modelo local';
  const agent = serverInfo?.agent || 'orchestrator';

  const lastUser = [...messages].reverse().find((message) => message.role === 'user');
  const lastAssistant = [...messages].reverse().find((message) => message.role === 'assistant');
  const latestAssistantText =
    liveState === 'live' && liveAssistantCaption
      ? liveAssistantCaption
      : streamState.isStreaming && streamState.content
        ? streamState.content
        : lastAssistant?.content;
  const latestUserText =
    liveState === 'live' && liveUserCaption
      ? liveUserCaption
      : lastUser?.content;
  const displayUserText =
    liveState === 'live' && liveUserCaption ? liveUserCaption : lastUser?.content;
  const displayAssistantText =
    liveState === 'live' && liveAssistantCaption
      ? liveAssistantCaption
      : latestAssistantText;

  const dateLabel = useMemo(
    () =>
      new Intl.DateTimeFormat('pt-BR', {
        weekday: 'long',
        day: '2-digit',
        month: 'long',
      }).format(now),
    [now],
  );

  const timeLabel = useMemo(
    () =>
      new Intl.DateTimeFormat('pt-BR', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      }).format(now),
    [now],
  );

  const triggerPrompt = (action: QuickAction) => {
    window.dispatchEvent(
      new CustomEvent('jarvis:quick-prompt', {
        detail: { prompt: action.prompt, send: Boolean(action.send) },
      }),
    );
  };

  const toggleVoiceMode = () => {
    const next = !voiceMode;
    updateSettings({
      speechEnabled: next,
      voiceOutputEnabled: next,
      voiceAutoplay: next,
      voiceConversationMode: next ? settings.voiceConversationMode : false,
    });
  };

  const toggleConversationMode = () => {
    const next = !conversationMode;
    updateSettings({
      speechEnabled: next ? true : settings.speechEnabled,
      voiceOutputEnabled: next ? true : settings.voiceOutputEnabled,
      voiceAutoplay: next ? true : settings.voiceAutoplay,
      voiceConversationMode: next,
    });

    if (next) {
      window.setTimeout(
        () => window.dispatchEvent(new CustomEvent('jarvis:toggle-listening')),
        120,
      );
    }
  };

  const toggleListening = () => {
    if (!voiceMode) {
      updateSettings({
        speechEnabled: true,
        voiceOutputEnabled: true,
        voiceAutoplay: true,
      });
      window.setTimeout(
        () => window.dispatchEvent(new CustomEvent('jarvis:toggle-listening')),
        80,
      );
      return;
    }
    window.dispatchEvent(new CustomEvent('jarvis:toggle-listening'));
  };

  const toggleImmersive = () => {
    if (immersive) {
      setSidebarOpen(true);
      setSystemPanelOpen(true);
    } else {
      setSidebarOpen(false);
      setSystemPanelOpen(false);
    }
  };

  const toggleJarvisLive = async () => {
    if (liveState === 'live' || liveState === 'connecting' || liveState === 'closing') {
      disconnectLive();
      return;
    }

    // GPT-Live owns microphone + speaker while active. Keep the chained local
    // voice pipeline as a fallback, but never let both listen at once.
    updateSettings({ voiceConversationMode: false });
    useTtsStore.getState().stop();
    await connectLive();
  };

  if (compact) {
    return (
      <div className="jarvis-compact-shell jarvis-compact-shell--v2">
        <button
          type="button"
          className={`jarvis-core jarvis-core--compact jarvis-core--${mode}`}
          onClick={liveAvailable ? () => void toggleJarvisLive() : toggleListening}
          aria-label="Falar com Jarvis"
          title={liveState === 'live' ? 'Encerrar Jarvis Live' : liveAvailable ? 'Iniciar Jarvis Live' : 'Clique para falar com Jarvis'}
        >
          <div className="jarvis-core__halo" />
          <div className="jarvis-core__ring jarvis-core__ring--outer" />
          <div className="jarvis-core__ring jarvis-core__ring--mid" />
          <div className="jarvis-core__orb">
            {mode === 'listening' ? (
              <Mic size={20} />
            ) : mode === 'speaking' ? (
              <Volume2 size={20} />
            ) : mode === 'thinking' ? (
              <BrainCircuit size={20} />
            ) : (
              <Waves size={20} />
            )}
          </div>
        </button>

        <div className="jarvis-compact-context">
          <div className="jarvis-compact-head">
            <span className="hud-heartbeat" />
            <span className="jarvis-kicker">JARVIS // {copy.title}</span>
            {currentTool && <span className="jarvis-mini-tool">{currentTool}</span>}
          </div>
          <div className="jarvis-compact-detail">{copy.detail}</div>
          <div className="jarvis-live-caption">
            <span>VOCÊ</span>
            <strong>{shortText(displayUserText, 72)}</strong>
          </div>
        </div>

        <div className="jarvis-compact-actions">
          <button
            type="button"
            className={`jarvis-compact-voice jarvis-compact-live ${liveState === 'live' ? 'is-active' : ''}`}
            onClick={() => void toggleJarvisLive()}
            title={liveState === 'live' ? 'Encerrar Jarvis Live' : 'Iniciar Jarvis Live'}
          >
            <Radio size={12} />
            <span>{liveState === 'connecting' ? '...' : liveState === 'live' ? 'LIVE' : 'GPT LIVE'}</span>
          </button>
          <button
            type="button"
            className={`jarvis-compact-voice ${immersive ? 'is-active' : ''}`}
            onClick={toggleImmersive}
            title={immersive ? 'Restaurar painéis' : 'Modo imersivo'}
          >
            {immersive ? <Minimize2 size={12} /> : <Maximize2 size={12} />}
            <span>HUD</span>
          </button>
        </div>

        <div className="jarvis-compact-meta">
          <span>{model}</span>
          <span className="jarvis-divider">/</span>
          <span>{timeLabel}</span>
        </div>
      </div>
    );
  }

  return (
    <section className="jarvis-command-center jarvis-command-center--v2">
      <div className="jarvis-topline">
        <div>
          <div className="jarvis-kicker">
            <span className="hud-heartbeat" /> J.A.R.V.I.S // PERSONAL INTELLIGENCE
          </div>
          <h1 className="jarvis-greeting">{greetingFor(now)}</h1>
          <p className="jarvis-subtitle">
            Assistente local pronto para conversar, analisar e operar ferramentas.
          </p>
        </div>

        <div className="jarvis-top-actions">
          <button
            type="button"
            className={`jarvis-hud-toggle ${immersive ? 'is-active' : ''}`}
            onClick={toggleImmersive}
          >
            {immersive ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
            {immersive ? 'Restaurar' : 'Imersivo'}
          </button>
          <div className="jarvis-clock">
            <div className="jarvis-clock__time">{timeLabel}</div>
            <div className="jarvis-clock__date">{dateLabel}</div>
          </div>
        </div>
      </div>

      <div className="jarvis-v2-grid">
        <aside className="jarvis-side-stack jarvis-side-stack--left">
          <div className="jarvis-glass-panel">
            <div className="jarvis-panel-title">SERVIÇOS</div>
            <div className="jarvis-service-row">
              <span className={`jarvis-dot ${voiceMode ? 'is-online' : ''}`} />
              <span>Reconhecimento de voz</span>
              <strong>{voiceMode ? 'ATIVO' : 'OFF'}</strong>
            </div>
            <div className="jarvis-service-row">
              <span className={`jarvis-dot ${liveState === 'live' ? 'is-online' : ''}`} />
              <span>Jarvis Live</span>
              <strong>{liveState === 'connecting' ? 'LINK...' : liveState === 'live' ? 'FULL DUPLEX' : liveAvailable ? 'READY' : 'OFF'}</strong>
            </div>
            <div className="jarvis-service-row">
              <span className="jarvis-dot is-online" />
              <span>Orchestrator</span>
              <strong>ONLINE</strong>
            </div>
            <div className="jarvis-service-row">
              <span className="jarvis-dot is-online" />
              <span>Relógio local</span>
              <strong>ATIVO</strong>
            </div>
          </div>

          <div className="jarvis-glass-panel">
            <div className="jarvis-panel-title">{liveState === 'live' ? 'CUSTO AO VIVO' : 'TELEMETRIA'}</div>
            <div className="jarvis-metrics">
              {liveState === 'live' ? (
                <>
                  <div>
                    <Zap size={14} />
                    <strong>US$ {liveSessionCost.toFixed(3)}</strong>
                    <span>sessão</span>
                  </div>
                  <div>
                    <Activity size={14} />
                    <strong>US$ {liveMonthCost.toFixed(2)}</strong>
                    <span>mês</span>
                  </div>
                  <div>
                    <Clock3 size={14} />
                    <strong>{liveIdleRemaining}s</strong>
                    <span>auto-standby</span>
                  </div>
                </>
              ) : (
                <>
                  <div>
                    <Zap size={14} />
                    <strong>{(liveEnergy?.power_w ?? 0).toFixed(1)} W</strong>
                    <span>potência</span>
                  </div>
                  <div>
                    <Activity size={14} />
                    <strong>{(savings?.total_tokens ?? 0).toLocaleString('pt-BR')}</strong>
                    <span>tokens</span>
                  </div>
                  <div>
                    <ShieldCheck size={14} />
                    <strong>LOCAL</strong>
                    <span>privacidade</span>
                  </div>
                </>
              )}
            </div>
          </div>
        </aside>

        <main className="jarvis-stage jarvis-stage--v2">
          <div className="jarvis-orbit-field" aria-hidden="true">
            <span className="jarvis-orbit jarvis-orbit--one" />
            <span className="jarvis-orbit jarvis-orbit--two" />
            <span className="jarvis-orbit jarvis-orbit--three" />
            <span className="jarvis-orbit jarvis-orbit--four" />
            <span className="jarvis-orbit-node jarvis-orbit-node--brain">
              {liveState === 'live' ? backendModel.replace('gpt-5.6-', '').toUpperCase() : 'LOCAL'}
            </span>
            <span className="jarvis-orbit-node jarvis-orbit-node--cost">
              US$ {sessionCostUsd.toFixed(2)}
            </span>
            <span className="jarvis-orbit-node jarvis-orbit-node--guard">
              {liveState === 'live' ? `AUTO SLEEP ${idleRemaining}s` : 'STANDBY'}
            </span>
          </div>

          <button
            type="button"
            className={`jarvis-core jarvis-core--hero jarvis-core--${mode}`}
            onClick={liveAvailable ? () => void toggleJarvisLive() : toggleListening}
            aria-label="Falar com Jarvis"
            title={liveState === 'live' ? 'Encerrar Jarvis Live' : liveAvailable ? 'Clique para iniciar Jarvis Live' : 'Ativar voz e falar com Jarvis'}
          >
            <div className="jarvis-core__halo" />
            <div className="jarvis-core__scan" />
            <div className="jarvis-core__ring jarvis-core__ring--outer" />
            <div className="jarvis-core__ring jarvis-core__ring--mid" />
            <div className="jarvis-core__ring jarvis-core__ring--inner" />
            <div className="jarvis-core__ticks" />
            <div className="jarvis-core__orb">
              {mode === 'live' ? (
                <Radio size={42} />
              ) : mode === 'listening' ? (
                <Mic size={42} />
              ) : mode === 'speaking' ? (
                <Volume2 size={42} />
              ) : mode === 'thinking' ? (
                <BrainCircuit size={42} />
              ) : (
                <Waves size={42} />
              )}
            </div>
          </button>

          <div className="jarvis-status jarvis-status--hero">
            <div className="jarvis-status__mode">{copy.title}</div>
            <div className="jarvis-status__detail">
              {liveState === 'error' && liveError ? liveError : copy.detail}
            </div>
            {liveSessionId && (
              <div className="jarvis-tool-chip">
                <Radio size={12} />
                sessão {liveSessionId.slice(0, 16)}
              </div>
            )}
            {currentTool && (
              <div className="jarvis-tool-chip">
                <Activity size={12} />
                ferramenta ativa: {currentTool}
              </div>
            )}
          </div>

          <div className="jarvis-dialogue-card">
            <div>
              <span>VOCÊ</span>
              <p>{shortText(displayUserText, 96)}</p>
            </div>
            <div>
              <span>JARVIS</span>
              <p>{shortText(displayAssistantText, 132)}</p>
            </div>
          </div>
        </main>

        <aside className="jarvis-side-stack jarvis-side-stack--right">
          <div className="jarvis-glass-panel">
            <div className="jarvis-panel-title">CONTEXTO ATUAL</div>
            <div className="jarvis-context-item">
              <span>MODELO</span>
              <strong>{model}</strong>
            </div>
            <div className="jarvis-context-item">
              <span>AGENTE</span>
              <strong>{agent}</strong>
            </div>
            <div className="jarvis-context-item">
              <span>MODO</span>
              <strong>{liveState === 'live' ? 'GPT-LIVE / FULL DUPLEX' : deepResearch ? 'DEEP RESEARCH' : 'LOCAL / SMART'}</strong>
            </div>
            {liveState === 'live' && (
              <>
                <div className="jarvis-context-item">
                  <span>LIVE BRAIN</span>
                  <strong>gpt-live-1 + {liveBackendModel}</strong>
                </div>
                <div className="jarvis-context-item">
                  <span>POLÍTICA DE CUSTO</span>
                  <strong>{liveBackendMode === 'economy' ? 'ECONÔMICO / LUNA' : 'ANÁLISE / TERRA'}</strong>
                </div>
                <div className="jarvis-context-item">
                  <span>SESSÃO</span>
                  <strong>{Math.floor(liveSeconds / 60)}m {Math.floor(liveSeconds % 60)}s · US$ {liveSessionCost.toFixed(3)}</strong>
                </div>
              </>
            )}
          </div>

          <div className="jarvis-glass-panel jarvis-cost-panel">
            <div className="jarvis-panel-title">CUSTO & INTELIGÊNCIA</div>
            <div className="jarvis-brain-switch">
              <button
                type="button"
                className={backendMode === 'economy' ? 'is-active' : ''}
                onClick={() => setBackendMode('economy')}
              >
                ECONOMIA
                <small>Luna</small>
              </button>
              <button
                type="button"
                className={backendMode === 'analysis' ? 'is-active' : ''}
                onClick={() => setBackendMode('analysis')}
              >
                ANÁLISE
                <small>Terra</small>
              </button>
            </div>
            <div className="jarvis-cost-grid">
              <div>
                <span>LIVE</span>
                <strong>US$ {liveCostUsd.toFixed(3)}</strong>
              </div>
              <div>
                <span>BACKEND</span>
                <strong>US$ {backendCostUsd.toFixed(3)}</strong>
              </div>
              <div>
                <span>SESSÃO</span>
                <strong>US$ {sessionCostUsd.toFixed(3)}</strong>
              </div>
              <div>
                <span>MÊS</span>
                <strong>US$ {monthCostUsd.toFixed(2)}</strong>
              </div>
            </div>
            {liveState === 'live' && (
              <div className="jarvis-live-budget-line">
                <span>{Math.floor(liveSeconds / 60)}:{String(Math.floor(liveSeconds % 60)).padStart(2, '0')}</span>
                <strong>standby em {idleRemaining}s</strong>
              </div>
            )}
          </div>

          <div className="jarvis-glass-panel jarvis-attention-panel">
            <div className="jarvis-panel-title">COMANDO RÁPIDO</div>
            <button type="button" onClick={() => triggerPrompt(QUICK_ACTIONS[0])}>
              <SunMedium size={15} />
              <span>Bom dia, Jarvis</span>
            </button>
            <button type="button" onClick={() => triggerPrompt(QUICK_ACTIONS[1])}>
              <BrainCircuit size={15} />
              <span>Prioridades do dia</span>
            </button>
          </div>
        </aside>
      </div>

      <div className="jarvis-system-grid jarvis-system-grid--v2">
        <div className="jarvis-system-card">
          <Cpu size={14} />
          <div>
            <span>MODELO</span>
            <strong>{model}</strong>
          </div>
        </div>
        <div className="jarvis-system-card">
          <BrainCircuit size={14} />
          <div>
            <span>AGENTE</span>
            <strong>{agent}</strong>
          </div>
        </div>
        <div className="jarvis-system-card">
          <Activity size={14} />
          <div>
            <span>ESTADO</span>
            <strong>{copy.title}</strong>
          </div>
        </div>
        <div className="jarvis-system-card">
          <Clock3 size={14} />
          <div>
            <span>REFERÊNCIA</span>
            <strong>Relógio local ativo</strong>
          </div>
        </div>
      </div>

      <div className="jarvis-actions jarvis-actions--v2">
        <button
          type="button"
          className={`jarvis-action jarvis-action--live ${liveState === 'live' ? 'is-active' : ''}`}
          onClick={() => void toggleJarvisLive()}
          disabled={liveAvailable === false || liveState === 'closing'}
          title={liveAvailable === false ? 'Configure OPENAI_API_KEY em Settings > API Keys' : 'Conversa natural full-duplex com GPT-Live'}
        >
          <Radio size={15} />
          <span>
            {liveState === 'connecting'
              ? 'Conectando Jarvis Live...'
              : liveState === 'live'
                ? 'Encerrar Jarvis Live'
                : 'Iniciar Jarvis Live'}
          </span>
        </button>
        <button
          type="button"
          className={`jarvis-action jarvis-action--brain ${liveBackendMode === 'analysis' ? 'is-active' : ''}`}
          onClick={() =>
            setLiveBackendMode(
              liveBackendMode === 'economy' ? 'analysis' : 'economy',
            )
          }
          title="Luna reduz custo; Terra entra quando você quer análise mais profunda"
        >
          <BrainCircuit size={15} />
          <span>
            {liveBackendMode === 'economy'
              ? 'Cérebro: Luna econômico'
              : 'Cérebro: Terra análise'}
          </span>
        </button>
        <button
          type="button"
          className={`jarvis-action jarvis-action--voice ${voiceMode ? 'is-active' : ''}`}
          onClick={toggleVoiceMode}
        >
          <Mic size={15} />
          <span>{voiceMode ? 'Voz local ativa' : 'Ativar voz local'}</span>
        </button>
        <button
          type="button"
          className={`jarvis-action jarvis-action--conversation ${conversationMode ? 'is-active' : ''}`}
          onClick={toggleConversationMode}
          disabled={liveState === 'live' || liveState === 'connecting'}
        >
          <Waves size={15} />
          <span>{conversationMode ? 'Conversa local contínua' : 'Conversa local contínua'}</span>
        </button>
        {QUICK_ACTIONS.slice(2).map((action) => {
          const Icon = action.icon;
          return (
            <button
              key={action.label}
              type="button"
              className="jarvis-action"
              onClick={() => triggerPrompt(action)}
            >
              <Icon size={15} />
              <span>{action.label}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
