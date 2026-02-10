# ファイルアップロード処理・DB取り込み・検索の流れ

## 1. 全体の流れ（ファイル → DB）

```
[フロント] ファイル選択/ドロップ
    → ingestFile() → POST /pipeline/ingest (FormData)
[バックエンド] ingest_document()
    → 1. バリデーション（拡張子・Content-Type・サイズ）
    → 2. ファイル読み込み (content = await file.read())
    → 3. ストレージへアップロード (storage.upload)
    → 4. 重複チェック（checksum）→ 重複なら既存 document を返して終了
    → 5. テキスト抽出（PDF / テキスト系）
    → 6. 分類 (Classify) → 7. チャンキング → 8. 埋め込み生成 → 9. DB保存
    → 10. 事実抽出 (Extract) → 11. 品質チェック (Quality) → 12. クエリキャッシュ無効化
```

---

## 2. ファイルからデータを取得する部分（キー機能）

### 2.1 対応形式

| 形式 | 拡張子 | 取得方法 |
|------|--------|----------|
| PDF | `.pdf` | **PyPDF2** でページごとに `page.extract_text()`。テキストが少ないページは **OCR（glm-ocr 等）** で補完可能 |
| テキスト | `.txt`, `.csv`, `.json`, `.md` | `content.decode('utf-8')` でそのまま文字列化 |

### 2.2 OCR の使用有無

- **OCR はオプションで利用します。** 環境変数 `AI_OCR_MODEL`（例: `glm-ocr:bf16`）が設定されていて、かつ AI プロバイダが **Ollama** の場合に有効です。
- PDF はまず **PyPDF2** で各ページのテキストを取得。1 ページあたりのテキストが一定文字数未満のとき、そのページを **PyMuPDF** で画像化し、**Ollama の vision API**（例: glm-ocr）で OCR を実行してテキストを補完します。
- 品質チェックでは `parse_meta.ocr_used` に、実際に OCR が使われたかどうかを渡します（OCR で補完したページが 1 ページでもあれば `true`）。

```python
# backend/src/main.py 付近
quality = await check_quality_async(
    ...,
    {"ocr_used": parse_meta_ocr_used, "chunk_count": len(chunks["chunks"])},
    ...
)
```

### 2.3 テキスト抽出の実装箇所

| 処理 | ファイル | 関数・処理内容 |
|------|----------|----------------|
| PDF テキスト抽出 | `backend/src/storage/pdf_parser.py` | `extract_text_from_pdf(content)` → PyPDF2 でページループし `page.extract_text()`、`[{page, text}, ...]` を返す |
| PDF + OCR 補完 | `backend/src/storage/pdf_parser.py` | `extract_text_from_pdf_with_ocr(content, ocr_client, ocr_model)` → テキストが少ないページを PyMuPDF で画像化し、`AIClient.ocr_image()`（Ollama `/api/chat`）で OCR。`(pages, ocr_used)` を返す |
| テキストファイル | `backend/src/main.py` (ingest_document) | `raw_text = content.decode('utf-8')`、`pages = [{"page": 1, "text": raw_text}]` |

#### OCR の有効化

- **AI_OCR_MODEL**（例: `glm-ocr:bf16`）を設定すると、PDF のテキストが少ないページで自動的に OCR が使われます。
- **AI_PROVIDER=ollama** のときはメインの AI クライアントで OCR を実行します。
- メインが OpenAI 等の場合は **AI_OCR_BASE_URL** に Ollama の URL を指定すると、OCR 専用の Ollama クライアントが使われます。
- 例（`backend/.env.local` または環境変数）:
  - `AI_OCR_MODEL=glm-ocr:bf16`
  - （メインが Ollama でない場合）`AI_OCR_BASE_URL=https://ollama.wgzhao-mac.work`
- 利用する Ollama サーバーに glm-ocr モデルがインストールされている必要があります。

---

## 3. 使っている技術（データ取得・DB・検索まわり）

| 用途 | 技術・ライブラリ |
|------|------------------|
| PDF テキスト抽出 | **PyPDF2**（埋め込みテキスト）。テキストが少ないページは **PyMuPDF** でページを画像化し **Ollama vision（glm-ocr 等）** で OCR |
| ファイル保存 | ローカルストレージ（`LocalStorage`）、checksum で重複判定 |
| 文書分類 | LLM（Ollama/OpenAI互換） or ルールベース |
| チャンキング | ルールベース（`chunking_agent`）、800〜1500文字/チャンク、セクション・文末で分割 |
| 埋め込み | Ollama または OpenAI 互換 API（`nomic-embed-text` 等）、並列 `embed_batch` |
| DB | **PostgreSQL** + **pgvector**（vector(768)） |
| 検索 | **ハイブリッド検索**（ベクトル + 全文）、pgvector の HNSW インデックス、フォールバックで全文のみ |

---

## 4. DB への取り込み（キー機能）

