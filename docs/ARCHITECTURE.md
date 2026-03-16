# AIAgent 技術ドキュメント

## 概要

AIAgentは、文書を取り込み、内容を理解し、自然言語で質問に回答するRAG（Retrieval-Augmented Generation）システムです。

## アーキテクチャ全体像

```
┌─────────────────────────────────────────────────────────────────────┐
│                         AIAgent System                               │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│   ┌─────────────────────────────────────────────────────────────┐   │
│   │                  AI エンジン (設定可能)                       │   │
│   │  ┌─────────────────────┐    ┌─────────────────────┐         │   │
│   │  │  Embedding Model    │    │    LLM Model        │         │   │
│   │  │  (エンベディング生成) │    │   (テキスト生成)     │         │   │
│   │  │  テキスト→ベクトル    │    │   質問→回答         │         │   │
│   │  └─────────────────────┘    └─────────────────────┘         │   │
│   └─────────────────────────────────────────────────────────────┘   │
│          │ ベクトル生成                    ↑ 類似チャンク            │
│          ↓                                 │                        │
│   ┌─────────────────────────────────────────────────────────────┐   │
│   │              PostgreSQL (データストレージ)                   │   │
│   │  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐  │   │
│   │  │  documents  │  │   chunks    │  │ pgvector/全文検索   │  │   │
│   │  │  (メタ情報)  │  │ (テキスト)  │  │   (類似検索)        │  │   │
│   │  └─────────────┘  └─────────────┘  └─────────────────────┘  │   │
│   └─────────────────────────────────────────────────────────────┘   │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

### 重要: 各コンポーネントの役割

| コンポーネント | 役割 | できること | できないこと |
|--------------|------|----------|-------------|
| **AI Engine** | AIエンジン | ベクトル生成、テキスト生成、質問応答 | データ永続化 |
| **PostgreSQL** | データストレージ | ベクトル保存、類似検索、全文検索 | ベクトル生成、AI推論 |
| **FastAPI** | APIサーバー | リクエスト処理、パイプライン制御 | AI処理 |

**PostgreSQLはベクトルの「保存」と「検索」のみを担当します。**
すべてのAI処理（ベクトル生成、回答生成）は**AI Engine**が行います。

---

## ディレクトリ構造

```
AIAgent/
├── backend/                      # バックエンドソースコード
│   ├── src/                      # メインソースコード
│   │   ├── main.py               # APIエントリーポイント (FastAPI)
│   │   ├── agents/               # 各種エージェント
│   │   │   ├── document_classifier.py  # 文書分類
│   │   │   ├── chunking_agent.py       # チャンク分割
│   │   │   ├── fact_extractor.py       # ファクト抽出
│   │   │   ├── quality_guardian.py     # 品質チェック
│   │   │   ├── sql_query_agent.py      # SQLクエリ生成
│   │   │   ├── answer_formatter.py     # 回答フォーマット
│   │   │   ├── qa_agent.py             # 質問応答
│   │   │   └── intent_router.py        # 質問意図ルーティング
│   │   ├── llm/                  # LLM関連
│   │   │   ├── ai_client.py      # AIクライアント (マルチプロバイダー対応)
│   │   │   ├── config.py         # 設定管理
│   │   │   └── prompts/          # プロンプトテンプレート
│   │   └── storage/              # ストレージ関連
│   │       ├── database.py       # PostgreSQL操作
│   │       ├── local_storage.py  # ファイルストレージ
│   │       └── pdf_parser.py     # PDF解析
│   ├── tests/                    # テストコード
│   │   └── run_test.py           # テスト実行スクリプト
│   └── .env.example              # 環境変数テンプレート
├── frontend/                     # フロントエンド (Next.js)
├── config/                       # 設定ファイル
│   ├── database/
│   │   └── init.sql              # DB初期化SQL
│   └── dify/                     # Dify連携設定
│       ├── prompts/
│       └── workflows/
├── scripts/                      # ユーティリティスクリプト
│   └── import_to_dify.py
├── docs/                         # ドキュメント
│   ├── ARCHITECTURE.md           # このファイル
│   ├── improvements/             # 改善提案ドキュメント
│   └── implement/                # 実装ドキュメント
├── data/                         # データディレクトリ
│   └── uploads/                  # アップロードファイル
└── requirements.txt              # Python依存関係
```

### 処理フロー

```
1. src/main.py              # FastAPI サーバー起動
       │
       ├─→ /pipeline/ingest    # ドキュメント取り込み
       │      │
       │      ├─→ src/storage/local_storage.py    # ファイル保存
       │      ├─→ src/agents/document_classifier.py  # 文書分類
       │      ├─→ src/agents/chunking_agent.py       # チャンク分割
       │      ├─→ src/llm/ai_client.py              # エンベディング生成
       │      └─→ src/storage/database.py           # DB保存
       │
       └─→ /pipeline/query     # 質問応答
              │
              ├─→ src/llm/ai_client.py     # 質問のエンベディング生成
              ├─→ src/storage/database.py   # 類似チャンク検索
              └─→ src/agents/qa_agent.py    # 回答生成
