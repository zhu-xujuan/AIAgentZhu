"""
Chunking Agent
Splits document into searchable chunks with 800-1500 characters per chunk.
"""

import re
import json
from typing import Optional
from dataclasses import dataclass


@dataclass
class Chunk:
    """A single chunk following strict JSON specification."""
    chunk_index: int
    page: int
    section_title: Optional[str]
    text: str
    char_len: int

    def to_dict(self) -> dict:
        return {
            "chunk_index": self.chunk_index,
            "page": self.page,
            "section_title": self.section_title,
            "text": self.text,
            "char_len": self.char_len
        }


@dataclass
class ChunkingResult:
    """Chunking result following strict JSON specification."""
    chunks: list[Chunk]

    def to_dict(self) -> dict:
        return {
            "chunks": [chunk.to_dict() for chunk in self.chunks]
        }

    def to_json(self) -> str:
        return json.dumps(self.to_dict(), ensure_ascii=False, indent=2)


class ChunkingAgent:
    """
    Chunking Agent.

    Input:
        pages = [{page, text}]

    Output (STRICT JSON):
        {
            "chunks": [
                {
                    "chunk_index": 0,
                    "page": 1,
                    "section_title": "string|null",
                    "text": "string",
                    "char_len": 1200
                }
            ]
        }

    Rules:
        - 800-1500 characters per chunk
        - Preserve meaning (do not split mid-sentence if possible)
    """

    MIN_CHUNK_SIZE = 800
    MAX_CHUNK_SIZE = 1500
    TARGET_CHUNK_SIZE = 1200  # Optimal target within range

    # Section title patterns (headings, numbered sections, etc.)
    SECTION_PATTERNS = [
        re.compile(r'^(#{1,6})\s+(.+)$', re.MULTILINE),  # Markdown headings
        re.compile(r'^(\d+(?:\.\d+)*)\s+(.+)$', re.MULTILINE),  # Numbered sections
        re.compile(r'^【(.+?)】', re.MULTILINE),  # Japanese brackets
        re.compile(r'^■(.+?)$', re.MULTILINE),  # Japanese square bullet
        re.compile(r'^◆(.+?)$', re.MULTILINE),  # Japanese diamond bullet
        re.compile(r'^第[一二三四五六七八九十\d]+[章節条項]\s*(.+)?$', re.MULTILINE),  # Japanese legal sections
    ]

    # Sentence-ending patterns for Japanese and English
    SENTENCE_END_PATTERN = re.compile(r'[。．.!?！？\n]+')

    def chunk(self, pages: list[dict]) -> ChunkingResult:
        """
        Split document pages into searchable chunks.

        Args:
            pages: List of dicts with 'page' and 'text' keys

        Returns:
            ChunkingResult with list of chunks
        """
        all_chunks = []
        chunk_index = 0

        for page_data in pages:
            page_num = page_data.get("page", 1)
            text = page_data.get("text", "")

            if not text or not text.strip():
                continue

            # Split this page's text into chunks
            page_chunks = self._split_text_into_chunks(text, page_num)

            for chunk_text, section_title in page_chunks:
                if chunk_text.strip():
                    chunk = Chunk(
                        chunk_index=chunk_index,
                        page=page_num,
                        section_title=section_title,
                        text=chunk_text.strip(),
                        char_len=len(chunk_text.strip())
                    )
                    all_chunks.append(chunk)
                    chunk_index += 1

        return ChunkingResult(chunks=all_chunks)

    def _split_text_into_chunks(
        self, text: str, page_num: int
    ) -> list[tuple[str, Optional[str]]]:
        """
        Split text into chunks of 800-1500 characters.
        Returns list of (chunk_text, section_title) tuples.
        """
        if len(text) <= self.MAX_CHUNK_SIZE:
            # Text fits in single chunk
            section_title = self._extract_section_title(text)
            return [(text, section_title)]

        chunks = []
        remaining_text = text
        current_section_title = None

        while remaining_text:
            # Check for section title at start
            new_section = self._extract_section_title(remaining_text)
            if new_section:
                current_section_title = new_section

            if len(remaining_text) <= self.MAX_CHUNK_SIZE:
                # Remaining text fits in final chunk
                chunks.append((remaining_text, current_section_title))
                break

            # Find optimal split point
            split_point = self._find_split_point(remaining_text)
            chunk_text = remaining_text[:split_point]
            remaining_text = remaining_text[split_point:].lstrip()

            if chunk_text.strip():
                chunks.append((chunk_text, current_section_title))

        return chunks

    def _find_split_point(self, text: str) -> int:
        """
        Find optimal split point that preserves meaning.
        Prioritizes: paragraph breaks > sentence ends > clause breaks
        """
        # First, try to find a split point near the target size
        search_start = self.MIN_CHUNK_SIZE
        search_end = min(len(text), self.MAX_CHUNK_SIZE)

        # Priority 1: Paragraph breaks (double newline)
        split_point = self._find_break_in_range(text, search_start, search_end, '\n\n')
        if split_point:
            return split_point

        # Priority 2: Single newline
        split_point = self._find_break_in_range(text, search_start, search_end, '\n')
        if split_point:
            return split_point

        # Priority 3: Sentence endings
        split_point = self._find_sentence_end_in_range(text, search_start, search_end)
        if split_point:
            return split_point

        # Priority 4: Clause breaks (comma, semicolon, etc.)
        for delimiter in ['、', '，', ',', '；', ';', '：', ':']:
            split_point = self._find_break_in_range(text, search_start, search_end, delimiter)
            if split_point:
                return split_point + 1  # Include the delimiter

        # Fallback: Split at target size (avoiding mid-character for Japanese)
        return self._safe_split_point(text, self.TARGET_CHUNK_SIZE)

    def _find_break_in_range(
        self, text: str, start: int, end: int, delimiter: str
    ) -> Optional[int]:
        """Find the last occurrence of delimiter in the specified range."""
        search_text = text[start:end]
        last_pos = search_text.rfind(delimiter)

        if last_pos >= 0:
            return start + last_pos + len(delimiter)

        return None

    def _find_sentence_end_in_range(
        self, text: str, start: int, end: int
    ) -> Optional[int]:
        """Find the last sentence ending in the specified range."""
        search_text = text[start:end]
        matches = list(self.SENTENCE_END_PATTERN.finditer(search_text))

        if matches:
            last_match = matches[-1]
            return start + last_match.end()

        return None

    def _safe_split_point(self, text: str, target: int) -> int:
        """
        Find safe split point near target, avoiding mid-character issues.
        """
        if target >= len(text):
            return len(text)

        # For safety, ensure we don't exceed MAX_CHUNK_SIZE
        target = min(target, self.MAX_CHUNK_SIZE)

        # Find nearest whitespace
        for offset in range(50):
            # Check before target
            if target - offset >= self.MIN_CHUNK_SIZE:
                if text[target - offset] in ' \t\n　':
                    return target - offset + 1
            # Check after target
            if target + offset <= self.MAX_CHUNK_SIZE and target + offset < len(text):
                if text[target + offset] in ' \t\n　':
                    return target + offset + 1

        return target

    def _extract_section_title(self, text: str) -> Optional[str]:
        """
        Extract section title from the beginning of text.
        Returns null if no clear section title found.
        """
        if not text:
            return None

        # Only check first few lines
        first_lines = text[:200]

        for pattern in self.SECTION_PATTERNS:
            match = pattern.search(first_lines)
            if match:
                # Get the title part (last group usually contains the title)
                groups = match.groups()
                title = groups[-1] if groups[-1] else groups[-2] if len(groups) > 1 else None
                if title:
                    # Clean up the title
                    title = title.strip()
                    if len(title) > 100:
                        title = title[:100] + "..."
                    return title

        return None


def chunk_document(pages: list[dict]) -> dict:
    """
    Convenience function to chunk a document and return JSON-serializable dict.

    Args:
        pages: List of dicts with 'page' and 'text' keys

    Returns:
        Dictionary matching the strict JSON output specification
    """
    agent = ChunkingAgent()
    result = agent.chunk(pages)
    return result.to_dict()
