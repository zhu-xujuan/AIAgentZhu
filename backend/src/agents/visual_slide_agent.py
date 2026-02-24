"""
Visual Slide Agent
Generates visually rich slide decks where each slide is an AI-generated image.
Uses a 2-phase approach: outline generation (fast) -> image generation (parallel SSE).
Inspired by baoyu-slide-deck's style system.
"""

from __future__ import annotations

import json
import logging
import re
from typing import Any, Optional, TYPE_CHECKING

if TYPE_CHECKING:
    from src.llm.ai_client import AIClient

logger = logging.getLogger(__name__)


# ============================================================
# Style Presets (baoyu-inspired 4-dimension system, simplified)
# ============================================================

STYLE_PRESETS: dict[str, dict[str, Any]] = {
    "blueprint": {
        "label": "Blueprint",
        "description": "Technical grid, cool blue tones, monospace typography",
        "texture": "grid paper with subtle technical blueprint lines",
        "mood": "cool blue, professional, analytical",
        "typography": "technical monospace, clean labels",
        "density": "balanced, moderate whitespace",
    },
    "corporate": {
        "label": "Corporate",
        "description": "Clean white, professional blue-gray, geometric sans-serif",
        "texture": "clean white with subtle gradient accents",
        "mood": "professional blue-gray, trustworthy, polished",
        "typography": "geometric sans-serif, modern headings",
        "density": "balanced, generous margins",
    },
    "minimal": {
        "label": "Minimal",
        "description": "Flat white, neutral monochrome, geometric light",
        "texture": "flat white, almost no texture",
        "mood": "neutral monochrome, zen-like calm",
        "typography": "geometric light weight, minimal labels",
        "density": "minimal, lots of breathing room",
    },
    "sketch-notes": {
        "label": "Sketch Notes",
        "description": "Cream paper, warm earth tones, handwritten style",
        "texture": "cream/beige paper with subtle grain",
        "mood": "warm earth tones, approachable, creative",
        "typography": "handwritten/marker style, informal labels",
        "density": "balanced, organic placement",
    },
    "dark-atmospheric": {
        "label": "Dark Atmospheric",
        "description": "Deep dark, dramatic high-contrast, editorial serif",
        "texture": "deep dark surface with subtle depth",
        "mood": "dramatic, high-contrast, sophisticated",
        "typography": "editorial serif headings, clean sans body",
        "density": "balanced, dramatic spacing",
    },
    "bold-editorial": {
        "label": "Bold Editorial",
        "description": "Bold color blocks, vibrant saturated, large editorial",
        "texture": "bold flat color blocks with sharp edges",
        "mood": "vibrant, saturated, energetic",
        "typography": "large editorial display type, impactful",
        "density": "balanced, bold proportions",
    },
    "pptx-cards": {
        "label": "PPTX Native",
        "description": "Card-based layout with indigo accents, no LLM needed",
        "texture": "clean white with card elevation shadows",
        "mood": "professional indigo, structured, clear",
        "typography": "system sans-serif, clean hierarchy",
        "density": "balanced, card grid layout",
    },
}

DEFAULT_PRESET = "pptx-cards"


# ============================================================
# Outline generation
# ============================================================

OUTLINE_SYSTEM_PROMPT = """あなたは "The Architect" です。プレゼンテーションのスライド構成を設計する専門家です。

あなたの仕事：
- ユーザーの質問と参考文書に基づき、スライドのアウトライン（構成）を作成する
- 各スライドは1つの明確なメッセージを伝える
- 視覚的に映えるレイアウトと内容を提案する
- 出力は JSON のみ（説明文なし）

重要なルール：
1. 文書に書かれていない情報は推測しない
2. 各スライドは1メッセージに絞る
3. text_elements は画像に実際に描画されるテキスト（短く、読みやすく）
4. visual_description は画像生成AIへの指示（具体的に）
5. 最初のスライドは cover、最後は back-cover にする
"""

OUTLINE_JSON_SCHEMA = {
    "title": "string (deck title)",
    "slides": [
        {
            "slide_number": "number",
            "title": "string (slide title)",
            "type": "cover | content | back-cover",
            "key_message": "string (one clear message this slide conveys)",
            "visual_description": "string (what visuals/icons/diagrams to show)",
            "layout": "title-hero | split-screen | icon-grid | hub-spoke | timeline | comparison | quote | data-chart",
            "text_elements": ["string (actual text to render on slide, 2-5 items)"],
        }
    ],
}


def build_outline_prompt(
    *,
    question: str,
    answer: Optional[str],
    sources_text: str,
    max_slides: int,
) -> str:
    return f"""以下の情報をもとに、ビジュアルスライドのアウトライン（構成）を作成してください。
各スライドは画像として生成されるため、視覚的な内容の説明が重要です。

## 質問
{question}

## 既存の回答（参考）
{answer or "（なし）"}

## 参考文書（検索結果）
{sources_text}

## 出力要件
- スライド枚数: {max_slides} 枚（最初はcover、最後はback-cover）
- 各スライドに明確な key_message を1つ
- text_elements は画像に実際に描画するテキスト（2〜5項目、短く簡潔に）
- visual_description は画像生成AIへの具体的な指示
- layout は視覚的に最適なものを選択

## 出力形式（JSONのみ）
{json.dumps(OUTLINE_JSON_SCHEMA, ensure_ascii=False)}
"""


async def build_outline_with_llm(
    *,
    question: str,
    answer: Optional[str],
    client: "AIClient",
    max_slides: int = 15,
) -> dict[str, Any]:
    """
    Build a rich outline using the LLM (e.g. Gemini).
    Falls back to build_outline_from_answer() on any failure.
    """
    try:
        prompt = build_outline_prompt(
            question=question,
            answer=answer,
            sources_text=answer or "(なし)",
            max_slides=max_slides,
        )
        raw, err = await client.generate_json(
            prompt=prompt,
            system=OUTLINE_SYSTEM_PROMPT,
            temperature=0.3,
        )
        if err or raw is None:
            logger.warning(f"[VISUAL_SLIDES] LLM outline failed: {err}, falling back")
            return build_outline_from_answer(question=question, answer=answer, max_slides=max_slides)

        outline = normalize_outline(raw)

        # Ensure we have at least 3 slides
        if len(outline.get("slides", [])) < 3:
            logger.warning("[VISUAL_SLIDES] LLM outline too short, falling back")
            return build_outline_from_answer(question=question, answer=answer, max_slides=max_slides)

        return outline
    except Exception as e:
        logger.warning(f"[VISUAL_SLIDES] LLM outline error: {e}, falling back")
        return build_outline_from_answer(question=question, answer=answer, max_slides=max_slides)


def normalize_outline(raw: Any) -> dict[str, Any]:
    """Normalize LLM output into a stable outline structure."""
    if not isinstance(raw, dict):
        raise ValueError("Outline JSON must be an object")

    title = str(raw.get("title") or "Visual Slides").strip()
    slides_in = raw.get("slides") or []
    if not isinstance(slides_in, list):
        slides_in = []

    slides_out: list[dict[str, Any]] = []
    for i, s in enumerate(slides_in):
        if not isinstance(s, dict):
            continue

        slide_title = str(s.get("title") or f"Slide {i + 1}").strip()
        slide_type = str(s.get("type") or "content").strip().lower()
        if slide_type not in ("cover", "content", "back-cover"):
            slide_type = "content"

        key_message = str(s.get("key_message") or "").strip()
        visual_description = str(s.get("visual_description") or "").strip()
        layout = str(s.get("layout") or "split-screen").strip().lower()

        text_elements = s.get("text_elements") or []
        if isinstance(text_elements, str):
            text_elements = [line.strip() for line in text_elements.splitlines() if line.strip()]
        if not isinstance(text_elements, list):
            text_elements = []
        text_elements = [str(t).strip() for t in text_elements if str(t).strip()]

        # Detect content hints from title and text_elements
        body_text = " ".join(text_elements)
        content_hints = _detect_content_hints(slide_title, body_text)

        slides_out.append({
            "slide_number": i + 1,
            "title": slide_title,
            "type": slide_type,
            "key_message": key_message,
            "visual_description": visual_description,
            "layout": layout,
            "text_elements": text_elements[:6],
            "content_hints": content_hints,
        })

    return {"title": title, "slides": slides_out}


