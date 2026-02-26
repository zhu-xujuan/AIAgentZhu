"""
Database service for PostgreSQL with pgvector support.
Handles document storage, chunk management, and vector similarity search.
"""

import os
import logging
from contextlib import contextmanager
from datetime import date
from typing import Optional, TYPE_CHECKING
from dataclasses import dataclass

import psycopg2
from psycopg2.extras import RealDictCursor
from psycopg2 import pool

if TYPE_CHECKING:
    from src.llm.ai_client import AIClient as OllamaClient

logger = logging.getLogger(__name__)

# Connection pool settings from environment
DB_POOL_MIN_CONN = int(os.getenv("DB_POOL_MIN_CONN", "2"))
DB_POOL_MAX_CONN = int(os.getenv("DB_POOL_MAX_CONN", "10"))


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

    Uses connection pooling for better performance under concurrent load.
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
        self.password = password or os.getenv("POSTGRES_PASSWORD")
        if not self.password:
            raise ValueError("POSTGRES_PASSWORD environment variable is required")

        self._pool: Optional[pool.ThreadedConnectionPool] = None
        self._vector_support_cached: Optional[bool] = None
        self._init_pool()

    def _init_pool(self):
        """Initialize the connection pool."""
        try:
            self._pool = pool.ThreadedConnectionPool(
                minconn=DB_POOL_MIN_CONN,
                maxconn=DB_POOL_MAX_CONN,
                host=self.host,
                port=self.port,
                database=self.database,
                user=self.user,
                password=self.password,
                connect_timeout=5,
            )
            logger.info(f"Database connection pool initialized (min={DB_POOL_MIN_CONN}, max={DB_POOL_MAX_CONN})")
        except Exception as e:
            logger.error(f"Failed to initialize connection pool: {e}")
            raise

    @contextmanager
    def _get_connection(self):
        """Get a connection from the pool with automatic return."""
        if self._pool is None:
            raise RuntimeError("Database connection pool is not initialized")

        conn = None
        try:
            conn = self._pool.getconn()
            yield conn
        finally:
            if conn is not None:
                self._pool.putconn(conn)

    @contextmanager
    def _get_cursor(self, dict_cursor: bool = False):
        """Get a cursor with automatic cleanup and connection return."""
        with self._get_connection() as conn:
            cursor_factory = RealDictCursor if dict_cursor else None
            cursor = conn.cursor(cursor_factory=cursor_factory)
            try:
                yield cursor, conn
            finally:
                cursor.close()

    def close(self):
        """Close all database connections in the pool."""
        if self._pool is not None:
            self._pool.closeall()
            self._pool = None
            logger.info("Database connection pool closed")

    def find_by_checksum(self, checksum: str) -> Optional[DocumentRecord]:
        """
        Find existing document by checksum.

        Args:
            checksum: SHA-256 checksum to search for

        Returns:
            DocumentRecord if found, None otherwise
        """
        try:
            with self._get_cursor(dict_cursor=True) as (cursor, conn):
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
        try:
            with self._get_cursor(dict_cursor=True) as (cursor, conn):
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
        # Check for duplicate by checksum (outside of transaction)
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

        with self._get_cursor() as (cursor, conn):
            try:
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
        has_vector = self.has_vector_support()

        with self._get_cursor() as (cursor, conn):
            try:
                if embedding and has_vector:
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
        Save multiple chunks with embeddings in batch using optimized batch INSERT.

        Args:
            document_id: Parent document ID.
            chunks: List of chunk dicts with keys: chunk_index, page, section_title, text, char_len
            embeddings: Optional list of embedding vectors (same length as chunks).

        Returns:
            List of chunk IDs.
        """
        if not chunks:
            return []

        has_vector = self.has_vector_support()

        with self._get_cursor() as (cursor, conn):
            try:
                chunk_ids = []

                if embeddings and has_vector:
                    # Batch INSERT with embeddings using execute_values for better performance
                    from psycopg2.extras import execute_values

                    # Prepare data for batch insert
                    values = []
                    for i, chunk in enumerate(chunks):
                        embedding = embeddings[i] if i < len(embeddings) else None
                        embedding_str = "[" + ",".join(str(x) for x in embedding) + "]" if embedding else None
                        values.append((
                            document_id,
                            chunk.get("chunk_index", i),
                            chunk.get("page"),
                            chunk.get("section_title"),
                            chunk.get("text", ""),
                            chunk.get("char_len", len(chunk.get("text", ""))),
                            embedding_str,
                        ))

                    # Use execute_values for efficient batch insert
                    result = execute_values(
                        cursor,
                        """
                        INSERT INTO chunks (document_id, chunk_index, page, section_title, text, char_len, embedding)
                        VALUES %s
                        RETURNING id
                        """,
                        values,
                        template="(%s, %s, %s, %s, %s, %s, %s::vector)",
                        fetch=True,
                    )
                    chunk_ids = [row[0] for row in result]
                else:
                    # Batch INSERT without embeddings
                    from psycopg2.extras import execute_values

                    values = []
                    for i, chunk in enumerate(chunks):
                        values.append((
                            document_id,
                            chunk.get("chunk_index", i),
                            chunk.get("page"),
                            chunk.get("section_title"),
                            chunk.get("text", ""),
                            chunk.get("char_len", len(chunk.get("text", ""))),
                        ))

                    result = execute_values(
                        cursor,
                        """
                        INSERT INTO chunks (document_id, chunk_index, page, section_title, text, char_len)
                        VALUES %s
                        RETURNING id
                        """,
                        values,
                        fetch=True,
                    )
                    chunk_ids = [row[0] for row in result]

                conn.commit()
                logger.info(f"Batch saved {len(chunk_ids)} chunks for document {document_id}")
                return chunk_ids

            except Exception as e:
                conn.rollback()
                logger.error(f"Failed to batch save chunks: {e}")
                raise

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
        try:
            keywords = self._extract_keywords(query)
            logger.info(f"Full-text search: query='{query}', keywords={keywords}")

            # Build ILIKE conditions for each keyword
            ilike_conditions = " OR ".join(["c.text ILIKE %s" for _ in keywords])
            ilike_params = [f'%{kw}%' for kw in keywords]

            # Fetch more results for re-ranking
            fetch_limit = limit * 3

            with self._get_cursor(dict_cursor=True) as (cursor, conn):
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
        """Check if pgvector extension is available (cached)."""
        # Return cached result if available
        if self._vector_support_cached is not None:
            return self._vector_support_cached

        try:
            with self._get_cursor() as (cursor, conn):
                cursor.execute("SELECT 1 FROM pg_extension WHERE extname = 'vector'")
                self._vector_support_cached = cursor.fetchone() is not None
                if self._vector_support_cached:
                    logger.info("pgvector extension is available")
                else:
                    logger.info("pgvector extension is NOT available, using full-text search fallback")
                return self._vector_support_cached
        except Exception as e:
            logger.warning(f"Failed to check pgvector support: {e}")
            self._vector_support_cached = False
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

        try:
            embedding_str = "[" + ",".join(str(x) for x in query_embedding) + "]"

            with self._get_cursor(dict_cursor=True) as (cursor, conn):
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
        with self._get_cursor(dict_cursor=True) as (cursor, conn):
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
        with self._get_cursor(dict_cursor=True) as (cursor, conn):
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
        with self._get_cursor(dict_cursor=True) as (cursor, conn):
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
        with self._get_cursor() as (cursor, conn):
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

    # ============================================================
    # History Tables (Q&A + Slides + Templates)
    # ============================================================

    _history_tables_ready: bool = False

    def ensure_history_tables(self) -> bool:
        """Create history/slide/template tables if they don't exist (auto-migration)."""
        if DatabaseService._history_tables_ready:
            return True

        try:
            with self._get_cursor() as (cursor, conn):
                cursor.execute("""
                    CREATE TABLE IF NOT EXISTS qa_conversations (
                        id SERIAL PRIMARY KEY,
                        question TEXT NOT NULL,
                        answer TEXT NOT NULL,
                        sources JSONB DEFAULT '[]',
                        confidence DECIMAL(3,2),
                        has_answer BOOLEAN DEFAULT TRUE,
                        search_time DECIMAL(6,2),
                        mode VARCHAR(20),
                        from_cache BOOLEAN DEFAULT FALSE,
                        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                    )
                """)
                cursor.execute("""
                    CREATE INDEX IF NOT EXISTS idx_qa_conv_created ON qa_conversations(created_at DESC)
                """)
                cursor.execute("""
                    CREATE TABLE IF NOT EXISTS slide_decks (
                        id SERIAL PRIMARY KEY,
                        title TEXT NOT NULL,
                        question TEXT,
                        answer TEXT,
                        plan_md TEXT,
                        style_options JSONB DEFAULT '{}',
                        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                    )
                """)
                cursor.execute("""
                    CREATE INDEX IF NOT EXISTS idx_slide_decks_created ON slide_decks(created_at DESC)
                """)
                cursor.execute("""
                    CREATE TABLE IF NOT EXISTS slide_pages (
                        id SERIAL PRIMARY KEY,
                        deck_id INTEGER REFERENCES slide_decks(id) ON DELETE CASCADE,
                        slide_index INTEGER NOT NULL,
                        title TEXT,
                        slide_type VARCHAR(20) DEFAULT 'content',
                        html TEXT NOT NULL,
                        plan_text TEXT,
                        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                    )
                """)
                cursor.execute("""
                    CREATE INDEX IF NOT EXISTS idx_slide_pages_deck ON slide_pages(deck_id)
                """)
                cursor.execute("""
                    CREATE TABLE IF NOT EXISTS slide_templates (
                        id SERIAL PRIMARY KEY,
                        name VARCHAR(200) NOT NULL,
                        position VARCHAR(20) NOT NULL,
                        html TEXT NOT NULL,
                        header_color VARCHAR(20),
                        footer_color VARCHAR(20),
                        metadata JSONB DEFAULT '{}',
                        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                        UNIQUE(name, position)
                    )
                """)
                # Auto-migration: add metadata column for existing tables
                try:
                    cursor.execute("""
                        ALTER TABLE slide_templates
                        ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'
                    """)
                except Exception:
                    pass  # Column already exists or unsupported
                conn.commit()

                DatabaseService._history_tables_ready = True
                logger.info("History tables ready (qa_conversations, slide_decks, slide_pages, slide_templates)")
                return True

        except Exception as e:
            logger.error(f"Failed to ensure history tables: {e}")
            return False

    # ---- Q&A History CRUD ----

    def save_qa_conversation(
        self,
        question: str,
        answer: str,
        sources: list | None = None,
        confidence: float | None = None,
        has_answer: bool = True,
        search_time: float | None = None,
        mode: str | None = None,
        from_cache: bool = False,
    ) -> int:
        """Save a Q&A conversation and return its id."""
        import json
        if not self.ensure_history_tables():
            raise RuntimeError("History tables not available")

        sources_json = json.dumps(sources or [], ensure_ascii=False)

        with self._get_cursor() as (cursor, conn):
            try:
                cursor.execute(
                    """
                    INSERT INTO qa_conversations
                        (question, answer, sources, confidence, has_answer, search_time, mode, from_cache)
                    VALUES (%s, %s, %s::jsonb, %s, %s, %s, %s, %s)
                    RETURNING id
                    """,
                    (question, answer, sources_json, confidence, has_answer, search_time, mode, from_cache),
                )
                qa_id = cursor.fetchone()[0]
                conn.commit()
                logger.info(f"Saved QA conversation id={qa_id}")
                return qa_id
            except Exception as e:
                conn.rollback()
                logger.error(f"Failed to save QA conversation: {e}")
                raise

    def get_qa_history(self, limit: int = 50, offset: int = 0) -> list[dict]:
        """Get Q&A history list, newest first."""
        if not self.ensure_history_tables():
            return []
        with self._get_cursor(dict_cursor=True) as (cursor, conn):
            cursor.execute(
                """
                SELECT id, question, LEFT(answer, 200) as answer_preview,
                       confidence, has_answer, mode, from_cache, created_at
                FROM qa_conversations
                ORDER BY created_at DESC
                LIMIT %s OFFSET %s
                """,
                (limit, offset),
            )
            return [
                {**dict(row), "created_at": str(row["created_at"])}
                for row in cursor.fetchall()
            ]

    def get_qa_detail(self, qa_id: int) -> dict | None:
        """Get full Q&A conversation by id."""
        import json as json_mod
        if not self.ensure_history_tables():
            return None
        with self._get_cursor(dict_cursor=True) as (cursor, conn):
            cursor.execute("SELECT * FROM qa_conversations WHERE id = %s", (qa_id,))
            row = cursor.fetchone()
            if not row:
                return None
            result = dict(row)
            result["created_at"] = str(result["created_at"])
            if isinstance(result.get("sources"), str):
                result["sources"] = json_mod.loads(result["sources"])
            return result

    def rename_qa_conversation(self, qa_id: int, new_question: str) -> None:
        """Rename (update question text) of a Q&A conversation."""
        with self._get_cursor() as (cursor, conn):
            try:
                cursor.execute(
                    "UPDATE qa_conversations SET question = %s WHERE id = %s",
                    (new_question, qa_id),
                )
                conn.commit()
                logger.info(f"Renamed QA conversation id={qa_id}")
            except Exception as e:
                conn.rollback()
                logger.error(f"Failed to rename QA conversation: {e}")
                raise

    def delete_qa_conversation(self, qa_id: int) -> None:
        """Delete a Q&A conversation by id."""
        with self._get_cursor() as (cursor, conn):
            try:
                cursor.execute("DELETE FROM qa_conversations WHERE id = %s", (qa_id,))
                conn.commit()
                logger.info(f"Deleted QA conversation id={qa_id}")
            except Exception as e:
                conn.rollback()
                logger.error(f"Failed to delete QA conversation: {e}")
                raise

    # ---- Slide Deck CRUD ----

    def save_slide_deck(
        self,
        title: str,
        question: str | None,
        answer: str | None,
        plan_md: str | None,
        style_options: dict | None,
        slides: list[dict],
    ) -> int:
        """Save a slide deck with all pages and return the deck id."""
        import json
        if not self.ensure_history_tables():
            raise RuntimeError("History tables not available")

        style_json = json.dumps(style_options or {}, ensure_ascii=False)

        with self._get_cursor() as (cursor, conn):
            try:
                cursor.execute(
                    """
                    INSERT INTO slide_decks (title, question, answer, plan_md, style_options)
                    VALUES (%s, %s, %s, %s, %s::jsonb)
                    RETURNING id
                    """,
                    (title, question, answer, plan_md, style_json),
                )
                deck_id = cursor.fetchone()[0]

                for slide in slides:
                    cursor.execute(
                        """
                        INSERT INTO slide_pages (deck_id, slide_index, title, slide_type, html, plan_text)
                        VALUES (%s, %s, %s, %s, %s, %s)
                        """,
                        (
                            deck_id,
                            slide.get("slide_index", 0),
                            slide.get("title"),
                            slide.get("slide_type", "content"),
                            slide.get("html", ""),
                            slide.get("plan_text"),
                        ),
                    )

                conn.commit()
                logger.info(f"Saved slide deck id={deck_id} with {len(slides)} pages")
                return deck_id
            except Exception as e:
                conn.rollback()
                logger.error(f"Failed to save slide deck: {e}")
                raise

    def update_slide_deck(
        self,
        deck_id: int,
        slides: list[dict],
        style_options: dict | None = None,
    ) -> None:
        """Update an existing slide deck's pages and optional style_options."""
        import json
        if not self.ensure_history_tables():
            raise RuntimeError("History tables not available")

        with self._get_cursor() as (cursor, conn):
            try:
                if style_options is not None:
                    style_json = json.dumps(style_options, ensure_ascii=False)
                    cursor.execute(
                        "UPDATE slide_decks SET style_options = %s::jsonb, updated_at = CURRENT_TIMESTAMP WHERE id = %s",
                        (style_json, deck_id),
                    )
                else:
                    cursor.execute(
                        "UPDATE slide_decks SET updated_at = CURRENT_TIMESTAMP WHERE id = %s",
                        (deck_id,),
                    )

                # Replace all pages
                cursor.execute("DELETE FROM slide_pages WHERE deck_id = %s", (deck_id,))
                for slide in slides:
                    cursor.execute(
                        """
                        INSERT INTO slide_pages (deck_id, slide_index, title, slide_type, html, plan_text)
                        VALUES (%s, %s, %s, %s, %s, %s)
                        """,
                        (
                            deck_id,
                            slide.get("slide_index", 0),
                            slide.get("title"),
                            slide.get("slide_type", "content"),
                            slide.get("html", ""),
                            slide.get("plan_text"),
                        ),
                    )

                conn.commit()
                logger.info(f"Updated slide deck id={deck_id} with {len(slides)} pages")
            except Exception as e:
                conn.rollback()
                logger.error(f"Failed to update slide deck: {e}")
                raise

    def get_slide_history(self, limit: int = 50, offset: int = 0) -> list[dict]:
        """Get slide deck history list with slide counts."""
        if not self.ensure_history_tables():
            return []
        with self._get_cursor(dict_cursor=True) as (cursor, conn):
            cursor.execute(
                """
                SELECT d.id, d.title, d.question, d.style_options, d.created_at, d.updated_at,
                       COUNT(p.id) as slide_count
                FROM slide_decks d
                LEFT JOIN slide_pages p ON p.deck_id = d.id
                GROUP BY d.id
                ORDER BY d.updated_at DESC
                LIMIT %s OFFSET %s
                """,
                (limit, offset),
            )
            return [
                {**dict(row), "created_at": str(row["created_at"]), "updated_at": str(row["updated_at"])}
                for row in cursor.fetchall()
            ]

    def get_slide_deck_detail(self, deck_id: int) -> dict | None:
        """Get a full slide deck with all pages."""
        import json as json_mod
        if not self.ensure_history_tables():
            return None
        with self._get_cursor(dict_cursor=True) as (cursor, conn):
            cursor.execute("SELECT * FROM slide_decks WHERE id = %s", (deck_id,))
            deck_row = cursor.fetchone()
            if not deck_row:
                return None

            result = dict(deck_row)
            result["created_at"] = str(result["created_at"])
            result["updated_at"] = str(result["updated_at"])
            if isinstance(result.get("style_options"), str):
                result["style_options"] = json_mod.loads(result["style_options"])

            cursor.execute(
                "SELECT slide_index, title, slide_type, html, plan_text FROM slide_pages WHERE deck_id = %s ORDER BY slide_index",
                (deck_id,),
            )
            result["slides"] = [dict(r) for r in cursor.fetchall()]
            return result

    def rename_slide_deck(self, deck_id: int, new_title: str) -> None:
        """Rename a slide deck title."""
        with self._get_cursor() as (cursor, conn):
            try:
                cursor.execute(
                    "UPDATE slide_decks SET title = %s, updated_at = CURRENT_TIMESTAMP WHERE id = %s",
                    (new_title, deck_id),
                )
                conn.commit()
                logger.info(f"Renamed slide deck id={deck_id}")
            except Exception as e:
                conn.rollback()
                logger.error(f"Failed to rename slide deck: {e}")
                raise

    def delete_slide_deck(self, deck_id: int) -> None:
        """Delete a slide deck and its pages (CASCADE)."""
        with self._get_cursor() as (cursor, conn):
            try:
                cursor.execute("DELETE FROM slide_decks WHERE id = %s", (deck_id,))
                conn.commit()
                logger.info(f"Deleted slide deck id={deck_id}")
            except Exception as e:
                conn.rollback()
                logger.error(f"Failed to delete slide deck: {e}")
                raise

    # ---- Slide Template CRUD ----

    def save_slide_template(
        self,
        name: str,
        position: str,
        html: str,
        header_color: str | None = None,
        footer_color: str | None = None,
        metadata: dict | None = None,
    ) -> int:
        """Save or update a slide template (UPSERT by name+position)."""
        import json as _json
        if not self.ensure_history_tables():
            raise RuntimeError("History tables not available")

        metadata_json = _json.dumps(metadata, ensure_ascii=False) if metadata else None

        with self._get_cursor() as (cursor, conn):
            try:
                cursor.execute(
                    """
                    INSERT INTO slide_templates (name, position, html, header_color, footer_color, metadata)
                    VALUES (%s, %s, %s, %s, %s, COALESCE(%s, '{}')::jsonb)
                    ON CONFLICT (name, position) DO UPDATE SET
                        html = EXCLUDED.html,
                        header_color = EXCLUDED.header_color,
                        footer_color = EXCLUDED.footer_color,
                        metadata = EXCLUDED.metadata
                    RETURNING id
                    """,
                    (name, position, html, header_color, footer_color, metadata_json),
                )
                template_id = cursor.fetchone()[0]
                conn.commit()
                logger.info(f"Saved slide template id={template_id} ({name}/{position})")
                return template_id
            except Exception as e:
                conn.rollback()
                logger.error(f"Failed to save slide template: {e}")
                raise

    def get_slide_templates(self) -> list[dict]:
        """Get all slide templates."""
        if not self.ensure_history_tables():
            return []
        with self._get_cursor(dict_cursor=True) as (cursor, conn):
            cursor.execute("SELECT * FROM slide_templates ORDER BY position, name")
            return [
                {**dict(row), "created_at": str(row["created_at"])}
                for row in cursor.fetchall()
            ]

    def get_slide_template_by_position(self, position: str) -> dict | None:
        """Get a slide template by position (first/middle/last)."""
        if not self.ensure_history_tables():
            return None
        with self._get_cursor(dict_cursor=True) as (cursor, conn):
            cursor.execute(
                "SELECT * FROM slide_templates WHERE position = %s ORDER BY created_at DESC LIMIT 1",
                (position,),
            )
            row = cursor.fetchone()
            if row:
                result = dict(row)
                result["created_at"] = str(result["created_at"])
                return result
            return None

    def delete_slide_template(self, template_id: int) -> None:
        """Delete a slide template by id."""
        with self._get_cursor() as (cursor, conn):
            try:
                cursor.execute("DELETE FROM slide_templates WHERE id = %s", (template_id,))
                conn.commit()
                logger.info(f"Deleted slide template id={template_id}")
            except Exception as e:
                conn.rollback()
                logger.error(f"Failed to delete slide template: {e}")
                raise

    # ============================================================
    # Query Cache Methods
    # ============================================================

    _cache_table_ready: bool = False

    def ensure_cache_table(self) -> bool:
        """
        Create query_cache table if it doesn't exist (auto-migration).
        Called once on startup. Safe to call multiple times.

        Returns:
            True if table is ready, False otherwise.
        """
        if DatabaseService._cache_table_ready:
            return True

        try:
            with self._get_cursor() as (cursor, conn):
                # Create table
                cursor.execute("""
                    CREATE TABLE IF NOT EXISTS query_cache (
                        id SERIAL PRIMARY KEY,
                        mode VARCHAR(20) NOT NULL DEFAULT 'standard',
                        question TEXT NOT NULL,
                        answer TEXT NOT NULL,
                        sources JSONB DEFAULT '[]'::jsonb,
                        confidence DECIMAL(3,2),
                        has_answer BOOLEAN DEFAULT TRUE,
                        search_time DECIMAL(6,2),
                        intent VARCHAR(50),
                        search_mode VARCHAR(50),
                        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                    )
                """)
                conn.commit()

                # Add embedding column if pgvector is available
                if self.has_vector_support():
                    try:
                        cursor.execute(
                            "ALTER TABLE query_cache ADD COLUMN question_embedding vector(768)"
                        )
                        conn.commit()
                    except Exception:
                        conn.rollback()  # Column already exists

                    try:
                        cursor.execute("""
                            CREATE INDEX IF NOT EXISTS idx_query_cache_embedding
                                ON query_cache USING hnsw (question_embedding vector_cosine_ops)
                        """)
                        conn.commit()
                    except Exception:
                        conn.rollback()

                # Verify table exists
                cursor.execute(
                    "SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'query_cache')"
                )
                exists = cursor.fetchone()[0]

                if exists:
                    DatabaseService._cache_table_ready = True
                    logger.info("Query cache table ready")
                    return True
                else:
                    logger.error("Query cache table creation failed (table not found after CREATE)")
                    return False

        except Exception as e:
            logger.error(f"Failed to ensure query_cache table: {e}")
            return False

    def get_cached_response(
        self,
        question_embedding: list[float],
        mode: str = "standard",
        threshold: float = 0.80,
    ) -> Optional[dict]:
        """
        Search query_cache for a similar question using cosine similarity.

        Args:
            question_embedding: Embedding vector of the new question.
            mode: Search mode (fast/standard/accurate).
            threshold: Minimum cosine similarity to consider a cache hit.

        Returns:
            Cached response dict if found, None otherwise.
        """
        if not self.has_vector_support():
            return None
        if not self.ensure_cache_table():
            return None

        try:
            embedding_str = "[" + ",".join(str(x) for x in question_embedding) + "]"

            with self._get_cursor(dict_cursor=True) as (cursor, conn):
                cursor.execute(
                    """
                    SELECT *,
                           1 - (question_embedding <=> %s::vector) AS similarity
                    FROM query_cache
                    WHERE mode = %s
                      AND question_embedding IS NOT NULL
                      AND 1 - (question_embedding <=> %s::vector) >= %s
                    ORDER BY question_embedding <=> %s::vector
                    LIMIT 1
                    """,
                    (embedding_str, mode, embedding_str, threshold, embedding_str),
                )
                row = cursor.fetchone()

                if row:
                    import json
                    sources = row.get("sources", [])
                    if isinstance(sources, str):
                        sources = json.loads(sources)

                    logger.info(
                        f"Cache HIT: similarity={row['similarity']:.3f}, "
                        f"question='{row['question'][:50]}...'"
                    )
                    return {
                        "question": row["question"],
                        "answer": row["answer"],
                        "sources": sources,
                        "confidence": float(row["confidence"]) if row.get("confidence") else 0.0,
                        "has_answer": row.get("has_answer", True),
                        "search_time": float(row["search_time"]) if row.get("search_time") else 0.0,
                        "intent": row.get("intent"),
                        "search_mode": row.get("search_mode"),
                        "similarity": float(row["similarity"]),
                    }

            return None

        except Exception as e:
            import traceback
            logger.error(f"Cache lookup FAILED: {e}\n{traceback.format_exc()}")
            return None

    def save_cached_response(
        self,
        question: str,
        question_embedding: Optional[list[float]],
        mode: str,
        answer: str,
        sources: list,
        confidence: Optional[float] = None,
        has_answer: bool = True,
        search_time: Optional[float] = None,
        intent: Optional[str] = None,
        search_mode: Optional[str] = None,
    ) -> bool:
        """
        Save a query response to the cache.

        Returns:
            True if saved successfully, False otherwise.
        """
        if not self.ensure_cache_table():
            return False

        try:
            import json
            sources_json = json.dumps(sources, ensure_ascii=False)

            has_vector = self.has_vector_support()
            embedding_str = None
            if question_embedding and has_vector:
                embedding_str = "[" + ",".join(str(x) for x in question_embedding) + "]"

            with self._get_cursor() as (cursor, conn):
                if embedding_str:
                    cursor.execute(
                        """
                        INSERT INTO query_cache
                            (mode, question, question_embedding, answer, sources,
                             confidence, has_answer, search_time, intent, search_mode)
                        VALUES (%s, %s, %s::vector, %s, %s::jsonb, %s, %s, %s, %s, %s)
                        """,
                        (mode, question, embedding_str, answer, sources_json,
                         confidence, has_answer, search_time, intent, search_mode),
                    )
                else:
                    cursor.execute(
                        """
                        INSERT INTO query_cache
                            (mode, question, answer, sources,
                             confidence, has_answer, search_time, intent, search_mode)
                        VALUES (%s, %s, %s, %s::jsonb, %s, %s, %s, %s, %s)
                        """,
                        (mode, question, answer, sources_json,
                         confidence, has_answer, search_time, intent, search_mode),
                    )
                conn.commit()
                logger.info(f"Cache SAVE: mode={mode}, question='{question[:50]}...'")
                return True

        except Exception as e:
            import traceback
            logger.error(f"Cache save FAILED: {e}\n{traceback.format_exc()}")
            return False

    def clear_query_cache(self) -> int:
        """
        Clear all entries from the query cache (TRUNCATE).

        Returns:
            0 on success (TRUNCATE doesn't return row count).
        """
        if not self.ensure_cache_table():
            return -1

        try:
            with self._get_cursor() as (cursor, conn):
                cursor.execute("TRUNCATE TABLE query_cache")
                conn.commit()
                logger.info("Query cache cleared (TRUNCATE)")
                return 0
        except Exception as e:
            logger.warning(f"Cache clear failed (non-fatal): {e}")
            return -1

    def get_stats(self) -> dict:
        """Get database statistics using a single optimized query."""
        with self._get_cursor(dict_cursor=True) as (cursor, conn):
            # Use a single query with subqueries for better performance
            cursor.execute("""
                SELECT
                    (SELECT COUNT(*) FROM documents) as doc_count,
                    (SELECT COUNT(*) FROM chunks) as chunk_count,
                    (SELECT COUNT(*) FROM chunks WHERE embedding IS NOT NULL) as embedded_count
            """)
            row = cursor.fetchone()

            return {
                "documents": row["doc_count"],
                "chunks": row["chunk_count"],
                "chunks_with_embeddings": row["embedded_count"],
            }


# Global instance
_db_service: Optional[DatabaseService] = None


def get_database_service() -> DatabaseService:
    """Get or create the global database service instance."""
    global _db_service
    if _db_service is None:
        _db_service = DatabaseService()
    return _db_service
