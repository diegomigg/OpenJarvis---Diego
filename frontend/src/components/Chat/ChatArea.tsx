import { useRef, useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { MessageBubble } from './MessageBubble';
import { InputArea } from './InputArea';
import { StreamingDots } from './StreamingDots';
import { useAppStore } from '../../lib/store';
import { useTtsStore } from '../../lib/tts';
import { JarvisCore } from './JarvisCore';
import {
  Database,
  Maximize2,
  MessageSquareText,
  Minimize2,
  PanelRightClose,
  PanelRightOpen,
  X,
} from 'lucide-react';
import { listConnectors } from '../../lib/connectors-api';

function nextSpeechChunk(
  text: string,
  firstChunk: boolean,
): { chunk: string; consumed: number } | null {
  const minLength = firstChunk ? 42 : 24;

  for (let i = minLength; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1] ?? '';

    if ('.!?'.includes(char) && (!next || /\s/.test(next))) {
      return { chunk: text.slice(0, i + 1), consumed: i + 1 };
    }

    // Do not make the user wait for a very long opening sentence. Once the
    // first thought is established, a comma/colon is a natural early hand-off
    // to TTS while the LLM continues generating.
    if (firstChunk && i >= 58 && ',:;'.includes(char)) {
      return { chunk: text.slice(0, i + 1), consumed: i + 1 };
    }
  }

  if (text.length >= 180) {
    const splitAt = text.lastIndexOf(' ', 180);
    if (splitAt >= minLength) {
      return { chunk: text.slice(0, splitAt), consumed: splitAt + 1 };
    }
  }

  return null;
}

