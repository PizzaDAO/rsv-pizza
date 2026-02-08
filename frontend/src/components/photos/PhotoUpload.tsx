import React, { useState, useCallback, useRef } from 'react';
import { Upload, X, Loader2, Image as ImageIcon, Check } from 'lucide-react';
import { uploadEventPhoto } from '../../lib/supabase';
import { uploadPhoto as uploadPhotoApi, PhotoUploadData } from '../../lib/api';
import { Photo } from '../../types';

interface PhotoUploadProps {
  partyId: string;
  uploaderName?: string;
  uploaderEmail?: string;
  guestId?: string;
  onUploadComplete?: (photo: Photo) => void;
  onClose?: () => void;
}

interface UploadingFile {
  file: File;
  preview: string;
  progress: number;
  status: 'pending' | 'uploading' | 'complete' | 'error';
  error?: string;
  photo?: Photo;
}

export const PhotoUpload: React.FC<PhotoUploadProps> = ({
  partyId,
  uploaderName,
  uploaderEmail,
  guestId,
  onUploadComplete,
  onClose,
}) => {
  const [files, setFiles] = useState<UploadingFile[]>([]);
  const [dragging, setDragging] = useState(false);
  const [caption, setCaption] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFiles = useCallback((selectedFiles: FileList | File[]) => {
    const newFiles: UploadingFile[] = Array.from(selectedFiles)
      .filter(file => file.type.startsWith('image/'))
      .map(file => ({
        file,
        preview: URL.createObjectURL(file),
        progress: 0,
        status: 'pending' as const,
      }));

    setFiles(prev => [...prev, ...newFiles]);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    handleFiles(e.dataTransfer.files);
  }, [handleFiles]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
  }, []);

  const removeFile = useCallback((index: number) => {
    setFiles(prev => {
      const newFiles = [...prev];
      URL.revokeObjectURL(newFiles[index].preview);
      newFiles.splice(index, 1);
      return newFiles;
    });
  }, []);

  const uploadFiles = async () => {
    const pendingFiles = files.filter(f => f.status === 'pending');

    for (let i = 0; i < pendingFiles.length; i++) {
      const fileIndex = files.findIndex(f => f.file === pendingFiles[i].file);
      if (fileIndex === -1) continue;

      // Update status to uploading
      setFiles(prev => {
        const newFiles = [...prev];
        newFiles[fileIndex] = { ...newFiles[fileIndex], status: 'uploading', progress: 10 };
        return newFiles;
      });

      try {
        // Upload to Supabase Storage
        const uploadResult = await uploadEventPhoto(pendingFiles[i].file, partyId);

        if (!uploadResult) {
          throw new Error('Failed to upload to storage');
        }

        setFiles(prev => {
          const newFiles = [...prev];
          newFiles[fileIndex] = { ...newFiles[fileIndex], progress: 50 };
          return newFiles;
        });

        // Create photo record via API
        const photoData: PhotoUploadData = {
          url: uploadResult.url,
          fileName: uploadResult.fileName,
          fileSize: uploadResult.fileSize,
          mimeType: uploadResult.mimeType,
          width: uploadResult.width,
          height: uploadResult.height,
          uploaderName,
          uploaderEmail,
          guestId,
          caption: caption || undefined,
        };

        const result = await uploadPhotoApi(partyId, photoData);

        if (!result) {
          throw new Error('Failed to create photo record');
        }

        setFiles(prev => {
          const newFiles = [...prev];
          newFiles[fileIndex] = {
            ...newFiles[fileIndex],
            status: 'complete',
            progress: 100,
            photo: result.photo,
          };
          return newFiles;
        });

        onUploadComplete?.(result.photo);
      } catch (error) {
        console.error('Upload error:', error);
        setFiles(prev => {
          const newFiles = [...prev];
          newFiles[fileIndex] = {
            ...newFiles[fileIndex],
            status: 'error',
            error: error instanceof Error ? error.message : 'Upload failed',
          };
          return newFiles;
        });
      }
    }
  };

  const pendingCount = files.filter(f => f.status === 'pending').length;
  const uploadingCount = files.filter(f => f.status === 'uploading').length;
  const completeCount = files.filter(f => f.status === 'complete').length;

  return (
    <div className="bg-[#1a1a2e] border border-white/10 rounded-2xl p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-white">Upload Photos</h2>
        {onClose && (
          <button
            onClick={onClose}
            className="text-white/60 hover:text-white transition-colors"
          >
            <X size={20} />
          </button>
        )}
      </div>

      {/* Drop Zone */}
      <div
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onClick={() => fileInputRef.current?.click()}
        className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-all ${
          dragging
            ? 'border-[#ff393a] bg-[#ff393a]/10'
            : 'border-white/20 hover:border-[#ff393a]/50 hover:bg-white/5'
        }`}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/gif"
          multiple
          onChange={(e) => e.target.files && handleFiles(e.target.files)}
          className="hidden"
        />
        <Upload className="w-10 h-10 text-white/40 mx-auto mb-3" />
        <p className="text-white/60 mb-1">Drag and drop photos here</p>
        <p className="text-white/40 text-sm">or click to select files</p>
        <p className="text-white/30 text-xs mt-2">Max 10MB per photo. JPEG, PNG, WebP, GIF</p>
      </div>

      {/* Caption Input */}
      {files.length > 0 && (
        <div className="mt-4">
          <input
            type="text"
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
            placeholder="Add a caption (optional)"
            className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-2 text-white placeholder-white/40 focus:outline-none focus:ring-1 focus:ring-[#ff393a]"
          />
        </div>
      )}

      {/* File Previews */}
      {files.length > 0 && (
        <div className="mt-4 grid grid-cols-2 sm:grid-cols-3 gap-3">
          {files.map((file, index) => (
            <div
              key={index}
              className="relative aspect-square rounded-lg overflow-hidden bg-white/5"
            >
              <img
                src={file.preview}
                alt={`Preview ${index + 1}`}
                className="w-full h-full object-cover"
              />

              {/* Status Overlay */}
              {file.status === 'uploading' && (
                <div className="absolute inset-0 bg-black/60 flex items-center justify-center">
                  <Loader2 className="w-8 h-8 text-white animate-spin" />
                </div>
              )}

              {file.status === 'complete' && (
                <div className="absolute inset-0 bg-green-500/20 flex items-center justify-center">
                  <div className="bg-green-500 rounded-full p-2">
                    <Check className="w-6 h-6 text-white" />
                  </div>
                </div>
              )}

              {file.status === 'error' && (
                <div className="absolute inset-0 bg-red-500/20 flex items-center justify-center">
                  <p className="text-red-400 text-xs text-center px-2">{file.error}</p>
                </div>
              )}

              {/* Remove Button (only for pending files) */}
              {file.status === 'pending' && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    removeFile(index);
                  }}
                  className="absolute top-2 right-2 bg-black/60 hover:bg-black/80 rounded-full p-1 transition-colors"
                >
                  <X size={16} className="text-white" />
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Upload Button */}
      {pendingCount > 0 && (
        <button
          onClick={uploadFiles}
          disabled={uploadingCount > 0}
          className="w-full mt-4 bg-[#ff393a] hover:bg-[#ff5a5b] disabled:opacity-50 text-white font-medium py-3 rounded-lg transition-colors flex items-center justify-center gap-2"
        >
          {uploadingCount > 0 ? (
            <>
              <Loader2 size={18} className="animate-spin" />
              Uploading {uploadingCount} photo{uploadingCount !== 1 ? 's' : ''}...
            </>
          ) : (
            <>
              <Upload size={18} />
              Upload {pendingCount} photo{pendingCount !== 1 ? 's' : ''}
            </>
          )}
        </button>
      )}

      {/* Status Summary */}
      {completeCount > 0 && pendingCount === 0 && uploadingCount === 0 && (
        <div className="mt-4 text-center">
          <p className="text-green-400 flex items-center justify-center gap-2">
            <Check size={18} />
            {completeCount} photo{completeCount !== 1 ? 's' : ''} uploaded successfully
          </p>
        </div>
      )}
    </div>
  );
};