# ============================================================
# Image prompt builder
# ============================================================

_ARCHITECT_BASE = """You are The Architect, a world-class presentation designer.
Create a single slide image for a professional presentation.

CRITICAL RULES:
- Style: hand-drawn / illustration / infographic style — NEVER photorealistic
- Aspect ratio: 16:9 landscape
- All text must be CLEARLY READABLE (large, high-contrast)
- Use icons, diagrams, visual metaphors — NOT stock photos
- One slide = one clear message
- Keep it clean, professional, visually striking
- NO watermarks, NO logos, NO borders
"""


def build_slide_image_prompt(
    *,
    slide: dict[str, Any],
    style_preset: str,
    deck_title: str,
) -> str:
    """Build a detailed image generation prompt for a single slide."""
    preset = STYLE_PRESETS.get(style_preset, STYLE_PRESETS[DEFAULT_PRESET])

    slide_type = slide.get("type", "content")
    layout = slide.get("layout", "split-screen")
    title = slide.get("title", "")
    key_message = slide.get("key_message", "")
    visual_desc = slide.get("visual_description", "")
    text_elements = slide.get("text_elements", [])

    # Build text elements section
    text_section = ""
    if text_elements:
        items = "\n".join(f'  - "{t}"' for t in text_elements[:5])
        text_section = f"""
TEXT TO RENDER ON SLIDE (must be clearly readable):
{items}
"""

    prompt = f"""{_ARCHITECT_BASE}

STYLE:
- Texture: {preset['texture']}
- Mood: {preset['mood']}
- Typography: {preset['typography']}
- Density: {preset['density']}

SLIDE TYPE: {slide_type}
LAYOUT: {layout}
DECK TITLE: {deck_title}

SLIDE TITLE: {title}
KEY MESSAGE: {key_message}

VISUAL CONTENT: {visual_desc}
{text_section}
Generate this single slide image now. Make it visually compelling and professional.
"""
    return prompt.strip()


def format_sources_for_outline(sources: list[dict[str, Any]]) -> str:
    """Format sources into a compact text block for the outline prompt."""
    if not sources:
        return "(参考文書なし)"
    parts = []
    for s in sources[:6]:
        doc_name = s.get("document_name", "")
        meta = s.get("meta", "")
        text = s.get("text", "")
        header = f"[{doc_name}]"
        if meta:
            header += f" ({meta})"
        parts.append(f"{header}\n{text}")
    return "\n\n".join(parts)


# ============================================================
# Build outline from answer (no LLM needed)
# ============================================================

_LAYOUT_CYCLE = [
    "title-hero",
    "split-screen",
    "icon-grid",
    "hub-spoke",
    "split-screen",
    "timeline",
    "comparison",
    "data-chart",
    "split-screen",
    "quote",
]

_VISUAL_HINTS = {
    "概要": "overview diagram with key topics as connected nodes",
    "背景": "contextual illustration with timeline or history elements",
    "課題": "warning icons and problem indicators in a structured layout",
    "問題": "warning icons and problem indicators in a structured layout",
    "解決": "lightbulb and solution pathway diagram",
    "提案": "lightbulb and solution pathway diagram",
    "比較": "side-by-side comparison chart with icons",
    "分析": "analytical chart with magnifying glass icon",
    "データ": "bar chart or pie chart with data visualization",
    "プロセス": "step-by-step workflow with numbered stages",
    "ワークフロー": "flowchart with arrows connecting process stages",
    "計画": "roadmap or timeline with milestones",
    "まとめ": "checklist with key takeaways highlighted",
    "結論": "target icon with key conclusions",
    "ポイント": "bullet points with emphasis icons",
}


def _compact(text: str, max_len: int = 80) -> str:
    text = re.sub(r"\s+", " ", (text or "").strip())
    if len(text) <= max_len:
        return text
    return text[: max_len - 1].rstrip() + "…"


def _split_answer_into_sections(answer: str) -> list[dict[str, str]]:
    """Split answer text into logical sections by headings or paragraphs."""
    if not answer or not answer.strip():
        return []

    lines = answer.strip().splitlines()
    sections: list[dict[str, str]] = []
    current_title = ""
    current_body: list[str] = []

    for line in lines:
        stripped = line.strip()
        if not stripped:
            continue

        # Detect heading patterns: ##, **, 1., 【】
        is_heading = False
        heading_text = stripped

        if re.match(r"^#{1,4}\s+", stripped):
            heading_text = re.sub(r"^#{1,4}\s+", "", stripped).strip()
            is_heading = True
        elif re.match(r"^\*\*[^*]+\*\*\s*$", stripped):
            heading_text = stripped.strip("* ").strip()
            is_heading = True
        elif re.match(r"^【[^】]+】", stripped):
            heading_text = re.search(r"【([^】]+)】", stripped).group(1)
            is_heading = True
        elif re.match(r"^\d+[.）)]\s+.{2,30}$", stripped) and len(stripped) < 40:
            heading_text = re.sub(r"^\d+[.）)]\s+", "", stripped).strip()
            is_heading = True

        if is_heading:
            # Save previous section
            if current_title or current_body:
                sections.append({
                    "title": current_title or _compact(current_body[0] if current_body else "セクション", 40),
                    "body": "\n".join(current_body),
                })
            current_title = _compact(heading_text, 40)
            current_body = []
        else:
            current_body.append(stripped)

    # Save last section
    if current_title or current_body:
        sections.append({
            "title": current_title or _compact(current_body[0] if current_body else "セクション", 40),
            "body": "\n".join(current_body),
        })

    return sections


def _extract_text_elements(body: str, max_items: int = 4) -> list[str]:
    """Extract key points from body text as text_elements."""
    if not body:
        return []
    lines = body.strip().splitlines()
    elements: list[str] = []
    for line in lines:
        cleaned = re.sub(r"^[-・●▪▸*]\s*", "", line.strip())
        cleaned = re.sub(r"^\d+[.）)]\s*", "", cleaned)
        cleaned = cleaned.strip()
        if len(cleaned) >= 4:
            elements.append(_compact(cleaned, 60))
        if len(elements) >= max_items:
            break
    return elements


def _guess_visual_description(title: str, body: str) -> str:
    """Guess a visual description based on section title/content."""
    for keyword, hint in _VISUAL_HINTS.items():
        if keyword in title or keyword in (body or "")[:100]:
            return hint
    return "clean infographic with icons illustrating the key message"


def _detect_content_hints(title: str, body: str) -> list[str]:
    """Detect content type hints from section title and body text."""
    hints: list[str] = []
    combined = f"{title} {body or ''}"

    # Statistics: numbers, percentages, units
    if re.search(r"\d+[%％]|\d+\.\d+|\d{2,}[万億千百]|増加|減少|成長|割合|平均|合計", combined):
        hints.append("statistics")

    # List: bullet markers or numbered items
    list_lines = re.findall(r"^[\s]*[-・●▪▸*]\s", body or "", re.MULTILINE)
    numbered_lines = re.findall(r"^[\s]*\d+[.）)]\s", body or "", re.MULTILINE)
    if len(list_lines) >= 3 or len(numbered_lines) >= 3:
        hints.append("list")

    # Comparison expressions
    if re.search(r"比較|対比|versus|vs\.?|に対して|一方|他方|それぞれ|メリット.*デメリット|長所.*短所|違い", combined, re.IGNORECASE):
        hints.append("comparison")

    # Flow/process
    if re.search(r"手順|ステップ|フロー|流れ|工程|プロセス|順番|段階|step|phase|workflow", combined, re.IGNORECASE):
        hints.append("flow")

    return hints


# ============================================================
# HTML slide generation (LLM-based)
# ============================================================

