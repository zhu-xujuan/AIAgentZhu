"""
AIAgent API Server
Provides endpoints for Dify integration.
Supports LLM-enhanced processing via Ollama with rule-based fallback.
"""

import os
import sys
import logging
import re
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Optional, List
from fastapi import FastAPI, UploadFile, File, HTTPException, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
import httpx

# Configuration from environment
MAX_FILE_SIZE_MB = int(os.getenv("MAX_FILE_SIZE_MB", "50"))  # Default 50MB
MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024
CORS_ORIGINS = os.getenv("CORS_ORIGINS", "http://localhost:3000,http://127.0.0.1:3000").split(",")
EMBEDDING_WARMUP_ENABLED = os.getenv("EMBEDDING_WARMUP_ENABLED", "true").lower() == "true"

# Image generation (optional)
IMAGE_GEN_ENABLED = os.getenv("IMAGE_GEN_ENABLED", "false").lower() == "true"
IMAGE_GEN_PROVIDER = os.getenv("IMAGE_GEN_PROVIDER", "openai")
IMAGE_GEN_API_KEY = os.getenv("IMAGE_GEN_API_KEY") or os.getenv("AI_API_KEY", "")
IMAGE_GEN_BASE_URL = os.getenv("IMAGE_GEN_BASE_URL", "https://api.openai.com/v1")
IMAGE_GEN_MODEL = os.getenv("IMAGE_GEN_MODEL", "gpt-image-1")
IMAGE_GEN_SIZE = os.getenv("IMAGE_GEN_SIZE", "1024x1024")
IMAGE_GEN_QUALITY = os.getenv("IMAGE_GEN_QUALITY", "medium")
IMAGE_GEN_MAX_PER_DECK = int(os.getenv("IMAGE_GEN_MAX_PER_DECK", "6"))
IMAGE_GEN_TIMEOUT = int(os.getenv("IMAGE_GEN_TIMEOUT", "60"))

# Add parent directory to path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from dotenv import load_dotenv
ENV_LOCAL_PATH = Path(__file__).resolve().parents[1] / ".env.local"
load_dotenv()
load_dotenv(ENV_LOCAL_PATH, override=True)

from src.storage.local_storage import LocalStorage
from src.storage.database import DatabaseService, get_database_service
from src.storage.pdf_parser import (
    extract_text_from_pdf,
    extract_text_from_pdf_with_ocr,
    is_valid_pdf,
)
from src.agents.document_classifier import classify_document, classify_document_async
from src.agents.chunking_agent import chunk_document
from src.agents.fact_extractor import extract_facts, extract_facts_async
from src.agents.quality_guardian import check_quality, check_quality_async
from src.agents.sql_query_agent import parse_question, parse_question_async
from src.agents.answer_formatter import format_facts, format_facts_async
from src.agents.qa_agent import answer_question
from src.agents.intent_router import IntentRouter, router_response_to_dict
from src.agents.slide_agent import (
    SLIDE_SYSTEM_PROMPT,
    build_generate_slide_prompt,
    build_refine_slide_prompt,
    format_slide_sources_for_prompt,
    normalize_slide_deck,
    retrieve_sources_for_slides,
)
from src.llm.ai_client import AIClient
from src.llm.config import get_llm_config, LLMConfig, AIProvider

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Global instances
ai_client: Optional[AIClient] = None
llm_config: Optional[LLMConfig] = None
db_service: Optional[DatabaseService] = None
ocr_client: Optional[AIClient] = None  # Dedicated client for OCR when AI_OCR_BASE_URL is set

# Alias for backwards compatibility
ollama_client: Optional[AIClient] = None


def _get_env_local_path() -> Path:
    backend_root = Path(__file__).resolve().parents[1]
    return backend_root / ".env.local"


