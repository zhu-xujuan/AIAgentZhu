# 自作UIの実装ガイド

## 概要

AIAgent APIを直接呼び出すカスタムUIを自前で構築する方法です。
React、Vue、またはバニラJavaScriptなど、任意のフレームワークで実装できます。

## メリット・デメリット

### メリット
- **完全なカスタマイズ**: UI/UXを自由に設計
- **軽量**: 中間レイヤーなしで直接API呼び出し
- **独立性**: 外部プラットフォームへの依存なし
- **パフォーマンス**: 最適化の自由度が高い
- **ブランディング**: 独自のデザインシステムを適用可能

### デメリット
- **開発コスト**: 全て自前で実装が必要
- **メンテナンス**: UI部分の保守も自己責任
- **機能実装**: 認証、履歴管理などを自前で構築

---

## 必要なAPI エンドポイント

### ファイル取り込み

```
POST /pipeline/ingest
Content-Type: multipart/form-data

Request:
  file: <binary>

Response:
{
  "file_id": "20260129_xxx_document.txt",
  "document_id": 123,
  "classification": {
    "doc_type": "contract",
    "language": "ja",
    "confidence": 0.85
  },
  "chunks_count": 3,
  "embeddings_count": 3,
  "facts_count": 5,
  "quality": {
    "needs_review": false,
    "reasons": []
  },
  "llm_used": true,
  "stored_in_db": true
}
```

### 質問応答

```
POST /qa/ask
Content-Type: application/json

Request:
{
  "question": "田中さんのタスクは？"
}

Response:
{
  "answer": "田中さんのタスクは...",
  "sources": [...],
  "confidence": 0.85
}
```

### ヘルスチェック

```
GET /health

Response:
{
  "status": "healthy",
  "llm": {"enabled": true, "available": true},
  "database": {"available": true}
}
```

---

## 実装例

### 1. バニラ JavaScript（最小構成）

```html
<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <title>AIAgent UI</title>
  <style>
    body { font-family: sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; }
    .drop-zone { border: 2px dashed #ccc; padding: 40px; text-align: center; margin: 20px 0; }
    .drop-zone.dragover { border-color: #007bff; background: #f0f7ff; }
    .result { background: #f5f5f5; padding: 15px; margin: 10px 0; border-radius: 4px; }
    .error { color: red; }
    .success { color: green; }
  </style>
</head>
<body>
  <h1>AIAgent - ドキュメント取り込み</h1>

  <!-- ドラッグ&ドロップエリア -->
  <div id="dropZone" class="drop-zone">
    ファイルをドラッグ&ドロップ<br>
    または<br>
    <input type="file" id="fileInput" accept=".txt,.pdf,.docx,.csv">
  </div>

  <!-- 処理結果表示 -->
  <div id="results"></div>

  <script>
    const API_BASE = 'http://localhost:8000';
    const dropZone = document.getElementById('dropZone');
    const fileInput = document.getElementById('fileInput');
    const results = document.getElementById('results');

    // ドラッグ&ドロップ
    dropZone.addEventListener('dragover', (e) => {
      e.preventDefault();
      dropZone.classList.add('dragover');
    });

    dropZone.addEventListener('dragleave', () => {
      dropZone.classList.remove('dragover');
    });

    dropZone.addEventListener('drop', (e) => {
      e.preventDefault();
      dropZone.classList.remove('dragover');
      const files = e.dataTransfer.files;
      if (files.length > 0) {
        uploadFile(files[0]);
      }
    });

    // ファイル選択
    fileInput.addEventListener('change', (e) => {
      if (e.target.files.length > 0) {
        uploadFile(e.target.files[0]);
      }
    });

    // ファイルアップロード
    async function uploadFile(file) {
      const resultDiv = document.createElement('div');
      resultDiv.className = 'result';
      resultDiv.innerHTML = `<b>${file.name}</b> を処理中...`;
      results.prepend(resultDiv);

      try {
        const formData = new FormData();
        formData.append('file', file);

        const response = await fetch(`${API_BASE}/pipeline/ingest`, {
          method: 'POST',
          body: formData
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        const data = await response.json();

        resultDiv.innerHTML = `
          <b class="success">${file.name}</b> - 処理完了
          <ul>
            <li>ファイルID: ${data.file_id}</li>
            <li>ドキュメントタイプ: ${data.classification.doc_type}</li>
            <li>言語: ${data.classification.language}</li>
            <li>チャンク数: ${data.chunks_count}</li>
            <li>ファクト数: ${data.facts_count}</li>
            <li>DB保存: ${data.stored_in_db ? '成功' : '失敗'}</li>
          </ul>
        `;
      } catch (error) {
        resultDiv.innerHTML = `
          <b class="error">${file.name}</b> - エラー
          <p>${error.message}</p>
        `;
      }
    }
  </script>
</body>
</html>
```

