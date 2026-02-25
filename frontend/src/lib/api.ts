// If NEXT_PUBLIC_API_URL is unset, use same-origin + Next.js rewrites as a proxy.
export const API_BASE = process.env.NEXT_PUBLIC_API_URL || '';
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
  search_time_seconds: number | null;
}

export interface LlmConfig {
  enabled: boolean;
  provider: string;
  base_url: string;
  model: string | null;
  embedding_model: string | null;
}

export interface LlmConfigUpdateResult {
  base_url: string;
  provider?: string;
  applied: boolean;
  persisted: boolean;
  message: string;
  error?: string | null;
}

export async function checkHealth(): Promise<HealthStatus> {
  const res = await fetch(`${API_BASE}/health`);
  if (!res.ok) throw new Error('Health check failed');
  return res.json();
}

export async function getLlmConfig(): Promise<LlmConfig> {
  const res = await fetch(`${API_BASE}/config/llm`);
  if (!res.ok) throw new Error('Failed to fetch LLM config');
  return res.json();
}

export async function updateLlmConfig(
  baseUrl: string,
  persist = true,
  provider?: string
): Promise<LlmConfigUpdateResult> {
  const res = await fetch(`${API_BASE}/config/llm`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      base_url: baseUrl,
      persist,
      ...(provider ? { provider } : {}),
    }),
  });
  if (!res.ok) {
    const error = await res.json().catch(() => ({ detail: 'Update failed' }));
    throw new Error(error.detail || 'Update failed');
  }
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
    const message = err instanceof TypeError
      ? `バックエンドに接続できません (${API_BASE})`
      : err instanceof Error ? err.message : String(err);
    console.error('[Upload] Request failed:', {
      error: message,
      fileName: file.name,
      uploadUrl: uploadUrl,
    });
    throw new Error(message);
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

  let res: Response;
  try {
    res = await fetch(url);
  } catch (err) {
    // Network error (backend not running)
    console.warn('[API] listDocuments: Backend is not reachable at', API_BASE);
    return { documents: [], total: 0, database_available: false };
  }
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

// ============================================================
// History & Template API
// ============================================================

export interface QAHistoryItem {
  id: number;
  question: string;
  answer_preview?: string;
  confidence?: number;
  has_answer?: boolean;
  mode?: string;
  from_cache?: boolean;
  created_at: string;
}

export interface QADetail {
  id: number;
  question: string;
  answer: string;
  sources: Array<{
    document_name: string;
    chunk_text: string;
    similarity: number;
  }>;
  confidence?: number;
  has_answer?: boolean;
  search_time?: number;
  mode?: string;
  from_cache?: boolean;
  created_at: string;
}

export interface SlideHistoryItem {
  id: number;
  title: string;
  question?: string;
  slide_count: number;
  style_options?: Record<string, string>;
  created_at: string;
  updated_at: string;
}

export interface SlideDeckDetail {
  id: number;
  title: string;
  question?: string;
  answer?: string;
  plan_md?: string;
  style_options?: Record<string, string>;
  slides: {
    slide_index: number;
    title: string;
    slide_type: string;
    html: string;
    plan_text?: string;
  }[];
  created_at: string;
  updated_at: string;
}

export interface SlideTemplate {
  id: number;
  name: string;
  position: string;
  html: string;
  header_color?: string;
  footer_color?: string;
  created_at: string;
}

// ---- Q&A History ----

export async function fetchQAHistory(limit = 50, offset = 0): Promise<QAHistoryItem[]> {
  const res = await fetch(`/api/history/qa?limit=${limit}&offset=${offset}`);
  if (!res.ok) return [];
  const data = await res.json();
  return data.items || [];
}

export async function fetchQADetail(id: number): Promise<QADetail> {
  const res = await fetch(`/api/history/qa/${id}`);
  if (!res.ok) throw new Error('Failed to fetch QA detail');
  return res.json();
}

export async function saveQAConversation(data: {
  question: string;
  answer: string;
  sources?: unknown[];
  confidence?: number;
  has_answer?: boolean;
  search_time?: number;
  mode?: string;
  from_cache?: boolean;
}): Promise<{ id: number }> {
  const res = await fetch('/api/history/qa', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error('Failed to save QA conversation');
  return res.json();
}

// ---- Slide History ----

export async function fetchSlideHistory(limit = 50, offset = 0): Promise<SlideHistoryItem[]> {
  const res = await fetch(`/api/history/slides?limit=${limit}&offset=${offset}`);
  if (!res.ok) return [];
  const data = await res.json();
  return data.items || [];
}

export async function fetchSlideDeckDetail(id: number): Promise<SlideDeckDetail> {
  const res = await fetch(`/api/history/slides/${id}`);
  if (!res.ok) throw new Error('Failed to fetch slide deck detail');
  return res.json();
}

export async function saveSlideDeck(data: {
  title: string;
  question?: string;
  answer?: string;
  plan_md?: string;
  style_options?: Record<string, string | undefined>;
  slides: {
    slide_index: number;
    title?: string;
    slide_type?: string;
    html: string;
    plan_text?: string;
  }[];
}): Promise<{ id: number }> {
  const res = await fetch('/api/history/slides', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error('Failed to save slide deck');
  return res.json();
}

export async function updateSlideDeck(id: number, data: {
  slides: {
    slide_index: number;
    title?: string;
    slide_type?: string;
    html: string;
    plan_text?: string;
  }[];
  style_options?: Record<string, string | undefined>;
}): Promise<void> {
  const res = await fetch(`/api/history/slides/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error('Failed to update slide deck');
}

export async function deleteSlideDeck(id: number): Promise<void> {
  const res = await fetch(`/api/history/slides/${id}`, {
    method: 'DELETE',
  });
  if (!res.ok) throw new Error('Failed to delete slide deck');
}

// ---- Slide Templates ----

export async function fetchSlideTemplates(): Promise<SlideTemplate[]> {
  const res = await fetch('/api/templates/slides');
  if (!res.ok) return [];
  const data = await res.json();
  return data.items || [];
}

export async function saveSlideTemplate(data: {
  name: string;
  position: string;
  html: string;
  header_color?: string;
  footer_color?: string;
}): Promise<{ id: number }> {
  const res = await fetch('/api/templates/slides', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error('Failed to save slide template');
  return res.json();
}

export async function deleteSlideTemplate(id: number): Promise<void> {
  const res = await fetch(`/api/templates/slides/${id}`, {
    method: 'DELETE',
  });
  if (!res.ok) throw new Error('Failed to delete slide template');
}
