"""
Slide Deck Agent
Generates and refines slide decks grounded in retrieved document context.
"""

from __future__ import annotations

import json
import logging
from typing import Any, Optional, TYPE_CHECKING

from src.agents.qa_agent import deduplicate_results, expand_query_with_llm

if TYPE_CHECKING:
    from src.llm.ai_client import AIClient
    from src.storage.database import DatabaseService, SearchResult

logger = logging.getLogger(__name__)


SLIDE_SYSTEM_PROMPT = """あなたは社内文書の内容に基づいて資料（スライド）を作るアシスタントです。
与えられた「参考文書（検索結果）」の内容のみに基づき、ユーザーの質問に対するスライド資料を作成/編集してください。

重要なルール:
1. 出力は必ず JSON のみ（説明文なし）
2. 文書に書かれていない情報は推測しない
3. 各スライドは要点だけ（箇条書き中心、1スライド3〜6項目）
4. 可能な限り、各スライドに根拠（citations）を付ける
5. citations の quote は短い抜粋（120文字以内）
"""


def _compact_text(text: str, max_chars: int) -> str:
    text = (text or "").strip()
    if len(text) <= max_chars:
        return text
    return text[: max_chars - 1].rstrip() + "…"


def format_slide_sources_for_prompt(
    search_results: list["SearchResult"],
    max_sources: int = 10,
    max_chars_per_source: int = 900,
) -> list[dict[str, Any]]:
    """
    Format search results into a compact, ID-addressable structure for prompts.
    """
    sources: list[dict[str, Any]] = []
    for i, r in enumerate(search_results[:max_sources], 1):
        title = r.document.file_name
        meta_parts = []
        if r.chunk.page:
            meta_parts.append(f"p{r.chunk.page}")
        if r.chunk.section_title:
            meta_parts.append(r.chunk.section_title)
        meta = " / ".join(meta_parts) if meta_parts else None

        sources.append(
            {
                "source_id": i,
                "document_name": title,
                "meta": meta,
                "similarity": float(round(r.similarity, 3)),
                "text": _compact_text(r.chunk.text, max_chars_per_source),
            }
        )
    return sources


SLIDE_DECK_JSON_SCHEMA = {
    "title": "string",
    "summary": "string (optional)",
    "slides": [
        {
            "title": "string",
            "bullets": ["string"],
            "diagram_mermaid": "string (optional, Mermaid code)",
            "table": {
                "headers": ["string"],
                "rows": [["string"]],
            },
            "image_url": "string (optional, only if provided in sources)",
            "image_prompt": "string (optional, abstract visual prompt)",
            "chart": {
                "type": "bar | line | pie",
                "title": "string (optional)",
                "labels": ["string"],
                "datasets": [
                    {
                        "label": "string (optional)",
                        "data": ["number"],
                    }
                ],
            },
            "speaker_notes": "string (optional)",
            "citations": [
                {
                    "source_id": "number (matches sources.source_id)",
                    "source_title": "string (document name)",
                    "quote": "string (<= 120 chars)",
                }
            ],
        }
    ],
}


def build_generate_slide_prompt(
    *,
    question: str,
    answer: Optional[str],
    sources: list[dict[str, Any]],
    max_slides: int,
) -> str:
    return f"""以下の情報をもとに、NotebookLMのような「スライド資料」を作ってください。

## 質問
{question}

## 既存の回答（参考。矛盾する場合は参考文書を優先）
{answer or "（なし）"}

## 参考文書（検索結果）
{json.dumps(sources, ensure_ascii=False, indent=2)}

## 出力要件
- 最大 {max_slides} 枚
- 1枚あたり 3〜6 bullet
- bullets は短く（1行で読める）
- 可能なら diagram_mermaid に Mermaid 記法の簡単な図（フローチャート等）を入れる（不要なら空/省略）
- 比較や一覧に向く場合は table（headers/rows）を入れる（不要なら空/省略）
- image_url は参考文書に明記されている場合のみ入れる（推測でURLを作らない）
- グラフが効果的なら chart を入れる（type/labels/datasets）。数値は参考文書にある場合のみ使う
- 文書に明記がない場合は、例示（「例」「イメージ」）として抽象的な図・表・フローや image_prompt を作ってもよいが、事実と誤解される具体的数値や固有名は使わない
- citations は可能な限り付ける（source_id, source_title, quote）
- quote は参考文書 text からの短い抜粋（120文字以内）

## 出力形式（JSONのみ）
{json.dumps(SLIDE_DECK_JSON_SCHEMA, ensure_ascii=False)}
"""


