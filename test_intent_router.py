#!/usr/bin/env python
"""Test Intent Router with Japanese queries"""

import requests
import json

API_URL = "http://127.0.0.1:8000/pipeline/query"

test_cases = [
    # (query, expected_intent, description)
    ("どんなファイルがアップロードされていますか？", "list_files", "日本語ファイル一覧"),
    ("全体的にどんなファイルが読み込まれているか確認して", "list_files", "日本語ファイル一覧2"),
    ("登録されている文書を教えて", "list_files", "日本語ファイル一覧3"),
    ("ファイルは何件ありますか？", "file_stats", "日本語統計"),
    ("何個のドキュメントが保存されていますか？", "file_stats", "日本語統計2"),
    ("list all uploaded files", "list_files", "英語ファイル一覧"),
    ("how many documents are there?", "file_stats", "英語統計"),
    ("契約の内容を教えて", "general_qa", "日本語RAG検索"),
    ("what is in the manual?", "general_qa", "英語RAG検索"),
]

print("=" * 60)
print("Intent Router Test")
print("=" * 60)

passed = 0
failed = 0

for query, expected_intent, description in test_cases:
    try:
        response = requests.post(
            API_URL,
            json={"question": query},
            headers={"Content-Type": "application/json; charset=utf-8"},
            timeout=60
        )
        data = response.json()

        actual_intent = data.get("intent")
        search_mode = data.get("search_mode")
        has_answer = data.get("has_answer")

        # Check if intent matches (allow general_qa to match search_content too)
        intent_match = actual_intent == expected_intent
        if expected_intent == "general_qa" and actual_intent in ["general_qa", "search_content"]:
            intent_match = True

        status = "PASS" if intent_match else "FAIL"
        if intent_match:
            passed += 1
        else:
            failed += 1

        print(f"\n[{status}] {description}")
        print(f"  Query: {query}")
        print(f"  Expected: {expected_intent}, Got: {actual_intent}")
        print(f"  Search Mode: {search_mode}")
        if not intent_match:
            print(f"  Answer preview: {data.get('answer', '')[:100]}...")

    except Exception as e:
        failed += 1
        print(f"\n[ERROR] {description}")
        print(f"  Query: {query}")
        print(f"  Error: {e}")

print("\n" + "=" * 60)
print(f"Results: {passed} passed, {failed} failed")
print("=" * 60)
