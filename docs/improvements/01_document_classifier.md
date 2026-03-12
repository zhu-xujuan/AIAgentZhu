# Agent: ドキュメント分類エージェント (Step 1)

## 目的

入力された文書の種類を判定し、メタデータ（会社名、日付、言語）を抽出する。

## ファイル

- 実装: `services/agents/document_classifier.py`
- プロンプト: `services/llm/prompts/document_classifier.py`
- テスト: `tests/test_document_classifier.py`

---

## 入力

```json
{
  "file_name": "meeting_notes.txt",
  "file_type": "text/plain",
  "raw_text": "先頭3000文字程度のテキスト"
}
```

---

## 出力（JSON厳守）

```json
{
  "doc_type": "minutes|contract|manual|invoice|report|csv|other|unknown",
  "owner_company": "string|null",
  "doc_date": "YYYY-MM-DD|null",
  "language": "ja|en|null",
  "confidence": 0.0,
  "rationale": "判定理由"
}
```

---

## ドキュメント種別と検出キーワード

### 日本語キーワード

| doc_type | キーワード |
|----------|-----------|
| minutes | 議事録, 出席者, 決定事項, 議題, ミーティング |
| contract | 契約書, 甲, 乙, 契約条項, 締結, 合意, 覚書 |
| manual | マニュアル, 手順書, 操作方法, ガイド, 取扱説明書, 手順, 研修, トレーニング |
| invoice | 請求書, 請求金額, 振込先, お支払い, 税込, 御請求 |
| report | 報告書, レポート, 実績, 四半期, 月次報告, 経費報告, 企画書, 提案書 |
| csv | ファイル拡張子またはMIMEタイプで判定 |

### 英語キーワード

| doc_type | キーワード |
|----------|-----------|
| minutes | minutes, meeting minutes, attendees, agenda, resolution |
| contract | contract, agreement, party, whereas, terms and conditions, hereby |
| manual | manual, guide, instructions, how to, procedure, step by step, training, specification, tutorial |
| invoice | invoice, bill to, amount due, remittance, payment due |
| report | report, quarterly, summary, analysis, expense report, proposal, financial review |

---

## 言語検出ロジック

```
日本語文字（ひらがな・カタカナ・漢字）の割合:
- 30%以上 → "ja"
- 70%以上がASCII → "en"
- それ以外 → null
```

---

## 日付抽出パターン

```regex
# サポートする形式
YYYY-MM-DD     例: 2024-03-15
YYYY/MM/DD     例: 2024/03/15
YYYY年MM月DD日  例: 2024年3月15日
```

**ルール**: 1900-2100年、1-12月、1-31日の範囲でバリデーション

---

## 会社名抽出パターン

### 日本語
```regex
株式会社[^\s　、。\n]{2,20}
[^\s　、。\n]{2,20}株式会社
合同会社[^\s　、。\n]{2,20}
有限会社[^\s　、。\n]{2,20}
```

### 英語
```regex
[A-Z][A-Za-z\s]{2,30}(?:Inc\.|Corp\.|Ltd\.|LLC|Corporation|Company)
```

---

## 信頼度（confidence）計算

```
base = type_confidence（キーワードマッチ数に基づく）

調整:
- 3件以上マッチ → 0.85
- 2件マッチ → 0.70
- 1件マッチ → 0.50
- 言語不明 → ×0.9
- テキスト100文字未満 → ×0.7
- doc_type = "unknown" → max 0.2
```

---

## LLM統合

### LLM使用時
1. `format_document_classifier_input()` でプロンプト生成
2. `ollama_client.generate_json()` で分類
3. 結果をバリデーション・正規化

### フォールバック条件
- LLM無効
- Ollama接続エラー
- タイムアウト
- JSONパースエラー

→ すべてルールベース分類に切り替え

---

## API エンドポイント

```
POST /agents/classify
Content-Type: application/json

{
  "file_name": "test.pdf",
  "file_type": "application/pdf",
  "raw_text": "..."
}
```

---

## テストケース

### 正常系
- 日本語議事録 → `doc_type: "minutes"`, `language: "ja"`
- 英語契約書 → `doc_type: "contract"`, `language: "en"`
- CSVファイル → `doc_type: "csv"`（ファイルタイプで判定）
- 日本語請求書 → `doc_type: "invoice"`, `language: "ja"`

### エッジケース
- 空テキスト → `doc_type: "unknown"`, `confidence: 低`
- キーワードなし → `doc_type: "other"`
- 日付なし → `doc_date: null`
- 会社名なし → `owner_company: null`

---

## ルール（厳守）

1. **推測禁止**: 不明な場合は `null` を返す
2. **日付の推測禁止**: 明示的なパターンマッチのみ
3. **confidence は 0〜1**: 小数点2桁
4. **rationale は必須**: 100文字以内の説明

---

## 改善ポイント

1. **和暦対応**: 令和・平成などの年号サポート
2. **複数会社検出**: 契約書での甲乙両社の抽出
3. **信頼度向上**: より多くのキーワードパターン追加
4. **ファイルメタデータ活用**: PDFのメタデータからの情報抽出
