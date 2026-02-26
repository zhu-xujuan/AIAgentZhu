'use client';

import { cn } from '@/lib/utils';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  fetchSlideTemplates,
  saveSlideTemplate,
  deleteSlideTemplate,
  type SlideTemplate,
} from '@/lib/api';
import { Eye, Image, Loader2, Trash2, Upload, X } from 'lucide-react';

// ============================================================
// Helpers
// ============================================================

const IMAGE_EXTENSIONS = /\.(png|jpe?g)$/i;

/** Read a File as a base64 data-URL string. */
function readFileAsDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

/** Wrap a base64 image data-URL in a 1280x720 HTML slide template using <img> tag. */
function imageToHtmlTemplate(dataUrl: string): string {
  return `<div data-image-template="true" style="width:1280px;height:720px;position:relative;overflow:hidden;">
  <img src="${dataUrl}" style="position:absolute;top:0;left:0;width:100%;height:100%;object-fit:cover;z-index:0;pointer-events:none;" />
</div>`;
}

// ============================================================
// Types
// ============================================================

interface TemplateManagerProps {
  open: boolean;
  onClose: () => void;
}

type Position = 'first' | 'middle' | 'last';

const POSITIONS: { value: Position; label: string }[] = [
  { value: 'first', label: '1ページ目' },
  { value: 'middle', label: '途中ページ' },
  { value: 'last', label: '最終ページ' },
];

// ============================================================
// Component
// ============================================================

