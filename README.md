# AIAgent - Multi-Agent RAG System

LLM強化型のマルチエージェントRAG（Retrieval-Augmented Generation）システムです。ドキュメントの取り込みから質問応答まで、AIエージェントがインテリジェントに処理します。

## 主な機能

- **ドキュメント取り込み**: 契約書、議事録、請求書などの自動分類と構造化
- **ベクトル検索**: PostgreSQL + pgvectorによる高速な類似度検索
- **質問応答**: Ollamaを使ったLLM強化型のインテリジェントな回答生成
- **マルチエージェント処理**: 各タスクに特化したAIエージェントによる協調処理
- **外部LLMアクセス**: Cloudflare Tunnel経由で安全にOllamaサーバーにアクセス

## セットアップ済み項目

このリポジトリには、すぐに起動できるように以下が設定済みです:

### ✅ 環境設定ファイル
- `backend/.env` - バックエンドの環境変数（Ollama接続設定含む）
- `frontend/.env.local` - フロントエンドの環境変数

### ✅ Docker環境
- `docker-compose.yml` - PostgreSQL（pgvector）+ バックエンドAPI
- `backend/Dockerfile` - FastAPIバックエンドのコンテナイメージ
- データベース初期化スクリプト（`config/database/init.sql`）

### ✅ 起動スクリプト
- `setup.bat` - 初回セットアップ（依存関係インストール、環境確認）
- `start.bat` - ワンクリック起動（DB、バックエンド、フロントエンド）
- `stop.bat` - アプリケーション停止

### ✅ Ollama設定
- **接続先**: `https://ollama.kabu-ai.jp` （Cloudflare Tunnel経由）
- **モデル**: `gemma3:4b` （gemma3シリーズの4Bパラメータモデル）
- **埋め込みモデル**: `nomic-embed-text` （ベクトル検索用）

## アーキテクチャ

- **フロントエンド**: Next.js 15 + React 19 + TypeScript + Tailwind CSS
- **バックエンド**: FastAPI + Python 3.11
- **データベース**: PostgreSQL 16 + pgvector
- **LLM**: Ollama (外部アクセス: `https://ollama.kabu-ai.jp`)

## 必要な環境

- Docker Desktop (Windows)
- Node.js 18以上
- Python 3.11以上 (ローカル開発時)
- Ollama (外部ドメインで稼働中: `ollama.kabu-ai.jp`)

## クイックスタート

### 1. リポジトリのクローン

```bash
git clone <repository-url>
cd AIAgent
```

### 2. 初期セットアップ（初回のみ）

Windowsの場合、セットアップスクリプトを実行:

```bash
setup.bat
```

このスクリプトは以下を自動的に実行します:
1. フロントエンドの依存関係をインストール（npm install）
2. 環境設定ファイルの確認（.envファイル）
3. Dockerイメージのビルド

### 3. 起動

Windowsの場合、起動スクリプトを実行:

```bash
start.bat
```

このスクリプトは以下を自動的に実行します:
1. PostgreSQLデータベースを起動（Docker）
2. バックエンドAPIを起動（Docker）
3. フロントエンド開発サーバーを起動（別ウィンドウ）

### 4. アクセス

起動完了後、以下のURLにアクセスできます:

- **フロントエンド**: http://localhost:3000
- **バックエンドAPI**: http://localhost:8000
- **API ドキュメント**: http://localhost:8000/docs

## 手動起動（開発者向け）

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

# .envファイルが作成済みであることを確認

# サーバー起動
uvicorn src.main:app --reload --host 0.0.0.0 --port 8000
```

### フロントエンドをローカルで起動

```bash
cd frontend

# 開発サーバー起動
npm run dev
```

## 設定ファイル

### バックエンド設定 (`backend/.env`)

```env
# データベース
POSTGRES_HOST=localhost
POSTGRES_PORT=5432
POSTGRES_DB=aiagent
POSTGRES_USER=postgres
POSTGRES_PASSWORD=aiagent123

