'use client';

import { useEffect, useState } from 'react';
import { getDocumentDetail, DocumentDetail } from '@/lib/api';

interface DocumentDetailModalProps {
  documentId: number | null;
  onClose: () => void;
}

function getDocTypeBadge(docType: string | null) {
  if (!docType) return null;

  const colors: Record<string, string> = {
    contract: 'bg-purple-100 text-purple-700',
    invoice: 'bg-green-100 text-green-700',
    report: 'bg-blue-100 text-blue-700',
    manual: 'bg-yellow-100 text-yellow-700',
    meeting_minutes: 'bg-orange-100 text-orange-700',
    minutes: 'bg-orange-100 text-orange-700',
    other: 'bg-gray-100 text-gray-700',
    unknown: 'bg-gray-100 text-gray-700',
  };

  const color = colors[docType] || colors.other;

  return (
    <span className={`px-2 py-1 text-xs rounded-full ${color}`}>
      {docType}
    </span>
  );
}

export default function DocumentDetailModal({ documentId, onClose }: DocumentDetailModalProps) {
  const [document, setDocument] = useState<DocumentDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (documentId === null) return;

    const fetchDocument = async () => {
      try {
        setLoading(true);
        setError(null);
        const result = await getDocumentDetail(documentId);
        setDocument(result);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load document');
      } finally {
        setLoading(false);
      }
    };

    fetchDocument();
  }, [documentId]);

  if (documentId === null) return null;

  // 背景クリックで閉じる
  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  return (
    <div
      className="fixed inset-0 bg-black/40 flex items-center justify-center z-50"
      onClick={handleBackdropClick}
    >
      <div className="bg-white rounded-xl shadow-2xl w-[600px] h-[500px] flex flex-col m-4">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h2 className="text-base font-semibold text-gray-900 truncate pr-4">
            {loading ? 'Loading...' : document?.file_name || 'Document Detail'}
          </h2>
          <button
            onClick={onClose}
            className="p-1.5 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <svg className="h-5 w-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-5">
          {loading && (
            <div className="flex items-center justify-center py-16">
              <div className="animate-spin rounded-full h-6 w-6 border-2 border-blue-500 border-t-transparent"></div>
            </div>
          )}

          {error && (
            <div className="p-4 bg-red-50 border border-red-100 rounded-lg">
              <p className="text-red-600 text-sm">{error}</p>
            </div>
          )}

          {!loading && !error && document && (
            <div className="space-y-5">
              {/* Metadata */}
              <div className="flex flex-wrap items-center gap-3 text-sm">
                {getDocTypeBadge(document.doc_type)}
                {document.language && (
                  <span className="text-gray-500">{document.language}</span>
                )}
                {document.confidence !== null && (
                  <span className="text-gray-500">
                    確度 {(document.confidence * 100).toFixed(0)}%
                  </span>
                )}
                <span className="text-gray-400">
                  {document.total_chunks} chunks
                </span>
              </div>

              {/* Content */}
              <div>
                <h3 className="text-sm font-medium text-gray-600 mb-3">Content</h3>
                {document.chunks.length === 0 ? (
                  <div className="text-gray-400 text-center py-8 text-sm">
                    No content available
                  </div>
                ) : (
                  <div className="bg-gray-50 rounded-lg p-4 max-h-[400px] overflow-y-auto">
                    <div className="space-y-4">
                      {document.chunks.map((chunk, idx) => (
                        <div key={idx}>
                          {idx > 0 && <hr className="border-gray-200 my-4" />}
                          <div className="text-xs text-gray-400 mb-2">
                            Chunk {chunk.index + 1}
                            {chunk.page && ` / Page ${chunk.page}`}
                          </div>
                          <p className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">
                            {chunk.text}
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
