/**
 * SalesAssist デモ用モックデータ
 * 本番接続時はこのファイルのimportを削除し、各ハンドラー内のコメントアウトを解除
 */
import type {
  OpportunityListItem,
  SFData,
  AnalysisResult,
  FileDealRecord,
} from "./types";

// ── 商談一覧（Salesforce / Kintone 共通） ──
export const MOCK_OPPORTUNITIES: OpportunityListItem[] = [
  {
    Id: "006Xx000001aB1c",
    Name: "DX推進プラットフォーム導入",
    Amount: 48000000,
    StageName: "提案中",
    CloseDate: "2026-06-30",
    AccountName: "東京海上ホールディングス株式会社",
  },
  {
    Id: "006Xx000001aB2d",
    Name: "AI文字起こしサービス全社展開",
    Amount: 12000000,
    StageName: "見積提示",
    CloseDate: "2026-05-15",
    AccountName: "三菱UFJ銀行",
  },
  {
    Id: "006Xx000001aB3e",
    Name: "クラウド基盤移行プロジェクト",
    Amount: 35000000,
    StageName: "交渉中",
    CloseDate: "2026-08-31",
    AccountName: "パナソニック株式会社",
  },
  {
    Id: "006Xx000001aB4f",
    Name: "カスタマーサポートAI自動化",
    Amount: 8500000,
    StageName: "ニーズ把握",
    CloseDate: "2026-09-30",
    AccountName: "楽天グループ株式会社",
  },
  {
    Id: "006Xx000001aB5g",
    Name: "社内ナレッジ検索AIシステム構築",
    Amount: 22000000,
    StageName: "提案中",
    CloseDate: "2026-07-31",
    AccountName: "日立製作所",
  },
];

