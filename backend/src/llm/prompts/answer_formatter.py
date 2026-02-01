"""
Prompt template for LLM-enhanced answer formatting.
Optimized for reduced token count.
"""

ANSWER_FORMATTER_SYSTEM = """Format facts into clear responses. Match the facts' language."""

ANSWER_FORMATTER_PROMPT = """Question: {question}

Facts ({count}):
{facts_text}

Rules: Use facts' language. Note low confidence (<0.7). Be concise.

Answer:"""


def format_answer_formatter_input(
    question: str,
    facts: list[dict],
) -> str:
    """
    Format input for the answer formatter prompt.

    Args:
        question: Original user question
        facts: List of fact dictionaries

    Returns:
        Formatted prompt string.
    """
    if not facts:
        facts_text = "(No facts found)"
    else:
        facts_text = ""
        for i, fact in enumerate(facts, 1):
            fact_type = fact.get("fact_type", "unknown")
            title = fact.get("title", "No title")
            body = fact.get("body", "")
            owner = fact.get("owner", "N/A")
            due_date = fact.get("due_date", "N/A")
            status = fact.get("status", "unknown")
            confidence = fact.get("confidence", 0.5)

            facts_text += f"""
Fact {i}:
  Type: {fact_type}
  Title: {title}
  Body: {body}
  Owner: {owner}
  Due Date: {due_date}
  Status: {status}
  Confidence: {confidence}
"""

    return ANSWER_FORMATTER_PROMPT.format(
        question=question,
        count=len(facts),
        facts_text=facts_text,
    )
