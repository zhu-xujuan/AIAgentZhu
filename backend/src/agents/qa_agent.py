"""
Question Answering Agent
Handles question answering using vector search and LLM.
"""

import logging
from typing import Optional, TYPE_CHECKING
from dataclasses import dataclass

if TYPE_CHECKING:
    from src.llm.ai_client import AIClient as OllamaClient
    from src.storage.database import DatabaseService, SearchResult

logger = logging.getLogger(__name__)


@dataclass
class QAResult:
    """Result from question answering."""
    answer: str
    sources: list[dict]
    confidence: float
    has_answer: bool
    error: Optional[str] = None

    def to_dict(self) -> dict:
        return {
            "answer": self.answer,
            "sources": self.sources,
            "confidence": self.confidence,
            "has_answer": self.has_answer,
            "error": self.error,
        }


QA_SYSTEM_PROMPT = """あなたは文書検索アシスタントです。
与えられた文書の内容に基づいて、ユーザーの質問に正確に回答してください。

重要なルール:
1. 回答は必ず提供された文書の内容のみに基づいてください
2. 文書に書かれていない情報は推測しないでください
3. 回答の根拠となる部分を明確にしてください
4. 情報が見つからない場合のみ「文書内に該当する情報が見つかりませんでした」と回答してください
5. 回答は簡潔かつ明確に日本語で記述してください

回答のヒント:
- 質問に直接関連する情報が文書内にあれば、必ずその情報を回答に含めてください
- 「期間」「日付」「いつ」などの質問には、具体的な日付や期間を抽出して回答してください
- 複数の文書がある場合は、最も関連性の高い文書から情報を抽出してください"""


# LLMによるクエリ拡張用プロンプト
QUERY_EXPANSION_SYSTEM = """あなたは検索クエリ最適化の専門家です。
ユーザーの質問を分析し、文書検索に最適なキーワードを生成してください。"""

QUERY_EXPANSION_PROMPT = """以下の質問から、文書検索に使用するキーワードを抽出・生成してください。

## 質問
{question}

## タスク
1. 質問の意図を理解する
2. 重要なキーワードを抽出する
3. 曖昧な表現があれば、具体的な関連語に展開する
4. 英語の質問は日本語キーワードに変換する

## 出力形式
キーワードをカンマ区切りで出力してください。5〜10個程度が適切です。
説明は不要です。キーワードのみを出力してください。

キーワード:"""


QA_PROMPT_TEMPLATE = """以下の文書を参考にして、質問に回答してください。

## 参考文書
{context}

## 質問
{question}

## 回答
上記の文書内容に基づいて回答してください:"""


QUERY_REWRITE_PROMPT = """以下の質問を検索クエリに適した形式に書き換えてください。
キーワードを抽出し、検索に役立つ形式で出力してください。

質問: {question}

検索クエリ（キーワードのみ、カンマ区切り）:"""


def extract_search_keywords(question: str) -> list[str]:
    """Extract search keywords from a question (rule-based fallback)."""
    # Remove common question patterns
    patterns_to_remove = [
        'について教えて', 'とは何ですか', 'を教えて', 'はどうなっていますか',
        'はありますか', 'でしょうか', 'ですか', 'ください', 'について',
        'what is', 'how to', 'what are', 'where is', 'when did',
    ]
    text = question.lower()
    for pattern in patterns_to_remove:
        text = text.replace(pattern, ' ')

    # Split and filter keywords
    words = text.split()
    keywords = [w.strip() for w in words if len(w.strip()) >= 2]
    return keywords


