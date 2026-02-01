# AIAgent - Multi-Agent RAG System

LLM強化型のマルチエージェントRAG（Retrieval-Augmented Generation）システムです。ドキュメントを自動分類・構造化し、自然言語で質問応答ができます。

---

## 🚀 とりあえず動かす（3ステップ）

### 必要な環境
- **Docker Desktop** (Windows)
- **Node.js 18以上**

### 起動手順

```bash
# 1. リポジトリをクローン
git clone https://github.com/FGjp-techdes/AIAgent.git
cd AIAgent

# 2. 初回セットアップ（初回のみ）
setup.bat

# 3. 起動
start.bat
```

起動後、ブラウザで以下にアクセス:
- **フロントエンド**: http://localhost:3000
- **バックエンドAPI**: http://localhost:8001
- **API ドキュメント**: http://localhost:8001/docs

### 操作スクリプト

| スクリプト | 説明 |
|-----------|------|
| `start.bat` | PostgreSQL・バックエンド・フロントエンドを起動 |
| `stop.bat` | すべてのサービスを停止 |
| `reset_db.bat` | PostgreSQLデータとアップロードファイルを全削除してリセット |

---

## 📚 技術スタック

### フロントエンド
- **Next.js 15** - React フレームワーク (App Router)
- **React 19** - UIライブラリ
- **TypeScript** - 型安全な開発
- **Tailwind CSS** - ユーティリティファーストCSS

### バックエンド
- **FastAPI** - 高速なPython Webフレームワーク
- **Python 3.11** - プログラミング言語
- **Pydantic** - データバリデーション
- **Uvicorn** - ASGIサーバー

### データベース
- **PostgreSQL 16** - リレーショナルデータベース
- **pgvector** - ベクトル検索拡張

### AI/LLM
- **Ollama** - ローカルLLM実行環境
- **gemma3:4b** - Google のオープンソースLLM (4Bパラメータ)
- **nomic-embed-text** - テキスト埋め込みモデル
- **Cloudflare Tunnel** - 安全な外部アクセス (`https://ollama.kabu-ai.jp`)

### インフラ
- **Docker** - コンテナ化
- **Docker Compose** - マルチコンテナ管理

---

## 🏗️ システム構成

```
┌─────────────────────────────────────────────────────────────┐
│                    ユーザー (ブラウザ)                        │
└─────────────────────────────────────────────────────────────┘
                              │
                              ↓
┌─────────────────────────────────────────────────────────────┐
│  フロントエンド (Next.js 15 + React 19)                      │
│  - ドキュメントアップロード画面                               │
│  - 質問応答インターフェース                                   │
│  - ドキュメント一覧・詳細表示                                 │
│  ポート: 3000                                                │
└─────────────────────────────────────────────────────────────┘
                              │
                              ↓ REST API
┌─────────────────────────────────────────────────────────────┐
│  バックエンド (FastAPI + Python 3.11)                        │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  マルチエージェントシステム                          │   │
│  │  1. Document Classifier  (文書分類)                 │   │
│  │  2. Chunking Agent       (チャンク分割)             │   │
│  │  3. Fact Extractor       (情報抽出)                 │   │
│  │  4. Quality Guardian     (品質チェック)             │   │
│  │  5. SQL Query Agent      (クエリ生成)               │   │
│  │  6. Answer Formatter     (回答整形)                 │   │
│  │  7. Intent Router        (意図判定)                 │   │
│  │  8. QA Agent             (質問応答)                 │   │
│  └─────────────────────────────────────────────────────┘   │
│  ポート: 8001                                                │
└─────────────────────────────────────────────────────────────┘
         │                                    │
         ↓ HTTPS                              ↓ SQL + Vector Search
┌──────────────────────┐        ┌────────────────────────────┐
│  Ollama (LLM)        │        │  PostgreSQL 16 + pgvector  │
│  - gemma3:4b         │        │  - documents (文書メタ)     │
│  - nomic-embed-text  │        │  - chunks (テキスト+埋込)   │
│  via Cloudflare      │        │  - facts (抽出情報)         │
│  ollama.kabu-ai.jp   │        │  ポート: 5432               │
└──────────────────────┘        └────────────────────────────┘
```

---

## ✨ 主な機能

### 1. ドキュメント取り込み
- 契約書、議事録、請求書などを自動分類
- AIによる構造化（会社名、日付、金額などを自動抽出）
- チャンク分割してベクトルデータベースに保存

### 2. ベクトル検索
- PostgreSQL + pgvector による高速類似度検索
- ハイブリッド検索（キーワード + ベクトル）

### 3. 質問応答
- 自然言語で質問すると関連ドキュメントを検索
- LLM (gemma3:4b) が文脈を理解して回答生成
- 回答の根拠となる文書を表示

### 4. マルチエージェント処理
- 各タスクに特化したAIエージェントが協調動作
- ルールベース + LLM強化のハイブリッド処理

---

## 📁 プロジェクト構造