SLIDE_HTML_SYSTEM_PROMPT = """あなたはプレゼンテーションスライドのHTMLデザイナーです。
1枚のスライドを表すHTML+インラインCSSを生成してください。

【出力ルール】
1. <div>要素1つのみを出力（説明文やマークダウン不要）
2. ルートdivは width:1280px, height:720px, overflow:hidden
3. CSSはすべてインラインスタイルで記述
4. 外部リソース（画像URL、CDN等）は使用しない
5. テキストは日本語でも英語でも読みやすいサイズ
6. テキスト要素（見出し、本文、リスト項目、テーブルセル等）には data-editable="true" 属性を付与
7. font-family: 'Segoe UI', 'Hiragino Sans', sans-serif を使用

【デザイン指針】
- モダンでプロフェッショナルなデザイン
- アクセントカラーをデコレーション（ライン、ブロック、グラデーション、ボーダー等）に活用
- 適切な余白とタイポグラフィ階層
- 図形的要素（丸、線、ブロック）でビジュアル的な豊かさを加える

【インラインSVGアイコン例】（外部画像の代わりに使用）
- チェック: <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#10B981" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>
- 矢印右: <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>
- 電球: <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#F59E0B" stroke-width="2"><path d="M9 18h6M10 22h4M12 2a7 7 0 0 0-4 12.7V17h8v-2.3A7 7 0 0 0 12 2z"/></svg>
- 警告: <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#EF4444" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
- グラフ: <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#6366F1" stroke-width="2"><rect x="3" y="12" width="4" height="9" rx="1"/><rect x="10" y="7" width="4" height="14" rx="1"/><rect x="17" y="3" width="4" height="18" rx="1"/></svg>
サイズは自由に変更してください（width/height属性）。色もstroke/fillで変更可能です。

【CSSビジュアル技法】
- バーチャート: <div style="width:70%;height:24px;background:#6366F1;border-radius:4px;"></div>（幅で値を表現）
- プログレスバー: 背景グレー + 内側カラーdivで割合を表現
- 矢印コネクタ: border-top + border-right + transform:rotate(45deg) で三角矢印
- 番号付きステップ: border-radius:50% の丸 + 番号 → 矢印 → 次のステップ
- テーブル: display:table / grid + ヘッダー背景色 + 交互行色

【コンテンツタイプ別の詳細ガイドライン】
- 統計データ・数値がある場合:
  → CSSテーブル（ヘッダー濃色、交互行）またはCSSバーチャート（div幅で表現）
  → 重要数値は大きなフォントサイズ(36px+)で強調表示
- 複数の項目・説明がある場合:
  → CSS Gridで2x2や3列のカードレイアウト
  → 各カードにSVGアイコン + タイトル + 説明文
- フロー・手順の場合:
  → ステップ形式（番号付き丸＋SVG矢印＋ステップ説明）
  → 水平または垂直のフロー表現
- 比較の場合:
  → 左右対比の2カラムレイアウト
  → 各列にヘッダー色を変えて対比を明確に
- タイトルスライドの場合:
  → 大きなタイポグラフィ＋グラデーション背景
  → 装飾的なSVG要素や図形で華やかさを追加
- 画像付きスライドの場合:
  → has_image指示がある場合、IMAGE_PLACEHOLDER をHTML内に配置
  → <div style="width:400px;height:300px;background:#f3f4f6;display:flex;align-items:center;justify-content:center;">IMAGE_PLACEHOLDER</div>"""


IMAGE_PLACEHOLDER = "IMAGE_PLACEHOLDER"


def build_slide_html_prompt(
    *,
    slide: dict[str, Any],
    style_preset: str,
    deck_title: str,
    has_image: bool = False,
) -> str:
    """Build a prompt for LLM to generate HTML for a single slide."""
    preset = STYLE_PRESETS.get(style_preset, STYLE_PRESETS[DEFAULT_PRESET])

    slide_type = slide.get("type", "content")
    layout = slide.get("layout", "split-screen")
    title = slide.get("title", "")
    key_message = slide.get("key_message", "")
    text_elements = slide.get("text_elements", [])
    content_hints = slide.get("content_hints", [])

    text_section = ""
    if text_elements:
        items = "\n".join(f"  - {t}" for t in text_elements[:5])
        text_section = f"\nスライドに表示するテキスト:\n{items}\n"

    hints_section = ""
    if content_hints:
        hint_map = {
            "statistics": "このスライドには統計・数値データがあります。CSSテーブルやバーチャートで視覚化してください。",
            "list": "このスライドには複数項目があります。CSS Gridカードレイアウトやアイコン付きリストで表現してください。",
            "comparison": "このスライドには比較内容があります。左右対比の2カラムレイアウトで表現してください。",
            "flow": "このスライドにはフロー・手順があります。ステップ形式（番号付き丸＋矢印）で表現してください。",
        }
        hint_lines = [hint_map.get(h, "") for h in content_hints if h in hint_map]
        if hint_lines:
            hints_section = "\nコンテンツヒント:\n" + "\n".join(f"  - {h}" for h in hint_lines) + "\n"

    image_section = ""
    if has_image:
        image_section = f"\n画像指示: このスライドには生成画像が提供されます。HTML内に文字列 {IMAGE_PLACEHOLDER} を含む<img>タグまたは背景div要素を1つ配置してください。例: <div style=\"width:400px;height:300px;background:#f3f4f6;display:flex;align-items:center;justify-content:center;\">{IMAGE_PLACEHOLDER}</div>\n"

    return f"""以下のスライド情報に基づいて、1枚分のHTMLを生成してください。

スタイル:
- テクスチャ: {preset['texture']}
- ムード: {preset['mood']}
- タイポグラフィ: {preset['typography']}
- 密度: {preset['density']}

スライド種別: {slide_type}
レイアウト: {layout}
デッキタイトル: {deck_title}
スライドタイトル: {title}
キーメッセージ: {key_message}
{text_section}{hints_section}{image_section}
ルートdivの width:1280px, height:720px で1つの<div>を出力してください。
テキスト要素には data-editable="true" 属性を付与してください。"""


def extract_html_from_response(text: str) -> str:
    """Extract HTML from LLM response, stripping code fences if present."""
    text = text.strip()

    # Try to extract from code fences: ```html ... ``` or ``` ... ```
    fence_match = re.search(r"```(?:html)?\s*\n?(.*?)```", text, re.DOTALL)
    if fence_match:
        text = fence_match.group(1).strip()

    # Ensure it starts with a <div
    div_match = re.search(r"(<div[\s>].*)", text, re.DOTALL)
    if div_match:
        text = div_match.group(1)

    return text


