import { NextRequest, NextResponse } from 'next/server';
import jsforce from 'jsforce';

interface SFCredentials {
  username: string;
  password: string;
  securityToken: string;
  loginUrl: string;
}

// All SF objects we try to gather data from
const ALL_OBJECTS = [
  'Opportunity', 'Account', 'Contact', 'Lead',
  'Task', 'Event', 'Note', 'ContentNote',
  'FeedItem', 'Case', 'Contract', 'Quote',
  'OpportunityLineItem', 'Product2', 'CampaignMember',
  'EmailMessage',
];

/** OAuth2 client_credentials フロー（.envのAPIキーを使用） */
async function createConnectionWithApiKey() {
  const instanceUrl = process.env.SALESFORCE_INSTANCE_URL;
  const clientId = process.env.SALESFORCE_CLIENT_ID;
  const clientSecret = process.env.SALESFORCE_CLIENT_SECRET;

  if (!instanceUrl || !clientId || !clientSecret) {
    throw new Error('環境変数 SALESFORCE_INSTANCE_URL / SALESFORCE_CLIENT_ID / SALESFORCE_CLIENT_SECRET が設定されていません');
  }

  const tokenRes = await fetch(`${instanceUrl}/services/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: clientId,
      client_secret: clientSecret,
    }),
  });
  const tokenJson = await tokenRes.json();
  if (!tokenRes.ok || !tokenJson.access_token) {
    throw new Error(`Salesforce OAuth認証失敗: ${tokenJson.error_description || tokenJson.error || 'unknown'}`);
  }

  const conn = new jsforce.Connection({
    instanceUrl,
    accessToken: tokenJson.access_token,
  });
  return conn;
}

/** ユーザー名・パスワード認証 */
async function createConnection(creds: SFCredentials) {
  const conn = new jsforce.Connection({
    loginUrl: creds.loginUrl || 'https://login.salesforce.com',
  });
  await conn.login(creds.username, creds.password + (creds.securityToken || ''));
  return conn;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>;

/** Safely run a SOQL query; returns [] on failure */
async function safeQuery(conn: InstanceType<typeof jsforce.Connection>, soql: string): Promise<R[]> {
  try {
    const result = await conn.query<R>(soql);
    return result.records || [];
  } catch { return []; }
}

/** Check which objects are available */
async function checkAvailable(conn: InstanceType<typeof jsforce.Connection>): Promise<Set<string>> {
  const available = new Set<string>();
  await Promise.all(
    ALL_OBJECTS.map(async (obj) => {
      try { await conn.describe(obj); available.add(obj); } catch { /* skip */ }
    })
  );
  return available;
}

/** Gather all available data for an account-based record */
async function gatherFullData(conn: InstanceType<typeof jsforce.Connection>, available: Set<string>, primaryId: string, objType: string) {
  // 1. Primary record
  let primaryRecord: R = {};
  try { primaryRecord = await conn.sobject(objType).retrieve(primaryId) as R; } catch { /* */ }

  // Determine accountId
  const accountId: string = primaryRecord.AccountId || (objType === 'Account' ? primaryId : '');

  // 2. Account info
  let account: R = {};
  if (accountId && available.has('Account')) {
    try { account = await conn.sobject('Account').retrieve(accountId) as R; } catch { /* */ }
  }
  if (objType === 'Account') account = primaryRecord;
  if (objType === 'Lead') {
    account = {
      Name: primaryRecord.Company || '', Industry: primaryRecord.Industry || '',
      AnnualRevenue: primaryRecord.AnnualRevenue || 0,
      NumberOfEmployees: primaryRecord.NumberOfEmployees || 0,
      Website: primaryRecord.Website || '', BillingCity: primaryRecord.City || '',
      Description: primaryRecord.Description || '',
    };
  }

  // 3. Contacts
  let contacts: R[] = [];
  if (available.has('Contact') && accountId) {
    contacts = await safeQuery(conn,
      `SELECT Id, FirstName, LastName, Title, Email, Phone, Department, MailingCity
       FROM Contact WHERE AccountId = '${accountId}' ORDER BY LastModifiedDate DESC LIMIT 20`
    );
  }
  if (objType === 'Lead') {
    contacts = [{
      Id: primaryRecord.Id, FirstName: primaryRecord.FirstName || '',
      LastName: primaryRecord.LastName || '', Title: primaryRecord.Title || '',
      Email: primaryRecord.Email || '', Phone: primaryRecord.Phone || '',
      Department: '', MailingCity: primaryRecord.City || '',
    }];
  }

  // 4. Tasks (活動記録)
  let tasks: R[] = [];
  if (available.has('Task')) {
    const whereField = objType === 'Lead' ? 'WhoId' : 'WhatId';
    tasks = await safeQuery(conn,
      `SELECT Id, Subject, Description, ActivityDate, Status, Type, Priority, OwnerId
       FROM Task WHERE ${whereField} = '${primaryId}' ORDER BY ActivityDate DESC LIMIT 50`
    );
    // Also fetch account-level tasks if we have accountId
    if (accountId && objType !== 'Account' && objType !== 'Lead') {
      const accTasks = await safeQuery(conn,
        `SELECT Id, Subject, Description, ActivityDate, Status, Type, Priority, OwnerId
         FROM Task WHERE WhatId = '${accountId}' ORDER BY ActivityDate DESC LIMIT 20`
      );
      tasks = [...tasks, ...accTasks];
    }
  }

  // 5. Events (会議・訪問)
  let events: R[] = [];
  if (available.has('Event')) {
    const whereField = objType === 'Lead' ? 'WhoId' : 'WhatId';
    events = await safeQuery(conn,
      `SELECT Id, Subject, Description, StartDateTime, EndDateTime, Location, Type, ActivityDate
       FROM Event WHERE ${whereField} = '${primaryId}' ORDER BY StartDateTime DESC LIMIT 30`
    );
  }

  // 6. FeedItem (Chatter / 日報)
  let feedItems: R[] = [];
  if (available.has('FeedItem')) {
    feedItems = await safeQuery(conn,
      `SELECT Id, Body, Title, Type, CreatedDate, CreatedById
       FROM FeedItem WHERE ParentId = '${primaryId}' ORDER BY CreatedDate DESC LIMIT 30`
    );
    if (accountId && accountId !== primaryId) {
      const accFeed = await safeQuery(conn,
        `SELECT Id, Body, Title, Type, CreatedDate, CreatedById
         FROM FeedItem WHERE ParentId = '${accountId}' ORDER BY CreatedDate DESC LIMIT 20`
      );
      feedItems = [...feedItems, ...accFeed];
    }
  }

  // 7. Notes
  let notes: R[] = [];
  if (available.has('Note')) {
    notes = await safeQuery(conn,
      `SELECT Id, Title, Body, CreatedDate FROM Note WHERE ParentId = '${primaryId}' ORDER BY CreatedDate DESC LIMIT 20`
    );
    if (accountId && accountId !== primaryId) {
      const accNotes = await safeQuery(conn,
        `SELECT Id, Title, Body, CreatedDate FROM Note WHERE ParentId = '${accountId}' ORDER BY CreatedDate DESC LIMIT 10`
      );
      notes = [...notes, ...accNotes];
    }
  }

  // 8. Cases (問い合わせ)
  let cases: R[] = [];
  if (available.has('Case') && accountId) {
    cases = await safeQuery(conn,
      `SELECT Id, Subject, Description, Status, Priority, Type, CreatedDate, ClosedDate
       FROM Case WHERE AccountId = '${accountId}' ORDER BY CreatedDate DESC LIMIT 20`
    );
  }

  // 9. Contracts
  let contracts: R[] = [];
  if (available.has('Contract') && accountId) {
    contracts = await safeQuery(conn,
      `SELECT Id, ContractNumber, Status, StartDate, EndDate, ContractTerm
       FROM Contract WHERE AccountId = '${accountId}' ORDER BY StartDate DESC LIMIT 10`
    );
  }

  // 10. Quotes (見積)
  let quotes: R[] = [];
  if (available.has('Quote') && objType === 'Opportunity') {
    quotes = await safeQuery(conn,
      `SELECT Id, Name, TotalPrice, Status, ExpirationDate, Description
       FROM Quote WHERE OpportunityId = '${primaryId}' ORDER BY CreatedDate DESC LIMIT 10`
    );
  }

  // 11. Opportunity Products
  let lineItems: R[] = [];
  if (available.has('OpportunityLineItem') && objType === 'Opportunity') {
    lineItems = await safeQuery(conn,
      `SELECT Id, Name, Quantity, UnitPrice, TotalPrice, Description
       FROM OpportunityLineItem WHERE OpportunityId = '${primaryId}' LIMIT 30`
    );
  }

  // 12. Email Messages
  let emails: R[] = [];
  if (available.has('EmailMessage')) {
    emails = await safeQuery(conn,
      `SELECT Id, Subject, TextBody, FromAddress, ToAddress, MessageDate, Status
       FROM EmailMessage WHERE RelatedToId = '${primaryId}' ORDER BY MessageDate DESC LIMIT 20`
    );
  }

  // Build opportunity structure
  let opportunity: R;
  if (objType === 'Opportunity') {
    opportunity = {
      Id: primaryRecord.Id, Name: primaryRecord.Name || '', Amount: primaryRecord.Amount || 0,
      StageName: primaryRecord.StageName || '', CloseDate: primaryRecord.CloseDate || '',
      Probability: primaryRecord.Probability || 0, Description: primaryRecord.Description || '',
      LeadSource: primaryRecord.LeadSource || '', Type: primaryRecord.Type || '',
      CreatedDate: primaryRecord.CreatedDate || '', LastActivityDate: primaryRecord.LastActivityDate || '',
      NextStep: primaryRecord.NextStep || '', AccountId: primaryRecord.AccountId || '',
    };
  } else if (objType === 'Lead') {
    opportunity = {
      Id: primaryRecord.Id, Name: `${primaryRecord.Name || ''} - ${primaryRecord.Company || ''}`,
      Amount: 0, StageName: primaryRecord.Status || '', CloseDate: '', Probability: 0,
      Description: primaryRecord.Description || '', LeadSource: primaryRecord.LeadSource || '',
      Type: 'Lead', CreatedDate: primaryRecord.CreatedDate || '',
      LastActivityDate: '', NextStep: '', AccountId: '',
    };
  } else {
    opportunity = {
      Id: primaryRecord.Id, Name: (primaryRecord.Name as string) || '',
      Amount: (primaryRecord.AnnualRevenue as number) || 0,
      StageName: 'Prospecting', CloseDate: '', Probability: 20,
      Description: (primaryRecord.Description as string) || '', LeadSource: '',
      Type: 'Account', CreatedDate: (primaryRecord.CreatedDate as string) || '',
      LastActivityDate: '', NextStep: '', AccountId: primaryRecord.Id,
    };
  }

  return {
    account: {
      Id: account.Id || '', Name: account.Name || '', Industry: account.Industry || '',
      AnnualRevenue: account.AnnualRevenue || 0, NumberOfEmployees: account.NumberOfEmployees || 0,
      Website: account.Website || '', BillingCity: account.BillingCity || '',
      Description: account.Description || '',
    },
    opportunity,
    contacts: contacts.map(c => ({
      Id: c.Id, FirstName: c.FirstName || '', LastName: c.LastName || '',
      Title: c.Title || '', Email: c.Email || '', Phone: c.Phone || '',
      Department: c.Department || '', City: c.MailingCity || '',
    })),
    activities: tasks.map(a => ({
      Id: a.Id, Subject: a.Subject || '', Description: a.Description || '',
      ActivityDate: a.ActivityDate || '', Status: a.Status || '', Type: a.Type || '',
      Priority: a.Priority || '',
    })),
    events: events.map(e => ({
      Id: e.Id, Subject: e.Subject || '', Description: e.Description || '',
      StartDateTime: e.StartDateTime || '', EndDateTime: e.EndDateTime || '',
      Location: e.Location || '', Type: e.Type || '',
    })),
    feedItems: feedItems.map(f => ({
      Id: f.Id, Body: f.Body || '', Title: f.Title || '',
      Type: f.Type || '', CreatedDate: f.CreatedDate || '',
    })),
    notes: notes.map(n => ({
      Id: n.Id, Title: n.Title || '', Body: n.Body || '',
      CreatedDate: n.CreatedDate || '',
    })),
    cases: cases.map(c => ({
      Id: c.Id, Subject: c.Subject || '', Description: c.Description || '',
      Status: c.Status || '', Priority: c.Priority || '', Type: c.Type || '',
      CreatedDate: c.CreatedDate || '', ClosedDate: c.ClosedDate || '',
    })),
    contracts: contracts.map(c => ({
      Id: c.Id, ContractNumber: c.ContractNumber || '', Status: c.Status || '',
      StartDate: c.StartDate || '', EndDate: c.EndDate || '', ContractTerm: c.ContractTerm || 0,
    })),
    quotes: quotes.map(q => ({
      Id: q.Id, Name: q.Name || '', TotalPrice: q.TotalPrice || 0,
      Status: q.Status || '', ExpirationDate: q.ExpirationDate || '',
      Description: q.Description || '',
    })),
    lineItems: lineItems.map(l => ({
      Id: l.Id, Name: l.Name || '', Quantity: l.Quantity || 0,
      UnitPrice: l.UnitPrice || 0, TotalPrice: l.TotalPrice || 0,
      Description: l.Description || '',
    })),
    emails: emails.map(e => ({
      Id: e.Id, Subject: e.Subject || '', Body: (e.TextBody || '').slice(0, 500),
      From: e.FromAddress || '', To: e.ToAddress || '',
      Date: e.MessageDate || '',
    })),
    _meta: {
      objectType: objType,
      availableObjects: Array.from(available),
      fetchedAt: new Date().toISOString(),
    },
  };
}

export async function POST(req: NextRequest) {
  try {
    const { action, authMode, credentials, opportunityId, objectType: reqObjectType } = await req.json();

    let conn: InstanceType<typeof jsforce.Connection>;
    if (authMode === 'password') {
      if (!credentials?.username || !credentials?.password) {
        return NextResponse.json({ error: '認証情報が不足しています' }, { status: 400 });
      }
      conn = await createConnection(credentials);
    } else {
      // デフォルト: client_credentials（APIキー）
      conn = await createConnectionWithApiKey();
    }

    // Check which objects are available
    if (action === 'check') {
      const available = await checkAvailable(conn);
      return NextResponse.json({ available: Array.from(available) });
    }

    if (action === 'list') {
      const available = await checkAvailable(conn);

      if (available.has('Opportunity')) {
        const result = await conn.query<R>(
          `SELECT Id, Name, Amount, StageName, CloseDate, Account.Name
           FROM Opportunity WHERE IsClosed = false ORDER BY LastModifiedDate DESC LIMIT 50`
        );
        const opportunities = result.records.map((r: R) => ({
          Id: r.Id, Name: r.Name, Amount: (r.Amount as number) || 0,
          StageName: r.StageName || '', CloseDate: r.CloseDate || '',
          AccountName: r.Account?.Name || '', _type: 'Opportunity',
        }));
        return NextResponse.json({ opportunities, objectType: 'Opportunity', available: Array.from(available) });
      }

      if (available.has('Lead')) {
        const records = await safeQuery(conn,
          `SELECT Id, Name, Company, Status, LeadSource, CreatedDate
           FROM Lead WHERE IsConverted = false ORDER BY LastModifiedDate DESC LIMIT 50`
        );
        const opportunities = records.map((r: R) => ({
          Id: r.Id, Name: `${r.Name} - ${r.Company || ''}`, Amount: 0,
          StageName: (r.Status as string) || '', CloseDate: '',
          AccountName: (r.Company as string) || '', _type: 'Lead',
        }));
        return NextResponse.json({ opportunities, objectType: 'Lead', available: Array.from(available) });
      }

      if (available.has('Account')) {
        const records = await safeQuery(conn,
          `SELECT Id, Name, Industry, AnnualRevenue
           FROM Account ORDER BY LastModifiedDate DESC LIMIT 50`
        );
        const opportunities = records.map((r: R) => ({
          Id: r.Id, Name: r.Name, Amount: (r.AnnualRevenue as number) || 0,
          StageName: (r.Industry as string) || '', CloseDate: '',
          AccountName: '', _type: 'Account',
        }));
        return NextResponse.json({ opportunities, objectType: 'Account', available: Array.from(available) });
      }

      return NextResponse.json({ error: '利用可能なオブジェクトが見つかりません', available: Array.from(available) }, { status: 400 });
    }

    if (action === 'fetch') {
      if (!opportunityId) {
        return NextResponse.json({ error: 'IDが必要です' }, { status: 400 });
      }
      const objType: string = (reqObjectType as string) || 'Opportunity';
      const available = await checkAvailable(conn);
      const data = await gatherFullData(conn, available, opportunityId, objType);
      return NextResponse.json({ data });
    }

    return NextResponse.json({ error: '不正なアクション' }, { status: 400 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : '不明なエラー';
    if (message.includes('INVALID_LOGIN')) {
      return NextResponse.json({ error: 'Salesforceへのログインに失敗しました。認証情報を確認してください。' }, { status: 401 });
    }
    return NextResponse.json({ error: `Salesforce接続エラー: ${message}` }, { status: 500 });
  }
}
