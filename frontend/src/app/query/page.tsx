'use client';

import { useState, FormEvent, useRef, useEffect, useCallback } from 'react';
import { queryDocuments, QueryResult } from '@/lib/api';
import { useUpload } from '@/context/UploadContext';
import Link from 'next/link';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8001';

// 検索モードの定義
type SearchMode = 'fast' | 'standard' | 'accurate';

const SEARCH_MODES: { value: SearchMode; label: string; description: string }[] = [
  { value: 'fast', label: '高速', description: 'LLM 1回・3件検索' },
  { value: 'standard', label: '標準', description: 'LLM 2回・5件検索' },
  { value: 'accurate', label: '高精度', description: 'LLM 2回・7件検索' },
];

// 秒数を「N分N秒」形式にフォーマットする関数
function formatSearchTime(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined) return '';
  if (seconds < 60) {
    return `${seconds.toFixed(1)}秒`;
  }
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}分${remainingSeconds.toFixed(1)}秒`;
}

interface SourceCardProps {
  source: {
    document_name: string;
    chunk_text: string;
    similarity: number;
  };
  index: number;
}

function SourceCard({ source, index }: SourceCardProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  return (
    <div
      className="border rounded-lg overflow-hidden cursor-pointer hover:border-blue-300 transition-colors"
      onClick={() => setIsExpanded(!isExpanded)}
    >
      <div className="flex items-center gap-3 p-3 bg-gray-50">
        <div className="flex-shrink-0">
          <svg className="h-4 w-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-xs font-medium text-gray-900 truncate">
            {source.document_name || `Source ${index + 1}`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-500 bg-white px-2 py-0.5 rounded">
            {(source.similarity * 100).toFixed(0)}%
          </span>
          <svg
            className={`h-3 w-3 text-gray-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </div>
      {isExpanded && (
        <div className="p-3 bg-white border-t">
          <p className="text-xs text-gray-700 whitespace-pre-wrap leading-relaxed">
            {source.chunk_text || 'No content available'}
          </p>
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
  /** The original question text (for re-search) */
  questionText?: string;
}

export default function QueryPage() {
  const [question, setQuestion] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [searchMode, setSearchMode] = useState<SearchMode>('standard');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const { files, isUploading, completedCount, totalCount } = useUpload();
  const hasUploads = files.length > 0;

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  const handleStreamingQuery = async (questionText: string, messageId: string, mode: SearchMode, skipCache = false) => {
    abortControllerRef.current = new AbortController();

    try {
      const response = await fetch(`${API_BASE}/pipeline/chat/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: questionText, mode, skip_cache: skipCache }),
        signal: abortControllerRef.current.signal,
      });

      if (!response.ok) {
        throw new Error(`HTTP error: ${response.status}`);
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error('No response body');

      const decoder = new TextDecoder();
      let accumulatedText = '';
      let sources: QueryResult['sources'] = [];
      let metadata: Partial<QueryResult & { mode?: string }> = {};

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

  // モードに応じたバッジの色
  const getModeColor = (mode: string) => {
    switch (mode) {
      case 'fast': return 'bg-orange-100 text-orange-700';
      case 'accurate': return 'bg-purple-100 text-purple-700';
      default: return 'bg-gray-100 text-gray-600';
    }
  };

  const getModeLabel = (mode: string) => {
    switch (mode) {
      case 'fast': return '高速';
      case 'accurate': return '高精度';
      default: return '標準';
    }
  };

  return (
    <div className="max-w-3xl mx-auto flex flex-col h-full overflow-hidden">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-bold">Chat</h1>
        <div className="flex items-center gap-4">
          {messages.length > 0 && (
            <button
              onClick={clearChat}
              className="text-sm text-gray-500 hover:text-gray-700"
            >
              Clear chat
            </button>
          )}
        </div>
      </div>

      {/* Search Mode Selector */}
      <div className="mb-4 p-3 bg-gray-50 border rounded-lg">
        <div className="flex items-center gap-2 mb-2">
          <svg className="h-4 w-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" />
          </svg>
          <span className="text-sm font-medium text-gray-700">検索モード</span>
        </div>
        <div className="flex gap-2">
          {SEARCH_MODES.map((mode) => (
            <button
              key={mode.value}
              onClick={() => setSearchMode(mode.value)}
              disabled={isLoading}
              className={`flex-1 px-3 py-2 rounded-lg text-sm transition-all ${
                searchMode === mode.value
                  ? 'bg-blue-500 text-white shadow-sm'
                  : 'bg-white border hover:bg-gray-50 text-gray-700'
              } ${isLoading ? 'opacity-50 cursor-not-allowed' : ''}`}
            >
              <div className="font-medium">{mode.label}</div>
              <div className={`text-xs ${searchMode === mode.value ? 'text-blue-100' : 'text-gray-500'}`}>
                {mode.description}
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Upload Status Banner */}
      {hasUploads && isUploading && (
        <div className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded-lg">
          <div className="flex items-center gap-3">
            <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-500"></div>
            <div className="flex-1">
              <p className="text-blue-700 text-sm font-medium">
                Uploading files ({completedCount}/{totalCount})
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Upload Complete Banner */}
      {hasUploads && !isUploading && completedCount > 0 && (
        <div className="mb-4 p-3 bg-green-50 border border-green-200 rounded-lg">
          <div className="flex items-center justify-between">
            <p className="text-green-700 text-sm font-medium">
              {completedCount} file{completedCount > 1 ? 's' : ''} ready
            </p>
            <Link
              href="/"
              className="text-xs text-green-600 hover:text-green-800 underline"
            >
              Upload more
            </Link>
          </div>
        </div>
      )}

      {/* Chat Messages */}
      <div className="flex-1 min-h-0 overflow-y-auto mb-4 space-y-4">
        {messages.length === 0 && !isLoading && (
          <div className="text-center py-12 text-gray-500">
            <svg
              className="mx-auto h-12 w-12 text-gray-400 mb-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
              />
            </svg>
            <p>Start a conversation by asking a question</p>
          </div>
        )}

        {messages.map((message) => (
          <div
            key={message.id}
            className={`flex ${message.type === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            <div
              className={`max-w-[85%] ${
                message.type === 'user'
                  ? 'bg-blue-500 text-white rounded-2xl rounded-br-md px-4 py-3'
                  : 'bg-white border rounded-2xl rounded-bl-md px-4 py-3 shadow-sm'
              }`}
            >
              {message.type === 'user' ? (
                <p className="text-sm">{message.content}</p>
              ) : (
                <div className="space-y-3">
                  {/* Answer */}
                  <p className="text-sm text-gray-800 whitespace-pre-wrap">
                    {message.content}
                    {message.isStreaming && (
                      <span className="inline-block w-2 h-4 ml-1 bg-blue-500 animate-pulse" />
                    )}
                  </p>

                  {/* Confidence & Status */}
                  {message.result && !message.isStreaming && (
                    <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-gray-100">
                      <span className={`px-2 py-0.5 text-xs rounded ${message.result.has_answer ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}`}>
                        {message.result.has_answer ? 'Found' : 'Not Found'}
                      </span>
                      <span className="px-2 py-0.5 text-xs rounded bg-gray-100 text-gray-600">
                        {(message.result.confidence * 100).toFixed(0)}% confidence
                      </span>
                      {message.result.search_time_seconds != null && (
                        <span className="px-2 py-0.5 text-xs rounded bg-blue-100 text-blue-700">
                          {formatSearchTime(message.result.search_time_seconds)}
                        </span>
                      )}
                      {message.result.mode && (
                        <span className={`px-2 py-0.5 text-xs rounded ${getModeColor(message.result.mode)}`}>
                          {getModeLabel(message.result.mode)}
                        </span>
                      )}
                      {message.result.from_cache && (
                        <>
                          <span className="px-2 py-0.5 text-xs rounded bg-cyan-100 text-cyan-700">
                            キャッシュ
                          </span>
                          <button
                            onClick={() => message.questionText && handleResearch(message.questionText)}
                            disabled={isLoading}
                            className="px-2 py-0.5 text-xs rounded bg-indigo-100 text-indigo-700 hover:bg-indigo-200 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            再検索
                          </button>
                        </>
                      )}
                    </div>
                  )}

                  {/* Sources */}
                  {message.result?.sources && message.result.sources.length > 0 && (
                    <div className="pt-2 border-t border-gray-100">
                      <p className="text-xs text-gray-500 mb-2">Sources ({message.result.sources.length})</p>
                      <div className="space-y-2">
                        {message.result.sources.map((source, index) => (
                          <SourceCard key={index} source={source} index={index} />
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Error from API */}
                  {message.result?.error && (
                    <p className="text-xs text-amber-600 pt-2 border-t border-gray-100">
                      {message.result.error}
                    </p>
                  )}
                </div>
              )}
            </div>
          </div>
        ))}

        {/* Error */}
        {error && (
          <div className="p-3 bg-red-50 border border-red-200 rounded-lg">
            <p className="text-red-600 text-sm">{error}</p>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Question Form */}
      <form onSubmit={handleSubmit} className="border-t pt-4">
        <div className="flex gap-3">
          <input
            type="text"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="Ask a question..."
            className="flex-1 px-4 py-3 border rounded-full focus:outline-none focus:ring-2 focus:ring-blue-500"
            disabled={isLoading}
          />
          {isLoading ? (
            <button
              type="button"
              onClick={handleCancel}
              className="px-6 py-3 bg-red-500 text-white rounded-full hover:bg-red-600 transition-colors"
            >
              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          ) : (
            <button
              type="submit"
              disabled={!question.trim()}
              className="px-6 py-3 bg-blue-500 text-white rounded-full hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
              </svg>
            </button>
          )}
        </div>
      </form>
    </div>
  );
}
