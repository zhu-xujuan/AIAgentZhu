'use client';

import { useState, FormEvent, useRef, useEffect } from 'react';
import { queryDocuments, QueryResult } from '@/lib/api';
import { useUpload } from '@/context/UploadContext';
import Link from 'next/link';

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
  result?: QueryResult;
  timestamp: Date;
}

export default function QueryPage() {
  const [question, setQuestion] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [error, setError] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const { files, isUploading, completedCount, totalCount } = useUpload();
  const hasUploads = files.length > 0;

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!question.trim()) return;

    const userMessage: ChatMessage = {
      id: `user-${Date.now()}`,
      type: 'user',
      content: question,
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setQuestion('');
    setIsLoading(true);
    setError(null);

    try {
      const res = await queryDocuments(question);
      const assistantMessage: ChatMessage = {
        id: `assistant-${Date.now()}`,
        type: 'assistant',
        content: res.answer,
        result: res,
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, assistantMessage]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Query failed');
    } finally {
      setIsLoading(false);
    }
  };

  const clearChat = () => {
    setMessages([]);
    setError(null);
  };

  return (
    <div className="max-w-3xl mx-auto flex flex-col h-full overflow-hidden">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-bold">Chat</h1>
        {messages.length > 0 && (
          <button
            onClick={clearChat}
            className="text-sm text-gray-500 hover:text-gray-700"
          >
            Clear chat
          </button>
        )}
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
                  <p className="text-sm text-gray-800 whitespace-pre-wrap">{message.content}</p>

                  {/* Confidence & Status */}
                  {message.result && (
                    <div className="flex gap-2 pt-2 border-t border-gray-100">
                      <span className={`px-2 py-0.5 text-xs rounded ${message.result.has_answer ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}`}>
                        {message.result.has_answer ? 'Found' : 'Not Found'}
                      </span>
                      <span className="px-2 py-0.5 text-xs rounded bg-gray-100 text-gray-600">
                        {(message.result.confidence * 100).toFixed(0)}% confidence
                      </span>
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

        {/* Loading indicator */}
        {isLoading && (
          <div className="flex justify-start">
            <div className="bg-white border rounded-2xl rounded-bl-md px-4 py-3 shadow-sm">
              <div className="flex items-center gap-2">
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-500"></div>
                <span className="text-sm text-gray-500">Searching...</span>
              </div>
            </div>
          </div>
        )}

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
          <button
            type="submit"
            disabled={isLoading || !question.trim()}
            className="px-6 py-3 bg-blue-500 text-white rounded-full hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {isLoading ? (
              <span className="animate-spin rounded-full h-5 w-5 border-b-2 border-white inline-block"></span>
            ) : (
              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
              </svg>
            )}
          </button>
        </div>
      </form>
    </div>
  );
}