```

---

## 技術スタック

### AIエンジン（マルチプロバイダー対応）

環境変数で切り替え可能なAIプロバイダーをサポート。

| プロバイダー | 対応モデル例 | 特徴 |
|-------------|-------------|------|
| **Ollama** | qwen2.5:7b, llama3:8b, mistral:7b | ローカル実行、無料 |
| **OpenAI** | gpt-4o, gpt-4o-mini, gpt-3.5-turbo | 高精度、API課金 |
| **Anthropic** | claude-3-5-sonnet, claude-3-haiku | 高品質、API課金 |
| **Azure** | gpt-4o (Azure版) | エンタープライズ向け |

### データストレージ（PostgreSQL）

データの永続化と検索を担当。**AI処理は行いません**。

| 機能 | 説明 |
|------|------|
| **ベクトル保存** | AIが生成したベクトルを保存 |
| **pgvector** | ベクトル間のコサイン類似度を計算して検索（オプション） |
| **全文検索** | キーワードマッチングで検索（pgvector未対応時のフォールバック） |

### バックエンド（FastAPI）

| 技術 | バージョン | 用途 |
|------|-----------|------|
| Python | 3.11+ | メイン言語 |
| FastAPI | 0.100+ | REST API フレームワーク |
| Uvicorn | - | ASGI サーバー |
| httpx | - | AI API クライアント |
| psycopg2 | - | PostgreSQL クライアント |

---

## システムアーキテクチャ

### 1. ドキュメント取り込みパイプライン

```
ファイルアップロード
       │
       v
┌──────────────────┐
│ Document         │  ファイル名・内容から文書種別を判定
│ Classifier       │  (契約書、マニュアル、請求書など)
└──────────────────┘
       │
       v
┌──────────────────┐
│ Chunking Agent   │  文書をセクション単位で分割
│                  │  (最大1000文字/チャンク)
└──────────────────┘
       │
       v
┌──────────────────┐
│ Embedding        │  各チャンクをベクトル化
│ Service          │  (AIエンジンでベクトル生成)
└──────────────────┘
       │
       v
┌──────────────────┐
│ PostgreSQL       │  ドキュメント・チャンク・
│ Database         │  エンベディングを永続化
└──────────────────┘
```

### 2. 質問応答パイプライン

```
ユーザーの質問
       │
       v
┌──────────────────┐
│ Embedding        │  質問文をベクトル化
│ Service          │
└──────────────────┘
       │
       v
┌──────────────────┐
│ Search Service   │  類似チャンクを検索
│ (Vector/FTS)     │  - pgvector: コサイン類似度
│                  │  - FTS: キーワードマッチング
└──────────────────┘
       │
       v
┌──────────────────┐
│ QA Agent         │  検索結果 + LLMで回答生成
│ (AI Engine)      │
└──────────────────┘
       │
       v