def generate_fallback_html(
    *,
    slide: dict[str, Any],
    style_preset: str,
    deck_title: str,
) -> str:
    """
    Generate basic styled HTML for a single slide without LLM.
    Used as fallback when LLM generation fails.
    """
    preset = STYLE_PRESETS.get(style_preset, STYLE_PRESETS[DEFAULT_PRESET])
    slide_type = slide.get("type", "content")
    title = slide.get("title", "")
    key_message = slide.get("key_message", "")
    text_elements = slide.get("text_elements", [])

    # Color schemes per preset
    PRESET_THEMES: dict[str, dict[str, str]] = {
        "blueprint": {"bg": "#0F172A", "bg2": "#1E293B", "accent": "#38BDF8", "text": "#F1F5F9", "muted": "#94A3B8"},
        "corporate": {"bg": "#FFFFFF", "bg2": "#F8FAFC", "accent": "#3B82F6", "text": "#1E293B", "muted": "#64748B"},
        "minimal": {"bg": "#FFFFFF", "bg2": "#F9FAFB", "accent": "#6B7280", "text": "#111827", "muted": "#9CA3AF"},
        "sketch-notes": {"bg": "#FFFBEB", "bg2": "#FEF3C7", "accent": "#D97706", "text": "#451A03", "muted": "#92400E"},
        "dark-atmospheric": {"bg": "#18181B", "bg2": "#27272A", "accent": "#A78BFA", "text": "#F4F4F5", "muted": "#A1A1AA"},
        "bold-editorial": {"bg": "#FFFFFF", "bg2": "#FDF2F8", "accent": "#EC4899", "text": "#1F2937", "muted": "#6B7280"},
    }
    theme = PRESET_THEMES.get(style_preset, PRESET_THEMES["corporate"])
    bg, bg2, accent, txt, muted = theme["bg"], theme["bg2"], theme["accent"], theme["text"], theme["muted"]

    base = f"width:1280px;height:720px;overflow:hidden;font-family:'Segoe UI','Hiragino Sans',sans-serif;position:relative;"

    # Cover / back-cover
    if slide_type in ("cover", "back-cover"):
        subtitle = key_message if slide_type == "cover" else "ご清聴ありがとうございました"
        main_title = deck_title if slide_type == "cover" else title
        return f'''<div style="{base}background:linear-gradient(135deg,{accent} 0%,{bg2} 100%);display:flex;align-items:center;justify-content:center;">
  <div style="text-align:center;width:80%;">
    <h1 data-editable="true" style="font-size:44px;font-weight:700;color:#fff;margin:0 0 20px 0;line-height:1.3;text-shadow:0 2px 8px rgba(0,0,0,0.3);">{main_title}</h1>
    <h2 data-editable="true" style="font-size:20px;font-weight:400;color:rgba(255,255,255,0.85);margin:0;line-height:1.5;">{subtitle}</h2>
  </div>
</div>'''

    # Content slide — rich visual layout with icons and grid
    # SVG icons pool for visual variety
    _ICONS = [
        f'<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="{accent}" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>',
        f'<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="{accent}" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/></svg>',
        f'<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="{accent}" stroke-width="2"><path d="M12 2a7 7 0 0 0-4 12.7V17h8v-2.3A7 7 0 0 0 12 2z"/><line x1="10" y1="22" x2="14" y2="22"/></svg>',
        f'<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="{accent}" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="9" y1="3" x2="9" y2="21"/></svg>',
        f'<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="{accent}" stroke-width="2"><rect x="3" y="12" width="4" height="9" rx="1"/><rect x="10" y="7" width="4" height="14" rx="1"/><rect x="17" y="3" width="4" height="18" rx="1"/></svg>',
        f'<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="{accent}" stroke-width="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>',
    ]

    content_body = ""
    n = len(text_elements)

    if n >= 4:
        # Grid card layout for 4+ items
        cols = 2 if n <= 6 else 3
        cards = "".join(
            f'<div style="background:{bg2};border-radius:12px;padding:20px 24px;border-left:4px solid {accent};">'
            f'<div style="display:flex;align-items:center;gap:10px;margin-bottom:8px;">'
            f'{_ICONS[i % len(_ICONS)]}'
            f'<h3 data-editable="true" style="font-size:17px;font-weight:600;color:{txt};margin:0;">{_compact(el.split("：")[0].split(":")[0], 40)}</h3>'
            f'</div>'
            f'<p data-editable="true" style="font-size:14px;color:{muted};line-height:1.5;margin:0;">{_compact(el, 120)}</p>'
            f'</div>'
            for i, el in enumerate(text_elements[:6])
        )
        content_body = f'<div style="display:grid;grid-template-columns:repeat({cols},1fr);gap:20px;margin-top:24px;">{cards}</div>'
    elif n >= 2:
        # Two-column split layout with icons
        items = "".join(
            f'<div style="display:flex;align-items:flex-start;gap:16px;margin-bottom:20px;background:{bg2};border-radius:10px;padding:18px 20px;">'
            f'<div style="flex-shrink:0;width:44px;height:44px;border-radius:10px;background:{accent}15;display:flex;align-items:center;justify-content:center;">'
            f'{_ICONS[i % len(_ICONS)]}</div>'
            f'<div>'
            f'<p data-editable="true" style="font-size:17px;color:{txt};line-height:1.6;margin:0;font-weight:500;">{el}</p>'
            f'</div></div>'
            for i, el in enumerate(text_elements[:6])
        )
        content_body = f'<div style="margin-top:24px;">{items}</div>'
    elif n == 1:
        # Single key message with large styling
        content_body = (
            f'<div style="margin-top:40px;padding:32px;background:{bg2};border-radius:16px;border-left:5px solid {accent};">'
            f'<div style="display:flex;align-items:center;gap:16px;">'
            f'{_ICONS[0]}'
            f'<p data-editable="true" style="font-size:22px;color:{txt};line-height:1.6;margin:0;font-weight:500;">{text_elements[0]}</p>'
            f'</div></div>'
        )

    key_msg_html = ""
    if key_message and key_message != (text_elements[0] if text_elements else ""):
        key_msg_html = f'<p data-editable="true" style="font-size:15px;color:{muted};margin:8px 0 0 0;">{_compact(key_message, 100)}</p>'

    # Decorative accent shape
    deco = (
        f'<div style="position:absolute;top:0;right:0;width:200px;height:200px;'
        f'background:linear-gradient(135deg,{accent}10 0%,transparent 60%);border-bottom-left-radius:100%;"></div>'
    )

    return f'''<div style="{base}background:{bg};">
  {deco}
  <div style="padding:48px 56px;position:relative;z-index:1;">
    <div style="display:flex;align-items:center;gap:12px;margin-bottom:4px;">
      <div style="width:5px;height:36px;background:{accent};border-radius:3px;"></div>
      <h2 data-editable="true" style="font-size:32px;font-weight:700;color:{txt};margin:0;">{title}</h2>
    </div>
    {key_msg_html}
    {content_body}
  </div>
  <div style="position:absolute;bottom:0;left:0;right:0;height:36px;background:{bg2};border-top:1px solid {accent}20;display:flex;align-items:center;justify-content:space-between;padding:0 32px;">
    <span style="font-size:11px;color:{muted};">{deck_title}</span>
  </div>
</div>'''


def build_outline_from_answer(
    *,
    question: str,
    answer: Optional[str],
    max_slides: int = 15,
) -> dict[str, Any]:
    """
    Build an outline directly from the answer text without LLM.
    Parses headings/paragraphs and creates a structured outline.
    """
    deck_title = _compact(question, 60)
    sections = _split_answer_into_sections(answer or "")

    # If no sections parsed, create a simple 3-slide deck
    if not sections:
        return {
            "title": deck_title,
            "slides": [
                {
                    "slide_number": 1,
                    "title": deck_title,
                    "type": "cover",
                    "key_message": question,
                    "visual_description": "title slide with bold typography and subtle background pattern",
                    "layout": "title-hero",
                    "text_elements": [deck_title],
                },
                {
                    "slide_number": 2,
                    "title": "内容",
                    "type": "content",
                    "key_message": _compact(answer or question, 80),
                    "visual_description": "clean infographic with icons",
                    "layout": "split-screen",
                    "text_elements": [_compact(answer or "", 60)] if answer else [question],
                },
                {
                    "slide_number": 3,
                    "title": "まとめ",
                    "type": "back-cover",
                    "key_message": "ご清聴ありがとうございました",
                    "visual_description": "closing slide with thank you message and summary icons",
                    "layout": "title-hero",
                    "text_elements": ["まとめ", "ご清聴ありがとうございました"],
                },
            ],
        }

    # Build slides from sections
    # Reserve first and last for cover/back-cover
    content_budget = max(1, min(max_slides - 2, len(sections)))
    selected_sections = sections[:content_budget]

    slides: list[dict[str, Any]] = []

    # Cover slide
    cover_message = selected_sections[0]["title"] if selected_sections else question
    slides.append({
        "slide_number": 1,
        "title": deck_title,
        "type": "cover",
        "key_message": _compact(cover_message, 80),
        "visual_description": "title slide with bold typography, subtle abstract background, topic icons",
        "layout": "title-hero",
        "text_elements": [deck_title],
    })

    # Content slides
    for i, section in enumerate(selected_sections):
        layout = _LAYOUT_CYCLE[(i + 1) % len(_LAYOUT_CYCLE)]
        text_elements = _extract_text_elements(section["body"])
        if not text_elements:
            text_elements = [section["title"]]

        content_hints = _detect_content_hints(section["title"], section["body"])

        slides.append({
            "slide_number": i + 2,
            "title": section["title"],
            "type": "content",
            "key_message": _compact(section["body"], 80) if section["body"] else section["title"],
            "visual_description": _guess_visual_description(section["title"], section["body"]),
            "layout": layout,
            "text_elements": text_elements,
            "content_hints": content_hints,
        })

    # Back-cover slide
    slides.append({
        "slide_number": len(slides) + 1,
        "title": "まとめ",
        "type": "back-cover",
        "key_message": "ご清聴ありがとうございました",
        "visual_description": "closing slide with thank you message, summary checklist icons, clean design",
        "layout": "title-hero",
        "text_elements": ["まとめ", "ご清聴ありがとうございました"],
    })

    return {"title": deck_title, "slides": slides}