```
AIAgent/
├── backend/                 # FastAPI バックエンド
│   ├── src/
│   │   ├── agents/         # AIエージェント実装
│   │   ├── llm/            # LLM統合・プロンプト管理
│   │   ├── storage/        # データベース・ストレージ
│   │   └── main.py         # FastAPI アプリケーション
│   ├── Dockerfile          # バックエンド用Dockerイメージ
│   ├── requirements.txt    # Python依存関係
│   └── .env               # バックエンド環境変数
│
├── frontend/               # Next.js フロントエンド
│   ├── src/
│   │   ├── app/           # Next.js App Router
│   │   ├── components/    # Reactコンポーネント
│   │   └── lib/           # ユーティリティ・API
│   ├── package.json       # Node.js依存関係
│   └── .env.local         # フロントエンド環境変数
│
├── config/                 # 設定ファイル
│   ├── database/          # DB初期化スクリプト
│   └── dify/              # Difyプロンプト・ワークフロー
│
├── data/                   # アップロードデータ（Git除外）
├── docker-compose.yml      # Docker構成
├── setup.bat              # 初回セットアップ
├── start.bat              # 起動スクリプト（PostgreSQL + Backend + Frontend）
├── stop.bat               # 停止スクリプト
├── reset_db.bat           # データ全削除スクリプト（DB + アップロードファイル）
└── README.md
```

---

## 💡 使い方

### ドキュメントのアップロード

1. http://localhost:3000 にアクセス
2. 「Upload」ページを開く
3. ファイルをドラッグ&ドロップまたは選択
4. 自動的に分類・構造化され、データベースに保存される

### 質問応答

1. 「Query」ページを開く
2. 質問を入力（例: 「契約書の有効期限はいつまで？」）
3. システムが関連ドキュメントを検索し、AIが回答を生成

### ドキュメント一覧

- アップロードされたすべてのドキュメントを確認
- ドキュメントをクリックして詳細を表示

---

## ⚙️ 詳細な設定

### バックエンド設定 (`backend/.env`)

```env
# データベース接続
POSTGRES_HOST=postgres        # Docker環境では 'postgres'
POSTGRES_PORT=5432
POSTGRES_DB=aiagent
POSTGRES_USER=postgres
POSTGRES_PASSWORD=aiagent123

# Ollama設定
AI_PROVIDER=ollama
AI_BASE_URL=https://ollama.kabu-ai.jp  # Cloudflare Tunnel経由
AI_MODEL=gemma3:4b
AI_EMBEDDING_MODEL=nomic-embed-text
AI_ENABLED=true

# 並列処理設定
AI_MAX_CONCURRENT_EMBEDDINGS=4
AI_MAX_CONCURRENT_DOCUMENTS=3

# エージェント別LLM有効化
LLM_FACT_EXTRACTOR_ENABLED=true
LLM_SQL_QUERY_ENABLED=true
LLM_ANSWER_FORMATTER_ENABLED=true
LLM_DOCUMENT_CLASSIFIER_ENABLED=true
LLM_QUALITY_GUARDIAN_ENABLED=true
```

### フロントエンド設定 (`frontend/.env.local`)

```env
NEXT_PUBLIC_API_URL=http://localhost:8001
```

### Ollama接続について

バックエンドは `https://ollama.kabu-ai.jp` 経由でOllamaに接続します：

- **外部URL**: `https://ollama.kabu-ai.jp`
- **モデル**: `gemma3:4b`
- **埋め込みモデル**: `nomic-embed-text`
- **接続方式**: Cloudflare Tunnel経由のHTTPS

接続確認:
```bash
# Ollamaサーバーの健全性チェック
curl https://ollama.kabu-ai.jp/

# 利用可能なモデル一覧
curl https://ollama.kabu-ai.jp/api/tags

# バックエンドのヘルスチェック
curl http://localhost:8001/health
```

---

## 🔄 データのリセット

すべてのデータ（PostgreSQLデータベース + アップロードファイル）を削除してやり直す場合:

```bash
reset_db.bat
```

このスクリプトは以下を実行します:
1. PostgreSQLが起動しているか確認（起動していなければ起動）
2. アップロードファイルを削除（`data/uploads/`）
3. PostgreSQLのデータを削除（docker volume）
4. PostgreSQLを新規作成して再起動

---

## 🛠️ トラブルシューティング

### バックエンドに接続できない

```bash
# Dockerコンテナの状態を確認
docker-compose ps

# ログを確認
docker-compose logs backend
```

### データベースに接続できない

```bash
# PostgreSQLが起動しているか確認
docker-compose ps postgres

# データベースログを確認
docker-compose logs postgres

# データベースに直接接続してテスト
docker exec -it aiagent-postgres psql -U postgres -d aiagent
```

### Ollamaに接続できない

```bash
# Ollamaの疎通確認
curl https://ollama.kabu-ai.jp/

# バックエンドのヘルスチェック（Ollama接続状態も表示）
curl http://localhost:8001/health
```

### フロントエンドが起動しない

```bash
cd frontend

# node_modulesを削除して再インストール
rm -rf node_modules
npm install

# キャッシュをクリア
npm run build
```

---

## 🔧 手動起動（開発者向け）

### データベースのみ起動

```bash
docker-compose up -d postgres
```

### バックエンドをローカルで起動

```bash
cd backend

# 仮想環境を作成（初回のみ）
python -m venv venv
venv\Scripts\activate

# 依存関係をインストール（初回のみ）
pip install -r requirements.txt

# サーバー起動
uvicorn src.main:app --reload --host 0.0.0.0 --port 8001
```

**注意**: ローカル開発時は `backend/.env` の `POSTGRES_HOST=localhost` に変更してください。

### フロントエンドをローカルで起動

```bash
cd frontend

# 開発サーバー起動
npm run dev
```

---

## 📝 ライセンス

MIT License

---

## 🤝 貢献

Pull Requestを歓迎します！

---

## 📧 お問い合わせ

https://github.com/FGjp-techdes/AIAgent/issues
