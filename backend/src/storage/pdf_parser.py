"""
PDF Parser for extracting text from PDF files.
Uses PyPDF2 for text extraction. Optional OCR (e.g. glm-ocr) for pages with no text.
"""

import base64
import logging
from typing import List, Dict, Any, Optional, Tuple, TYPE_CHECKING
from io import BytesIO
from PyPDF2 import PdfReader

if TYPE_CHECKING:
    from src.llm.ai_client import AIClient

logger = logging.getLogger(__name__)

# Minimum characters from PyPDF2 to skip OCR for a page
MIN_TEXT_LEN_SKIP_OCR = 20


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


def _pdf_page_to_png_base64(content: bytes, page_index: int, dpi: int = 150) -> Optional[str]:
    """
    Render a single PDF page to PNG and return as base64 string.
    Uses PyMuPDF (fitz). Page index is 0-based.

    Returns:
        Base64-encoded PNG string, or None on failure.
    """
    try:
        import fitz
        doc = fitz.open(stream=content, filetype="pdf")
        if page_index < 0 or page_index >= len(doc):
            doc.close()
            return None
        page = doc[page_index]
        mat = fitz.Matrix(dpi / 72, dpi / 72)
        pix = page.get_pixmap(matrix=mat, alpha=False)
        png_bytes = pix.tobytes("png")
        doc.close()
        return base64.b64encode(png_bytes).decode("ascii")
    except Exception as e:
        logger.warning(f"Failed to render PDF page {page_index + 1} to image: {e}")
        return None


async def extract_text_from_pdf_with_ocr(
    content: bytes,
    ocr_client: "AIClient",
    ocr_model: str,
    min_text_len_skip_ocr: int = MIN_TEXT_LEN_SKIP_OCR,
) -> Tuple[List[Dict[str, Any]], bool]:
    """
    Extract text from PDF; use OCR for pages that have no or very little text.
    First tries PyPDF2 per page; if text length < min_text_len_skip_ocr, renders
    that page to image and runs OCR (e.g. glm-ocr).

    Args:
        content: PDF file content as bytes.
        ocr_client: AIClient instance (must be Ollama for OCR).
        ocr_model: Model name (e.g. "glm-ocr:bf16").
        min_text_len_skip_ocr: Skip OCR if page text length >= this.

    Returns:
        (pages, ocr_used): list of {"page": int, "text": str}, and True if OCR was used.
    """
    ocr_used = False
    try:
        pdf_file = BytesIO(content)
        pdf_reader = PdfReader(pdf_file)
        total_pages = len(pdf_reader.pages)
    except Exception as e:
        logger.error(f"Failed to open PDF for OCR path: {e}")
        raise ValueError(f"Failed to parse PDF file: {str(e)}")

    pages: List[Dict[str, Any]] = []
    for page_num in range(1, total_pages + 1):
        page_index = page_num - 1
        try:
            page = pdf_reader.pages[page_index]
            text = (page.extract_text() or "").strip()
        except Exception as e:
            logger.warning(f"Failed to extract text from page {page_num}: {e}")
            text = ""

        if len(text) >= min_text_len_skip_ocr:
            if text:
                pages.append({"page": page_num, "text": text})
            else:
                pages.append({"page": page_num, "text": ""})
            continue

        # Use OCR for this page
        b64 = _pdf_page_to_png_base64(content, page_index)
        if not b64:
            pages.append({"page": page_num, "text": text or ""})
            continue
        result = await ocr_client.ocr_image(b64, model=ocr_model)
        if result.success and result.text:
            pages.append({"page": page_num, "text": result.text.strip()})
            ocr_used = True
            logger.info(f"OCR extracted text for page {page_num} ({len(result.text)} chars)")
        else:
            pages.append({"page": page_num, "text": text or ""})
            if not result.success:
                logger.warning(f"OCR failed for page {page_num}: {result.error}")

    if ocr_used:
        logger.info(f"Extracted text with OCR from PDF ({len(pages)} pages)")
    return pages, ocr_used
