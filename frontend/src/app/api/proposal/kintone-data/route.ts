import { NextRequest, NextResponse } from 'next/server';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>;

interface KintoneCredentials {
  subdomain: string;
  apiToken: string;
  appId: string;
}

// ── Kintone風モックデータ ──
const MOCK_KINTONE_RECORDS: R[] = [
  {
    $id: { value: 'KTN-1001' },
    案件名: { value: '基幹システムDX化プロジェクト' },
    会社名: { value: '株式会社セブン&アイ・ホールディングス' },
    金額: { value: '36000000' },
    ステージ: { value: '提案中' },
    完了予定日: { value: '2026-07-31' },
    業種: { value: '小売・流通' },
    概要: { value: '店舗業務のデジタル化を推進。POSデータ分析AI、在庫管理の自動化、本部-店舗間のナレッジ共有システムを構築。全国約21,000店舗の業務効率化が目標。現行の紙ベース報告書・FAX運用からの脱却が急務。' },
    確度: { value: '65' },
    ネクストステップ: { value: '4月中旬にPoC環境の構築・テスト開始' },
    担当者: { value: '高田 誠一' },
    担当者役職: { value: '情報システム部 部長' },
    担当者連絡先: { value: '03-XXXX-6001' },
    登録日時: { value: '2025-11-10T09:00:00Z' },
    更新日時: { value: '2026-03-08T14:30:00Z' },
    メモ: { value: '競合：A社（クラウドPOS）、B社（SIer）。当社はAI活用による差別化が鍵。' },
  },
  {
    $id: { value: 'KTN-1002' },
    案件名: { value: '社内FAQ AIチャットボット導入' },
    会社名: { value: '大和ハウス工業株式会社' },
    金額: { value: '9500000' },
    ステージ: { value: '見積提示' },
    完了予定日: { value: '2026-05-31' },
    業種: { value: '建設・不動産' },
    概要: { value: '総務・人事・経理への社内問い合わせをAI RAG Agentで自動応答化。月間約3,000件の社内問い合わせのうち70%をAIで対応し、バックオフィス要員の業務負荷を軽減。就業規則・社内制度のナレッジベース構築を含む。' },
    確度: { value: '78' },
    ネクストステップ: { value: '最終見積もりの承認待ち（部門長決裁）' },
    担当者: { value: '森本 直美' },
    担当者役職: { value: '経営企画部 課長' },
    登録日時: { value: '2025-12-20T10:00:00Z' },
    更新日時: { value: '2026-03-10T11:00:00Z' },
  },
  {
    $id: { value: 'KTN-1003' },
    案件名: { value: '製造現場ナレッジ継承AIシステム' },
    会社名: { value: 'ダイキン工業株式会社' },
    金額: { value: '28000000' },
    ステージ: { value: '交渉中' },
    完了予定日: { value: '2026-08-15' },
    業種: { value: '製造業' },
    概要: { value: 'ベテラン技術者の退職に備え、製造ノウハウ・保守マニュアル・品質記録をAI RAG Agentで横断検索可能にする。工場ラインの不具合対応手順書を瞬時に検索し、ダウンタイムを削減。書きあげクンで技術伝承の動画記録からテキスト化も実施。' },
    確度: { value: '72' },
    ネクストステップ: { value: '契約条件の最終調整（分割払い要望への対応）' },
    担当者: { value: '岡田 修平' },
    担当者役職: { value: '生産技術本部 副本部長' },
    登録日時: { value: '2025-10-05T09:00:00Z' },
    更新日時: { value: '2026-03-05T16:45:00Z' },
  },
  {
    $id: { value: 'KTN-1004' },
    案件名: { value: '営業会議録AI自動化サービス' },
    会社名: { value: '野村證券株式会社' },
    金額: { value: '14000000' },
    ステージ: { value: 'ニーズ把握' },
    完了予定日: { value: '2026-09-30' },
    業種: { value: '証券・金融' },
    概要: { value: '全国支店の営業会議・顧客商談の音声記録を書きあげクンで自動文字起こし・要約。コンプライアンス記録としての活用も視野に入れた包括的な導入検討。月間約800件の会議録作成工数を90%削減目標。' },
    確度: { value: '45' },
    ネクストステップ: { value: '情報セキュリティ部門との要件確認ミーティング（4月上旬）' },
    担当者: { value: '中島 健太' },
    担当者役職: { value: 'デジタル推進部 マネージャー' },
    登録日時: { value: '2026-01-15T13:00:00Z' },
    更新日時: { value: '2026-03-01T10:20:00Z' },
  },
  {
    $id: { value: 'KTN-1005' },
    案件名: { value: '物流最適化×AI分析基盤構築' },
    会社名: { value: 'ヤマトホールディングス株式会社' },
    金額: { value: '45000000' },
    ステージ: { value: '提案中' },
    完了予定日: { value: '2026-10-31' },
    業種: { value: '物流・運輸' },
    概要: { value: '配送ルート最適化と倉庫オペレーションの効率化にAIを活用。過去の配送データ・気象データ・交通データを統合分析し、配送効率を15%改善。DX開発サービスでカスタムダッシュボードとAPI連携基盤を構築。AI RAG Agentでドライバー向けFAQ対応も実施。' },
    確度: { value: '55' },
    ネクストステップ: { value: '技術検証結果の社内共有（経営戦略会議 4月中旬）' },
    担当者: { value: '吉川 真理' },
    担当者役職: { value: 'イノベーション推進部 部長' },
    登録日時: { value: '2025-09-20T09:00:00Z' },
    更新日時: { value: '2026-03-11T09:15:00Z' },
  },
];

