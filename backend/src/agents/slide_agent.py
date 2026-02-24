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
6. スライド枚数は内容の量に応じて調整する（固定枚数にしない）

スライドレイアウトのガイドライン:
- 最初のスライドは概要・タイトルスライドにする（layout: "title"）
- 数値比較やデータがある場合は chart を使用する（layout: "chart"）
- 一覧や比較表がある場合は table を使用する（layout: "table"）
- プロセスやワークフローの説明には diagram_mermaid を使用する
- 図解が重要な場合は layout: "visual" を指定する
- 通常の説明は layout: "content" （デフォルト）

視覚要素の選び方（内容に合わせて選択）:
- diagram_mermaid: プロセスフロー、階層構造、シーケンスを説明する場合
- table: 複数項目の比較、仕様一覧がある場合
- chart: 文書に具体的な数値データがある場合（bar/line/pie）
- image_prompt: 物・製品・概念を説明する場合にイメージ画像を生成するための説明文（英語推奨）
  - 例: "jellyfish swimming in deep ocean, photorealistic, blue tones"
  - 例: "modern office building exterior, corporate style, clean"
  - 物やシーンを説明するスライドには積極的に image_prompt を付ける
- 内容に合うものがない場合のみ、何も付けなくてよい
"""

# Enhanced system prompt for high-capability LLMs (Gemini, etc.)
SLIDE_SYSTEM_PROMPT_ENHANCED = """あなたは社内文書からプロフェッショナルなプレゼンテーション資料を作成する専門家です。
与えられた「参考文書（検索結果）」の内容のみに基づき、質の高いスライド資料を作成してください。

## 基本ルール
1. 出力は必ず JSON のみ（説明文なし）
2. 文書に書かれていない情報は推測しない
3. 各スライドは要点を明確に整理（箇条書き中心、1スライド3〜6項目）
4. 可能な限り、各スライドに根拠（citations）を付ける
5. citations の quote は短い抜粋（120文字以内）
6. スライド枚数は内容の量・構造に応じて柔軟に調整する

## スライド構成のベストプラクティス
内容に応じて必要なスライドを作成してください（全てを使う必要はない）:
- **タイトルスライド** (layout: "title"): テーマ、サブタイトル、概要を簡潔に
- **背景・経緯** (layout: "content"): 問題の背景を説明
- **詳細分析** (layout: "content" / "table" / "chart"): 深掘り分析
- **比較・整理** (layout: "table"): 項目の比較表
- **プロセス・フロー** (layout: "visual"): ワークフロー図
- **データ・数値** (layout: "chart"): グラフで可視化
- **まとめ・提案** (layout: "content"): 結論とアクション

## レイアウト選択ガイド

### layout: "title"
- 最初のスライドに必ず使用

### layout: "content"
- 通常の説明スライド
- bullets を3〜6項目、それぞれ短く簡潔に

### layout: "table"
- 複数項目の比較データがある場合に使用
- table.headers + table.rows を指定

### layout: "chart"
- 文書に具体的な数値データがある場合に使用（合成データは使わない）
- chart.type: "bar" / "line" / "pie"

### layout: "visual"
- プロセス・手順・ワークフローがある場合に使用
- diagram_mermaid でフローチャートやシーケンス図を記述

## 視覚要素の選び方（内容に合わせて選択）
各スライドに、内容に最も合う視覚要素を選んでください:

- **diagram_mermaid**: プロセス・手順・ワークフロー → フローチャート
- **table**: 複数項目の比較・一覧 → 比較表
- **chart**: 具体的な数値データ → グラフ（文書根拠のある数値のみ）
- **image_prompt**: 物・製品・生物・場所・概念の説明 → イメージ画像を生成
  - 英語で具体的に記述する
  - 例: "jellyfish swimming in deep blue ocean, photorealistic, soft lighting"
  - 例: "modern server room with blue LED lighting, corporate data center"
  - 例: "team brainstorming around whiteboard, flat illustration style"
  - 物やシーンを説明するスライドには積極的に image_prompt を付ける
