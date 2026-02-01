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

  const statusIcons = {
    pending: (
      <div className="h-3 w-3 rounded-full border-2 border-gray-300"></div>
    ),
    uploading: (
      <div className="animate-spin rounded-full h-3 w-3 border-2 border-blue-500 border-t-transparent"></div>
    ),
    completed: (
      <svg className="h-3 w-3 text-green-500" fill="currentColor" viewBox="0 0 20 20">
        <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
      </svg>
    ),
    error: (
      <svg className="h-3 w-3 text-red-500" fill="currentColor" viewBox="0 0 20 20">
        <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
      </svg>
    ),
  };

  return (
    <div className="p-2 bg-white border rounded">
      {/* File Name and Icon */}
      <div className="flex items-center gap-2 mb-1">
        <div className="flex-shrink-0">
          {statusIcons[status]}
        </div>
        <p className="text-xs font-medium text-gray-900 truncate flex-1">
          {file.name}
        </p>
        <span className="text-xs text-gray-400 flex-shrink-0">
          {(file.size / 1024).toFixed(0)}KB
        </span>
      </div>

      {/* Progress Bar */}
      <div className="h-1 w-full bg-gray-100 rounded-full overflow-hidden mb-1">
        <div
          className={`h-full transition-all duration-300 ${statusColors[status]}`}
          style={{ width: `${progress}%` }}
        />
      </div>

      {/* Status Text */}
      <p className="text-xs">
        {status === 'pending' && <span className="text-gray-500">Waiting...</span>}
        {status === 'uploading' && <span className="text-blue-600">{progress}%</span>}
        {status === 'completed' && (
          <span className="text-green-600">
            {result?.is_duplicate ? 'Exists' : `${result?.chunks_count} chunks`}
          </span>
        )}
        {status === 'error' && (
          <span className="text-red-600 truncate block" title={error}>
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
    <div className="h-full flex gap-6">
      {/* Left Side - Uploaded Documents */}
      <div className="flex-1 flex flex-col min-h-0">
        <h2 className="text-xl font-bold mb-4">Uploaded Documents</h2>
        <div className="flex-1 overflow-y-auto">
          <FileList refreshTrigger={refreshTrigger} />
        </div>
      </div>

      {/* Right Side - Upload Area */}
      <div className="w-96 flex flex-col min-h-0">
        <h2 className="text-xl font-bold mb-4">Upload Files</h2>

        {/* Drop Zone - Compact */}
        <div
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          className={`
            border-2 border-dashed rounded-lg p-6 text-center transition-colors flex-shrink-0
            ${isDragging ? 'border-blue-500 bg-blue-50' : 'border-gray-300 hover:border-gray-400'}
          `}
        >
          <svg
            className="mx-auto h-10 w-10 text-gray-400 mb-3"
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
          <p className="text-sm text-gray-600 mb-3">
            Drag files here or click to select
          </p>
          <label className="cursor-pointer">
            <span className="inline-block px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 transition-colors text-sm">
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
          <p className="text-xs text-gray-400 mt-2">
            .txt, .csv, .json, .md, .pdf
          </p>
        </div>

        {/* Upload Progress */}
        {files.length > 0 && (
          <div className="mt-4 flex-1 flex flex-col min-h-0">
            <div className="flex items-center justify-between mb-3 flex-shrink-0">
              <h3 className="text-sm font-semibold text-gray-700">
                Progress {totalCount > 0 && `(${completedCount}/${totalCount})`}
              </h3>
              {completedCount > 0 && !isUploading && (
                <button
                  onClick={clearCompleted}
                  className="text-xs text-gray-500 hover:text-gray-700"
                >
                  Clear
                </button>
              )}
            </div>

            {/* Overall Progress Bar - Compact */}
            {totalCount > 0 && (
              <div className="mb-3 p-2 bg-blue-50 border border-blue-200 rounded flex-shrink-0">
                <div className="flex items-center justify-between text-xs text-blue-700 mb-1">
                  <span className="font-medium">Overall</span>
                  <span className="font-semibold">{Math.round((completedCount / totalCount) * 100)}%</span>
                </div>
                <div className="h-1.5 bg-blue-100 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-blue-500 transition-all duration-300"
                    style={{ width: `${(completedCount / totalCount) * 100}%` }}
                  />
                </div>
              </div>
            )}

            {/* File List - Compact & Scrollable */}
            <div className="space-y-2 overflow-y-auto flex-1 min-h-0">
              {files.map((fileState) => (
                <div key={fileState.id} className="relative">
                  <UploadProgress fileState={fileState} />
                  {(fileState.status === 'completed' || fileState.status === 'error') && (
                    <button
                      onClick={() => removeFile(fileState.id)}
                      className="absolute top-1 right-1 p-0.5 text-gray-400 hover:text-gray-600 bg-white rounded"
                      title="Remove"
                    >
                      <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
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
