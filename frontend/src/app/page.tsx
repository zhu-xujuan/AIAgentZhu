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
} from 'lucide-react';

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
        <p className="text-xs font-medium text-foreground truncate flex-1">
          {file.name}
        </p>
        <span className="text-[10px] text-muted-foreground flex-shrink-0">
          {(file.size / 1024).toFixed(0)}KB
        </span>
      </div>

      <div className="h-1 w-full bg-secondary rounded-full overflow-hidden mb-1.5">
        <div
          className={cn('h-full transition-all duration-300 rounded-full', config.color)}
          style={{ width: `${progress}%` }}
        />
      </div>

      <p className="text-[11px]">
        {status === 'pending' && <span className="text-muted-foreground">Waiting...</span>}
        {status === 'uploading' && <span className="text-primary font-medium">{progress}%</span>}
        {status === 'completed' && (
          <span className="text-emerald-600">
            {result?.is_duplicate ? 'Exists' : `${result?.chunks_count} chunks`}
          </span>
        )}
        {status === 'error' && (
          <span className="text-destructive truncate block" title={error || undefined}>
            {error}
          </span>
        )}
      </p>
    </div>
  );
}

export default function UploadPage() {
  const [isDragging, setIsDragging] = useState(false);
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const {
    files,
    isUploading,
    completedCount,
    totalCount,
    addFiles,
    updateFileStatus,
    setFileResult,
    setFileError,
    removeFile,
    clearCompleted,
  } = useUpload();

  // Process upload queue
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
        const errorMessage = err instanceof Error ? err.message : 'Upload failed';
        setFileError(pendingFile.id, errorMessage);
      }
    };

    processQueue();
  }, [files, updateFileStatus, setFileResult, setFileError]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const droppedFiles = Array.from(e.dataTransfer.files);
    if (droppedFiles.length > 0) {
      addFiles(droppedFiles);
    }
  }, [addFiles]);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = e.target.files;
    if (selectedFiles && selectedFiles.length > 0) {
      addFiles(Array.from(selectedFiles));
    }
    e.target.value = '';
  }, [addFiles]);

  return (
    <div className="h-full flex gap-6">
      {/* Left Side - Uploaded Documents */}
      <div className="flex-1 flex flex-col min-h-0">
        <div className="flex items-center gap-2 mb-4">
          <h2 className="text-lg font-semibold text-foreground">Documents</h2>
        </div>
        <div className="flex-1 overflow-y-auto scrollbar-thin">
          <FileList refreshTrigger={refreshTrigger} />
        </div>
      </div>

      {/* Right Side - Upload Area */}
      <div className="w-96 flex flex-col min-h-0">
        <div className="flex items-center gap-2 mb-4">
          <Upload className="w-4 h-4 text-muted-foreground" />
          <h2 className="text-lg font-semibold text-foreground">Upload</h2>
        </div>

        {/* Drop Zone */}
        <div
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          className={cn(
            'border-2 border-dashed rounded-xl p-8 text-center transition-all flex-shrink-0',
            isDragging
              ? 'border-primary bg-primary/5 scale-[1.01]'
              : 'border-border hover:border-muted-foreground/30 bg-card'
          )}
        >
          <div className={cn(
            'mx-auto w-12 h-12 rounded-xl flex items-center justify-center mb-3 transition-colors',
            isDragging ? 'bg-primary/10' : 'bg-secondary'
          )}>
            <FileUp className={cn(
              'w-6 h-6 transition-colors',
              isDragging ? 'text-primary' : 'text-muted-foreground'
            )} />
          </div>
          <p className="text-sm text-muted-foreground mb-3">
            Drag files here or click to select
          </p>
          <label className="cursor-pointer">
            <span className="inline-flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors text-sm font-medium shadow-sm">
              <Upload className="w-4 h-4" />
              Select Files
            </span>
            <input
              type="file"
              className="hidden"
              onChange={handleFileSelect}
              accept=".txt,.csv,.json,.md,.pdf"
              multiple
            />
          </label>
          <p className="text-[11px] text-muted-foreground/70 mt-3">
            .txt, .csv, .json, .md, .pdf
          </p>
        </div>

        {/* Upload Progress */}
        {files.length > 0 && (
          <div className="mt-4 flex-1 flex flex-col min-h-0">
            <div className="flex items-center justify-between mb-3 flex-shrink-0">
              <h3 className="text-sm font-medium text-foreground">
                Progress {totalCount > 0 && `(${completedCount}/${totalCount})`}
              </h3>
              {completedCount > 0 && !isUploading && (
                <button
                  onClick={clearCompleted}
                  className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                >
                  Clear
                </button>
              )}
            </div>

            {/* Overall Progress Bar */}
            {totalCount > 0 && (
              <div className="mb-3 p-2.5 bg-primary/5 border border-primary/20 rounded-lg flex-shrink-0">
                <div className="flex items-center justify-between text-xs mb-1.5">
                  <span className="font-medium text-primary">Overall</span>
                  <span className="font-semibold text-primary">
                    {Math.round((completedCount / totalCount) * 100)}%
                  </span>
                </div>
                <div className="h-1.5 bg-primary/10 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-primary rounded-full transition-all duration-300"
                    style={{ width: `${(completedCount / totalCount) * 100}%` }}
                  />
                </div>
              </div>
            )}

            {/* File List */}
            <div className="space-y-2 overflow-y-auto flex-1 min-h-0 scrollbar-thin">
              {files.map((fileState) => (
                <div key={fileState.id} className="relative group">
                  <UploadProgress fileState={fileState} />
                  {(fileState.status === 'completed' || fileState.status === 'error') && (
                    <button
                      onClick={() => removeFile(fileState.id)}
                      className="absolute top-1.5 right-1.5 p-0.5 text-muted-foreground hover:text-foreground bg-card rounded-md opacity-0 group-hover:opacity-100 transition-opacity"
                      title="Remove"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