### 2. React + TypeScript

```tsx
// src/components/FileUploader.tsx
import React, { useState, useCallback } from 'react';

interface IngestResult {
  file_id: string;
  document_id: number;
  classification: {
    doc_type: string;
    language: string;
    confidence: number;
  };
  chunks_count: number;
  facts_count: number;
  stored_in_db: boolean;
}

const API_BASE = 'http://localhost:8000';

export const FileUploader: React.FC = () => {
  const [results, setResults] = useState<{file: string; result?: IngestResult; error?: string}[]>([]);
  const [isDragging, setIsDragging] = useState(false);

  const uploadFile = useCallback(async (file: File) => {
    const tempResult = { file: file.name };
    setResults(prev => [tempResult, ...prev]);

    try {
      const formData = new FormData();
      formData.append('file', file);

      const response = await fetch(`${API_BASE}/pipeline/ingest`, {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data: IngestResult = await response.json();

      setResults(prev =>
        prev.map(r => r.file === file.name ? { ...r, result: data } : r)
      );
    } catch (error) {
      setResults(prev =>
        prev.map(r => r.file === file.name ? { ...r, error: String(error) } : r)
      );
    }
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);

    const files = Array.from(e.dataTransfer.files);
    files.forEach(uploadFile);
  }, [uploadFile]);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    files.forEach(uploadFile);
  }, [uploadFile]);

  return (
    <div className="file-uploader">
      <div
        className={`drop-zone ${isDragging ? 'dragging' : ''}`}
        onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
      >
        <p>ファイルをドラッグ&ドロップ</p>
        <input
          type="file"
          onChange={handleFileSelect}
          accept=".txt,.pdf,.docx,.csv"
          multiple
        />
      </div>

      <div className="results">
        {results.map((r, i) => (
          <div key={i} className={`result ${r.error ? 'error' : r.result ? 'success' : 'pending'}`}>
            <h4>{r.file}</h4>
            {r.result && (
              <ul>
                <li>タイプ: {r.result.classification.doc_type}</li>
                <li>チャンク: {r.result.chunks_count}</li>
                <li>ファクト: {r.result.facts_count}</li>
              </ul>
            )}
            {r.error && <p className="error-message">{r.error}</p>}
            {!r.result && !r.error && <p>処理中...</p>}
          </div>
        ))}
      </div>
    </div>
  );
};
```

### 3. Vue 3 + Composition API

```vue
<!-- src/components/FileUploader.vue -->
<template>
  <div class="file-uploader">
    <div
      class="drop-zone"
      :class="{ dragging: isDragging }"
      @dragover.prevent="isDragging = true"
      @dragleave="isDragging = false"
      @drop.prevent="handleDrop"
    >
      <p>ファイルをドラッグ&ドロップ</p>
      <input
        type="file"
        @change="handleFileSelect"
        accept=".txt,.pdf,.docx,.csv"
        multiple
      />
    </div>

    <div class="results">
      <div
        v-for="(r, i) in results"
        :key="i"
        :class="['result', r.error ? 'error' : r.result ? 'success' : 'pending']"
      >
        <h4>{{ r.file }}</h4>
        <ul v-if="r.result">
          <li>タイプ: {{ r.result.classification.doc_type }}</li>
          <li>チャンク: {{ r.result.chunks_count }}</li>
          <li>ファクト: {{ r.result.facts_count }}</li>
        </ul>
        <p v-else-if="r.error" class="error-message">{{ r.error }}</p>
        <p v-else>処理中...</p>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';

const API_BASE = 'http://localhost:8000';

interface IngestResult {
  file_id: string;
  document_id: number;
  classification: { doc_type: string; language: string; confidence: number };
  chunks_count: number;
  facts_count: number;
}

const isDragging = ref(false);
const results = ref<{ file: string; result?: IngestResult; error?: string }[]>([]);

async function uploadFile(file: File) {
  results.value.unshift({ file: file.name });

  try {
    const formData = new FormData();
    formData.append('file', file);

    const response = await fetch(`${API_BASE}/pipeline/ingest`, {
      method: 'POST',
      body: formData,
    });

    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const data = await response.json();
    const idx = results.value.findIndex(r => r.file === file.name);
    if (idx !== -1) results.value[idx].result = data;
  } catch (error) {
    const idx = results.value.findIndex(r => r.file === file.name);
    if (idx !== -1) results.value[idx].error = String(error);
  }
}

function handleDrop(e: DragEvent) {
  isDragging.value = false;
  const files = Array.from(e.dataTransfer?.files || []);
  files.forEach(uploadFile);
}

function handleFileSelect(e: Event) {
  const files = Array.from((e.target as HTMLInputElement).files || []);
  files.forEach(uploadFile);
}
</script>
```

