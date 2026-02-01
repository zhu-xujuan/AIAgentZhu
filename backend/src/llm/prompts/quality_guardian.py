"""
Prompt template for LLM-enhanced quality evaluation.
Optimized for reduced token count.
"""

QUALITY_GUARDIAN_SYSTEM = """Evaluate fact quality. Output valid JSON only."""

QUALITY_GUARDIAN_PROMPT = """Evaluate extracted facts quality.

Doc: {doc_type}, Chunks: {chunk_count}, OCR: {ocr_used}

Facts ({fact_count}):
{facts_text}

Review triggers: no facts, confidence<0.5, OCR used, contradictions, missing owner/resolution.

Output JSON:
{{"needs_review":true/false,"reasons":[".."],"fact_issues":[{{"fact_index":0,"issue":".."}}],"overall_quality":"high|medium|low","recommendations":[".."]}}

JSON:"""


def format_quality_guardian_input(
    doc_type: str,
    chunk_count: int,
    ocr_used: bool,
    facts: list[dict],
) -> str:
    """
    Format input for the quality guardian prompt.

    Args:
        doc_type: Document type
        chunk_count: Number of chunks processed
        ocr_used: Whether OCR was used
        facts: List of extracted facts

    Returns:
        Formatted prompt string.
    """
    if not facts:
        facts_text = "(No facts extracted)"
    else:
        facts_text = ""
        for i, fact in enumerate(facts):
            fact_type = fact.get("fact_type", "unknown")
            title = fact.get("title", "No title")
            body = fact.get("body", "")[:200]  # Truncate long bodies
            owner = fact.get("owner", "null")
            due_date = fact.get("due_date", "null")
            status = fact.get("status", "unknown")
            confidence = fact.get("confidence", 0.5)

            facts_text += f"""
[Fact {i}]
  Type: {fact_type}
  Title: {title}
  Body: {body}
  Owner: {owner}
  Due Date: {due_date}
  Status: {status}
  Confidence: {confidence}
"""

    return QUALITY_GUARDIAN_PROMPT.format(
        doc_type=doc_type,
        chunk_count=chunk_count,
        ocr_used="Yes" if ocr_used else "No",
        fact_count=len(facts),
        facts_text=facts_text,
    )