// ── 各商談の詳細データ（活動履歴・担当者含む） ──
export const MOCK_SF_DATA_MAP: Record<string, SFData> = {
  // ── 東京海上：半年かけてDX全体像を把握→段階提案 ──
  "006Xx000001aB1c": {
    account: { Name: "東京海上ホールディングス株式会社", Industry: "保険・金融" },
    opportunity: {
      Name: "DX推進プラットフォーム導入",
      Amount: 48000000,
      StageName: "提案中",
      CloseDate: "2026-06-30",
      Description:
        "全社的なDX推進に向け、業務プロセスの可視化・自動化基盤を構築。保険査定業務のAI支援、代理店向けナレッジ検索システム、会議録自動生成を含む包括的な提案。現行の紙ベース業務からの脱却が急務。経営企画部からのトップダウン案件で、2026年度中の成果創出が求められている。",
    },
    activities: [
      { Subject: "展示会での名刺交換・初回接触", ActivityDate: "2025-10-15", Type: "Event", Description: "DX EXPOブースにて山田部長と名刺交換。保険業界のDX課題について立ち話。後日の面談を約束。" },
      { Subject: "初回訪問：DX推進部ヒアリング", ActivityDate: "2025-11-05", Type: "Meeting", Description: "山田部長・佐藤課長と面談。現状の業務課題を広くヒアリング。①査定業務の紙ベース運用（年間15万件）②代理店からの問い合わせ対応（月2,000件、平均回答に3日）③全国拠点の会議録が属人管理。DX推進室が2025年4月新設、まだ具体施策が決まっていない段階。" },
      { Subject: "電話フォロー：課題の優先順位確認", ActivityDate: "2025-11-20", Type: "Call", Description: "佐藤課長と電話。経営会議でDX推進の予算枠（5,000万〜8,000万）が仮承認されたとの情報。最優先は代理店サポート効率化、次に査定業務。会議録は『あると嬉しい』程度。社内にIT部門はあるが、AI系の知見がないため外部パートナーを探している。" },
      { Subject: "2回目訪問：業務現場視察", ActivityDate: "2025-12-10", Type: "Meeting", Description: "査定部門を訪問し、実際の業務フローを見学。紙の申請書をスキャン→手動入力→審査の流れ。1件あたり平均45分。ベテラン査定員3名が来年度退職予定で、ナレッジ継承も急務。代理店コールセンターも視察：FAQ的な質問が全体の60%を占めることが判明。" },
      { Subject: "メール：競合状況と社内事情の共有", ActivityDate: "2025-12-20", Type: "Email", Description: "佐藤課長より情報提供。競合A社（大手SIer）がクラウド移行の提案を持ちかけている。ただし『AI活用の具体的な提案はまだどこからも来ていない』とのこと。年明けに経営層向け中間報告があり、具体案があると助かるとの依頼。" },
      { Subject: "3回目訪問：ソリューション案の方向性提示", ActivityDate: "2026-01-14", Type: "Meeting", Description: "山田部長・佐藤課長・IT企画室の村田主任の3名に対し、3つのソリューション方向性を提示。①AI RAG Agentで代理店向けナレッジ検索（最優先）②書きあげクンで会議録自動化③DX開発でRPA連携。代理店向けのデモ動画に山田部長が強い関心。予算は段階的に使いたいとの意向。" },
      { Subject: "電話：PoC実施の合意", ActivityDate: "2026-01-28", Type: "Call", Description: "佐藤課長から電話。経営層中間報告でAI活用の方向性が承認された。まずは代理店向けナレッジ検索のPoC（2週間）を実施したい。PoCに使うFAQデータ500件と商品マニュアル30冊分のPDFを提供可能とのこと。PoC費用は別途不要（本契約に含める想定）。" },
      { Subject: "PoC環境構築・データ受領", ActivityDate: "2026-02-05", Type: "Meeting", Description: "佐藤課長・村田主任と技術打ち合わせ。FAQ CSV 523件、商品マニュアルPDF 32冊分を受領。セキュリティ要件の確認：データは国内リージョンのみ、個人情報マスキング必須。PoC環境の構築スケジュールを合意。2/10〜2/21の2週間で実施。" },
      { Subject: "PoC中間報告", ActivityDate: "2026-02-14", Type: "Meeting", Description: "PoC開始5日目の中間報告。AI RAG Agentのデモを佐藤課長・村田主任に実施。FAQ質問に対する正答率87%（目標80%）を達成。『商品Aの免責事項は？』等の質問で、PDFマニュアルの該当箇所を引用して回答するデモに好反応。改善点：回答速度を3秒以内に短縮してほしい。" },
      { Subject: "PoC最終報告・結果共有", ActivityDate: "2026-02-25", Type: "Meeting", Description: "山田部長・佐藤課長・村田主任・代理店統括部の吉田次長（初参加）に最終報告。正答率92%、平均応答時間1.8秒。吉田次長『代理店の満足度調査でも問い合わせ対応速度が最大の不満。これが本番導入されれば大幅改善が見込める』と高評価。山田部長から正式提案の依頼。書きあげクンのデモも併せて実施し、議事録自動生成にも興味。" },
      { Subject: "提案書ドラフト送付", ActivityDate: "2026-03-05", Type: "Email", Description: "3段階導入プランの提案書ドラフトを送付。Phase1：代理店ナレッジ検索（RAG Agent）3ヶ月・2,800万、Phase2：会議録自動化（書きあげクン）2ヶ月・800万、Phase3：業務自動化RPA連携（DX開発）3ヶ月・1,400万。合計4,800万。山田部長より『概ね方向性は良い、来週の経営会議に諮りたい』との返信。" },
      { Subject: "経営会議前の最終すり合わせ", ActivityDate: "2026-03-10", Type: "Meeting", Description: "山田部長と1on1で最終確認。経営層が気にするポイント：①投資対効果（代理店対応工数の定量削減見込み）②セキュリティ認証③段階導入で各フェーズ毎に判断可能か。ROI試算を追加資料として翌日提出予定。競合A社のクラウド提案は規模が大きすぎて保留になった模様。" },
    ],
    contacts: [
      { Name: "山田 太郎", Title: "DX推進部長（意思決定者）", Email: "yamada.t@tokiomarine.example.com", Phone: "03-XXXX-1001" },
      { Name: "佐藤 花子", Title: "IT企画課長（実務推進者・主要窓口）", Email: "sato.h@tokiomarine.example.com", Phone: "03-XXXX-1002" },
      { Name: "村田 健太", Title: "IT企画室 主任（技術評価担当）", Email: "murata.k@tokiomarine.example.com", Phone: "03-XXXX-1003" },
      { Name: "吉田 真一", Title: "代理店統括部 次長（利用部門代表）", Email: "yoshida.s@tokiomarine.example.com", Phone: "03-XXXX-1004" },
    ],
  },

  // ── 三菱UFJ：議事録課題から始まり、PoC経由で全社展開へ ──
  "006Xx000001aB2d": {
    account: { Name: "三菱UFJ銀行", Industry: "銀行・金融" },
    opportunity: {
      Name: "AI文字起こしサービス全社展開",
      Amount: 12000000,
      StageName: "見積提示",
      CloseDate: "2026-05-15",
      Description:
        "支店会議・顧客商談の音声をAIで自動文字起こしし、議事録作成を効率化。書きあげクンの全社導入を検討中。年間2,000時間以上の議事録作成工数の削減が見込まれる。コンプライアンス部門の記録要件への対応も重要な導入動機。",
    },
    activities: [
      { Subject: "紹介経由の初回面談", ActivityDate: "2025-09-18", Type: "Meeting", Description: "既存顧客の伊藤氏からの紹介で鈴木室長と面談。銀行業界では会議の議事録作成が形骸化しており、特に支店長会議（月1回・全国120支店）の議事録が2週間遅れで届く状況。コンプライアンス監査でも記録の不備を指摘されている。" },
      { Subject: "業務改革推進室との課題深掘り", ActivityDate: "2025-10-08", Type: "Meeting", Description: "鈴木室長・松田係長と2時間のワークショップ形式で課題整理。議事録関連の課題を3カテゴリに分類：①支店長会議（月1回・重要度高）②顧客商談メモ（日常・属人化）③コンプラ委員会議事録（四半期・法的要件あり）。現在は各支店の庶務担当が手書きメモから作成、品質にばらつき。" },
      { Subject: "コンプライアンス部門ヒアリング", ActivityDate: "2025-10-22", Type: "Meeting", Description: "コンプラ部の大西課長と面談。金融庁検査対応として、重要会議の議事録は正確性と網羅性が必須。現状の手動議事録では検査時に『記録が不十分』と指摘されるリスク。音声データの保管要件：国内サーバー、暗号化必須、3年間保存。" },
      { Subject: "電話：予算策定スケジュールの確認", ActivityDate: "2025-11-12", Type: "Call", Description: "鈴木室長と電話。2026年度IT予算の申請締切が12月末。議事録自動化は『業務効率化施策』として申請予定。概算で1,000〜1,500万円の枠を想定。まずは1部門でPoCを実施し、効果実証後に全社展開の稟議を上げたい。" },
      { Subject: "PoC計画の策定会議", ActivityDate: "2025-12-03", Type: "Meeting", Description: "鈴木室長・松田係長・IT部門の河野主任と3者でPoC計画を策定。対象：東京本部の支店長会議（月1回・参加者20名）を3ヶ月間。評価基準：文字起こし精度95%以上、議事録生成の工数削減率、利用者満足度。1月からPoC開始で合意。" },
      { Subject: "PoC環境セットアップ・セキュリティ審査", ActivityDate: "2026-01-10", Type: "Meeting", Description: "IT部門の河野主任とセキュリティ審査対応。銀行特有の要件：①閉域網での動作確認②音声データの暗号化転送③個人情報フィルタリング機能④監査ログの出力。書きあげクンのオンプレミス版で対応可能であることを確認。審査通過。" },
      { Subject: "PoC 第1回：支店長会議の文字起こし", ActivityDate: "2026-01-20", Type: "Meeting", Description: "初回PoC実施。支店長会議（2時間・参加者18名）を書きあげクンで文字起こし。結果：文字起こし精度97.2%、議事録ドラフト生成まで会議終了後5分。従来は庶務担当が3日かけていた作業。松田係長『これは革命的』とコメント。話者識別の精度が一部低い点をフィードバック。" },
      { Subject: "PoC 第2回・改善版テスト", ActivityDate: "2026-02-17", Type: "Meeting", Description: "話者識別を改善した版でPoC2回目。精度98.1%に向上。追加テスト：顧客商談のシミュレーション録音でも検証。商談要約・アクションアイテム抽出機能にも好反応。大西課長（コンプラ部）も参加し、監査証跡としての活用可能性を評価。" },
      { Subject: "PoC結果報告・全社展開の提案", ActivityDate: "2026-03-01", Type: "Meeting", Description: "鈴木室長・松田係長・河野主任・大西課長に最終報告。PoC結果：精度98.1%（目標95%超）、議事録作成工数92%削減、利用者満足度4.6/5.0。全社展開プラン：120支店＋本部10部門＝年間ライセンス1,200万円。鈴木室長から見積もり依頼を正式に受領。" },
      { Subject: "正式見積書・導入計画書の送付", ActivityDate: "2026-03-08", Type: "Email", Description: "見積書と全社展開の導入計画書を送付。Phase1（4-6月）：本部5部門で先行導入、Phase2（7-9月）：全国支店への展開、Phase3（10-12月）：顧客商談への適用拡大。年間ライセンス1,200万、初期導入費用込みで計1,200万円。鈴木室長から『来週の部門長会議で報告予定』と返信。" },
    ],
    contacts: [
      { Name: "鈴木 一郎", Title: "業務改革推進室長（意思決定者）", Email: "suzuki.i@mufg.example.com", Phone: "03-XXXX-2001" },
      { Name: "松田 恵子", Title: "業務改革推進室 係長（実務担当・窓口）", Email: "matsuda.k@mufg.example.com", Phone: "03-XXXX-2002" },
      { Name: "河野 勇太", Title: "IT統括部 主任（技術評価）", Email: "kawano.y@mufg.example.com", Phone: "03-XXXX-2003" },
      { Name: "大西 和彦", Title: "コンプライアンス部 課長", Email: "onishi.k@mufg.example.com", Phone: "03-XXXX-2004" },
    ],
  },

  // ── パナソニック：製造業DX、現場発の声→経営層まで巻き込み ──
  "006Xx000001aB3e": {
    account: { Name: "パナソニック株式会社", Industry: "製造業" },
    opportunity: {
      Name: "クラウド基盤移行＋AI技術文書検索",
      Amount: 35000000,
      StageName: "交渉中",
      CloseDate: "2026-08-31",
      Description:
        "オンプレミスの社内システムをクラウドへ移行しつつ、AI RAG Agentによる技術文書検索システムと製造ラインのデータ分析基盤を構築。BCP対策と技術継承の両面で経営層の関心が高い。ベテラン技術者の大量退職（2026-2028年で約200名）への備えが喫緊の課題。",
    },
    activities: [
      { Subject: "セミナー参加後の初回アプローチ", ActivityDate: "2025-08-20", Type: "Email", Description: "当社主催の『製造業AI活用セミナー』に田中部長が参加。セミナー後のアンケートで『技術文書検索に関心あり』と回答。お礼メールと事例資料を送付。" },
      { Subject: "初回訪問：情報システム部", ActivityDate: "2025-09-10", Type: "Meeting", Description: "田中部長・高橋リーダーと面談。現状：社内に技術文書が約50万件（設計図面、品質試験報告書、製造手順書等）あるが、ファイルサーバーに散在。検索は『ファイル名で探す→見つからない→人に聞く』の繰り返し。クラウド移行は中期経営計画に盛り込み済みだが、具体的なAI活用計画はまだない。" },
      { Subject: "製造現場ヒアリング（門真工場）", ActivityDate: "2025-10-02", Type: "Meeting", Description: "高橋リーダーの案内で門真工場を訪問。製造技術課の川口課長・ベテラン技術者2名にヒアリング。『新しい不具合が出たとき、過去に同じ事例がないか調べるのに丸一日かかることがある』『退職するベテランの頭の中にしかないノウハウがある』『マニュアルを作る時間がない』等のリアルな課題を多数聴取。" },
      { Subject: "品質保証部ヒアリング", ActivityDate: "2025-10-16", Type: "Meeting", Description: "品質保証部の藤井部長と面談。ISO監査対応で過去の品質記録を迅速に参照する必要があるが、現状は紙のバインダーとExcel管理。『AIで品質記録を横断検索できれば、監査対応が劇的に楽になる』。年間の品質関連文書は約3万件新規追加。" },
      { Subject: "電話：現場課題の全体像整理", ActivityDate: "2025-11-05", Type: "Call", Description: "高橋リーダーと電話で課題整理。現場ヒアリング結果を3つの柱に集約：①技術文書AI検索（最優先・現場の声が最も大きい）②品質記録のデジタル管理③ベテランナレッジの動画・音声記録と検索。クラウド移行はこれらの基盤として必要。予算感は3,000万〜4,000万。" },
      { Subject: "2回目訪問：ソリューション方向性提示", ActivityDate: "2025-11-25", Type: "Meeting", Description: "田中部長・高橋リーダー・川口課長・藤井部長の4名に方向性を提示。AI RAG Agentで技術文書50万件を検索可能にするデモを実施。手書き図面のOCR認識デモに川口課長が『こんなことができるのか』と驚き。藤井部長からは品質記録との連携要望。伊藤CTO室からも関心があるとの情報。" },
      { Subject: "CTO室との面談", ActivityDate: "2025-12-12", Type: "Meeting", Description: "伊藤氏（CTO室）と初面談。経営層の視点：①BCP対策としてクラウド移行は必須②AI技術は中長期戦略の柱③ベテラン退職問題は全社的課題で取締役会でも議題に。『段階的に成果を出しながら進めるアプローチが望ましい』。予算は経営判断で追加確保の可能性あり。" },
      { Subject: "PoC計画合意・対象データ選定", ActivityDate: "2026-01-15", Type: "Meeting", Description: "田中部長・高橋リーダーとPoC計画を合意。対象：門真工場の品質試験報告書5,000件＋製造手順書500件。2月に2週間のPoC実施。成功基準：検索精度90%以上、応答3秒以内、現場技術者5名の評価3.5/5.0以上。" },
      { Subject: "PoC実施・現場テスト", ActivityDate: "2026-02-03", Type: "Meeting", Description: "PoC環境を構築し、門真工場の技術者5名に2週間使ってもらう。初日のレクチャー後、日常業務で実際に使用。川口課長が『先週の不具合調査で使ったら、3時間かかっていた調査が15分で終わった。過去の類似事例と対策が一発で出てきた』と絶賛。" },
      { Subject: "PoC結果報告", ActivityDate: "2026-02-28", Type: "Meeting", Description: "田中部長・高橋リーダー・川口課長・藤井部長・伊藤氏（CTO室）に報告。検索精度94.3%、応答1.2秒、現場評価4.4/5.0。全員の合意でPoCは成功と判定。伊藤氏から『他工場にも横展開したい。まずは正式な提案書をいただきたい』。" },
      { Subject: "正式提案・見積もり提出", ActivityDate: "2026-03-08", Type: "Email", Description: "正式提案書を送付。Phase1（4-7月）：クラウド基盤＋門真工場AI検索 1,800万、Phase2（8-10月）：品質記録統合＋追加工場展開 1,200万、Phase3（11-1月）：ナレッジ動画連携 500万。合計3,500万。" },
      { Subject: "見積もり条件の交渉", ActivityDate: "2026-03-10", Type: "Meeting", Description: "田中部長と見積もり条件の交渉。『Phase1の金額はOKだが、Phase2以降は各フェーズ開始時に改めて判断したい』との要望。分割契約に対応可能と回答。来月の経営会議（4/10）で最終承認予定。伊藤氏が経営会議で推薦してくれるとのこと。" },
    ],
    contacts: [
      { Name: "田中 健二", Title: "情報システム部長（予算権限者）", Email: "tanaka.k@panasonic.example.com", Phone: "06-XXXX-3001" },
      { Name: "高橋 美咲", Title: "クラウド推進グループリーダー（窓口）", Email: "takahashi.m@panasonic.example.com", Phone: "06-XXXX-3002" },
      { Name: "伊藤 誠", Title: "CTO室（経営層スポンサー）", Email: "ito.m@panasonic.example.com", Phone: "06-XXXX-3003" },
      { Name: "川口 雄一", Title: "門真工場 製造技術課長（現場代表）", Email: "kawaguchi.y@panasonic.example.com", Phone: "06-XXXX-3004" },
      { Name: "藤井 正樹", Title: "品質保証部長", Email: "fujii.m@panasonic.example.com", Phone: "06-XXXX-3005" },
    ],
  },

  // ── 楽天：まだ初期段階、ニーズ把握中 ──
  "006Xx000001aB4f": {
    account: { Name: "楽天グループ株式会社", Industry: "EC・IT" },
    opportunity: {
      Name: "カスタマーサポートAI自動化",
      Amount: 8500000,
      StageName: "ニーズ把握",
      CloseDate: "2026-09-30",
      Description:
        "カスタマーサポートの問い合わせ対応をAIチャットボットで自動化。FAQ自動生成とナレッジベース構築により、オペレーターの負荷軽減と顧客満足度向上を目指す。楽天市場出店者向けサポートが主なターゲット。",
    },
    activities: [
      { Subject: "WebサイトからのInquiry対応", ActivityDate: "2026-01-20", Type: "Email", Description: "楽天の木村マネージャーから当社Webサイト経由で問い合わせ。『AI RAG Agentの出店者向けFAQ自動応答への活用可能性を知りたい』。資料送付と面談日程を調整。" },
      { Subject: "初回オンライン面談", ActivityDate: "2026-02-03", Type: "Meeting", Description: "木村マネージャーとWeb面談。現状：出店者からの問い合わせが月8,000件、うち50%がFAQで対応可能な内容。オペレーター30名体制だが人手不足で平均応答時間が15分→30分に悪化。既存のチャットボットはルールベースで精度が低い。AI RAG Agentでの改善に興味。" },
      { Subject: "現場オペレーターのヒアリング", ActivityDate: "2026-02-18", Type: "Meeting", Description: "木村マネージャーの仲介で、CSセンターの田島リーダーとオペレーター2名にオンラインヒアリング。よくある質問TOP10を共有いただく。『商品の返品ポリシー』『送料の計算方法』『アカウント設定変更』等。オペレーターの声：『同じ質問を何度も答えるのが辛い。AIが代わりに回答してくれるなら大歓迎』。" },
      { Subject: "電話：社内検討状況の確認", ActivityDate: "2026-03-04", Type: "Call", Description: "木村マネージャーと電話。社内でAIチャットボット刷新の予算を申請中。上長の承認が必要で、具体的なデモと期待効果のシミュレーションがあると通りやすいとのこと。デモ環境の準備を提案し合意。次回はFAQデータを使ったデモを実施予定。" },
      { Subject: "2回目訪問：デモ実施（予定）", ActivityDate: "2026-03-18", Type: "Meeting", Description: "FAQ 200件を使ったAI RAG Agentのデモを予定。木村マネージャー・田島リーダー・CS部門の上長（未定）が参加予定。" },
    ],
    contacts: [
      { Name: "木村 大輔", Title: "CS部門マネージャー（推進者）", Email: "kimura.d@rakuten.example.com", Phone: "050-XXXX-4001" },
      { Name: "田島 あかり", Title: "CSセンター リーダー（現場代表）", Email: "tajima.a@rakuten.example.com", Phone: "050-XXXX-4002" },
    ],
  },

  // ── 日立：技術ナレッジ継承、R&D部門主導 ──
  "006Xx000001aB5g": {
    account: { Name: "日立製作所", Industry: "製造業・IT" },
    opportunity: {
      Name: "社内ナレッジ検索AIシステム構築",
      Amount: 22000000,
      StageName: "提案中",
      CloseDate: "2026-07-31",
      Description:
        "研究開発部門の技術資料・特許文書・設計書をAI RAG Agentで横断検索できるシステムを構築。20年分の技術ナレッジの活用と、ベテラン技術者の暗黙知をデジタル化。Lumadaプラットフォームとの連携も視野。",
    },
    activities: [
      { Subject: "パートナー経由の紹介・初回面談", ActivityDate: "2025-10-25", Type: "Meeting", Description: "SIパートナーの木下氏から紹介を受け、渡辺副本部長と面談。R&D本部では20年分の技術報告書（約8万件）、特許文書（約1.2万件）、設計仕様書（約3万件）が蓄積。現在の検索はタイトルとキーワードのみで、中身まで検索できない。新プロジェクト開始時に先行研究調査に平均2週間かかっている。" },
      { Subject: "研究所訪問：研究者ヒアリング", ActivityDate: "2025-11-14", Type: "Meeting", Description: "中央研究所を訪問。中村氏と研究員3名にヒアリング。『同じ研究を知らずに二重でやっていたケースが年に数件ある』『他の研究グループの成果を知る手段がない』『特許調査で既存技術との差分を探すのに莫大な時間がかかる』。部門横断のナレッジ共有ニーズが非常に高い。" },
      { Subject: "知的財産部ヒアリング", ActivityDate: "2025-12-05", Type: "Meeting", Description: "知財部の小林課長と面談。特許出願前の先行技術調査で、社内特許DB＋外部DBの横断検索に1件あたり5日かかる。AIで社内技術報告書と特許を紐付けて検索できれば、調査工数を大幅削減可能。ただし特許文書の機密性が高く、外部クラウド利用に慎重な姿勢。" },
      { Subject: "電話：セキュリティ要件の事前確認", ActivityDate: "2025-12-18", Type: "Call", Description: "中村氏と電話でセキュリティ要件を確認。社内オンプレミス環境での運用が必須条件。外部へのデータ送信は不可。閉域網でのAIモデル運用が可能かが技術的な焦点。当社のオンプレミス対応版で対応可能と回答。" },
      { Subject: "技術検証：オンプレミスAI性能テスト", ActivityDate: "2026-01-20", Type: "Meeting", Description: "中村氏・IT部門の青木主任と技術検証。オンプレミス環境でのRAG Agent動作検証を実施。技術報告書500件をサンプルとして投入。検索精度91%、応答時間2.3秒。青木主任から『GPU サーバーのスペック要件と運用コストを明確にしてほしい』。" },
      { Subject: "渡辺副本部長への中間報告", ActivityDate: "2026-02-10", Type: "Meeting", Description: "渡辺副本部長・中村氏・小林課長に技術検証結果を報告。オンプレミス版の性能が十分であることを確認。渡辺副本部長から『2026年度中に全研究グループ（15グループ・研究員約300名）で使えるようにしたい。予算は2,000〜2,500万の範囲で調整可能。提案書をいただきたい』。" },
      { Subject: "要件定義ワークショップ", ActivityDate: "2026-02-18", Type: "Meeting", Description: "中村氏・青木主任・各研究グループの代表者5名とワークショップ。利用シナリオの優先順位を決定：①新プロジェクト開始時の先行研究調査②特許出願前の社内技術マッチング③研究成果の部門横断共有。UI要件：研究者がストレスなく使える自然文検索＋引用元表示。" },
      { Subject: "提案書・見積もり送付", ActivityDate: "2026-03-02", Type: "Email", Description: "正式提案書を送付。Phase1（4-7月）：オンプレミスAI基盤構築＋技術報告書8万件の取込 1,400万、Phase2（8-10月）：特許文書連携＋知財部向け機能 500万、Phase3（11-1月）：全研究グループ展開＋Lumada連携検討 300万。合計2,200万。" },
      { Subject: "電話：提案書へのフィードバック", ActivityDate: "2026-03-07", Type: "Call", Description: "中村氏から電話。提案内容は概ね良好だが、2点追加要望：①研究報告書のアップロード自動化（毎月の新規報告書を自動取込）②類似研究アラート機能（新しい報告書が登録された際、関連研究者に通知）。Phase1に含められるか確認してほしいとのこと。修正見積もりを準備中。" },
    ],
    contacts: [
      { Name: "渡辺 裕子", Title: "研究開発本部 副本部長（最終意思決定者）", Email: "watanabe.y@hitachi.example.com", Phone: "03-XXXX-5001" },
      { Name: "中村 洋平", Title: "ナレッジマネジメント推進室 室長（推進者・窓口）", Email: "nakamura.y@hitachi.example.com", Phone: "03-XXXX-5002" },
      { Name: "小林 直樹", Title: "知的財産部 課長", Email: "kobayashi.n@hitachi.example.com", Phone: "03-XXXX-5003" },
      { Name: "青木 修一", Title: "IT統括本部 主任（インフラ担当）", Email: "aoki.s@hitachi.example.com", Phone: "03-XXXX-5004" },
    ],
  },
};