# ============================================================
# HTML Slide Pipeline: 2-step (Plan MD → Render HTML)
# ============================================================

HTML_SLIDE_PLAN_SYSTEM_PROMPT = """あなたはプレゼン構成の専門家です。
Markdown形式で各スライドの構成計画を出力してください。

【重要: 各スライドに必ず「表示テキスト」を含めること】
各スライドには、実際にスライド上に表示するテキスト項目を箇条書きで列挙してください。
曖昧な要約（例:「○○について説明」）ではなく、具体的な文言（例:「生産量: 年間5000トン」）を記述してください。

【出力形式】

# {プレゼンタイトル}

## スライド1: {タイトル}
- タイプ: cover
- 表示テキスト:
  - {メインタイトル}
  - 発表日: 20XX年XX月XX日
  - 発表者: ○○部
- デザイン: グラデーション背景（#1E3A5F → #2563EB）、大きな白文字タイポグラフィ
- レイアウト: 中央揃え

## スライド2: {タイトル}
- タイプ: content
- 表示テキスト:
  - {実際にスライドに載せる箇条書き1}
  - {実際にスライドに載せる箇条書き2}
  - {実際にスライドに載せる箇条書き3}
- レイアウト: icon-grid / split-screen / cards / timeline / comparison / data-chart
- デザイン: {具体的な色・背景・配置の指示}
- ビジュアル要素: {SVGアイコン / CSSテーブル / フローステップ / バーチャート等の具体的指示}

## スライドN: まとめ
- タイプ: back-cover
- 表示テキスト:
  - {要点1}
  - {要点2}
  - ご清聴ありがとうございました
- デザイン: グラデーション背景、中央揃え

【ルール】
1. coverは日本ビジネス慣習（日付・発表者欄を含める）
2. back-coverはまとめ要点+お礼
3. 「表示テキスト」には実際にスライド面に表示する具体的な文言を書く（曖昧な説明は不可）
4. 「デザイン」には具体的な色コード・レイアウト手法・背景スタイルを指定
5. 「ビジュアル要素」にはSVGアイコン・CSSテーブル・フロー図・バーチャート等の具体的技法を指定
6. 「レイアウト」は icon-grid / split-screen / cards / timeline / comparison / data-chart から選択
7. 枚数は内容に応じて自動決定（3〜15枚）
8. 文書にない情報は推測しない
9. 数値データがある場合は必ずテーブルまたはチャートをビジュアル要素に指定
"""


async def generate_slide_plan_md(
    *,
    question: str,
    answer: Optional[str],
    client: "AIClient",
    max_slides: int = 12,
) -> str:
    """Generate a Markdown plan for an HTML slide deck using LLM."""
    prompt = f"""以下の情報をもとに、プレゼンテーションスライドの構成計画をMarkdown形式で作成してください。

## 質問
{question}

## 回答内容（これをスライドにまとめる）
{answer or "（なし）"}

## 制約
- スライド枚数: 最大{max_slides}枚（内容に応じて3〜{max_slides}枚）
- 最初はcoverスライド（タイトル・日付・発表者欄）
- 最後はback-coverスライド（まとめ要点 + ご清聴ありがとうございました）

## 重要
- 「表示テキスト」には、スライド面に実際に表示する具体的な文言を箇条書きで列挙すること
  （良い例: 「生産量: 年間5000トン」「主な生息地: 太平洋沿岸」）
  （悪い例: 「生態について説明する」「詳細を記載」）
- 各スライドのデザインに具体的な色コード・背景・レイアウト手法を含めること
- 数値やリストがある場合、ビジュアル要素にテーブル/チャート/カード等を指定すること
"""
    try:
        result = await client.generate(
            prompt=prompt,
            system=HTML_SLIDE_PLAN_SYSTEM_PROMPT,
            temperature=0.3,
        )
        if result.success and result.text.strip():
            return result.text.strip()
        logger.warning(f"[HTML_SLIDES] Plan generation failed: {result.error}, using fallback")
        return _generate_fallback_plan_md(question, answer, max_slides)
    except Exception as e:
        logger.warning(f"[HTML_SLIDES] Plan generation error: {e}, using fallback")
        return _generate_fallback_plan_md(question, answer, max_slides)


def _generate_fallback_plan_md(question: str, answer: Optional[str], max_slides: int = 12) -> str:
    """Generate a basic MD plan without LLM, with concrete text content."""
    sections = _split_answer_into_sections(answer or "")
    deck_title = _compact(question, 60)

    lines: list[str] = [f"# {deck_title}", ""]

    # Cover
    lines.append("## スライド1: タイトル")
    lines.append("- タイプ: cover")
    lines.append("- 表示テキスト:")
    lines.append(f"  - {deck_title}")
    lines.append("  - 発表日: 2024年")
    lines.append("- レイアウト: 中央揃え")
    lines.append("- デザイン: グラデーション背景（#1E3A5F → #3B82F6）、白文字44px、サブテキスト20px")
    lines.append("")

    slide_num = 2
    budget = min(max_slides - 2, len(sections)) if sections else 1

    if not sections:
        text_items = _extract_text_elements(answer or question, max_items=5)
        lines.append(f"## スライド{slide_num}: 内容")
        lines.append("- タイプ: content")
        lines.append("- 表示テキスト:")
        for item in (text_items if text_items else [_compact(answer or question, 120)]):
            lines.append(f"  - {item}")
        lines.append("- レイアウト: cards")
        lines.append("- デザイン: 白背景、左アクセントバー#3B82F6、カード影付き")
        lines.append("- ビジュアル要素: SVGアイコン付きカードグリッド")
        lines.append("")
        slide_num += 1
    else:
        for section in sections[:budget]:
            text_items = _extract_text_elements(section["body"], max_items=5)
            content_hints = _detect_content_hints(section["title"], section["body"])

            lines.append(f"## スライド{slide_num}: {section['title']}")
            lines.append("- タイプ: content")
            lines.append("- 表示テキスト:")
            for item in (text_items if text_items else [section["title"]]):
                lines.append(f"  - {item}")

            # Choose layout based on content hints
            if "comparison" in content_hints:
                layout = "comparison"
                visual = "左右対比の2カラムレイアウト、各列に色分けヘッダー"
            elif "flow" in content_hints:
                layout = "timeline"
                visual = "番号付き丸＋SVG矢印コネクタのステップフロー"
            elif "statistics" in content_hints:
                layout = "data-chart"
                visual = "CSSバーチャートまたはテーブル（ヘッダー#3B82F6、交互行色）"
            elif len(text_items) >= 3:
                layout = "icon-grid"
                visual = "SVGアイコン付き2×2または3列カードグリッド"
            else:
                layout = "split-screen"
                visual = "左側テキスト＋右側アクセントブロック"

            lines.append(f"- レイアウト: {layout}")
            lines.append(f"- デザイン: 白背景#FFFFFF、アクセント#3B82F6、タイトル28px太字、本文16px")
            lines.append(f"- ビジュアル要素: {visual}")
            lines.append("")
            slide_num += 1

    # Back-cover
    # Gather summary points from sections
    summary_items = [s["title"] for s in sections[:3]] if sections else [_compact(answer or question, 60)]
    lines.append(f"## スライド{slide_num}: まとめ")
    lines.append("- タイプ: back-cover")
    lines.append("- 表示テキスト:")
    for item in summary_items:
        lines.append(f"  - {item}")
    lines.append("  - ご清聴ありがとうございました")
    lines.append("- レイアウト: 中央揃え")
    lines.append("- デザイン: グラデーション背景（#1E3A5F → #3B82F6）、白文字")
    lines.append("")

    return "\n".join(lines)