回答 + ソース情報
```

---

## API エンドポイント

### ヘルスチェック・デバッグ

| メソッド | エンドポイント | 説明 |
|---------|---------------|------|
| GET | `/health` | システムヘルスチェック |
| GET | `/debug/database` | DB接続デバッグ |
| GET | `/debug/storage` | ストレージデバッグ |

```
GET /health
```

レスポンス例:
```json
{
  "status": "healthy",
  "llm": {
    "enabled": true,
    "available": true,
    "provider": "ollama",
    "model": "qwen2.5:7b"
  },
  "database": {
    "available": true,
    "stats": {
      "documents": 6,
      "chunks": 6,
      "chunks_with_embeddings": 6
    }
  },
  "qa_ready": true
}
```

### ファイル管理

| メソッド | エンドポイント | 説明 |
|---------|---------------|------|
| POST | `/upload` | ファイルアップロード（DBへの取り込みなし） |
| GET | `/files/{file_id}` | ファイルメタデータ取得 |
| DELETE | `/files/{file_id}` | ファイル削除 |

### ドキュメント管理

| メソッド | エンドポイント | 説明 |
|---------|---------------|------|
| GET | `/documents` | ドキュメント一覧取得 |
| GET | `/documents/{document_id}` | ドキュメント詳細取得 |
| DELETE | `/documents/{document_id}` | ドキュメント削除 |

### ドキュメント取り込みパイプライン

```
POST /pipeline/ingest
Content-Type: multipart/form-data

file: <アップロードファイル>
```

レスポンス例:
```json
{
  "file_id": "20260129_xxx_sample.txt",
  "document_id": 1,
  "classification": {
    "doc_type": "contract",
    "language": "ja",
    "confidence": 0.85
  },
  "chunks_count": 1,
  "embeddings_count": 1,
  "stored_in_db": true
}
```

### 質問応答パイプライン

```
POST /pipeline/query
Content-Type: application/json

