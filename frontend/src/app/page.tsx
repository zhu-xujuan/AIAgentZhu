'use client';

import { useState, useCallback, useEffect } from 'react';
import { ingestFile } from '@/lib/api';
import { useUpload, FileUploadState } from '@/context/UploadContext';
import FileList from '@/components/FileList';

function UploadProgress({ fileState }: { fileState: FileUploadState }) {
  const { status, progress, file, result, error } = fileState;

  const statusColors = {
    pending: 'bg-gray-200',
    uploading: 'bg-blue-500',
    completed: 'bg-green-500',
    error: 'bg-red-500',
  };

  return (
    <div className="flex items-center gap-3 p-3 bg-white border rounded-lg">
      {/* Status Icon */}
      <div className="flex-shrink-0">
        {status === 'uploading' && (
          <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-blue-500"></div>
        )}
        {status === 'pending' && (
          <div className="h-5 w-5 rounded-full border-2 border-gray-300"></div>
        )}
        {status === 'completed' && (
          <svg className="h-5 w-5 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        )}
        {status === 'error' && (
          <svg className="h-5 w-5 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        )}
      </div>

      {/* File Info */}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-gray-900 truncate">{file.name}</p>
        <div className="mt-1">
          {/* Progress Bar */}
          <div className="h-1.5 w-full bg-gray-100 rounded-full overflow-hidden">
            <div
              className={`h-full transition-all duration-300 ${statusColors[status]}`}
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
        {/* Status Text */}
        <p className="mt-1 text-xs text-gray-500">
          {status === 'pending' && 'Waiting...'}
          {status === 'uploading' && `Processing... ${progress}%`}
          {status === 'completed' && (
            <span className="text-green-600">
              {result?.is_duplicate ? 'Already exists' : `Done - ${result?.chunks_count} chunks`}
            </span>
          )}
          {status === 'error' && <span className="text-red-600">{error}</span>}
        </p>
      </div>

      {/* File Size */}
      <div className="flex-shrink-0 text-xs text-gray-400">
        {(file.size / 1024).toFixed(1)} KB
      </div>
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
      if (!pendingFile) {
        console.log('[UploadQueue] No pending files in queue');
        return;
      }

      const uploadingFile = files.find((f) => f.status === 'uploading');
      if (uploadingFile) {
        console.log('[UploadQueue] Already uploading:', uploadingFile.file.name);
        return; // Only one at a time
      }

      console.log('[UploadQueue] Starting upload for:', {
        id: pendingFile.id,
        fileName: pendingFile.file.name,
        fileSize: pendingFile.file.size,
        fileType: pendingFile.file.type,
      });

      updateFileStatus(pendingFile.id, 'uploading', 10);

      try {
        // Simulate progress stages
        console.log('[UploadQueue] Progress: 30% - Sending to API...');
        updateFileStatus(pendingFile.id, 'uploading', 30);
        const result = await ingestFile(pendingFile.file);
        console.log('[UploadQueue] Progress: 90% - Processing complete');
        updateFileStatus(pendingFile.id, 'uploading', 90);
        console.log('[UploadQueue] Upload completed successfully:', {
          fileName: pendingFile.file.name,
          fileId: result.file_id,
          documentId: result.document_id,
          isDuplicate: result.is_duplicate,
        });
        setFileResult(pendingFile.id, result);
        setRefreshTrigger((prev) => prev + 1);
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'Upload failed';
        console.error('[UploadQueue] Upload failed:', {
          fileName: pendingFile.file.name,
          error: errorMessage,
          fullError: err,
        });
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
      console.log('[FileSelect] Files dropped:', droppedFiles.map(f => ({
        name: f.name,
        size: f.size,
        type: f.type,
      })));
      addFiles(droppedFiles);
    }
  }, [addFiles]);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = e.target.files;
    if (selectedFiles && selectedFiles.length > 0) {
      const filesArray = Array.from(selectedFiles);
      console.log('[FileSelect] Files selected:', filesArray.map(f => ({
        name: f.name,
        size: f.size,
        type: f.type,
      })));
      addFiles(filesArray);
    }
    // Reset input
    e.target.value = '';
  }, [addFiles]);

  return (
    <div className="max-w-2xl mx-auto h-full flex flex-col">
      <h1 className="text-2xl font-bold mb-6">File Upload</h1>

      {/* Drop Zone */}
      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={`
          border-2 border-dashed rounded-lg p-12 text-center transition-colors
          ${isDragging ? 'border-blue-500 bg-blue-50' : 'border-gray-300 hover:border-gray-400'}
        `}
      >
        <svg
          className="mx-auto h-12 w-12 text-gray-400 mb-4"
          stroke="currentColor"
          fill="none"
          viewBox="0 0 48 48"
        >
          <path
            d="M28 8H12a4 4 0 00-4 4v20m32-12v8m0 0v8a4 4 0 01-4 4H12a4 4 0 01-4-4v-4m32-4l-3.172-3.172a4 4 0 00-5.656 0L28 28M8 32l9.172-9.172a4 4 0 015.656 0L28 28m0 0l4 4m4-24h8m-4-4v8m-12 4h.02"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        <p className="text-gray-600 mb-2">
          Drag and drop files here, or click to select
        </p>
        <label className="cursor-pointer">
          <span className="inline-block px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 transition-colors">
            Select Files
          </span>
          <input
            type="file"
            className="hidden"
            onChange={handleFileSelect}
            accept=".txt,.csv,.json,.md"
            multiple
          />
        </label>
        <p className="text-sm text-gray-400 mt-2">
          Supported: .txt, .csv, .json, .md (multiple files allowed)
        </p>
      </div>

      {/* Upload Queue */}
      {files.length > 0 && (
        <div className="mt-6">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-semibold">
              Upload Progress
              {totalCount > 0 && (
                <span className="ml-2 text-sm font-normal text-gray-500">
                  ({completedCount}/{totalCount})
                </span>
              )}
            </h2>
            {completedCount > 0 && !isUploading && (
              <button
                onClick={clearCompleted}
                className="text-sm text-gray-500 hover:text-gray-700"
              >
                Clear completed
              </button>
            )}
          </div>

          {/* Overall Progress */}
          {isUploading && totalCount > 1 && (
            <div className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded-lg">
              <div className="flex items-center justify-between text-sm text-blue-700 mb-2">
                <span>Overall Progress</span>
                <span>{Math.round((completedCount / totalCount) * 100)}%</span>
              </div>
              <div className="h-2 bg-blue-100 rounded-full overflow-hidden">
                <div
                  className="h-full bg-blue-500 transition-all duration-300"
                  style={{ width: `${(completedCount / totalCount) * 100}%` }}
                />
              </div>
            </div>
          )}

          {/* File List */}
          <div className="space-y-2">
            {files.map((fileState) => (
              <div key={fileState.id} className="relative">
                <UploadProgress fileState={fileState} />
                {(fileState.status === 'completed' || fileState.status === 'error') && (
                  <button
                    onClick={() => removeFile(fileState.id)}
                    className="absolute top-2 right-2 p-1 text-gray-400 hover:text-gray-600"
                  >
                    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Uploaded Documents - Scrollable Section */}
      <div className="mt-8 flex-1 flex flex-col min-h-0">
        <h2 className="text-lg font-semibold mb-4">Uploaded Documents</h2>
        <div className="flex-1 overflow-y-auto">
          <FileList refreshTrigger={refreshTrigger} />
        </div>
      </div>
    </div>
  );
}
