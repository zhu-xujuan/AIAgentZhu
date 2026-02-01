"""
AIAgent API Server
Provides endpoints for Dify integration.
Supports LLM-enhanced processing via Ollama with rule-based fallback.
"""

import os
import sys
import logging
from contextlib import asynccontextmanager
from typing import Optional, List
from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

# Add parent directory to path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from dotenv import load_dotenv
load_dotenv()

from src.storage.local_storage import LocalStorage
from src.storage.database import DatabaseService, get_database_service
from src.agents.document_classifier import classify_document, classify_document_async
from src.agents.chunking_agent import chunk_document
from src.agents.fact_extractor import extract_facts, extract_facts_async
from src.agents.quality_guardian import check_quality, check_quality_async
from src.agents.sql_query_agent import parse_question, parse_question_async
from src.agents.answer_formatter import format_facts, format_facts_async
from src.agents.qa_agent import answer_question
from src.agents.intent_router import IntentRouter, router_response_to_dict
from src.llm.ai_client import AIClient
from src.llm.config import get_llm_config, LLMConfig

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Global instances
ai_client: Optional[AIClient] = None
llm_config: Optional[LLMConfig] = None
db_service: Optional[DatabaseService] = None

# Alias for backwards compatibility
ollama_client: Optional[AIClient] = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan manager for startup/shutdown."""
    global ai_client, ollama_client, llm_config, db_service

    # Startup
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

        # Check health on startup
        health = await ai_client.health_check()
        if health.available:
            logger.info(f"AI service connected ({health.provider}). Available models: {health.models}")
        else:
            logger.warning(f"AI service not available: {health.error}")
    else:
        logger.info("LLM is disabled via configuration")

    # Initialize database service
    try:
        db_service = get_database_service()
        stats = db_service.get_stats()
        logger.info(f"Database connected. Stats: {stats}")
    except Exception as e:
        logger.warning(f"Database not available: {e}. QA features will be disabled.")
        db_service = None

    yield

    # Shutdown
    if ai_client:
        await ai_client.close()
        logger.info("AIClient closed")

    if db_service:
        db_service.close()
        logger.info("Database connection closed")

app = FastAPI(
    title="AIAgent API",
    description="Multi-Agent RAG System API for Dify integration with LLM support",
    version="1.1.0",
    lifespan=lifespan,
)

# CORS設定
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Storage instance
storage = LocalStorage("./data/uploads")


# ============================================================
# Request/Response Models
# ============================================================

class ClassifyRequest(BaseModel):
    file_name: str
    file_type: str
    raw_text: str


class ChunkRequest(BaseModel):
    pages: List[dict]


class ExtractRequest(BaseModel):
    doc_type: str
    chunks: List[dict]


class QualityCheckRequest(BaseModel):
    facts: List[dict]
    parse_meta: Optional[dict] = None


class QueryRequest(BaseModel):
    question: str


class FormatRequest(BaseModel):
    facts: List[dict]
    query: Optional[str] = None


# ============================================================
# Health Check
# ============================================================

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
    content = await file.read()
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
    """
    if not db_service:
        raise HTTPException(
            status_code=503,
            detail="Database service is not available"
        )

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
    # Upload
    content = await file.read()
    upload_result = storage.upload(file.filename, content, file.content_type)

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

    # Read text (simplified - in production, use proper parser)
    try:
        raw_text = content.decode('utf-8')
    except UnicodeDecodeError:
        raw_text = ""

    # Step 1: Classify (LLM-enhanced)
    use_llm_classify = _should_use_llm("document_classifier")
    classification = await classify_document_async(
        file.filename,
        file.content_type or "",
        raw_text[:3000],  # Classify using first 3000 chars
        ollama_client=ollama_client if use_llm_classify else None,
        use_llm=use_llm_classify,
    )

    # Step 2: Chunk (rule-based only) - use full text
    pages = [{"page": 1, "text": raw_text}]
    chunks = chunk_document(pages)

    # Step 3: Generate embeddings for chunks (parallel processing)
    embeddings = []
    if ollama_client and db_service:
        chunk_texts = [chunk["text"] for chunk in chunks["chunks"]]
        logger.info(f"Generating embeddings for {len(chunk_texts)} chunks (parallel, max_concurrent={ollama_client.max_concurrent_embeddings})...")

        embed_results = await ollama_client.embed_batch(chunk_texts)

        for i, embed_result in enumerate(embed_results):
            if embed_result.success:
                embeddings.append(embed_result.embedding)
            else:
                embeddings.append(None)
                logger.warning(f"Failed to embed chunk {chunks['chunks'][i]['chunk_index']}: {embed_result.error}")

    # Step 4: Save to database
    doc_id = None
    is_duplicate = False
    if db_service:
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
                logger.info(f"Duplicate document detected: {file.filename} (existing doc_id={doc_id})")
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
                logger.info(f"Saved document {file.filename} with {len(chunks['chunks'])} chunks to database")

        except Exception as e:
            logger.error(f"Failed to save to database: {e}")
            # Continue without database - still return results

    # Step 5: Extract (LLM-enhanced)
    chunks_for_extraction = [
        {"text": c["text"], "page": c["page"], "index": c["chunk_index"]}
        for c in chunks["chunks"]
    ]
    use_llm_extract = _should_use_llm("fact_extractor")
    facts = await extract_facts_async(
        classification["doc_type"],
        chunks_for_extraction,
        ollama_client=ollama_client if use_llm_extract else None,
        use_llm=use_llm_extract,
        language=classification.get("language", "ja"),
    )

    # Step 6: Quality Check (LLM-enhanced)
    use_llm_quality = _should_use_llm("quality_guardian")
    quality = await check_quality_async(
        facts["facts"],
        {"ocr_used": False, "chunk_count": len(chunks["chunks"])},
        ollama_client=ollama_client if use_llm_quality else None,
        use_llm=use_llm_quality,
        doc_type=classification["doc_type"],
    )

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
    }


@app.post("/pipeline/query")
async def query_documents(request: QueryRequest):
    """
    Query pipeline with Intent Router:
    1. Classify question intent (rule-based → LLM fallback)
    2. Route to appropriate handler:
       - list_files: Return document list from DB
       - file_stats: Return statistics
       - search_content/general_qa: Use RAG (Vector Search → LLM)
    """
    # Check if database is available
    if not db_service:
        raise HTTPException(
            status_code=503,
            detail="Database service is not available. Please check PostgreSQL connection."
        )

    try:
        # Create Intent Router
        router = IntentRouter(db_service=db_service, ollama_client=ollama_client)

        # Define QA handler for RAG-based queries
        async def qa_handler(question: str):
            """RAG handler using existing QA Agent"""
            if not ollama_client:
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

            result = await answer_question(
                question=question,
                ollama_client=ollama_client,
                db_service=db_service,
                top_k=5,
                similarity_threshold=0.3,
                use_hybrid_search=True,
            )

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

        # Log the routing result
        logger.info(f"Query routed: intent={response.intent}, search_mode={response.search_mode}")

        return router_response_to_dict(response)

    except Exception as e:
        logger.error(f"Query failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
