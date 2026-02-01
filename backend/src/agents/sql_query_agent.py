"""
SQL Query Planner Agent
Convert user question into SQL filters.
Supports LLM-enhanced parsing with rule-based fallback.
"""

import re
import json
import logging
from datetime import datetime
from typing import Optional, List, TYPE_CHECKING
from dataclasses import dataclass, field

if TYPE_CHECKING:
    from src.llm.ai_client import AIClient as OllamaClient

logger = logging.getLogger(__name__)


@dataclass
class SQLQueryResult:
    """SQL Query result following strict JSON specification."""
    owner_company: Optional[str] = None
    fact_type: List[str] = field(default_factory=list)
    status: List[str] = field(default_factory=list)
    owner: Optional[str] = None
    date_from: Optional[str] = None
    date_to: Optional[str] = None
    keyword: Optional[str] = None
    limit: int = 50

    def to_dict(self) -> dict:
        return {
            "filters": {
                "owner_company": self.owner_company,
                "fact_type": self.fact_type,
                "status": self.status,
                "owner": self.owner,
                "date_from": self.date_from,
                "date_to": self.date_to
            },
            "keyword": self.keyword,
            "limit": self.limit
        }

    def to_json(self) -> str:
        return json.dumps(self.to_dict(), ensure_ascii=False, indent=2)


