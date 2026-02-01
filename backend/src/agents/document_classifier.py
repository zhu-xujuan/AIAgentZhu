"""
Document Classifier Agent
Identifies document type based on file metadata and content.
Supports LLM-enhanced classification with rule-based fallback.
"""

import re
import json
import logging
from typing import Optional, TYPE_CHECKING
from dataclasses import dataclass

if TYPE_CHECKING:
    from src.llm.ai_client import AIClient as OllamaClient

logger = logging.getLogger(__name__)


@dataclass
class ClassificationResult:
    """Classification result following strict JSON specification."""
    doc_type: str
    owner_company: Optional[str]
    doc_date: Optional[str]
    language: Optional[str]
    confidence: float
    rationale: str

    def to_dict(self) -> dict:
        return {
            "doc_type": self.doc_type,
            "owner_company": self.owner_company,
            "doc_date": self.doc_date,
            "language": self.language,
            "confidence": self.confidence,
            "rationale": self.rationale
        }

    def to_json(self) -> str:
        return json.dumps(self.to_dict(), ensure_ascii=False, indent=2)


class DocumentClassifier:
    """
    Document Classifier Agent.

    Input:
        - file_name: str
        - file_type: str
        - raw_text: str (first ~3000 chars)

    Output (STRICT JSON):
        {
            "doc_type": "minutes|contract|manual|invoice|csv|other|unknown",
            "owner_company": "string|null",
            "doc_date": "YYYY-MM-DD|null",
            "language": "ja|en|null",
            "confidence": 0.0,
            "rationale": "string"
        }

    Rules:
        - Never guess dates or company names.
        - If unsure, return null.
    """

    VALID_DOC_TYPES = ["minutes", "contract", "manual", "invoice", "report", "csv", "other", "unknown"]
    VALID_LANGUAGES = ["ja", "en", None]

    # Date pattern: YYYY-MM-DD format
    DATE_PATTERN = re.compile(r'\b(\d{4})[-/年](\d{1,2})[-/月](\d{1,2})日?\b')

    # Keywords for document type detection
    # Note: Keywords are matched in order of specificity. More specific keywords should have higher weight.
    DOC_TYPE_KEYWORDS = {
        "minutes": {
            "ja": ["議事録", "出席者", "決定事項", "議題", "ミーティング"],
            "en": ["minutes", "meeting minutes", "attendees", "agenda", "resolution"]
        },
        "contract": {
            "ja": ["契約書", "甲", "乙", "契約条項", "締結", "合意", "覚書"],
            "en": ["contract", "agreement", "party", "whereas", "terms and conditions", "hereby"]
        },
        "manual": {
            "ja": ["マニュアル", "手順書", "操作方法", "ガイド", "取扱説明書", "手順", "研修", "トレーニング"],
            "en": ["manual", "guide", "instructions", "how to", "procedure", "step by step", "training", "specification", "tutorial"]
        },
        "invoice": {
            "ja": ["請求書", "請求金額", "振込先", "お支払い", "税込", "御請求"],
            "en": ["invoice", "bill to", "amount due", "remittance", "payment due"]
        },
        "report": {
            "ja": ["報告書", "レポート", "実績", "四半期", "月次報告", "経費報告", "企画書", "提案書"],
            "en": ["report", "quarterly", "summary", "analysis", "expense report", "proposal", "financial review"]
        }
    }

    def classify(self, file_name: str, file_type: str, raw_text: str) -> ClassificationResult:
        """
        Classify the document based on input parameters.

        Args:
            file_name: Name of the file
            file_type: MIME type or extension of the file
            raw_text: First ~3000 characters of the document text

        Returns:
            ClassificationResult with classification details
        """
        # Truncate raw_text to ~3000 chars as per spec
        text_sample = raw_text[:3000] if raw_text else ""

        # Detect language first
        language = self._detect_language(text_sample)

        # Detect document type
        doc_type, type_confidence, type_rationale = self._detect_doc_type(
            file_name, file_type, text_sample, language
        )

        # Extract date if clearly present
        doc_date = self._extract_date(text_sample)

        # Extract company name only if explicitly stated
        owner_company = self._extract_company(text_sample)

        # Calculate overall confidence
        confidence = self._calculate_confidence(
            doc_type, type_confidence, language, text_sample
        )

        # Build rationale
        rationale = self._build_rationale(
            doc_type, type_rationale, language, doc_date, owner_company
        )

        return ClassificationResult(
            doc_type=doc_type,
            owner_company=owner_company,
            doc_date=doc_date,
            language=language,
            confidence=round(confidence, 2),
            rationale=rationale
        )

    def _detect_language(self, text: str) -> Optional[str]:
        """Detect language based on character analysis."""
        if not text:
            return None

        # Count Japanese characters (hiragana, katakana, kanji)
        ja_pattern = re.compile(r'[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FFF]')
        ja_chars = len(ja_pattern.findall(text))

        # Count ASCII letters (rough proxy for English)
        en_pattern = re.compile(r'[a-zA-Z]')
        en_chars = len(en_pattern.findall(text))

        total_meaningful = ja_chars + en_chars
        if total_meaningful == 0:
            return None

        ja_ratio = ja_chars / total_meaningful
        en_ratio = en_chars / total_meaningful

        # Require clear majority to determine language
        if ja_ratio > 0.3:
            return "ja"
        elif en_ratio > 0.7:
            return "en"

        return None

    def _detect_doc_type(
        self, file_name: str, file_type: str, text: str, language: Optional[str]
    ) -> tuple[str, float, str]:
        """
        Detect document type based on keywords and patterns.
        Returns: (doc_type, confidence, rationale)
        """
        file_name_lower = file_name.lower() if file_name else ""
        file_type_lower = file_type.lower() if file_type else ""
        text_lower = text.lower() if text else ""

        # Check for CSV first (based on file type/extension)
        if "csv" in file_type_lower or file_name_lower.endswith(".csv"):
            return ("csv", 0.95, "File type indicates CSV format")

        # Count keyword matches for each document type
        scores = {}
        for doc_type, keywords_by_lang in self.DOC_TYPE_KEYWORDS.items():
            score = 0
            matched_keywords = []

            # Check keywords in detected language first, then all
            langs_to_check = [language] if language else ["ja", "en"]
            for lang in langs_to_check:
                if lang in keywords_by_lang:
                    for keyword in keywords_by_lang[lang]:
                        if keyword.lower() in text_lower or keyword.lower() in file_name_lower:
                            score += 1
                            matched_keywords.append(keyword)

            if score > 0:
                scores[doc_type] = (score, matched_keywords)

        if not scores:
            # No keywords matched
            if text:
                return ("other", 0.3, "No specific document type keywords found")
            else:
                return ("unknown", 0.1, "Insufficient content to classify")

        # Get highest scoring type
        best_type = max(scores.keys(), key=lambda k: scores[k][0])
        best_score, matched = scores[best_type]

        # Calculate confidence based on number of matches
        if best_score >= 3:
            confidence = 0.85
        elif best_score >= 2:
            confidence = 0.7
        else:
            confidence = 0.5

        rationale = f"Matched keywords: {', '.join(matched[:3])}"
        return (best_type, confidence, rationale)

    def _extract_date(self, text: str) -> Optional[str]:
        """
        Extract date only if clearly present in standard format.
        Returns YYYY-MM-DD or null.
        Rule: Never guess dates.
        """
        if not text:
            return None

        matches = self.DATE_PATTERN.findall(text)
        if not matches:
            return None

        # Take the first valid date found
        for match in matches:
            year, month, day = match
            try:
                year = int(year)
                month = int(month)
                day = int(day)

                # Basic validation
                if 1900 <= year <= 2100 and 1 <= month <= 12 and 1 <= day <= 31:
                    return f"{year:04d}-{month:02d}-{day:02d}"
            except ValueError:
                continue

        return None

    def _extract_company(self, text: str) -> Optional[str]:
        """
        Extract company name only if explicitly stated.
        Rule: Never guess company names. Return null if unsure.
        """
        if not text:
            return None

        # Look for explicit company name patterns
        # Japanese patterns: "株式会社XXX", "XXX株式会社", "合同会社XXX"
        ja_patterns = [
            re.compile(r'(株式会社[^\s　、。\n]{2,20})'),
            re.compile(r'([^\s　、。\n]{2,20}株式会社)'),
            re.compile(r'(合同会社[^\s　、。\n]{2,20})'),
            re.compile(r'(有限会社[^\s　、。\n]{2,20})'),
        ]

        for pattern in ja_patterns:
            match = pattern.search(text)
            if match:
                return match.group(1).strip()

        # English patterns: "XXX Inc.", "XXX Corp.", "XXX Ltd."
        en_patterns = [
            re.compile(r'([A-Z][A-Za-z\s]{2,30}(?:Inc\.|Corp\.|Ltd\.|LLC|Corporation|Company))'),
        ]

        for pattern in en_patterns:
            match = pattern.search(text)
            if match:
                return match.group(1).strip()

        # If no clear pattern found, return null (never guess)
        return None

    def _calculate_confidence(
        self, doc_type: str, type_confidence: float,
        language: Optional[str], text: str
    ) -> float:
        """Calculate overall classification confidence."""
        # Start with type detection confidence
        confidence = type_confidence

        # Adjust based on available information
        if language is None:
            confidence *= 0.9

        if not text or len(text) < 100:
            confidence *= 0.7

        # Unknown type has lower confidence
        if doc_type == "unknown":
            confidence = min(confidence, 0.2)

        return min(confidence, 1.0)

    def _build_rationale(
        self, doc_type: str, type_rationale: str,
        language: Optional[str], doc_date: Optional[str],
        owner_company: Optional[str]
    ) -> str:
        """Build explanation for the classification."""
        parts = [f"Document type: {doc_type}. {type_rationale}"]

        if language:
            parts.append(f"Language detected: {language}")

        if doc_date:
            parts.append(f"Date found: {doc_date}")

        if owner_company:
            parts.append(f"Company identified: {owner_company}")

        return ". ".join(parts)