---

## プロジェクト構成例

### React プロジェクト

```
aiagent-ui/
├── public/
│   └── index.html
├── src/
│   ├── components/
│   │   ├── FileUploader.tsx
│   │   ├── QuestionInput.tsx
│   │   ├── AnswerDisplay.tsx
│   │   └── DocumentList.tsx
│   ├── hooks/
│   │   └── useApi.ts
│   ├── types/
│   │   └── api.ts
│   ├── App.tsx
│   └── index.tsx
├── package.json
└── tsconfig.json
```

### APIフック例

```typescript
// src/hooks/useApi.ts
import { useState, useCallback } from 'react';

const API_BASE = process.env.REACT_APP_API_BASE || 'http://localhost:8000';

export function useIngest() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ingest = useCallback(async (file: File) => {
    setLoading(true);
    setError(null);

    try {
      const formData = new FormData();
      formData.append('file', file);

      const res = await fetch(`${API_BASE}/pipeline/ingest`, {
        method: 'POST',
        body: formData,
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (e) {
      setError(String(e));
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  return { ingest, loading, error };
}

export function useQA() {
  const [loading, setLoading] = useState(false);

  const ask = useCallback(async (question: string) => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/qa/ask`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question }),
      });
      return await res.json();
    } finally {
      setLoading(false);
    }
  }, []);

  return { ask, loading };
}
```

---

## CORS設定

AIAgent APIは既にCORS許可済み:

```python
# src/main.py
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # 全オリジン許可
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
```

本番環境では特定オリジンのみに制限推奨:

```python
allow_origins=["https://your-domain.com"]
```

---

## デプロイ構成

### 開発環境

```
┌─────────────────┐     ┌─────────────────┐
│  React Dev      │────▶│  AIAgent API    │
│ localhost:3000  │     │ localhost:8000  │
└─────────────────┘     └─────────────────┘
```

### 本番環境

```
┌─────────────────┐     ┌─────────────────┐
│     Nginx       │     │  AIAgent API    │
│  - 静的ファイル    │────▶│  (コンテナ)      │
│  - リバースプロキシ │     │                 │
└─────────────────┘     └─────────────────┘
```

### nginx.conf 例

```nginx
server {
    listen 80;
    server_name your-domain.com;

    # 静的ファイル (React build)
    location / {
        root /var/www/aiagent-ui;
        try_files $uri $uri/ /index.html;
    }

    # API プロキシ
    location /api/ {
        proxy_pass http://aiagent-api:8000/;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;

        # ファイルアップロード用
        client_max_body_size 50M;
    }
}
```

---

## チェックリスト

### 最小構成

- [ ] ファイルドラッグ&ドロップ
- [ ] アップロード進捗表示
- [ ] 処理結果表示
- [ ] エラーハンドリング

### 推奨機能

- [ ] 複数ファイル一括アップロード
- [ ] アップロード履歴表示
- [ ] 質問入力フォーム
- [ ] 回答表示（ソース付き）
- [ ] ドキュメント一覧表示

### 発展機能

- [ ] ユーザー認証
- [ ] チャット履歴保存
- [ ] ファイルプレビュー
- [ ] 検索機能
- [ ] ダークモード

---

## 参考リンク

- [Fetch API - MDN](https://developer.mozilla.org/ja/docs/Web/API/Fetch_API)
- [React公式](https://react.dev/)
- [Vue.js公式](https://vuejs.org/)
- [AIAgent API仕様](../ARCHITECTURE.md)
