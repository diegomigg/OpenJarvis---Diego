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

type JarvisMode = 'idle' | 'listening' | 'thinking' | 'speaking';

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

  const mode: JarvisMode =
    ttsState === 'speaking' || ttsState === 'loading'
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
    streamState.isStreaming && streamState.content
      ? streamState.content
      : lastAssistant?.content;

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

  if (compact) {
    return (
      <div className="jarvis-compact-shell jarvis-compact-shell--v2">
        <button
          type="button"
          className={`jarvis-core jarvis-core--compact jarvis-core--${mode}`}
          onClick={toggleListening}
          aria-label="Falar com Jarvis"
          title="Clique para falar com Jarvis"
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
            <strong>{shortText(lastUser?.content, 72)}</strong>
          </div>
        </div>

        <div className="jarvis-compact-actions">
          <button
            type="button"
            className={`jarvis-compact-voice ${conversationMode ? 'is-active' : ''}`}
            onClick={toggleConversationMode}
            title={conversationMode ? 'Encerrar conversa contínua' : 'Iniciar conversa contínua'}
          >
            <Radio size={12} />
            <span>{conversationMode ? 'LIVE' : 'VOZ'}</span>
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
              <span className={`jarvis-dot ${conversationMode ? 'is-online' : ''}`} />
              <span>Conversa contínua</span>
              <strong>{conversationMode ? 'LIVE' : 'OFF'}</strong>
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
            <div className="jarvis-panel-title">TELEMETRIA</div>
            <div className="jarvis-metrics">
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
            </div>
          </div>
        </aside>

        <main className="jarvis-stage jarvis-stage--v2">
          <div className="jarvis-orbit-field" aria-hidden="true">
            <span className="jarvis-orbit jarvis-orbit--one" />
            <span className="jarvis-orbit jarvis-orbit--two" />
            <span className="jarvis-orbit jarvis-orbit--three" />
            <span className="jarvis-orbit jarvis-orbit--four" />
          </div>

          <button
            type="button"
            className={`jarvis-core jarvis-core--hero jarvis-core--${mode}`}
            onClick={toggleListening}
            aria-label="Falar com Jarvis"
            title={voiceMode ? 'Clique para falar com Jarvis' : 'Ativar voz e falar com Jarvis'}
          >
            <div className="jarvis-core__halo" />
            <div className="jarvis-core__scan" />
            <div className="jarvis-core__ring jarvis-core__ring--outer" />
            <div className="jarvis-core__ring jarvis-core__ring--mid" />
            <div className="jarvis-core__ring jarvis-core__ring--inner" />
            <div className="jarvis-core__ticks" />
            <div className="jarvis-core__orb">
              {mode === 'listening' ? (
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
            <div className="jarvis-status__detail">{copy.detail}</div>
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
              <p>{shortText(lastUser?.content, 96)}</p>
            </div>
            <div>
              <span>JARVIS</span>
              <p>{shortText(latestAssistantText, 132)}</p>
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
              <strong>{deepResearch ? 'DEEP RESEARCH' : 'LOCAL / SMART'}</strong>
            </div>
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
          className={`jarvis-action jarvis-action--voice ${voiceMode ? 'is-active' : ''}`}
          onClick={toggleVoiceMode}
        >
          <Mic size={15} />
          <span>{voiceMode ? 'Voz ativa' : 'Ativar modo voz'}</span>
        </button>
        <button
          type="button"
          className={`jarvis-action jarvis-action--conversation ${conversationMode ? 'is-active' : ''}`}
          onClick={toggleConversationMode}
        >
          <Radio size={15} />
          <span>{conversationMode ? 'Conversa contínua' : 'Iniciar conversa contínua'}</span>
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
