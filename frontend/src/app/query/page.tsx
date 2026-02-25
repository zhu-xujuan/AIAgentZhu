'use client';

import { useState, FormEvent, useRef, useEffect, useCallback } from 'react';
import { QueryResult, API_BASE, saveQAConversation, fetchQADetail, fetchSlideDeckDetail } from '@/lib/api';
import { useUpload } from '@/context/UploadContext';
import Link from 'next/link';
import { cn } from '@/lib/utils';

// AI Elements components
import {
  Message,
  MessageContent,
  MessageResponse,
  MessageMetadata,
  MetadataBadge,
  StreamingIndicator,
} from '@/components/ai-elements/message';
import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
} from '@/components/ai-elements/conversation';
import {
  PromptInput,
  PromptInputTextarea,
  PromptInputFooter,
  PromptInputTools,
  PromptInputSubmit,
} from '@/components/ai-elements/prompt-input';
import { Source } from '@/components/ai-elements/sources';
import { Suggestions, Suggestion } from '@/components/ai-elements/suggestion';
import { SlideStudio, type SlideDeck } from '@/components/ai-elements/slide-studio';
import { VisualSlideViewer } from '@/components/ai-elements/visual-slide-viewer';
import { HtmlSlideViewer } from '@/components/ai-elements/html-slide-viewer';
import { HistoryPanel } from '@/components/ai-elements/history-panel';

import {
  MessageCircle,
  Zap,
  Gauge,
  Target,
  Upload,
  CheckCircle2,
  RefreshCw,
  FileText,
  Presentation,
  ChevronDown,
  Image,
  FileCode,
} from 'lucide-react';

// Search mode definitions
type SearchMode = 'fast' | 'standard' | 'accurate';

const SEARCH_MODES: { value: SearchMode; label: string; description: string; icon: typeof Zap }[] = [
  { value: 'fast', label: '高速', description: 'LLM 1回・3件', icon: Zap },
  { value: 'standard', label: '標準', description: 'LLM 2回・5件', icon: Gauge },
  { value: 'accurate', label: '高精度', description: 'LLM 2回・7件', icon: Target },
];

