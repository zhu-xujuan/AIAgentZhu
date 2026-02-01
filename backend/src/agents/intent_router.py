"""
Intent Router - 質問の意図を分類して適切なハンドラーにルーティング

ハイブリッドアプローチ:
1. ルールベース分類（高速・確実）
2. LLMフォールバック（柔軟）
"""

import re
import logging
from enum import Enum
from typing import Optional, List, Any
from dataclasses import dataclass

logger = logging.getLogger(__name__)


class Intent(Enum):
    """質問の意図タイプ"""
    LIST_FILES = "list_files"          # ファイル一覧を見たい
    FILE_STATS = "file_stats"          # 統計情報を見たい
    FILE_DETAIL = "file_detail"        # 特定ファイルの詳細
    SEARCH_CONTENT = "search_content"  # 内容を検索したい（RAG）
    GENERAL_QA = "general_qa"          # 一般的な質問（RAG）


@dataclass
class IntentResult:
    """意図分類の結果"""
    intent: Intent
    confidence: float
    method: str  # "rule" or "llm"
    extracted_params: dict = None

    def __post_init__(self):
        if self.extracted_params is None:
            self.extracted_params = {}


@dataclass
class RouterResponse:
    """ルーターの応答"""
    question: str
    answer: str
    sources: List[dict]
    confidence: float
    has_answer: bool
    search_mode: str  # "metadata", "vector", "hybrid", "direct"
    intent: str
    error: Optional[str] = None


# ============================================================
# ルールベース意図分類
# ============================================================

INTENT_PATTERNS = {
    Intent.LIST_FILES: [
        # ファイル一覧系 - 日本語
        r"(どんな|何の|どういう|どの).*(ファイル|文書|ドキュメント|書類|資料|データ).*(あり|ある|登録|アップロード|読み込|入っ|保存)",
        r"(ファイル|文書|ドキュメント|資料|データ).*(一覧|リスト|確認|見せ|教え|表示)",
        r"(全体|全部|すべて|全て).*(ファイル|文書|ドキュメント|資料)",
        r"(登録|アップロード|読み込|保存).*されている.*(ファイル|文書|資料|もの)",
        r"(ファイル|文書|資料).*(何|なに)が(ある|あり)",
        r"(現在|今).*(どんな|何の).*(ファイル|文書|資料|データ)",
        # 削除: r"(現在|今).*(読み込|登録|保存|アップロード)", - 広すぎて質問と誤判定
        r"どんな.*(資料|ファイル|文書)",  # シンプルなパターン追加
        # ファイル一覧系 - 英語
        r"what.*(files?|documents?).*(uploaded|registered|stored|loaded)",
        r"list.*(files?|documents?)",
        r"show.*(all|files?|documents?)",
        r"(currently|now).*(loaded|uploaded|registered)",
    ],
    Intent.FILE_STATS: [
        # 統計・件数系
        r"(何件|いくつ|何個|何ファイル|何文書)",
        r"(件数|数|カウント|総数)",
        r"(統計|サマリー|概要|まとめ)",
        r"how many.*(files?|documents?)",
        r"(count|number|total).*(files?|documents?)",
    ],
    Intent.FILE_DETAIL: [
        # 特定ファイルの詳細
        r"(.+\.(txt|pdf|csv|json|md)).*(内容|詳細|中身|について)",
        r"(この|その|あの)ファイル.*(内容|詳細)",
    ],
}


def classify_intent_rule_based(question: str) -> Optional[IntentResult]:
    """
    ルールベースで意図を分類（高速）

    Returns:
        IntentResult if matched, None otherwise
    """
    question_lower = question.lower()

    for intent, patterns in INTENT_PATTERNS.items():
        for pattern in patterns:
            if re.search(pattern, question, re.IGNORECASE):
                logger.info(f"Rule-based intent: {intent.value} (pattern: {pattern[:30]}...)")
                return IntentResult(
                    intent=intent,
                    confidence=0.9,
                    method="rule"
                )

    return None


# ============================================================
# LLMベース意図分類
# ============================================================

