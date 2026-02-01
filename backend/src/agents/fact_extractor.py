"""
Fact Extractor Agent
Extracts usable business facts from document chunks.
Supports LLM-enhanced extraction with rule-based fallback.
"""

import re
import json
import logging
from typing import Optional, List, TYPE_CHECKING
from dataclasses import dataclass, field

if TYPE_CHECKING:
    from src.llm.ai_client import AIClient as OllamaClient

logger = logging.getLogger(__name__)


@dataclass
class Quote:
    """Evidence quote with source location."""
    quote: str
    page: Optional[int]
    chunk_index: int

    def to_dict(self) -> dict:
        return {
            "quote": self.quote,
            "page": self.page,
            "chunk_index": self.chunk_index
        }


@dataclass
class Evidence:
    """Evidence container with quotes."""
    quotes: List[Quote] = field(default_factory=list)

    def to_dict(self) -> dict:
        return {
            "quotes": [q.to_dict() for q in self.quotes]
        }


@dataclass
class Fact:
    """Extracted fact following strict JSON specification."""
    fact_type: str
    body: str
    evidence: Evidence
    confidence: float
    title: Optional[str] = None
    owner: Optional[str] = None
    due_date: Optional[str] = None
    status: Optional[str] = None

    def to_dict(self) -> dict:
        return {
            "fact_type": self.fact_type,
            "title": self.title,
            "body": self.body,
            "owner": self.owner,
            "due_date": self.due_date,
            "status": self.status,
            "evidence": self.evidence.to_dict(),
            "confidence": self.confidence
        }


@dataclass
class ExtractionResult:
    """Extraction result containing all facts."""
    facts: List[Fact] = field(default_factory=list)

    def to_dict(self) -> dict:
        return {
            "facts": [f.to_dict() for f in self.facts]
        }

    def to_json(self) -> str:
        return json.dumps(self.to_dict(), ensure_ascii=False, indent=2)