# AI設定（Ollama via Cloudflare Tunnel）
AI_PROVIDER=ollama
AI_BASE_URL=https://ollama.kabu-ai.jp
AI_MODEL=gemma3:4b
AI_EMBEDDING_MODEL=nomic-embed-text
AI_ENABLED=true
```

### フロントエンド設定 (`frontend/.env.local`)

```env
NEXT_PUBLIC_API_URL=http://localhost:8000
```

## プロジェクト構造

```
AIAgent/
├── backend/              # FastAPIバックエンド
│   ├── src/
│   │   ├── agents/      # AIエージェント
│   │   ├── llm/         # LLM統合
│   │   └── storage/     # データストレージ
│   ├── requirements.txt
│   └── .env
├── frontend/            # Next.jsフロントエンド
│   ├── src/
│   │   ├── app/        # Next.js App Router
│   │   ├── components/ # Reactコンポーネント
│   │   └── lib/        # ユーティリティ
│   ├── package.json
│   └── .env.local
├── config/              # 設定ファイル
│   └── database/       # DB初期化スクリプト
├── data/                # アップロードデータ
├── docker-compose.yml   # Docker構成
├── start.bat           # 起動スクリプト（Windows）
├── stop.bat            # 停止スクリプト（Windows）
└── README.md
```

## 使い方

### 1. ドキュメントのアップロード

1. http://localhost:3000 にアクセス
2. 「Upload」ページを開く
3. ファイルをドラッグ&ドロップまたは選択
4. 自動的に分類・構造化され、データベースに保存される

### 2. 質問応答

1. 「Query」ページを開く
2. 質問を入力（例: 「契約書の有効期限はいつまで？」）
3. システムが関連ドキュメントを検索し、AIが回答を生成

### 3. ドキュメント一覧

- アップロードされたすべてのドキュメントを確認
- ドキュメントをクリックして詳細を表示

## LLM（Ollama）の設定

このプロジェクトでは、Ollamaを外部ドメイン経由でアクセスします:

- **外部URL**: `https://ollama.kabu-ai.jp` （Cloudflare Tunnel経由）
- **モデル**: `gemma3:4b` （総合評価1位、90.59点）
- **埋め込みモデル**: `nomic-embed-text`
- **プロバイダー**: Ollama（ローカルLLM）

### Ollama接続の仕組み

1. **ローカルOllamaサーバー**: `http://localhost:11434`でリッスン
2. **Cloudflare Tunnel**: ローカルサーバーを外部公開
3. **外部ドメイン**: `https://ollama.kabu-ai.jp`でHTTPS経由でアクセス可能
4. **バックエンド接続**: AIAgentバックエンドは`https://ollama.kabu-ai.jp`経由でOllamaにアクセス

この設定により、Ollamaサーバーがローカルまたは別のマシンで稼働していても、安全にHTTPS経由でアクセスできます。

### 設定ファイル（backend/.env）

```env
# Ollama設定
AI_PROVIDER=ollama
AI_BASE_URL=https://ollama.kabu-ai.jp
AI_MODEL=gemma3:4b
AI_EMBEDDING_MODEL=nomic-embed-text
AI_ENABLED=true
```

### 接続確認方法

```bash
# Ollamaサーバーの健全性チェック
curl https://ollama.kabu-ai.jp/

# 利用可能なモデル一覧
curl https://ollama.kabu-ai.jp/api/tags

# バックエンドのヘルスチェック（Ollama接続状態も確認）
curl http://localhost:8000/health
```

## トラブルシューティング

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
```

### Ollamaに接続できない

```bash
# Ollamaの健全性チェック
curl https://ollama.kabu-ai.jp/

# バックエンドのヘルスチェック
curl http://localhost:8000/health
```

## 停止方法

```bash
# 起動スクリプトで起動した場合
stop.bat

# または手動で
docker-compose down
```

フロントエンドは別ウィンドウで実行されているため、`Ctrl+C`で手動停止してください。

## 開発

### テストの実行

```bash
cd backend
pytest
```

### コードフォーマット

```bash
# バックエンド
cd backend
black src/
isort src/

# フロントエンド
cd frontend
npm run lint
```

## 実施した設定内容の詳細

このプロジェクトは、フロントエンド・バックエンド含めてすぐに起動できるように以下の設定を実施しています。

### 1. バックエンド環境設定（backend/.env）

```env
# データベース接続
POSTGRES_HOST=localhost
POSTGRES_PORT=5432
POSTGRES_DB=aiagent
POSTGRES_USER=postgres
POSTGRES_PASSWORD=aiagent123

# Ollama設定（重要）
AI_PROVIDER=ollama
AI_BASE_URL=https://ollama.kabu-ai.jp  # Cloudflare Tunnel経由のHTTPSアクセス
AI_MODEL=gemma3:4b                      # メインモデル
AI_EMBEDDING_MODEL=nomic-embed-text     # ベクトル埋め込み用
AI_ENABLED=true                         # LLM機能を有効化

# 並列処理設定
AI_MAX_CONCURRENT_EMBEDDINGS=4          # 同時埋め込み生成数
AI_MAX_CONCURRENT_DOCUMENTS=3           # 同時ドキュメント処理数

