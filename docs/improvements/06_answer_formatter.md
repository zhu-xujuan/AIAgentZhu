# Agent: 回答整形エージェント (Step 6)

## 目的

抽出されたファクトを人間が読みやすい回答形式に整形する。

## ファイル

- 実装: `services/agents/answer_formatter.py`
- プロンプト: `services/llm/prompts/answer_formatter.py`
- テスト: `tests/test_answer_formatter.py`

---

## 入力

```json
{
  "facts": [
    {
      "content": "タスクの内容",
      "owner": "田中",
      "due_date": "2024-03-20",
      "evidence": "原文からの引用",
      "confidence": 0.85
    }
  ],
  "query": "田中さんのタスクを教えて"
}
```

**注意**: 入力の `content` は FactExtractor の `body` に対応

---

## 出力（JSON厳守）

```json
{
  "text": "## 検索結果: 3件\n\n- タスクの内容\n  - 担当: 田中\n  ...",
  "has_low_confidence": false
}
```

---

## 出力フォーマット（ルールベース）

### サマリー付き

```markdown
## 検索結果: {n}件 (うち要確認: {m}件)

- {content}
  - 担当: {owner|未設定}
  - 期日: {due_date|未設定}
  - 出典: {evidence|未設定}
  - **要確認** (信頼度: {confidence}%)  ← 低信頼度の場合のみ
```

### ファクトなしの場合

```
該当する情報が見つかりませんでした。
```

---

## 信頼度閾値

```python
LOW_CONFIDENCE_THRESHOLD = 0.6
```

- 0.6未満のファクトは「**要確認**」マークを付与
- `has_low_confidence` が `true` になる

---

## LLM統合

### LLM使用時の処理
1. `format_answer_formatter_input()` でプロンプト生成
2. `ollama_client.generate()` で自然言語回答を生成
3. `format_json=False`（テキスト出力）
4. `temperature=0.3`（やや創造的）

### LLM出力例

```
田中さんのタスクについて、3件見つかりました。

1. **テスト計画書の作成**
   - 期限: 3月20日まで
   - 現在対応中です

2. **コードレビューの実施**
   - 期限: 未設定
   - 佐藤さんのPRをレビュー予定

3. **週次報告の提出** (要確認)
   - 期限: 毎週金曜
   - 信頼度が低いため確認が必要です
```

### フォールバック
- LLM失敗時はテンプレート整形
- マークダウン箇条書き形式

---

## API エンドポイント

```
POST /agents/format-answer
Content-Type: application/json

{
  "facts": [...],
  "query": "質問文"
}
```

---

## テストケース

### 正常系
- 複数ファクト → 箇条書きリスト
- 全て高信頼度 → `has_low_confidence: false`
- 低信頼度あり → 「要確認」マーク + `has_low_confidence: true`

### エッジケース
- ファクト0件 → 「該当する情報が見つかりませんでした。」
- owner/due_date なし → 「未設定」と表示
- evidence なし → 「未設定」と表示

---

## ルール（厳守）

1. **箇条書きで出力**: Markdown形式
2. **owner, due_date を含める**: 未設定でも表示
3. **evidence を必ず示す**: 出典の明示
4. **confidence が低い場合「要確認」と明記**: 0.6未満

---

## 出力フィールド仕様

| フィールド | 型 | 説明 |
|-----------|-----|------|
| text | string | フォーマット済みの回答テキスト |
| has_low_confidence | boolean | 低信頼度ファクトの有無 |

---

## 改善ポイント

1. **言語自動判定**: 日本語/英語の自動切り替え
2. **グルーピング**: ファクトタイプ別にグループ化
3. **優先度表示**: 重要度に応じた並び替え
4. **リンク生成**: 出典へのリンク追加
5. **要約生成**: 長いリストの自動要約
6. **対話形式**: 質問への直接回答 + 詳細リスト
