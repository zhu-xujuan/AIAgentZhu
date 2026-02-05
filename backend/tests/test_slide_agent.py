import sys
from pathlib import Path


# Ensure `src` is importable when running pytest from repo root or backend/
BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))


from src.agents.slide_agent import normalize_slide_deck


def test_normalize_slide_deck_basic():
    raw = {
        "title": "Deck",
        "summary": "Summary",
        "slides": [
            {
                "title": "S1",
                "bullets": ["- A", "B  "],
                "diagram_mermaid": "flowchart TD\nA-->B",
                "speaker_notes": "Note",
                "citations": [
                    {"source_id": "1", "source_title": "Doc.pdf", "quote": "x" * 300}
                ],
            }
        ],
    }

    deck = normalize_slide_deck(raw)
    assert deck["title"] == "Deck"
    assert deck["summary"] == "Summary"
    assert deck["slides"][0]["title"] == "S1"
    assert deck["slides"][0]["bullets"] == ["A", "B"]
    assert deck["slides"][0]["diagram_mermaid"].startswith("flowchart")
    assert deck["slides"][0]["speaker_notes"] == "Note"
    assert deck["slides"][0]["citations"][0]["source_id"] == 1
    assert deck["slides"][0]["citations"][0]["source_title"] == "Doc.pdf"
    assert len(deck["slides"][0]["citations"][0]["quote"]) <= 120


def test_normalize_rejects_non_object():
    try:
        normalize_slide_deck(["not", "an", "object"])
        assert False, "Expected ValueError"
    except ValueError:
        assert True
