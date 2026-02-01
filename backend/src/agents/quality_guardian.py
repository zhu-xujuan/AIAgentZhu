"""
Quality Guardian Agent
Determines if extraction quality is acceptable.
Supports LLM-enhanced evaluation with rule-based fallback.
"""

import json
import logging
from typing import Optional, TYPE_CHECKING
from dataclasses import dataclass, field

if TYPE_CHECKING:
    from src.llm.ai_client import AIClient as OllamaClient

logger = logging.getLogger(__name__)


@dataclass
class QualityCheckResult:
    """Quality check result following strict JSON specification."""
    needs_review: bool
    reasons: list[str] = field(default_factory=list)

    def to_dict(self) -> dict:
        return {
            "needs_review": self.needs_review,
            "reasons": self.reasons
        }

    def to_json(self) -> str:
        return json.dumps(self.to_dict(), ensure_ascii=False, indent=2)


class QualityGuardian:
    """
    Quality Guardian Agent.

    Input:
        - facts: list[dict] - extracted facts
        - parse_meta: dict - parsing metadata

    Output (STRICT JSON):
        {
            "needs_review": true|false,
            "reasons": ["string"]
        }

    Conditions for review:
        - No facts -> review
        - Low confidence -> review
        - OCR used -> review
    """

    # Confidence threshold below which review is needed
    LOW_CONFIDENCE_THRESHOLD = 0.5

    def check_quality(
        self,
        facts: Optional[list[dict]],
        parse_meta: Optional[dict]
    ) -> QualityCheckResult:
        """
        Check the quality of extracted facts and determine if review is needed.

        Args:
            facts: List of extracted facts
            parse_meta: Metadata from the parsing process

        Returns:
            QualityCheckResult indicating if review is needed and reasons
        """
        reasons = []

        # Condition 1: No facts -> review
        if self._has_no_facts(facts):
            reasons.append("No facts extracted")

        # Condition 2: Low confidence -> review
        low_confidence_reason = self._check_low_confidence(facts, parse_meta)
        if low_confidence_reason:
            reasons.append(low_confidence_reason)

        # Condition 3: OCR used -> review
        if self._is_ocr_used(parse_meta):
            reasons.append("OCR was used for text extraction")

        needs_review = len(reasons) > 0

        return QualityCheckResult(
            needs_review=needs_review,
            reasons=reasons
        )

    def _has_no_facts(self, facts: Optional[list[dict]]) -> bool:
        """Check if no facts were extracted."""
        if facts is None:
            return True
        if not isinstance(facts, list):
            return True
        if len(facts) == 0:
            return True
        return False

    def _check_low_confidence(
        self,
        facts: Optional[list[dict]],
        parse_meta: Optional[dict]
    ) -> Optional[str]:
        """
        Check if confidence is low.
        Returns reason string if low confidence, None otherwise.
        """
        # Check parse_meta confidence first
        if parse_meta and isinstance(parse_meta, dict):
            confidence = parse_meta.get("confidence")
            if confidence is not None:
                try:
                    conf_value = float(confidence)
                    if conf_value < self.LOW_CONFIDENCE_THRESHOLD:
                        return f"Low parsing confidence: {conf_value:.2f}"
                except (ValueError, TypeError):
                    pass

        # Check individual fact confidence values
        if facts and isinstance(facts, list):
            low_confidence_facts = []
            for i, fact in enumerate(facts):
                if isinstance(fact, dict):
                    fact_confidence = fact.get("confidence")
                    if fact_confidence is not None:
                        try:
                            conf_value = float(fact_confidence)
                            if conf_value < self.LOW_CONFIDENCE_THRESHOLD:
                                low_confidence_facts.append(i + 1)
                        except (ValueError, TypeError):
                            pass

            if low_confidence_facts:
                if len(low_confidence_facts) == 1:
                    return f"Low confidence in fact #{low_confidence_facts[0]}"
                else:
                    fact_nums = ", ".join(f"#{n}" for n in low_confidence_facts[:3])
                    if len(low_confidence_facts) > 3:
                        fact_nums += f" and {len(low_confidence_facts) - 3} more"
                    return f"Low confidence in facts {fact_nums}"

        return None

    def _is_ocr_used(self, parse_meta: Optional[dict]) -> bool:
        """Check if OCR was used for text extraction."""
        if parse_meta is None:
            return False
        if not isinstance(parse_meta, dict):
            return False

        # Check common OCR indicators
        ocr_used = parse_meta.get("ocr_used")
        if ocr_used is True:
            return True

        # Check extraction_method field
        extraction_method = parse_meta.get("extraction_method", "")
        if isinstance(extraction_method, str) and "ocr" in extraction_method.lower():
            return True

        # Check parser_type field
        parser_type = parse_meta.get("parser_type", "")
        if isinstance(parser_type, str) and "ocr" in parser_type.lower():
            return True

        return False