def build_refine_slide_prompt(
    *,
    question: str,
    instruction: str,
    deck: dict[str, Any],
    sources: list[dict[str, Any]],
    max_slides: int,
) -> str:
    return f"""以下のスライド資料を、指示に従って編集してください。

## 質問
{question}

## 編集指示
{instruction}

## 参考文書（検索結果）
{json.dumps(sources, ensure_ascii=False, indent=2)}

## 現在のスライド資料（JSON）
{json.dumps(deck, ensure_ascii=False, indent=2)}

## 出力要件
- 最大 {max_slides} 枚（必要なら減らしてよい）
- 1枚あたり 3〜6 bullet
- 文書にない情報は追加しない
- diagram_mermaid は必要に応じて更新してよい（文書根拠に基づく）
- table は必要に応じて更新してよい（文書根拠に基づく）
- image_url は参考文書に明記されている場合のみ維持/追加（推測でURLを作らない）
- image_prompt は必要に応じて更新してよい（抽象的な表現、固有名や具体数値は避ける）
- chart は必要に応じて更新してよい（文書根拠に基づく）。文書に明記がない場合は例示として抽象的な図・表・フローを作ってもよい
- citations は可能な限り維持/追加（source_id, source_title, quote）

## 出力形式（JSONのみ）
{json.dumps(SLIDE_DECK_JSON_SCHEMA, ensure_ascii=False)}
"""


