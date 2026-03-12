'use client';

import { useState, useCallback, useEffect } from 'react';
import { ingestFile } from '@/lib/api';
import { useUpload, FileUploadState } from '@/context/UploadContext';
import FileList from '@/components/FileList';
import { cn } from '@/lib/utils';
import {
  Upload,
  CheckCircle2,
  XCircle,
  Loader2,
  Clock,
  X,
  FileUp,
  FolderOpen,
  Trash2,
  FileText,
  MessageCircle,
  FileBarChart,
  Pencil,
  Check,
  RefreshCw,
  AlertTriangle,
} from 'lucide-react';

interface TemplateFile {
  name: string;
  serviceName: string;
  size: number;
  modified: string;
}

interface DetectResult {
  fileName: string;
  serviceName: string;
  confidence: string;
  similarTo: string | null;
  similarityReason: string | null;
}

interface UploadConfirmItem {
  fileName: string;
  detectedService: string;
  confidence: string;
  similarTo: string | null;
  similarityReason: string | null;
  action: 'add' | 'replace';
  editingService: string;
}

type UploadTab = 'documents' | 'proposals';

function UploadProgress({ fileState }: { fileState: FileUploadState }) {
  const { status, progress, file, result, error } = fileState;
  const statusConfig = {
    pending: { color: 'bg-muted', icon: <Clock className="w-3.5 h-3.5 text-muted-foreground" /> },
    uploading: { color: 'bg-primary', icon: <Loader2 className="w-3.5 h-3.5 text-primary animate-spin" /> },
    completed: { color: 'bg-emerald-500', icon: <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" /> },
    error: { color: 'bg-destructive', icon: <XCircle className="w-3.5 h-3.5 text-destructive" /> },
  };
  const config = statusConfig[status];

  return (
    <div className="p-2.5 bg-card border border-border rounded-lg">
      <div className="flex items-center gap-2.5 mb-1.5">
        <div className="flex-shrink-0">{config.icon}</div>
        <p className="text-xs font-medium text-foreground truncate flex-1">{file.name}</p>
        <span className="text-[10px] text-muted-foreground flex-shrink-0">{(file.size / 1024).toFixed(0)}KB</span>
      </div>
      <div className="h-1 w-full bg-secondary rounded-full overflow-hidden mb-1.5">
        <div className={cn('h-full transition-all duration-300 rounded-full', config.color)} style={{ width: `${progress}%` }} />
      </div>
      <p className="text-[11px]">
        {status === 'pending' && <span className="text-muted-foreground">Waiting...</span>}
        {status === 'uploading' && <span className="text-primary font-medium">{progress}%</span>}
        {status === 'completed' && <span className="text-emerald-600">{result?.is_duplicate ? 'Exists' : `${result?.chunks_count} chunks`}</span>}
        {status === 'error' && <span className="text-destructive truncate block" title={error || undefined}>{error}</span>}
      </p>
    </div>
  );
}

export default function UploadPage() {
  const [activeTab, setActiveTab] = useState<UploadTab>('documents');
  const [isDragging, setIsDragging] = useState(false);
  const [refreshTrigger, setRefreshTrigger] = useState(0);

  // Proposal templates state
  const [templates, setTemplates] = useState<TemplateFile[]>([]);
  const [templateLoading, setTemplateLoading] = useState(false);
  const [templateUploading, setTemplateUploading] = useState(false);
  const [templateDragging, setTemplateDragging] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<string | null>(null);
  const [editServiceName, setEditServiceName] = useState('');
  const [replacingTemplate, setReplacingTemplate] = useState<string | null>(null);

  // Upload confirmation dialog
  const [showUploadConfirm, setShowUploadConfirm] = useState(false);
  const [uploadConfirmItems, setUploadConfirmItems] = useState<UploadConfirmItem[]>([]);
  const [detecting, setDetecting] = useState(false);

  const fetchTemplates = useCallback(async () => {
    setTemplateLoading(true);
    try {
      const res = await fetch('/api/proposal/templates');
      const json = await res.json();
      if (res.ok) setTemplates(json.templates || []);
    } catch { /* ignore */ }
    setTemplateLoading(false);
  }, []);

  useEffect(() => { fetchTemplates(); }, [fetchTemplates]);

  // Upload templates → detect service names → show confirmation if similar found
  const uploadTemplateFiles = useCallback(async (fileList: File[]) => {
    if (fileList.length === 0) return;
    setTemplateUploading(true);

    try {
      // 1. Upload files first
      const formData = new FormData();
      fileList.forEach(f => formData.append('files', f));
      const uploadRes = await fetch('/api/proposal/templates', { method: 'POST', body: formData });
      if (!uploadRes.ok) { setTemplateUploading(false); return; }
      const uploadJson = await uploadRes.json();
      const uploadedNames: string[] = (uploadJson.uploaded || []).map((u: { name: string }) => u.name);

      // 2. Detect service names via AI
      setDetecting(true);
      try {
        const detectRes = await fetch('/api/proposal/templates/detect', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ fileNames: uploadedNames }),
        });
        if (detectRes.ok) {
          const detectJson = await detectRes.json();
          const results: DetectResult[] = detectJson.results || [];

          const hasSimilar = results.some(r => r.similarTo);

          if (hasSimilar) {
            // Show confirmation dialog
            setUploadConfirmItems(results.map(r => ({
              fileName: r.fileName,
              detectedService: r.serviceName,
              confidence: r.confidence,
              similarTo: r.similarTo,
              similarityReason: r.similarityReason,
              action: 'add',
              editingService: r.serviceName,
            })));
            setShowUploadConfirm(true);
          } else {
            // No conflicts — auto-assign service names
            for (const r of results) {
              if (r.serviceName) {
                await fetch('/api/proposal/templates', {
                  method: 'PATCH',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ name: r.fileName, serviceName: r.serviceName }),
                });
              }
            }
            await fetchTemplates();
          }
        } else {
          await fetchTemplates();
        }
      } catch {
        await fetchTemplates();
      }
      setDetecting(false);
    } catch { /* ignore */ }
    setTemplateUploading(false);
  }, [fetchTemplates]);

  // Confirm upload dialog actions
  const handleConfirmUpload = useCallback(async () => {
    for (const item of uploadConfirmItems) {
      if (item.action === 'replace' && item.similarTo) {
        // Replace: delete old, assign service name
        await fetch('/api/proposal/templates', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: item.fileName, serviceName: item.editingService, replaceName: item.similarTo }),
        });
      } else {
        // Add as new
        await fetch('/api/proposal/templates', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: item.fileName, serviceName: item.editingService }),
        });
      }
    }
    setShowUploadConfirm(false);
    setUploadConfirmItems([]);
    await fetchTemplates();
  }, [uploadConfirmItems, fetchTemplates]);

  const handleTemplateUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = e.target.files;
    if (!selectedFiles || selectedFiles.length === 0) return;
    await uploadTemplateFiles(Array.from(selectedFiles));
    e.target.value = '';
  }, [uploadTemplateFiles]);

  const handleTemplateDelete = useCallback(async (name: string) => {
    try {
      const res = await fetch('/api/proposal/templates', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      if (res.ok) await fetchTemplates();
    } catch { /* ignore */ }
  }, [fetchTemplates]);

  const handleSaveServiceName = useCallback(async (name: string, serviceName: string) => {
    try {
      await fetch('/api/proposal/templates', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, serviceName }),
      });
      await fetchTemplates();
    } catch { /* ignore */ }
    setEditingTemplate(null);
  }, [fetchTemplates]);

  const handleReplaceFile = useCallback(async (templateName: string, e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    // Upload new file
    const formData = new FormData();
    formData.append('files', file);
    const res = await fetch('/api/proposal/templates', { method: 'POST', body: formData });
    if (res.ok) {
      const json = await res.json();
      const newName = json.uploaded?.[0]?.name;
      if (newName && newName !== templateName) {
        // Transfer service name from old to new, delete old
        await fetch('/api/proposal/templates', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: newName, replaceName: templateName }),
        });
      }
      await fetchTemplates();
    }
    setReplacingTemplate(null);
    e.target.value = '';
  }, [fetchTemplates]);

  const {
    files, isUploading, completedCount, totalCount,
    addFiles, updateFileStatus, setFileResult, setFileError, removeFile, clearCompleted,
  } = useUpload();

  useEffect(() => {
    const processQueue = async () => {
      const pendingFile = files.find((f) => f.status === 'pending');
      if (!pendingFile) return;
      const uploadingFile = files.find((f) => f.status === 'uploading');
      if (uploadingFile) return;
      updateFileStatus(pendingFile.id, 'uploading', 10);
      try {
        updateFileStatus(pendingFile.id, 'uploading', 30);
        const result = await ingestFile(pendingFile.file);
        updateFileStatus(pendingFile.id, 'uploading', 90);
        setFileResult(pendingFile.id, result);
        setRefreshTrigger((prev) => prev + 1);
      } catch (err) {
        setFileError(pendingFile.id, err instanceof Error ? err.message : 'Upload failed');
      }
    };
    processQueue();
  }, [files, updateFileStatus, setFileResult, setFileError]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    if (activeTab === 'documents') setIsDragging(true);
    else setTemplateDragging(true);
  }, [activeTab]);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    setTemplateDragging(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    setTemplateDragging(false);
    const droppedFiles = Array.from(e.dataTransfer.files);
    if (droppedFiles.length === 0) return;
    if (activeTab === 'documents') addFiles(droppedFiles);
    else uploadTemplateFiles(droppedFiles);
  }, [activeTab, addFiles, uploadTemplateFiles]);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = e.target.files;
    if (selectedFiles && selectedFiles.length > 0) addFiles(Array.from(selectedFiles));
    e.target.value = '';
  }, [addFiles]);

  return (
    <div className="h-full flex flex-col">
      {/* Upload Confirmation Dialog */}
      {showUploadConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="bg-card border border-border rounded-2xl shadow-xl p-6 max-w-lg w-full mx-4 max-h-[80vh] overflow-y-auto">
            <div className="flex items-start gap-3 mb-4">
              <AlertTriangle className="w-6 h-6 text-amber-500 shrink-0 mt-0.5" />
              <div>
                <h3 className="text-lg font-bold text-foreground">類似テンプレートが見つかりました</h3>
                <p className="text-sm text-muted-foreground mt-1">
                  アップロードしたファイルが既存テンプレートと似ています。入れ替えるか、別サービスとして追加するか選択してください。
                </p>
              </div>
              <button onClick={() => setShowUploadConfirm(false)} className="ml-auto p-1 text-muted-foreground hover:text-foreground">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-4 mb-5">
              {uploadConfirmItems.map((item, idx) => (
                <div key={idx} className="border border-border rounded-xl p-4 bg-muted/20">
                  <div className="text-sm font-bold text-foreground mb-1">{item.fileName}</div>
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-full">
                      AI判定: {item.detectedService || '不明'}
                    </span>
                    <span className={cn(
                      'text-xs px-2 py-0.5 rounded-full',
                      item.confidence === 'high' ? 'bg-green-100 text-green-700' :
                      item.confidence === 'medium' ? 'bg-amber-100 text-amber-700' : 'bg-muted text-muted-foreground'
                    )}>
                      確度: {item.confidence}
                    </span>
                  </div>

                  {item.similarTo && (
                    <div className="bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 rounded-lg p-3 mb-3 text-xs">
                      <p className="font-medium text-amber-800 dark:text-amber-300">
                        「{item.similarTo}」に似ています
                      </p>
                      {item.similarityReason && (
                        <p className="text-amber-600 dark:text-amber-400 mt-1">{item.similarityReason}</p>
                      )}
                    </div>
                  )}

                  {/* Service name edit */}
                  <div className="mb-3">
                    <label className="text-xs text-muted-foreground block mb-1">サービス名</label>
                    <input
                      type="text"
                      value={item.editingService}
                      onChange={(e) => setUploadConfirmItems(prev => prev.map((p, i) =>
                        i === idx ? { ...p, editingService: e.target.value } : p
                      ))}
                      className="w-full border border-border rounded-lg px-3 py-1.5 text-sm bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
                      placeholder="サービス名を入力"
                    />
                  </div>

                  {/* Action choice */}
                  {item.similarTo && (
                    <div className="flex gap-2">
                      <button
                        onClick={() => setUploadConfirmItems(prev => prev.map((p, i) =>
                          i === idx ? { ...p, action: 'replace' } : p
                        ))}
                        className={cn(
                          'flex-1 py-2 rounded-lg text-xs font-medium border-2 transition-colors',
                          item.action === 'replace'
                            ? 'border-primary bg-primary/10 text-primary'
                            : 'border-border text-muted-foreground hover:border-primary/40'
                        )}
                      >
                        「{item.similarTo}」を入れ替え
                      </button>
                      <button
                        onClick={() => setUploadConfirmItems(prev => prev.map((p, i) =>
                          i === idx ? { ...p, action: 'add' } : p
                        ))}
                        className={cn(
                          'flex-1 py-2 rounded-lg text-xs font-medium border-2 transition-colors',
                          item.action === 'add'
                            ? 'border-primary bg-primary/10 text-primary'
                            : 'border-border text-muted-foreground hover:border-primary/40'
                        )}
                      >
                        別テンプレートとして追加
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>

            <div className="flex gap-2">
              <button
                onClick={handleConfirmUpload}
                className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-bold bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
              >
                <Check className="w-4 h-4" /> 確定
              </button>
              <button
                onClick={() => setShowUploadConfirm(false)}
                className="px-4 py-3 border border-border text-muted-foreground rounded-xl text-sm font-medium hover:bg-accent transition-colors"
              >
                キャンセル
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="flex-1 flex gap-6 min-h-0">
        {/* Left Side */}
        <div className="flex-1 flex flex-col min-h-0">
          {/* Tab Switcher */}
          <div className="flex items-center gap-1 mb-4 bg-muted/50 rounded-lg p-1">
            <button
              onClick={() => setActiveTab('documents')}
              className={cn(
                'flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-md text-sm font-medium transition-all',
                activeTab === 'documents' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
              )}
            >
              <MessageCircle className="w-4 h-4" />
              Documents（Ask用）
            </button>
            <button
              onClick={() => setActiveTab('proposals')}
              className={cn(
                'flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-md text-sm font-medium transition-all',
                activeTab === 'proposals' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
              )}
            >
              <FileBarChart className="w-4 h-4" />
              提案書テンプレート
            </button>
          </div>

          {activeTab === 'documents' ? (
            <>
              <div className="flex items-center gap-2 mb-3">
                <h2 className="text-lg font-semibold text-foreground">Documents</h2>
                <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded-full">Ask Q&A用</span>
              </div>
              <p className="text-xs text-muted-foreground mb-3">RAG検索・AIチャットの参照資料として使用されます</p>
              <div className="flex-1 overflow-y-auto scrollbar-thin">
                <FileList refreshTrigger={refreshTrigger} />
              </div>
            </>
          ) : (
            <>
              <div className="flex items-center gap-2 mb-3">
                <FolderOpen className="w-5 h-5 text-muted-foreground" />
                <h2 className="text-lg font-semibold text-foreground">提案書テンプレート</h2>
                <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded-full">Proposal用</span>
                <span className="text-xs text-muted-foreground ml-auto">{templates.length}件</span>
              </div>
              <p className="text-xs text-muted-foreground mb-3">
                アップロード時にAIがサービス名を自動判定します。サービス名はクリックして変更できます。
              </p>

              {/* Template file list */}
              <div className="flex-1 overflow-y-auto scrollbar-thin">
                {templateLoading ? (
                  <div className="text-sm text-muted-foreground flex items-center gap-2 py-8 justify-center">
                    <Loader2 className="w-4 h-4 animate-spin" /> 読み込み中...
                  </div>
                ) : templates.length > 0 ? (
                  <div className="space-y-2">
                    {templates.map((t) => (
                      <div key={t.name} className="bg-card border border-border rounded-xl p-3 group hover:border-primary/30 transition-colors">
                        {/* Service name row */}
                        <div className="flex items-center gap-2 mb-1.5">
                          {editingTemplate === t.name ? (
                            <div className="flex items-center gap-1.5 flex-1">
                              <input
                                type="text"
                                value={editServiceName}
                                onChange={(e) => setEditServiceName(e.target.value)}
                                onKeyDown={(e) => { if (e.key === 'Enter') handleSaveServiceName(t.name, editServiceName); if (e.key === 'Escape') setEditingTemplate(null); }}
                                className="flex-1 border border-primary rounded px-2 py-0.5 text-sm bg-background text-foreground focus:outline-none"
                                autoFocus
                                placeholder="サービス名を入力"
                              />
                              <button onClick={() => handleSaveServiceName(t.name, editServiceName)} className="p-1 text-primary hover:bg-primary/10 rounded">
                                <Check className="w-3.5 h-3.5" />
                              </button>
                              <button onClick={() => setEditingTemplate(null)} className="p-1 text-muted-foreground hover:bg-muted rounded">
                                <X className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          ) : (
                            <>
                              {t.serviceName ? (
                                <span
                                  onClick={() => { setEditingTemplate(t.name); setEditServiceName(t.serviceName); }}
                                  className="text-sm font-bold text-primary cursor-pointer hover:underline"
                                  title="クリックしてサービス名を変更"
                                >
                                  {t.serviceName}
                                </span>
                              ) : (
                                <button
                                  onClick={() => { setEditingTemplate(t.name); setEditServiceName(''); }}
                                  className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded-full hover:bg-primary/10 hover:text-primary transition-colors"
                                >
                                  + サービス名を設定
                                </button>
                              )}
                              <button
                                onClick={() => { setEditingTemplate(t.name); setEditServiceName(t.serviceName || ''); }}
                                className="p-1 text-muted-foreground hover:text-primary opacity-0 group-hover:opacity-100 transition-opacity"
                                title="サービス名を編集"
                              >
                                <Pencil className="w-3 h-3" />
                              </button>
                            </>
                          )}
                        </div>

                        {/* File info row */}
                        <div className="flex items-center gap-2">
                          <FileText className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                          <p className="text-xs text-muted-foreground truncate flex-1" title={t.name}>{t.name}</p>
                          <span className="text-[10px] text-muted-foreground shrink-0">{(t.size / 1024).toFixed(0)}KB</span>

                          {/* Replace file */}
                          <label className="cursor-pointer p-1 text-muted-foreground hover:text-primary opacity-0 group-hover:opacity-100 transition-opacity" title="ファイルを入れ替え">
                            <RefreshCw className="w-3 h-3" />
                            <input type="file" className="hidden" accept=".txt,.md,.csv,.json,.pdf,.pptx,.docx"
                              onChange={(e) => handleReplaceFile(t.name, e)} />
                          </label>

                          {/* Delete */}
                          <button
                            onClick={() => handleTemplateDelete(t.name)}
                            className="p-1 text-muted-foreground hover:text-destructive opacity-0 group-hover:opacity-100 transition-opacity"
                            title="削除"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-12">
                    <FolderOpen className="w-10 h-10 text-muted-foreground/30 mx-auto mb-3" />
                    <p className="text-sm text-muted-foreground">テンプレートがまだありません</p>
                    <p className="text-xs text-muted-foreground/60 mt-1">右側のエリアからアップロードしてください</p>
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        {/* Right Side - Upload Area */}
        <div className="w-96 flex flex-col min-h-0">
          <div className="flex items-center gap-2 mb-4">
            <Upload className="w-4 h-4 text-muted-foreground" />
            <h2 className="text-lg font-semibold text-foreground">
              {activeTab === 'documents' ? 'Upload' : 'テンプレートUpload'}
            </h2>
          </div>

          {activeTab === 'documents' ? (
            <>
              <div
                onDragOver={handleDragOver} onDragLeave={handleDragLeave} onDrop={handleDrop}
                className={cn(
                  'border-2 border-dashed rounded-xl p-8 text-center transition-all flex-shrink-0',
                  isDragging ? 'border-primary bg-primary/5 scale-[1.01]' : 'border-border hover:border-muted-foreground/30 bg-card'
                )}
              >
                <div className={cn('mx-auto w-12 h-12 rounded-xl flex items-center justify-center mb-3 transition-colors', isDragging ? 'bg-primary/10' : 'bg-secondary')}>
                  <FileUp className={cn('w-6 h-6 transition-colors', isDragging ? 'text-primary' : 'text-muted-foreground')} />
                </div>
                <p className="text-sm text-muted-foreground mb-3">Drag files here or click to select</p>
                <label className="cursor-pointer">
                  <span className="inline-flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors text-sm font-medium shadow-sm">
                    <Upload className="w-4 h-4" /> Select Files
                  </span>
                  <input type="file" className="hidden" onChange={handleFileSelect} accept=".txt,.csv,.json,.md,.pdf" multiple />
                </label>
                <p className="text-[11px] text-muted-foreground/70 mt-3">.txt, .csv, .json, .md, .pdf</p>
              </div>

              {files.length > 0 && (
                <div className="mt-4 flex-1 flex flex-col min-h-0">
                  <div className="flex items-center justify-between mb-3 flex-shrink-0">
                    <h3 className="text-sm font-medium text-foreground">Progress {totalCount > 0 && `(${completedCount}/${totalCount})`}</h3>
                    {completedCount > 0 && !isUploading && (
                      <button onClick={clearCompleted} className="text-xs text-muted-foreground hover:text-foreground transition-colors">Clear</button>
                    )}
                  </div>
                  {totalCount > 0 && (
                    <div className="mb-3 p-2.5 bg-primary/5 border border-primary/20 rounded-lg flex-shrink-0">
                      <div className="flex items-center justify-between text-xs mb-1.5">
                        <span className="font-medium text-primary">Overall</span>
                        <span className="font-semibold text-primary">{Math.round((completedCount / totalCount) * 100)}%</span>
                      </div>
                      <div className="h-1.5 bg-primary/10 rounded-full overflow-hidden">
                        <div className="h-full bg-primary rounded-full transition-all duration-300" style={{ width: `${(completedCount / totalCount) * 100}%` }} />
                      </div>
                    </div>
                  )}
                  <div className="space-y-2 overflow-y-auto flex-1 min-h-0 scrollbar-thin">
                    {files.map((fileState) => (
                      <div key={fileState.id} className="relative group">
                        <UploadProgress fileState={fileState} />
                        {(fileState.status === 'completed' || fileState.status === 'error') && (
                          <button onClick={() => removeFile(fileState.id)} className="absolute top-1.5 right-1.5 p-0.5 text-muted-foreground hover:text-foreground bg-card rounded-md opacity-0 group-hover:opacity-100 transition-opacity" title="Remove">
                            <X className="w-3 h-3" />
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          ) : (
            <>
              <div
                onDragOver={handleDragOver} onDragLeave={handleDragLeave} onDrop={handleDrop}
                className={cn(
                  'border-2 border-dashed rounded-xl p-8 text-center transition-all flex-shrink-0',
                  templateDragging ? 'border-primary bg-primary/5 scale-[1.01]' : 'border-border hover:border-muted-foreground/30 bg-card'
                )}
              >
                <div className={cn('mx-auto w-12 h-12 rounded-xl flex items-center justify-center mb-3 transition-colors', templateDragging ? 'bg-primary/10' : 'bg-secondary')}>
                  <FolderOpen className={cn('w-6 h-6 transition-colors', templateDragging ? 'text-primary' : 'text-muted-foreground')} />
                </div>
                <p className="text-sm text-muted-foreground mb-1">提案書テンプレートをアップロード</p>
                <p className="text-xs text-muted-foreground/60 mb-3">AIがサービス名を自動判定します</p>
                <label className="cursor-pointer">
                  <span className={cn(
                    "inline-flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors text-sm font-medium shadow-sm",
                    (templateUploading || detecting) && "opacity-50 pointer-events-none"
                  )}>
                    {detecting ? (
                      <><Loader2 className="w-4 h-4 animate-spin" /> AI判定中...</>
                    ) : templateUploading ? (
                      <><Loader2 className="w-4 h-4 animate-spin" /> アップロード中...</>
                    ) : (
                      <><Upload className="w-4 h-4" /> ファイルを選択</>
                    )}
                  </span>
                  <input type="file" className="hidden" onChange={handleTemplateUpload} accept=".txt,.md,.csv,.json,.pdf,.pptx,.docx" multiple disabled={templateUploading || detecting} />
                </label>
                <p className="text-[11px] text-muted-foreground/70 mt-3">.txt, .md, .csv, .json, .pdf, .pptx, .docx</p>
              </div>

              <div className="mt-4 bg-muted/30 border border-border rounded-xl p-4">
                <h3 className="text-sm font-bold text-foreground mb-2">使い方</h3>
                <ol className="space-y-1.5 text-xs text-muted-foreground">
                  <li className="flex gap-2"><span className="font-bold text-primary shrink-0">1.</span><span>各サービスの既存提案書をここにアップロード</span></li>
                  <li className="flex gap-2"><span className="font-bold text-primary shrink-0">2.</span><span>AIがサービス名を自動判定（手動変更も可能）</span></li>
                  <li className="flex gap-2"><span className="font-bold text-primary shrink-0">3.</span><span>Proposalページで提案書生成時に自動参照</span></li>
                </ol>
                <p className="text-xs text-muted-foreground/60 mt-2">
                  テンプレートがないサービスはAIが新規設計します。
                </p>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
