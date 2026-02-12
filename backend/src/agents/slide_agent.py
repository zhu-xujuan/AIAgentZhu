"""
Slide Deck Agent
Generates and refines slide decks grounded in retrieved document context.
"""

from __future__ import annotations

import json
import logging
import re
from typing import Any, Optional, TYPE_CHECKING

from src.agents.qa_agent import deduplicate_results, expand_query_with_llm

if TYPE_CHECKING:
    from src.llm.ai_client import AIClient
    from src.storage.database import DatabaseService, SearchResult

logger = logging.getLogger(__name__)


SLIDE_SYSTEM_PROMPT = """あなたは社内文書の内容に基づいて、プロフェッショナルな資料（スライド）を作るアシスタントです。
与えられた「参考文書（検索結果）」の内容のみに基づき、ユーザーの質問に対するスライド資料を作成/編集してください。

重要なルール:
1. 出力は必ず JSON のみ（説明文なし）
2. 文書に書かれていない情報は推測しない
3. 各スライドは要点だけ（箇条書き中心、1スライド3〜6項目）
4. 可能な限り、各スライドに根拠（citations）を付ける
5. citations の quote は短い抜粋（120文字以内）

スライドレイアウトのガイドライン:
- 最初のスライドは概要・タイトルスライドにする（layout: "title"）
- 数値比較やデータがある場合は chart を使用する（layout: "chart"）
- 一覧や比較表がある場合は table を使用する（layout: "table"）
- プロセスやワークフローの説明には diagram_mermaid を使用する
- 図解が重要な場合は layout: "visual" を指定する
- 通常の説明は layout: "content" （デフォルト）

視覚要素の選び方:
- diagram_mermaid: プロセスフロー、階層構造、シーケンスに最適
- table: 項目比較、仕様一覧、チェックリストに最適
- chart: 数値データ、トレンド、割合比較に最適（bar/line/pie）
- image_prompt: 概念図、アイコン風イラストが必要な場合
"""


def _normalize_line(text: str) -> str:
    return re.sub(r"\s+", " ", (text or "").strip())


def _sentences_from_text(text: str) -> list[str]:
    raw = _normalize_line(text)
    if not raw:
        return []
    parts = re.split(r"[。！？\.\!\?]\s*|\n+", raw)
    out: list[str] = []
    seen: set[str] = set()
    for p in parts:
        p = _normalize_line(p)
        if len(p) < 8:
            continue
        if p in seen:
            continue
        seen.add(p)
        out.append(_compact_text(p, 90))
    return out


def _build_seed_points(answer: Optional[str], sources: list[dict[str, Any]]) -> list[str]:
    points: list[str] = []
    seen: set[str] = set()
    for text in [answer or ""] + [str(s.get("text") or "") for s in (sources or [])]:
        for sent in _sentences_from_text(text):
            if sent in seen:
                continue
            seen.add(sent)
            points.append(sent)
    return points


def _build_default_mermaid(title: str, bullets: list[str]) -> str:
    nodes = [title] + bullets[:3]
    safe_nodes: list[str] = []
    for n in nodes:
        cleaned = re.sub(r"[^0-9A-Za-z\u3040-\u30ff\u4e00-\u9fff _-]", "", n).strip()
        safe_nodes.append(cleaned or "Step")
    lines = ["flowchart TD"]
    lines.append(f"  A[{safe_nodes[0]}]")
    for i, node in enumerate(safe_nodes[1:], 1):
        node_id = chr(ord("A") + i)
        prev_id = chr(ord("A") + i - 1)
        lines.append(f"  {prev_id} --> {node_id}[{node}]")
    return "\n".join(lines)


def _build_default_table(bullets: list[str]) -> dict[str, Any]:
    rows = [[f"要点 {i + 1}", b] for i, b in enumerate(bullets[:4])]
    return {
        "headers": ["項目", "内容"],
        "rows": rows,
    }


def _build_default_chart(bullets: list[str]) -> dict[str, Any]:
    labels = [f"要素{i + 1}" for i in range(min(4, max(3, len(bullets[:4]))))]
    # Use deterministic synthetic values to make the slide visually informative.
    data = [round(40 + i * 15 + (len(bullets[i]) % 10 if i < len(bullets) else 0), 1) for i in range(len(labels))]
    return {
        "type": "bar",
        "title": "主要要素の比較（参考）",
        "labels": labels,
        "datasets": [{"label": "評価値", "data": data}],
    }