INTENT_CLASSIFICATION_PROMPT = """ユーザーの質問を以下のカテゴリに分類してください。

カテゴリ:
- list_files: ファイル一覧、登録されているドキュメントを見たい、何がアップロードされているか知りたい
- file_stats: 統計情報、件数、ドキュメント数を知りたい
- file_detail: 特定のファイルの詳細や内容を見たい
- search_content: ドキュメントの内容を検索して情報を探したい
- general_qa: ドキュメントの内容に関する一般的な質問に答えてほしい

質問: {question}

カテゴリ名のみを1単語で回答してください（例: list_files）:"""


async def classify_intent_llm(question: str, ollama_client) -> IntentResult:
    """
    LLMで意図を分類（より柔軟）

    Args:
        question: ユーザーの質問
        ollama_client: OllamaClient instance

    Returns:
        IntentResult
    """
    try:
        prompt = INTENT_CLASSIFICATION_PROMPT.format(question=question)
        result = await ollama_client.generate(prompt, max_tokens=20)

        intent_str = result.text.strip().lower().replace('"', '').replace("'", "")

        # マッピング
        intent_map = {
            "list_files": Intent.LIST_FILES,
            "file_stats": Intent.FILE_STATS,
            "file_detail": Intent.FILE_DETAIL,
            "search_content": Intent.SEARCH_CONTENT,
            "general_qa": Intent.GENERAL_QA,
        }

        intent = intent_map.get(intent_str, Intent.GENERAL_QA)
        logger.info(f"LLM-based intent: {intent.value} (raw: {intent_str})")

        return IntentResult(
            intent=intent,
            confidence=0.7,
            method="llm"
        )

    except Exception as e:
        logger.warning(f"LLM intent classification failed: {e}, defaulting to GENERAL_QA")
        return IntentResult(
            intent=Intent.GENERAL_QA,
            confidence=0.5,
            method="llm_fallback"
        )


# ============================================================
# ハンドラー
# ============================================================

async def handle_list_files(question: str, db_service, limit: int = 100) -> RouterResponse:
    """ファイル一覧を返すハンドラー"""
    try:
        documents = db_service.get_all_documents(limit=limit)

        if not documents:
            return RouterResponse(
                question=question,
                answer="現在、登録されているドキュメントはありません。",
                sources=[],
                confidence=1.0,
                has_answer=True,
                search_mode="metadata",
                intent="list_files"
            )

        # ドキュメントタイプ別に集計
        type_counts = {}
        for doc in documents:
            doc_type = doc.doc_type or "unknown"
            type_counts[doc_type] = type_counts.get(doc_type, 0) + 1

        # 一覧を作成
        file_list_lines = []
        for doc in documents:
            lang = f", {doc.language}" if doc.language else ""
            doc_type = doc.doc_type or "unknown"
            file_list_lines.append(f"  - {doc.file_name} ({doc_type}{lang})")

        file_list = "\n".join(file_list_lines)

        # タイプ別サマリー
        type_summary = ", ".join([f"{t}: {c}件" for t, c in sorted(type_counts.items())])

        answer = f"""現在 **{len(documents)}件** のドキュメントが登録されています。

**種類別内訳:** {type_summary}

**ファイル一覧:**
{file_list}"""

        return RouterResponse(
            question=question,
            answer=answer,
            sources=[],
            confidence=1.0,
            has_answer=True,
            search_mode="metadata",
            intent="list_files"
        )

    except Exception as e:
        logger.error(f"handle_list_files error: {e}")
        return RouterResponse(
            question=question,
            answer="ファイル一覧の取得中にエラーが発生しました。",
            sources=[],
            confidence=0.0,
            has_answer=False,
            search_mode="metadata",
            intent="list_files",
            error=str(e)
        )


