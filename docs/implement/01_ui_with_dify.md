# DifyによるUI実装ガイド

## 概要

Difyは、LLMアプリケーションのノーコード/ローコード開発プラットフォームです。
AIAgentのAPIと連携し、ファイルアップロードやチャット機能を持つUIを素早く構築できます。

## メリット・デメリット

### メリット
- **開発速度**: コーディング不要でUIを構築
- **ビジュアルワークフロー**: 処理フローをGUIで設計
- **組み込み機能**: ファイルアップロード、チャット履歴、ユーザー管理が標準搭載
- **マルチモーダル対応**: テキスト、画像、ファイルを統合的に扱える
- **デプロイ簡単**: Dockerで即座に公開可能

### デメリット
- **カスタマイズ制限**: 細かいUI調整が難しい
- **依存性**: Difyプラットフォームへの依存
- **学習コスト**: Dify固有の概念（ワークフロー、変数など）の理解が必要
- **パフォーマンス**: 中間レイヤーが増えることによるオーバーヘッド

---

## 前提条件

- Docker / Docker Compose
- AIAgent APIサーバーが稼働中 (`http://localhost:8000`)

---

## セットアップ手順

### 1. Difyの起動

```bash
# Dify公式リポジトリをクローン
git clone https://github.com/langgenius/dify.git
cd dify/docker

# 起動
docker-compose up -d

# アクセス: http://localhost:3000
```

### 2. 初期設定

1. ブラウザで `http://localhost:3000` にアクセス
2. 管理者アカウントを作成
3. ログイン

### 3. AIAgentワークフローのインポート

```bash
# AIAgentのスクリプトを使用
cd /path/to/AIAgent
python scripts/import_to_dify.py --api-key YOUR_DIFY_API_KEY
```

または手動でワークフローを作成:

---

## ワークフロー設計

### A. ドキュメント取り込みワークフロー

```
[ファイルアップロード]
       ↓
[HTTP Request: POST /pipeline/ingest]
       ↓
[結果表示: チャンク数、ファクト数など]
```

**Dify設定:**

1. 新規アプリ作成 → 「ワークフロー」を選択
2. 「開始」ノードでファイルアップロードを有効化:
   ```yaml
   features:
     file_upload:
       enabled: true
       allowed_extensions: [".txt", ".pdf", ".docx", ".csv"]
       max_size: 15MB
   ```

3. 「HTTPリクエスト」ノードを追加:
   ```yaml
   method: POST
   url: http://host.docker.internal:8000/pipeline/ingest
   body_type: form-data
   body:
     file: "{{#files[0]#}}"
   ```

4. 「終了」ノードで結果を表示:
   ```
   ファイル処理完了！
   - ファイルID: {{http_response.file_id}}
   - チャンク数: {{http_response.chunks_count}}
   - ファクト数: {{http_response.facts_count}}
   ```

### B. 質問応答ワークフロー

```
[ユーザー質問入力]
       ↓
[HTTP Request: POST /qa/ask]
       ↓
[回答表示]
```

**Dify設定:**

1. 「開始」ノード: テキスト入力を有効化

2. 「HTTPリクエスト」ノード:
   ```yaml
   method: POST
   url: http://host.docker.internal:8000/qa/ask
   headers:
     Content-Type: application/json
   body:
     question: "{{#query#}}"
   ```

3. 「終了」ノード:
   ```
   {{http_response.answer}}

   【参照元】
   {{#each http_response.sources}}
   - {{this.file_name}} (信頼度: {{this.confidence}})
   {{/each}}
   ```

---

## 環境変数設定

Difyのワークフロー内で使用する環境変数:

```yaml
# config/dify/workflows/ingestion_workflow.yml
environment_variables:
  - name: API_BASE_URL
    value: "http://host.docker.internal:8000"  # Docker内からホストへ
```

ローカル開発時は `host.docker.internal` を使用。
本番環境ではAIAgent APIの実際のURLに変更。

---

## デプロイ構成

### 開発環境

```
┌─────────────────┐     ┌─────────────────┐
│   Dify UI       │────▶│  AIAgent API    │
│ localhost:3000  │     │ localhost:8000  │
└─────────────────┘     └─────────────────┘
```

### 本番環境

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   Nginx         │────▶│   Dify          │────▶│  AIAgent API    │
│ (リバースプロキシ) │     │ (コンテナ)       │     │ (コンテナ)       │
└─────────────────┘     └─────────────────┘     └─────────────────┘
```

### docker-compose.yml 例

```yaml
version: '3.8'

services:
  aiagent-api:
    build: .
    ports:
      - "8000:8000"
    environment:
      - POSTGRES_HOST=db
      - OLLAMA_BASE_URL=http://ollama:11434
    depends_on:
      - db
      - ollama

  dify:
    image: langgenius/dify-web:latest
    ports:
      - "3000:3000"
    environment:
      - API_BASE_URL=http://aiagent-api:8000

  db:
    image: postgres:15
    environment:
      - POSTGRES_DB=aiagent
      - POSTGRES_USER=postgres
      - POSTGRES_PASSWORD=aiagent123

  ollama:
    image: ollama/ollama:latest
    ports:
      - "11434:11434"
```

---

## トラブルシューティング

### 問題: DifyからAPIに接続できない

**原因**: Docker内からlocalhostにアクセスできない

**解決策**:
```yaml
# localhost:8000 ではなく
url: http://host.docker.internal:8000
```

### 問題: ファイルアップロードが失敗する

**原因**: ファイルサイズ制限

**解決策**: Difyの設定でサイズ上限を変更
```yaml
fileUploadConfig:
  file_size_limit: 50  # MB
```

### 問題: 日本語が文字化けする

**原因**: エンコーディング設定

**解決策**: APIレスポンスで `ensure_ascii=False` を確認

---

## 参考リンク

- [Dify公式ドキュメント](https://docs.dify.ai/)
- [Dify GitHub](https://github.com/langgenius/dify)
- [AIAgent API仕様](../ARCHITECTURE.md)