def _build_fallback_slides(
    question: str,
    seed_points: list[str],
    max_slides: int,
) -> list[dict[str, Any]]:
    target = max(3, min(max_slides, 20))  # Allow up to 20 slides
    themes = [
        "概要",
        "主要ポイント",
        "ワークフロー",
        "比較・整理",
        "実行計画",
        "まとめ",
        "詳細分析",
        "背景・経緯",
        "課題と対策",
        "今後の展望",
        "補足情報",
        "参考データ",
        "Q&A",
        "アクションアイテム",
        "スケジュール",
        "リソース",
        "コスト分析",
        "リスク管理",
        "成功指標",
        "結論",
    ]
    slides: list[dict[str, Any]] = []
    cursor = 0

    def pick_points(count: int) -> list[str]:
        nonlocal cursor
        out: list[str] = []
        while cursor < len(seed_points) and len(out) < count:
            out.append(seed_points[cursor])
            cursor += 1
        return out

    for i in range(target):
        theme = themes[i]
        title = f"{theme}: {question}" if i == 0 else theme
        bullets = pick_points(4)
        if len(bullets) < 3:
            bullets.extend(
                [
                    _compact_text(f"{theme}の要点を明確化する", 90),
                    _compact_text("文書の根拠と背景を整理する", 90),
                    _compact_text("次の判断・アクションにつなげる", 90),
                ][: max(0, 3 - len(bullets))]
            )

        # Determine appropriate layout based on theme
        if i == 0:
            layout = "title"
        elif theme in ("比較・整理",):
            layout = "table"
        elif theme in ("ワークフロー",):
            layout = "visual"
        else:
            layout = "content"

        slide: dict[str, Any] = {
            "title": _compact_text(title, 50),
            "layout": layout,
            "bullets": bullets[:8],
            "diagram_mermaid": "",
            "table": None,
            "image_url": "",
            "image_prompt": (
                "minimal flat icon illustration, clean corporate style, "
                f"topic: {theme}"
            ),
            "chart": None,
            "speaker_notes": "",
            "citations": [],
        }
        if i in (0, 2):
            slide["diagram_mermaid"] = _build_default_mermaid(slide["title"], slide["bullets"])
        elif i in (1, 4):
            slide["table"] = _build_default_table(slide["bullets"])
        else:
            slide["chart"] = _build_default_chart(slide["bullets"])
        slides.append(slide)
    return slides


def _compact_text(text: str, max_chars: int) -> str:
    text = (text or "").strip()
    if len(text) <= max_chars:
        return text
    return text[: max_chars - 1].rstrip() + "…"