class FactExtractor:
    """
    Fact Extractor Agent.

    Input:
        - doc_type: str (minutes|contract|manual|invoice|csv|other|unknown)
        - chunks: list of dict with keys: text, page (optional), index

    Output (STRICT JSON):
        {
            "facts": [
                {
                    "fact_type": "task|decision|risk|qna|requirement|summary",
                    "title": "string|null",
                    "body": "string",
                    "owner": "string|null",
                    "due_date": "YYYY-MM-DD|null",
                    "status": "open|done|unknown|null",
                    "evidence": {
                        "quotes": [
                            {
                                "quote": "string",
                                "page": 1,
                                "chunk_index": 0
                            }
                        ]
                    },
                    "confidence": 0.0
                }
            ]
        }

    Rules:
        - Evidence is mandatory
        - No guessing. If unsure, return null.
    """

    VALID_FACT_TYPES = ["task", "decision", "risk", "qna", "requirement", "summary"]
    VALID_STATUSES = ["open", "done", "unknown", None]

    # Date pattern: YYYY-MM-DD format
    DATE_PATTERN = re.compile(r'\b(\d{4})[-/年](\d{1,2})[-/月](\d{1,2})日?\b')

    # Patterns for extracting facts by type
    FACT_PATTERNS = {
        "task": {
            "ja": [
                re.compile(r'(TODO|タスク|対応|作業|実施|依頼)[：:]\s*(.+)', re.IGNORECASE),
                re.compile(r'(.+)(を|が)(対応|実施|作業|完了)(する|します|してください|予定)', re.IGNORECASE),
                re.compile(r'【(TODO|タスク|宿題|アクション)】\s*(.+)', re.IGNORECASE),
            ],
            "en": [
                re.compile(r'(TODO|TASK|ACTION)[：:]\s*(.+)', re.IGNORECASE),
                re.compile(r'(will|should|must|need to)\s+(.+)', re.IGNORECASE),
            ]
        },
        "decision": {
            "ja": [
                re.compile(r'(決定|合意|決議)[：:事項]*\s*(.+)', re.IGNORECASE),
                re.compile(r'(.+)(に|と)(決定|決まり|合意)(しました|した|する)', re.IGNORECASE),
                re.compile(r'【(決定|決議|合意)】\s*(.+)', re.IGNORECASE),
            ],
            "en": [
                re.compile(r'(DECISION|AGREED|RESOLVED)[：:]\s*(.+)', re.IGNORECASE),
                re.compile(r'(decided|agreed|resolved)\s+(to|that)\s+(.+)', re.IGNORECASE),
            ]
        },
        "risk": {
            "ja": [
                re.compile(r'(リスク|懸念|課題|問題)[：:]\s*(.+)', re.IGNORECASE),
                re.compile(r'【(リスク|懸念|課題)】\s*(.+)', re.IGNORECASE),
            ],
            "en": [
                re.compile(r'(RISK|CONCERN|ISSUE|PROBLEM)[：:]\s*(.+)', re.IGNORECASE),
            ]
        },
        "qna": {
            "ja": [
                re.compile(r'(Q|質問)[：:]\s*(.+)', re.IGNORECASE),
                re.compile(r'(A|回答)[：:]\s*(.+)', re.IGNORECASE),
            ],
            "en": [
                re.compile(r'(Q|Question)[：:]\s*(.+)', re.IGNORECASE),
                re.compile(r'(A|Answer)[：:]\s*(.+)', re.IGNORECASE),
            ]
        },
        "requirement": {
            "ja": [
                re.compile(r'(要件|要求|仕様)[：:]\s*(.+)', re.IGNORECASE),
                re.compile(r'【(要件|要求|仕様)】\s*(.+)', re.IGNORECASE),
            ],
            "en": [
                re.compile(r'(REQUIREMENT|SPEC)[：:]\s*(.+)', re.IGNORECASE),
                re.compile(r'(shall|must)\s+(.+)', re.IGNORECASE),
            ]
        }
    }

    # Patterns for owner extraction
    OWNER_PATTERNS = [
        re.compile(r'(担当|責任者)[：:]\s*([^\s、。,]+)', re.IGNORECASE),
        re.compile(r'([^\s、。,]+)(さん|氏|様)が(担当|対応)', re.IGNORECASE),
        re.compile(r'(assigned to|owner)[：:]\s*([^\s,\.]+)', re.IGNORECASE),
    ]

    # Patterns for status extraction
    # Note: Check "done" first to avoid "完了" being skipped due to "todo" pattern
    STATUS_PATTERNS = {
        "done": [
            re.compile(r'(完了|対応済|クローズ|終了|解決)', re.IGNORECASE),
            re.compile(r'(completed|done|closed|resolved|finished)', re.IGNORECASE),
        ],
        "open": [
            re.compile(r'(未完了|未対応|対応中|進行中|オープン|未着手)', re.IGNORECASE),
            re.compile(r'(pending|in progress|open|ongoing)', re.IGNORECASE),
        ]
    }

    def extract(self, doc_type: str, chunks: List[dict]) -> ExtractionResult:
        """
        Extract facts from document chunks.

        Args:
            doc_type: Type of document (minutes|contract|manual|invoice|csv|other|unknown)
            chunks: List of chunks, each with 'text', optional 'page', and 'index'

        Returns:
            ExtractionResult with extracted facts
        """
        result = ExtractionResult()

        for chunk_idx, chunk in enumerate(chunks):
            text = chunk.get("text", "")
            page = chunk.get("page")
            index = chunk.get("index", chunk_idx)

            if not text:
                continue

            # Extract facts from this chunk
            chunk_facts = self._extract_facts_from_chunk(text, page, index, doc_type)
            result.facts.extend(chunk_facts)

        return result

    def _extract_facts_from_chunk(
        self, text: str, page: Optional[int], chunk_index: int, doc_type: str
    ) -> List[Fact]:
        """Extract all facts from a single chunk."""
        facts = []

        # Try to detect fact types using patterns
        for fact_type, patterns_by_lang in self.FACT_PATTERNS.items():
            for lang, patterns in patterns_by_lang.items():
                for pattern in patterns:
                    matches = pattern.finditer(text)
                    for match in matches:
                        fact = self._create_fact_from_match(
                            match, fact_type, text, page, chunk_index
                        )
                        if fact:
                            facts.append(fact)

        # If document is minutes and no specific facts found, try summary extraction
        if doc_type == "minutes" and not facts:
            summary_fact = self._extract_summary(text, page, chunk_index)
            if summary_fact:
                facts.append(summary_fact)

        return facts

    def _create_fact_from_match(
        self, match: re.Match, fact_type: str, text: str,
        page: Optional[int], chunk_index: int
    ) -> Optional[Fact]:
        """Create a Fact from a regex match."""
        # Get the matched content
        groups = match.groups()
        if len(groups) >= 2:
            body = groups[-1].strip()
        else:
            body = match.group(0).strip()

        if not body or len(body) < 3:
            return None

        # Extract quote (the matching line + context)
        quote_text = self._extract_quote_context(text, match)
        if not quote_text:
            return None

        # Create evidence (mandatory)
        evidence = Evidence(quotes=[
            Quote(quote=quote_text, page=page, chunk_index=chunk_index)
        ])

        # Extract optional fields - only if explicitly stated
        owner = self._extract_owner(text)
        due_date = self._extract_date(text)
        status = self._extract_status(text)

        # Calculate confidence
        confidence = self._calculate_confidence(body, quote_text, fact_type)

        return Fact(
            fact_type=fact_type,
            title=None,  # Only set if explicitly found
            body=body,
            owner=owner,
            due_date=due_date,
            status=status,
            evidence=evidence,
            confidence=round(confidence, 2)
        )

    def _extract_quote_context(self, text: str, match: re.Match) -> Optional[str]:
        """Extract the quote with surrounding context."""
        start = match.start()
        end = match.end()

        # Find line boundaries
        line_start = text.rfind('\n', 0, start)
        line_start = 0 if line_start == -1 else line_start + 1

        line_end = text.find('\n', end)
        line_end = len(text) if line_end == -1 else line_end

        quote = text[line_start:line_end].strip()
        return quote if quote else None

    def _extract_owner(self, text: str) -> Optional[str]:
        """
        Extract owner only if explicitly stated.
        Rule: Never guess. Return null if unsure.
        """
        for pattern in self.OWNER_PATTERNS:
            match = pattern.search(text)
            if match:
                groups = match.groups()
                # Get the name part (usually second group)
                for group in groups:
                    if group and len(group) >= 2 and not group in ["担当", "責任者", "assigned to", "owner"]:
                        return group.strip()
        return None

    def _extract_date(self, text: str) -> Optional[str]:
        """
        Extract date only if clearly present in standard format.
        Returns YYYY-MM-DD or null.
        Rule: Never guess dates.
        """
        matches = self.DATE_PATTERN.findall(text)
        if not matches:
            return None

        for match in matches:
            year, month, day = match
            try:
                year = int(year)
                month = int(month)
                day = int(day)

                if 1900 <= year <= 2100 and 1 <= month <= 12 and 1 <= day <= 31:
                    return f"{year:04d}-{month:02d}-{day:02d}"
            except ValueError:
                continue

        return None

    def _extract_status(self, text: str) -> Optional[str]:
        """
        Extract status only if explicitly stated.
        Returns open|done|unknown or null.
        Rule: Never guess. Return null if unsure.
        """
        # Check "open" patterns first because they are more specific
        # (e.g., "未完了" contains "完了" but should be "open")
        for pattern in self.STATUS_PATTERNS.get("open", []):
            if pattern.search(text):
                return "open"

        # Then check "done" patterns
        for pattern in self.STATUS_PATTERNS.get("done", []):
            if pattern.search(text):
                return "done"

        return None

    def _extract_summary(
        self, text: str, page: Optional[int], chunk_index: int
    ) -> Optional[Fact]:
        """
        Extract a summary fact from text.
        Used when no specific facts are found in minutes-type documents.
        """
        # Only create summary if text has substantial content
        if len(text.strip()) < 50:
            return None

        # Use first 200 chars as body
        body = text.strip()[:200]
        if len(text.strip()) > 200:
            body += "..."

        # Quote is the actual text (truncated)
        quote = text.strip()[:300]

        evidence = Evidence(quotes=[
            Quote(quote=quote, page=page, chunk_index=chunk_index)
        ])

        return Fact(
            fact_type="summary",
            title=None,
            body=body,
            owner=None,
            due_date=None,
            status=None,
            evidence=evidence,
            confidence=0.5  # Lower confidence for summaries
        )

    def _calculate_confidence(
        self, body: str, quote: str, fact_type: str
    ) -> float:
        """Calculate extraction confidence."""
        confidence = 0.7  # Base confidence

        # Longer body with clear content = higher confidence
        if len(body) > 20:
            confidence += 0.1

        # Quote matches body closely
        if body.lower() in quote.lower():
            confidence += 0.1

        # Known fact type patterns matched
        if fact_type in self.VALID_FACT_TYPES:
            confidence += 0.05

        return min(confidence, 1.0)


