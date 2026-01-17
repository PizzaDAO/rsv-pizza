import { useState, useEffect, useCallback } from 'react';
import { uploadEventImage } from '../lib/supabase';

interface UseImageUploadOptions {
  maxSizeMB?: number;
  acceptedTypes?: string[];
  bucket?: string;
  initialUrl?: string | null;
}

interface UseImageUploadReturn {
  previewUrl: string | null;
  file: File | null;
  uploading: boolean;
  error: string | null;
  handleFileChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  uploadImage: () => Promise<string | null>;
  clearImage: () => void;
  setPreviewUrl: (url: string | null) => void;
}

export function useImageUpload(options: UseImageUploadOptions = {}): UseImageUploadReturn {
  const {
    maxSizeMB = 5,
    acceptedTypes = ['image/'],
    bucket = 'event-images',
    initialUrl = null,
  } = options;

  const [previewUrl, setPreviewUrl] = useState<string | null>(initialUrl);
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [objectUrl, setObjectUrl] = useState<string | null>(null);

  // Cleanup object URL on unmount or when a new one is created
  useEffect(() => {
    return () => {
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [objectUrl]);

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (!selectedFile) return;

    setError(null);

    // Validate file type
    const isValidType = acceptedTypes.some(type => selectedFile.type.startsWith(type));
    if (!isValidType) {
      setError(`Invalid file type. Accepted types: ${acceptedTypes.join(', ')}`);
      return;
    }

    // Validate file size
    const maxSizeBytes = maxSizeMB * 1024 * 1024;
    if (selectedFile.size > maxSizeBytes) {
      setError(`File too large. Maximum size is ${maxSizeMB}MB.`);
      return;
    }

    // Revoke previous object URL to prevent memory leak
    if (objectUrl) {
      URL.revokeObjectURL(objectUrl);
    }

    // Create new preview URL
    const newObjectUrl = URL.createObjectURL(selectedFile);
    setObjectUrl(newObjectUrl);
    setPreviewUrl(newObjectUrl);
    setFile(selectedFile);
  }, [acceptedTypes, maxSizeMB, objectUrl]);

  const uploadImage = useCallback(async (): Promise<string | null> => {
    if (!file) return previewUrl;

    setUploading(true);
    setError(null);

    try {
      const uploadedUrl = await uploadEventImage(file, bucket);
      if (uploadedUrl) {
        // Clean up object URL after successful upload
        if (objectUrl) {
          URL.revokeObjectURL(objectUrl);
          setObjectUrl(null);
        }
        setPreviewUrl(uploadedUrl);
        setFile(null);
        return uploadedUrl;
      } else {
        setError('Failed to upload image. Please try again.');
        return null;
      }
    } catch (err) {
      setError('Failed to upload image. Please try again.');
      return null;
    } finally {
      setUploading(false);
    }
  }, [file, bucket, objectUrl, previewUrl]);

  const clearImage = useCallback(() => {
    if (objectUrl) {
      URL.revokeObjectURL(objectUrl);
      setObjectUrl(null);
    }
    setPreviewUrl(null);
    setFile(null);
    setError(null);
  }, [objectUrl]);

  return {
    previewUrl,
    file,
    uploading,
    error,
    handleFileChange,
    uploadImage,
    clearImage,
    setPreviewUrl,
  };
}
