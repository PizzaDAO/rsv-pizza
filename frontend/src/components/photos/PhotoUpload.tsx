import React, { useState, useCallback, useRef } from 'react';
import { Upload, X, Loader2, Image as ImageIcon, Check, Tag, Play } from 'lucide-react';
import { uploadEventPhoto, uploadEventVideo } from '../../lib/supabase';
import { uploadPhoto as uploadPhotoApi, PhotoUploadData } from '../../lib/api';
import { Photo } from '../../types';

interface PhotoUploadProps {
  partyId: string;
  uploaderName?: string;
  uploaderEmail?: string;
  guestId?: string;
  photoModeration?: boolean;
  availableTags?: string[];
  onUploadComplete?: (photo: Photo) => void;
  onClose?: () => void;
}

interface UploadingFile {
  file: File;
  preview: string;
  isVideo: boolean;
  progress: number;
  status: 'pending' | 'uploading' | 'complete' | 'error';
  error?: string;
  photo?: Photo;
}

const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const ALLOWED_VIDEO_TYPES = ['video/mp4', 'video/webm', 'video/quicktime'];
const MAX_VIDEO_DURATION = 300; // 5 minutes in seconds

export const PhotoUpload: React.FC<PhotoUploadProps> = ({
  partyId,
  uploaderName,
  uploaderEmail,
  guestId,
  photoModeration = false,
  availableTags = [],
  onUploadComplete,
  onClose,
}) => {
  const [files, setFiles] = useState<UploadingFile[]>([]);
  const [dragging, setDragging] = useState(false);
  const [caption, setCaption] = useState('');
  const [photoYear, setPhotoYear] = useState<number | null>(null);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const currentYear = new Date().getFullYear();
  const yearOptions = Array.from({ length: currentYear - 2010 + 1 }, (_, i) => currentYear - i);

  // Client-side duration check for videos before adding to queue
  const checkVideoDuration = (file: File): Promise<number> => {
    return new Promise((resolve, reject) => {
      const video = document.createElement('video');
      video.preload = 'metadata';
      const objectUrl = URL.createObjectURL(file);

      video.onloadedmetadata = () => {
        URL.revokeObjectURL(objectUrl);
        resolve(video.duration);
      };

      video.onerror = () => {
        URL.revokeObjectURL(objectUrl);
        reject(new Error('Failed to read video'));
      };

      video.src = objectUrl;
    });
  };

  const handleFiles = useCallback(async (selectedFiles: FileList | File[]) => {
    const validFiles: UploadingFile[] = [];

    for (const file of Array.from(selectedFiles)) {
      const isImage = ALLOWED_IMAGE_TYPES.includes(file.type);
      const isVideo = ALLOWED_VIDEO_TYPES.includes(file.type);

      if (!isImage && !isVideo) continue;

      // Client-side size validation
      if (isImage && file.size > 10 * 1024 * 1024) continue;
      if (isVideo && file.size > 50 * 1024 * 1024) continue;

      // Client-side duration validation for videos
      if (isVideo) {
        try {
          const duration = await checkVideoDuration(file);
          if (duration > MAX_VIDEO_DURATION) {
            // Skip videos longer than 5 minutes - add as error
            validFiles.push({
              file,
              preview: URL.createObjectURL(file),
              isVideo: true,
              progress: 0,
              status: 'error',
              error: 'Video exceeds 5-minute limit',
            });
            continue;
          }
        } catch {
          // Allow upload anyway - server will validate
        }
      }

      validFiles.push({
        file,
        preview: URL.createObjectURL(file),
        isVideo,
        progress: 0,
        status: 'pending',
      });
    }

    if (validFiles.length > 0) {
      setFiles(prev => [...prev, ...validFiles]);
    }
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

      const currentFile = pendingFiles[i];
      const isVideo = currentFile.isVideo;

      // Update status to uploading
      setFiles(prev => {
        const newFiles = [...prev];
        newFiles[fileIndex] = { ...newFiles[fileIndex], status: 'uploading', progress: 10 };
        return newFiles;
      });

      try {
        // Upload to Supabase Storage - branch by file type
        let uploadResult;
        if (isVideo) {
          uploadResult = await uploadEventVideo(currentFile.file, partyId);
        } else {
          uploadResult = await uploadEventPhoto(currentFile.file, partyId);
        }

        if (!uploadResult) {
          throw new Error(isVideo ? 'Failed to upload video to storage' : 'Failed to upload to storage');
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
          tags: selectedTags.length > 0 ? selectedTags : undefined,
          photoYear: photoYear || undefined,
          duration: isVideo && 'duration' in uploadResult ? uploadResult.duration : undefined,
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

  // Count media types for label text
  const hasVideos = files.some(f => f.isVideo);
  const hasImages = files.some(f => !f.isVideo);
  const mediaLabel = hasVideos && hasImages ? 'files' : hasVideos ? 'videos' : 'photos';

  return (
    <div className="bg-theme-header border border-theme-stroke rounded-2xl p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-theme-text">Upload Photos & Videos</h2>
        {onClose && (
          <button
            onClick={onClose}
            className="text-theme-text-secondary hover:text-theme-text transition-colors"
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
            : 'border-theme-stroke-hover hover:border-[#ff393a]/50 hover:bg-theme-surface'
        }`}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/gif,video/mp4,video/webm,video/quicktime"
          multiple
          onChange={(e) => e.target.files && handleFiles(e.target.files)}
          className="hidden"
        />
        <Upload className="w-10 h-10 text-theme-text-muted mx-auto mb-3" />
        <p className="text-theme-text-secondary mb-1">Drag and drop photos or videos here</p>
        <p className="text-theme-text-muted text-sm">or click to select files</p>
        <p className="text-theme-text-faint text-xs mt-2">Max 10MB per photo, 50MB per video (5 min). JPEG, PNG, WebP, GIF, MP4, WebM, MOV</p>
      </div>

      {/* Caption Input */}
      {files.length > 0 && (
        <div className="mt-4">
          <input
            type="text"
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
            placeholder="Add a caption (optional)"
            className="w-full bg-theme-surface border border-theme-stroke rounded-lg px-4 py-2 text-theme-text placeholder-white/40 focus:outline-none focus:ring-1 focus:ring-[#ff393a]"
          />
        </div>
      )}

      {/* Year Selector */}
      {files.length > 0 && (
        <div className="mt-3">
          <select
            value={photoYear || ''}
            onChange={(e) => setPhotoYear(e.target.value ? parseInt(e.target.value, 10) : null)}
            className="w-full bg-theme-surface border border-theme-stroke rounded-lg px-4 py-2 text-theme-text focus:outline-none focus:ring-1 focus:ring-[#ff393a] appearance-none cursor-pointer"
          >
            <option value="" className="bg-theme-card text-theme-text">Year taken (optional)</option>
            {yearOptions.map((year) => (
              <option key={year} value={year} className="bg-theme-card text-theme-text">
                {year}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Tag Selector */}
      {files.length > 0 && availableTags.length > 0 && (
        <div className="mt-3">
          <p className="text-theme-text-muted text-xs mb-2 flex items-center gap-1">
            <Tag size={12} />
            Tag your uploads
          </p>
          <div className="flex flex-wrap gap-2">
            {availableTags.map((tag) => {
              const isSelected = selectedTags.includes(tag);
              return (
                <button
                  key={tag}
                  type="button"
                  onClick={() =>
                    setSelectedTags((prev) =>
                      isSelected ? prev.filter((t) => t !== tag) : [...prev, tag]
                    )
                  }
                  className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${
                    isSelected
                      ? 'bg-[#ff393a] border-[#ff393a] text-white'
                      : 'bg-transparent border-theme-stroke text-theme-text-secondary hover:border-[#ff393a]/50 hover:text-theme-text'
                  }`}
                >
                  #{tag}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* File Previews */}
      {files.length > 0 && (
        <div className="mt-4 grid grid-cols-2 sm:grid-cols-3 gap-3">
          {files.map((file, index) => (
            <div
              key={index}
              className="relative aspect-square rounded-lg overflow-hidden bg-theme-surface"
            >
              {file.isVideo ? (
                <div className="relative w-full h-full">
                  <video
                    src={file.preview}
                    className="w-full h-full object-cover"
                    preload="metadata"
                    muted
                  />
                  {/* Play icon overlay for video previews */}
                  {file.status === 'pending' && (
                    <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                      <div className="bg-black/50 rounded-full p-3">
                        <Play size={24} className="text-white fill-white" />
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <img
                  src={file.preview}
                  alt={`Preview ${index + 1}`}
                  className="w-full h-full object-cover"
                />
              )}

              {/* Status Overlay */}
              {file.status === 'uploading' && (
                <div className="absolute inset-0 bg-black/60 flex items-center justify-center">
                  <Loader2 className="w-8 h-8 text-theme-text animate-spin" />
                </div>
              )}

              {file.status === 'complete' && (
                <div className="absolute inset-0 bg-green-500/20 flex items-center justify-center">
                  <div className="bg-green-500 rounded-full p-2">
                    <Check className="w-6 h-6 text-theme-text" />
                  </div>
                </div>
              )}

              {file.status === 'error' && (
                <div className="absolute inset-0 bg-red-500/20 flex items-center justify-center">
                  <p className="text-red-400 text-xs text-center px-2">{file.error}</p>
                </div>
              )}

              {/* Remove Button (only for pending or error files) */}
              {(file.status === 'pending' || file.status === 'error') && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    removeFile(index);
                  }}
                  className="absolute top-2 right-2 bg-black/60 hover:bg-black/80 rounded-full p-1 transition-colors"
                >
                  <X size={16} className="text-theme-text" />
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
              Uploading...
            </>
          ) : (
            <>
              <Upload size={18} />
              Upload {pendingCount} {pendingCount !== 1 ? mediaLabel : mediaLabel.replace(/s$/, '')}
            </>
          )}
        </button>
      )}

      {/* Status Summary */}
      {completeCount > 0 && pendingCount === 0 && uploadingCount === 0 && (
        <div className="mt-4 text-center">
          <p className="text-green-400 flex items-center justify-center gap-2">
            <Check size={18} />
            {completeCount} {completeCount !== 1 ? 'files' : 'file'} uploaded successfully
          </p>
          {photoModeration && (
            <p className="text-amber-400/80 text-sm mt-2">
              Uploads will appear after the host approves them.
            </p>
          )}
        </div>
      )}

      {/* Moderation Notice */}
      {photoModeration && files.length === 0 && (
        <p className="mt-3 text-amber-400/70 text-xs text-center">
          Uploads are reviewed by the host before appearing in the gallery.
        </p>
      )}
    </div>
  );
};
