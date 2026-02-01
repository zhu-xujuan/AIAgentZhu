"""
Database service for PostgreSQL with pgvector support.
Handles document storage, chunk management, and vector similarity search.
"""

import os
import logging
from datetime import date
from typing import Optional, TYPE_CHECKING
from dataclasses import dataclass

import psycopg2
from psycopg2.extras import RealDictCursor

if TYPE_CHECKING:
    from src.llm.ai_client import AIClient as OllamaClient

logger = logging.getLogger(__name__)


@dataclass
class DocumentRecord:
    """Document database record."""
    id: int
    file_id: str
    file_name: str
    file_type: Optional[str]
    doc_type: Optional[str]
    owner_company: Optional[str]
    doc_date: Optional[date]
    language: Optional[str]
    confidence: Optional[float]
    storage_path: Optional[str]
    checksum: Optional[str] = None


@dataclass
class ChunkRecord:
    """Chunk database record."""
    id: int
    document_id: int
    chunk_index: int
    page: Optional[int]
    section_title: Optional[str]
    text: str
    char_len: int
    similarity: Optional[float] = None  # For search results


@dataclass
class SearchResult:
    """Vector search result."""
    chunk: ChunkRecord
    document: DocumentRecord
    similarity: float


class DatabaseService:
    """
    PostgreSQL database service with pgvector support.

    Provides:
    - Document and chunk storage
    - Embedding storage
    - Vector similarity search
    """

    def __init__(
        self,
        host: str = None,
        port: int = None,
        database: str = None,
        user: str = None,
        password: str = None,
    ):
        self.host = host or os.getenv("POSTGRES_HOST", "localhost")
        self.port = port or int(os.getenv("POSTGRES_PORT", "5432"))
        self.database = database or os.getenv("POSTGRES_DB", "aiagent")
        self.user = user or os.getenv("POSTGRES_USER", "postgres")
        self.password = password or os.getenv("POSTGRES_PASSWORD", "aiagent123")
        self._conn = None

    def _get_connection(self):
        """Get or create database connection."""
        if self._conn is None or self._conn.closed:
            self._conn = psycopg2.connect(
                host=self.host,
                port=self.port,
                database=self.database,
                user=self.user,
                password=self.password,
                connect_timeout=3,  # 3 second timeout
            )
        return self._conn

    def close(self):
        """Close database connection."""
        if self._conn is not None and not self._conn.closed:
            self._conn.close()
            self._conn = None

    def find_by_checksum(self, checksum: str) -> Optional[DocumentRecord]:
        """
        Find existing document by checksum.

        Args:
            checksum: SHA-256 checksum to search for

        Returns:
            DocumentRecord if found, None otherwise
        """
        conn = self._get_connection()
        cursor = conn.cursor(cursor_factory=RealDictCursor)

        try:
            cursor.execute(
                "SELECT * FROM documents WHERE checksum = %s LIMIT 1",
                (checksum,)
            )
            row = cursor.fetchone()

            if row:
                return DocumentRecord(
                    id=row["id"],
                    file_id=row["file_id"],
                    file_name=row["file_name"],
                    file_type=row.get("file_type"),
                    doc_type=row.get("doc_type"),
                    owner_company=row.get("owner_company"),
                    doc_date=row.get("doc_date"),
                    language=row.get("language"),
                    confidence=row.get("confidence"),
                    storage_path=row.get("storage_path"),
                    checksum=row.get("checksum"),
                )
            return None

        except Exception as e:
            logger.error(f"Failed to find document by checksum: {e}")
            return None

    def get_all_documents(self, limit: int = 100, offset: int = 0) -> list[DocumentRecord]:
        """
        Get all documents with pagination.

        Args:
            limit: Maximum number of documents to return
            offset: Number of documents to skip

        Returns:
            List of DocumentRecord objects
        """
        conn = self._get_connection()
        cursor = conn.cursor(cursor_factory=RealDictCursor)

        try:
            cursor.execute(
                """
                SELECT d.*,
                       (SELECT COUNT(*) FROM chunks c WHERE c.document_id = d.id) as chunks_count
                FROM documents d
                ORDER BY d.created_at DESC
                LIMIT %s OFFSET %s
                """,
                (limit, offset)
            )
            rows = cursor.fetchall()

            return [
                DocumentRecord(
                    id=row["id"],
                    file_id=row["file_id"],
                    file_name=row["file_name"],
                    file_type=row.get("file_type"),
                    doc_type=row.get("doc_type"),
                    owner_company=row.get("owner_company"),
                    doc_date=row.get("doc_date"),
                    language=row.get("language"),
                    confidence=row.get("confidence"),
                    storage_path=row.get("storage_path"),
                    checksum=row.get("checksum"),
                )
                for row in rows
            ]

        except Exception as e:
            logger.error(f"Failed to get documents: {e}")
            return []

    def save_document(
        self,
        file_id: str,
        file_name: str,
        file_type: Optional[str],
        doc_type: Optional[str],
        owner_company: Optional[str],
        doc_date: Optional[str],
        language: Optional[str],
        confidence: Optional[float],
        storage_path: Optional[str],
        checksum: Optional[str] = None,
        skip_duplicate_check: bool = False,
    ) -> tuple[int, bool]:
        """
        Save document metadata to database.

        Args:
            ... (existing params)
            checksum: SHA-256 checksum for duplicate detection
            skip_duplicate_check: If True, skip duplicate check

        Returns:
            Tuple of (Document ID, is_duplicate flag)
        """
        conn = self._get_connection()
        cursor = conn.cursor()

        try:
            # Check for duplicate by checksum
            if checksum and not skip_duplicate_check:
                existing = self.find_by_checksum(checksum)
                if existing:
                    logger.info(f"Duplicate document found: {file_name} matches {existing.file_name} (id={existing.id})")
                    return existing.id, True

            # Convert date string to date object
            doc_date_obj = None
            if doc_date:
                try:
                    from datetime import datetime
                    doc_date_obj = datetime.strptime(doc_date, "%Y-%m-%d").date()
                except ValueError:
                    pass

            cursor.execute(
                """
                INSERT INTO documents (file_id, file_name, file_type, doc_type,
                                       owner_company, doc_date, language, confidence, storage_path, checksum)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT (file_id) DO UPDATE SET
                    file_name = EXCLUDED.file_name,
                    file_type = EXCLUDED.file_type,
                    doc_type = EXCLUDED.doc_type,
                    owner_company = EXCLUDED.owner_company,
                    doc_date = EXCLUDED.doc_date,
                    language = EXCLUDED.language,
                    confidence = EXCLUDED.confidence,
                    storage_path = EXCLUDED.storage_path,
                    checksum = EXCLUDED.checksum,
                    updated_at = CURRENT_TIMESTAMP
                RETURNING id
                """,
                (file_id, file_name, file_type, doc_type, owner_company,
                 doc_date_obj, language, confidence, storage_path, checksum)
            )
            doc_id = cursor.fetchone()[0]
            conn.commit()
            logger.info(f"Saved document: {file_name} (id={doc_id})")
            return doc_id, False

        except Exception as e:
            conn.rollback()
            logger.error(f"Failed to save document: {e}")
            raise

    def save_chunk(
        self,
        document_id: int,
        chunk_index: int,
        page: Optional[int],
        section_title: Optional[str],
        text: str,
        char_len: int,
        embedding: Optional[list[float]] = None,
    ) -> int:
        """
        Save chunk with optional embedding to database.

        Returns:
            Chunk ID.
        """
        conn = self._get_connection()
        cursor = conn.cursor()

        try:
            if embedding and self.has_vector_support():
                # Convert embedding list to pgvector format
                embedding_str = "[" + ",".join(str(x) for x in embedding) + "]"
                cursor.execute(
                    """
                    INSERT INTO chunks (document_id, chunk_index, page, section_title,
                                        text, char_len, embedding)
                    VALUES (%s, %s, %s, %s, %s, %s, %s::vector)
                    RETURNING id
                    """,
                    (document_id, chunk_index, page, section_title, text, char_len, embedding_str)
                )
            elif embedding:
                # Store embedding as JSON text (for non-pgvector databases)
                import json
                embedding_json = json.dumps(embedding)
                cursor.execute(
                    """
                    INSERT INTO chunks (document_id, chunk_index, page, section_title,
                                        text, char_len, embedding)
                    VALUES (%s, %s, %s, %s, %s, %s, %s)
                    RETURNING id
                    """,
                    (document_id, chunk_index, page, section_title, text, char_len, embedding_json)
                )
            else:
                cursor.execute(
                    """
                    INSERT INTO chunks (document_id, chunk_index, page, section_title,
                                        text, char_len)
                    VALUES (%s, %s, %s, %s, %s, %s)
                    RETURNING id
                    """,
                    (document_id, chunk_index, page, section_title, text, char_len)
                )

            chunk_id = cursor.fetchone()[0]
            conn.commit()
            return chunk_id

        except Exception as e:
            conn.rollback()
            logger.error(f"Failed to save chunk: {e}")
            raise

    def save_chunks_batch(
        self,
        document_id: int,
        chunks: list[dict],
        embeddings: Optional[list[list[float]]] = None,
    ) -> list[int]:
        """
        Save multiple chunks with embeddings in batch.

        Args:
            document_id: Parent document ID.
            chunks: List of chunk dicts with keys: chunk_index, page, section_title, text, char_len
            embeddings: Optional list of embedding vectors (same length as chunks).

        Returns:
            List of chunk IDs.
        """
        chunk_ids = []
        for i, chunk in enumerate(chunks):
            embedding = embeddings[i] if embeddings and i < len(embeddings) else None
            chunk_id = self.save_chunk(
                document_id=document_id,
                chunk_index=chunk.get("chunk_index", i),
                page=chunk.get("page"),
                section_title=chunk.get("section_title"),
                text=chunk.get("text", ""),
                char_len=chunk.get("char_len", len(chunk.get("text", ""))),
                embedding=embedding,
            )
            chunk_ids.append(chunk_id)
        return chunk_ids

    def _extract_keywords(self, query: str) -> list[str]:
        """Extract keywords from query text, removing particles and stop words."""
        # Remove common Japanese particles and question words
        particles = [
            'は', 'が', 'を', 'に', 'で', 'と', 'の', 'か', 'も', 'や', 'へ', 'から', 'まで', 'より',
            'です', 'ます', 'ました', 'でした', 'ください', 'ありますか', 'ありました',
            'いくら', 'どう', 'なに', '何', 'いつ', 'どこ', 'だれ', '誰', 'どれ', 'どの', 'どんな',
            'について', 'に関して', 'とは', 'って', 'という',
            '？', '?', '。', '、', '！', '!', '（', '）', '「', '」'
        ]

        # English stop words to remove
        en_stop_words = [
            'what', 'is', 'the', 'are', 'how', 'many', 'much', 'when', 'where', 'who',
            'which', 'why', 'does', 'do', 'did', 'can', 'could', 'would', 'should',
            'will', 'was', 'were', 'been', 'being', 'have', 'has', 'had',
            'for', 'with', 'about', 'from', 'into', 'during', 'before', 'after',
            'above', 'below', 'between', 'under', 'again', 'further', 'then', 'once',
            'a', 'an', 'of', 'in', 'on', 'at', 'to', 'by', 'and', 'or', 'but',
        ]

        keywords_text = query
        for p in particles:
            keywords_text = keywords_text.replace(p, ' ')

        # Split into keywords
        words = keywords_text.split()
        keywords = []

        for word in words:
            word_clean = word.strip().lower()
            if len(word_clean) < 2:
                continue
            if word_clean in en_stop_words:
                continue
            keywords.append(word.strip())

        return keywords if keywords else [query]

    def _calculate_keyword_similarity(self, text: str, keywords: list[str]) -> float:
        """Calculate similarity score based on keyword matches."""
        if not keywords:
            return 0.0

        text_lower = text.lower()
        matches = sum(1 for kw in keywords if kw.lower() in text_lower)
        base_score = matches / len(keywords)

        # Bonus for exact phrase match
        query_phrase = ' '.join(keywords)
        if query_phrase.lower() in text_lower:
            base_score = min(1.0, base_score + 0.2)

        return round(base_score, 3)

    def search_chunks_fulltext(
        self,
        query: str,
        limit: int = 5,
    ) -> list[SearchResult]:
        """
        Search for chunks using full-text search (fallback when pgvector not available).
        Supports Japanese text by splitting into keywords.

        Args:
            query: Search query text.
            limit: Maximum number of results.

        Returns:
            List of SearchResult objects sorted by relevance.
        """
        conn = self._get_connection()
        cursor = conn.cursor(cursor_factory=RealDictCursor)

        try:
            keywords = self._extract_keywords(query)
            logger.info(f"Full-text search: query='{query}', keywords={keywords}")

            # Build ILIKE conditions for each keyword
            ilike_conditions = " OR ".join(["c.text ILIKE %s" for _ in keywords])
            ilike_params = [f'%{kw}%' for kw in keywords]

            # Fetch more results for re-ranking
            fetch_limit = limit * 3

            cursor.execute(
                f"""
                SELECT
                    c.id as chunk_id,
                    c.document_id,
                    c.chunk_index,
                    c.page,
                    c.section_title,
                    c.text,
                    c.char_len,
                    d.id as doc_id,
                    d.file_id,
                    d.file_name,
                    d.file_type,
                    d.doc_type,
                    d.owner_company,
                    d.doc_date,
                    d.language,
                    d.confidence,
                    d.storage_path,
                    d.checksum
                FROM chunks c
                JOIN documents d ON c.document_id = d.id
                WHERE {ilike_conditions}
                LIMIT %s
                """,
                (*ilike_params, fetch_limit)
            )

            results = []
            for row in cursor.fetchall():
                # Calculate similarity based on keyword matches
                similarity = self._calculate_keyword_similarity(row["text"], keywords)

                chunk = ChunkRecord(
                    id=row["chunk_id"],
                    document_id=row["document_id"],
                    chunk_index=row["chunk_index"],
                    page=row["page"],
                    section_title=row["section_title"],
                    text=row["text"],
                    char_len=row["char_len"],
                    similarity=similarity,
                )
                document = DocumentRecord(
                    id=row["doc_id"],
                    file_id=row["file_id"],
                    file_name=row["file_name"],
                    file_type=row.get("file_type"),
                    doc_type=row.get("doc_type"),
                    owner_company=row.get("owner_company"),
                    doc_date=row.get("doc_date"),
                    language=row.get("language"),
                    confidence=row.get("confidence"),
                    storage_path=row.get("storage_path"),
                    checksum=row.get("checksum"),
                )
                results.append(SearchResult(
                    chunk=chunk,
                    document=document,
                    similarity=similarity,
                ))

            # Sort by similarity score (descending) and return top results
            results.sort(key=lambda x: x.similarity, reverse=True)
            results = results[:limit]

            logger.info(f"Full-text search found {len(results)} results (top scores: {[r.similarity for r in results[:3]]})")
            return results

        except Exception as e:
            logger.error(f"Full-text search failed: {e}")
            return []

    def has_vector_support(self) -> bool:
        """Check if pgvector extension is available."""
        conn = self._get_connection()
        cursor = conn.cursor()
        try:
            cursor.execute("SELECT 1 FROM pg_extension WHERE extname = 'vector'")
            return cursor.fetchone() is not None
        except Exception:
            return False

    def search_similar_chunks(
        self,
        query_embedding: list[float],
        limit: int = 5,
        similarity_threshold: float = 0.3,
        query_text: str = None,
    ) -> list[SearchResult]:
        """
        Search for similar chunks using vector similarity.
        Falls back to full-text search if pgvector is not available.

        Args:
            query_embedding: Query embedding vector.
            limit: Maximum number of results.
            similarity_threshold: Minimum similarity score (0-1).
            query_text: Original query text (for fallback).

        Returns:
            List of SearchResult objects ordered by similarity.
        """
        # Check if pgvector is available, otherwise use full-text search
        if not self.has_vector_support():
            logger.info("pgvector not available, using full-text search")
            if query_text:
                return self.search_chunks_fulltext(query_text, limit)
            return []

        conn = self._get_connection()
        cursor = conn.cursor(cursor_factory=RealDictCursor)

        try:
            embedding_str = "[" + ",".join(str(x) for x in query_embedding) + "]"

            # Use cosine similarity (1 - cosine_distance)
            cursor.execute(
                """
                SELECT
                    c.id as chunk_id,
                    c.document_id,
                    c.chunk_index,
                    c.page,
                    c.section_title,
                    c.text,
                    c.char_len,
                    1 - (c.embedding <=> %s::vector) as similarity,
                    d.id as doc_id,
                    d.file_id,
                    d.file_name,
                    d.file_type,
                    d.doc_type,
                    d.owner_company,
                    d.doc_date,
                    d.language,
                    d.confidence,
                    d.storage_path,
                    d.checksum
                FROM chunks c
                JOIN documents d ON c.document_id = d.id
                WHERE c.embedding IS NOT NULL
                AND 1 - (c.embedding <=> %s::vector) > %s
                ORDER BY c.embedding <=> %s::vector
                LIMIT %s
                """,
                (embedding_str, embedding_str, similarity_threshold, embedding_str, limit)
            )

            results = []
            for row in cursor.fetchall():
                chunk = ChunkRecord(
                    id=row["chunk_id"],
                    document_id=row["document_id"],
                    chunk_index=row["chunk_index"],
                    page=row["page"],
                    section_title=row["section_title"],
                    text=row["text"],
                    char_len=row["char_len"],
                    similarity=row["similarity"],
                )
                document = DocumentRecord(
                    id=row["doc_id"],
                    file_id=row["file_id"],
                    file_name=row["file_name"],
                    file_type=row.get("file_type"),
                    doc_type=row.get("doc_type"),
                    owner_company=row.get("owner_company"),
                    doc_date=row.get("doc_date"),
                    language=row.get("language"),
                    confidence=row.get("confidence"),
                    storage_path=row.get("storage_path"),
                    checksum=row.get("checksum"),
                )
                results.append(SearchResult(
                    chunk=chunk,
                    document=document,
                    similarity=row["similarity"],
                ))

            logger.info(f"Vector search found {len(results)} results")
            return results

        except Exception as e:
            logger.warning(f"Vector search failed: {e}, falling back to full-text search")
            # Fall back to full-text search if vector search fails
            if query_text:
                return self.search_chunks_fulltext(query_text, limit)
            return []

    def search_hybrid(
        self,
        query_text: str,
        query_embedding: Optional[list[float]] = None,
        limit: int = 5,
        similarity_threshold: float = 0.3,
        vector_weight: float = 0.7,
    ) -> list[SearchResult]:
        """
        Hybrid search combining vector similarity and full-text search.
        Provides better results by leveraging both semantic and keyword matching.

        Args:
            query_text: The search query text.
            query_embedding: Pre-computed embedding vector (optional).
            limit: Maximum number of results.
            similarity_threshold: Minimum similarity score for vector search.
            vector_weight: Weight for vector search scores (0-1). Full-text gets 1 - vector_weight.

        Returns:
            List of SearchResult objects with combined scores.
        """
        results_map: dict[int, SearchResult] = {}  # chunk_id -> SearchResult

        # Get full-text search results
        fulltext_results = self.search_chunks_fulltext(query_text, limit * 2)
        for result in fulltext_results:
            chunk_id = result.chunk.id
            # Store with full-text score
            result.chunk.similarity = result.similarity * (1 - vector_weight)
            results_map[chunk_id] = result

        # Get vector search results if embedding is provided
        if query_embedding and self.has_vector_support():
            vector_results = self.search_similar_chunks(
                query_embedding=query_embedding,
                limit=limit * 2,
                similarity_threshold=similarity_threshold,
                query_text=None,  # Don't fall back to full-text again
            )
            for result in vector_results:
                chunk_id = result.chunk.id
                vector_score = result.similarity * vector_weight

                if chunk_id in results_map:
                    # Combine scores if chunk found in both searches
                    existing = results_map[chunk_id]
                    combined_score = existing.chunk.similarity + vector_score
                    existing.chunk.similarity = combined_score
                    existing.similarity = combined_score
                else:
                    # Add new result with vector score only
                    result.chunk.similarity = vector_score
                    result.similarity = vector_score
                    results_map[chunk_id] = result

        # Sort by combined score and return top results
        results = list(results_map.values())
        results.sort(key=lambda x: x.similarity, reverse=True)
        results = results[:limit]

        logger.info(f"Hybrid search found {len(results)} results (scores: {[round(r.similarity, 3) for r in results[:3]]})")
        return results

    def get_document_by_file_id(self, file_id: str) -> Optional[DocumentRecord]:
        """Get document by file_id."""
        conn = self._get_connection()
        cursor = conn.cursor(cursor_factory=RealDictCursor)

        cursor.execute(
            "SELECT * FROM documents WHERE file_id = %s",
            (file_id,)
        )
        row = cursor.fetchone()

        if row:
            return DocumentRecord(
                id=row["id"],
                file_id=row["file_id"],
                file_name=row["file_name"],
                file_type=row.get("file_type"),
                doc_type=row.get("doc_type"),
                owner_company=row.get("owner_company"),
                doc_date=row.get("doc_date"),
                language=row.get("language"),
                confidence=row.get("confidence"),
                storage_path=row.get("storage_path"),
                checksum=row.get("checksum"),
            )
        return None

    def get_document_by_id(self, document_id: int) -> Optional[DocumentRecord]:
        """Get document by ID."""
        conn = self._get_connection()
        cursor = conn.cursor(cursor_factory=RealDictCursor)

        cursor.execute(
            "SELECT * FROM documents WHERE id = %s",
            (document_id,)
        )
        row = cursor.fetchone()

        if row:
            return DocumentRecord(
                id=row["id"],
                file_id=row["file_id"],
                file_name=row["file_name"],
                file_type=row.get("file_type"),
                doc_type=row.get("doc_type"),
                owner_company=row.get("owner_company"),
                doc_date=row.get("doc_date"),
                language=row.get("language"),
                confidence=row.get("confidence"),
                storage_path=row.get("storage_path"),
                checksum=row.get("checksum"),
            )
        return None

    def get_chunks_by_document_id(self, document_id: int) -> list[ChunkRecord]:
        """Get all chunks for a document."""
        conn = self._get_connection()
        cursor = conn.cursor(cursor_factory=RealDictCursor)

        cursor.execute(
            "SELECT * FROM chunks WHERE document_id = %s ORDER BY chunk_index",
            (document_id,)
        )

        return [
            ChunkRecord(
                id=row["id"],
                document_id=row["document_id"],
                chunk_index=row["chunk_index"],
                page=row["page"],
                section_title=row["section_title"],
                text=row["text"],
                char_len=row["char_len"],
            )
            for row in cursor.fetchall()
        ]

    def delete_document(self, file_id: str) -> bool:
        """Delete document and all related data."""
        conn = self._get_connection()
        cursor = conn.cursor()

        try:
            cursor.execute(
                "DELETE FROM documents WHERE file_id = %s RETURNING id",
                (file_id,)
            )
            deleted = cursor.fetchone() is not None
            conn.commit()
            return deleted

        except Exception as e:
            conn.rollback()
            logger.error(f"Failed to delete document: {e}")
            raise

    def get_stats(self) -> dict:
        """Get database statistics."""
        conn = self._get_connection()
        cursor = conn.cursor(cursor_factory=RealDictCursor)

        cursor.execute("SELECT COUNT(*) as count FROM documents")
        doc_count = cursor.fetchone()["count"]

        cursor.execute("SELECT COUNT(*) as count FROM chunks")
        chunk_count = cursor.fetchone()["count"]

        cursor.execute("SELECT COUNT(*) as count FROM chunks WHERE embedding IS NOT NULL")
        embedded_count = cursor.fetchone()["count"]

        return {
            "documents": doc_count,
            "chunks": chunk_count,
            "chunks_with_embeddings": embedded_count,
        }


# Global instance
_db_service: Optional[DatabaseService] = None


def get_database_service() -> DatabaseService:
    """Get or create the global database service instance."""
    global _db_service
    if _db_service is None:
        _db_service = DatabaseService()
    return _db_service