async def expand_query_with_llm(
    question: str,
    ollama_client: "OllamaClient",
) -> list[str]:
    """
    LLMを使用してクエリを拡張し、検索キーワードを生成する。

    Args:
        question: ユーザーの質問
        ollama_client: OllamaClient instance

    Returns:
        拡張されたキーワードのリスト
    """
    try:
        prompt = QUERY_EXPANSION_PROMPT.format(question=question)

        result = await ollama_client.generate(
            prompt=prompt,
            system=QUERY_EXPANSION_SYSTEM,
            temperature=0.1,  # 低めの温度で一貫性を確保
        )

        if not result.success:
            logger.warning(f"Query expansion failed: {result.error}")
            return extract_search_keywords(question)

        # カンマ区切りのキーワードをパース
        keywords_text = result.text.strip()
        # "キーワード:" などのプレフィックスを除去
        if ":" in keywords_text:
            keywords_text = keywords_text.split(":", 1)[-1].strip()

        keywords = [k.strip() for k in keywords_text.split(",") if k.strip()]

        # 元の質問のキーワードも追加（フォールバック）
        original_keywords = extract_search_keywords(question)
        for kw in original_keywords:
            if kw not in keywords:
                keywords.append(kw)

        logger.info(f"Query expansion: '{question[:30]}...' -> {keywords}")
        return keywords

    except Exception as e:
        logger.warning(f"Query expansion error: {e}, using fallback")
        return extract_search_keywords(question)


def deduplicate_results(results: list["SearchResult"]) -> list["SearchResult"]:
    """Remove duplicate chunks from search results."""
    seen_texts = set()
    unique_results = []

    for result in results:
        # Use first 100 chars as dedup key
        text_key = result.chunk.text[:100].strip()
        if text_key not in seen_texts:
            seen_texts.add(text_key)
            unique_results.append(result)

    return unique_results


def format_context(search_results: list["SearchResult"]) -> str:
    """Format search results as context for the LLM."""
    if not search_results:
        return "（該当する文書が見つかりませんでした）"

    context_parts = []
    for i, result in enumerate(search_results, 1):
        source_info = f"[出典{i}: {result.document.file_name}"
        if result.chunk.page:
            source_info += f" (ページ{result.chunk.page})"
        if result.chunk.section_title:
            source_info += f" - {result.chunk.section_title}"
        source_info += f", 類似度: {result.similarity:.2f}]"

        context_parts.append(f"{source_info}\n{result.chunk.text}")

    return "\n\n---\n\n".join(context_parts)


