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
}

DEFAULT_PRESET = "corporate"


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

        slides_out.append({
            "slide_number": i + 1,
            "title": slide_title,
            "type": slide_type,
            "key_message": key_message,
            "visual_description": visual_description,
            "layout": layout,
            "text_elements": text_elements[:6],
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

【デザイン指針】
- モダンでプロフェッショナルなデザイン
- アクセントカラーをデコレーション（ライン、ブロック、グラデーション、ボーダー等）に活用
- 適切な余白とタイポグラフィ階層
- 図形的要素（丸、線、ブロック）でビジュアル的な豊かさを加える"""


def build_slide_html_prompt(
    *,
    slide: dict[str, Any],
    style_preset: str,
    deck_title: str,
) -> str:
    """Build a prompt for LLM to generate HTML for a single slide."""
    preset = STYLE_PRESETS.get(style_preset, STYLE_PRESETS[DEFAULT_PRESET])

    slide_type = slide.get("type", "content")
    layout = slide.get("layout", "split-screen")
    title = slide.get("title", "")
    key_message = slide.get("key_message", "")
    text_elements = slide.get("text_elements", [])

    text_section = ""
    if text_elements:
        items = "\n".join(f"  - {t}" for t in text_elements[:5])
        text_section = f"\nスライドに表示するテキスト:\n{items}\n"

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
{text_section}
ルートdivの width:1280px, height:720px で1つの<div>を出力してください。"""


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


def build_outline_from_answer(
    *,
    question: str,
    answer: Optional[str],
    max_slides: int = 6,
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

        slides.append({
            "slide_number": i + 2,
            "title": section["title"],
            "type": "content",
            "key_message": _compact(section["body"], 80) if section["body"] else section["title"],
            "visual_description": _guess_visual_description(section["title"], section["body"]),
            "layout": layout,
            "text_elements": text_elements,
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
