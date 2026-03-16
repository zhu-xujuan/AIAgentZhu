#!/usr/bin/env python3
"""
精度テストスクリプト
テストドキュメントを作成し、取り込み、質問応答の精度をテストします。
"""

import os
import sys
import asyncio
import json
from datetime import datetime

# Fix Windows encoding issue
if sys.platform == 'win32':
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    sys.stderr.reconfigure(encoding='utf-8', errors='replace')

# Add project root to path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from dotenv import load_dotenv
load_dotenv()

# Test documents with clear, verifiable facts
TEST_DOCUMENTS = [
    {
        "filename": "test_01_company_profile.txt",
        "content": """株式会社テックイノベーション 会社概要

設立日: 2015年4月1日
資本金: 5億円
従業員数: 350名
本社所在地: 東京都渋谷区恵比寿1-2-3 テックビル10階
代表取締役: 山田太郎

事業内容:
- AIソリューション開発
- クラウドサービス提供
- データ分析コンサルティング

主要取引先: 大手製造業、金融機関、小売業
年間売上高: 80億円（2025年度）
""",
        "questions": [
            {"q": "テックイノベーションの資本金はいくらですか？", "a": "5億円"},
            {"q": "テックイノベーションの従業員数は何名ですか？", "a": "350名"},
        ]
    },
    {
        "filename": "test_02_product_manual.txt",
        "content": """製品マニュアル: スマートホームコントローラー SH-500

製品仕様:
- 型番: SH-500
- 電源: AC100V 50/60Hz
- 消費電力: 最大15W
- 外形寸法: 幅120mm × 高さ80mm × 奥行30mm
- 重量: 250g
- 対応プロトコル: Wi-Fi, Bluetooth 5.0, Zigbee 3.0
- 最大接続デバイス数: 100台

初期設定手順:
1. 電源ケーブルをコンセントに接続
2. 本体のLEDが青色に点滅することを確認
3. スマートフォンアプリ「SmartHome」をダウンロード
4. アプリを起動し「新規デバイス追加」をタップ
5. 画面の指示に従ってWi-Fi設定を完了

保証期間: 購入日から2年間
""",
        "questions": [
            {"q": "SH-500の消費電力は何ワットですか？", "a": "最大15W"},
            {"q": "スマートホームコントローラーの最大接続デバイス数は？", "a": "100台"},
        ]
    },
    {
        "filename": "test_03_service_contract.txt",
        "content": """クラウドサービス利用契約書

契約番号: CS-2026-0123
契約日: 2026年1月15日
契約期間: 2026年2月1日 から 2027年1月31日（1年間）

甲（発注者）: 株式会社ABC商事
乙（受注者）: 株式会社クラウドテック

サービス内容:
- クラウドストレージサービス（容量: 10TB）
- バックアップサービス（日次自動バックアップ）
- 24時間監視サービス

料金:
- 月額基本料金: 50万円（税別）
- 初期導入費用: 100万円（税別）
- オプション追加費用: 1TBあたり月額2万円

支払条件: 毎月末締め、翌月末払い
解約条件: 3ヶ月前までに書面にて通知
""",
        "questions": [
            {"q": "クラウドサービスの月額基本料金はいくらですか？", "a": "50万円"},
            {"q": "クラウドストレージの容量は何TBですか？", "a": "10TB"},
        ]
    },
    {
        "filename": "test_04_meeting_minutes.txt",
        "content": """プロジェクト進捗会議 議事録

日時: 2026年1月20日 14:00-15:30
場所: 本社5階 会議室A
参加者: 田中（PM）、鈴木、佐藤、高橋、山本

議題:
1. システム開発進捗報告
2. 課題共有と対応方針
3. 次期リリーススケジュール

決定事項:
- リリース日を2026年3月15日に確定
- テスト期間を2週間延長（2月15日〜2月28日）
- 追加予算として500万円を申請

TODO:
- 田中: 予算申請書を1月25日までに作成
- 鈴木: テスト計画書の更新を1月22日まで
- 佐藤: 外部ベンダーとの調整を1月末まで

次回会議: 2026年1月27日 14:00-15:00
""",
        "questions": [
            {"q": "プロジェクトのリリース日はいつですか？", "a": "2026年3月15日"},
            {"q": "追加予算はいくら申請しますか？", "a": "500万円"},
        ]
    },
    {
        "filename": "test_05_employee_handbook.txt",
        "content": """社員ハンドブック 2026年度版

勤務時間:
- 標準勤務時間: 9:00-18:00（休憩1時間）
- フレックスタイム: コアタイム10:00-15:00
- 月間所定労働時間: 160時間

休暇制度:
- 年次有給休暇: 入社時10日、以降毎年2日増加（最大20日）
- 夏季休暇: 7月〜9月に5日間取得可能
- 年末年始休暇: 12月29日〜1月3日
- 慶弔休暇: 結婚7日、忌引最大10日

福利厚生:
- 住宅手当: 月額3万円（世帯主の場合5万円）
- 通勤手当: 実費支給（上限月額5万円）
- 資格取得支援: 受験料全額補助、合格報奨金あり
""",
        "questions": [
            {"q": "年次有給休暇は入社時に何日付与されますか？", "a": "10日"},
            {"q": "住宅手当は世帯主の場合いくらですか？", "a": "5万円"},
        ]
    },
    {
        "filename": "test_06_technical_spec.txt",
        "content": """API技術仕様書 v2.0

エンドポイント: https://api.example.com/v2

認証方式: Bearer Token (JWT)
トークン有効期限: 24時間
リフレッシュトークン有効期限: 30日

レート制限:
- 無料プラン: 100リクエスト/分
- スタンダードプラン: 1000リクエスト/分
- エンタープライズプラン: 10000リクエスト/分

レスポンス形式: JSON
文字エンコーディング: UTF-8
最大リクエストサイズ: 10MB
タイムアウト: 30秒

エラーコード:
- 400: Bad Request
- 401: Unauthorized
- 403: Forbidden
- 404: Not Found
- 429: Too Many Requests
- 500: Internal Server Error
""",
        "questions": [
            {"q": "APIのトークン有効期限は何時間ですか？", "a": "24時間"},
            {"q": "スタンダードプランのレート制限は？", "a": "1000リクエスト/分"},
        ]
    },
    {
        "filename": "test_07_sales_report.txt",
        "content": """2025年度 営業実績報告書

期間: 2025年4月1日〜2026年3月31日

売上実績:
- 第1四半期（4-6月）: 15億円
- 第2四半期（7-9月）: 18億円
- 第3四半期（10-12月）: 22億円
- 第4四半期（1-3月）: 25億円（見込み）
- 年間合計: 80億円

部門別売上:
- 製造業向け: 35億円（43.8%）
- 金融業向け: 25億円（31.3%）
- 小売業向け: 12億円（15.0%）
- その他: 8億円（10.0%）

新規顧客獲得数: 45社
顧客継続率: 92%
""",
        "questions": [
            {"q": "2025年度の年間売上合計はいくらですか？", "a": "80億円"},
            {"q": "顧客継続率は何パーセントですか？", "a": "92%"},
        ]
    },
    {
        "filename": "test_08_project_proposal.txt",
        "content": """新規プロジェクト提案書

プロジェクト名: 次世代AIチャットボット開発
提案日: 2026年1月10日
提案者: 開発部 イノベーション課

概要:
生成AIを活用した高度な顧客対応チャットボットの開発

目標:
- 顧客問い合わせ対応時間を50%削減
- 24時間365日の自動対応を実現
- 顧客満足度を現状の75%から90%に向上

予算:
- 開発費用: 3000万円
- 運用費用: 年間500万円
- 合計初年度費用: 3500万円

スケジュール:
- フェーズ1（要件定義）: 2026年2月〜3月
- フェーズ2（開発）: 2026年4月〜8月
- フェーズ3（テスト）: 2026年9月〜10月
- 本番稼働: 2026年11月1日
""",
        "questions": [
            {"q": "AIチャットボットの開発費用はいくらですか？", "a": "3000万円"},
            {"q": "プロジェクトの本番稼働予定日はいつですか？", "a": "2026年11月1日"},
        ]
    },
    {
        "filename": "test_09_training_guide.txt",
        "content": """新入社員研修プログラム ガイド

研修期間: 入社後3ヶ月間（4月〜6月）

Week 1-2: オリエンテーション
- 会社概要・組織説明
- 就業規則・コンプライアンス
- ビジネスマナー基礎

Week 3-4: 業務基礎研修
- 社内システム操作
- 業務プロセス理解
- 各部門ローテーション

Week 5-8: 専門スキル研修
- 配属部門の専門知識
- OJT（実務研修）
- メンター制度開始

Week 9-12: 実践研修
- 実プロジェクト参加
- 成果発表準備
- 最終評価面談

修了要件:
- 出席率90%以上
- 各研修の確認テスト合格（70点以上）
- 成果発表の実施
""",
        "questions": [
            {"q": "新入社員研修の期間は何ヶ月ですか？", "a": "3ヶ月"},
            {"q": "研修の確認テスト合格ラインは何点ですか？", "a": "70点"},
        ]
    },
    {
        "filename": "test_10_security_policy.txt",
        "content": """情報セキュリティポリシー

文書番号: SEC-POL-001
施行日: 2026年1月1日
改訂版: 第3版

パスワードポリシー:
- 最小文字数: 12文字以上
- 必須要素: 大文字、小文字、数字、記号を各1文字以上
- 有効期間: 90日間
- 過去5回分のパスワード再利用禁止

アクセス制御:
- 二要素認証: 全システムで必須
- セッションタイムアウト: 30分
- 連続ログイン失敗: 5回でアカウントロック
- ロック解除: 30分後自動解除または管理者による手動解除

データ分類:
- 機密: 経営情報、個人情報、技術情報
- 社外秘: 社内文書、業務データ
- 一般: 公開情報
""",
        "questions": [
            {"q": "パスワードの最小文字数は何文字ですか？", "a": "12文字"},
            {"q": "連続ログイン失敗で何回でアカウントロックされますか？", "a": "5回"},
        ]
    },
]