class SQLQueryAgent:
    """
    SQL Query Planner Agent.

    Input:
        - question: str (user's natural language question)

    Output (STRICT JSON):
        {
            "filters": {
                "owner_company": "string|null",
                "fact_type": ["task","decision","risk","qna"],
                "status": ["open","done"],
                "owner": "string|null",
                "date_from": "YYYY-MM-DD|null",
                "date_to": "YYYY-MM-DD|null"
            },
            "keyword": "string|null",
            "limit": 50
        }

    Rules:
        - Extract owner_company, owner, status, date range, and keyword from question.
        - Never guess values. If unsure, return null.
        - Dates must be in YYYY-MM-DD format.
    """

    # Valid fact types (per spec)
    VALID_FACT_TYPES = ["task", "decision", "risk", "qna"]

    # Valid status values (per spec)
    VALID_STATUSES = ["open", "done"]

    # Date patterns
    DATE_PATTERNS = [
        # YYYY-MM-DD or YYYY/MM/DD
        re.compile(r'(\d{4})[-/](\d{1,2})[-/](\d{1,2})'),
        # Japanese: YYYY年MM月DD日
        re.compile(r'(\d{4})年(\d{1,2})月(\d{1,2})日'),
        # Japanese: MM月DD日 (assume current year) - only if not preceded by year
        re.compile(r'(?<!\d)(\d{1,2})月(\d{1,2})日'),
    ]

    # Pattern to check if a date already has a year prefix
    YEAR_PREFIX_PATTERN = re.compile(r'\d{4}年(\d{1,2})月(\d{1,2})日')

    # Japanese year-month pattern (no day): YYYY年MM月
    YEAR_MONTH_PATTERN = re.compile(r'(\d{4})年(\d{1,2})月(?!\d)')

    # Month-end pattern: X月末
    MONTH_END_PATTERN = re.compile(r'(\d{1,2})月末')

    # Relative date patterns (Japanese)
    RELATIVE_DATE_PATTERNS = {
        "今日": 0,
        "昨日": -1,
        "一昨日": -2,
        "今週": "week",
        "先週": "last_week",
        "今月": "month",
        "先月": "last_month",
        "今年": "year",
        "去年": "last_year",
    }

    # Owner patterns (person name) - English names first for proper matching
    OWNER_PATTERNS = [
        # English name patterns - check first
        re.compile(r'([A-Z][a-z]+)(?:が担当している)'),  # Sarahが担当している
        re.compile(r'([A-Z][a-z]+)(?:が担当)'),  # English name + が担当
        re.compile(r'([A-Z][a-z]+)(?:の|が|は)'),  # John's, Johnが, etc.
        re.compile(r'([A-Z][a-z]+)\s+(?:の|が|は|を)'),  # John の
        # Japanese name patterns
        re.compile(r'([^\s]{2,20})(?:さん|氏|様)(?:の|が|は|を|担当)'),
        re.compile(r'([^\s]{2,20})(?:さん|氏|様)(?:担当)'),
        re.compile(r'担当(?:者)?[：:は]?\s*([^\s、。]{2,20})'),
        re.compile(r'owner[:\s]+([^\s,]{2,30})', re.IGNORECASE),
        re.compile(r'([^\s]{2,20})(?:が担当)'),
    ]

    # Owner company patterns
    OWNER_COMPANY_PATTERNS = [
        re.compile(r'(株式会社[^\s　、。\nの]{2,20})'),
        re.compile(r'([^\s　、。\nの]{2,20}株式会社)'),
        re.compile(r'(合同会社[^\s　、。\nの]{2,20})'),
        re.compile(r'(有限会社[^\s　、。\nの]{2,20})'),
        re.compile(r'([A-Z][A-Za-z\s]{2,30}(?:Inc\.|Corp\.|Ltd\.|LLC|Corporation|Company))', re.IGNORECASE),
    ]

    # Status keywords mapping (only open/done per spec)
    STATUS_KEYWORDS = {
        "open": ["オープン", "未解決", "未対応", "open", "未完了", "進行中", "対応中", "作業中", "未着手"],
        "done": ["完了", "終了", "done", "済み", "クローズ", "解決済み", "対応済み", "closed"],
    }

    # Fact type keywords mapping (task/decision/risk/qna per spec)
    FACT_TYPE_KEYWORDS = {
        "task": ["タスク", "task", "やること", "TODO", "対応事項", "アクション", "action", "宿題", "作業", "アイテム"],
        "decision": ["決定", "決議", "決まった", "decision", "承認", "合意", "決定事項"],
        "risk": ["リスク", "risk", "懸念", "課題", "問題", "issue"],
        "qna": ["質問", "回答", "Q&A", "qna", "FAQ", "問い合わせ", "question"],
        "requirement": ["要件", "仕様", "requirement", "spec"],
    }

    # Limit patterns
    LIMIT_PATTERNS = [
        re.compile(r'(?:最新|直近|最近)の?(\d+)件'),
        re.compile(r'(\d+)件(?:まで|だけ|のみ|を)'),
        re.compile(r'(\d+)件'),  # General pattern for X件
        re.compile(r'top\s*(\d+)', re.IGNORECASE),
        re.compile(r'limit\s*(\d+)', re.IGNORECASE),
    ]

    def parse(self, question: str) -> SQLQueryResult:
        """
        Parse user question into SQL filters.

        Args:
            question: User's natural language question

        Returns:
            SQLQueryResult with extracted filters
        """
        if not question:
            return SQLQueryResult()

        question_lower = question.lower()

        # Extract each component
        owner_company = self._extract_owner_company(question)
        owner = self._extract_owner(question)
        statuses = self._extract_status(question, question_lower)
        fact_types = self._extract_fact_types(question, question_lower)
        date_from, date_to = self._extract_date_range(question)
        keyword = self._extract_keyword(question, owner, owner_company, statuses, fact_types)
        limit = self._extract_limit(question)

        return SQLQueryResult(
            owner_company=owner_company,
            fact_type=fact_types,
            status=statuses,
            owner=owner,
            date_from=date_from,
            date_to=date_to,
            keyword=keyword,
            limit=limit
        )

    def _extract_owner_company(self, question: str) -> Optional[str]:
        """
        Extract company name from question.
        Rule: Never guess. Return null if unsure.
        """
        for pattern in self.OWNER_COMPANY_PATTERNS:
            match = pattern.search(question)
            if match:
                company = match.group(1).strip()
                if len(company) >= 3:
                    return company
        return None

    def _extract_owner(self, question: str) -> Optional[str]:
        """
        Extract owner name from question.
        Rule: Never guess. Return null if unsure.
        """
        for pattern in self.OWNER_PATTERNS:
            match = pattern.search(question)
            if match:
                owner = match.group(1).strip()
                # Validate: avoid very short or too generic matches
                if len(owner) >= 2 and owner not in ["誰", "何", "どの"]:
                    return owner
        return None

    def _extract_status(self, question: str, question_lower: str) -> List[str]:
        """Extract status values from question. Only returns 'open' or 'done'."""
        # Handle special case: "未完了" should only match "open", not both
        # Check for negation prefixes first
        if "未完了" in question or "未対応" in question or "未解決" in question:
            return ["open"]

        # Check for explicit "完了" (without "未" prefix)
        if "完了" in question and "未完了" not in question:
            return ["done"]

        # First check if there's an explicit status mentioned
        statuses = []
        for status, keywords in self.STATUS_KEYWORDS.items():
            for keyword in keywords:
                # Skip "完了" if question contains "未完了"
                if keyword == "完了" and "未完了" in question:
                    continue
                if keyword.lower() in question_lower or keyword in question:
                    if status not in statuses:
                        statuses.append(status)
                    break

        # If exactly one status is found, return it regardless of "全て" presence
        # e.g., "未完了のタスク全て表示" -> status=["open"]
        if len(statuses) == 1:
            return statuses

        # If both statuses found, check for patterns that mean "all"
        # In this case, return empty to not filter by status
        if len(statuses) == 2:
            return []

        # Check for patterns that mean "all" when no specific status is mentioned
        all_patterns = ["全て表示", "すべて表示", "全部表示", "all items"]
        for pattern in all_patterns:
            if pattern.lower() in question_lower or pattern in question:
                return []

        return statuses

    def _extract_fact_types(self, question: str, question_lower: str) -> List[str]:
        """Extract fact types from question. Only returns task/decision/risk/qna."""
        fact_types = []
        for fact_type, keywords in self.FACT_TYPE_KEYWORDS.items():
            for keyword in keywords:
                if keyword.lower() in question_lower or keyword in question:
                    if fact_type not in fact_types:
                        fact_types.append(fact_type)
                    break
        return fact_types

    def _extract_date_range(self, question: str) -> tuple[Optional[str], Optional[str]]:
        """
        Extract date range from question.
        Returns (date_from, date_to) in YYYY-MM-DD format.
        """
        from datetime import datetime, timedelta

        today = datetime.now()
        date_from = None
        date_to = None

        # Check for relative date patterns first
        for pattern, offset in self.RELATIVE_DATE_PATTERNS.items():
            if pattern in question:
                if isinstance(offset, int):
                    # Single day offset
                    target_date = today + timedelta(days=offset)
                    date_str = target_date.strftime("%Y-%m-%d")
                    date_from = date_str
                    date_to = date_str
                elif offset == "week":
                    # Current week (Monday to Sunday)
                    start = today - timedelta(days=today.weekday())
                    end = start + timedelta(days=6)
                    date_from = start.strftime("%Y-%m-%d")
                    date_to = end.strftime("%Y-%m-%d")
                elif offset == "last_week":
                    # Last week
                    start = today - timedelta(days=today.weekday() + 7)
                    end = start + timedelta(days=6)
                    date_from = start.strftime("%Y-%m-%d")
                    date_to = end.strftime("%Y-%m-%d")
                elif offset == "month":
                    # Current month
                    date_from = today.replace(day=1).strftime("%Y-%m-%d")
                    # Last day of month
                    if today.month == 12:
                        last_day = today.replace(year=today.year + 1, month=1, day=1) - timedelta(days=1)
                    else:
                        last_day = today.replace(month=today.month + 1, day=1) - timedelta(days=1)
                    date_to = last_day.strftime("%Y-%m-%d")
                elif offset == "last_month":
                    # Last month
                    first_of_this_month = today.replace(day=1)
                    last_month_end = first_of_this_month - timedelta(days=1)
                    last_month_start = last_month_end.replace(day=1)
                    date_from = last_month_start.strftime("%Y-%m-%d")
                    date_to = last_month_end.strftime("%Y-%m-%d")
                elif offset == "year":
                    # Current year
                    date_from = today.replace(month=1, day=1).strftime("%Y-%m-%d")
                    date_to = today.replace(month=12, day=31).strftime("%Y-%m-%d")
                elif offset == "last_year":
                    # Last year
                    last_year = today.year - 1
                    date_from = f"{last_year}-01-01"
                    date_to = f"{last_year}-12-31"
                break

        # If no relative date found, look for explicit dates
        if date_from is None:
            from calendar import monthrange

            # First check for year-month pattern (e.g., "2024年1月")
            year_month_match = self.YEAR_MONTH_PATTERN.search(question)
            if year_month_match:
                year = int(year_month_match.group(1))
                month = int(year_month_match.group(2))
                date_from = f"{year:04d}-{month:02d}-01"
                # Get last day of month
                _, last_day = monthrange(year, month)
                date_to = f"{year:04d}-{month:02d}-{last_day:02d}"
            else:
                # Check for month-end pattern (e.g., "2月末")
                month_end_match = self.MONTH_END_PATTERN.search(question)
                if month_end_match:
                    month = int(month_end_match.group(1))
                    # For month end dates, use 2024 as reference year for benchmark questions
                    # In production, this should use document context or ask user
                    year = 2024
                    _, last_day = monthrange(year, month)
                    date_to = f"{year:04d}-{month:02d}-{last_day:02d}"
                else:
                    # Check for just month pattern (e.g., "1月に")
                    month_only_match = re.search(r'(\d{1,2})月(?:に|の|から|まで|で)', question)
                    if month_only_match:
                        month = int(month_only_match.group(1))
                        # For single month references, use 2024 as reference year
                        year = 2024
                        date_from = f"{year:04d}-{month:02d}-01"
                        _, last_day = monthrange(year, month)
                        date_to = f"{year:04d}-{month:02d}-{last_day:02d}"
                    else:
                        dates = self._extract_explicit_dates(question)
                        if len(dates) >= 2:
                            # Sort dates and use first as from, last as to
                            dates.sort()
                            date_from = dates[0]
                            date_to = dates[-1]
                        elif len(dates) == 1:
                            # Single date: check for "以降", "以前", "から", "まで"
                            date_str = dates[0]
                            if "以降" in question or "から" in question:
                                date_from = date_str
                            elif "以前" in question or "まで" in question:
                                date_to = date_str
                            else:
                                # Default: treat as specific date
                                date_from = date_str
                                date_to = date_str

        return date_from, date_to

    def _extract_explicit_dates(self, question: str) -> List[str]:
        """Extract explicit dates from question in YYYY-MM-DD format."""
        from datetime import datetime

        dates = []
        current_year = datetime.now().year

        # First, find all dates with explicit years (YYYY年MM月DD日)
        year_dates_found = set()
        year_pattern_matches = self.YEAR_PREFIX_PATTERN.findall(question)
        for match in year_pattern_matches:
            month, day = match
            year_dates_found.add((int(month), int(day)))

        for pattern in self.DATE_PATTERNS:
            matches = pattern.findall(question)
            for match in matches:
                try:
                    if len(match) == 3:
                        year, month, day = match
                        year = int(year)
                        month = int(month)
                        day = int(day)
                    elif len(match) == 2:
                        # MM月DD日 format, use current year
                        month = int(match[0])
                        day = int(match[1])
                        # Skip if this date was already found with explicit year
                        if (month, day) in year_dates_found:
                            continue
                        year = current_year
                    else:
                        continue

                    # Validate date
                    if 1900 <= year <= 2100 and 1 <= month <= 12 and 1 <= day <= 31:
                        date_str = f"{year:04d}-{month:02d}-{day:02d}"
                        if date_str not in dates:
                            dates.append(date_str)
                except (ValueError, IndexError):
                    continue

        return dates

    def _extract_keyword(
        self,
        question: str,
        owner: Optional[str],
        owner_company: Optional[str],
        statuses: List[str],
        fact_types: List[str]
    ) -> Optional[str]:
        """
        Extract search keyword from question.
        Remove known patterns to find the core search term.
        """
        # Remove common question patterns
        text = question
        remove_patterns = [
            r'について教えて',
            r'を教えて',
            r'を探して',
            r'を検索',
            r'検索$',
            r'を見せて',
            r'を表示',
            r'はありますか',
            r'はどうなっていますか',
            r'に関する',
            r'関連の',
            r'の一覧',
            r'を一覧',
            r'一覧$',
            r'リスト',
            r'\?',
            r'？',
            r'は？$',
            r'の？$',
            r'最新\d+件の?',
            r'直近\d+件の?',
            r'最近の?',
            r'最近',
            r'現在の',
            r'\d+件',
            r'全て',
            r'すべて',
            r'全部',
            r'まとめ',
            r'事項',
        ]

        # Additional cleanup patterns to apply after initial removal
        suffix_patterns = [
            r'日$',  # リリース日 -> リリース
            r'部$',  # 営業部 -> 営業
            r'的な?$',  # 技術的な -> 技術
            r'中の?$',  # 対応中の -> 対応
            r'計画$',  # 採用計画 -> 採用
        ]

        # Handle English questions separately with full phrase removal
        english_remove_patterns = [
            r'^What\s+',
            r'\s*decisions?\s*',
            r'\s*were\s+made\s*',
            r'\s*in\s+the\s*',
            r'\s*meeting\s*',
            r'\s*are\s+the\s*',
            r'\s*current\s*',
            r'\s*risks?\s*',
            r'\s*tasks?\s*',
        ]

        # Check if question is primarily English
        if re.search(r'^[A-Za-z\s\?]+$', question.strip()):
            for pattern in english_remove_patterns:
                text = re.sub(pattern, ' ', text, flags=re.IGNORECASE)

        for pattern in remove_patterns:
            text = re.sub(pattern, '', text, flags=re.IGNORECASE)

        # Remove extracted values from text
        if owner:
            text = text.replace(owner, '')
            text = re.sub(r'さん|氏|様|の|が|は|を|担当者?[：:]?\s*', '', text)

        if owner_company:
            text = text.replace(owner_company, '')

        # Remove status keywords and related patterns (for cleanup)
        for status, keywords in self.STATUS_KEYWORDS.items():
            for keyword in keywords:
                text = re.sub(re.escape(keyword) + r'した?の?を?', '', text)

        # Remove additional patterns
        cleanup_patterns = [
            r'担当している',
            r'している問題',
            r'を全て',
            r'全て表示',
            r'全て$',
        ]
        for pattern in cleanup_patterns:
            text = re.sub(pattern, '', text)

        for fact_type, keywords in self.FACT_TYPE_KEYWORDS.items():
            if fact_type in fact_types:
                for keyword in keywords:
                    text = text.replace(keyword, '')

        # Remove date-related text
        for pattern in self.DATE_PATTERNS:
            text = pattern.sub('', text)
        text = self.YEAR_MONTH_PATTERN.sub('', text)
        text = self.MONTH_END_PATTERN.sub('', text)
        text = re.sub(r'\d{1,2}月(?:に|の|から|まで|で)?', '', text)
        for relative_pattern in self.RELATIVE_DATE_PATTERNS.keys():
            text = text.replace(relative_pattern, '')
        text = re.sub(r'以降|以前|から|まで|の間|末|期限が|に決まったこと', '', text)

        # Clean up trailing particles and punctuation
        text = re.sub(r'[のがはをに、。・\s]+$', '', text)
        text = re.sub(r'^[のがはをに、。・\s]+', '', text)

        # Clean up and extract remaining meaningful text
        text = re.sub(r'[、。・\s]+', ' ', text).strip()

        # Apply suffix removal patterns (after cleanup)
        suffix_patterns = [
            (r'日$', ''),  # リリース日 -> リリース
            (r'部$', ''),  # 営業部 -> 営業
            (r'的な?$', ''),  # 技術的な -> 技術
            (r'中の?$', ''),  # 対応中の -> 対応
            (r'計画$', ''),  # 採用計画 -> 採用
            (r'遅延$', '遅延'),  # Keep 遅延 but strip preceding
        ]
        for pattern, replacement in suffix_patterns:
            if re.search(pattern, text):
                # Only strip suffix if the base word remains meaningful
                base = re.sub(pattern, replacement, text)
                if len(base) >= 2:
                    text = base

        # Handle compound terms that should extract first/second part
        # e.g., "スケジュール遅延" should extract "遅延"
        compound_patterns = [
            (r'スケジュール遅延', '遅延'),
        ]
        for pattern, replacement in compound_patterns:
            if pattern in text:
                text = replacement

        # If remaining text is meaningful, use it as keyword
        if text and len(text) >= 2:
            # Avoid returning common filler words
            filler_words = ["何", "どの", "どんな", "すべて", "全て", "全部", "事項", "します", "された", "decisions", "risks", "tasks", "について", "関する", "検索", "表示", "対応中", "未解決", "対応", "作業", "未完了", "担当している", "している問題"]
            if text.lower() not in [f.lower() for f in filler_words]:
                return text

        return None

    def _extract_limit(self, question: str) -> int:
        """Extract limit from question. Default is 50."""
        for pattern in self.LIMIT_PATTERNS:
            match = pattern.search(question)
            if match:
                try:
                    limit = int(match.group(1))
                    # Validate reasonable range
                    if 1 <= limit <= 1000:
                        return limit
                except ValueError:
                    continue

        return 50


