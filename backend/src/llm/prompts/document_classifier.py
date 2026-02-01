"""
Prompt template for LLM-enhanced document classification.
Optimized for reduced token count.
"""

DOCUMENT_CLASSIFIER_SYSTEM = """Classify documents. Output valid JSON only."""

DOCUMENT_CLASSIFIER_PROMPT = """Classify this document.

File: {file_name} ({file_type})

Text:
{text}

Types: minutes|contract|manual|invoice|report|csv|other|unknown

Output JSON:
{{"doc_type":"..","owner_company":null,"doc_date":"YYYY-MM-DD or null","language":"ja|en|other","confidence":0.0-1.0,"rationale":"..."}}

JSON:"""


def format_document_classifier_input(
    file_name: str,
    file_type: str,
    text: str,
    max_text_length: int = 3000,
) -> str:
    """
    Format input for the document classifier prompt.

    Args:
        file_name: Original file name
        file_type: File MIME type or extension
        text: Document text content
        max_text_length: Maximum text length to include

    Returns:
        Formatted prompt string.
    """
    # Truncate text if too long
    if len(text) > max_text_length:
        text = text[:max_text_length] + "\n...[truncated]"

    return DOCUMENT_CLASSIFIER_PROMPT.format(
        file_name=file_name,
        file_type=file_type,
        text=text,
    )