async def check_system():
    """システムの状態を確認"""
    print("=" * 60)
    print("システム状態確認")
    print("=" * 60)

    # Ollama確認
    import httpx
    try:
        async with httpx.AsyncClient() as client:
            resp = await client.get("http://localhost:11434/api/tags", timeout=5)
            if resp.status_code == 200:
                data = resp.json()
                models = [m['name'] for m in data.get('models', [])]
                print(f"✓ Ollama: 動作中 (モデル: {', '.join(models[:3])}...)")
            else:
                print(f"✗ Ollama: エラー (status={resp.status_code})")
                return False
    except Exception as e:
        print(f"✗ Ollama: 接続失敗 ({e})")
        return False

    # PostgreSQL確認
    try:
        import psycopg2
        conn = psycopg2.connect(
            host=os.getenv("POSTGRES_HOST", "localhost"),
            port=int(os.getenv("POSTGRES_PORT", "5432")),
            database=os.getenv("POSTGRES_DB", "aiagent"),
            user=os.getenv("POSTGRES_USER", "postgres"),
            password=os.getenv("POSTGRES_PASSWORD", "aiagent123"),
        )
        cursor = conn.cursor()
        cursor.execute("SELECT COUNT(*) FROM documents")
        count = cursor.fetchone()[0]
        print(f"✓ PostgreSQL: 動作中 (既存ドキュメント: {count}件)")
        conn.close()
    except Exception as e:
        print(f"✗ PostgreSQL: 接続失敗 ({e})")
        return False

    return True


