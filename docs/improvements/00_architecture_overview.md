# 全体アーキテクチャ（マルチエージェント構成）

本システムは、役割ごとに分離された複数のAIエージェントが連携して動作する構成です。

## 基本原則

- **PostgreSQL**：真実のデータ（Source of Truth）
- **Dify**：エージェントのオーケストレーション
- **ローカルファイル**：原本保存（`uploads/` ディレクトリ）
- **FastAPI**：エージェントエンドポイント提供
- **Ollama LLM**：エージェント処理の強化（ルールベースのフォールバック付き）

## 処理の流れ

```
ファイルアップロード
       │
       ▼
┌─────────────────────────────────────────────────────────┐
│ Step 1: ドキュメント分類                                   │
│         DocumentClassifier (LLM強化)                      │
│         → doc_type, language, doc_date, owner_company    │
└─────────────────────────────────────────────────────────┘
       │
       ▼
┌─────────────────────────────────────────────────────────┐
│ Step 2: チャンク分割                                       │
│         ChunkingAgent (ルールベース)                       │
│         → 800-1500文字のチャンクに分割                      │
└─────────────────────────────────────────────────────────┘
       │
       ▼
┌─────────────────────────────────────────────────────────┐
│ Step 3: 情報抽出（facts）                                  │
│         FactExtractor (LLM強化)                           │
│         → task, decision, risk, qna, requirement, summary │
└─────────────────────────────────────────────────────────┘
       │
       ▼
┌─────────────────────────────────────────────────────────┐
│ Step 4: 品質判定                                          │
│         QualityGuardian (LLM強化)                         │
│         → needs_review, reasons                          │
└─────────────────────────────────────────────────────────┘
       │
       ▼
    PostgreSQL保存
       │
       ▼
┌─────────────────────────────────────────────────────────┐
│ Step 5: SQL検索（質問時）                                  │
│         SQLQueryAgent (LLM強化)                           │
│         → 自然言語 → フィルター変換                         │
└─────────────────────────────────────────────────────────┘
       │
       ▼
┌─────────────────────────────────────────────────────────┐
│ Step 6: 回答整形                                          │
│         AnswerFormatter (LLM強化)                         │
│         → 人間が読みやすい形式に整形                        │
└─────────────────────────────────────────────────────────┘
```

---

## LLM統合アーキテクチャ

### コンポーネント構成

```
services/
├── agents/                    # エージェント実装
│   ├── document_classifier.py # Step 1
│   ├── chunking_agent.py      # Step 2
│   ├── fact_extractor.py      # Step 3
│   ├── quality_guardian.py    # Step 4
│   ├── sql_query_agent.py     # Step 5
│   └── answer_formatter.py    # Step 6
├── llm/
│   ├── ollama_client.py       # 非同期HTTPクライアント
│   ├── config.py              # 環境変数ベースの設定管理
│   └── prompts/               # エージェント別プロンプト
│       ├── document_classifier.py
│       ├── fact_extractor.py
│       ├── quality_guardian.py
│       ├── sql_query.py
│       └── answer_formatter.py
└── storage/
    └── local_storage.py       # ローカルファイルストレージ
```

### LLM対応エージェント一覧

| エージェント | LLM処理 | フォールバック | 温度設定 |
|-------------|--------|--------------|---------|
| DocumentClassifier | ドキュメント種別・言語・日付の推論 | キーワードマッチング | 0.1 |
| ChunkingAgent | なし（ルールベースのみ） | - | - |
| FactExtractor | 文脈を理解したファクト抽出 | 正規表現パターン | 0.1 |
| QualityGuardian | セマンティック品質評価 | 閾値ベース判定 | 0.1 |
| SQLQueryAgent | 自然言語→フィルター変換 | キーワード・日付パターン | 0.1 |
| AnswerFormatter | 自然な文章生成 | テンプレート整形 | 0.3 |

### フォールバック戦略