{
  "question": "契約の委託料はいくらですか？"
}
```

レスポンス例:
```json
{
  "question": "契約の委託料はいくらですか？",
  "answer": "契約の委託料は基本料金が月額150万円（税別）...",
  "sources": [
    {
      "file_name": "sample_contract_ja.txt",
      "doc_type": "contract",
      "similarity": 0.5
    }
  ],
  "confidence": 0.5,
  "has_answer": true
}
```

### Dify連携用エージェントAPI

| メソッド | エンドポイント | 説明 |
|---------|---------------|------|
| POST | `/agents/classify` | 文書分類 |
| POST | `/agents/chunk` | チャンク分割 |
| POST | `/agents/extract` | ファクト抽出 |
| POST | `/agents/quality-check` | 品質チェック |
| POST | `/agents/parse-query` | クエリ解析 |
| POST | `/agents/format-answer` | 回答フォーマット |

---

## データベーススキーマ

PostgreSQLはデータの**保存と検索のみ**を担当します。

### documents テーブル（文書メタ情報）

```sql
CREATE TABLE documents (
    id SERIAL PRIMARY KEY,
    file_id VARCHAR(255) UNIQUE NOT NULL,
    file_name VARCHAR(500) NOT NULL,
    file_type VARCHAR(100),
    doc_type VARCHAR(50),        -- AIが判定した文書種別
    owner_company VARCHAR(200),
    doc_date DATE,
    language VARCHAR(10),        -- ja, en
    confidence DECIMAL(3,2),     -- AIの判定信頼度
    storage_path TEXT,
    checksum VARCHAR(64),        -- SHA-256 (重複検出用)
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### chunks テーブル（テキストチャンク + ベクトル）

```sql
CREATE TABLE chunks (
    id SERIAL PRIMARY KEY,
    document_id INTEGER REFERENCES documents(id) ON DELETE CASCADE,
    chunk_index INTEGER NOT NULL,
    page INTEGER,
    section_title TEXT,
    text TEXT NOT NULL,          -- 元のテキスト
    char_len INTEGER,
    embedding vector(768),       -- ★ AIが生成したベクトルを保存
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### facts テーブル（抽出された事実）

```sql
CREATE TABLE facts (
    id SERIAL PRIMARY KEY,
    document_id INTEGER REFERENCES documents(id) ON DELETE CASCADE,
    chunk_id INTEGER REFERENCES chunks(id) ON DELETE SET NULL,
    fact_type VARCHAR(50) NOT NULL,  -- obligation, deadline, amount, etc.
    title TEXT,
    body TEXT NOT NULL,
    owner VARCHAR(200),
    due_date DATE,
    status VARCHAR(50),
    confidence DECIMAL(3,2),
    needs_review BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### evidence テーブル（引用情報）

```sql
CREATE TABLE evidence (
    id SERIAL PRIMARY KEY,
    fact_id INTEGER REFERENCES facts(id) ON DELETE CASCADE,
    quote TEXT NOT NULL,         -- 引用テキスト
    page INTEGER,
    chunk_index INTEGER,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### quality_checks テーブル（品質チェック結果）

```sql
CREATE TABLE quality_checks (
    id SERIAL PRIMARY KEY,
    document_id INTEGER REFERENCES documents(id) ON DELETE CASCADE,
    check_type VARCHAR(50) NOT NULL,
    passed BOOLEAN NOT NULL,
    score DECIMAL(3,2),
    details JSONB,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

---

## コンポーネント詳細

### 1. Document Classifier (`src/agents/document_classifier.py`)

文書の種別を自動判定するエージェント。

**対応文書種別:**
- `contract` - 契約書
- `manual` - マニュアル・手順書
- `invoice` - 請求書
- `minutes` - 議事録
- `report` - レポート・報告書

**判定ロジック:**
1. キーワードマッチング（ルールベース）
2. LLM分析（オプション、精度向上用）

### 2. Chunking Agent (`src/agents/chunking_agent.py`)

文書を検索可能なチャンクに分割。

**分割ルール:**
- 最大チャンクサイズ: 1000文字
- セクション境界で優先的に分割
- 改行・段落を考慮

### 3. AI Client (`src/llm/ai_client.py`)

複数のAIプロバイダーと通信するクライアント。

**対応プロバイダー:**
- Ollama（ローカルLLM）
- OpenAI
- Anthropic
- Azure OpenAI

**機能:**
- テキスト生成
- エンベディング生成
- ヘルスチェック

**設定例:**
```python
AIClient(
    base_url="http://localhost:11434",
    model="qwen2.5:7b",
    embedding_model="nomic-embed-text",
    provider=AIProvider.OLLAMA,
    timeout=60.0,
    max_retries=2
)
```

### 4. Database Service (`src/storage/database.py`)

PostgreSQLとの通信を担当。**AI処理は行いません**。

**機能:**
- ドキュメント・チャンクの**保存**
- AIが生成したベクトルの**保存**
- ベクトル類似**検索**（pgvector）
- 全文**検索**（フォールバック）

### 5. QA Agent (`backend/src/agents/qa_agent.py`)

質問応答の中核コンポーネント。

**処理フロー:**
1. 質問をエンベディング化
2. 類似チャンクを検索
3. コンテキストを構築
4. LLMで回答生成

### 6. Intent Router (`backend/src/agents/intent_router.py`)

質問の意図を分類し、適切な処理にルーティングするエージェント。

**対応意図カテゴリ:**
- `LIST_FILES` - ファイル一覧表示（例: "アップロードされたファイルは？"）
- `FILE_STATS` - 統計情報表示（例: "何件のドキュメントがある？"）
- `FILE_DETAIL` - 特定ファイル詳細（例: "契約書.pdfの内容は？"）
- `SEARCH_CONTENT` - コンテンツ検索（RAG）（例: "委託料について教えて"）
- `GENERAL_QA` - 一般的な質問（RAG）（例: "この契約の要点は？"）

**判定ロジック:**
1. ルールベースマッチング（キーワードパターン）
2. LLMフォールバック（ルールで判定できない場合）

### 7. PDF Parser (`backend/src/storage/pdf_parser.py`)

PDFファイルからテキストを抽出するモジュール。

**機能:**
- PyPDF2/pdfplumberでテキスト抽出
- ページ単位での処理

### 8. Local Storage (`backend/src/storage/local_storage.py`)

ファイルのアップロード・管理を担当するモジュール。

**機能:**
- ファイルアップロード・保存
- メタデータ管理（JSON形式）
- SHA-256チェックサムによる重複検出
- ファイル削除

---

## セットアップ

### 必要条件

- Python 3.11+
- PostgreSQL（ローカルまたはDocker）
- AIエンジン（Ollama/OpenAI/Anthropic/Azure のいずれか）

### インストール手順

1. **リポジトリのクローン**
```bash
git clone <repository-url>
cd AIAgent
```

2. **Python依存関係のインストール**
```bash
pip install -r requirements.txt
```

3. **環境変数の設定**
```bash
cp .env.example .env
# .envファイルを編集してAIプロバイダーを設定
```

4. **AIエンジンのセットアップ（Ollamaの場合）**
```bash
# モデルのダウンロード
ollama pull qwen2.5:7b
ollama pull nomic-embed-text
```

5. **PostgreSQLの起動**
```bash
# ローカルPostgreSQLを使用、またはDockerで起動
```

6. **APIサーバーの起動**
```bash
python src/main.py
```

### 環境変数

```bash
# .env ファイル

# =============================================================================
# Database Configuration
# =============================================================================
POSTGRES_HOST=localhost
POSTGRES_PORT=5432
POSTGRES_DB=aiagent
POSTGRES_USER=postgres
POSTGRES_PASSWORD=aiagent123

# =============================================================================
# AI Agent Configuration
# =============================================================================
# Provider type: ollama, openai, anthropic, azure
AI_PROVIDER=ollama

# Base URL for the AI API
# - Ollama: http://localhost:11434
# - OpenAI: https://api.openai.com/v1
# - Anthropic: https://api.anthropic.com
# - Azure: https://{your-resource}.openai.azure.com
# - Local LLM (LM Studio, text-generation-webui): http://localhost:1234/v1
AI_BASE_URL=http://localhost:11434

# API Key (required for OpenAI, Anthropic, Azure)
AI_API_KEY=

# Model name
AI_MODEL=qwen2.5:7b

# Embedding model
AI_EMBEDDING_MODEL=nomic-embed-text

# Request settings
AI_TIMEOUT=60
AI_MAX_RETRIES=2
AI_ENABLED=true

# =============================================================================
# API Server Configuration
# =============================================================================
API_HOST=0.0.0.0
API_PORT=8000
```

---

## ライセンス

このプロジェクトはMITライセンスの下で公開されています。

---

## 実装レビュー概要（2026-01-30）

### 重大な懸念点
- **pgvector 無効時の埋め込み保存が失敗する可能性**  
  `config/database/init.sql` は pgvector が無い場合に `embedding` 列を作成しない設計だが、`src/storage/database.py` は pgvector が無い場合でも `embedding` へ JSON を挿入しようとするため、`column "embedding" does not exist` で ingest が失敗する恐れがある。

### 高リスク（負荷時）
- **非同期APIで同期DBコネクションを共有**  
  `psycopg2` の単一コネクションを async ハンドラから共用しており、並行リクエスト時の競合やイベントループのブロッキングが起きうる。

### 中リスク（長期運用）
- **カーソルの明示的クローズ不足**  
  一部クエリでカーソルを閉じていないため、長時間稼働・高負荷時にリソース圧迫の恐れ。

### Vector DB と PostgreSQL（pgvector）の差（本プロジェクト観点）
- **PostgreSQL+pgvector**: RDBとベクトル検索を統合。中規模のデータで運用コストが低い。JOIN・トランザクションに強い。  
- **専用ベクトルDB**: 大規模・高QPSで優位。ベクトル検索特化だが、運用対象が増える。  
- **現在の実装との相性**: `documents/chunks` をRDBで管理し、pgvector+FTSで検索する構成は中規模に適している。専用ベクトルDBへ移行するなら、検索APIの置換とID連携（RDB側参照）を追加する構成が一般的。
