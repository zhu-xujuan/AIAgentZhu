"""
Prompt template for LLM-enhanced SQL query parsing.
"""

SQL_QUERY_SYSTEM = """You are a natural language to database query parser.
Your task is to extract search filters from user questions.
You must output valid JSON only. Be precise and handle both Japanese and English queries."""

SQL_QUERY_PROMPT = """
Parse the following user question into database search filters.

## Available Filters
- owner_company: Company name mentioned (e.g., "ACME Corp", "株式会社ABC")
- fact_type: Type of fact to search [task, decision, risk, qna, requirement, summary, null]
- status: Status filter [open, done, null]
- owner: Person/team name mentioned
- date_from: Start date in YYYY-MM-DD format
- date_to: End date in YYYY-MM-DD format
- keyword: Search keyword for text matching
- limit: Maximum results to return (default: 10)

## Date Handling
Today's date is: {today}

Relative date expressions:
- "今日" / "today" → {today}
- "昨日" / "yesterday" → calculate
- "先週" / "last week" → last 7 days
- "先月" / "last month" → previous calendar month
- "今月" / "this month" → current month start to today
- "今年" / "this year" → current year start to today
- "過去30日" / "last 30 days" → calculate

## Fact Type Detection
- "タスク", "TODO", "やること", "task" → task
- "決定", "決議", "合意", "decision" → decision
- "リスク", "懸念", "問題", "risk", "issue" → risk
- "質問", "Q&A", "question" → qna
- "要件", "仕様", "requirement" → requirement

## Status Detection
- "未完了", "オープン", "pending", "open", "未対応" → open
- "完了", "done", "済み", "closed" → done

## Examples

Question: "田中さんの未完了タスクを見せて"
→ {{"owner": "田中", "fact_type": "task", "status": "open", "limit": 10}}

Question: "先月のABC社に関する決定事項"
→ {{"owner_company": "ABC", "fact_type": "decision", "date_from": "2024-01-01", "date_to": "2024-01-31", "limit": 10}}

Question: "リスクについて検索"
→ {{"fact_type": "risk", "limit": 10}}

## User Question
{question}

## Response
Return only the JSON object with applicable filters:
"""


def format_sql_query_input(question: str, today: str) -> str:
    """
    Format input for the SQL query prompt.

    Args:
        question: User's natural language question
        today: Today's date in YYYY-MM-DD format

    Returns:
        Formatted prompt string.
    """
    return SQL_QUERY_PROMPT.format(
        question=question,
        today=today,
    )