async def handle_file_stats(question: str, db_service) -> RouterResponse:
    """統計情報を返すハンドラー"""
    try:
        documents = db_service.get_all_documents(limit=1000)

        # 集計
        total = len(documents)
        type_counts = {}
        lang_counts = {}

        for doc in documents:
            doc_type = doc.doc_type or "unknown"
            type_counts[doc_type] = type_counts.get(doc_type, 0) + 1

            lang = doc.language or "unknown"
            lang_counts[lang] = lang_counts.get(lang, 0) + 1

        # 統計情報を整形
        type_stats = "\n".join([f"  - {t}: {c}件" for t, c in sorted(type_counts.items(), key=lambda x: -x[1])])
        lang_stats = "\n".join([f"  - {l}: {c}件" for l, c in sorted(lang_counts.items(), key=lambda x: -x[1])])

        answer = f"""**ドキュメント統計情報**

**総数:** {total}件

**種類別:**
{type_stats}

**言語別:**
{lang_stats}"""

        return RouterResponse(
            question=question,
            answer=answer,
            sources=[],
            confidence=1.0,
            has_answer=True,
            search_mode="metadata",
            intent="file_stats"
        )

    except Exception as e:
        logger.error(f"handle_file_stats error: {e}")
        return RouterResponse(
            question=question,
            answer="統計情報の取得中にエラーが発生しました。",
            sources=[],
            confidence=0.0,
            has_answer=False,
            search_mode="metadata",
            intent="file_stats",
            error=str(e)
        )


# ============================================================
# メインルーター
# ============================================================

class IntentRouter:
    """
    Intent Router - 質問を適切なハンドラーにルーティング

    Usage:
        router = IntentRouter(db_service, ollama_client)
        response = await router.route(question)
    """

    def __init__(self, db_service, ollama_client=None):
        self.db_service = db_service
        self.ollama_client = ollama_client

    async def classify(self, question: str) -> IntentResult:
        """
        質問の意図を分類

        1. まずルールベースで判定（高速）
        2. 判定できなければLLMで判定（柔軟）
        """
        # ルールベース判定
        result = classify_intent_rule_based(question)
        if result is not None:
            return result

        # LLMフォールバック
        if self.ollama_client:
            return await classify_intent_llm(question, self.ollama_client)

        # デフォルト
        return IntentResult(
            intent=Intent.GENERAL_QA,
            confidence=0.5,
            method="default"
        )

    async def route(self, question: str, qa_handler=None) -> RouterResponse:
        """
        質問を適切なハンドラーにルーティング

        Args:
            question: ユーザーの質問
            qa_handler: RAG用のQAハンドラー関数（search_content, general_qa用）

        Returns:
            RouterResponse
        """
        # 意図分類
        intent_result = await self.classify(question)
        logger.info(f"Intent classified: {intent_result.intent.value} "
                   f"(confidence={intent_result.confidence}, method={intent_result.method})")

        # ハンドラーにルーティング
        if intent_result.intent == Intent.LIST_FILES:
            return await handle_list_files(question, self.db_service)

        elif intent_result.intent == Intent.FILE_STATS:
            return await handle_file_stats(question, self.db_service)

        elif intent_result.intent in (Intent.SEARCH_CONTENT, Intent.GENERAL_QA, Intent.FILE_DETAIL):
            # RAG処理（既存のQA Agent）
            if qa_handler:
                return await qa_handler(question)
            else:
                return RouterResponse(
                    question=question,
                    answer="QAハンドラーが設定されていません。",
                    sources=[],
                    confidence=0.0,
                    has_answer=False,
                    search_mode="none",
                    intent=intent_result.intent.value,
                    error="QA handler not configured"
                )

        else:
            # 未知の意図
            return RouterResponse(
                question=question,
                answer="質問の意図を理解できませんでした。",
                sources=[],
                confidence=0.0,
                has_answer=False,
                search_mode="none",
                intent="unknown"
            )


# ============================================================
# ユーティリティ関数
# ============================================================

def router_response_to_dict(response: RouterResponse) -> dict:
    """RouterResponseを辞書に変換（API応答用）"""
    return {
        "question": response.question,
        "answer": response.answer,
        "sources": response.sources,
        "confidence": response.confidence,
        "has_answer": response.has_answer,
        "search_mode": response.search_mode,
        "intent": response.intent,
        "error": response.error,
    }