// レコード別の詳細データ（活動履歴付き）
const MOCK_KINTONE_DETAIL: Record<string, R> = {
  'KTN-1001': {
    account: { Name: '株式会社セブン&アイ・ホールディングス', Industry: '小売・流通' },
    opportunity: {
      Id: 'KTN-1001', Name: '基幹システムDX化プロジェクト', Amount: 36000000, StageName: '提案中',
      CloseDate: '2026-07-31', Probability: 65,
      Description: '店舗業務のデジタル化を推進。POSデータ分析AI、在庫管理の自動化、本部-店舗間のナレッジ共有システムを構築。全国約21,000店舗の業務効率化が目標。',
      NextStep: '4月中旬にPoC環境の構築・テスト開始',
    },
    activities: [
      { Subject: '展示会での初回接触', ActivityDate: '2025-11-08', Type: 'Event', Description: 'リテールテックJAPANにて高田部長と名刺交換。店舗DXへの関心が高い。' },
      { Subject: '初回訪問：課題ヒアリング', ActivityDate: '2025-12-02', Type: 'Meeting', Description: '高田部長・山本課長と面談。現状：店舗報告書はFAXベース、本部への集約に3日。在庫確認は電話。' },
      { Subject: '電話：競合状況の確認', ActivityDate: '2025-12-20', Type: 'Call', Description: '山本課長より、大手SIerがクラウドPOS提案中だがAI活用の提案はまだないとの情報。' },
      { Subject: '2回目訪問：ソリューション方向性提示', ActivityDate: '2026-01-15', Type: 'Meeting', Description: '3つの方向性を提示：①AI RAG Agentで本部-店舗ナレッジ共有②POSデータ分析AI③在庫自動発注。' },
      { Subject: 'PoC計画合意', ActivityDate: '2026-02-05', Type: 'Meeting', Description: '都内10店舗でナレッジ共有システムのPoCを3週間実施することで合意。' },
      { Subject: 'PoC中間報告', ActivityDate: '2026-02-20', Type: 'Meeting', Description: 'PoC開始10日目。店舗スタッフの利用率85%、質問応答精度91%。好感触。' },
      { Subject: 'PoC最終報告', ActivityDate: '2026-03-05', Type: 'Meeting', Description: '高田部長・山本課長・店舗運営部の田村次長に報告。全店展開の正式提案を依頼された。' },
    ],
    contacts: [
      { Id: '1', LastName: '高田', FirstName: '誠一', Title: '情報システム部 部長（意思決定者）' },
      { Id: '2', LastName: '山本', FirstName: '真由美', Title: '情報システム部 課長（実務窓口）' },
      { Id: '3', LastName: '田村', FirstName: '浩二', Title: '店舗運営部 次長（利用部門代表）' },
    ],
  },
  'KTN-1002': {
    account: { Name: '大和ハウス工業株式会社', Industry: '建設・不動産' },
    opportunity: {
      Id: 'KTN-1002', Name: '社内FAQ AIチャットボット導入', Amount: 9500000, StageName: '見積提示',
      CloseDate: '2026-05-31', Probability: 78,
      Description: '総務・人事・経理への社内問い合わせをAI RAG Agentで自動応答化。月間約3,000件の社内問い合わせのうち70%をAIで対応。',
      NextStep: '最終見積もりの承認待ち（部門長決裁）',
    },
    activities: [
      { Subject: 'Webからの問い合わせ対応', ActivityDate: '2025-12-20', Type: 'Email', Description: '森本課長から当社サイト経由で問い合わせ。社内FAQ効率化に関心。' },
      { Subject: '初回オンライン面談', ActivityDate: '2026-01-08', Type: 'Meeting', Description: '森本課長と面談。月間3,000件の問い合わせ、うち2,100件が定型。対応に4名のフルタイム工数。' },
      { Subject: 'PoC実施：就業規則FAQ 300件', ActivityDate: '2026-02-01', Type: 'Meeting', Description: 'FAQ 300件でAI RAG Agentのデモ。正答率94%。「これなら社員も自分で調べてくれる」と好評。' },
      { Subject: '見積書・導入計画書の送付', ActivityDate: '2026-03-01', Type: 'Email', Description: '正式見積書を送付。年間ライセンス950万円（初期導入費込み）。部門長決裁待ち。' },
      { Subject: '電話：決裁状況の確認', ActivityDate: '2026-03-10', Type: 'Call', Description: '森本課長より、来週の経営会議で最終承認予定との報告。' },
    ],
    contacts: [
      { Id: '1', LastName: '森本', FirstName: '直美', Title: '経営企画部 課長（推進者・窓口）' },
      { Id: '2', LastName: '西田', FirstName: '大輔', Title: '総務部 部長（利用部門代表）' },
    ],
  },
  'KTN-1003': {
    account: { Name: 'ダイキン工業株式会社', Industry: '製造業' },
    opportunity: {
      Id: 'KTN-1003', Name: '製造現場ナレッジ継承AIシステム', Amount: 28000000, StageName: '交渉中',
      CloseDate: '2026-08-15', Probability: 72,
      Description: 'ベテラン技術者の退職に備え、製造ノウハウ・保守マニュアル・品質記録をAI RAG Agentで横断検索可能にする。書きあげクンで技術伝承の動画記録からテキスト化も実施。',
      NextStep: '契約条件の最終調整（分割払い要望への対応）',
    },
    activities: [
      { Subject: '紹介経由の初回面談', ActivityDate: '2025-10-05', Type: 'Meeting', Description: '岡田副本部長と面談。ベテラン技術者50名が2年以内に退職予定。ノウハウのデジタル化が急務。' },
      { Subject: '工場視察（堺製作所）', ActivityDate: '2025-11-12', Type: 'Meeting', Description: '製造現場を視察。不具合対応時にベテランに電話で聞く運用。マニュアルは棚に1,000冊以上。' },
      { Subject: 'PoC実施：保守マニュアル500件', ActivityDate: '2026-01-20', Type: 'Meeting', Description: 'AI RAG Agentで保守マニュアル500件を検索可能化。不具合キーワードから対応手順が即座に表示。' },
      { Subject: '書きあげクンデモ：技術者インタビュー録画', ActivityDate: '2026-02-10', Type: 'Meeting', Description: 'ベテラン技術者の口述をリアルタイム文字起こし。ノウハウがテキスト化されることに感動の声。' },
      { Subject: '提案書送付', ActivityDate: '2026-02-25', Type: 'Email', Description: 'Phase1:AI検索基盤1,600万 Phase2:書きあげクン連携700万 Phase3:全工場展開500万。合計2,800万。' },
      { Subject: '契約条件交渉', ActivityDate: '2026-03-05', Type: 'Meeting', Description: '岡田副本部長と条件交渉。分割払い（四半期ごと）の要望あり。対応可能と回答。来月最終決定予定。' },
    ],
    contacts: [
      { Id: '1', LastName: '岡田', FirstName: '修平', Title: '生産技術本部 副本部長（意思決定者）' },
      { Id: '2', LastName: '谷口', FirstName: '和也', Title: '堺製作所 製造部長（現場代表）' },
      { Id: '3', LastName: '小松', FirstName: '幸子', Title: '品質管理部 課長' },
    ],
  },
  'KTN-1004': {
    account: { Name: '野村證券株式会社', Industry: '証券・金融' },
    opportunity: {
      Id: 'KTN-1004', Name: '営業会議録AI自動化サービス', Amount: 14000000, StageName: 'ニーズ把握',
      CloseDate: '2026-09-30', Probability: 45,
      Description: '全国支店の営業会議・顧客商談の音声記録を書きあげクンで自動文字起こし・要約。コンプライアンス記録としての活用も視野。',
      NextStep: '情報セキュリティ部門との要件確認ミーティング（4月上旬）',
    },
    activities: [
      { Subject: '初回オンライン面談', ActivityDate: '2026-01-15', Type: 'Meeting', Description: '中島マネージャーと面談。月800件の会議録作成に延べ400時間。手動作成で品質ばらつき大。' },
      { Subject: 'コンプライアンス部門ヒアリング', ActivityDate: '2026-02-05', Type: 'Meeting', Description: '金融庁検査対応で正確な議事録が必須。現状の手動記録では不十分との認識。' },
      { Subject: '電話：予算策定の状況確認', ActivityDate: '2026-03-01', Type: 'Call', Description: '中島マネージャーより、2026年度IT予算に計上予定。セキュリティ審査が最大のハードル。' },
    ],
    contacts: [
      { Id: '1', LastName: '中島', FirstName: '健太', Title: 'デジタル推進部 マネージャー（推進者）' },
      { Id: '2', LastName: '安藤', FirstName: '理恵', Title: 'コンプライアンス部 課長' },
    ],
  },
  // KTN-1005: 意図的にデータ不足（Id なし、説明・金額・活動が不十分）
  'KTN-1005': {
    account: { Name: 'ヤマトホールディングス株式会社', Industry: '' },
    opportunity: {
      Name: '物流最適化×AI分析基盤構築', Amount: 0, StageName: '',
      CloseDate: '', Probability: 0,
      Description: '',
      NextStep: '',
    },
    activities: [],
    contacts: [],
  },
};