def check_quality(facts: Optional[list[dict]], parse_meta: Optional[dict]) -> dict:
    """
    Convenience function to check extraction quality and return JSON-serializable dict.

    Args:
        facts: List of extracted facts
        parse_meta: Parsing metadata

    Returns:
        Dictionary matching the strict JSON output specification
    """
    guardian = QualityGuardian()
    result = guardian.check_quality(facts, parse_meta)
    return result.to_dict()


async def check_quality_with_llm(
    facts: Optional[list[dict]],
    parse_meta: Optional[dict],
    ollama_client: "OllamaClient",
    doc_type: str = "unknown",
) -> Optional[dict]:
    """
    Check quality using LLM for semantic evaluation.

    Args:
        facts: List of extracted facts
        parse_meta: Parsing metadata
        ollama_client: OllamaClient instance
        doc_type: Document type

    Returns:
        Dictionary with quality evaluation, or None if LLM fails
    """
    from src.llm.prompts.quality_guardian import (
        QUALITY_GUARDIAN_SYSTEM,
        format_quality_guardian_input,
    )

    # Get chunk count and OCR status from parse_meta
    chunk_count = 0
    ocr_used = False
    if parse_meta and isinstance(parse_meta, dict):
        chunk_count = parse_meta.get("chunk_count", 0)
        ocr_used = parse_meta.get("ocr_used", False)

    prompt = format_quality_guardian_input(
        doc_type=doc_type,
        chunk_count=chunk_count,
        ocr_used=ocr_used,
        facts=facts or [],
    )

    result, error = await ollama_client.generate_json(
        prompt=prompt,
        system=QUALITY_GUARDIAN_SYSTEM,
        temperature=0.1,
    )

    if error:
        logger.warning(f"LLM quality check failed: {error}")
        return None

    if not result or not isinstance(result, dict):
        logger.warning("LLM returned invalid response format")
        return None

    # Normalize the response
    needs_review = result.get("needs_review", False)
    if not isinstance(needs_review, bool):
        needs_review = bool(needs_review)

    reasons = result.get("reasons", [])
    if not isinstance(reasons, list):
        reasons = [str(reasons)] if reasons else []

    # Ensure all reasons are strings
    reasons = [str(r) for r in reasons if r]

    normalized = {
        "needs_review": needs_review,
        "reasons": reasons,
    }

    # Add extended LLM evaluation fields if present
    if "overall_quality" in result:
        normalized["overall_quality"] = result["overall_quality"]
    if "fact_issues" in result:
        normalized["fact_issues"] = result["fact_issues"]
    if "recommendations" in result:
        normalized["recommendations"] = result["recommendations"]

    logger.info(f"LLM quality check: needs_review={needs_review}, reasons={len(reasons)}")
    return normalized


async def check_quality_async(
    facts: Optional[list[dict]],
    parse_meta: Optional[dict],
    ollama_client: Optional["OllamaClient"] = None,
    use_llm: bool = True,
    doc_type: str = "unknown",
) -> dict:
    """
    Async function to check quality with LLM support and rule-based fallback.

    Args:
        facts: List of extracted facts
        parse_meta: Parsing metadata
        ollama_client: Optional OllamaClient for LLM evaluation
        use_llm: Whether to use LLM (default True)
        doc_type: Document type

    Returns:
        Dictionary matching the strict JSON output specification
    """
    # Try LLM evaluation first if enabled
    if use_llm and ollama_client:
        try:
            result = await check_quality_with_llm(
                facts, parse_meta, ollama_client, doc_type
            )
            if result:
                return result
        except Exception as e:
            logger.warning(f"LLM quality check error, falling back to rules: {e}")

    # Fallback to rule-based quality check
    return check_quality(facts, parse_meta)