def _upsert_env_value(env_path: Path, key: str, value: str) -> None:
    lines: List[str] = []
    if env_path.exists():
        lines = env_path.read_text(encoding="utf-8").splitlines()

    key_pattern = re.compile(rf"^\s*{re.escape(key)}\s*=")
    updated = False
    for idx, line in enumerate(lines):
        if key_pattern.match(line):
            lines[idx] = f"{key}={value}"
            updated = True
            break

    if not updated:
        lines.append(f"{key}={value}")

    env_path.write_text("\n".join(lines) + "\n", encoding="utf-8")


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan manager for startup/shutdown."""
    global ai_client, ollama_client, llm_config, db_service, ocr_client

    import time

    # Startup
    startup_start = time.time()
    llm_config = get_llm_config()

    if llm_config.enabled:
        ai_client = AIClient(
            base_url=llm_config.base_url,
            model=llm_config.model,
            embedding_model=llm_config.embedding_model,
            timeout=llm_config.timeout,
            max_retries=llm_config.max_retries,
            provider=llm_config.provider,
            api_key=llm_config.api_key,
            max_concurrent_embeddings=llm_config.max_concurrent_embeddings,
        )
        ollama_client = ai_client  # Backwards compatibility
        logger.info(f"AIClient initialized: {ai_client}")

        # OCR client: use main client when provider is Ollama and ocr_model set;
        # otherwise use dedicated Ollama client when AI_OCR_BASE_URL + AI_OCR_MODEL are set
        ocr_model = getattr(llm_config, "ocr_model", None)
        ocr_base_url = getattr(llm_config, "ocr_base_url", None)
        if ocr_model and llm_config.provider == AIProvider.OLLAMA:
            ocr_client = ai_client
            logger.info(f"OCR enabled (main client): model={ocr_model}")
        elif ocr_model and ocr_base_url:
            ocr_client = AIClient(
                base_url=ocr_base_url,
                model=ocr_model,
                embedding_model=llm_config.embedding_model,
                timeout=max(llm_config.timeout, 120.0),
                max_retries=llm_config.max_retries,
                provider=AIProvider.OLLAMA,
                api_key=None,
                max_concurrent_embeddings=1,
            )
            logger.info(f"OCR enabled (dedicated client): base_url={ocr_base_url}, model={ocr_model}")
        else:
            ocr_client = None

        # Check health on startup
        health = await ai_client.health_check()
        if health.available:
            logger.info(f"AI service connected ({health.provider}). Available models: {health.models}")

            # Warmup embedding model to avoid cold start delays
            if EMBEDDING_WARMUP_ENABLED:
                logger.info("Warming up embedding model...")
                warmup_start = time.time()
                try:
                    warmup_result = await ai_client.embed("warmup test")
                    if warmup_result.success:
                        logger.info(f"Embedding model warmed up successfully in {time.time() - warmup_start:.2f}s")
                    else:
                        logger.warning(f"Embedding warmup failed: {warmup_result.error}")
                except Exception as e:
                    logger.warning(f"Embedding warmup error: {e}")
        else:
            logger.warning(f"AI service not available: {health.error}")
    else:
        logger.info("LLM is disabled via configuration")

    # Initialize database service
    try:
        db_service = get_database_service()
        if db_service:
            stats = db_service.get_stats()
            logger.info(f"Database connected. Stats: {stats}")

            # Check and log pgvector support status
            if db_service.has_vector_support():
                logger.info("pgvector extension is available - vector search enabled")
            else:
                logger.warning("pgvector extension NOT available - using full-text search fallback")

            # Ensure query cache table exists (auto-migration)
            if db_service.ensure_cache_table():
                logger.info("Query cache (CAG) is ACTIVE - similar questions will be served from cache")
            else:
                logger.warning("Query cache (CAG) is INACTIVE - cache table could not be created")
        else:
            logger.warning("Database service not available. QA features will be disabled.")
    except Exception as e:
        logger.warning(f"Failed to connect to database: {e}. QA features will be disabled.")
        db_service = None

    logger.info(f"Startup completed in {time.time() - startup_start:.2f}s")

    yield

    # Shutdown
    if ai_client:
        await ai_client.close()
        logger.info("AIClient closed")
    if ocr_client and ocr_client is not ai_client:
        await ocr_client.close()
        logger.info("OCR client closed")

    if db_service:
        db_service.close()
        logger.info("Database connection closed")

app = FastAPI(
    title="AIAgent API",
    description="Multi-Agent RAG System API for Dify integration with LLM support",
    version="1.1.0",
    lifespan=lifespan,
)

# CORS設定 (configurable via CORS_ORIGINS environment variable)
app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type", "Authorization", "Accept"],
)
logger.info(f"CORS configured for origins: {CORS_ORIGINS}")

# Storage instance - use project root data directory
storage = LocalStorage("../data/uploads")
logger.info(f"[STARTUP] Storage initialized: base_path={storage.base_path}, metadata_dir={storage.metadata_dir}")


# ============================================================
# Request/Response Models
# ============================================================

class ClassifyRequest(BaseModel):
    file_name: str
    file_type: str
    raw_text: str


class ChunkRequest(BaseModel):
    pages: List[dict]


class LLMConfigUpdate(BaseModel):
    base_url: str
    persist: bool = True
    provider: Optional[str] = None


class ExtractRequest(BaseModel):
    doc_type: str
    chunks: List[dict]


class QualityCheckRequest(BaseModel):
    facts: List[dict]
    parse_meta: Optional[dict] = None


class QueryRequest(BaseModel):
    question: str
    mode: Optional[str] = "standard"  # "fast", "standard", "accurate"
    skip_cache: Optional[bool] = False  # True to force re-search


class SlideDeckGenerateRequest(BaseModel):
    question: str
    answer: Optional[str] = None
    mode: Optional[str] = "standard"  # "fast", "standard", "accurate"
    max_slides: Optional[int] = 8
    top_k: Optional[int] = None


class SlideDeckRefineRequest(BaseModel):
    question: str
    instruction: str
    deck: dict
    mode: Optional[str] = "standard"
    max_slides: Optional[int] = 8
    top_k: Optional[int] = None


class SlideImageRequest(BaseModel):
    prompt: str


class FormatRequest(BaseModel):
    facts: List[dict]
    query: Optional[str] = None


# ============================================================
# Health Check & Debug
# ============================================================

@app.get("/debug/cache")
async def debug_cache():
    """Debug endpoint to inspect query cache status and contents."""
    result = {
        "db_service_exists": db_service is not None,
        "vector_support": False,
        "cache_table_exists": False,
        "cache_table_ready_flag": False,
        "row_count": 0,
        "recent_entries": [],
        "test_insert": None,
        "errors": [],
    }

    if not db_service:
        result["errors"].append("db_service is None")
        return result

    try:
        result["vector_support"] = db_service.has_vector_support()
        from src.storage.database import DatabaseService
        result["cache_table_ready_flag"] = DatabaseService._cache_table_ready
    except Exception as e:
        result["errors"].append(f"vector check: {e}")

    # Check if table exists
    try:
        with db_service._get_cursor(dict_cursor=True) as (cursor, conn):
            cursor.execute(
                "SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'query_cache')"
            )
            result["cache_table_exists"] = cursor.fetchone()["exists"]
    except Exception as e:
        result["errors"].append(f"table check: {e}")

    if not result["cache_table_exists"]:
        # Try to create it
        try:
            created = db_service.ensure_cache_table()
            result["ensure_cache_table_result"] = created
        except Exception as e:
            result["errors"].append(f"ensure_cache_table: {e}")
        return result

    # Count rows
    try:
        with db_service._get_cursor(dict_cursor=True) as (cursor, conn):
            cursor.execute("SELECT COUNT(*) as cnt FROM query_cache")
            result["row_count"] = cursor.fetchone()["cnt"]
    except Exception as e:
        result["errors"].append(f"count: {e}")

    # Check columns
    try:
        with db_service._get_cursor(dict_cursor=True) as (cursor, conn):
            cursor.execute("""
                SELECT column_name, data_type
                FROM information_schema.columns
                WHERE table_name = 'query_cache'
                ORDER BY ordinal_position
            """)
            result["columns"] = [
                {"name": r["column_name"], "type": r["data_type"]}
                for r in cursor.fetchall()
            ]
    except Exception as e:
        result["errors"].append(f"columns: {e}")

    # Recent entries (without full answer)
    try:
        with db_service._get_cursor(dict_cursor=True) as (cursor, conn):
            cursor.execute("""
                SELECT id, mode, question, LEFT(answer, 80) as answer_preview,
                       confidence, has_answer, search_time, intent, search_mode,
                       created_at,
                       question_embedding IS NOT NULL as has_embedding
                FROM query_cache
                ORDER BY created_at DESC
                LIMIT 5
            """)
            result["recent_entries"] = [
                {**dict(row), "created_at": str(row["created_at"])}
                for row in cursor.fetchall()
            ]
    except Exception as e:
        result["errors"].append(f"recent entries: {e}")

    # Test: try embedding + save + lookup cycle
    if ollama_client and result["vector_support"]:
        try:
            test_q = "__cache_debug_test__"
            embed_result = await ollama_client.embed(test_q)
            result["test_embed_success"] = embed_result.success
            result["test_embed_dim"] = len(embed_result.embedding) if embed_result.success else 0

            if embed_result.success:
                # Save
                save_ok = db_service.save_cached_response(
                    question=test_q,
                    question_embedding=embed_result.embedding,
                    mode="debug",
                    answer="debug_answer",
                    sources=[],
                    confidence=1.0,
                    has_answer=True,
                    search_time=0.0,
                    intent="debug",
                    search_mode="debug",
                )
                result["test_save"] = save_ok

                # Lookup
                cached = db_service.get_cached_response(embed_result.embedding, "debug")
                result["test_lookup"] = cached is not None
                if cached:
                    result["test_lookup_similarity"] = cached.get("similarity")

                # Cleanup
                with db_service._get_cursor() as (cursor, conn):
                    cursor.execute("DELETE FROM query_cache WHERE question = %s", (test_q,))
                    conn.commit()
                result["test_cleanup"] = True
        except Exception as e:
            result["errors"].append(f"test cycle: {e}")
            import traceback
            result["test_traceback"] = traceback.format_exc()

    return result


@app.delete("/debug/cache")
async def clear_cache():
    """Clear all entries from the query cache."""
    if not db_service:
        return {"success": False, "error": "db_service is None"}
    try:
        result = db_service.clear_query_cache()
        return {"success": result == 0, "message": "Cache cleared"}
    except Exception as e:
        return {"success": False, "error": str(e)}


@app.get("/debug/database")
async def debug_database():
    """Debug endpoint to test database connection."""
    import psycopg2
    result = {
        "db_service_exists": db_service is not None,
        "env_host": os.getenv("POSTGRES_HOST", "not set"),
        "env_port": os.getenv("POSTGRES_PORT", "not set"),
        "env_db": os.getenv("POSTGRES_DB", "not set"),
        "env_user": os.getenv("POSTGRES_USER", "not set"),
        "direct_connection": None,
        "db_service_connection": None,
    }

    # Test direct connection
    try:
        conn = psycopg2.connect(
            host=os.getenv("POSTGRES_HOST", "localhost"),
            port=int(os.getenv("POSTGRES_PORT", "5432")),
            database=os.getenv("POSTGRES_DB", "aiagent"),
            user=os.getenv("POSTGRES_USER", "postgres"),
            password=os.getenv("POSTGRES_PASSWORD", ""),
            connect_timeout=3,
        )
        cursor = conn.cursor()
        try:
            cursor.execute("SELECT 1")
            result["direct_connection"] = "success"
        finally:
            cursor.close()
            conn.close()
    except Exception as e:
        result["direct_connection"] = f"failed: {str(e)}"

    # Test via db_service
    if db_service:
        try:
            stats = db_service.get_stats()
            result["db_service_connection"] = f"success: {stats}"
        except Exception as e:
            result["db_service_connection"] = f"failed: {str(e)}"

        # Cache diagnostics
        try:
            from src.storage.database import DatabaseService
            result["cache"] = {
                "table_ready_flag": DatabaseService._cache_table_ready,
                "vector_support": db_service.has_vector_support(),
            }
            with db_service._get_cursor(dict_cursor=True) as (cursor, conn):
                cursor.execute(
                    "SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'query_cache')"
                )
                result["cache"]["table_exists"] = cursor.fetchone()["exists"]
            if result["cache"]["table_exists"]:
                with db_service._get_cursor(dict_cursor=True) as (cursor, conn):
                    cursor.execute("SELECT COUNT(*) as cnt FROM query_cache")
                    result["cache"]["row_count"] = cursor.fetchone()["cnt"]
        except Exception as e:
            result["cache"] = {"error": str(e)}
    else:
        result["db_service_connection"] = "db_service is None"

    return result


@app.get("/debug/storage")
async def debug_storage():
    """Debug endpoint to check storage status."""
    import os
    try:
        base_path = str(storage.base_path)
        files_dir = str(storage.files_dir)
        metadata_dir = str(storage.metadata_dir)
        cwd = os.getcwd()

        # Check if directories exist
        base_exists = storage.base_path.exists()
        files_exists = storage.files_dir.exists()
        metadata_exists = storage.metadata_dir.exists()

        # List metadata files
        metadata_files = []
        if metadata_exists:
            for date_dir in storage.metadata_dir.iterdir():
                if date_dir.is_dir():
                    for f in date_dir.iterdir():
                        if f.suffix == '.json':
                            metadata_files.append(str(f.name))

        # Try to list files
        files = []
        try:
            file_list = storage.list_files(limit=20)
            files = [{"name": f.original_name, "id": f.file_id} for f in file_list]
        except Exception as e:
            files = [{"error": str(e)}]

        return {
            "cwd": cwd,
            "base_path": base_path,
            "base_exists": base_exists,
            "files_dir": files_dir,
            "files_exists": files_exists,
            "metadata_dir": metadata_dir,
            "metadata_exists": metadata_exists,
            "metadata_file_count": len(metadata_files),
            "metadata_files_sample": metadata_files[:5],
            "files_from_list": files,
            "files_count": len(files),
        }
    except Exception as e:
        logger.error(f"Debug storage error: {e}", exc_info=True)
        return {"error": str(e)}


@app.get("/config/llm")
async def get_llm_settings():
    """Get current LLM configuration."""
    config = llm_config or get_llm_config()
    return {
        "enabled": config.enabled,
        "provider": config.provider.value,
        "base_url": config.base_url,
        "model": config.model,
        "embedding_model": config.embedding_model,
    }


@app.put("/config/llm")
async def update_llm_settings(payload: LLMConfigUpdate):
    """Update LLM base URL and attempt hot reload."""
    global ai_client, ollama_client, llm_config

    base_url = payload.base_url.strip()
    if not base_url:
        raise HTTPException(status_code=400, detail="base_url is required")

    applied = False
    error: Optional[str] = None
    config = llm_config or get_llm_config()
    next_provider = config.provider
    if payload.provider:
        try:
            next_provider = AIProvider(payload.provider.strip().lower())
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid provider value")

    if config.enabled:
        new_client = AIClient(
            base_url=base_url,
            model=config.model,
            embedding_model=config.embedding_model,
            timeout=config.timeout,
            max_retries=config.max_retries,
            provider=next_provider,
            api_key=config.api_key,
            max_concurrent_embeddings=config.max_concurrent_embeddings,
        )
        try:
            health = await new_client.health_check()
            if health.available:
                if ai_client:
                    await ai_client.close()
                ai_client = new_client
                ollama_client = new_client
                config.base_url = base_url
                config.provider = next_provider
                os.environ["AI_BASE_URL"] = base_url
                os.environ["AI_PROVIDER"] = next_provider.value
                applied = True
            else:
                error = health.error or "LLM service not available"
                await new_client.close()
        except Exception as e:
            error = str(e)
            await new_client.close()
    else:
        error = "LLM is disabled"

    if payload.persist:
        try:
            _upsert_env_value(_get_env_local_path(), "AI_BASE_URL", base_url)
            if payload.provider:
                _upsert_env_value(_get_env_local_path(), "AI_PROVIDER", next_provider.value)
        except Exception as e:
            logger.warning(f"Failed to persist AI_BASE_URL: {e}")

    if llm_config:
        llm_config.base_url = base_url
        if payload.provider:
            llm_config.provider = next_provider

    return {
        "base_url": base_url,
        "provider": next_provider.value,
        "applied": applied,
        "persisted": payload.persist,
        "message": "Applied to current process" if applied else "Saved for next startup",
        "error": error,
    }


@app.get("/health")
async def health_check():
    """Health check endpoint with Ollama and database status."""
    result = {
        "status": "healthy",
        "service": "aiagent-api",
        "llm": {
            "enabled": llm_config.enabled if llm_config else False,
            "available": False,
            "model": llm_config.model if llm_config else None,
        },
        "database": {
            "available": False,
            "stats": None,
        },
        "qa_ready": False,
    }

    if ollama_client and llm_config and llm_config.enabled:
        health = await ollama_client.health_check()
        result["llm"]["available"] = health.available
        result["llm"]["models"] = health.models
        if health.error:
            result["llm"]["error"] = health.error

    if db_service:
        try:
            stats = db_service.get_stats()
            result["database"]["available"] = True
            result["database"]["stats"] = stats
        except Exception as e:
            result["database"]["error"] = str(e)

    # QA is ready if both LLM and database are available
    result["qa_ready"] = (
        result["llm"]["available"] and
        result["database"]["available"] and
        result["database"]["stats"] and
        result["database"]["stats"].get("chunks_with_embeddings", 0) > 0
    )

    # Cache status (for debugging)
    result["cache"] = {"code_version": "2024-02-05-v2"}
    if db_service:
        try:
            from src.storage.database import DatabaseService
            result["cache"]["table_ready"] = DatabaseService._cache_table_ready
            result["cache"]["vector_support"] = db_service.has_vector_support()
            with db_service._get_cursor(dict_cursor=True) as (cursor, conn):
                cursor.execute("SELECT COUNT(*) as cnt FROM query_cache")
                result["cache"]["row_count"] = cursor.fetchone()["cnt"]
        except Exception as e:
            result["cache"]["error"] = str(e)

    return result


# ============================================================
# File Upload
# ============================================================

@app.post("/upload")
async def upload_file(file: UploadFile = File(...)):
    """
    Upload a file to local storage.
    Returns file_id and metadata.
    """
    # Check file size before reading (if available)
    if file.size and file.size > MAX_FILE_SIZE_BYTES:
        raise HTTPException(
            status_code=413,
            detail=f"File too large: {file.size / (1024*1024):.1f}MB. Maximum allowed: {MAX_FILE_SIZE_MB}MB"
        )

    content = await file.read()

    # Validate file size after reading
    if len(content) > MAX_FILE_SIZE_BYTES:
        raise HTTPException(
            status_code=413,
            detail=f"File too large: {len(content) / (1024*1024):.1f}MB. Maximum allowed: {MAX_FILE_SIZE_MB}MB"
        )

    result = storage.upload(file.filename, content, file.content_type)

    if not result.success:
        raise HTTPException(status_code=500, detail=result.message)

    return result.to_dict()


@app.get("/files/{file_id}")
async def get_file_metadata(file_id: str):
    """Get file metadata by ID."""
    metadata = storage.get_metadata(file_id)
    if not metadata:
        raise HTTPException(status_code=404, detail="File not found")
    return metadata.to_dict()


@app.get("/documents")
async def list_documents(limit: int = 100, offset: int = 0):
    """
    Get list of all uploaded documents.
    Returns document metadata including file type and classification.
    Falls back to storage-based list when database is not available.
    """
    if not db_service:
        # When database is not available, return files from storage
        logger.info(f"Database not available, returning files from storage (base_path: {storage.base_path})")
        try:
            files = storage.list_files(limit=limit, offset=offset)
            logger.info(f"Found {len(files)} files in storage")
            return {
                "documents": [
                    {
                        "id": idx,  # Use index as temporary ID
                        "file_id": file.file_id,
                        "file_name": file.original_name,
                        "file_type": file.file_type,
                        "doc_type": None,  # Not available without database
                        "language": None,
                        "owner_company": None,
                        "doc_date": None,
                        "confidence": None,
                        "upload_time": file.upload_time,
                        "size_bytes": file.size_bytes,
                    }
                    for idx, file in enumerate(files)
                ],
                "total": len(files),
                "database_available": False,
            }
        except Exception as e:
            logger.error(f"Failed to fetch files from storage: {e}", exc_info=True)
            return {
                "documents": [],
                "total": 0,
                "database_available": False,
                "error": str(e),
            }

    try:
        documents = db_service.get_all_documents(limit=limit, offset=offset)

        return {
            "documents": [
                {
                    "id": doc.id,
                    "file_id": doc.file_id,
                    "file_name": doc.file_name,
                    "file_type": doc.file_type,
                    "doc_type": doc.doc_type,
                    "language": doc.language,
                    "owner_company": doc.owner_company,
                    "doc_date": str(doc.doc_date) if doc.doc_date else None,
                    "confidence": doc.confidence,
                }
                for doc in documents
            ],
            "total": len(documents),
            "database_available": True,
        }
    except Exception as e:
        logger.error(f"Failed to fetch documents from database: {e}")
        # Fallback to storage
        logger.info("Falling back to storage-based file list")
        try:
            files = storage.list_files(limit=limit, offset=offset)
            return {
                "documents": [
                    {
                        "id": idx,
                        "file_id": file.file_id,
                        "file_name": file.original_name,
                        "file_type": file.file_type,
                        "doc_type": None,
                        "language": None,
                        "owner_company": None,
                        "doc_date": None,
                        "confidence": None,
                        "upload_time": file.upload_time,
                        "size_bytes": file.size_bytes,
                    }
                    for idx, file in enumerate(files)
                ],
                "total": len(files),
                "database_available": False,
                "error": str(e),
            }
        except Exception as storage_error:
            logger.error(f"Storage fallback also failed: {storage_error}")
            return {
                "documents": [],
                "total": 0,
                "database_available": False,
                "error": f"Database error: {str(e)}, Storage error: {str(storage_error)}",
            }


@app.get("/documents/{document_id}")
async def get_document_detail(document_id: int):
    """
    Get document detail including content (chunks).
    Returns document metadata and all text chunks.
    """
    if not db_service:
        raise HTTPException(
            status_code=503,
            detail="Database service is not available"
        )

    doc = db_service.get_document_by_id(document_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")

    chunks = db_service.get_chunks_by_document_id(document_id)

    return {
        "id": doc.id,
        "file_id": doc.file_id,
        "file_name": doc.file_name,
        "file_type": doc.file_type,
        "doc_type": doc.doc_type,
        "language": doc.language,
        "owner_company": doc.owner_company,
        "doc_date": str(doc.doc_date) if doc.doc_date else None,
        "confidence": doc.confidence,
        "chunks": [
            {
                "index": chunk.chunk_index,
                "page": chunk.page,
                "section_title": chunk.section_title,
                "text": chunk.text,
                "char_len": chunk.char_len,
            }
            for chunk in chunks
        ],
        "total_chunks": len(chunks),
    }


@app.delete("/files/{file_id}")
async def delete_file_by_id(file_id: str):
    """
    Delete a file from storage and database (if available).
    Works even when database is disabled.

    Args:
        file_id: File identifier from storage

    Returns:
        Success status and message
    """
    try:
        # Delete from database if available
        db_deleted = False
        doc_name = None

        if db_service:
            try:
                doc = db_service.get_document_by_file_id(file_id)
                if doc:
                    doc_name = doc.file_name
                    db_deleted = db_service.delete_document(file_id)
                    logger.info(f"Deleted from database: {file_id}")
            except Exception as e:
                logger.warning(f"Failed to delete from database: {e}")

        # Delete from storage
        storage_deleted = storage.delete(file_id)

        if not storage_deleted and not db_deleted:
            raise HTTPException(status_code=404, detail="File not found")

        # Invalidate query cache when a file is deleted
        if db_deleted and db_service:
            try:
                db_service.clear_query_cache()
                logger.info(f"Query cache cleared after file deletion: {file_id}")
            except Exception as cache_err:
                logger.warning(f"Failed to clear query cache: {cache_err}")

        message = f"File '{doc_name or file_id}' deleted successfully"
        if db_deleted and storage_deleted:
            message += " (from both database and storage)"
        elif db_deleted:
            message += " (from database only)"
        elif storage_deleted:
            message += " (from storage only)"

        logger.info(f"Deleted file: {file_id}")
        return {
            "success": True,
            "message": message,
            "file_id": file_id,
            "deleted_from_database": db_deleted,
            "deleted_from_storage": storage_deleted
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to delete file {file_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.delete("/documents/{document_id}")
async def delete_document(document_id: int):
    """
    Delete a document and all related data (chunks, embeddings).
    Returns success status.
    """
    if not db_service:
        raise HTTPException(
            status_code=503,
            detail="Database service is not available"
        )

    # Get document to verify it exists and get file_id
    doc = db_service.get_document_by_id(document_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")

    # Delete from database
    try:
        deleted = db_service.delete_document(doc.file_id)
        if not deleted:
            raise HTTPException(status_code=500, detail="Failed to delete document")

        # Delete file from storage using file_id
        storage_deleted = storage.delete(doc.file_id)
        if storage_deleted:
            logger.info(f"Deleted file from storage: {doc.file_id}")
        else:
            logger.warning(f"File not found in storage: {doc.file_id}")

        # Invalidate query cache when a document is deleted
        if db_service:
            try:
                db_service.clear_query_cache()
                logger.info(f"Query cache cleared after document deletion: {document_id}")
            except Exception as cache_err:
                logger.warning(f"Failed to clear query cache: {cache_err}")

        logger.info(f"Deleted document {document_id} ({doc.file_name})")
        return {
            "success": True,
            "message": f"Document '{doc.file_name}' deleted successfully",
            "document_id": document_id,
            "deleted_from_storage": storage_deleted
        }

    except Exception as e:
        logger.error(f"Failed to delete document {document_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ============================================================
# Agent Endpoints (for Dify HTTP Request nodes)
# ============================================================

def _should_use_llm(agent_name: str) -> bool:
    """Check if LLM should be used for a specific agent."""
    if not llm_config or not llm_config.enabled:
        return False
    if not ollama_client:
        return False
    return llm_config.is_agent_enabled(agent_name)


@app.post("/agents/classify")
async def classify(request: ClassifyRequest):
    """
    Step 1: Document Classification (LLM-enhanced)
    """
    use_llm = _should_use_llm("document_classifier")
    result = await classify_document_async(
        request.file_name,
        request.file_type,
        request.raw_text,
        ollama_client=ollama_client if use_llm else None,
        use_llm=use_llm,
    )
    return result


@app.post("/agents/chunk")
async def chunk(request: ChunkRequest):
    """
    Step 2: Chunking (rule-based only)
    """
    result = chunk_document(request.pages)
    return result


@app.post("/agents/extract")
async def extract(request: ExtractRequest):
    """
    Step 3: Fact Extraction (LLM-enhanced)
    """
    use_llm = _should_use_llm("fact_extractor")
    result = await extract_facts_async(
        request.doc_type,
        request.chunks,
        ollama_client=ollama_client if use_llm else None,
        use_llm=use_llm,
    )
    return result


@app.post("/agents/quality-check")
async def quality_check(request: QualityCheckRequest):
    """
    Step 4: Quality Check (LLM-enhanced)
    """
    use_llm = _should_use_llm("quality_guardian")
    result = await check_quality_async(
        request.facts,
        request.parse_meta,
        ollama_client=ollama_client if use_llm else None,
        use_llm=use_llm,
    )
    return result


@app.post("/agents/parse-query")
async def parse_query(request: QueryRequest):
    """
    Step 5: SQL Query Generation (LLM-enhanced)
    """
    use_llm = _should_use_llm("sql_query")
    result = await parse_question_async(
        request.question,
        ollama_client=ollama_client if use_llm else None,
        use_llm=use_llm,
    )
    return result


@app.post("/agents/format-answer")
async def format_answer(request: FormatRequest):
    """
    Step 6: Answer Formatting (LLM-enhanced)
    """
    use_llm = _should_use_llm("answer_formatter")
    result = await format_facts_async(
        request.facts,
        request.query,
        ollama_client=ollama_client if use_llm else None,
        use_llm=use_llm,
    )
    return result


# ============================================================
# Pipeline Endpoint (Full flow)
# ============================================================

@app.post("/pipeline/ingest")
async def ingest_document(file: UploadFile = File(...)):
    """
    Full ingestion pipeline: Upload → Classify → Chunk → Embed → Store → Extract → Quality Check
    LLM-enhanced processing with rule-based fallback.
    Now stores documents in PostgreSQL with vector embeddings for search.
    """
    import time
    start_time = time.time()
    logger.info(f"[INGEST] Starting ingestion for file: {file.filename}")

    # Validate file type - allow text-based files and PDFs
    ALLOWED_EXTENSIONS = {".txt", ".csv", ".json", ".md", ".pdf"}
    ALLOWED_CONTENT_TYPES = {
        "text/plain",
        "text/csv",
        "application/json",
        "text/markdown",
        "application/pdf",
        "application/octet-stream",  # Generic, will check extension
    }

    file_ext = Path(file.filename).suffix.lower()
    content_type = file.content_type or ""

    # Check file extension
    if file_ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported file type: {file_ext}. Allowed types: {', '.join(ALLOWED_EXTENSIONS)}"
        )

    # Check content type (if provided and not generic)
    if content_type and content_type not in ALLOWED_CONTENT_TYPES and not content_type.startswith("text/"):
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported content type: {content_type}. Only text-based files are supported."
        )

    # Check file size before reading (if available)
    if file.size and file.size > MAX_FILE_SIZE_BYTES:
        raise HTTPException(
            status_code=413,
            detail=f"File too large: {file.size / (1024*1024):.1f}MB. Maximum allowed: {MAX_FILE_SIZE_MB}MB"
        )

    # Upload
    step_start = time.time()
    content = await file.read()

    # Validate file size after reading (in case size wasn't available)
    if len(content) > MAX_FILE_SIZE_BYTES:
        raise HTTPException(
            status_code=413,
            detail=f"File too large: {len(content) / (1024*1024):.1f}MB. Maximum allowed: {MAX_FILE_SIZE_MB}MB"
        )

    logger.info(f"[INGEST] File read: {len(content)} bytes, took {time.time() - step_start:.2f}s")

    step_start = time.time()
    upload_result = storage.upload(file.filename, content, file.content_type)
    logger.info(f"[INGEST] Upload completed, took {time.time() - step_start:.2f}s")

    if not upload_result.success:
        raise HTTPException(status_code=500, detail=upload_result.message)

    # Check for duplicate file (already exists in storage)
    if upload_result.is_duplicate:
        logger.info(f"Duplicate file detected in storage: {file.filename}")
        # Try to get existing document info from database
        existing_doc = None
        if db_service and upload_result.metadata:
            existing_doc = db_service.find_by_checksum(upload_result.metadata.checksum)

        return {
            "file_id": upload_result.file_id,
            "document_id": existing_doc.id if existing_doc else None,
            "is_duplicate": True,
            "message": upload_result.message,
            "classification": {
                "doc_type": existing_doc.doc_type if existing_doc else None,
                "owner_company": existing_doc.owner_company if existing_doc else None,
                "language": existing_doc.language if existing_doc else None,
            } if existing_doc else None,
            "chunks_count": 0,
            "embeddings_count": 0,
            "facts_count": 0,
            "quality": None,
            "llm_used": False,
            "stored_in_db": existing_doc is not None,
        }

    # Read text - handle PDF and text files
    raw_text = ""
    pages = []
    parse_meta_ocr_used = False

    if file_ext == ".pdf":
        # Extract text from PDF (with optional OCR for pages that have no text)
        try:
            if ocr_client and llm_config and getattr(llm_config, "ocr_model", None):
                pages, parse_meta_ocr_used = await extract_text_from_pdf_with_ocr(
                    content, ocr_client, llm_config.ocr_model
                )
                if parse_meta_ocr_used:
                    logger.info("[INGEST] OCR was used for some PDF pages")
            else:
                pages = extract_text_from_pdf(content)
            # Combine all page texts for classification
            raw_text = "\n\n".join([p["text"] for p in pages])
            logger.info(f"Extracted {len(pages)} pages from PDF")
        except Exception as e:
            logger.error(f"Failed to extract PDF text: {e}")
            raise HTTPException(
                status_code=400,
                detail=f"Failed to extract text from PDF: {str(e)}"
            )
    else:
        # Extract text from text-based files
        try:
            raw_text = content.decode('utf-8')
            pages = [{"page": 1, "text": raw_text}]
        except UnicodeDecodeError:
            raw_text = ""
            pages = [{"page": 1, "text": ""}]

    # Step 1: Classify (LLM-enhanced)
    step_start = time.time()
    use_llm_classify = _should_use_llm("document_classifier")
    logger.info(f"[INGEST] Step 1: Starting classification (use_llm={use_llm_classify})")
    classification = await classify_document_async(
        file.filename,
        file.content_type or "",
        raw_text[:3000],  # Classify using first 3000 chars
        ollama_client=ollama_client if use_llm_classify else None,
        use_llm=use_llm_classify,
    )
    logger.info(f"[INGEST] Step 1 completed: doc_type={classification.get('doc_type')}, took {time.time() - step_start:.2f}s")

    # Step 2: Chunk (rule-based only) - use extracted pages
    step_start = time.time()
    logger.info(f"[INGEST] Step 2: Starting chunking")
    chunks = chunk_document(pages)
    logger.info(f"[INGEST] Step 2 completed: {len(chunks['chunks'])} chunks, took {time.time() - step_start:.2f}s")

    # Step 3: Generate embeddings for chunks (parallel processing)
    step_start = time.time()
    embeddings = []
    if ollama_client and db_service:
        chunk_texts = [chunk["text"] for chunk in chunks["chunks"]]
        logger.info(f"[INGEST] Step 3: Generating embeddings for {len(chunk_texts)} chunks (parallel, max_concurrent={ollama_client.max_concurrent_embeddings})...")

        embed_results = await ollama_client.embed_batch(chunk_texts)

        for i, embed_result in enumerate(embed_results):
            if embed_result.success:
                embeddings.append(embed_result.embedding)
            else:
                embeddings.append(None)
                logger.warning(f"Failed to embed chunk {chunks['chunks'][i]['chunk_index']}: {embed_result.error}")
        logger.info(f"[INGEST] Step 3 completed: {len([e for e in embeddings if e])}/{len(embeddings)} embeddings, took {time.time() - step_start:.2f}s")
    else:
        logger.info(f"[INGEST] Step 3 skipped: LLM or DB not available")

    # Step 4: Save to database
    step_start = time.time()
    doc_id = None
    is_duplicate = False
    if db_service:
        logger.info(f"[INGEST] Step 4: Saving to database")
        try:
            # Get checksum from upload result
            checksum = upload_result.metadata.checksum if upload_result.metadata else None

            # Save document (with duplicate check)
            doc_id, is_duplicate = db_service.save_document(
                file_id=upload_result.file_id,
                file_name=file.filename,
                file_type=file.content_type,
                doc_type=classification.get("doc_type"),
                owner_company=classification.get("owner_company"),
                doc_date=classification.get("doc_date"),
                language=classification.get("language"),
                confidence=classification.get("confidence"),
                storage_path=upload_result.metadata.storage_path if upload_result.metadata else None,
                checksum=checksum,
            )

            if is_duplicate:
                logger.info(f"[INGEST] Duplicate document detected: {file.filename} (existing doc_id={doc_id})")
            else:
                # Save chunks with embeddings (only for new documents)
                chunk_data = [
                    {
                        "chunk_index": c["chunk_index"],
                        "page": c["page"],
                        "section_title": c.get("section_title"),
                        "text": c["text"],
                        "char_len": c["char_len"],
                    }
                    for c in chunks["chunks"]
                ]
                db_service.save_chunks_batch(
                    document_id=doc_id,
                    chunks=chunk_data,
                    embeddings=embeddings if embeddings else None,
                )
                logger.info(f"[INGEST] Step 4 completed: Saved document {file.filename} with {len(chunks['chunks'])} chunks, took {time.time() - step_start:.2f}s")

        except Exception as e:
            logger.error(f"[INGEST] Step 4 failed: {e}")
            # Continue without database - still return results
    else:
        logger.info(f"[INGEST] Step 4 skipped: Database not available")

    # Step 5: Extract (LLM-enhanced) - with timeout
    step_start = time.time()
    chunks_for_extraction = [
        {"text": c["text"], "page": c["page"], "index": c["chunk_index"]}
        for c in chunks["chunks"]
    ]
    use_llm_extract = _should_use_llm("fact_extractor")
    logger.info(f"[INGEST] Step 5: Starting fact extraction (use_llm={use_llm_extract}, chunks={len(chunks_for_extraction)})")

    # Set timeout for fact extraction (30 seconds max)
    import asyncio
    try:
        facts = await asyncio.wait_for(
            extract_facts_async(
                classification["doc_type"],
                chunks_for_extraction,
                ollama_client=ollama_client if use_llm_extract else None,
                use_llm=use_llm_extract,
                language=classification.get("language", "ja"),
            ),
            timeout=30.0  # 30 second timeout for entire extraction
        )
        logger.info(f"[INGEST] Step 5 completed: {len(facts['facts'])} facts extracted, took {time.time() - step_start:.2f}s")
    except asyncio.TimeoutError:
        logger.warning(f"[INGEST] Step 5 timeout: Fact extraction took too long (>30s), using empty facts")
        facts = {"facts": [], "llm_used": False}
    except Exception as e:
        logger.error(f"[INGEST] Step 5 failed: {e}")
        facts = {"facts": [], "llm_used": False}

    # Step 6: Quality Check (LLM-enhanced) - with timeout
    step_start = time.time()
    use_llm_quality = _should_use_llm("quality_guardian")
    logger.info(f"[INGEST] Step 6: Starting quality check (use_llm={use_llm_quality})")

    try:
        quality = await asyncio.wait_for(
            check_quality_async(
                facts["facts"],
                {"ocr_used": parse_meta_ocr_used, "chunk_count": len(chunks["chunks"])},
                ollama_client=ollama_client if use_llm_quality else None,
                use_llm=use_llm_quality,
                doc_type=classification["doc_type"],
            ),
            timeout=15.0  # 15 second timeout for quality check
        )
        logger.info(f"[INGEST] Step 6 completed: took {time.time() - step_start:.2f}s")
    except asyncio.TimeoutError:
        logger.warning(f"[INGEST] Step 6 timeout: Quality check took too long (>15s), using basic quality")
        quality = {"needs_review": False, "reasons": []}
    except Exception as e:
        logger.error(f"[INGEST] Step 6 failed: {e}")
        quality = {"needs_review": False, "reasons": []}

    # Invalidate query cache when new document is ingested
    if db_service and doc_id and not is_duplicate:
        try:
            db_service.clear_query_cache()
            logger.info("[INGEST] Query cache cleared after new document ingestion")
        except Exception as e:
            logger.warning(f"[INGEST] Failed to clear query cache: {e}")

    total_time = time.time() - start_time
    logger.info(f"[INGEST] Ingestion completed for {file.filename}: total_time={total_time:.2f}s, chunks={len(chunks['chunks'])}, facts={len(facts['facts'])}")

    return {
        "file_id": upload_result.file_id,
        "document_id": doc_id,
        "is_duplicate": is_duplicate,
        "classification": classification,
        "chunks_count": len(chunks["chunks"]),
        "embeddings_count": len([e for e in embeddings if e]) if embeddings else 0,
        "facts_count": len(facts["facts"]),
        "quality": quality,
        "llm_used": any([use_llm_classify, use_llm_extract, use_llm_quality]),
        "stored_in_db": doc_id is not None,
        "processing_time_seconds": round(total_time, 2),
    }


def _try_reconnect_database() -> bool:
    """Try to reconnect to database if not connected."""
    global db_service

    # If already connected, verify it still works
    if db_service:
        try:
            db_service.get_stats()
            return True
        except Exception:
            logger.warning("Existing database connection failed, attempting reconnect...")
            db_service = None

    # Create new connection
    try:
        db_service = DatabaseService()  # Create new instance directly
        stats = db_service.get_stats()
        logger.info(f"Database reconnected successfully. Stats: {stats}")
        return True
    except Exception as e:
        logger.warning(f"Database reconnection failed: {e}")
        db_service = None
    return False


@app.post("/pipeline/query")
async def query_documents(request: QueryRequest, background_tasks: BackgroundTasks):
    """
    Query pipeline with Intent Router:
    1. Classify question intent (rule-based → LLM fallback)
    2. Route to appropriate handler:
       - list_files: Return document list from DB
       - file_stats: Return statistics
       - search_content/general_qa: Use RAG (Vector Search → LLM)
    """
    import time
    query_start = time.time()
    mode = request.mode or "standard"
    logger.info(f"[QUERY] === Starting query (mode={mode}, skip_cache={request.skip_cache}): '{request.question[:50]}...' ===")

    # Try to reconnect to database if not connected
    if not _try_reconnect_database():
        logger.error("[QUERY] Database reconnection failed")
        raise HTTPException(
            status_code=503,
            detail="Database service is not available. Please check PostgreSQL connection."
        )
    logger.info(f"[QUERY] Database connected, elapsed: {time.time() - query_start:.2f}s")

    try:
        # Create Intent Router
        router = IntentRouter(db_service=db_service, ollama_client=ollama_client)
        logger.info(f"[QUERY] IntentRouter created, ollama_client={ollama_client is not None}")

        # Define QA handler for RAG-based queries
        async def qa_handler(question: str):
            """RAG handler using existing QA Agent"""
            qa_start = time.time()
            logger.info(f"[QUERY] QA handler called for: '{question[:50]}...'")

            if not ollama_client:
                logger.error("[QUERY] ollama_client is None")
                from src.agents.intent_router import RouterResponse
                return RouterResponse(
                    question=question,
                    answer="LLMサービスが利用できません。Ollamaの接続を確認してください。",
                    sources=[],
                    confidence=0.0,
                    has_answer=False,
                    search_mode="none",
                    intent="general_qa",
                    error="LLM service not available"
                )

            logger.info(f"[QUERY] Calling answer_question...")
            result = await answer_question(
                question=question,
                ollama_client=ollama_client,
                db_service=db_service,
                top_k=5,
                similarity_threshold=0.3,
                use_hybrid_search=True,
            )
            logger.info(f"[QUERY] answer_question completed in {time.time() - qa_start:.2f}s")
            logger.info(f"[QUERY] Result: has_answer={result.has_answer}, confidence={result.confidence}, error={result.error}")

            from src.agents.intent_router import RouterResponse
            return RouterResponse(
                question=question,
                answer=result.answer,
                sources=result.sources,
                confidence=result.confidence,
                has_answer=result.has_answer,
                search_mode="hybrid",
                intent="general_qa",
                error=result.error,
            )

        # Route the question
        response = await router.route(request.question, qa_handler=qa_handler)

        # Calculate search time
        search_time = time.time() - query_start
        response.search_time_seconds = round(search_time, 2)

        # Log the routing result
        logger.info(f"Query routed: intent={response.intent}, search_mode={response.search_mode}, search_time={search_time:.2f}s")

        result_dict = router_response_to_dict(response)
        result_dict["from_cache"] = False

        # --- Non-blocking cache save (background task, zero impact on response time) ---
        answer_text = result_dict.get("answer", "")
        is_not_found = "見つかりませんでした" in answer_text or "情報がありません" in answer_text
        if db_service and ollama_client and answer_text and not is_not_found:
            async def _bg_cache_save(q, m, answer, res_dict):
                try:
                    embed_result = await ollama_client.embed(q)
                    if embed_result.success:
                        db_service.save_cached_response(
                            question=q, question_embedding=embed_result.embedding,
                            mode=m, answer=answer,
                            sources=res_dict.get("sources", []),
                            confidence=res_dict.get("confidence"),
                            has_answer=res_dict.get("has_answer", False),
                            search_time=res_dict.get("search_time_seconds"),
                            intent=res_dict.get("intent"),
                            search_mode=res_dict.get("search_mode"),
                        )
                except Exception as e:
                    logger.warning(f"[QUERY] Background cache save failed: {e}")
            background_tasks.add_task(_bg_cache_save, request.question, mode, answer_text, result_dict)

        return result_dict

    except Exception as e:
        logger.error(f"Query failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/pipeline/chat/stream")
async def chat_stream(request: QueryRequest):
    """
    Streaming chat endpoint for real-time responses.
    Uses Server-Sent Events (SSE) format compatible with Vercel AI SDK.

    Modes:
    - fast: Skip query expansion, top_k=3 (fastest, ~70% accuracy)
    - standard: Query expansion, top_k=5 (balanced)
    - accurate: Query expansion, top_k=7 (highest accuracy)
    """
    import time
    import json
    from src.agents.qa_agent import (
        expand_query_with_llm,
        extract_search_keywords,
        deduplicate_results,
        format_context,
        QA_SYSTEM_PROMPT,
        QA_PROMPT_TEMPLATE,
    )

    query_start = time.time()
    question = request.question
    mode = request.mode or "standard"
    skip_cache = request.skip_cache or False

    # Mode configuration
    MODE_CONFIG = {
        "fast": {"use_expansion": False, "top_k": 3},
        "standard": {"use_expansion": True, "top_k": 5},
        "accurate": {"use_expansion": True, "top_k": 7},
    }
    config = MODE_CONFIG.get(mode, MODE_CONFIG["standard"])

    logger.info(f"[STREAM] === Starting streaming query (mode={mode}, skip_cache={skip_cache}): '{question[:50]}...' ===")

    async def generate_stream():
        """Generator for SSE streaming response."""
        try:
            # Check services
            if not db_service:
                yield f"data: {json.dumps({'error': 'Database not available'})}\n\n"
                return
            if not ollama_client:
                yield f"data: {json.dumps({'error': 'LLM not available'})}\n\n"
                return

            # Step 1: Generate embedding (needed for cache check AND search)
            step_start = time.time()
            embed_result = await ollama_client.embed(question)
            query_embedding = embed_result.embedding if embed_result.success else None
            logger.info(f"[STREAM] Embedding: {time.time() - step_start:.2f}s")

            # --- Cache check (before expansion — saves ~15s on cache HIT) ---
            if not skip_cache and query_embedding:
                cache_start = time.time()
                cached = db_service.get_cached_response(query_embedding, mode)
                cache_ms = round((time.time() - cache_start) * 1000)
                if cached:
                    logger.info(f"[STREAM] Cache HIT ({cache_ms}ms)")
                    yield f"data: {json.dumps({'type': 'sources', 'sources': cached['sources']})}\n\n"
                    yield f"data: {json.dumps({'type': 'text', 'text': cached['answer']})}\n\n"
                    search_time = round(time.time() - query_start, 2)
                    yield f"data: {json.dumps({'type': 'done', 'confidence': cached['confidence'], 'has_answer': cached['has_answer'], 'search_time': search_time, 'mode': mode, 'from_cache': True})}\n\n"
                    return
                logger.info(f"[STREAM] Cache MISS ({cache_ms}ms)")

            # Step 2: Query expansion (only on cache MISS, skip in fast mode)
            search_query = question
            if config["use_expansion"]:
                step_start = time.time()
                expanded_keywords = await expand_query_with_llm(question, ollama_client)
                search_query = question + " " + " ".join(expanded_keywords)
                logger.info(f"[STREAM] Query expansion: {time.time() - step_start:.2f}s")
            else:
                logger.info(f"[STREAM] Query expansion: SKIPPED (fast mode)")

            # Step 3: Search
            step_start = time.time()
            search_results = db_service.search_hybrid(
                query_text=search_query,
                query_embedding=query_embedding,
                limit=config["top_k"],
                similarity_threshold=0.3,
            )
            search_results = deduplicate_results(search_results)
            logger.info(f"[STREAM] Search: {time.time() - step_start:.2f}s, found {len(search_results)} results")

            # Prepare sources metadata
            sources = [
                {
                    "document_name": r.document.file_name,
                    "chunk_text": r.chunk.text[:200] + "..." if len(r.chunk.text) > 200 else r.chunk.text,
                    "similarity": round(r.similarity, 3),
                }
                for r in search_results
            ]

            # Send sources first
            yield f"data: {json.dumps({'type': 'sources', 'sources': sources})}\n\n"

            if not search_results:
                yield f"data: {json.dumps({'type': 'text', 'text': '文書内に該当する情報が見つかりませんでした。'})}\n\n"
                yield f"data: {json.dumps({'type': 'done', 'search_time': round(time.time() - query_start, 2), 'from_cache': False})}\n\n"
                return

            # Step 4: Format context and generate response
            context = format_context(search_results)
            prompt = QA_PROMPT_TEMPLATE.format(context=context, question=question)

            # Step 5: Stream LLM response
            logger.info(f"[STREAM] Starting LLM generation...")
            answer_parts = []
            async for chunk in ollama_client.generate_stream(
                prompt=prompt,
                system=QA_SYSTEM_PROMPT,
                temperature=0.3,
            ):
                answer_parts.append(chunk)
                yield f"data: {json.dumps({'type': 'text', 'text': chunk})}\n\n"

            # Calculate confidence
            top_similarity = search_results[0].similarity if search_results else 0
            avg_similarity = sum(r.similarity for r in search_results) / len(search_results) if search_results else 0
            confidence = round(min(1.0, (top_similarity * 0.6) + (avg_similarity * 0.4)), 2)

            search_time = round(time.time() - query_start, 2)

            # Send completion immediately (no blocking on cache save)
            yield f"data: {json.dumps({'type': 'done', 'confidence': confidence, 'has_answer': True, 'search_time': search_time, 'mode': mode, 'from_cache': False})}\n\n"
            logger.info(f"[STREAM] Completed in {search_time}s (mode={mode})")

            # --- Non-blocking cache save (background thread, zero impact on response time) ---
            accumulated_answer = "".join(answer_parts)
            is_not_found = "見つかりませんでした" in accumulated_answer or "情報がありません" in accumulated_answer
            if query_embedding and accumulated_answer and not is_not_found:
                import threading
                _db = db_service
                _args = dict(
                    question=question, question_embedding=query_embedding,
                    mode=mode, answer=accumulated_answer, sources=sources,
                    confidence=confidence, has_answer=True, search_time=search_time,
                    intent="general_qa", search_mode="hybrid",
                )
                threading.Thread(
                    target=lambda: _db.save_cached_response(**_args) if _db else None,
                    daemon=True,
                ).start()

        except Exception as e:
            logger.error(f"[STREAM] Error: {e}")
            yield f"data: {json.dumps({'type': 'error', 'error': str(e)})}\n\n"

    return StreamingResponse(
        generate_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


def _compact_prompt(text: str, max_chars: int = 400) -> str:
    text = re.sub(r"\s+", " ", (text or "").strip())
    return text[:max_chars]


def _build_image_prompt(slide: dict) -> str:
    custom = (slide.get("image_prompt") or "").strip()
    if custom:
        return _compact_prompt(custom)
    title = str(slide.get("title") or "").strip()
    bullets = slide.get("bullets") or []
    bullet_text = "; ".join([str(b).strip() for b in bullets if str(b).strip()][:6])
    base = f"{title}. {bullet_text}".strip(". ")
    style = "Abstract flat vector illustration, clean, minimal, soft colors, no text, no numbers, no logos."
    return _compact_prompt(f"{base}. {style}")


async def generate_image_data_url(prompt: str) -> Optional[str]:
    if not IMAGE_GEN_ENABLED:
        return None
    if IMAGE_GEN_PROVIDER != "openai":
        return None
    if not IMAGE_GEN_API_KEY:
        return None
    if not prompt.strip():
        return None

    payload = {
        "model": IMAGE_GEN_MODEL,
        "prompt": prompt,
        "size": IMAGE_GEN_SIZE,
        "response_format": "b64_json",
    }
    if IMAGE_GEN_QUALITY:
        payload["quality"] = IMAGE_GEN_QUALITY

    headers = {
        "Authorization": f"Bearer {IMAGE_GEN_API_KEY}",
        "Content-Type": "application/json",
    }
    url = IMAGE_GEN_BASE_URL.rstrip("/") + "/images/generations"

    try:
        async with httpx.AsyncClient(timeout=IMAGE_GEN_TIMEOUT) as client:
            res = await client.post(url, headers=headers, json=payload)
            if res.status_code >= 400:
                logger.warning(f"[IMAGE] Generation failed: {res.status_code} {res.text}")
                return None
            data = res.json()
            b64 = data.get("data", [{}])[0].get("b64_json")
            if not b64:
                return None
            return f"data:image/png;base64,{b64}"
    except Exception as e:
        logger.warning(f"[IMAGE] Generation error: {e}")
        return None


async def maybe_attach_generated_images(deck: dict) -> dict:
    if not IMAGE_GEN_ENABLED:
        return deck
    slides = deck.get("slides") or []
    if not isinstance(slides, list) or len(slides) == 0:
        return deck

    max_images = max(0, min(len(slides), IMAGE_GEN_MAX_PER_DECK))
    generated = 0
    for s in slides:
        if generated >= max_images:
            break
        if not isinstance(s, dict):
            continue
        if (s.get("image_url") or "").strip() or (s.get("image_data_url") or "").strip():
            continue
        prompt = _build_image_prompt(s)
        data_url = await generate_image_data_url(prompt)
        if data_url:
            s["image_data_url"] = data_url
            s["image_prompt"] = prompt
            generated += 1
    return deck


@app.post("/pipeline/slides/generate")
async def generate_slides(request: SlideDeckGenerateRequest):
    """
    Generate a slide deck grounded in retrieved document context.
    Returns JSON suitable for an in-app slide editor.
    """
    import time

    if not db_service:
        raise HTTPException(status_code=503, detail="Database not available")
    if not ollama_client:
        raise HTTPException(status_code=503, detail="LLM not available")

    started = time.time()
    question = request.question
    mode = request.mode or "standard"
    max_slides = int(request.max_slides or 8)
    max_slides = max(1, min(max_slides, 20))

    try:
        search_results = await retrieve_sources_for_slides(
            question=question,
            mode=mode,
            db_service=db_service,
            ai_client=ollama_client,
            top_k_override=request.top_k,
        )
        sources_for_prompt = format_slide_sources_for_prompt(search_results)

        prompt = build_generate_slide_prompt(
            question=question,
            answer=request.answer,
            sources=sources_for_prompt,
            max_slides=max_slides,
        )

        deck_raw, err = await ollama_client.generate_json(
            prompt=prompt,
            temperature=0.2,
            system=SLIDE_SYSTEM_PROMPT,
        )
        if err or deck_raw is None:
            raise RuntimeError(err or "Failed to generate slide deck JSON")

        deck = normalize_slide_deck(deck_raw)
        deck = await maybe_attach_generated_images(deck)

        return {
            "question": question,
            "deck": deck,
            "sources": sources_for_prompt,
            "mode": mode,
            "generation_time_seconds": round(time.time() - started, 2),
        }
    except Exception as e:
        logger.error(f"[SLIDES] Generate failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/pipeline/slides/refine")
async def refine_slides(request: SlideDeckRefineRequest):
    """
    Refine an existing slide deck using an instruction, grounded in documents.
    """
    import time

    if not db_service:
        raise HTTPException(status_code=503, detail="Database not available")
    if not ollama_client:
        raise HTTPException(status_code=503, detail="LLM not available")

    started = time.time()
    question = request.question
    mode = request.mode or "standard"
    max_slides = int(request.max_slides or 8)
    max_slides = max(1, min(max_slides, 20))

    try:
        search_results = await retrieve_sources_for_slides(
            question=question,
            mode=mode,
            db_service=db_service,
            ai_client=ollama_client,
            top_k_override=request.top_k,
        )
        sources_for_prompt = format_slide_sources_for_prompt(search_results)

        prompt = build_refine_slide_prompt(
            question=question,
            instruction=request.instruction,
            deck=request.deck,
            sources=sources_for_prompt,
            max_slides=max_slides,
        )

        deck_raw, err = await ollama_client.generate_json(
            prompt=prompt,
            temperature=0.2,
            system=SLIDE_SYSTEM_PROMPT,
        )
        if err or deck_raw is None:
            raise RuntimeError(err or "Failed to refine slide deck JSON")

        deck = normalize_slide_deck(deck_raw)
        deck = await maybe_attach_generated_images(deck)

        return {
            "question": question,
            "deck": deck,
            "sources": sources_for_prompt,
            "mode": mode,
            "generation_time_seconds": round(time.time() - started, 2),
        }
    except Exception as e:
        logger.error(f"[SLIDES] Refine failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/pipeline/slides/image")
async def generate_slide_image(request: SlideImageRequest):
    if not IMAGE_GEN_ENABLED:
        raise HTTPException(status_code=503, detail="Image generation is disabled")
    prompt = request.prompt.strip()
    if not prompt:
        raise HTTPException(status_code=400, detail="Prompt is required")
    data_url = await generate_image_data_url(prompt)
    if not data_url:
        raise HTTPException(status_code=500, detail="Image generation failed")
    return {"data_url": data_url}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
