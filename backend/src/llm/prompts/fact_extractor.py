"""
Prompt template for LLM-enhanced fact extraction.
Optimized for reduced token count and faster processing.
"""

FACT_EXTRACTOR_SYSTEM = """Extract structured facts from documents. Output valid JSON only."""

FACT_EXTRACTOR_PROMPT = """Extract facts from this {doc_type} document ({language}).

Types: task|decision|risk|qna|requirement|summary

Output JSON:
{{"facts":[{{"fact_type":"..","title":"..","body":"..","owner":null,"due_date":"YYYY-MM-DD or null","status":"open|done|unknown","evidence":{{"quote":"..","chunk_index":0}},"confidence":0.0-1.0}}]}}

Rules: Use exact quotes. null for missing fields. Match language.

Chunks:
{chunks_text}

JSON:"""


def format_fact_extractor_input(
    doc_type: str,
    language: str,
    chunks: list[dict],
) -> str:
    """
    Format input for the fact extractor prompt.

    Args:
        doc_type: Document type (minutes, contract, etc.)
        language: Document language (ja, en)
        chunks: List of chunk dictionaries with text and chunk_index

    Returns:
        Formatted prompt string.
    """
    chunks_text = ""
    for chunk in chunks:
        idx = chunk.get("chunk_index", 0)
        text = chunk.get("text", "")
        section = chunk.get("section_title", "")

        if section:
            chunks_text += f"\n--- Chunk {idx} [{section}] ---\n{text}\n"
        else:
            chunks_text += f"\n--- Chunk {idx} ---\n{text}\n"

    return FACT_EXTRACTOR_PROMPT.format(
        doc_type=doc_type,
        language=language,
        chunks_text=chunks_text,
    )