// ── 分析結果 ──
export const MOCK_ANALYSIS_MAP: Record<string, AnalysisResult> = {
  "006Xx000001aB1c": {
    winProbability: 0.68,
    dealHealthScore: 72,
    activityScore: 78,
    engagementLevel: "高",
    proposalReadiness: 80,
    scenarios: {
      optimistic: {
        label: "楽観シナリオ",
        probability: 0.82,
        expectedRevenue: 52000000,
        timeline: "2026年6月末までに契約締結",
        conditions: ["経営層の最終承認が早期に得られる", "PoC結果が好評で追加要件なし", "競合他社の提案が不採用"],
      },
      base: {
        label: "基本シナリオ",
        probability: 0.68,
        expectedRevenue: 48000000,
        timeline: "2026年7月〜8月に契約、9月着手",
        conditions: ["技術検証の追加要請あり", "予算承認プロセスに2〜3週間", "一部スコープ調整の可能性"],
      },
      pessimistic: {
        label: "悲観シナリオ",
        probability: 0.35,
        expectedRevenue: 25000000,
        timeline: "2026年度下期に縮小版で開始",
        conditions: ["競合との価格競争が激化", "社内DX優先度が変更", "予算の大幅削減"],
      },
    },
    keyDrivers: [
      "経営層のDX推進への強いコミットメント",
      "既存業務の非効率さへの現場の危機感",
      "デモンストレーションでの好反応",
      "競合他社にない包括的ソリューション提案",
    ],
    riskFactors: [
      "大規模プロジェクトのため意思決定に時間がかかる可能性",
      "IT部門と業務部門の要件の齟齬",
      "年度予算の制約により段階導入の可能性",
    ],
    recommendedActions: [
      "経営層向けROI試算資料の作成・提出",
      "類似業界の導入事例（金融業界）の共有",
      "段階的導入プランの提示で予算リスクを軽減",
      "技術検証環境の早期提供で意思決定を加速",
    ],
    rationale: {
      customerChallenges: [
        "保険査定業務における紙ベースの非効率な業務プロセス",
        "代理店からの問い合わせ対応に膨大な時間を要している",
        "会議録の手動作成による情報共有の遅延",
        "全社的なDX推進戦略の具体的なロードマップが未整備",
      ],
      serviceRecommendations: [
        {
          service: "AI RAG Agent",
          relevance: "primary" as const,
          reason: "社内文書・マニュアルの横断検索と代理店向けFAQ自動生成に最適",
          features: ["PDF/Word文書の自動取り込み", "自然言語による質問応答", "回答根拠の明示", "多言語対応"],
        },
        {
          service: "書きあげクン",
          relevance: "primary" as const,
          reason: "会議録・商談記録の自動生成で情報共有を加速",
          features: ["リアルタイム文字起こし", "議事録自動フォーマット", "要約・アクション抽出", "クラウド共有"],
        },
        {
          service: "DX開発支援",
          relevance: "secondary" as const,
          reason: "既存業務プロセスの可視化と自動化基盤の構築",
          features: ["業務フロー分析", "RPA連携", "ダッシュボード構築", "API連携開発"],
        },
      ],
      combinedSolution:
        "AI RAG Agentによる社内ナレッジ検索基盤と書きあげクンによる会議録自動化を中心に、DX開発支援で業務プロセス全体の最適化を実現。段階的な導入により、早期にROIを可視化しながら全社展開を進めるアプローチを推奨。",
      existingProposalHints: [
        "金融業界向けセキュリティ要件への対応実績を強調",
        "保険業界の類似導入事例（査定業務AI化）を提示",
        "コスト削減効果の定量的な試算を含める",
      ],
    },
  },
};

