# Agent: 情報抽出エージェント (Step 3)

## 目的

チャンクから業務で使える「事実（facts）」を抽出する。

## ファイル

- 実装: `services/agents/fact_extractor.py`
- プロンプト: `services/llm/prompts/fact_extractor.py`
- テスト: `tests/test_fact_extractor.py`

---

## 入力

```json
{
  "doc_type": "minutes",
  "chunks": [
    {
      "text": "チャンクのテキスト",
      "page": 1,
      "index": 0
    }
  ]
}
```

---

## 出力（JSON厳守）

```json
{
  "facts": [
    {
      "fact_type": "task|decision|risk|qna|requirement|summary",
      "title": "string|null",
      "body": "string",
      "owner": "string|null",
      "due_date": "YYYY-MM-DD|null",
      "status": "open|done|unknown|null",
      "evidence": {
        "quotes": [
          {
            "quote": "原文",
            "page": 1,
            "chunk_index": 0
          }
        ]
      },
      "confidence": 0.0
    }
  ]
}
```

---

## ファクトタイプと検出パターン

### task（タスク・アクションアイテム）

**日本語パターン**:
```regex
(TODO|タスク|対応|作業|実施|依頼)[：:]\s*(.+)
(.+)(を|が)(対応|実施|作業|完了)(する|します|してください|予定)
【(TODO|タスク|宿題|アクション)】\s*(.+)
```

**英語パターン**:
```regex
(TODO|TASK|ACTION)[：:]\s*(.+)
(will|should|must|need to)\s+(.+)
```

### decision（決定事項）

**日本語パターン**:
```regex
(決定|合意|決議)[：:事項]*\s*(.+)
(.+)(に|と)(決定|決まり|合意)(しました|した|する)
【(決定|決議|合意)】\s*(.+)
```

**英語パターン**:
```regex
(DECISION|AGREED|RESOLVED)[：:]\s*(.+)
(decided|agreed|resolved)\s+(to|that)\s+(.+)
```

### risk（リスク・懸念）

**日本語パターン**:
```regex
(リスク|懸念|課題|問題)[：:]\s*(.+)
【(リスク|懸念|課題)】\s*(.+)
```

**英語パターン**:
```regex
(RISK|CONCERN|ISSUE|PROBLEM)[：:]\s*(.+)
```

### qna（質問と回答）

**日本語パターン**:
```regex
(Q|質問)[：:]\s*(.+)
(A|回答)[：:]\s*(.+)
```

**英語パターン**:
```regex
(Q|Question)[：:]\s*(.+)
(A|Answer)[：:]\s*(.+)
```

### requirement（要件・仕様）

**日本語パターン**:
```regex
(要件|要求|仕様)[：:]\s*(.+)
【(要件|要求|仕様)】\s*(.+)
```

**英語パターン**:
```regex
(REQUIREMENT|SPEC)[：:]\s*(.+)
(shall|must)\s+(.+)
```

---

## 担当者（owner）抽出パターン

```regex
# 日本語
(担当|責任者)[：:]\s*([^\s、。,]+)
([^\s、。,]+)(さん|氏|様)が(担当|対応)
([^\s]{2,20})が担当

# 英語
(assigned to|owner)[:\s]+([^\s,]+)
```

---

## ステータス（status）抽出パターン

### open（未完了）
```regex
# 日本語
(未完了|未対応|対応中|進行中|オープン|未着手)

# 英語
(pending|in progress|open|ongoing)
```

### done（完了）
```regex
# 日本語
(完了|対応済|クローズ|終了|解決)

# 英語
(completed|done|closed|resolved|finished)
```

**注意**: 「未完了」のような否定形を先にチェック（「完了」を含むため）

---

## 日付（due_date）抽出

```regex
\b(\d{4})[-/年](\d{1,2})[-/月](\d{1,2})日?\b
```

**バリデーション**: 1900-2100年、1-12月、1-31日

---

## 信頼度（confidence）計算

```
base = 0.7

調整:
+ 0.1: body が 20文字以上
+ 0.1: quote が body を含む
+ 0.05: 有効な fact_type

max = 1.0
```

---

## LLM統合

### LLM使用時の処理
1. `format_fact_extractor_input()` でプロンプト生成
2. `ollama_client.generate_json()` で抽出
3. 結果のバリデーション・正規化:
   - `fact_type` が有効な値か確認
   - `evidence` フォーマットの統一
   - `confidence` を 0.0-1.0 にクランプ

### フォールバック
- LLM失敗時はルールベース抽出
- 正規表現パターンマッチで抽出

---

## API エンドポイント

```
POST /agents/extract
Content-Type: application/json

{
  "doc_type": "minutes",
  "chunks": [...]
}
```

---

## テストケース

### 正常系
- 日本語議事録 → task, decision, risk, qna を抽出
- 英語ミーティング → task, decision を抽出
- 要件定義書 → requirement を抽出

### evidence 必須テスト
- 全ての fact に `evidence.quotes` が存在
- `quote` は空でない
- `chunk_index` は整数

### エッジケース
- 空チャンク → `facts: []`
- パターンなし → `facts: []` または summary
- owner なし → `owner: null`
- 日付なし → `due_date: null`

---

## ルール（厳守）

1. **evidence は必須**: すべてのファクトに引用が必要
2. **推測禁止**: 不明な owner/due_date は `null`
3. **body は必須**: 空の body は不可
4. **confidence は 0〜1**: 小数点2桁

---

## 改善ポイント

1. **関係性抽出**: ファクト間の関連（「AはBに関連」）
2. **優先度抽出**: タスクの優先度（高・中・低）
3. **複数担当者**: 「田中、佐藤が担当」の分割
4. **期間指定**: 「3月15日〜20日」の範囲抽出
5. **否定検出**: 「決定しなかった」の区別
6. **文脈理解強化**: LLMによるより深い意味理解