def normalize_slide_deck(raw: Any) -> dict[str, Any]:
    """
    Defensive normalization of model JSON output into a stable shape for the UI.
    """
    if not isinstance(raw, dict):
        raise ValueError("Slide deck JSON must be an object")

    title = str(raw.get("title") or raw.get("deck_title") or "スライド資料").strip() or "スライド資料"
    summary = raw.get("summary")
    if summary is not None:
        summary = str(summary).strip()

    slides_in = raw.get("slides") or raw.get("pages") or []
    if not isinstance(slides_in, list):
        slides_in = []

    slides_out: list[dict[str, Any]] = []
    for s in slides_in:
        if not isinstance(s, dict):
            continue
        stitle = str(s.get("title") or s.get("heading") or "").strip() or "Slide"

        bullets = s.get("bullets") or s.get("points") or []
        if isinstance(bullets, str):
            bullets = [line.strip() for line in bullets.splitlines() if line.strip()]
        if not isinstance(bullets, list):
            bullets = []
        bullets_norm: list[str] = []
        for b in bullets:
            b_str = str(b).strip()
            if not b_str:
                continue
            b_str = b_str.lstrip("-").strip()
            if b_str:
                bullets_norm.append(b_str)

        speaker_notes = s.get("speaker_notes") or s.get("notes")
        if speaker_notes is not None:
            speaker_notes = str(speaker_notes).strip()

        diagram_mermaid = s.get("diagram_mermaid") or s.get("diagram") or s.get("mermaid")
        if diagram_mermaid is not None:
            diagram_mermaid = str(diagram_mermaid).strip()

        image_url = s.get("image_url") or s.get("image")
        if image_url is not None:
            image_url = str(image_url).strip()

        image_prompt = s.get("image_prompt") or s.get("visual_prompt") or s.get("image_description")
        if image_prompt is not None:
            image_prompt = str(image_prompt).strip()

        chart_raw = s.get("chart") or s.get("chart_data") or s.get("chart_json")
        if isinstance(chart_raw, str):
            try:
                chart_raw = json.loads(chart_raw)
            except Exception:
                chart_raw = None
        chart_out = None
        if isinstance(chart_raw, dict):
            ctype = str(chart_raw.get("type") or "").strip().lower()
            if ctype in {"bar", "line", "pie"}:
                labels_in = chart_raw.get("labels") or []
                labels = [str(l).strip() for l in labels_in[:12]] if isinstance(labels_in, list) else []
                datasets_in = chart_raw.get("datasets") or []
                datasets = []
                if isinstance(datasets_in, list):
                    for d in datasets_in[:3]:
                        if not isinstance(d, dict):
                            continue
                        data_in = d.get("data") or []
                        data = []
                        if isinstance(data_in, list):
                            for v in data_in[:12]:
                                try:
                                    data.append(float(v))
                                except Exception:
                                    data.append(0.0)
                        label = str(d.get("label") or "").strip()
                        datasets.append({"label": label, "data": data})
                title = str(chart_raw.get("title") or "").strip()
                if labels or datasets:
                    chart_out = {"type": ctype, "title": title, "labels": labels, "datasets": datasets}

        table_raw = s.get("table")
        if table_raw is None and (s.get("table_headers") or s.get("table_rows")):
            table_raw = {
                "headers": s.get("table_headers"),
                "rows": s.get("table_rows"),
            }
        if table_raw is None and isinstance(s.get("table_data"), list):
            table_raw = {"rows": s.get("table_data")}

        headers_norm: list[str] = []
        rows_norm: list[list[str]] = []
        if isinstance(table_raw, dict):
            headers = table_raw.get("headers") or table_raw.get("header") or []
            rows = table_raw.get("rows") or table_raw.get("data") or []
        elif isinstance(table_raw, list):
            headers = []
            rows = table_raw
        else:
            headers = []
            rows = []

        if isinstance(headers, list):
            for h in headers[:10]:
                h_str = str(h).strip()
                headers_norm.append(h_str)

        if isinstance(rows, list):
            for r in rows[:12]:
                if isinstance(r, list):
                    row_out: list[str] = []
                    for cell in r[:10]:
                        row_out.append(str(cell).strip())
                    rows_norm.append(row_out)
                elif isinstance(r, str):
                    rows_norm.append([r.strip()])

        table_out = {"headers": headers_norm, "rows": rows_norm} if headers_norm or rows_norm else None

        citations_in = s.get("citations") or []
        if not isinstance(citations_in, list):
            citations_in = []
        citations_out: list[dict[str, Any]] = []
        for c in citations_in:
            if not isinstance(c, dict):
                continue
            source_id = c.get("source_id")
            try:
                source_id_int = int(source_id) if source_id is not None else None
            except Exception:
                source_id_int = None
            source_title = str(
                c.get("source_title") or c.get("document_name") or c.get("source") or ""
            ).strip()
            quote = str(c.get("quote") or c.get("excerpt") or "").strip()
            if quote:
                quote = _compact_text(quote, 120)
            if source_title or quote or source_id_int is not None:
                citations_out.append(
                    {
                        "source_id": source_id_int,
                        "source_title": source_title,
                        "quote": quote,
                    }
                )

        slides_out.append(
            {
                "title": stitle,
                "bullets": bullets_norm[:8],
                "diagram_mermaid": diagram_mermaid or "",
                "table": table_out,
                "image_url": image_url or "",
                "image_prompt": image_prompt or "",
                "chart": chart_out,
                "speaker_notes": speaker_notes or "",
                "citations": citations_out[:6],
            }
        )

    return {
        "title": title,
        "summary": summary or "",
        "slides": slides_out,
    }


async def retrieve_sources_for_slides(
    *,
    question: str,
    mode: str,
    db_service: "DatabaseService",
    ai_client: "AIClient",
    top_k_override: Optional[int] = None,
) -> list["SearchResult"]:
    MODE_CONFIG = {
        "fast": {"use_expansion": False, "top_k": 3},
        "standard": {"use_expansion": True, "top_k": 5},
        "accurate": {"use_expansion": True, "top_k": 7},
    }
    config = MODE_CONFIG.get(mode, MODE_CONFIG["standard"])
    top_k = int(top_k_override) if top_k_override else int(config["top_k"])

    embed_result = await ai_client.embed(question)
    query_embedding = embed_result.embedding if embed_result.success else None

    search_query = question
    if config["use_expansion"]:
        expanded_keywords = await expand_query_with_llm(question, ai_client)
        search_query = question + " " + " ".join(expanded_keywords)

    results = db_service.search_hybrid(
        query_text=search_query,
        query_embedding=query_embedding,
        limit=top_k,
        similarity_threshold=0.3,
    )
    results = deduplicate_results(results)
    return results