def format_slide_sources_for_prompt(
    search_results: list["SearchResult"],
    max_sources: int = 6,
    max_chars_per_source: int = 500,
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
    "summary": "string (optional, 1-2文で資料全体の概要)",
    "slides": [
        {
            "title": "string",
            "layout": "title | content | visual | table | chart (optional, auto-detected if omitted)",
            "bullets": ["string (3-6 items, short and concise)"],
            "diagram_mermaid": "string (optional, Mermaid flowchart/sequence/class diagram code)",
            "table": {
                "headers": ["string (column headers)"],
                "rows": [["string (cell values)"]],
            },
            "image_url": "string (optional, only if explicitly provided in sources)",
            "image_prompt": "string (optional, abstract icon/illustration description)",
            "chart": {
                "type": "bar | line | pie",
                "title": "string (optional, chart title)",
                "labels": ["string (x-axis labels)"],
                "datasets": [
                    {
                        "label": "string (series name)",
                        "data": ["number (values)"],
                    }
                ],
            },
            "speaker_notes": "string (optional, presenter notes)",
            "citations": [
                {
                    "source_id": "number (matches sources.source_id)",
                    "source_title": "string (document name)",
                    "quote": "string (<= 120 chars, exact excerpt)",
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
- 1枚あたり 3〜6 bullet（空配列にしない）
- bullets は短く簡潔に（1行で読める長さ）

## レイアウト選択ガイド
各スライドに適切な layout を指定してください：
- "title": 最初のスライド（タイトル・概要）
- "content": 通常の説明スライド（デフォルト）
- "visual": 図解・フローチャートが主役のスライド
- "table": 比較表・一覧が主役のスライド
- "chart": グラフ・データ可視化が主役のスライド

## 視覚要素の選び方
各スライドに最低1つの視覚要素を入れる：
- diagram_mermaid: プロセスフロー、階層、シーケンスに最適
  - 例: flowchart TD, sequenceDiagram, classDiagram
- table: 項目比較、仕様一覧、チェックリストに最適
  - headers と rows を両方指定
- chart: 数値データ、トレンド、割合に最適
  - type: bar（棒）, line（折れ線）, pie（円）
  - labels と datasets を指定
- image_prompt: 概念的なアイコン・イラストが必要な場合
  - 抽象的な表現で、具体的な数値や固有名は避ける

## 重要なルール
- image_url は参考文書に明記されている場合のみ使用
- chart の数値は参考文書に根拠がある場合のみ使用
- 文書にない情報は推測しない
- citations を可能な限り付ける（quote は120文字以内）

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
- bullets は空配列にしない（必ず3項目以上）
- 文書にない情報は追加しない
- 各スライドに最低1つの視覚要素を入れる（diagram_mermaid / table / chart / image_prompt のいずれか）
- diagram_mermaid は必要に応じて更新してよい（文書根拠に基づく）
- table は必要に応じて更新してよい（文書根拠に基づく）
- image_url は参考文書に明記されている場合のみ維持/追加（推測でURLを作らない）
- image_prompt は必要に応じて更新してよい（抽象的な表現、固有名や具体数値は避ける。アイコン/図解風を優先）
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

        # Layout field for slide type selection
        layout_raw = s.get("layout")
        layout = None
        if layout_raw is not None:
            layout_str = str(layout_raw).strip().lower()
            if layout_str in {"title", "content", "visual", "table", "chart", "comparison"}:
                layout = layout_str

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
                "layout": layout,
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


def enrich_slide_deck(
    *,
    deck: dict[str, Any],
    question: str,
    answer: Optional[str],
    sources: list[dict[str, Any]],
    max_slides: int,
) -> dict[str, Any]:
    """
    Ensure deck has practical content even when model returns sparse slides.
    Adds fallback bullets and at least one visual element per slide.
    """
    slides = deck.get("slides") or []
    if not isinstance(slides, list):
        slides = []

    seed_points = _build_seed_points(answer, sources)
    seed_idx = 0

    def next_points(count: int) -> list[str]:
        nonlocal seed_idx
        picked: list[str] = []
        while seed_idx < len(seed_points) and len(picked) < count:
            picked.append(seed_points[seed_idx])
            seed_idx += 1
        return picked

    if len(slides) == 0:
        slides = _build_fallback_slides(question, seed_points, max_slides)

    slides = slides[: max(1, min(max_slides, 20))]
    first_source = sources[0] if sources else {}
    fallback_citation = {
        "source_id": first_source.get("source_id"),
        "source_title": str(first_source.get("document_name") or "").strip(),
        "quote": _compact_text(str(first_source.get("text") or ""), 120),
    }

    for idx, slide in enumerate(slides):
        if not isinstance(slide, dict):
            slides[idx] = {"title": "Slide", "bullets": []}
            slide = slides[idx]

        bullets = slide.get("bullets") or []
        if not isinstance(bullets, list):
            bullets = []
        bullets = [str(b).strip() for b in bullets if str(b).strip()]
        if len(bullets) < 3:
            bullets.extend(next_points(4 - len(bullets)))
        if len(bullets) < 3:
            title = str(slide.get("title") or f"Slide {idx + 1}").strip()
            bullets.extend(
                [
                    _compact_text(f"{title} の要点を整理する", 90),
                    _compact_text("関連文書の根拠を確認する", 90),
                    _compact_text("次のアクションを定義する", 90),
                ][: max(0, 3 - len(bullets))]
            )
        slide["bullets"] = bullets[:8]

        citations = slide.get("citations") or []
        if not isinstance(citations, list):
            citations = []
        if len(citations) == 0 and fallback_citation.get("source_title"):
            citations = [fallback_citation]
        slide["citations"] = citations[:6]

        has_diagram = bool(str(slide.get("diagram_mermaid") or "").strip())
        has_table = isinstance(slide.get("table"), dict) and bool(
            (slide.get("table") or {}).get("headers") or (slide.get("table") or {}).get("rows")
        )
        has_chart = isinstance(slide.get("chart"), dict) and bool((slide.get("chart") or {}).get("type"))
        has_image = bool(
            str(slide.get("image_url") or "").strip()
            or str(slide.get("image_data_url") or "").strip()
        )

        if not (has_diagram or has_table or has_chart or has_image):
            if idx % 2 == 0:
                slide["diagram_mermaid"] = _build_default_mermaid(
                    str(slide.get("title") or f"Slide {idx + 1}"),
                    slide["bullets"],
                )
            elif idx % 3 == 1:
                slide["table"] = _build_default_table(slide["bullets"])
            else:
                slide["chart"] = _build_default_chart(slide["bullets"])
            slide["image_prompt"] = (
                "minimal flat icon illustration, clean corporate style, "
                f"topic: {str(slide.get('title') or '').strip()}"
            )

    deck["slides"] = slides
    if not str(deck.get("summary") or "").strip() and answer:
        deck["summary"] = _compact_text(answer, 180)
    return deck


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
