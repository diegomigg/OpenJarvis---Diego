import { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  BrainCircuit,
  Clock3,
  Cpu,
  Database,
  Mic,
  Search,
  Sparkles,
  SunMedium,
  Volume2,
  Waves,
} from 'lucide-react';
import { useAppStore } from '../../lib/store';
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
    return { title: 'RESPONDENDO', detail: 'Resposta por voz em reprodução.' };
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

export function JarvisCore({ compact = false }: JarvisCoreProps) {
  const selectedModel = useAppStore((s) => s.selectedModel);
  const serverInfo = useAppStore((s) => s.serverInfo);
  const streamState = useAppStore((s) => s.streamState);
  const deepResearch = useAppStore((s) => s.deepResearch);
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
  const model = selectedModel || serverInfo?.model || 'modelo local';
  const agent = serverInfo?.agent || 'orchestrator';

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

  if (compact) {
    return (
      <div className="jarvis-compact-shell">
        <div className={`jarvis-core jarvis-core--compact jarvis-core--${mode}`} aria-hidden="true">
          <div className="jarvis-core__halo" />
          <div className="jarvis-core__ring jarvis-core__ring--outer" />
          <div className="jarvis-core__ring jarvis-core__ring--mid" />
          <div className="jarvis-core__orb">
            <Waves size={18} />
          </div>
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="hud-heartbeat" />
            <span className="jarvis-kicker">JARVIS // {copy.title}</span>
          </div>
          <div className="jarvis-compact-detail truncate">{copy.detail}</div>
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
    <section className="jarvis-command-center">
      <div className="jarvis-topline">
        <div>
          <div className="jarvis-kicker">
            <span className="hud-heartbeat" /> JARVIS PERSONAL INTELLIGENCE
          </div>
          <h1 className="jarvis-greeting">{greetingFor(now)}</h1>
          <p className="jarvis-subtitle">Sistema local pronto para conversar, pesquisar e executar ferramentas.</p>
        </div>
        <div className="jarvis-clock">
          <div className="jarvis-clock__time">{timeLabel}</div>
          <div className="jarvis-clock__date">{dateLabel}</div>
        </div>
      </div>

      <div className="jarvis-stage">
        <div className={`jarvis-core jarvis-core--${mode}`}>
          <div className="jarvis-core__halo" />
          <div className="jarvis-core__scan" />
          <div className="jarvis-core__ring jarvis-core__ring--outer" />
          <div className="jarvis-core__ring jarvis-core__ring--mid" />
          <div className="jarvis-core__ring jarvis-core__ring--inner" />
          <div className="jarvis-core__ticks" />
          <div className="jarvis-core__orb">
            {mode === 'listening' ? (
              <Mic size={34} />
            ) : mode === 'speaking' ? (
              <Volume2 size={34} />
            ) : mode === 'thinking' ? (
              <BrainCircuit size={34} />
            ) : (
              <Waves size={34} />
            )}
          </div>
        </div>

        <div className="jarvis-status">
          <div className="jarvis-status__mode">{copy.title}</div>
          <div className="jarvis-status__detail">{copy.detail}</div>
          {currentTool && (
            <div className="jarvis-tool-chip">
              <Activity size={12} />
              ferramenta ativa: {currentTool}
            </div>
          )}
        </div>
      </div>

      <div className="jarvis-system-grid">
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
            <span>MODO</span>
            <strong>{deepResearch ? 'Deep Research' : 'Local / Orchestrator'}</strong>
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

      <div className="jarvis-actions">
        {QUICK_ACTIONS.map((action) => {
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
