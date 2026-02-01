// Use direct backend URL for development
const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8001';
console.log('[API] API_BASE:', API_BASE);

export interface HealthStatus {
  status: string;
  service: string;
  llm: {
    enabled: boolean;
    available: boolean;
    model: string | null;
    models?: string[];
    error?: string;
  };
  database: {
    available: boolean;
    stats: {
      documents: number;
      chunks: number;
      chunks_with_embeddings: number;
    } | null;
    error?: string;
  };
  qa_ready: boolean;
}

export interface IngestResult {
  file_id: string;
  document_id: number | null;
  is_duplicate: boolean;
  message?: string;
  classification: {
    doc_type: string;
    owner_company: string | null;
    language: string;
    confidence: number;
  } | null;
  chunks_count: number;
  embeddings_count: number;
  facts_count: number;
  quality: {
    score: number;
    issues: string[];
  } | null;
  llm_used: boolean;
  stored_in_db: boolean;
}

export interface QueryResult {
  question: string;
  answer: string;
  sources: Array<{
    document_name: string;
    chunk_text: string;
    similarity: number;
  }>;
  confidence: number;
  has_answer: boolean;
  search_mode: string;
  error: string | null;
}

export async function checkHealth(): Promise<HealthStatus> {
  const res = await fetch(`${API_BASE}/health`);
  if (!res.ok) throw new Error('Health check failed');
  return res.json();
}

export async function ingestFile(file: File): Promise<IngestResult> {
  const formData = new FormData();
  formData.append('file', file);

  const uploadUrl = `${API_BASE}/pipeline/ingest`;
  console.log('[Upload] Starting upload:', {
    fileName: file.name,
    fileSize: file.size,
    fileType: file.type,
    apiBase: API_BASE,
    uploadUrl: uploadUrl,
  });

  try {
    const res = await fetch(uploadUrl, {
      method: 'POST',
      body: formData,
    });

    console.log('[Upload] Response received:', {
      status: res.status,
      statusText: res.statusText,
      ok: res.ok,
      url: res.url,
    });

    if (!res.ok) {
      const error = await res.json().catch(() => ({ detail: 'Upload failed' }));
      console.error('[Upload] Error response:', error);
      throw new Error(error.detail || 'Upload failed');
    }

    const result = await res.json();
    console.log('[Upload] Success:', {
      fileId: result.file_id,
      documentId: result.document_id,
      isDuplicate: result.is_duplicate,
      chunksCount: result.chunks_count,
      storedInDb: result.stored_in_db,
    });

    return result;
  } catch (err) {
    console.error('[Upload] Request failed:', {
      error: err instanceof Error ? err.message : String(err),
      fileName: file.name,
      uploadUrl: uploadUrl,
    });
    throw err;
  }
}

export async function queryDocuments(question: string): Promise<QueryResult> {
  const res = await fetch(`${API_BASE}/pipeline/query`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ question }),
  });

  if (!res.ok) {
    const error = await res.json().catch(() => ({ detail: 'Query failed' }));
    throw new Error(error.detail || 'Query failed');
  }

  return res.json();
}

export interface DocumentInfo {
  id: number;
  file_id: string;
  file_name: string;
  file_type: string | null;
  doc_type: string | null;
  language: string | null;
  owner_company: string | null;
  doc_date: string | null;
  confidence: number | null;
}

export interface DocumentListResult {
  documents: DocumentInfo[];
  total: number;
  database_available?: boolean;
  error?: string;
}

export async function listDocuments(limit = 100, offset = 0): Promise<DocumentListResult> {
  const url = `${API_BASE}/documents?limit=${limit}&offset=${offset}`;
  console.log('[API] listDocuments request:', url);

  const res = await fetch(url);
  console.log('[API] listDocuments response status:', res.status, res.statusText);

  if (!res.ok) {
    const error = await res.json().catch(() => ({ detail: 'Failed to fetch documents' }));
    console.error('[API] listDocuments error:', error);
    throw new Error(error.detail || 'Failed to fetch documents');
  }

  const data = await res.json();
  console.log('[API] listDocuments response data:', data);
  return data;
}

export interface ChunkInfo {
  index: number;
  page: number;
  section_title: string | null;
  text: string;
  char_len: number;
}

export interface DocumentDetail extends DocumentInfo {
  chunks: ChunkInfo[];
  total_chunks: number;
}

export async function getDocumentDetail(documentId: number): Promise<DocumentDetail> {
  const res = await fetch(`${API_BASE}/documents/${documentId}`);

  if (!res.ok) {
    const error = await res.json().catch(() => ({ detail: 'Failed to fetch document' }));
    throw new Error(error.detail || 'Failed to fetch document');
  }

  return res.json();
}

export interface DeleteDocumentResult {
  success: boolean;
  message: string;
  document_id?: number;
  file_id?: string;
}

export async function deleteDocument(documentId: number): Promise<DeleteDocumentResult> {
  const res = await fetch(`${API_BASE}/documents/${documentId}`, {
    method: 'DELETE',
  });

  if (!res.ok) {
    const error = await res.json().catch(() => ({ detail: 'Failed to delete document' }));
    throw new Error(error.detail || 'Failed to delete document');
  }

  return res.json();
}

export async function deleteFile(fileId: string): Promise<DeleteDocumentResult> {
  const res = await fetch(`${API_BASE}/files/${fileId}`, {
    method: 'DELETE',
  });

  if (!res.ok) {
    const error = await res.json().catch(() => ({ detail: 'Failed to delete file' }));
    throw new Error(error.detail || 'Failed to delete file');
  }

  return res.json();
}
