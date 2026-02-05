'use client';

import { useEffect, useState } from 'react';
import { listDocuments, DocumentInfo, deleteDocument, deleteFile } from '@/lib/api';
import DocumentDetailModal from './DocumentDetailModal';
import { cn } from '@/lib/utils';
import {
  FileText,
  FileSpreadsheet,
  FileCode,
  FileType,
  File,
  Loader2,
  FolderOpen,
  Trash2,
  AlertCircle,
  RefreshCw,
} from 'lucide-react';

function getFileIcon(fileName: string, fileType: string | null) {
  const ext = fileName.split('.').pop()?.toLowerCase() || '';
  const mimeType = fileType?.toLowerCase() || '';

  if (ext === 'pdf' || mimeType.includes('pdf'))
    return <FileText className="w-7 h-7 text-red-500" />;
  if (ext === 'csv' || mimeType.includes('csv') || ext === 'xls' || ext === 'xlsx')
    return <FileSpreadsheet className="w-7 h-7 text-emerald-500" />;
  if (ext === 'json' || mimeType.includes('json'))
    return <FileCode className="w-7 h-7 text-amber-500" />;
  if (ext === 'md' || ext === 'markdown')
    return <FileType className="w-7 h-7 text-primary" />;
  if (ext === 'txt' || mimeType.includes('text'))
    return <FileText className="w-7 h-7 text-muted-foreground" />;

  return <File className="w-7 h-7 text-muted-foreground" />;
}

const docTypeStyles: Record<string, string> = {
  contract: 'bg-violet-50 text-violet-700 border-violet-200',
  invoice: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  report: 'bg-sky-50 text-sky-700 border-sky-200',
  manual: 'bg-amber-50 text-amber-700 border-amber-200',
  meeting_minutes: 'bg-orange-50 text-orange-700 border-orange-200',
};

function getDocTypeBadge(docType: string | null) {
  if (!docType) return null;
  const style = docTypeStyles[docType] || 'bg-secondary text-secondary-foreground border-border';
  return (
    <span className={cn('px-2 py-0.5 text-[10px] font-medium rounded-full border', style)}>
      {docType}
    </span>
  );
}

interface FileListProps {
  refreshTrigger?: number;
}

export default function FileList({ refreshTrigger }: FileListProps) {
  const [documents, setDocuments] = useState<DocumentInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedDocumentId, setSelectedDocumentId] = useState<number | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [databaseAvailable, setDatabaseAvailable] = useState(true);

  const fetchDocuments = async () => {
    try {
      setLoading(true);
      setError(null);
      const result = await listDocuments();
      setDocuments(result.documents);
      setDatabaseAvailable(result.database_available !== false);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to load documents';
      setError(errorMessage);
      setDocuments([]);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (e: React.MouseEvent, documentId: number, fileId: string) => {
    e.stopPropagation();
    if (!confirm('このドキュメントを削除してもよろしいですか？')) return;

    try {
      setDeletingId(documentId);
      if (!databaseAvailable) {
        await deleteFile(fileId);
      } else {
        await deleteDocument(documentId);
      }
      setDocuments(docs => docs.filter(doc => doc.id !== documentId));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete document');
    } finally {
      setDeletingId(null);
    }
  };

  useEffect(() => {
    fetchDocuments();
  }, [refreshTrigger]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-5 h-5 text-primary animate-spin" />
        <span className="ml-2 text-sm text-muted-foreground">Loading documents...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4 bg-destructive/5 border border-destructive/20 rounded-xl">
        <div className="flex items-center gap-2 mb-2">
          <AlertCircle className="w-4 h-4 text-destructive" />
          <p className="text-destructive text-sm">{error}</p>
        </div>
        <button
          onClick={fetchDocuments}
          className="inline-flex items-center gap-1.5 text-sm text-destructive hover:text-destructive/80 transition-colors"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          Retry
        </button>
      </div>
    );
  }

  if (documents.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <div className="w-12 h-12 rounded-xl bg-secondary flex items-center justify-center mb-3">
          <FolderOpen className="w-6 h-6 text-muted-foreground/50" />
        </div>
        <p className="text-sm text-muted-foreground">No documents uploaded yet</p>
      </div>
    );
  }

  return (
    <>
      <div className="space-y-1.5">
        {documents.map((doc) => (
          <div
            key={doc.id}
            onClick={() => setSelectedDocumentId(doc.id)}
            className={cn(
              'flex items-center gap-3 px-3 py-2.5 rounded-xl border border-transparent cursor-pointer transition-all group',
              'bg-card hover:bg-accent hover:border-border',
              'animate-fade-in'
            )}
          >
            <div className="flex-shrink-0">
              {getFileIcon(doc.file_name, doc.file_type)}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-foreground truncate">
                {doc.file_name}
              </p>
              <div className="flex items-center gap-2 mt-1">
                {getDocTypeBadge(doc.doc_type)}
                {doc.language && (
                  <span className="text-[10px] text-muted-foreground">{doc.language}</span>
                )}
              </div>
            </div>
            {doc.confidence !== null && (
              <div className="flex-shrink-0 text-right">
                <span className="text-[10px] text-muted-foreground">
                  {(doc.confidence * 100).toFixed(0)}%
                </span>
              </div>
            )}
            <button
              onClick={(e) => handleDelete(e, doc.id, doc.file_id)}
              disabled={deletingId === doc.id}
              className={cn(
                'flex-shrink-0 p-1.5 rounded-lg transition-all',
                'text-muted-foreground/0 group-hover:text-muted-foreground hover:!text-destructive hover:bg-destructive/10',
                'disabled:opacity-50'
              )}
              title="削除"
            >
              {deletingId === doc.id ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Trash2 className="w-4 h-4" />
              )}
            </button>
          </div>
        ))}
      </div>

      <DocumentDetailModal
        documentId={selectedDocumentId}
        onClose={() => setSelectedDocumentId(null)}
      />
    </>
  );
}
