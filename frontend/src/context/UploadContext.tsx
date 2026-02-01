'use client';

import { createContext, useContext, useState, ReactNode } from 'react';
import { IngestResult } from '@/lib/api';

export type UploadStatus = 'pending' | 'uploading' | 'completed' | 'error';

export interface FileUploadState {
  id: string;
  file: File;
  status: UploadStatus;
  progress: number;
  result: IngestResult | null;
  error: string | null;
}

interface UploadContextType {
  files: FileUploadState[];
  isUploading: boolean;
  completedCount: number;
  totalCount: number;
  addFiles: (files: File[]) => void;
  updateFileStatus: (id: string, status: UploadStatus, progress?: number) => void;
  setFileResult: (id: string, result: IngestResult) => void;
  setFileError: (id: string, error: string) => void;
  removeFile: (id: string) => void;
  clearCompleted: () => void;
  clearAll: () => void;
}

const UploadContext = createContext<UploadContextType | undefined>(undefined);

let fileIdCounter = 0;
const generateFileId = () => `file-${++fileIdCounter}-${Date.now()}`;

export function UploadProvider({ children }: { children: ReactNode }) {
  const [files, setFiles] = useState<FileUploadState[]>([]);

  const isUploading = files.some((f) => f.status === 'uploading' || f.status === 'pending');
  const completedCount = files.filter((f) => f.status === 'completed').length;
  const totalCount = files.length;

  const addFiles = (newFiles: File[]) => {
    const fileStates: FileUploadState[] = newFiles.map((file) => ({
      id: generateFileId(),
      file,
      status: 'pending' as UploadStatus,
      progress: 0,
      result: null,
      error: null,
    }));
    setFiles((prev) => [...prev, ...fileStates]);
  };

  const updateFileStatus = (id: string, status: UploadStatus, progress = 0) => {
    setFiles((prev) =>
      prev.map((f) =>
        f.id === id ? { ...f, status, progress } : f
      )
    );
  };

  const setFileResult = (id: string, result: IngestResult) => {
    setFiles((prev) =>
      prev.map((f) =>
        f.id === id ? { ...f, status: 'completed' as UploadStatus, progress: 100, result } : f
      )
    );
  };

  const setFileError = (id: string, error: string) => {
    setFiles((prev) =>
      prev.map((f) =>
        f.id === id ? { ...f, status: 'error' as UploadStatus, error } : f
      )
    );
  };

  const removeFile = (id: string) => {
    setFiles((prev) => prev.filter((f) => f.id !== id));
  };

  const clearCompleted = () => {
    setFiles((prev) => prev.filter((f) => f.status !== 'completed'));
  };

  const clearAll = () => {
    setFiles([]);
  };

  return (
    <UploadContext.Provider
      value={{
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
        clearAll,
      }}
    >
      {children}
    </UploadContext.Provider>
  );
}

export function useUpload() {
  const context = useContext(UploadContext);
  if (context === undefined) {
    throw new Error('useUpload must be used within an UploadProvider');
  }
  return context;
}
