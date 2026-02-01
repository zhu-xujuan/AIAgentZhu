"""
Prompt templates for LLM-enhanced agents.
"""

from .fact_extractor import FACT_EXTRACTOR_PROMPT, format_fact_extractor_input
from .sql_query import SQL_QUERY_PROMPT, format_sql_query_input
from .answer_formatter import ANSWER_FORMATTER_PROMPT, format_answer_formatter_input
from .document_classifier import DOCUMENT_CLASSIFIER_PROMPT, format_document_classifier_input
from .quality_guardian import QUALITY_GUARDIAN_PROMPT, format_quality_guardian_input

__all__ = [
    "FACT_EXTRACTOR_PROMPT",
    "format_fact_extractor_input",
    "SQL_QUERY_PROMPT",
    "format_sql_query_input",
    "ANSWER_FORMATTER_PROMPT",
    "format_answer_formatter_input",
    "DOCUMENT_CLASSIFIER_PROMPT",
    "format_document_classifier_input",
    "QUALITY_GUARDIAN_PROMPT",
    "format_quality_guardian_input",
]