def classify_document(file_name: str, file_type: str, raw_text: str) -> dict:
    """
    Convenience function to classify a document and return JSON-serializable dict.

    Args:
        file_name: Name of the file
        file_type: MIME type or extension
        raw_text: First ~3000 characters of content

    Returns:
        Dictionary matching the strict JSON output specification
    """
    classifier = DocumentClassifier()
    result = classifier.classify(file_name, file_type, raw_text)
    return result.to_dict()


async def classify_document_with_llm(
    file_name: str,
    file_type: str,
    raw_text: str,
    ollama_client: "OllamaClient",
) -> Optional[dict]:
    """
    Classify document using LLM.

    Args:
        file_name: Name of the file
        file_type: MIME type or extension
        raw_text: Document text content
        ollama_client: OllamaClient instance

    Returns:
        Dictionary matching the output spec, or None if LLM fails
    """
    from src.llm.prompts.document_classifier import (
        DOCUMENT_CLASSIFIER_SYSTEM,
        format_document_classifier_input,
    )

    prompt = format_document_classifier_input(file_name, file_type, raw_text)

    result, error = await ollama_client.generate_json(
        prompt=prompt,
        system=DOCUMENT_CLASSIFIER_SYSTEM,
        temperature=0.1,
    )

    if error:
        logger.warning(f"LLM classification failed: {error}")
        return None

    if not result or not isinstance(result, dict):
        logger.warning("LLM returned invalid response format")
        return None

    # Validate and normalize the response
    valid_doc_types = ["minutes", "contract", "manual", "invoice", "report", "csv", "other", "unknown"]
    doc_type = result.get("doc_type", "unknown")
    if doc_type not in valid_doc_types:
        doc_type = "unknown"

    valid_languages = ["ja", "en", "other", None]
    language = result.get("language")
    if language not in valid_languages:
        language = None

    # Validate confidence
    confidence = result.get("confidence", 0.5)
    try:
        confidence = float(confidence)
        confidence = min(max(confidence, 0.0), 1.0)
    except (ValueError, TypeError):
        confidence = 0.5

    normalized = {
        "doc_type": doc_type,
        "owner_company": result.get("owner_company"),
        "doc_date": result.get("doc_date"),
        "language": language,
        "confidence": round(confidence, 2),
        "rationale": result.get("rationale", "Classified by LLM"),
    }

    logger.info(f"LLM classified document as: {doc_type} (confidence: {confidence})")
    return normalized


async def classify_document_async(
    file_name: str,
    file_type: str,
    raw_text: str,
    ollama_client: Optional["OllamaClient"] = None,
    use_llm: bool = True,
) -> dict:
    """
    Async function to classify document with LLM support and rule-based fallback.

    Args:
        file_name: Name of the file
        file_type: MIME type or extension
        raw_text: Document text content
        ollama_client: Optional OllamaClient for LLM classification
        use_llm: Whether to use LLM (default True)

    Returns:
        Dictionary matching the strict JSON output specification
    """
    # Try LLM classification first if enabled
    if use_llm and ollama_client:
        try:
            result = await classify_document_with_llm(
                file_name, file_type, raw_text, ollama_client
            )
            if result:
                return result
        except Exception as e:
            logger.warning(f"LLM classification error, falling back to rules: {e}")

    # Fallback to rule-based classification
    return classify_document(file_name, file_type, raw_text)
