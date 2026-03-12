# Agent: 品質判定エージェント (Step 4)

## 目的

抽出結果が信頼できるかを判定し、人間によるレビューが必要かを判断する。

## ファイル

- 実装: `services/agents/quality_guardian.py`
- プロンプト: `services/llm/prompts/quality_guardian.py`
- テスト: `tests/test_quality_guardian.py`

---

## 入力

```json
{
  "facts": [
    {
      "fact_type": "task",
      "body": "...",
      "confidence": 0.8,
      ...
    }
  ],
  "parse_meta": {
    "ocr_used": false,
    "chunk_count": 5,
    "confidence": 0.85
  }
}
```

---

## 出力（JSON厳守）

```json
{
  "needs_review": true,
  "reasons": ["理由1", "理由2"]
}
```

### LLM使用時の拡張出力

```json
{
  "needs_review": true,
  "reasons": ["理由1", "理由2"],
  "overall_quality": "high|medium|low",
  "fact_issues": [
    {"fact_index": 0, "issue": "問題の説明"}
  ],
  "recommendations": ["改善提案1", "改善提案2"]
}
```

---

## 判定条件（ルールベース）

### 自動レビュー対象

| 条件 | 理由メッセージ |
|------|--------------|
| facts が 0件 | "No facts extracted" |
| parse_meta.confidence < 0.5 | "Low parsing confidence: {value}" |
| fact.confidence < 0.5 | "Low confidence in fact #{n}" |
| parse_meta.ocr_used = true | "OCR was used for text extraction" |

---

## 閾値設定

```python
LOW_CONFIDENCE_THRESHOLD = 0.5
```

---

## 判定ロジック

```
1. facts が null または空配列か確認
   → 要レビュー: "No facts extracted"

2. parse_meta.confidence をチェック
   → 0.5未満: 要レビュー

3. 各 fact の confidence をチェック
   → 0.5未満の fact がある: 要レビュー
   → 複数ある場合: "Low confidence in facts #1, #2 and 3 more"

4. OCR使用チェック
   → parse_meta.ocr_used = true
   → parse_meta.extraction_method に "ocr" を含む
   → parse_meta.parser_type に "ocr" を含む
```

---

## LLM統合

### LLM使用時の追加評価

1. **セマンティック評価**
   - ファクトの完全性
   - 矛盾の検出
   - 文脈との整合性

2. **ドキュメント種別との整合性**
   - 議事録なのにタスクがない
   - 契約書なのに決定事項がない

3. **拡張フィールド**
   - `overall_quality`: 総合品質評価
   - `fact_issues`: 個別ファクトの問題
   - `recommendations`: 改善提案

### フォールバック
- LLM失敗時はルールベース評価
- 拡張フィールドは含まれない

---

## API エンドポイント

```
POST /agents/quality-check
Content-Type: application/json

{
  "facts": [...],
  "parse_meta": {...}
}
```

---

## テストケース

### needs_review = true
- facts が空
- confidence < 0.5 の fact がある
- OCR使用

### needs_review = false
- facts が 1件以上
- 全 fact の confidence >= 0.5
- OCR未使用

### エッジケース
- facts = null
- parse_meta = null
- facts = []（空配列）

---

## ルール（厳守）

1. **needs_review は boolean**: true または false
2. **reasons は配列**: 空配列も可
3. **理由は具体的**: 何が問題かを明示

---

## 改善ポイント

1. **重複検出**: 同じ内容のファクトがないか
2. **矛盾検出**: 相反する決定事項がないか
3. **完全性チェック**: 必須フィールドの欠落
4. **スコアリング**: 総合品質スコアの算出
5. **自動修正提案**: 低品質ファクトの改善案