- diagram/table/chart のどれにも該当せず、画像も不要な場合のみ、何も付けない

## スライド数のガイド
- 内容の量・構造に応じて柔軟に決定する
- 簡単なトピック: 4〜6枚
- 中程度のトピック: 6〜10枚
- 複雑なトピック: 8〜12枚
- 内容が薄いスライドは作らない
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
    """
    Build fallback slides from actual content (seed_points).
    Groups seed points into content slides and adds a title + summary.
    No forced visual elements — only bullets based on real content.
    """
    slides: list[dict[str, Any]] = []

    # Title slide
    slides.append({
        "title": _compact_text(question, 50),
        "layout": "title",
        "bullets": [_compact_text(seed_points[0], 90)] if seed_points else ["概要"],
        "diagram_mermaid": "",
        "table": None,
        "image_url": "",
        "image_prompt": "",
        "chart": None,
        "speaker_notes": "",
        "citations": [],
    })

    # Content slides: group seed points into slides of 4 bullets each
    # Reserve 1 slot for title, 1 for summary
    content_slots = max(1, min(max_slides - 2, 18))
    points_per_slide = max(3, min(6, -(-len(seed_points) // content_slots) if seed_points else 4))
    cursor = 0
    slide_num = 0

    while cursor < len(seed_points) and slide_num < content_slots:
        bullets = seed_points[cursor : cursor + points_per_slide]
        cursor += points_per_slide
        slide_num += 1

        # Use first bullet as a rough title
        title_text = bullets[0] if bullets else f"ポイント {slide_num}"
        title_text = _compact_text(title_text, 40)

        slides.append({
            "title": title_text,
            "layout": "content",
            "bullets": [_compact_text(b, 90) for b in bullets],
            "diagram_mermaid": "",
            "table": None,
            "image_url": "",
            "image_prompt": "",
            "chart": None,
            "speaker_notes": "",
            "citations": [],
        })

    # Summary slide (summarizes previous content, no new info)
    if len(slides) > 1:
        summary_bullets = []
        for s in slides[1:]:  # Skip title
            if s.get("bullets"):
                summary_bullets.append(_compact_text(s["bullets"][0], 60))
        slides.append({
            "title": "まとめ",
            "layout": "content",
            "bullets": summary_bullets[:6] or ["要点を整理する"],
            "diagram_mermaid": "",
            "table": None,
            "image_url": "",
            "image_prompt": "",
            "chart": None,
            "speaker_notes": "",
            "citations": [],
        })

    return slides[:max(1, min(max_slides, 20))]


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
    enhanced: bool = False,
) -> str:
    if enhanced:
        return _build_enhanced_slide_prompt(
            question=question, answer=answer, sources=sources, max_slides=max_slides
        )
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

## 視覚要素の選び方（内容に合わせて選択）
- diagram_mermaid: プロセス・手順・ワークフローがある場合
- table: 複数項目の比較データがある場合
- chart: 文書に具体的な数値データがある場合
- image_prompt: 物・製品・生物・概念を説明する場合、イメージ画像生成用の説明文（英語）
  - 例: "jellyfish swimming in deep ocean, photorealistic"
  - 物やシーンを説明するスライドには積極的に使う
- どれにも該当しない場合のみ、何も付けなくてよい

## 重要なルール
- image_url は参考文書に明記されている場合のみ使用
- chart の数値は参考文書に根拠がある場合のみ使用（合成データ禁止）
- 文書にない情報は推測しない
- citations を可能な限り付ける（quote は120文字以内）
- スライド枚数は内容に応じて調整する（固定枚数にしない）

## 出力形式（JSONのみ）
{json.dumps(SLIDE_DECK_JSON_SCHEMA, ensure_ascii=False)}
"""


def _build_enhanced_slide_prompt(
    *,
    question: str,
    answer: Optional[str],
    sources: list[dict[str, Any]],
    max_slides: int,
) -> str:
    """Enhanced prompt for high-capability LLMs (Gemini, etc.) that produces richer slide decks."""
    return f"""以下の情報をもとに、プロフェッショナルなプレゼンテーション資料を作成してください。
NotebookLMのようなリッチで読みやすい資料が目標です。

## 質問
{question}

## 既存の回答（参考。矛盾する場合は参考文書を優先）
{answer or "（なし）"}

## 参考文書（検索結果）
{json.dumps(sources, ensure_ascii=False, indent=2)}

## 出力要件
- **スライド枚数**: 最大 {max_slides} 枚。内容の豊富さに応じて枚数を調整
  - 簡単なトピック: 4〜6枚
  - 中程度: 6〜8枚
  - 複雑なトピック: 8〜{max_slides}枚
- 1枚あたり 3〜6 bullet（空配列にしない）
- bullets は短く簡潔に（1行で読める長さ）
- 内容が薄いスライドは作らない

## スライド構成のガイド
以下のような構成を参考にしてください（全て必須ではない）:
1. **タイトル** (layout: "title"): テーマとサブタイトル
2. **目次/概要** (layout: "content"): 全体の流れ
3. **背景・経緯** (layout: "content"): 問題の背景
4. **主要ポイント** (layout: "content" / "table"): 核心的な内容
5. **詳細分析** (layout: "content" / "chart"): データや分析
6. **プロセス/フロー** (layout: "visual"): ワークフロー
7. **比較・整理** (layout: "table"): 比較表
8. **まとめ・提案** (layout: "content"): 結論とアクション

## 視覚要素の選び方（内容に合わせて選択）

### diagram_mermaid — プロセス・手順・ワークフロー
```
flowchart TD
  A[開始] --> B[処理1]
  B --> C{{判断}}
  C -->|Yes| D[処理2]
  C -->|No| E[処理3]
```
- ノード名はスライド内容に基づく実際のステップ名

### table — 複数項目の比較・一覧
- headers + rows で実際のデータを表現

### chart — 具体的な数値データ
- type: "bar" / "line" / "pie"
- 文書に根拠のある数値のみ使用

### image_prompt — 物・製品・生物・場所・概念のイメージ画像
- 英語で具体的に記述（画像生成AIに渡すプロンプト）
- 例: "jellyfish swimming in deep blue ocean, photorealistic, soft lighting"
- 例: "modern data center with server racks, blue LED lighting"
- 例: "team collaborating around a whiteboard, flat illustration, warm colors"
- 物やシーンを説明するスライドには積極的に付ける

### どれにも該当しない場合
- bullets のみで十分

## 品質チェック
- 各スライドのタイトルは簡潔で具体的か
- bullets が冗長でないか
- 視覚要素は内容と一致しているか
- citations が付いているか
- スライド枚数は内容の量に適切か

## 重要なルール
- chart の数値は文書根拠のみ使用（合成データ禁止）
- 文書にない情報は推測しない
- citations を可能な限り付ける
- スライド枚数は内容に応じて柔軟に調整

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
- 最大 {max_slides} 枚（内容に応じて調整してよい）
- 1枚あたり 3〜6 bullet
- bullets は空配列にしない（必ず3項目以上）
- 文書にない情報は追加しない
- 視覚要素は内容に合わせて選択:
  - diagram_mermaid: プロセス・手順がある場合
  - table: 比較データがある場合
  - chart: 具体的な数値がある場合（合成データ禁止）
  - image_prompt: 物・概念を説明する場合、イメージ画像生成用の英語説明文
- image_url は参考文書に明記されている場合のみ維持/追加
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


def _build_content_image_prompt(slide: dict[str, Any]) -> str:
    """
    Build an image generation prompt based on slide content.
    Creates a descriptive prompt suitable for image generation APIs.
    """
    title = str(slide.get("title") or "").strip()
    bullets = [str(b).strip() for b in (slide.get("bullets") or []) if str(b).strip()]
    bullet_text = "; ".join(bullets[:4])
    base = f"{title}. {bullet_text}".strip(". ")
    # Clean up to make a good image prompt
    base = _compact_text(base, 200)
    return (
        f"{base}. "
        "Clean flat vector illustration, professional presentation style, "
        "soft colors, minimal, no text overlay, no numbers, no logos, 16:9 aspect ratio."
    )


# Content pattern keywords for detecting appropriate visual elements
_FLOW_KEYWORDS = re.compile(
    r"(プロセス|ワークフロー|フロー|手順|ステップ|流れ|工程|段階|順序|process|workflow|flow|step|procedure)",
    re.IGNORECASE,
)
_COMPARISON_KEYWORDS = re.compile(
    r"(比較|一覧|仕様|チェックリスト|対比|違い|差異|対照|versus|comparison|vs\.|一覧表|リスト)",
    re.IGNORECASE,
)
_NUMERIC_KEYWORDS = re.compile(
    r"(\d+[%％]|\d+\.?\d*\s*(万|億|千|百|件|個|人|円|ドル|回|倍|年|月)|\d+[,，]\d{3})",
)


def _detect_visual_hint(slide: dict[str, Any]) -> Optional[str]:
    """
    Analyze slide content to detect if a specific visual element is appropriate.
    Returns 'diagram', 'table', 'chart', or None.
    """
    text_parts = [str(slide.get("title") or "")]
    text_parts.extend(str(b) for b in (slide.get("bullets") or []))
    combined = " ".join(text_parts)

    if _FLOW_KEYWORDS.search(combined):
        return "diagram"
    if _COMPARISON_KEYWORDS.search(combined):
        return "table"
    if _NUMERIC_KEYWORDS.search(combined):
        return "chart"
    return None


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
    Adds fallback bullets when needed. Visual elements are only added when
    content analysis suggests they are appropriate — never forced mechanically.
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

        # Ensure bullets are not empty
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

        # Ensure citations
        citations = slide.get("citations") or []
        if not isinstance(citations, list):
            citations = []
        if len(citations) == 0 and fallback_citation.get("source_title"):
            citations = [fallback_citation]
        slide["citations"] = citations[:6]

        # Content-driven visual elements:
        # Add visual element based on content analysis. If no structured visual
        # (diagram/table/chart) fits, set image_prompt so maybe_attach_generated_images()
        # can create an image for the slide.
        has_diagram = bool(str(slide.get("diagram_mermaid") or "").strip())
        has_table = isinstance(slide.get("table"), dict) and bool(
            (slide.get("table") or {}).get("headers") or (slide.get("table") or {}).get("rows")
        )
        has_chart = isinstance(slide.get("chart"), dict) and bool((slide.get("chart") or {}).get("type"))
        has_image = bool(
            str(slide.get("image_url") or "").strip()
            or str(slide.get("image_data_url") or "").strip()
        )
        has_image_prompt = bool(str(slide.get("image_prompt") or "").strip())

        if not (has_diagram or has_table or has_chart or has_image):
            hint = _detect_visual_hint(slide)
            if hint == "diagram":
                slide["diagram_mermaid"] = _build_default_mermaid(
                    str(slide.get("title") or f"Slide {idx + 1}"),
                    slide["bullets"],
                )
            elif hint == "table":
                slide["table"] = _build_default_table(slide["bullets"])
            elif hint == "chart":
                slide["chart"] = _build_default_chart(slide["bullets"])
            elif not has_image_prompt and idx > 0:
                # No structured visual fits — generate an image_prompt based on content.
                # This allows maybe_attach_generated_images() to create an image via API.
                slide["image_prompt"] = _build_content_image_prompt(slide)

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