- **documents**: 1ファイル = 1行（`file_id`, `file_name`, `doc_type`, `owner_company`, `checksum` 等）。
- **chunks**: チャンクごとに 1 行。`text` と **embedding vector(768)** を保存。
- 保存処理:
  - `db_service.save_document(...)` → 重複時は既存 `document_id` を返す。
  - 新規のみ `db_service.save_chunks_batch(document_id, chunks, embeddings)` で一括 INSERT（`execute_values`）。
- インデックス（検索速度に直結）:
  - `chunks.embedding`: **HNSW** (`vector_cosine_ops`) → ベクトル検索が速い。
  - `chunks.text`: **GIN** (`to_tsvector('simple', text)`) → 全文検索用。

---

## 5. 検索スピード・検索精度と関わる部分

### 5.1 検索スピードに関わる箇所

| 箇所 | 内容 | 影響 |
|------|------|------|
| **埋め込み次元** | `vector(768)`、embedding モデル | ベクトルサイズ・モデル選定で検索・キャッシュの負荷が変わる |
| **HNSW インデックス** | `idx_chunks_embedding` (chunks), `idx_query_cache_embedding` (query_cache) | 近似最近傍検索が速くなる |
| **top_k** | fast=3, standard=5, accurate=7 | 取得チャンク数が増えると検索・LLM の処理時間が増える |
| **クエリ拡張** | fast はスキップ、standard/accurate は LLM でキーワード拡張 | 拡張するほど 1 クエリあたりの時間が増える |
| **query_cache** | 質問 embedding で類似質問を検索しキャッシュヒット時は検索・LLM をスキップ | キャッシュヒット時に検索が非常に速くなる |
| **ハイブリッド検索** | ベクトル + 全文の両方実行してスコア融合 | 全文検索の ILIKE が重い場合、検索時間が伸びる要因になりうる |

### 5.2 検索精度に関わる箇所

| 箇所 | 内容 | 影響 |
|------|------|------|
| **テキスト抽出の質** | PDF は PyPDF2 のみ（OCR なし） | スキャンPDFはテキストが取れず、その文書は検索対象にならない／精度が落ちる |
| **チャンキング** | 800〜1500 文字、セクション・文末を考慮 | チャンク境界が不自然だと、検索で取る文脈がずれて精度が落ちる |
| **embedding モデル** | 例: nomic-embed-text | 同じモデルで ingest と query を揃えないとベクトル検索の精度が落ちる |
| **similarity_threshold** | 例: 0.3 | 低いとノイズが増え、高いと取りこぼしが増える |
| **top_k** | 3 / 5 / 7 | 多いほど LLM に渡す文脈が増え、答えの質が変わる（多いと精度向上の可能性、ただし遅くなる） |
| **ハイブリッド検索** | vector_weight=0.7 等 | ベクトルと全文のバランスで、キーワード一致と意味一致のトレードオフが変わる |
| **クエリ拡張** | standard/accurate で LLM によりキーワード追加 | 言い換え・同義語が効き、検索ヒット率が上がる |

### 5.3 まとめ（検索との関係）

- **取り込みで作られる「テキスト」と「embedding」の質**が、そのまま検索の土台になる。
  - テキスト抽出（PDF は OCR なし）→ 取れていない文書は検索できない。
  - チャンキング → 検索で返る「文脈の単位」なので、境界が精度に効く。
  - embedding → ベクトル検索・キャッシュの類似度計算の元になる。
- **検索側**では、top_k・similarity_threshold・ハイブリッドの重み・クエリ拡張の有無が、スピードと精度のトレードオフを決めている。

---

## 6. 主要コード位置の参照

| 処理 | ファイル: 行・関数 |
|------|---------------------|
| インジェスト入口 | `backend/src/main.py`: `ingest_document()` (POST `/pipeline/ingest`) |
| PDF テキスト抽出 | `backend/src/storage/pdf_parser.py`: `extract_text_from_pdf()` |
| チャンキング | `backend/src/agents/chunking_agent.py`: `chunk_document()` |
| 埋め込みバッチ | `backend/src/llm/ai_client.py`: `embed_batch()` |
| DB 保存 | `backend/src/storage/database.py`: `save_document()`, `save_chunks_batch()` |
| ベクトル検索 | `backend/src/storage/database.py`: `search_similar_chunks()` (pgvector) |
| 全文検索 | `backend/src/storage/database.py`: `search_chunks_fulltext()`, `_extract_keywords()` |
| ハイブリッド検索 | `backend/src/storage/database.py`: `search_hybrid()` |
| 検索モード・top_k | `backend/src/main.py`: ストリーム用 `MODE_CONFIG` (fast/standard/accurate)、`answer_question(top_k=5, use_hybrid_search=True)` |
| クエリキャッシュ | `backend/src/storage/database.py`: `get_cached_response()`, `save_cached_response()`, `clear_query_cache()` |
| スキーマ・インデックス | `config/database/init.sql`: `documents`, `chunks`, `embedding vector(768)`, HNSW/GIN インデックス |

---

*このドキュメントは、ファイルアップロードからDB取り込み、および検索スピード・検索精度に影響する箇所を整理したものです。*
