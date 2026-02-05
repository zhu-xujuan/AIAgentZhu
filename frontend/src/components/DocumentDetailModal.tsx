'use client';

import { useEffect, useState } from 'react';
import { getDocumentDetail, DocumentDetail } from '@/lib/api';
import { cn } from '@/lib/utils';
import { X, Loader2, AlertCircle } from 'lucide-react';

const docTypeStyles: Record<string, string> = {
  contract: 'bg-violet-50 text-violet-700 border-violet-200',
  invoice: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  report: 'bg-sky-50 text-sky-700 border-sky-200',
  manual: 'bg-amber-50 text-amber-700 border-amber-200',
  meeting_minutes: 'bg-orange-50 text-orange-700 border-orange-200',
  minutes: 'bg-orange-50 text-orange-700 border-orange-200',
};

function getDocTypeBadge(docType: string | null) {
  if (!docType) return null;
  const style = docTypeStyles[docType] || 'bg-secondary text-secondary-foreground border-border';
  return (
    <span className={cn('px-2 py-0.5 text-[11px] font-medium rounded-full border', style)}>
      {docType}
    </span>
  );
}

interface DocumentDetailModalProps {
  documentId: number | null;
  onClose: () => void;
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

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) onClose();
  };

  return (
    <div
      className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 animate-fade-in"
      onClick={handleBackdropClick}
    >
      <div className="bg-card rounded-2xl shadow-2xl w-[600px] h-[500px] flex flex-col m-4 border border-border">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <h2 className="text-sm font-semibold text-foreground truncate pr-4">
            {loading ? 'Loading...' : document?.file_name || 'Document Detail'}
          </h2>
          <button
            onClick={onClose}
            className="p-1.5 hover:bg-accent rounded-lg transition-colors"
          >
            <X className="w-4 h-4 text-muted-foreground" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-5 scrollbar-thin">
          {loading && (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="w-5 h-5 text-primary animate-spin" />
            </div>
          )}

          {error && (
            <div className="p-4 bg-destructive/5 border border-destructive/20 rounded-xl">
              <div className="flex items-center gap-2">
                <AlertCircle className="w-4 h-4 text-destructive" />
                <p className="text-destructive text-sm">{error}</p>
              </div>
            </div>
          )}

          {!loading && !error && document && (
            <div className="space-y-5">
              {/* Metadata */}
              <div className="flex flex-wrap items-center gap-2.5">
                {getDocTypeBadge(document.doc_type)}
                {document.language && (
                  <span className="text-xs text-muted-foreground">{document.language}</span>
                )}
                {document.confidence !== null && (
                  <span className="text-xs text-muted-foreground">
                    確度 {(document.confidence * 100).toFixed(0)}%
                  </span>
                )}
                <span className="text-xs text-muted-foreground">
                  {document.total_chunks} chunks
                </span>
              </div>

              {/* Content */}
              <div>
                <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">
                  Content
                </h3>
                {document.chunks.length === 0 ? (
                  <div className="text-muted-foreground text-center py-8 text-sm">
                    No content available
                  </div>
                ) : (
                  <div className="bg-secondary/50 rounded-xl p-4 max-h-[350px] overflow-y-auto scrollbar-thin">
                    <div className="space-y-4">
                      {document.chunks.map((chunk, idx) => (
                        <div key={idx}>
                          {idx > 0 && <hr className="border-border my-4" />}
                          <div className="text-[10px] text-muted-foreground mb-2 uppercase tracking-wider">
                            Chunk {chunk.index + 1}
                            {chunk.page && ` / Page ${chunk.page}`}
                          </div>
                          <p className="text-sm text-foreground/80 whitespace-pre-wrap leading-relaxed">
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
