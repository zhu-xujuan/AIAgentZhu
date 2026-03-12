import { NextRequest, NextResponse } from 'next/server';
import * as XLSX from 'xlsx';

interface DealRecord {
  companyName: string;
  dealName: string;
  amount: number;
  stage: string;
  closeDate: string;
  industry: string;
  description: string;
  contacts: string;
  [key: string]: unknown;
}

/** Map common Japanese/English header names to our standard fields */
function normalizeHeader(header: string): string {
  const h = header.trim().toLowerCase();
  const map: Record<string, string> = {
    // Company
    '会社名': 'companyName', '企業名': 'companyName', '顧客名': 'companyName',
    'company': 'companyName', 'company name': 'companyName', 'account': 'companyName',
    '取引先': 'companyName', 'アカウント': 'companyName',
    // Deal
    '案件名': 'dealName', '商談名': 'dealName', 'deal': 'dealName', 'deal name': 'dealName',
    'opportunity': 'dealName', 'opportunity name': 'dealName', '件名': 'dealName',
    // Amount
    '金額': 'amount', '予算': 'amount', 'amount': 'amount', '受注金額': 'amount',
    '見込み金額': 'amount', 'budget': 'amount',
    // Stage
    'ステージ': 'stage', 'フェーズ': 'stage', 'stage': 'stage', 'status': 'stage',
    '進捗': 'stage', '状況': 'stage',
    // Close date
    '完了予定日': 'closeDate', 'クローズ日': 'closeDate', 'close date': 'closeDate',
    '期限': 'closeDate', '締切': 'closeDate', '受注予定日': 'closeDate',
    // Industry
    '業種': 'industry', '業界': 'industry', 'industry': 'industry',
    // Description
    '概要': 'description', '説明': 'description', 'description': 'description',
    '備考': 'description', 'メモ': 'description', 'notes': 'description', 'note': 'description',
    '内容': 'description',
    // Contacts
    '担当者': 'contacts', '連絡先': 'contacts', 'contact': 'contacts', 'contacts': 'contacts',
  };
  return map[h] || header;
}

function parseCSV(text: string): Record<string, string>[] {
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) return [];

  // Simple CSV parser (handles quoted fields)
  function splitCSVLine(line: string): string[] {
    const result: string[] = [];
    let current = '';
    let inQuotes = false;
    for (const char of line) {
      if (char === '"') { inQuotes = !inQuotes; }
      else if (char === ',' && !inQuotes) { result.push(current.trim()); current = ''; }
      else { current += char; }
    }
    result.push(current.trim());
    return result;
  }

  const headers = splitCSVLine(lines[0]);
  const rows: Record<string, string>[] = [];
  for (let i = 1; i < lines.length; i++) {
    const values = splitCSVLine(lines[i]);
    const row: Record<string, string> = {};
    headers.forEach((h, j) => { row[h] = values[j] || ''; });
    rows.push(row);
  }
  return rows;
}

function rowsToDealRecords(rows: Record<string, string>[]): DealRecord[] {
  return rows.map((row, idx) => {
    const normalized: Record<string, string> = {};
    for (const [key, val] of Object.entries(row)) {
      const nKey = normalizeHeader(key);
      normalized[nKey] = String(val || '');
    }
    return {
      companyName: normalized.companyName || `企業${idx + 1}`,
      dealName: normalized.dealName || `案件${idx + 1}`,
      amount: parseFloat(normalized.amount?.replace(/[^\d.]/g, '') || '0') || 0,
      stage: normalized.stage || '不明',
      closeDate: normalized.closeDate || '',
      industry: normalized.industry || '',
      description: normalized.description || '',
      contacts: normalized.contacts || '',
    };
  });
}

function parseTXT(text: string): DealRecord[] {
  // Try to extract structured deal info from plain text
  // Return as single deal with description containing the full text
  const lines = text.split(/\r?\n/).filter(l => l.trim());

  // Try key-value extraction
  const kvPairs: Record<string, string> = {};
  for (const line of lines) {
    const match = line.match(/^[\s]*(.+?)[\s]*[:：][\s]*(.+)$/);
    if (match) {
      kvPairs[match[1].trim()] = match[2].trim();
    }
  }

  if (Object.keys(kvPairs).length >= 2) {
    const normalized: Record<string, string> = {};
    for (const [key, val] of Object.entries(kvPairs)) {
      normalized[normalizeHeader(key)] = val;
    }
    return [{
      companyName: normalized.companyName || '',
      dealName: normalized.dealName || '',
      amount: parseFloat(normalized.amount?.replace(/[^\d.]/g, '') || '0') || 0,
      stage: normalized.stage || '',
      closeDate: normalized.closeDate || '',
      industry: normalized.industry || '',
      description: normalized.description || text.slice(0, 3000),
      contacts: normalized.contacts || '',
    }];
  }

  // Fallback: treat whole text as a single deal description
  return [{
    companyName: '',
    dealName: '',
    amount: 0,
    stage: '',
    closeDate: '',
    industry: '',
    description: text.slice(0, 5000),
    contacts: '',
  }];
}

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get('file') as File | null;

    if (!file) {
      return NextResponse.json({ error: 'ファイルが選択されていません' }, { status: 400 });
    }

    const ext = file.name.split('.').pop()?.toLowerCase() || '';
    let deals: DealRecord[] = [];

    if (['xlsx', 'xls'].includes(ext)) {
      const buffer = Buffer.from(await file.arrayBuffer());
      const workbook = XLSX.read(buffer, { type: 'buffer' });
      const sheetName = workbook.SheetNames[0];
      const sheet = workbook.Sheets[sheetName];
      const rows = XLSX.utils.sheet_to_json<Record<string, string>>(sheet, { defval: '' });
      deals = rowsToDealRecords(rows.map(r => {
        const obj: Record<string, string> = {};
        for (const [k, v] of Object.entries(r)) obj[k] = String(v);
        return obj;
      }));
    } else if (ext === 'csv') {
      const text = await file.text();
      const rows = parseCSV(text);
      deals = rowsToDealRecords(rows);
    } else if (['txt', 'md'].includes(ext)) {
      const text = await file.text();
      deals = parseTXT(text);
    } else {
      return NextResponse.json({ error: `非対応のファイル形式: .${ext}` }, { status: 400 });
    }

    // Filter out completely empty records
    deals = deals.filter(d => d.companyName || d.dealName || d.description);

    return NextResponse.json({ deals, fileName: file.name });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : '不明なエラー';
    return NextResponse.json({ error: `ファイル解析エラー: ${message}` }, { status: 500 });
  }
}

export const runtime = 'nodejs';