def parse_slide_plan_md(plan_md: str) -> tuple[str, list[dict]]:
    """Parse MD plan into (deck_title, [{title, type, plan_text}, ...])."""
    lines = plan_md.strip().splitlines()
    deck_title = "Slides"
    slides: list[dict] = []
    current_slide: Optional[dict] = None

    for line in lines:
        stripped = line.strip()

        # Deck title: # ...
        if re.match(r"^#\s+", stripped) and not re.match(r"^##", stripped):
            deck_title = re.sub(r"^#\s+", "", stripped).strip()
            continue

        # Slide header: ## スライドN: ...
        slide_match = re.match(r"^##\s+スライド\d+[:\s：]\s*(.+)", stripped)
        if slide_match:
            if current_slide:
                slides.append(current_slide)
            title = slide_match.group(1).strip()
            current_slide = {"title": title, "type": "content", "plan_text": ""}
            continue

        # Fallback: any ## header as slide
        if re.match(r"^##\s+", stripped) and not slide_match:
            if current_slide:
                slides.append(current_slide)
            title = re.sub(r"^##\s+", "", stripped).strip()
            current_slide = {"title": title, "type": "content", "plan_text": ""}
            continue

        # Detect type from content
        if current_slide:
            current_slide["plan_text"] += line + "\n"
            type_match = re.match(r"^-\s*タイプ[:\s：]\s*(.+)", stripped)
            if type_match:
                raw_type = type_match.group(1).strip().lower()
                if raw_type in ("cover", "back-cover"):
                    current_slide["type"] = raw_type
                elif "cover" in raw_type and "back" in raw_type:
                    current_slide["type"] = "back-cover"
                elif "cover" in raw_type:
                    current_slide["type"] = "cover"

    if current_slide:
        slides.append(current_slide)

    return deck_title, slides


# Metadata field patterns – used to strip plan metadata from display text
_PLAN_META_PATTERN = re.compile(
    r"^[-*]\s*(タイプ|レイアウト|デザイン|ビジュアル要素|表示テキスト|内容|type|layout|design)[:\s：]",
    re.IGNORECASE,
)


def _extract_display_texts_from_plan(plan_text: str) -> list[str]:
    """Extract actual display text items from a plan section.

    Handles both formats:
      - 表示テキスト:          (or 内容:)
        - item1
        - item2
    AND:
      - 内容: inline text here

    IMPORTANT: metadata lines (レイアウト:, デザイン:, etc.) are never included.
    """
    lines = plan_text.strip().splitlines()
    texts: list[str] = []
    in_text_block = False

    for line in lines:
        stripped = line.strip()
        if not stripped:
            continue

        # ---- Always check for metadata fields FIRST (highest priority) ----
        if _PLAN_META_PATTERN.match(stripped):
            # It's a metadata field.  Check if it starts a text block.
            if re.match(r"^[-*]\s*(表示テキスト|内容)[:\s：]", stripped):
                in_text_block = True
                # Capture inline value after the field name
                inline = re.sub(r"^[-*]\s*(表示テキスト|内容)[:\s：]\s*", "", stripped).strip()
                if inline:
                    texts.append(inline)
            else:
                # Any other metadata field → end text block
                in_text_block = False
            continue

        # ---- Sub-items under text block (indented bullets) ----
        if in_text_block:
            if re.match(r"^\s*[-*]\s+", stripped):
                item = re.sub(r"^\s*[-*]\s+", "", stripped).strip()
                if item:
                    texts.append(item)
            continue

        # ---- Non-bullet, non-metadata lines while not in text block → skip ----

    return texts


def _extract_plan_field(plan_text: str, field_name: str) -> str:
    """Extract value of a named field (e.g. レイアウト, デザイン) from plan text."""
    for line in plan_text.strip().splitlines():
        stripped = line.strip()
        m = re.match(rf"^[-*]\s*{re.escape(field_name)}[:\s：]\s*(.+)", stripped)
        if m:
            return m.group(1).strip()
    return ""


# Words that should NEVER appear as visible text on a rendered slide.
# If the LLM output contains these, it echoed the plan instead of rendering HTML.
_HTML_QUALITY_REJECT_PATTERNS = [
    "レイアウト:",
    "レイアウト：",
    "デザイン:",
    "デザイン：",
    "ビジュアル要素:",
    "ビジュアル要素：",
    "表示テキスト:",
    "表示テキスト：",
    "タイプ: content",
    "タイプ: cover",
    "タイプ：",
]


def _is_valid_slide_html(html: str) -> bool:
    """Check if generated HTML is a properly styled slide, not echoed plan text."""
    if not html or not html.strip():
        return False
    if "<div" not in html.lower():
        return False
    # Must have inline styles (evidence of actual CSS coding)
    if "style=" not in html:
        return False
    # Must have reasonable length (very short = probably not a real slide)
    if len(html.strip()) < 200:
        return False
    # Check reject patterns only in visible text (strip HTML tags first)
    visible_text = re.sub(r"<[^>]+>", " ", html)
    for pattern in _HTML_QUALITY_REJECT_PATTERNS:
        if pattern in visible_text:
            return False
    return True