async def extract_facts_with_llm(
    doc_type: str,
    chunks: List[dict],
    ollama_client: "OllamaClient",
    language: str = "ja",
) -> Optional[dict]:
    """
    Extract facts using LLM.

    Args:
        doc_type: Document type
        chunks: List of chunks with 'text', optional 'page', and 'index'
        ollama_client: OllamaClient instance
        language: Document language

    Returns:
        Dictionary matching the output spec, or None if LLM fails
    """
    from src.llm.prompts.fact_extractor import (
        FACT_EXTRACTOR_SYSTEM,
        format_fact_extractor_input,
    )

    # Format the prompt
    prompt = format_fact_extractor_input(doc_type, language, chunks)

    # Call LLM
    result, error = await ollama_client.generate_json(
        prompt=prompt,
        system=FACT_EXTRACTOR_SYSTEM,
        temperature=0.1,
    )

    if error:
        logger.warning(f"LLM fact extraction failed: {error}")
        return None

    # Validate and normalize the response
    if not result or not isinstance(result, dict):
        logger.warning("LLM returned invalid response format")
        return None

    facts = result.get("facts", [])
    if not isinstance(facts, list):
        logger.warning("LLM returned invalid facts format")
        return None

    # Validate each fact
    valid_facts = []
    for fact in facts:
        if not isinstance(fact, dict):
            continue

        # Ensure required fields
        fact_type = fact.get("fact_type", "summary")
        if fact_type not in FactExtractor.VALID_FACT_TYPES:
            fact_type = "summary"

        # Normalize evidence format
        evidence = fact.get("evidence", {})
        if isinstance(evidence, dict):
            quote = evidence.get("quote", "")
            chunk_index = evidence.get("chunk_index", 0)
            evidence = {
                "quotes": [{
                    "quote": quote,
                    "page": None,
                    "chunk_index": chunk_index,
                }]
            }
        elif not evidence:
            evidence = {"quotes": []}

        valid_fact = {
            "fact_type": fact_type,
            "title": fact.get("title"),
            "body": fact.get("body", ""),
            "owner": fact.get("owner"),
            "due_date": fact.get("due_date"),
            "status": fact.get("status"),
            "evidence": evidence,
            "confidence": min(max(float(fact.get("confidence", 0.7)), 0.0), 1.0),
        }
        valid_facts.append(valid_fact)

    logger.info(f"LLM extracted {len(valid_facts)} facts")
    return {"facts": valid_facts}