export function TemplateManager({ open, onClose }: TemplateManagerProps) {
  const [templates, setTemplates] = useState<SlideTemplate[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState<Position | null>(null);
  const [preview, setPreview] = useState<SlideTemplate | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [targetPosition, setTargetPosition] = useState<Position>('first');

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const items = await fetchSlideTemplates();
      setTemplates(items);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) refresh();
  }, [open, refresh]);

  const handleUploadClick = (position: Position) => {
    setTargetPosition(position);
    fileInputRef.current?.click();
  };

  const handleFileChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      setUploading(targetPosition);

      try {
        const isImage = IMAGE_EXTENSIONS.test(file.name);
        let htmlText: string;
        let headerColor: string | undefined;
        let footerColor: string | undefined;
        let templateName: string;

        if (isImage) {
          // --- Image file: convert to HTML wrapper with background-image ---
          const dataUrl = await readFileAsDataURL(file);
          htmlText = imageToHtmlTemplate(dataUrl);
          templateName = file.name.replace(/\.(png|jpe?g)$/i, '');
          // No header/footer color extraction for images (background is the image itself)
        } else {
          // --- HTML file: existing logic ---
          htmlText = await file.text();
          templateName = file.name.replace(/\.html?$/i, '');

          // Simple color detection: find first non-white background color
          const bgColorMatch = htmlText.match(/background(?:-color)?:\s*(#[0-9a-fA-F]{3,8}|rgb[^)]+\))/g);
          if (bgColorMatch) {
            const nonWhite = bgColorMatch.filter(
              (c) => !c.includes('#fff') && !c.includes('#FFF') && !c.includes('#ffffff') && !c.includes('#FFFFFF'),
            );
            if (nonWhite.length >= 1) headerColor = nonWhite[0].replace(/background(?:-color)?:\s*/, '');
            if (nonWhite.length >= 2) footerColor = nonWhite[nonWhite.length - 1].replace(/background(?:-color)?:\s*/, '');
          }
        }

        await saveSlideTemplate({
          name: templateName,
          position: targetPosition,
          html: htmlText,
          header_color: headerColor,
          footer_color: footerColor,
        });

        await refresh();
      } catch {
        // ignore
      } finally {
        setUploading(null);
        if (fileInputRef.current) fileInputRef.current.value = '';
      }
    },
    [targetPosition, refresh],
  );

  const handleDelete = useCallback(
    async (id: number) => {
      try {
        await deleteSlideTemplate(id);
        await refresh();
        if (preview?.id === id) setPreview(null);
      } catch {
        // ignore
      }
    },
    [refresh, preview],
  );

  if (!open) return null;

  const getTemplateForPosition = (pos: Position) =>
    templates.find((t) => t.position === pos);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-fade-in">
      <div className="relative w-full max-w-2xl mx-4 bg-card rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[80vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-border flex-shrink-0">
          <h2 className="text-base font-semibold text-foreground">テンプレート管理</h2>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary/50 transition-colors"
          >
            <X className="w-4.5 h-4.5" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 min-h-0 overflow-auto p-5 space-y-4">
          {loading && (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-6 h-6 text-muted-foreground animate-spin" />
            </div>
          )}

          {!loading &&
            POSITIONS.map(({ value: pos, label }) => {
              const tpl = getTemplateForPosition(pos);
              return (
                <div key={pos} className="flex items-center gap-3 p-3 border border-border/50 rounded-lg">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground">{label}</p>
                    {tpl ? (
                      <p className="text-xs text-muted-foreground truncate flex items-center gap-1.5">
                        {tpl.html?.includes('data-image-template="true"') ? (
                          <Image className="w-3 h-3 text-violet-500 flex-shrink-0" />
                        ) : null}
                        <span className="truncate">{tpl.name}</span>
                        {tpl.header_color && (
                          <span
                            className="inline-block w-3 h-3 rounded-sm flex-shrink-0 border border-border"
                            style={{ backgroundColor: tpl.header_color }}
                          />
                        )}
                      </p>
                    ) : (
                      <p className="text-xs text-muted-foreground">未設定</p>
                    )}
                  </div>

                  <div className="flex items-center gap-1.5">
                    {tpl && (
                      <>
                        <button
                          onClick={() => setPreview(tpl)}
                          className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary/50 transition-colors"
                          title="プレビュー"
                        >
                          <Eye className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => handleDelete(tpl.id)}
                          className="p-1.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                          title="削除"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </>
                    )}
                    <button
                      onClick={() => handleUploadClick(pos)}
                      disabled={uploading === pos}
                      className={cn(
                        'inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg transition-colors',
                        tpl
                          ? 'bg-secondary text-foreground hover:bg-secondary/80'
                          : 'bg-teal-500 text-white hover:bg-teal-600',
                        uploading === pos && 'opacity-50',
                      )}
                    >
                      {uploading === pos ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Upload className="w-3.5 h-3.5" />
                      )}
                      {tpl ? '変更' : 'アップロード'}
                    </button>
                  </div>
                </div>
              );
            })}

          <p className="text-[10px] text-muted-foreground text-center">
            HTML (.html) または 画像 (.png, .jpg) をアップロードできます
          </p>

          {/* Hidden file input */}
          <input
            ref={fileInputRef}
            type="file"
            accept=".html,.htm,.png,.jpg,.jpeg"
            className="hidden"
            onChange={handleFileChange}
          />
        </div>

        {/* Preview overlay */}
        {preview && (
          <div className="absolute inset-0 bg-card/95 flex flex-col z-10">
            <div className="flex items-center justify-between px-5 py-3 border-b border-border flex-shrink-0">
              <h3 className="text-sm font-semibold text-foreground">
                プレビュー: {preview.name} ({preview.position})
              </h3>
              <button
                onClick={() => setPreview(null)}
                className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary/50 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="flex-1 min-h-0 overflow-auto p-4 flex items-center justify-center">
              <div
                className="rounded-lg shadow-lg border border-border overflow-hidden"
                style={{ width: 640, height: 360 }}
              >
                <div
                  style={{
                    transform: 'scale(0.5)',
                    transformOrigin: 'top left',
                    width: 1280,
                    height: 720,
                    overflow: 'hidden',
                    pointerEvents: 'none',
                  }}
                  dangerouslySetInnerHTML={{ __html: preview.html }}
                />
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