async def ingest_documents():
    """テストドキュメントを取り込み"""
    print("\n" + "=" * 60)
    print("ドキュメント取り込み")
    print("=" * 60)

    import httpx

    results = []
    async with httpx.AsyncClient(timeout=120.0) as client:
        for i, doc in enumerate(TEST_DOCUMENTS):
            print(f"\n[{i+1}/{len(TEST_DOCUMENTS)}] {doc['filename']}...")

            # ファイルをアップロード
            files = {
                'file': (doc['filename'], doc['content'].encode('utf-8'), 'text/plain')
            }

            try:
                resp = await client.post(
                    "http://localhost:8000/pipeline/ingest",
                    files=files
                )

                if resp.status_code == 200:
                    data = resp.json()
                    print(f"  ✓ 取り込み成功")
                    print(f"    - doc_type: {data.get('classification', {}).get('doc_type')}")
                    print(f"    - chunks: {data.get('chunks_count')}")
                    print(f"    - embeddings: {data.get('embeddings_count')}")
                    results.append({"filename": doc['filename'], "success": True, "data": data})
                else:
                    print(f"  ✗ 取り込み失敗 (status={resp.status_code})")
                    print(f"    {resp.text[:200]}")
                    results.append({"filename": doc['filename'], "success": False, "error": resp.text})

            except Exception as e:
                print(f"  ✗ エラー: {e}")
                results.append({"filename": doc['filename'], "success": False, "error": str(e)})

    success_count = sum(1 for r in results if r['success'])
    print(f"\n取り込み結果: {success_count}/{len(TEST_DOCUMENTS)} 成功")
    return results


