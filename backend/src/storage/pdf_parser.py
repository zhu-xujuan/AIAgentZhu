"""
PDF Parser for extracting text from PDF files.
Uses PyPDF2 for text extraction.
"""

import logging
from typing import List, Dict, Any
from io import BytesIO
from PyPDF2 import PdfReader

logger = logging.getLogger(__name__)


def extract_text_from_pdf(content: bytes) -> List[Dict[str, Any]]:
    """
    Extract text from PDF file content.

    Args:
        content: PDF file content as bytes

    Returns:
        List of page dictionaries with 'page' (number) and 'text' (content)
    """
    try:
        pdf_file = BytesIO(content)
        pdf_reader = PdfReader(pdf_file)

        pages = []
        for page_num, page in enumerate(pdf_reader.pages, start=1):
            try:
                text = page.extract_text()
                if text.strip():  # Only add non-empty pages
                    pages.append({
                        "page": page_num,
                        "text": text
                    })
                else:
                    logger.warning(f"Page {page_num} has no extractable text")
            except Exception as e:
                logger.error(f"Failed to extract text from page {page_num}: {e}")
                continue

        logger.info(f"Extracted text from {len(pages)} pages (total {len(pdf_reader.pages)} pages)")
        return pages

    except Exception as e:
        logger.error(f"Failed to parse PDF: {e}")
        raise ValueError(f"Failed to parse PDF file: {str(e)}")


def is_valid_pdf(content: bytes) -> bool:
    """
    Check if the content is a valid PDF file.

    Args:
        content: File content as bytes

    Returns:
        True if valid PDF, False otherwise
    """
    try:
        # Check PDF magic number
        if not content.startswith(b'%PDF'):
            return False

        # Try to parse
        pdf_file = BytesIO(content)
        pdf_reader = PdfReader(pdf_file)

        # Check if we can access at least one page
        if len(pdf_reader.pages) == 0:
            return False

        return True

    except Exception as e:
        logger.debug(f"PDF validation failed: {e}")
        return False