async def render_slide_from_plan(
    *,
    slide_section: str,
    slide_title: str,
    slide_index: int,
    total_slides: int,
    deck_title: str,
    slide_type: str,
    client: "AIClient",
) -> str:
    """Render a single slide from its MD plan section into styled HTML.

    Strategy: pass the full plan section to the LLM as design instruction,
    AND explicitly list the display text items so the LLM knows exactly
    what content to render vs. what is a design directive.
    Validates that output is real styled HTML, not echoed plan text.
    """
    # ---- Extract structured fields ----
    text_elements = _extract_display_texts_from_plan(slide_section)
    layout = _extract_plan_field(slide_section, "レイアウト") or "split-screen"
    design = _extract_plan_field(slide_section, "デザイン")
    visual = _extract_plan_field(slide_section, "ビジュアル要素")

    # If no text_elements found, pull non-metadata lines as content
    if not text_elements:
        text_elements = [
            line.strip()
            for line in slide_section.splitlines()
            if line.strip() and not _PLAN_META_PATTERN.match(line.strip())
        ]

    # ---- Build prompt sections ----
    text_list = "\n".join(f"  {i+1}. {t}" for i, t in enumerate(text_elements[:10]))

    content_hints = _detect_content_hints(slide_title, " ".join(text_elements))
    hint_map = {
        "statistics": "→ CSSテーブル（ヘッダー濃色、交互行色）またはCSSバーチャート（div幅で値を表現）で視覚化。重要数値は36px+で強調。",
        "list": "→ CSS Gridで2×2や3列のカードレイアウト。各カードにSVGアイコン + タイトル + 説明。",
        "comparison": "→ 左右対比の2カラムレイアウト。各列にヘッダー色を変えて対比。",
        "flow": "→ 番号付き丸(border-radius:50%) + SVG矢印コネクタ + ステップ説明の水平フロー。",
    }
    hint_lines = "\n".join(f"  {hint_map[h]}" for h in content_hints if h in hint_map)

    preset = STYLE_PRESETS.get("corporate", STYLE_PRESETS[DEFAULT_PRESET])

    # ---- Select content-type-specific HTML example ----
    visual_lower = (visual or "").lower()
    example_html = ""

    if slide_type == "cover":
        example_html = """
■ 出力例（カバースライド）
<div style="width:1280px;height:720px;overflow:hidden;font-family:'Segoe UI','Hiragino Sans',sans-serif;position:relative;background:linear-gradient(135deg,#1E40AF 0%,#3B82F6 50%,#60A5FA 100%);">
  <div style="position:absolute;top:0;right:0;width:400px;height:400px;background:rgba(255,255,255,0.05);border-radius:50%;transform:translate(100px,-100px);"></div>
  <div style="position:absolute;bottom:0;left:0;width:300px;height:300px;background:rgba(255,255,255,0.03);border-radius:50%;transform:translate(-80px,80px);"></div>
  <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;text-align:center;position:relative;z-index:1;">
    <div style="width:60px;height:4px;background:rgba(255,255,255,0.6);border-radius:2px;margin-bottom:32px;"></div>
    <h1 data-editable="true" style="font-size:48px;font-weight:700;color:#FFFFFF;margin:0 0 16px 0;line-height:1.3;max-width:900px;">プレゼンタイトル</h1>
    <p data-editable="true" style="font-size:20px;color:rgba(255,255,255,0.8);margin:0 0 40px 0;">サブタイトル</p>
    <div style="display:flex;gap:24px;align-items:center;color:rgba(255,255,255,0.7);font-size:14px;">
      <span data-editable="true">2026年2月24日</span>
      <span style="width:4px;height:4px;background:rgba(255,255,255,0.5);border-radius:50%;"></span>
      <span data-editable="true">発表者名</span>
    </div>
  </div>
</div>"""
    elif "statistics" in content_hints or "テーブル" in visual_lower or "table" in visual_lower:
        example_html = """
■ 出力例（テーブル・統計データ）
<div style="width:1280px;height:720px;overflow:hidden;font-family:'Segoe UI','Hiragino Sans',sans-serif;position:relative;background:#FFFFFF;">
  <div style="position:absolute;top:0;right:0;width:200px;height:200px;background:linear-gradient(135deg,rgba(59,130,246,0.08),transparent);border-bottom-left-radius:100%;"></div>
  <div style="padding:48px 56px;position:relative;">
    <div style="display:flex;align-items:center;gap:12px;margin-bottom:28px;">
      <div style="width:5px;height:36px;background:#3B82F6;border-radius:3px;"></div>
      <h2 data-editable="true" style="font-size:32px;font-weight:700;color:#1E293B;margin:0;">統計データ</h2>
    </div>
    <div style="border-radius:12px;overflow:hidden;border:1px solid #E2E8F0;">
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;background:#1E40AF;">
        <div style="padding:14px 20px;color:#fff;font-weight:600;font-size:15px;">項目</div>
        <div style="padding:14px 20px;color:#fff;font-weight:600;font-size:15px;">数値</div>
        <div style="padding:14px 20px;color:#fff;font-weight:600;font-size:15px;">備考</div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;background:#FFFFFF;">
        <div style="padding:12px 20px;font-size:14px;color:#1E293B;border-bottom:1px solid #F1F5F9;" data-editable="true">項目A</div>
        <div style="padding:12px 20px;font-size:14px;color:#3B82F6;font-weight:600;border-bottom:1px solid #F1F5F9;" data-editable="true">1,234</div>
        <div style="padding:12px 20px;font-size:14px;color:#64748B;border-bottom:1px solid #F1F5F9;" data-editable="true">前年比+12%</div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;background:#F8FAFC;">
        <div style="padding:12px 20px;font-size:14px;color:#1E293B;" data-editable="true">項目B</div>
        <div style="padding:12px 20px;font-size:14px;color:#3B82F6;font-weight:600;" data-editable="true">5,678</div>
        <div style="padding:12px 20px;font-size:14px;color:#64748B;" data-editable="true">前年比+8%</div>
      </div>
    </div>
  </div>
  <div style="position:absolute;bottom:0;left:0;right:0;height:36px;background:#F9FAFB;border-top:1px solid #E5E7EB;display:flex;align-items:center;justify-content:space-between;padding:0 32px;">
    <span style="font-size:11px;color:#9CA3AF;">デッキタイトル</span><span style="font-size:11px;color:#9CA3AF;">N / M</span>
  </div>
</div>"""
    elif "flow" in content_hints or "フロー" in visual_lower or "ステップ" in visual_lower:
        example_html = """
■ 出力例（フロー・プロセス図）
<div style="width:1280px;height:720px;overflow:hidden;font-family:'Segoe UI','Hiragino Sans',sans-serif;position:relative;background:#FFFFFF;">
  <div style="padding:48px 56px;">
    <div style="display:flex;align-items:center;gap:12px;margin-bottom:36px;">
      <div style="width:5px;height:36px;background:#3B82F6;border-radius:3px;"></div>
      <h2 data-editable="true" style="font-size:32px;font-weight:700;color:#1E293B;margin:0;">プロセスフロー</h2>
    </div>
    <div style="display:flex;align-items:center;justify-content:center;gap:8px;margin-top:32px;">
      <div style="display:flex;flex-direction:column;align-items:center;width:200px;">
        <div style="width:56px;height:56px;border-radius:50%;background:linear-gradient(135deg,#3B82F6,#2563EB);display:flex;align-items:center;justify-content:center;color:#fff;font-size:22px;font-weight:700;box-shadow:0 4px 12px rgba(59,130,246,0.3);">1</div>
        <h3 data-editable="true" style="font-size:16px;font-weight:600;color:#1E293B;margin:12px 0 4px 0;text-align:center;">ステップ1</h3>
        <p data-editable="true" style="font-size:13px;color:#64748B;text-align:center;margin:0;line-height:1.4;">説明文</p>
      </div>
      <svg width="40" height="24" viewBox="0 0 40 24" style="flex-shrink:0;"><path d="M0 12h30M24 6l6 6-6 6" fill="none" stroke="#CBD5E1" stroke-width="2"/></svg>
      <div style="display:flex;flex-direction:column;align-items:center;width:200px;">
        <div style="width:56px;height:56px;border-radius:50%;background:linear-gradient(135deg,#3B82F6,#2563EB);display:flex;align-items:center;justify-content:center;color:#fff;font-size:22px;font-weight:700;box-shadow:0 4px 12px rgba(59,130,246,0.3);">2</div>
        <h3 data-editable="true" style="font-size:16px;font-weight:600;color:#1E293B;margin:12px 0 4px 0;text-align:center;">ステップ2</h3>
        <p data-editable="true" style="font-size:13px;color:#64748B;text-align:center;margin:0;line-height:1.4;">説明文</p>
      </div>
      <svg width="40" height="24" viewBox="0 0 40 24" style="flex-shrink:0;"><path d="M0 12h30M24 6l6 6-6 6" fill="none" stroke="#CBD5E1" stroke-width="2"/></svg>
      <div style="display:flex;flex-direction:column;align-items:center;width:200px;">
        <div style="width:56px;height:56px;border-radius:50%;background:linear-gradient(135deg,#10B981,#059669);display:flex;align-items:center;justify-content:center;color:#fff;font-size:22px;font-weight:700;box-shadow:0 4px 12px rgba(16,185,129,0.3);">3</div>
        <h3 data-editable="true" style="font-size:16px;font-weight:600;color:#1E293B;margin:12px 0 4px 0;text-align:center;">完了</h3>
        <p data-editable="true" style="font-size:13px;color:#64748B;text-align:center;margin:0;line-height:1.4;">説明文</p>
      </div>
    </div>
  </div>
  <div style="position:absolute;bottom:0;left:0;right:0;height:36px;background:#F9FAFB;border-top:1px solid #E5E7EB;display:flex;align-items:center;justify-content:space-between;padding:0 32px;">
    <span style="font-size:11px;color:#9CA3AF;">デッキタイトル</span><span style="font-size:11px;color:#9CA3AF;">N / M</span>
  </div>
</div>"""
    elif "comparison" in content_hints or "比較" in visual_lower:
        example_html = """
■ 出力例（比較レイアウト）
<div style="width:1280px;height:720px;overflow:hidden;font-family:'Segoe UI','Hiragino Sans',sans-serif;position:relative;background:#FFFFFF;">
  <div style="padding:48px 56px;">
    <div style="display:flex;align-items:center;gap:12px;margin-bottom:28px;">
      <div style="width:5px;height:36px;background:#3B82F6;border-radius:3px;"></div>
      <h2 data-editable="true" style="font-size:32px;font-weight:700;color:#1E293B;margin:0;">比較タイトル</h2>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:24px;">
      <div style="background:linear-gradient(135deg,#EFF6FF,#DBEAFE);border-radius:16px;padding:28px;border-top:4px solid #3B82F6;">
        <h3 data-editable="true" style="font-size:22px;font-weight:700;color:#1E40AF;margin:0 0 16px 0;">カテゴリA</h3>
        <div style="display:flex;align-items:flex-start;gap:10px;margin-bottom:12px;">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#3B82F6" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>
          <p data-editable="true" style="font-size:15px;color:#334155;margin:0;line-height:1.5;">ポイント1</p>
        </div>
        <div style="display:flex;align-items:flex-start;gap:10px;margin-bottom:12px;">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#3B82F6" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>
          <p data-editable="true" style="font-size:15px;color:#334155;margin:0;line-height:1.5;">ポイント2</p>
        </div>
      </div>
      <div style="background:linear-gradient(135deg,#FFF7ED,#FFEDD5);border-radius:16px;padding:28px;border-top:4px solid #F97316;">
        <h3 data-editable="true" style="font-size:22px;font-weight:700;color:#C2410C;margin:0 0 16px 0;">カテゴリB</h3>
        <div style="display:flex;align-items:flex-start;gap:10px;margin-bottom:12px;">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#F97316" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>
          <p data-editable="true" style="font-size:15px;color:#334155;margin:0;line-height:1.5;">ポイント1</p>
        </div>
      </div>
    </div>
  </div>
  <div style="position:absolute;bottom:0;left:0;right:0;height:36px;background:#F9FAFB;border-top:1px solid #E5E7EB;display:flex;align-items:center;justify-content:space-between;padding:0 32px;">
    <span style="font-size:11px;color:#9CA3AF;">デッキタイトル</span><span style="font-size:11px;color:#9CA3AF;">N / M</span>
  </div>
</div>"""
    elif slide_type == "content":
        # Default: icon card grid layout
        example_html = """
■ 出力例（アイコン付きカードグリッド）
<div style="width:1280px;height:720px;overflow:hidden;font-family:'Segoe UI','Hiragino Sans',sans-serif;position:relative;background:#FFFFFF;">
  <div style="position:absolute;top:0;right:0;width:200px;height:200px;background:linear-gradient(135deg,rgba(59,130,246,0.08),transparent);border-bottom-left-radius:100%;"></div>
  <div style="padding:48px 56px;position:relative;">
    <div style="display:flex;align-items:center;gap:12px;margin-bottom:24px;">
      <div style="width:5px;height:36px;background:#3B82F6;border-radius:3px;"></div>
      <h2 data-editable="true" style="font-size:32px;font-weight:700;color:#1E293B;margin:0;">スライドタイトル</h2>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;">
      <div style="background:#F8FAFC;border-radius:12px;padding:24px;border-left:4px solid #3B82F6;">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px;">
          <div style="width:40px;height:40px;border-radius:10px;background:rgba(59,130,246,0.1);display:flex;align-items:center;justify-content:center;">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#3B82F6" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>
          </div>
          <h3 data-editable="true" style="font-size:18px;font-weight:600;color:#1E293B;margin:0;">項目タイトル</h3>
        </div>
        <p data-editable="true" style="font-size:14px;color:#64748B;line-height:1.6;margin:0;">項目の説明文をここに記載</p>
      </div>
      <div style="background:#F8FAFC;border-radius:12px;padding:24px;border-left:4px solid #10B981;">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px;">
          <div style="width:40px;height:40px;border-radius:10px;background:rgba(16,185,129,0.1);display:flex;align-items:center;justify-content:center;">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#10B981" stroke-width="2"><path d="M12 2a7 7 0 0 0-4 12.7V17h8v-2.3A7 7 0 0 0 12 2z"/></svg>
          </div>
          <h3 data-editable="true" style="font-size:18px;font-weight:600;color:#1E293B;margin:0;">項目タイトル</h3>
        </div>
        <p data-editable="true" style="font-size:14px;color:#64748B;line-height:1.6;margin:0;">項目の説明文をここに記載</p>
      </div>
    </div>
  </div>
  <div style="position:absolute;bottom:0;left:0;right:0;height:36px;background:#F9FAFB;border-top:1px solid #E5E7EB;display:flex;align-items:center;justify-content:space-between;padding:0 32px;">
    <span style="font-size:11px;color:#9CA3AF;">デッキタイトル</span><span style="font-size:11px;color:#9CA3AF;">N / M</span>
  </div>
</div>"""

    # ---- Determine the mandatory visual technique for this slide ----
    visual_directive = ""
    if "statistics" in content_hints or "テーブル" in visual_lower or "table" in visual_lower:
        visual_directive = "必ずCSSテーブル（display:grid、ヘッダー濃色背景、交互行色）を使用してデータを視覚化すること。"
    elif "flow" in content_hints or "フロー" in visual_lower or "ステップ" in visual_lower:
        visual_directive = "必ずフロー図（番号付き丸 + SVG矢印コネクタ + ステップ説明）を使用してプロセスを視覚化すること。"
    elif "comparison" in content_hints or "比較" in visual_lower:
        visual_directive = "必ず左右対比の2カラムレイアウト（各列ヘッダー色を変え、SVGチェックアイコン付き）を使用すること。"
    elif len(text_elements) >= 3:
        visual_directive = "必ずCSS Grid カードレイアウト（各カードにSVGアイコン＋色付きボーダー＋タイトル＋説明）を使用すること。単純な箇条書きは禁止。"
    else:
        visual_directive = "SVGアイコン、色付きブロック、グラデーション等のビジュアル要素を必ず含めること。テキストだけのスライドは禁止。"

    prompt = f"""以下の設計指示に従い、プレゼンスライド1枚分のリッチなHTML+インラインCSSを出力してください。
<div>タグ1つだけを出力。説明文・マークダウン不要。

【基本情報】
デッキ: {deck_title} | ページ: {slide_index + 1}/{total_slides} | タイプ: {slide_type} | タイトル: {slide_title}

【ビジュアルデザイン指示】（CSS/HTMLに反映。テキストとして表示しないこと）
レイアウト方式: {layout}
配色: {design or "白背景、アクセント#3B82F6"}
{visual_directive}

【表示テキスト】（以下のみをHTMLテキストノードとして表示）
{text_list or "  （タイトルのみ）"}

【絶対ルール】
1. {visual_directive}
2. 「レイアウト:」「デザイン:」等のメタ文字を表示しない
3. width:1280px, height:720px, overflow:hidden
4. テキスト要素に data-editable="true"
5. SVGアイコン、CSSグラデーション、カード、テーブル等のビジュアル要素を積極的に使う
6. 単にテキストを羅列するだけのスライドは絶対に作らない
{example_html}
━━━ 出力（<div>のみ） ━━━"""

    try:
        result = await client.generate(
            prompt=prompt,
            system=SLIDE_HTML_SYSTEM_PROMPT,
            temperature=0.4,
        )
        if result.success and result.text.strip():
            html = extract_html_from_response(result.text)
            if _is_valid_slide_html(html):
                logger.info(f"[HTML_SLIDES] Render OK for slide {slide_index + 1} ({len(html)} chars)")
                return html
            else:
                # Log why it was rejected
                reject_reasons = []
                if "style=" not in html:
                    reject_reasons.append("no inline styles")
                for pat in _HTML_QUALITY_REJECT_PATTERNS:
                    if pat in html:
                        reject_reasons.append(f"contains '{pat}'")
                logger.warning(
                    f"[HTML_SLIDES] Render REJECTED for slide {slide_index + 1}: "
                    f"reasons={reject_reasons}, html_preview={html[:300]}"
                )
        else:
            logger.warning(
                f"[HTML_SLIDES] Render failed for slide {slide_index + 1}: "
                f"success={result.success}, text_len={len(result.text) if result.text else 0}, "
                f"error={result.error}"
            )
    except Exception as e:
        logger.warning(f"[HTML_SLIDES] Render error for slide {slide_index + 1}: {e}")

    # ---- Fallback: generate styled HTML without LLM ----
    logger.info(f"[HTML_SLIDES] Using fallback for slide {slide_index + 1}, text_elements={len(text_elements)}")
    fallback_slide = {
        "title": slide_title,
        "type": slide_type,
        "key_message": text_elements[0] if text_elements else slide_title,
        "text_elements": text_elements[:6],
    }
    return generate_fallback_html(
        slide=fallback_slide,
        style_preset="corporate",
        deck_title=deck_title,
    )