async def run_qa_tests():
    """質問応答の精度テスト"""
    print("\n" + "=" * 60)
    print("質問応答 精度テスト")
    print("=" * 60)

    import httpx

    test_results = []
    total_questions = 0
    correct_answers = 0

    async with httpx.AsyncClient(timeout=120.0) as client:
        for doc in TEST_DOCUMENTS:
            print(f"\n--- {doc['filename']} ---")

            for qa in doc['questions']:
                total_questions += 1
                question = qa['q']
                expected = qa['a']

                print(f"\nQ: {question}")
                print(f"期待: {expected}")

                try:
                    resp = await client.post(
                        "http://localhost:8000/pipeline/query",
                        json={"question": question}
                    )

                    if resp.status_code == 200:
                        data = resp.json()
                        answer = data.get('answer', '')
                        confidence = data.get('confidence', 0)
                        sources = data.get('sources', [])

                        # 回答に期待値が含まれているか確認
                        is_correct = expected.lower() in answer.lower() or expected in answer

                        if is_correct:
                            correct_answers += 1
                            status = "✓ 正解"
                        else:
                            status = "✗ 不正解"

                        print(f"A: {answer[:200]}...")
                        print(f"信頼度: {confidence}")
                        print(f"ソース数: {len(sources)}")
                        print(f"結果: {status}")

                        test_results.append({
                            "question": question,
                            "expected": expected,
                            "answer": answer,
                            "is_correct": is_correct,
                            "confidence": confidence,
                            "sources": sources,
                        })
                    else:
                        print(f"✗ API エラー (status={resp.status_code})")
                        test_results.append({
                            "question": question,
                            "expected": expected,
                            "answer": None,
                            "is_correct": False,
                            "error": resp.text,
                        })

                except Exception as e:
                    print(f"✗ エラー: {e}")
                    test_results.append({
                        "question": question,
                        "expected": expected,
                        "answer": None,
                        "is_correct": False,
                        "error": str(e),
                    })

    # 結果サマリー
    accuracy = (correct_answers / total_questions * 100) if total_questions > 0 else 0

    print("\n" + "=" * 60)
    print("テスト結果サマリー")
    print("=" * 60)
    print(f"総質問数: {total_questions}")
    print(f"正解数: {correct_answers}")
    print(f"精度: {accuracy:.1f}%")

    # 不正解の分析
    incorrect = [r for r in test_results if not r['is_correct']]
    if incorrect:
        print(f"\n不正解一覧 ({len(incorrect)}件):")
        for r in incorrect:
            print(f"  Q: {r['question']}")
            print(f"  期待: {r['expected']}")
            if r.get('answer'):
                print(f"  回答: {r['answer'][:100]}...")
            if r.get('error'):
                print(f"  エラー: {r['error'][:100]}")
            print()

    return {
        "total": total_questions,
        "correct": correct_answers,
        "accuracy": accuracy,
        "results": test_results,
    }


async def main():
    """メイン処理"""
    print("=" * 60)
    print("AIAgent 精度テスト")
    print(f"実行日時: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print("=" * 60)

    # 1. システム確認
    if not await check_system():
        print("\nシステムが正常に動作していません。")
        print("PostgreSQLとOllamaが起動していることを確認してください。")
        return

    # 2. API サーバーが起動しているか確認
    import httpx
    try:
        async with httpx.AsyncClient() as client:
            resp = await client.get("http://localhost:8000/health", timeout=5)
            if resp.status_code != 200:
                raise Exception(f"status={resp.status_code}")
            print(f"✓ API サーバー: 動作中")
    except Exception as e:
        print(f"✗ API サーバー: 接続失敗 ({e})")
        print("\nAPIサーバーを起動してください:")
        print("  python src/main.py")
        return

    # 3. ドキュメント取り込み
    ingest_results = await ingest_documents()

    # 4. 精度テスト
    test_results = await run_qa_tests()

    # 5. 結果をファイルに保存
    output = {
        "timestamp": datetime.now().isoformat(),
        "ingest": ingest_results,
        "test": test_results,
    }

    with open("test_results.json", "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False, indent=2)

    print(f"\n結果を test_results.json に保存しました。")


if __name__ == "__main__":
    asyncio.run(main())