function formatSearchTime(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined) return '';
  if (seconds < 60) return `${seconds.toFixed(1)}秒`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}分${remainingSeconds.toFixed(1)}秒`;
}

// Suggestions for empty state
const SUGGESTIONS = [
  'アップロードしたドキュメントの内容を教えてください',
  '契約書の重要なポイントは何ですか？',
  '最新のレポートを要約してください',
];

// Collapsible Sources component for chat
function ChatSources({ sources }: { sources: QueryResult['sources'] }) {
  const [isOpen, setIsOpen] = useState(false);

  if (!sources || sources.length === 0) return null;

  return (
    <div className="pt-2 border-t border-border/50">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors py-1"
      >
        <FileText className="w-3.5 h-3.5" />
        <span>Sources ({sources.length})</span>
        <ChevronDown className={cn('w-3 h-3 transition-transform', isOpen && 'rotate-180')} />
      </button>
      {isOpen && (
        <div className="mt-2 space-y-1.5 animate-fade-in">
          {sources.map((source, index) => (
            <Source
              key={index}
              title={source.document_name || `Source ${index + 1}`}
              similarity={source.similarity}
              expandable
              expandedContent={source.chunk_text || 'No content available'}
            />
          ))}
        </div>
      )}
    </div>
  );
}

interface ChatMessage {
  id: string;
  type: 'user' | 'assistant';
  content: string;
  result?: QueryResult & { mode?: string; from_cache?: boolean };
  isStreaming?: boolean;
  timestamp: Date;
  questionText?: string;
}

function deckHasSubstantialContent(deck: SlideDeck | null | undefined) {
  if (!deck || !Array.isArray(deck.slides) || deck.slides.length === 0) return false;
  return deck.slides.some((s) => {
    const bullets = Array.isArray(s.bullets) ? s.bullets.filter((b) => (b || '').trim().length > 0) : [];
    const hasTable =
      !!s.table &&
      ((Array.isArray(s.table.headers) && s.table.headers.length > 0) ||
        (Array.isArray(s.table.rows) && s.table.rows.length > 0));
    const hasDiagram = !!(s.diagram_mermaid || '').trim();
    const hasImage = !!(s.image_url || '').trim() || !!(s.image_data_url || '').trim();
    const hasChart = !!s.chart && !!s.chart.type;
    return bullets.length > 0 || hasTable || hasDiagram || hasImage || hasChart;
  });
}

async function getErrorMessageFromResponse(response: Response, fallback: string) {
  const raw = await response.text();
  if (!raw) return fallback;
  try {
    const parsed = JSON.parse(raw) as { detail?: string; error?: string; message?: string };
    return parsed.detail || parsed.error || parsed.message || fallback;
  } catch {
    return raw;
  }
}

interface SlideLLMCapability {
  available: boolean;
  model: string | null;
  provider: string | null;
}

export default function QueryPage() {
  const [question, setQuestion] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [searchMode, setSearchMode] = useState<SearchMode>('standard');
  const abortControllerRef = useRef<AbortController | null>(null);

  const [activeSlideMessageId, setActiveSlideMessageId] = useState<string | null>(null);
  const [slideDecks, setSlideDecks] = useState<
    Record<string, { question: string; mode: SearchMode; deck: SlideDeck }>
  >({});
  const [slideBusyMessageId, setSlideBusyMessageId] = useState<string | null>(null);
  const [slideError, setSlideError] = useState<string | null>(null);
  const [slideErrorMessageId, setSlideErrorMessageId] = useState<string | null>(null);

  // Visual slide viewer state
  const [visualSlideMessageId, setVisualSlideMessageId] = useState<string | null>(null);

  // HTML slide viewer state
  const [htmlSlideMessageId, setHtmlSlideMessageId] = useState<string | null>(null);

  // History panel
  const [historyRefresh, setHistoryRefresh] = useState(0);
  const [loadedDeckId, setLoadedDeckId] = useState<number | null>(null);
  const [savedSlidesForViewer, setSavedSlidesForViewer] = useState<{
    slides: { index: number; title: string; html: string; type: string }[];
    planMd?: string;
    styleOptions?: Record<string, string>;
    question: string;
    answer?: string;
    deckId: number;
  } | null>(null);

  // Slide LLM capability (fetched from /health)
  const [slideLLMCapability, setSlideLLMCapability] = useState<SlideLLMCapability>({
    available: false,
    model: null,
    provider: null,
  });

  // Fetch slide LLM capability on mount
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`${API_BASE}/health`);
        if (res.ok) {
          const data = await res.json();
          if (data.slide_llm) {
            setSlideLLMCapability(data.slide_llm);
          }
        }
      } catch {
        // Ignore - will use default (low) capability
      }
    })();
  }, []);

  const { files, isUploading, completedCount, totalCount } = useUpload();
  const hasUploads = files.length > 0;

  const withSlideIds = useCallback((deck: SlideDeck, prefix: string): SlideDeck => {
    return {
      ...deck,
      slides: (deck.slides || []).map((s, idx) => ({
        ...s,
        id: s.id || `${prefix}-${idx}`,
      })),
    };
  }, []);

  const openSlideStudio = useCallback((messageId: string) => {
    setSlideError(null);
    setSlideErrorMessageId(null);
    setActiveSlideMessageId(messageId);
  }, []);

  const closeSlideStudio = useCallback(() => {
    setActiveSlideMessageId(null);
    setSlideError(null);
    setSlideErrorMessageId(null);
  }, []);

  const handleStreamingQuery = async (questionText: string, messageId: string, mode: SearchMode, skipCache = false) => {
    abortControllerRef.current = new AbortController();

    try {
      const response = await fetch(`${API_BASE}/pipeline/chat/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: questionText, mode, skip_cache: skipCache }),
        signal: abortControllerRef.current.signal,
      });

      if (!response.ok) throw new Error(`HTTP error: ${response.status}`);

      const reader = response.body?.getReader();
      if (!reader) throw new Error('No response body');

      const decoder = new TextDecoder();
      let accumulatedText = '';
      let sources: QueryResult['sources'] = [];
      let metadata: Partial<QueryResult & { mode?: string; from_cache?: boolean }> = {};

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split('\n');

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6));

              if (data.type === 'text' && data.text) {
                accumulatedText += data.text;
                setMessages(prev => prev.map(msg =>
                  msg.id === messageId
                    ? { ...msg, content: accumulatedText, isStreaming: true }
                    : msg
                ));
              } else if (data.type === 'sources') {
                sources = data.sources;
                setMessages(prev => prev.map(msg =>
                  msg.id === messageId
                    ? { ...msg, result: { ...msg.result, sources } as QueryResult }
                    : msg
                ));
              } else if (data.type === 'done') {
                metadata = {
                  confidence: data.confidence,
                  has_answer: data.has_answer,
                  search_time_seconds: data.search_time,
                  mode: data.mode,
                  from_cache: data.from_cache,
                };
                setMessages(prev => prev.map(msg =>
                  msg.id === messageId
                    ? {
                        ...msg,
                        content: accumulatedText,
                        isStreaming: false,
                        questionText: questionText,
                        result: {
                          question: questionText,
                          answer: accumulatedText,
                          sources,
                          confidence: metadata.confidence || 0,
                          has_answer: metadata.has_answer || false,
                          search_mode: 'hybrid',
                          error: null,
                          search_time_seconds: metadata.search_time_seconds || null,
                          mode: metadata.mode,
                          from_cache: metadata.from_cache,
                        },
                      }
                    : msg
                ));

                // Auto-save Q&A to history
                saveQAConversation({
                  question: questionText,
                  answer: accumulatedText,
                  sources,
                  confidence: metadata.confidence || 0,
                  has_answer: metadata.has_answer || false,
                  search_time: metadata.search_time_seconds || undefined,
                  mode: metadata.mode,
                  from_cache: metadata.from_cache || false,
                }).then(() => {
                  setHistoryRefresh((prev) => prev + 1);
                }).catch(() => {
                  // Non-critical: ignore save errors
                });
              } else if (data.type === 'error') {
                throw new Error(data.error);
              }
            } catch {
              // Ignore JSON parse errors for incomplete chunks
            }
          }
        }
      }
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        setMessages(prev => prev.map(msg =>
          msg.id === messageId
            ? { ...msg, isStreaming: false, content: msg.content + '\n\n(中断されました)' }
            : msg
        ));
      } else {
        throw err;
      }
    }
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!question.trim()) return;

    const userMessage: ChatMessage = {
      id: `user-${Date.now()}`,
      type: 'user',
      content: question,
      timestamp: new Date(),
    };

    const assistantMessageId = `assistant-${Date.now()}`;
    const assistantMessage: ChatMessage = {
      id: assistantMessageId,
      type: 'assistant',
      content: '',
      isStreaming: true,
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev, userMessage, assistantMessage]);
    const currentQuestion = question;
    setQuestion('');
    setIsLoading(true);
    setError(null);

    try {
      await handleStreamingQuery(currentQuestion, assistantMessageId, searchMode);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Query failed');
      setMessages((prev) => prev.filter(msg => msg.id !== assistantMessageId));
    } finally {
      setIsLoading(false);
      abortControllerRef.current = null;
    }
  };

  const handleCancel = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      setIsLoading(false);
    }
  };

  const clearChat = () => {
    setMessages([]);
    setError(null);
  };

  const handleResearch = async (originalQuestion: string) => {
    const assistantMessageId = `assistant-${Date.now()}`;
    const assistantMessage: ChatMessage = {
      id: assistantMessageId,
      type: 'assistant',
      content: '',
      isStreaming: true,
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev, assistantMessage]);
    setIsLoading(true);
    setError(null);

    try {
      await handleStreamingQuery(originalQuestion, assistantMessageId, searchMode, true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Query failed');
      setMessages((prev) => prev.filter(msg => msg.id !== assistantMessageId));
    } finally {
      setIsLoading(false);
      abortControllerRef.current = null;
    }
  };

  // Dynamic max_slides based on LLM capability
  // This is a ceiling — the LLM decides the actual count based on content
  const slideMaxSlides = slideLLMCapability.available ? 12 : 8;

  const handleGenerateSlides = useCallback(async (message: ChatMessage) => {
    const questionText = message.questionText || message.result?.question;
    if (!questionText) return;

    const existing = slideDecks[message.id];
    if (existing && existing.deck.slides.length >= 3 && deckHasSubstantialContent(existing.deck)) {
      openSlideStudio(message.id);
      return;
    }

    setSlideBusyMessageId(message.id);
    setSlideError(null);
    setSlideErrorMessageId(null);

    try {
      const response = await fetch(`${API_BASE}/pipeline/slides/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question: questionText,
          answer: message.content,
          mode: (message.result?.mode as SearchMode | undefined) || searchMode,
          max_slides: slideMaxSlides,
        }),
      });

      if (!response.ok) {
        const detail = await getErrorMessageFromResponse(response, `HTTP error: ${response.status}`);
        throw new Error(detail);
      }
      const data = await response.json();

      const deck = withSlideIds(data.deck as SlideDeck, `deck-${message.id}`);
      const mode = (data.mode as SearchMode | undefined) || searchMode;

      setSlideDecks((prev) => ({
        ...prev,
        [message.id]: { question: data.question || questionText, mode, deck },
      }));

      openSlideStudio(message.id);
    } catch (err) {
      setSlideError(err instanceof Error ? err.message : 'Slide generation failed');
      setSlideErrorMessageId(message.id);
    } finally {
      setSlideBusyMessageId(null);
    }
  }, [openSlideStudio, searchMode, slideDecks, slideMaxSlides, withSlideIds]);

  const handleRefineSlides = useCallback(async (instruction: string) => {
    if (!activeSlideMessageId) return;
    const current = slideDecks[activeSlideMessageId];
    if (!current) return;

    setSlideBusyMessageId(activeSlideMessageId);
    setSlideError(null);
    setSlideErrorMessageId(null);

    try {
      const response = await fetch(`${API_BASE}/pipeline/slides/refine`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question: current.question,
          instruction,
          deck: current.deck,
          mode: current.mode,
          max_slides: slideMaxSlides,
        }),
      });

      if (!response.ok) {
        const detail = await getErrorMessageFromResponse(response, `HTTP error: ${response.status}`);
        throw new Error(detail);
      }
      const data = await response.json();
      const deck = withSlideIds(data.deck as SlideDeck, `deck-${activeSlideMessageId}`);

      setSlideDecks((prev) => ({
        ...prev,
        [activeSlideMessageId]: { ...prev[activeSlideMessageId], deck },
      }));
    } catch (err) {
      setSlideError(err instanceof Error ? err.message : 'Slide refine failed');
      setSlideErrorMessageId(activeSlideMessageId);
    } finally {
      setSlideBusyMessageId(null);
    }
  }, [activeSlideMessageId, slideDecks, slideMaxSlides, withSlideIds]);

  const handleSuggestionClick = (suggestion: string) => {
    setQuestion(suggestion);
  };

  const getModeLabel = (mode: string) => {
    switch (mode) {
      case 'fast': return '高速';
      case 'accurate': return '高精度';
      default: return '標準';
    }
  };

  const getModeVariant = (mode: string): 'default' | 'warning' | 'accent' => {
    switch (mode) {
      case 'fast': return 'warning';
      case 'accurate': return 'accent';
      default: return 'default';
    }
  };

  const activeSlideState = activeSlideMessageId ? slideDecks[activeSlideMessageId] : null;

  // History panel: Q&A click → load conversation into messages
  const handleHistoryQASelect = useCallback(async (id: number) => {
    try {
      const detail = await fetchQADetail(id);
      if (!detail) return;

      const userMsg: ChatMessage = {
        id: `history-user-${id}`,
        type: 'user',
        content: detail.question,
        timestamp: new Date(detail.created_at),
      };
      const assistantMsg: ChatMessage = {
        id: `history-assistant-${id}`,
        type: 'assistant',
        content: detail.answer,
        isStreaming: false,
        timestamp: new Date(detail.created_at),
        questionText: detail.question,
        result: {
          question: detail.question,
          answer: detail.answer,
          sources: detail.sources || [],
          confidence: detail.confidence || 0,
          has_answer: detail.has_answer ?? true,
          search_mode: 'hybrid',
          error: null,
          search_time_seconds: detail.search_time || null,
          mode: detail.mode,
          from_cache: detail.from_cache,
        },
      };

      setMessages([userMsg, assistantMsg]);
      setError(null);
    } catch {
      // Ignore
    }
  }, []);

  // History panel: Slide click → load deck into viewer
  const handleHistorySlideSelect = useCallback(async (id: number) => {
    try {
      const detail = await fetchSlideDeckDetail(id);
      if (!detail || !detail.slides.length) return;

      setLoadedDeckId(id);
      setSavedSlidesForViewer({
        slides: detail.slides.map((s) => ({
          index: s.slide_index,
          title: s.title,
          html: s.html,
          type: s.slide_type,
        })),
        planMd: detail.plan_md || undefined,
        styleOptions: detail.style_options || undefined,
        question: detail.question || '',
        answer: detail.answer || undefined,
        deckId: id,
      });
    } catch {
      // Ignore
    }
  }, []);

  return (
    <div className="flex w-full h-full overflow-hidden">
      {/* History sidebar (hidden on mobile) */}
      <div className="hidden md:block">
        <HistoryPanel
          onSelectQA={handleHistoryQASelect}
          onSelectSlide={handleHistorySlideSelect}
          refreshTrigger={historyRefresh}
        />
      </div>

    <div className="flex-1 max-w-3xl mx-auto flex flex-col h-full overflow-hidden px-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-3 flex-shrink-0">
        <h1 className="text-lg font-semibold text-foreground">Chat</h1>
        {messages.length > 0 && (
          <button
            onClick={clearChat}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            Clear
          </button>
        )}
      </div>

      {/* Upload Banners */}
      {hasUploads && isUploading && (
        <div className="mb-3 p-2.5 bg-primary/5 border border-primary/20 rounded-xl flex-shrink-0 animate-fade-in">
          <div className="flex items-center gap-2.5">
            <Upload className="w-4 h-4 text-primary animate-pulse" />
            <p className="text-primary text-sm font-medium">
              Uploading files ({completedCount}/{totalCount})
            </p>
          </div>
        </div>
      )}
      {hasUploads && !isUploading && completedCount > 0 && (
        <div className="mb-3 p-2.5 bg-emerald-50 border border-emerald-200 rounded-xl flex-shrink-0 animate-fade-in">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-600" />
              <p className="text-emerald-700 text-sm font-medium">
                {completedCount} file{completedCount > 1 ? 's' : ''} ready
              </p>
            </div>
            <Link href="/" className="text-xs text-emerald-600 hover:text-emerald-800 transition-colors">
              Upload more
            </Link>
          </div>
        </div>
      )}

      {/* Conversation Area */}
      <Conversation className="flex-1 min-h-0">
        <ConversationContent>
          {messages.length === 0 && !isLoading ? (
            <ConversationEmptyState
              icon={<MessageCircle className="w-12 h-12" />}
              title="ドキュメントに質問する"
              description="アップロードしたドキュメントについて何でも聞いてください"
            >
              <Suggestions className="mt-4">
                {SUGGESTIONS.map((s) => (
                  <Suggestion key={s} suggestion={s} onSelect={handleSuggestionClick} />
                ))}
              </Suggestions>
            </ConversationEmptyState>
          ) : (
            <>
              {messages.map((message) => (
                <Message key={message.id} from={message.type === 'user' ? 'user' : 'assistant'}>
                  <MessageContent>
                    {message.type === 'user' ? (
                      <MessageResponse>{message.content}</MessageResponse>
                    ) : (
                      <div className="space-y-2.5">
                        {/* Answer text */}
                        <MessageResponse>
                          {message.content}
                          {message.isStreaming && <StreamingIndicator />}
                        </MessageResponse>

                        {/* Metadata badges */}
                        {message.result && !message.isStreaming && (
                          <MessageMetadata>
                            <MetadataBadge variant={message.result.has_answer ? 'success' : 'warning'}>
                              {message.result.has_answer ? 'Found' : 'Not Found'}
                            </MetadataBadge>
                            <MetadataBadge>
                              {(message.result.confidence * 100).toFixed(0)}%
                            </MetadataBadge>
                            {message.result.search_time_seconds != null && (
                              <MetadataBadge variant="info">
                                {formatSearchTime(message.result.search_time_seconds)}
                              </MetadataBadge>
                            )}
                            {message.result.mode && (
                              <MetadataBadge variant={getModeVariant(message.result.mode)}>
                                {getModeLabel(message.result.mode)}
                              </MetadataBadge>
                            )}
                            <button
                              onClick={() => handleGenerateSlides(message)}
                              disabled={isLoading || slideBusyMessageId === message.id}
                              className="inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-medium rounded-full border border-primary/20 bg-primary/5 text-primary hover:bg-primary/10 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                              title={slideLLMCapability.available
                                ? `高品質スライド生成 (${slideLLMCapability.model || 'LLM'}, 最大${slideMaxSlides}枚)`
                                : '回答からスライド資料を作成 (最大8枚)'}
                            >
                              {slideBusyMessageId === message.id ? (
                                <RefreshCw className="w-3 h-3 animate-spin" />
                              ) : (
                                <Presentation className="w-3 h-3" />
                              )}
                              スライド{slideLLMCapability.available ? '+' : ''}
                            </button>
                            <button
                              onClick={() => setVisualSlideMessageId(message.id)}
                              disabled={isLoading}
                              className="inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-medium rounded-full border border-amber-300/50 bg-amber-50 text-amber-700 hover:bg-amber-100 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                              title="AIで高品質ビジュアルスライドを生成"
                            >
                              <Image className="w-3 h-3" />
                              ビジュアル
                            </button>
                            <button
                              onClick={() => setHtmlSlideMessageId(message.id)}
                              disabled={isLoading}
                              className="inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-medium rounded-full border border-teal-300/50 bg-teal-50 text-teal-700 hover:bg-teal-100 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                              title="2ステップLLMでHTMLスライドを生成"
                            >
                              <FileCode className="w-3 h-3" />
                              HTMLスライド
                            </button>
                            {slideError && slideErrorMessageId === message.id && (
                              <span className="text-[11px] text-destructive">{slideError}</span>
                            )}
                            {message.result.from_cache && (
                              <>
                                <MetadataBadge variant="info">
                                  キャッシュ
                                </MetadataBadge>
                                <button
                                  onClick={() => message.questionText && handleResearch(message.questionText)}
                                  disabled={isLoading}
                                  className="inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-medium rounded-full border border-primary/20 bg-primary/5 text-primary hover:bg-primary/10 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                  <RefreshCw className="w-3 h-3" />
                                  再検索
                                </button>
                              </>
                            )}
                          </MessageMetadata>
                        )}

                        {/* Sources */}
                        {message.result?.sources && message.result.sources.length > 0 && (
                          <ChatSources sources={message.result.sources} />
                        )}

                        {/* API Error */}
                        {message.result?.error && (
                          <p className="text-xs text-amber-600 pt-2 border-t border-border/50">
                            {message.result.error}
                          </p>
                        )}
                      </div>
                    )}
                  </MessageContent>
                </Message>
              ))}

              {/* Error */}
              {error && (
                <div className="p-3 bg-destructive/5 border border-destructive/20 rounded-xl animate-fade-in">
                  <p className="text-destructive text-sm">{error}</p>
                </div>
              )}
            </>
          )}
        </ConversationContent>
      </Conversation>

      {/* Input Area */}
      <div className="flex-shrink-0 pt-3">
        <PromptInput onSubmit={handleSubmit}>
          <PromptInputTextarea
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="質問を入力してください..."
            disabled={isLoading}
          />
          <PromptInputFooter>
            <PromptInputTools>
              {/* Search Mode Selector */}
              <div className="flex items-center gap-0.5 bg-secondary/50 rounded-lg p-0.5">
                {SEARCH_MODES.map((mode) => {
                  const Icon = mode.icon;
                  return (
                    <button
                      key={mode.value}
                      type="button"
                      onClick={() => setSearchMode(mode.value)}
                      disabled={isLoading}
                      className={cn(
                        'flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-medium transition-all',
                        searchMode === mode.value
                          ? 'bg-card text-foreground shadow-sm'
                          : 'text-muted-foreground hover:text-foreground',
                        isLoading && 'opacity-50 cursor-not-allowed'
                      )}
                      title={mode.description}
                    >
                      <Icon className="w-3 h-3" />
                      {mode.label}
                    </button>
                  );
                })}
              </div>
            </PromptInputTools>
            <PromptInputSubmit
              status={isLoading ? 'streaming' : 'ready'}
              disabled={!question.trim()}
              onClick={isLoading ? handleCancel : undefined}
            />
          </PromptInputFooter>
        </PromptInput>
      </div>

      {activeSlideState && (
        <SlideStudio
          open={true}
          deck={activeSlideState.deck}
          busy={slideBusyMessageId === activeSlideMessageId}
          error={activeSlideMessageId === slideErrorMessageId ? slideError : null}
          onClose={closeSlideStudio}
          onDeckChange={(next) => {
            if (!activeSlideMessageId) return;
            setSlideDecks((prev) => ({
              ...prev,
              [activeSlideMessageId]: prev[activeSlideMessageId]
                ? { ...prev[activeSlideMessageId], deck: next }
                : { question: activeSlideState.question, mode: activeSlideState.mode, deck: next },
            }));
          }}
          onRequestRefine={(instruction) => handleRefineSlides(instruction)}
        />
      )}

      {visualSlideMessageId && (() => {
        const msg = messages.find((m) => m.id === visualSlideMessageId);
        return (
          <VisualSlideViewer
            open={true}
            question={msg?.questionText || msg?.result?.question || ''}
            answer={msg?.content}
            mode={(msg?.result?.mode as string | undefined) || searchMode}
            onClose={() => setVisualSlideMessageId(null)}
          />
        );
      })()}

      {htmlSlideMessageId && (() => {
        const msg = messages.find((m) => m.id === htmlSlideMessageId);
        return (
          <HtmlSlideViewer
            open={true}
            question={msg?.questionText || msg?.result?.question || ''}
            answer={msg?.content}
            onClose={() => setHtmlSlideMessageId(null)}
            onSaveComplete={(deckId) => {
              setHistoryRefresh((prev) => prev + 1);
              setLoadedDeckId(deckId);
            }}
          />
        );
      })()}

      {/* Saved slides from history */}
      {savedSlidesForViewer && (
        <HtmlSlideViewer
          open={true}
          question={savedSlidesForViewer.question}
          answer={savedSlidesForViewer.answer}
          deckId={savedSlidesForViewer.deckId}
          savedSlides={savedSlidesForViewer.slides}
          savedPlanMd={savedSlidesForViewer.planMd}
          savedStyleOptions={savedSlidesForViewer.styleOptions}
          onClose={() => {
            setSavedSlidesForViewer(null);
            setLoadedDeckId(null);
          }}
          onSaveComplete={(deckId) => {
            setHistoryRefresh((prev) => prev + 1);
            setLoadedDeckId(deckId);
          }}
        />
      )}
    </div>
    </div>
  );
}
