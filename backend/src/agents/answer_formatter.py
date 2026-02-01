"""
Answer Formatter Agent
Turn facts into human-readable answers.
Supports LLM-enhanced formatting with rule-based fallback.
"""

import logging
from typing import Optional, List, TYPE_CHECKING
from dataclasses import dataclass

if TYPE_CHECKING:
    from src.llm.ai_client import AIClient as OllamaClient

logger = logging.getLogger(__name__)


@dataclass
class Fact:
    """Represents a single fact extracted from documents."""
    content: str
    owner: Optional[str]
    due_date: Optional[str]
    evidence: Optional[str]
    confidence: float

    def to_dict(self) -> dict:
        return {
            "content": self.content,
            "owner": self.owner,
            "due_date": self.due_date,
            "evidence": self.evidence,
            "confidence": self.confidence
        }


@dataclass
class FormattedAnswer:
    """Formatted answer result."""
    text: str
    has_low_confidence: bool

    def to_dict(self) -> dict:
        return {
            "text": self.text,
            "has_low_confidence": self.has_low_confidence
        }


class AnswerFormatter:
    """
    Answer Formatter Agent.

    Input:
        - facts: List[Fact] - facts extracted from database/documents

    Output:
        - Human-readable bullet-point formatted answer

    Rules:
        - Bullet points format
        - Include owner, due_date
        - Include evidence reference
        - Mark low confidence as 'Needs review' (要確認)
    """

    # Confidence threshold below which items are marked as needing review
    LOW_CONFIDENCE_THRESHOLD = 0.6

    def format(self, facts: List[Fact], query: Optional[str] = None) -> FormattedAnswer:
        """
        Format facts into a human-readable answer.

        Args:
            facts: List of facts to format
            query: Optional original query for context

        Returns:
            FormattedAnswer with formatted text
        """
        if not facts:
            return FormattedAnswer(
                text="該当する情報が見つかりませんでした。",
                has_low_confidence=False
            )

        lines = []
        has_low_confidence = False

        for fact in facts:
            line = self._format_fact(fact)
            lines.append(line)

            if fact.confidence < self.LOW_CONFIDENCE_THRESHOLD:
                has_low_confidence = True

        formatted_text = "\n".join(lines)

        return FormattedAnswer(
            text=formatted_text,
            has_low_confidence=has_low_confidence
        )

    def _format_fact(self, fact: Fact) -> str:
        """
        Format a single fact as a bullet point.

        Format:
            - [content]
              - 担当: [owner]
              - 期日: [due_date]
              - 出典: [evidence]
              - (要確認) <- if low confidence
        """
        parts = [f"- {fact.content}"]

        # Owner (required field per spec)
        owner_text = fact.owner if fact.owner else "未設定"
        parts.append(f"  - 担当: {owner_text}")

        # Due date (required field per spec)
        due_date_text = fact.due_date if fact.due_date else "未設定"
        parts.append(f"  - 期日: {due_date_text}")

        # Evidence (required field per spec)
        evidence_text = fact.evidence if fact.evidence else "未設定"
        parts.append(f"  - 出典: {evidence_text}")

        # Low confidence marker
        if fact.confidence < self.LOW_CONFIDENCE_THRESHOLD:
            parts.append(f"  - **要確認** (信頼度: {fact.confidence:.0%})")

        return "\n".join(parts)

    def format_with_summary(
        self, facts: List[Fact], query: Optional[str] = None
    ) -> FormattedAnswer:
        """
        Format facts with a summary header.

        Args:
            facts: List of facts to format
            query: Optional original query for context

        Returns:
            FormattedAnswer with summary and formatted facts
        """
        base_result = self.format(facts, query)

        if not facts:
            return base_result

        # Add summary header
        total_count = len(facts)
        low_confidence_count = sum(
            1 for f in facts if f.confidence < self.LOW_CONFIDENCE_THRESHOLD
        )

        summary_parts = [f"## 検索結果: {total_count}件"]

        if low_confidence_count > 0:
            summary_parts.append(f"(うち要確認: {low_confidence_count}件)")

        summary = " ".join(summary_parts)

        formatted_text = f"{summary}\n\n{base_result.text}"

        return FormattedAnswer(
            text=formatted_text,
            has_low_confidence=base_result.has_low_confidence
        )


def format_facts(facts: List[dict], query: Optional[str] = None) -> dict:
    """
    Convenience function to format facts and return result dict.

    Args:
        facts: List of fact dictionaries with keys:
               content, owner, due_date, evidence, confidence
        query: Optional original query

    Returns:
        Dictionary with formatted answer
    """
    formatter = AnswerFormatter()

    fact_objects = [
        Fact(
            content=f.get("content", ""),
            owner=f.get("owner"),
            due_date=f.get("due_date"),
            evidence=f.get("evidence"),
            confidence=f.get("confidence", 0.5)
        )
        for f in facts
    ]

    result = formatter.format_with_summary(fact_objects, query)
    return result.to_dict()


async def format_facts_with_llm(
    facts: List[dict],
    query: str,
    ollama_client: "OllamaClient",
) -> Optional[dict]:
    """
    Format facts using LLM for natural language generation.

    Args:
        facts: List of fact dictionaries
        query: Original user question
        ollama_client: OllamaClient instance

    Returns:
        Dictionary with formatted answer, or None if LLM fails
    """
    from src.llm.prompts.answer_formatter import (
        ANSWER_FORMATTER_SYSTEM,
        format_answer_formatter_input,
    )

    prompt = format_answer_formatter_input(query, facts)

    # For answer formatting, we don't need JSON output
    result = await ollama_client.generate(
        prompt=prompt,
        system=ANSWER_FORMATTER_SYSTEM,
        format_json=False,
        temperature=0.3,  # Slightly more creative for natural responses
    )

    if not result.success:
        logger.warning(f"LLM answer formatting failed: {result.error}")
        return None

    text = result.text.strip()
    if not text:
        logger.warning("LLM returned empty response")
        return None

    # Check for low confidence facts
    has_low_confidence = any(
        f.get("confidence", 1.0) < 0.6
        for f in facts
    )

    logger.info(f"LLM formatted {len(facts)} facts into response")
    return {
        "text": text,
        "has_low_confidence": has_low_confidence,
    }


async def format_facts_async(
    facts: List[dict],
    query: Optional[str] = None,
    ollama_client: Optional["OllamaClient"] = None,
    use_llm: bool = True,
) -> dict:
    """
    Async function to format facts with LLM support and rule-based fallback.

    Args:
        facts: List of fact dictionaries
        query: Optional original query
        ollama_client: Optional OllamaClient for LLM formatting
        use_llm: Whether to use LLM (default True)

    Returns:
        Dictionary with formatted answer
    """
    # Try LLM formatting first if enabled and we have a query
    if use_llm and ollama_client and query:
        try:
            result = await format_facts_with_llm(facts, query, ollama_client)
            if result:
                return result
        except Exception as e:
            logger.warning(f"LLM formatting error, falling back to rules: {e}")

    # Fallback to rule-based formatting
    return format_facts(facts, query)
