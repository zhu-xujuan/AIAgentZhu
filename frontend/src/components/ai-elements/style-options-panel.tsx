'use client';

import { cn } from '@/lib/utils';
import { Palette } from 'lucide-react';
import { useState } from 'react';

export interface StyleOptions {
  industry?: string;
  profession?: string;
  ageGroup?: string;
  colorStyle?: string;
  font?: string;
}

// ============================================================
// Option definitions
// ============================================================

type CategoryDef = {
  key: keyof StyleOptions;
  label: string;
  options: string[];
  hasOther: boolean;
};

const CATEGORIES: CategoryDef[] = [
  {
    key: 'industry',
    label: '産業',
    options: [
      '流通・小売', '製造', '金融・保険', 'IT・通信', '医療・ヘルスケア',
      '教育', '不動産・建設', 'エネルギー', '政府・公共', 'エンタメ・メディア',
    ],
    hasOther: true,
  },
  {
    key: 'profession',
    label: '職種',
    options: [
      '人事', '営業', '経営企画', 'マーケティング', '管理・経理',
      '設計・開発', '研究・R&D', 'カスタマーサポート', 'コンサルティング',
    ],
    hasOther: true,
  },
  {
    key: 'ageGroup',
    label: '年代層',
    options: ['10代〜20代', '30代〜40代', '50代以上', '全年代'],
    hasOther: true,
  },
  {
    key: 'colorStyle',
    label: '色スタイル',
    options: ['ブルー', 'グリーン', 'ピンク', 'イエロー', 'パープル', 'レッド', 'モノクロ', 'ダーク'],
    hasOther: true,
  },
  {
    key: 'font',
    label: 'フォント',
    options: [
      'ゴシック体 (Noto Sans JP, Hiragino Sans)',
      '明朝体 (Noto Serif JP, Hiragino Mincho)',
      '丸ゴシック (Rounded Mplus 1c)',
      'モノスペース (Source Code Pro, Noto Sans Mono)',
    ],
    hasOther: false,
  },
];

// ============================================================
// Component
// ============================================================

interface StyleOptionsPanelProps {
  value: StyleOptions;
  onChange: (value: StyleOptions) => void;
  className?: string;
}

export function StyleOptionsPanel({ value, onChange, className }: StyleOptionsPanelProps) {
  const [expanded, setExpanded] = useState(false);
  // Track which categories have "その他" selected (by key)
  const [otherTexts, setOtherTexts] = useState<Record<string, string>>({});

  const hasValues = !!(value.industry || value.profession || value.ageGroup || value.colorStyle || value.font);

  const isOtherSelected = (cat: CategoryDef): boolean => {
    const v = value[cat.key];
    if (!v) return false;
    return !cat.options.includes(v);
  };

  const handleSelect = (cat: CategoryDef, option: string) => {
    const current = value[cat.key];
    // Toggle off if already selected
    if (current === option) {
      onChange({ ...value, [cat.key]: undefined });
    } else {
      onChange({ ...value, [cat.key]: option });
    }
  };

  const handleOtherToggle = (cat: CategoryDef) => {
    if (isOtherSelected(cat)) {
      // Deselect other
      onChange({ ...value, [cat.key]: undefined });
    } else {
      // Select other with existing text or empty
      const text = otherTexts[cat.key] || '';
      onChange({ ...value, [cat.key]: text || undefined });
    }
  };

  const handleOtherTextChange = (cat: CategoryDef, text: string) => {
    setOtherTexts((prev) => ({ ...prev, [cat.key]: text }));
    onChange({ ...value, [cat.key]: text || undefined });
  };

  return (
    <div className={cn('', className)}>
      <button
        onClick={() => setExpanded(!expanded)}
        className={cn(
          'inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-lg transition-colors',
          hasValues
            ? 'bg-violet-100 text-violet-700 border border-violet-300'
            : 'bg-secondary text-muted-foreground hover:text-foreground',
        )}
      >
        <Palette className="w-3.5 h-3.5" />
        スタイル
        {hasValues && <span className="w-1.5 h-1.5 rounded-full bg-violet-500" />}
      </button>

      {expanded && (
        <div className="mt-2 p-3 bg-secondary/30 border border-border/50 rounded-lg space-y-3 animate-fade-in">
          {CATEGORIES.map((cat) => {
            const selected = value[cat.key];
            const otherActive = isOtherSelected(cat);

            return (
              <div key={cat.key} className="space-y-1">
                <span className="text-[10px] text-muted-foreground font-medium">{cat.label}</span>
                <div className="flex flex-wrap gap-1.5 items-center">
                  {cat.options.map((opt) => (
                    <button
                      key={opt}
                      onClick={() => handleSelect(cat, opt)}
                      className={cn(
                        'px-2 py-0.5 text-[11px] rounded-md border transition-colors whitespace-nowrap',
                        selected === opt
                          ? 'bg-violet-100 text-violet-700 border-violet-300 font-medium'
                          : 'bg-card text-muted-foreground border-border hover:border-violet-200 hover:text-foreground',
                      )}
                    >
                      {opt}
                    </button>
                  ))}
                  {cat.hasOther && (
                    <>
                      <button
                        onClick={() => handleOtherToggle(cat)}
                        className={cn(
                          'px-2 py-0.5 text-[11px] rounded-md border transition-colors whitespace-nowrap',
                          otherActive
                            ? 'bg-violet-100 text-violet-700 border-violet-300 font-medium'
                            : 'bg-card text-muted-foreground border-border hover:border-violet-200 hover:text-foreground',
                        )}
                      >
                        その他
                      </button>
                      <input
                        type="text"
                        disabled={!otherActive}
                        value={otherActive ? (otherTexts[cat.key] ?? selected ?? '') : ''}
                        onChange={(e) => handleOtherTextChange(cat, e.target.value)}
                        placeholder="入力..."
                        className={cn(
                          'w-24 px-1.5 py-0.5 text-[11px] border rounded-md transition-colors',
                          otherActive
                            ? 'bg-card border-violet-300 text-foreground focus:outline-none focus:ring-1 focus:ring-violet-400'
                            : 'bg-secondary/50 border-border text-muted-foreground/40 cursor-not-allowed',
                        )}
                      />
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
