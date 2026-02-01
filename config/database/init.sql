-- AIAgent Database Schema

-- Enable pgvector extension for vector search (if available)
-- This will fail gracefully if pgvector is not installed
DO $$
BEGIN
    CREATE EXTENSION IF NOT EXISTS vector;
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'pgvector extension not available, vector search will be disabled';
END
$$;

-- Documents table: 取り込んだ文書
CREATE TABLE IF NOT EXISTS documents (
    id SERIAL PRIMARY KEY,
    file_id VARCHAR(255) UNIQUE NOT NULL,
    file_name VARCHAR(500) NOT NULL,
    file_type VARCHAR(100),
    doc_type VARCHAR(50),
    owner_company VARCHAR(200),
    doc_date DATE,
    language VARCHAR(10),
    confidence DECIMAL(3,2),
    storage_path TEXT,
    checksum VARCHAR(64),  -- SHA-256 hash for duplicate detection
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Chunks table: チャンク分割結果
CREATE TABLE IF NOT EXISTS chunks (
    id SERIAL PRIMARY KEY,
    document_id INTEGER REFERENCES documents(id) ON DELETE CASCADE,
    chunk_index INTEGER NOT NULL,
    page INTEGER,
    section_title TEXT,
    text TEXT NOT NULL,
    char_len INTEGER,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Add embedding column if pgvector is available
DO $$
BEGIN
    ALTER TABLE chunks ADD COLUMN embedding vector(768);
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'Could not add embedding column (pgvector not available)';
END
$$;

-- Facts table: 抽出された事実
CREATE TABLE IF NOT EXISTS facts (
    id SERIAL PRIMARY KEY,
    document_id INTEGER REFERENCES documents(id) ON DELETE CASCADE,
    chunk_id INTEGER REFERENCES chunks(id) ON DELETE CASCADE,
    fact_type VARCHAR(50) NOT NULL,
    title TEXT,
    body TEXT NOT NULL,
    owner VARCHAR(200),
    due_date DATE,
    status VARCHAR(50),
    confidence DECIMAL(3,2),
    needs_review BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Evidence table: 引用情報
CREATE TABLE IF NOT EXISTS evidence (
    id SERIAL PRIMARY KEY,
    fact_id INTEGER REFERENCES facts(id) ON DELETE CASCADE,
    quote TEXT NOT NULL,
    page INTEGER,
    chunk_index INTEGER,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Quality checks table: 品質チェック結果
CREATE TABLE IF NOT EXISTS quality_checks (
    id SERIAL PRIMARY KEY,
    document_id INTEGER REFERENCES documents(id) ON DELETE CASCADE,
    needs_review BOOLEAN NOT NULL,
    reasons TEXT[],
    checked_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for search performance
CREATE INDEX IF NOT EXISTS idx_documents_doc_type ON documents(doc_type);
CREATE INDEX IF NOT EXISTS idx_documents_owner_company ON documents(owner_company);
CREATE INDEX IF NOT EXISTS idx_documents_doc_date ON documents(doc_date);
CREATE INDEX IF NOT EXISTS idx_documents_checksum ON documents(checksum);

CREATE INDEX IF NOT EXISTS idx_facts_fact_type ON facts(fact_type);
CREATE INDEX IF NOT EXISTS idx_facts_status ON facts(status);
CREATE INDEX IF NOT EXISTS idx_facts_owner ON facts(owner);
CREATE INDEX IF NOT EXISTS idx_facts_due_date ON facts(due_date);
CREATE INDEX IF NOT EXISTS idx_facts_document_id ON facts(document_id);

-- Full text search index (Japanese)
CREATE INDEX IF NOT EXISTS idx_facts_body_gin ON facts USING gin(to_tsvector('simple', body));
CREATE INDEX IF NOT EXISTS idx_chunks_text_gin ON chunks USING gin(to_tsvector('simple', text));

-- Vector similarity search index (using HNSW for fast approximate search)
-- Only created if pgvector is available
DO $$
BEGIN
    CREATE INDEX IF NOT EXISTS idx_chunks_embedding ON chunks USING hnsw (embedding vector_cosine_ops);
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'Could not create vector index (pgvector not available)';
END
$$;

-- Migration: Add checksum column if not exists (for existing databases)
DO $$
BEGIN
    ALTER TABLE documents ADD COLUMN checksum VARCHAR(64);
    CREATE INDEX IF NOT EXISTS idx_documents_checksum ON documents(checksum);
EXCEPTION WHEN duplicate_column THEN
    -- Column already exists, ignore
END
$$;