```
LLM呼び出し
    │
    ├─ OLLAMA_ENABLED=false → ルールベース
    │
    ├─ Ollama接続不可 → ルールベース
    │
    ├─ タイムアウト(60秒) → リトライ(最大2回) → ルールベース
    │
    └─ JSONパース失敗 → ルールベース
```

**重要**: フォールバック時もJSON仕様は厳守される

---

## 設定（環境変数）

```bash
# Ollama基本設定
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_MODEL=qwen2.5:7b
OLLAMA_TIMEOUT=60
OLLAMA_ENABLED=true
OLLAMA_MAX_RETRIES=2

# エージェント別ON/OFF
LLM_DOCUMENT_CLASSIFIER_ENABLED=true
LLM_FACT_EXTRACTOR_ENABLED=true
LLM_SQL_QUERY_ENABLED=true
LLM_ANSWER_FORMATTER_ENABLED=true
LLM_QUALITY_GUARDIAN_ENABLED=true

# エージェント別モデル・温度（オプション）
LLM_FACT_EXTRACTOR_MODEL=qwen2.5:7b
LLM_FACT_EXTRACTOR_TEMPERATURE=0.1
LLM_ANSWER_FORMATTER_TEMPERATURE=0.3
```

---

## API エンドポイント

### ヘルスチェック
```
GET /health
```

### ファイル管理
```
POST /upload              # ファイルアップロード
GET  /files/{file_id}     # メタデータ取得
```

### 個別エージェント（Dify HTTP Requestノード用）
```
POST /agents/classify         # Step 1: ドキュメント分類
POST /agents/chunk            # Step 2: チャンク分割
POST /agents/extract          # Step 3: 情報抽出
POST /agents/quality-check    # Step 4: 品質チェック
POST /agents/parse-query      # Step 5: SQLクエリ生成
POST /agents/format-answer    # Step 6: 回答整形
```

### パイプライン（統合エンドポイント）
```
POST /pipeline/ingest    # 取り込み（Step 1-4）
POST /pipeline/query     # 質問応答（Step 5-6）
```

---

## データベーススキーマ（PostgreSQL）

```sql
-- 文書テーブル
documents (
    id, file_id, file_name, doc_type, owner_company,
    doc_date, language, confidence, created_at
)

-- チャンクテーブル
chunks (
    id, document_id, chunk_index, page,
    section_title, text, char_len
)

-- ファクトテーブル
facts (
    id, chunk_id, fact_type, title, body,
    owner, due_date, status, confidence
)

-- エビデンステーブル
evidence (
    id, fact_id, quote, page, chunk_index
)

-- 品質チェック結果
quality_checks (
    id, document_id, needs_review, reasons, created_at
)
```

---

## エラーハンドリング

### LLMエラー時
1. `httpx.ConnectError` → リトライ → フォールバック
2. `httpx.TimeoutException` → リトライ → フォールバック
3. `json.JSONDecodeError` → フォールバック
4. その他例外 → フォールバック + ログ出力

### APIエラー時
- `400 Bad Request`: 入力バリデーション失敗
- `404 Not Found`: ファイル/リソースが見つからない
- `500 Internal Server Error`: 処理エラー

---

## 推奨モデル

| モデル | 特徴 | 推奨用途 |
|-------|------|---------|
| qwen2.5:7b | 日本語/英語両対応、バランス良い | デフォルト推奨 |
| qwen2.5:14b | より高精度 | 高精度が必要な場合 |
| llama3.2:7b | 英語のみなら高速 | 英語ドキュメント専用 |

---

## 今後の改善ポイント

1. **PostgreSQL統合**: `pipeline/query`でのDB検索実装
2. **ベクトル検索**: セマンティック検索の追加
3. **バッチ処理**: 大量ファイルの並列処理
4. **キャッシュ**: LLM結果のキャッシュ機構
5. **モニタリング**: 処理時間・成功率のメトリクス収集