// 他の商談ID用にはデフォルトのモック分析結果を使う
export function getMockAnalysis(oppId: string, sfData: SFData): AnalysisResult {
  if (MOCK_ANALYSIS_MAP[oppId]) return MOCK_ANALYSIS_MAP[oppId];
  const base = MOCK_ANALYSIS_MAP["006Xx000001aB1c"];
  return {
    ...base,
    rationale: {
      ...base.rationale,
      customerChallenges: [
        `${sfData.account.Name}における業務効率化の課題`,
        "既存システムの老朽化とデータサイロ化",
        "属人的な業務プロセスの標準化が急務",
      ],
      combinedSolution: `${sfData.account.Name}の課題に対し、AI RAG Agentとカスタム開発を組み合わせた包括的なDXソリューションを提案。`,
    },
  };
}

// ── ファイル読み込み用ダミーデータ ──
export const MOCK_FILE_DEALS: FileDealRecord[] = [
  {
    companyName: "株式会社NTTデータ",
    dealName: "データ分析基盤AI統合プロジェクト",
    amount: 28000000,
    stage: "提案中",
    closeDate: "2026-07-31",
    industry: "IT・通信",
    description: "既存のデータ分析基盤にAI推論エンジンを統合。社内データの自動分類・異常検知機能を追加し、経営判断の迅速化を支援。",
    contacts: "石川 雅人 / データサイエンス部長",
  },
  {
    companyName: "住友商事株式会社",
    dealName: "グローバル会議録AI翻訳・要約システム",
    amount: 15000000,
    stage: "見積提示",
    closeDate: "2026-06-15",
    industry: "総合商社",
    description: "海外拠点との会議を書きあげクンで文字起こしし、多言語翻訳と要約を自動化。年間500件以上の国際会議の議事録作成工数を80%削減。",
    contacts: "林 由美子 / グローバルIT推進室",
  },
  {
    companyName: "トヨタ自動車株式会社",
    dealName: "製造ライン品質管理AIナレッジシステム",
    amount: 42000000,
    stage: "交渉中",
    closeDate: "2026-09-30",
    industry: "自動車・製造業",
    description: "品質管理に関する過去20年分の不具合報告・是正処置をAI RAG Agentで検索可能にし、品質問題の早期発見と再発防止を支援。ベテラン品質管理者の退職に伴うナレッジ継承にも活用。",
    contacts: "松本 健太 / 品質保証部 部長",
  },
];
