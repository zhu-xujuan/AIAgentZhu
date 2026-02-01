'use client';

import { useEffect, useState } from 'react';
import { listDocuments, DocumentInfo, deleteDocument, deleteFile } from '@/lib/api';
import DocumentDetailModal from './DocumentDetailModal';

function getFileIcon(fileName: string, fileType: string | null) {
  const ext = fileName.split('.').pop()?.toLowerCase() || '';
  const mimeType = fileType?.toLowerCase() || '';

  // Text files
  if (ext === 'txt' || mimeType.includes('text/plain')) {
    return (
      <svg className="h-8 w-8 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
      </svg>
    );
  }

  // CSV files
  if (ext === 'csv' || mimeType.includes('csv')) {
    return (
      <svg className="h-8 w-8 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 10h18M3 14h18m-9-4v8m-7 0h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
      </svg>
    );
  }

  // JSON files
  if (ext === 'json' || mimeType.includes('json')) {
    return (
      <svg className="h-8 w-8 text-yellow-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17.657 18.657A8 8 0 016.343 7.343S7 9 9 10c0-2 .5-5 2.986-7C14 5 16.09 5.777 17.656 7.343A7.975 7.975 0 0120 13a7.975 7.975 0 01-2.343 5.657z" />
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.879 16.121A3 3 0 1012.015 11L11 14H9c0 .768.293 1.536.879 2.121z" />
      </svg>
    );
  }

  // Markdown files
  if (ext === 'md' || ext === 'markdown') {
    return (
      <svg className="h-8 w-8 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z" />
      </svg>
    );
  }

  // PDF files
  if (ext === 'pdf' || mimeType.includes('pdf')) {
    return (
      <svg className="h-8 w-8 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 13h6m-6 4h4" />
      </svg>
    );
  }

  // Word documents
  if (ext === 'doc' || ext === 'docx' || mimeType.includes('word')) {
    return (
      <svg className="h-8 w-8 text-blue-700" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
      </svg>
    );
  }

  // Excel files
  if (ext === 'xls' || ext === 'xlsx' || mimeType.includes('excel') || mimeType.includes('spreadsheet')) {
    return (
      <svg className="h-8 w-8 text-green-700" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 10h18M3 14h18m-9-4v8m-7 0h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
      </svg>
    );
  }

  // Default file icon
  return (
    <svg className="h-8 w-8 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
    </svg>
  );
}

function getDocTypeBadge(docType: string | null) {
  if (!docType) return null;

  const colors: Record<string, string> = {
    contract: 'bg-purple-100 text-purple-700',
    invoice: 'bg-green-100 text-green-700',
    report: 'bg-blue-100 text-blue-700',
    manual: 'bg-yellow-100 text-yellow-700',
    meeting_minutes: 'bg-orange-100 text-orange-700',
    other: 'bg-gray-100 text-gray-700',
  };

  const color = colors[docType] || colors.other;

  return (
    <span className={`px-2 py-0.5 text-xs rounded ${color}`}>
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
    console.log('[FileList] fetchDocuments called, refreshTrigger:', refreshTrigger);
    try {
      setLoading(true);
      setError(null);
      console.log('[FileList] Calling listDocuments API...');
      const result = await listDocuments();
      console.log('[FileList] API Response:', {
        documentsCount: result.documents?.length,
        total: result.total,
        databaseAvailable: result.database_available,
        error: result.error,
        documents: result.documents
      });
      setDocuments(result.documents);
      setDatabaseAvailable(result.database_available !== false);

      // Show info message if database is not available
      if ('database_available' in result && !result.database_available) {
        console.info('[FileList] Database is not available. Showing files from storage.');
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to load documents';
      console.error('[FileList] Error fetching documents:', err);
      setError(errorMessage);
      setDocuments([]); // Clear documents on error
    } finally {
      setLoading(false);
      console.log('[FileList] fetchDocuments completed');
    }
  };

  const handleDelete = async (e: React.MouseEvent, documentId: number, fileId: string) => {
    e.stopPropagation(); // Prevent opening the detail modal

    if (!confirm('このドキュメントを削除してもよろしいですか？')) {
      return;
    }

    try {
      setDeletingId(documentId);

      // Use file_id for deletion when database is not available
      if (!databaseAvailable) {
        await deleteFile(fileId);
      } else {
        await deleteDocument(documentId);
      }

      // Remove from local state immediately
      setDocuments(docs => docs.filter(doc => doc.id !== documentId));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete document');
      console.error('Delete failed:', err);
    } finally {
      setDeletingId(null);
    }
  };

  useEffect(() => {
    fetchDocuments();
  }, [refreshTrigger]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-500"></div>
        <span className="ml-2 text-gray-500">Loading documents...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4 bg-red-50 border border-red-200 rounded-lg">
        <p className="text-red-600 text-sm">{error}</p>
        <button
          onClick={fetchDocuments}
          className="mt-2 text-sm text-red-600 underline hover:text-red-800"
        >
          Retry
        </button>
      </div>
    );
  }

  if (documents.length === 0) {
    return (
      <div className="text-center py-8 text-gray-500">
        <svg
          className="mx-auto h-12 w-12 text-gray-300 mb-3"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.5}
            d="M5 19a2 2 0 01-2-2V7a2 2 0 012-2h4l2 2h4a2 2 0 012 2v1M5 19h14a2 2 0 002-2v-5a2 2 0 00-2-2H9a2 2 0 00-2 2v5a2 2 0 01-2 2z"
          />
        </svg>
        <p>No documents uploaded yet</p>
      </div>
    );
  }

  return (
    <>
      <div className="space-y-2">
        {documents.map((doc) => (
          <div
            key={doc.id}
            onClick={() => setSelectedDocumentId(doc.id)}
            className="flex items-center gap-4 p-3 bg-white border rounded-lg hover:bg-gray-50 hover:border-blue-300 transition-colors cursor-pointer relative group"
          >
            <div className="flex-shrink-0">
              {getFileIcon(doc.file_name, doc.file_type)}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-gray-900 truncate">
                {doc.file_name}
              </p>
              <div className="flex items-center gap-2 mt-1">
                {getDocTypeBadge(doc.doc_type)}
                {doc.language && (
                  <span className="text-xs text-gray-500">{doc.language}</span>
                )}
              </div>
            </div>
            {doc.confidence !== null && (
              <div className="flex-shrink-0 text-right">
                <span className="text-xs text-gray-400">
                  確度: {(doc.confidence * 100).toFixed(0)}%
                </span>
              </div>
            )}
            <button
              onClick={(e) => handleDelete(e, doc.id, doc.file_id)}
              disabled={deletingId === doc.id}
              className="flex-shrink-0 p-1 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors disabled:opacity-50"
              title="削除"
            >
              {deletingId === doc.id ? (
                <div className="animate-spin h-5 w-5 border-2 border-gray-300 border-t-red-600 rounded-full"></div>
              ) : (
                <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
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