# エージェント別LLM有効化（すべてtrue）
LLM_FACT_EXTRACTOR_ENABLED=true
LLM_SQL_QUERY_ENABLED=true
LLM_ANSWER_FORMATTER_ENABLED=true
LLM_DOCUMENT_CLASSIFIER_ENABLED=true
LLM_QUALITY_GUARDIAN_ENABLED=true
```

**重要**: `AI_BASE_URL=https://ollama.kabu-ai.jp` の設定により、バックエンドは外部ドメイン経由でOllamaにアクセスします。この設定は `C:\Users\meiteko\projects\ollama\access_urls_guide.md` で定義されたCloudflare Tunnelの設定に基づいています。

### 2. フロントエンド環境設定（frontend/.env.local）

```env
NEXT_PUBLIC_API_URL=http://localhost:8000
```

この設定により、フロントエンドはローカルで稼働するバックエンドAPIに接続します。

### 3. Docker Compose設定

`docker-compose.yml` に以下のサービスを定義:

- **postgres**: PostgreSQL 16 + pgvector拡張（ベクトル検索用）
- **backend**: FastAPIバックエンド（ポート8000）

バックエンドはPostgreSQLの起動を待機してから起動します（`depends_on`設定）。

### 4. 起動の流れ

#### 初回セットアップ（setup.bat）
1. フロントエンドの依存関係をインストール（`npm install`）
2. 環境設定ファイルの存在確認
3. Dockerイメージのビルド

#### アプリケーション起動（start.bat）
1. フロントエンドの依存関係を確認（未インストールの場合は自動インストール）
2. Docker Composeでデータベースとバックエンドを起動
3. バックエンドの起動を待機（15秒）
4. フロントエンド開発サーバーを別ウィンドウで起動

### 5. Ollamaドメイン設定の詳細

バックエンドは以下のURLでOllamaに接続します:

```
https://ollama.kabu-ai.jp
```

このドメインは、Cloudflare Tunnelを使用してローカルOllamaサーバー（`http://localhost:11434`）を外部公開しています。

#### 接続の仕組み

```
[AIAgentバックエンド]
    ↓ HTTPS
[https://ollama.kabu-ai.jp (Cloudflare CDN)]
    ↓ Cloudflare Tunnel
[ローカルOllamaサーバー: localhost:11434]
    ↓
[gemma3:4bモデル]
```

#### 利点
- **HTTPS**: 暗号化された安全な通信
- **DDoS保護**: Cloudflareによる保護
- **外部アクセス**: インターネット経由でどこからでもアクセス可能
- **ファイアウォール不要**: Cloudflare Tunnelが自動的に接続を確立

### 6. データベーススキーマ

PostgreSQLには以下のテーブルが自動作成されます（`config/database/init.sql`）:

- **documents**: アップロードされたドキュメント
- **chunks**: ドキュメントをチャンク分割した結果
- **facts**: 抽出された事実情報
- **evidence**: 引用・根拠情報
- **quality_checks**: 品質チェック結果

chunksテーブルには `embedding vector(768)` カラムが追加され、ベクトル検索が可能です。

### 7. 作成されたファイル一覧

```
AIAgent/
├── backend/
│   ├── .env                    # バックエンド環境変数（Ollama設定含む）
│   └── Dockerfile              # バックエンドDockerイメージ定義
├── frontend/
│   └── .env.local              # フロントエンド環境変数
├── docker-compose.yml          # PostgreSQL + バックエンドサービス定義
├── setup.bat                   # 初回セットアップスクリプト
├── start.bat                   # 起動スクリプト
├── stop.bat                    # 停止スクリプト
├── .gitignore                  # Git除外設定
└── README.md                   # このファイル
```

## トラブルシューティング（詳細版）

### Ollamaに接続できない場合

```bash
# 1. Ollamaドメインの疎通確認
curl https://ollama.kabu-ai.jp/

# 期待されるレスポンス: "Ollama is running"

# 2. モデル一覧の取得
curl https://ollama.kabu-ai.jp/api/tags

# 期待されるレスポンス: gemma3:4bが含まれるJSON

# 3. バックエンドのヘルスチェック
curl http://localhost:8000/health

# llm.available が true であることを確認
```

### データベースに接続できない場合

```bash
# PostgreSQLコンテナのログを確認
docker-compose logs postgres

# コンテナが起動しているか確認
docker-compose ps

# データベースに直接接続してテスト
docker exec -it aiagent-postgres psql -U postgres -d aiagent
```

### フロントエンドが起動しない場合

```bash
# node_modulesを削除して再インストール
cd frontend
rm -rf node_modules
npm install

# キャッシュをクリア
npm run build
```

## ライセンス

MIT License

## 貢献

Pull Requestを歓迎します！