async def extract_facts_async(
    doc_type: str,
    chunks: List[dict],
    ollama_client: Optional["OllamaClient"] = None,
    use_llm: bool = True,
    language: str = "ja",
) -> dict:
    """
    Async function to extract facts with LLM support and rule-based fallback.

    Args:
        doc_type: Type of document
        chunks: List of chunks with 'text', optional 'page', and 'index'
        ollama_client: Optional OllamaClient for LLM extraction
        use_llm: Whether to use LLM (default True)
        language: Document language

    Returns:
        Dictionary matching the strict JSON output specification
    """
    # Try LLM extraction first if enabled
    if use_llm and ollama_client:
        try:
            result = await extract_facts_with_llm(
                doc_type, chunks, ollama_client, language
            )
            if result:
                return result
        except Exception as e:
            logger.warning(f"LLM extraction error, falling back to rules: {e}")

    # Fallback to rule-based extraction
    return extract_facts(doc_type, chunks)


def extract_facts(doc_type: str, chunks: List[dict]) -> dict:
    """
    Convenience function to extract facts and return JSON-serializable dict.

    Args:
        doc_type: Type of document
        chunks: List of chunks with 'text', optional 'page', and 'index'

    Returns:
        Dictionary matching the strict JSON output specification
    """
    extractor = FactExtractor()
    result = extractor.extract(doc_type, chunks)
    return result.to_dict()