async def answer_question(
    question: str,
    ollama_client: "OllamaClient",
    db_service: "DatabaseService",
    top_k: int = 5,
    similarity_threshold: float = 0.3,
    use_hybrid_search: bool = True,
    use_query_expansion: bool = True,
) -> QAResult:
    """
    Answer a question using vector search and LLM.

    Args:
        question: The user's question.
        ollama_client: OllamaClient instance.
        db_service: DatabaseService instance.
        top_k: Number of chunks to retrieve.
        similarity_threshold: Minimum similarity score.
        use_hybrid_search: If True, combine vector and full-text search.
        use_query_expansion: If True, use LLM to expand query keywords.

    Returns:
        QAResult with answer and sources.
    """
    import time
    start_time = time.time()
    logger.info(f"[QA] === Starting answer_question for: '{question[:50]}...' ===")

    try:
        # Step 1: LLMによるクエリ拡張
        expanded_keywords = []
        if use_query_expansion:
            step_start = time.time()
            logger.info("[QA] Step 1: Expanding query with LLM...")
            expanded_keywords = await expand_query_with_llm(question, ollama_client)
            logger.info(f"[QA] Step 1 completed in {time.time() - step_start:.2f}s, keywords: {expanded_keywords[:5]}")

        # 拡張キーワードを検索クエリとして結合
        search_query = question
        if expanded_keywords:
            search_query = question + " " + " ".join(expanded_keywords)
            logger.info(f"[QA] Expanded search query: {search_query[:100]}...")

        # Step 2: Generate embedding for the question
        step_start = time.time()
        logger.info(f"[QA] Step 2: Generating embedding for question...")
        embed_result = await ollama_client.embed(question)
        logger.info(f"[QA] Step 2 completed in {time.time() - step_start:.2f}s, success={embed_result.success}")

        query_embedding = None
        if embed_result.success:
            query_embedding = embed_result.embedding
            logger.info(f"[QA] Embedding generated, dimension: {len(query_embedding) if query_embedding else 0}")
        else:
            logger.warning(f"[QA] Embedding generation failed: {embed_result.error}, using full-text search only")

        # Step 3: Search for similar chunks
        step_start = time.time()
        logger.info("[QA] Step 3: Searching for similar chunks...")

        if use_hybrid_search:
            # Use hybrid search (combines vector + full-text)
            # 拡張キーワードを全文検索に使用
            search_results = db_service.search_hybrid(
                query_text=search_query,
                query_embedding=query_embedding,
                limit=top_k,
                similarity_threshold=similarity_threshold,
            )
        elif query_embedding:
            # Use vector search with full-text fallback
            search_results = db_service.search_similar_chunks(
                query_embedding=query_embedding,
                limit=top_k,
                similarity_threshold=similarity_threshold,
                query_text=search_query,
            )
        else:
            # Use full-text search only
            search_results = db_service.search_chunks_fulltext(
                query=search_query,
                limit=top_k,
            )

        # Remove duplicate chunks
        search_results = deduplicate_results(search_results)
        logger.info(f"[QA] Step 3 completed in {time.time() - step_start:.2f}s, found {len(search_results)} chunks")

        if not search_results:
            logger.warning("[QA] No search results found")
            return QAResult(
                answer="文書内に該当する情報が見つかりませんでした。関連する文書がデータベースに登録されていない可能性があります。",
                sources=[],
                confidence=0.0,
                has_answer=False,
            )

        # Step 4: Format context from search results
        context = format_context(search_results)
        logger.info(f"[QA] Context formatted, length: {len(context)} chars")

        # Step 5: Generate answer using LLM
        step_start = time.time()
        logger.info("[QA] Step 5: Generating answer with LLM...")
        prompt = QA_PROMPT_TEMPLATE.format(context=context, question=question)
        logger.info(f"[QA] Prompt length: {len(prompt)} chars")

        result = await ollama_client.generate(
            prompt=prompt,
            system=QA_SYSTEM_PROMPT,
            temperature=0.3,
        )
        logger.info(f"[QA] Step 5 completed in {time.time() - step_start:.2f}s, success={result.success}")

        if not result.success:
            logger.error(f"[QA] LLM generation failed: {result.error}")
            return QAResult(
                answer="回答の生成に失敗しました。",
                sources=[],
                confidence=0.0,
                has_answer=False,
                error=result.error,
            )

        # Step 5: Format sources
        sources = [
            {
                "document_name": r.document.file_name,
                "chunk_text": r.chunk.text,
                "similarity": round(r.similarity, 3),
            }
            for r in search_results
        ]

        # Calculate confidence using weighted scoring
        # - Top result gets higher weight
        # - Consider answer quality (not "見つかりませんでした" in response)
        top_similarity = search_results[0].similarity if search_results else 0
        avg_similarity = sum(r.similarity for r in search_results) / len(search_results)

        # Weighted confidence: 60% top score, 40% average
        base_confidence = (top_similarity * 0.6) + (avg_similarity * 0.4)

        # Penalty if answer seems to indicate no information found
        no_info_phrases = ["見つかりませんでした", "情報がありません", "確認できません", "不明"]
        has_no_info = any(phrase in result.text for phrase in no_info_phrases)
        if has_no_info:
            base_confidence *= 0.5

        confidence = round(min(1.0, base_confidence), 2)

        total_time = time.time() - start_time
        logger.info(f"[QA] === Completed in {total_time:.2f}s. Answer length: {len(result.text)}, Sources: {len(sources)}, Confidence: {confidence} ===")

        return QAResult(
            answer=result.text,
            sources=sources,
            confidence=confidence,
            has_answer=True,
        )

    except Exception as e:
        import traceback
        logger.error(f"[QA] Error: {e}")
        logger.error(f"[QA] Traceback: {traceback.format_exc()}")
        return QAResult(
            answer=f"エラーが発生しました: {str(e)}",
            sources=[],
            confidence=0.0,
            has_answer=False,
            error=str(e),
        )


async def answer_question_simple(
    question: str,
    ollama_client: "OllamaClient",
    db_service: "DatabaseService",
) -> dict:
    """
    Simple wrapper for answer_question that returns a dict.
    """
    result = await answer_question(question, ollama_client, db_service)
    return result.to_dict()