export function ChatArea() {
  const activeId = useAppStore((s) => s.activeId);
  const messages = useAppStore((s) => s.messages);
  const streamState = useAppStore((s) => s.streamState);
  const systemPanelOpen = useAppStore((s) => s.systemPanelOpen);
  const sidebarOpen = useAppStore((s) => s.sidebarOpen);
  const toggleSystemPanel = useAppStore((s) => s.toggleSystemPanel);
  const immersive = !sidebarOpen && !systemPanelOpen;
  const navigate = useNavigate();

  const listRef = useRef<HTMLDivElement>(null);
  const shouldAutoScroll = useRef(true);
  const wasStreaming = useRef(false);
  const lastScrollTop = useRef(0);
  const isCurrentChatStreaming =
    streamState.isStreaming && streamState.conversationId === activeId;

  const voiceOutputEnabled = useAppStore((s) => s.settings.voiceOutputEnabled);
  const voiceAutoplay = useAppStore((s) => s.settings.voiceAutoplay);
  const ttsAvailable = useTtsStore((s) => s.available);

  const [chatOpen, setChatOpen] = useState(false);
  const [chatExpanded, setChatExpanded] = useState(false);

  useEffect(() => {
    if (!voiceOutputEnabled) return;
    void useTtsStore.getState().ensureHealth();
  }, [voiceOutputEnabled]);

  const speechProgressRef = useRef<{
    conversationId: string | null;
    messageId: string | null;
    consumed: number;
    started: boolean;
  }>({
    conversationId: null,
    messageId: null,
    consumed: 0,
    started: false,
  });
  const previousStreamingRef = useRef(false);

  // Stream the answer into TTS sentence-by-sentence. The old path waited for
  // the entire LLM reply to finish before synthesis even started, which made
  // voice feel several seconds behind the already-visible text.
  useEffect(() => {
    const tts = useTtsStore.getState();
    const last = messages[messages.length - 1];
    const canSpeak =
      voiceOutputEnabled &&
      voiceAutoplay &&
      ttsAvailable === true &&
      last?.role === 'assistant' &&
      activeId !== null;

    if (isCurrentChatStreaming && canSpeak) {
      const progress = speechProgressRef.current;
      if (
        progress.conversationId !== activeId ||
        progress.messageId !== last.id
      ) {
        progress.conversationId = activeId;
        progress.messageId = last.id;
        progress.consumed = 0;
        progress.started = false;
      }

      let remaining = streamState.content.slice(progress.consumed);
      let next = nextSpeechChunk(remaining, !progress.started);

      while (next) {
        tts.enqueue(last.id, next.chunk);
        progress.consumed += next.consumed;
        progress.started = true;
        tts.markAutoSpoken(last.id);
        remaining = streamState.content.slice(progress.consumed);
        next = nextSpeechChunk(remaining, false);
      }
    }

    const justFinished = previousStreamingRef.current && !isCurrentChatStreaming;
    previousStreamingRef.current = isCurrentChatStreaming;

    if (justFinished && canSpeak) {
      const progress = speechProgressRef.current;
      const finalText = last.content || '';
      const remainder =
        progress.messageId === last.id
          ? finalText.slice(progress.consumed)
          : finalText;

      if (remainder.trim()) {
        tts.enqueue(last.id, remainder);
      }
      tts.markAutoSpoken(last.id);
      speechProgressRef.current = {
        conversationId: null,
        messageId: null,
        consumed: 0,
        started: false,
      };
    }
  }, [
    activeId,
    isCurrentChatStreaming,
    messages,
    streamState.content,
    ttsAvailable,
    voiceAutoplay,
    voiceOutputEnabled,
  ]);

  const currentStreamContent = isCurrentChatStreaming ? streamState.content : '';

  const [hasConnectedSources, setHasConnectedSources] = useState<boolean | null>(null);
  const [bannerDismissed, setBannerDismissed] = useState(false);

  useEffect(() => {
    listConnectors()
      .then((list) => setHasConnectedSources(list.some((c) => c.connected)))
      .catch(() => setHasConnectedSources(null));
  }, []);

  useEffect(() => {
    if (isCurrentChatStreaming && !wasStreaming.current) {
      shouldAutoScroll.current = true;
    }
    wasStreaming.current = isCurrentChatStreaming;

    if (shouldAutoScroll.current && listRef.current && (!immersive || chatOpen)) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [messages, currentStreamContent, isCurrentChatStreaming, immersive, chatOpen]);

  const handleScroll = () => {
    if (!listRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = listRef.current;
    const distance = scrollHeight - scrollTop - clientHeight;
    const scrolledUp = scrollTop < lastScrollTop.current;
    lastScrollTop.current = scrollTop;

    if (scrolledUp && distance >= 1) {
      shouldAutoScroll.current = false;
    } else if (!scrolledUp) {
      shouldAutoScroll.current = distance < 2;
    }
  };

  const isEmpty = messages.length === 0 && !isCurrentChatStreaming;
  const PanelIcon = systemPanelOpen ? PanelRightClose : PanelRightOpen;

  const history = (
    <>
      {messages.map((msg, i) => {
        const isLastAssistant =
          i === messages.length - 1 && msg.role === 'assistant';
        return (
          <MessageBubble
            key={msg.id}
            message={msg}
            isLive={isLastAssistant && isCurrentChatStreaming}
          />
        );
      })}
      {isCurrentChatStreaming && streamState.content === '' && (
        <div className="flex justify-start mb-4">
          <StreamingDots phase={streamState.phase} />
        </div>
      )}
    </>
  );

  return (
    <div
      className={`relative flex flex-col h-full ${immersive ? 'jarvis-chat-surface is-immersive' : ''}`}
    >
      {!immersive && (
        <div className="flex items-center justify-end px-3 py-1.5 shrink-0">
          <button
            onClick={toggleSystemPanel}
            className="p-1.5 rounded-md transition-colors cursor-pointer"
            style={{ color: 'var(--color-text-tertiary)' }}
            title={`${systemPanelOpen ? 'Hide' : 'Show'} system panel`}
          >
            <PanelIcon size={16} />
          </button>
        </div>
      )}

      {hasConnectedSources === false && !bannerDismissed && !immersive && (
        <div
          className="mx-4 mb-2 flex items-center gap-3 px-4 py-3 rounded-lg text-sm shrink-0"
          style={{
            background: 'var(--color-accent-subtle)',
            border: '1px solid var(--color-border)',
          }}
        >
          <Database size={16} style={{ color: 'var(--color-accent)', flexShrink: 0 }} />
          <span style={{ color: 'var(--color-text-secondary)', flex: 1 }}>
            Connect your data sources to get personalized answers.
          </span>
          <button
            onClick={() => navigate('/data-sources')}
            className="px-3 py-1 rounded text-xs font-medium cursor-pointer"
            style={{
              background: 'var(--color-accent)',
              color: 'var(--color-on-accent)',
              border: 'none',
            }}
          >
            Connect
          </button>
          <button
            onClick={() => setBannerDismissed(true)}
            className="p-1 rounded cursor-pointer"
            style={{
              color: 'var(--color-text-tertiary)',
              background: 'transparent',
              border: 'none',
            }}
          >
            <X size={14} />
          </button>
        </div>
      )}

      <div
        ref={listRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto"
      >
        {immersive ? (
          <div className="flex items-center justify-center min-h-full px-5 py-6">
            <JarvisCore />
          </div>
        ) : isEmpty ? (
          <div className="flex items-center justify-center min-h-full px-5 py-8">
            <JarvisCore />
          </div>
        ) : (
          <>
            <div className="max-w-[var(--chat-max-width)] mx-auto px-4 pt-2">
              <JarvisCore compact />
            </div>
            <div className="max-w-[var(--chat-max-width)] mx-auto px-4 py-6">
              {history}
            </div>
          </>
        )}
      </div>

      {immersive && (
        <>
          <button
            type="button"
            className={`jarvis-history-launcher ${chatOpen ? 'is-active' : ''}`}
            onClick={() => setChatOpen((open) => !open)}
            title="Abrir histórico da conversa"
          >
            <MessageSquareText size={16} />
            <span>CONVERSA</span>
          </button>

          <aside
            className={`jarvis-history-drawer ${chatOpen ? 'is-open' : ''} ${chatExpanded ? 'is-expanded' : ''}`}
            aria-hidden={!chatOpen}
          >
            <div className="jarvis-history-drawer__head">
              <div>
                <span>J.A.R.V.I.S</span>
                <strong>Histórico da conversa</strong>
              </div>
              <div className="jarvis-history-drawer__actions">
                <button
                  type="button"
                  onClick={() => setChatExpanded((value) => !value)}
                  title={chatExpanded ? 'Reduzir' : 'Ampliar'}
                >
                  {chatExpanded ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
                </button>
                <button type="button" onClick={() => setChatOpen(false)} title="Fechar">
                  <X size={16} />
                </button>
              </div>
            </div>
            <div className="jarvis-history-drawer__body">{history}</div>
          </aside>
        </>
      )}

      <InputArea />
    </div>
  );
}