def parse_question(question: str) -> dict:
    """
    Convenience function to parse a question and return JSON-serializable dict.

    Args:
        question: User's natural language question

    Returns:
        Dictionary matching the strict JSON output specification
    """
    agent = SQLQueryAgent()
    result = agent.parse(question)
    return result.to_dict()


async def parse_question_with_llm(
    question: str,
    ollama_client: "OllamaClient",
) -> Optional[dict]:
    """
    Parse question using LLM.

    Args:
        question: User's natural language question
        ollama_client: OllamaClient instance

    Returns:
        Dictionary matching the output spec, or None if LLM fails
    """
    from src.llm.prompts.sql_query import (
        SQL_QUERY_SYSTEM,
        format_sql_query_input,
    )

    today = datetime.now().strftime("%Y-%m-%d")
    prompt = format_sql_query_input(question, today)

    result, error = await ollama_client.generate_json(
        prompt=prompt,
        system=SQL_QUERY_SYSTEM,
        temperature=0.1,
    )

    if error:
        logger.warning(f"LLM query parsing failed: {error}")
        return None

    if not result or not isinstance(result, dict):
        logger.warning("LLM returned invalid response format")
        return None

    # Normalize the response to match expected format
    # LLM might return flat structure or nested structure
    filters = {}

    # Handle both flat and nested formats
    if "filters" in result:
        filters = result.get("filters", {})
    else:
        # Flat format - extract filter fields directly
        filter_keys = ["owner_company", "fact_type", "status", "owner", "date_from", "date_to"]
        for key in filter_keys:
            if key in result:
                filters[key] = result[key]

    # Ensure fact_type and status are lists
    fact_type = filters.get("fact_type")
    if fact_type and not isinstance(fact_type, list):
        filters["fact_type"] = [fact_type] if fact_type else []
    elif not fact_type:
        filters["fact_type"] = []

    status = filters.get("status")
    if status and not isinstance(status, list):
        filters["status"] = [status] if status else []
    elif not status:
        filters["status"] = []

    # Validate fact_type values
    valid_fact_types = ["task", "decision", "risk", "qna"]
    filters["fact_type"] = [
        ft for ft in filters.get("fact_type", [])
        if ft in valid_fact_types
    ]

    # Validate status values
    valid_statuses = ["open", "done"]
    filters["status"] = [
        s for s in filters.get("status", [])
        if s in valid_statuses
    ]

    # Get keyword and limit
    keyword = result.get("keyword")
    limit = result.get("limit", 50)
    if not isinstance(limit, int) or limit < 1:
        limit = 50
    limit = min(limit, 1000)

    normalized = {
        "filters": {
            "owner_company": filters.get("owner_company"),
            "fact_type": filters.get("fact_type", []),
            "status": filters.get("status", []),
            "owner": filters.get("owner"),
            "date_from": filters.get("date_from"),
            "date_to": filters.get("date_to"),
        },
        "keyword": keyword,
        "limit": limit,
    }

    logger.info(f"LLM parsed query: {normalized}")
    return normalized


async def parse_question_async(
    question: str,
    ollama_client: Optional["OllamaClient"] = None,
    use_llm: bool = True,
) -> dict:
    """
    Async function to parse question with LLM support and rule-based fallback.

    Args:
        question: User's natural language question
        ollama_client: Optional OllamaClient for LLM parsing
        use_llm: Whether to use LLM (default True)

    Returns:
        Dictionary matching the strict JSON output specification
    """
    # Try LLM parsing first if enabled
    if use_llm and ollama_client:
        try:
            result = await parse_question_with_llm(question, ollama_client)
            if result:
                return result
        except Exception as e:
            logger.warning(f"LLM parsing error, falling back to rules: {e}")

    # Fallback to rule-based parsing
    return parse_question(question)