function getCredentials(body: R): KintoneCredentials {
  return {
    subdomain: body.credentials?.subdomain || process.env.KINTONE_SUBDOMAIN || '',
    apiToken: body.credentials?.apiToken || process.env.KINTONE_API_TOKEN || '',
    appId: body.credentials?.appId || process.env.KINTONE_APP_ID || '',
  };
}

function buildUrl(subdomain: string, path: string): string {
  return `https://${subdomain}.cybozu.com/k/v1/${path}`;
}

async function kintoneRequest(creds: KintoneCredentials, path: string): Promise<R> {
  const url = buildUrl(creds.subdomain, path);
  const res = await fetch(url, {
    headers: {
      'X-Cybozu-API-Token': creds.apiToken,
      'Content-Type': 'application/json',
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Kintone API error (${res.status}): ${text}`);
  }
  return res.json();
}

function getMockOpportunities() {
  return MOCK_KINTONE_RECORDS.map((r) => ({
    Id: r.$id.value,
    Name: r.案件名.value,
    Amount: parseFloat(r.金額.value) || 0,
    StageName: r.ステージ.value,
    CloseDate: r.完了予定日.value,
    AccountName: r.会社名.value,
  }));
}

function getMockDetail(recordId: string) {
  return MOCK_KINTONE_DETAIL[recordId] || null;
}

export async function GET() {
  const hasEnv = !!(process.env.KINTONE_SUBDOMAIN && process.env.KINTONE_API_TOKEN && process.env.KINTONE_APP_ID);
  return NextResponse.json({
    configured: hasEnv,
    subdomain: process.env.KINTONE_SUBDOMAIN || '',
    appId: process.env.KINTONE_APP_ID || '',
  });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const action: string = body.action;
    const creds = getCredentials(body);

    if (!creds.subdomain || !creds.apiToken || !creds.appId) {
      return NextResponse.json(
        { error: 'Kintoneの接続情報が不足しています。環境変数またはフォームで設定してください。' },
        { status: 400 },
      );
    }

    if (action === 'list') {
      // Try real Kintone API, fall back to mock
      try {
        const json = await kintoneRequest(creds, `records.json?app=${creds.appId}`);
        const records: R[] = json.records || [];
        const opportunities = records.slice(0, 50).map((r: R, i: number) => ({
          Id: r.$id?.value || String(i),
          Name: r['案件名']?.value || r['商談名']?.value || r['件名']?.value || `レコード ${i + 1}`,
          Amount: parseFloat(r['金額']?.value || r['予算']?.value || '0') || 0,
          StageName: r['ステージ']?.value || r['状況']?.value || r['フェーズ']?.value || '',
          CloseDate: r['完了予定日']?.value || r['期限']?.value || '',
          AccountName: r['会社名']?.value || r['顧客名']?.value || r['取引先']?.value || '',
        }));
        return NextResponse.json({ opportunities });
      } catch {
        // Kintone API unreachable — return mock data
        return NextResponse.json({ opportunities: getMockOpportunities() });
      }
    }

    if (action === 'fetch') {
      const recordId = body.recordId;
      if (!recordId) {
        return NextResponse.json({ error: 'recordId が必要です' }, { status: 400 });
      }

      // Try real Kintone API, fall back to mock
      try {
        const json = await kintoneRequest(creds, `record.json?app=${creds.appId}&id=${recordId}`);
        const r = json.record || {};
        const data = {
          account: {
            Name: r['会社名']?.value || r['顧客名']?.value || '不明',
            Industry: r['業種']?.value || r['業界']?.value || '',
            Description: r['会社概要']?.value || '',
          },
          opportunity: {
            Name: r['案件名']?.value || r['商談名']?.value || '不明',
            Amount: parseFloat(r['金額']?.value || r['予算']?.value || '0') || 0,
            StageName: r['ステージ']?.value || r['状況']?.value || '',
            CloseDate: r['完了予定日']?.value || r['期限']?.value || '',
            Description: r['概要']?.value || r['説明']?.value || r['メモ']?.value || '',
            Probability: parseFloat(r['確度']?.value || '0') || 0,
            NextStep: r['ネクストステップ']?.value || r['次のアクション']?.value || '',
          },
          activities: [],
          contacts: r['担当者']?.value ? [{ Id: '1', Name: r['担当者'].value, LastName: r['担当者'].value, Title: r['担当者役職']?.value || '' }] : [],
        };
        return NextResponse.json({ data });
      } catch {
        // Kintone API unreachable — return mock detail
        const mockDetail = getMockDetail(recordId);
        if (mockDetail) {
          return NextResponse.json({ data: mockDetail });
        }
        // recordId not in mock either — return first mock
        const firstDetail = Object.values(MOCK_KINTONE_DETAIL)[0];
        return NextResponse.json({ data: firstDetail });
      }
    }

    return NextResponse.json({ error: `不明なaction: ${action}` }, { status: 400 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : '不明なエラー';
    console.error('Kintone Data Error:', err);
    return NextResponse.json({ error: `Kintone接続エラー: ${message}` }, { status: 500 });
  }
}

export const runtime = 'nodejs';
