import React, { useState, useRef } from 'react';
import { Upload, X, Loader2, ImagePlus } from 'lucide-react';
import { VenuePhotoCategory } from '../../types';
import { uploadVenuePhoto } from '../../lib/supabase';
import { createVenuePhoto } from '../../lib/api';

interface VenuePhotoUploadProps {
  partyId: string;
  venueId: string;
  onPhotoAdded: () => void;
}

const CATEGORIES: { value: VenuePhotoCategory; label: string }[] = [
  { value: 'interior', label: 'Interior' },
  { value: 'exterior', label: 'Exterior' },
  { value: 'capacity', label: 'Capacity' },
  { value: 'amenities', label: 'Amenities' },
  { value: 'other', label: 'Other' },
];

export const VenuePhotoUpload: React.FC<VenuePhotoUploadProps> = ({ partyId, venueId, onPhotoAdded }) => {
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [category, setCategory] = useState<VenuePhotoCategory>('interior');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    setUploading(true);

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      setProgress(`Uploading ${i + 1} of ${files.length}...`);

      try {
        // Upload to storage
        const uploadResult = await uploadVenuePhoto(file, partyId, venueId);
        if (!uploadResult) {
          console.error('Failed to upload file:', file.name);
          continue;
        }

        // Create record in database
        await createVenuePhoto(partyId, venueId, {
          url: uploadResult.url,
          fileName: uploadResult.fileName,
          fileSize: uploadResult.fileSize,
          mimeType: uploadResult.mimeType,
          width: uploadResult.width,
          height: uploadResult.height,
          category,
        });
      } catch (error) {
        console.error('Error uploading venue photo:', error);
      }
    }

    setUploading(false);
    setProgress(null);
    onPhotoAdded();

    // Reset file input
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        {/* Category selector */}
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value as VenuePhotoCategory)}
          className="text-xs bg-white/5 border border-white/10 rounded-lg px-2 py-1.5 text-white/70"
          style={{ colorScheme: 'dark' }}
        >
          {CATEGORIES.map((cat) => (
            <option key={cat.value} value={cat.value} className="bg-[#1a1a2e]">
              {cat.label}
            </option>
          ))}
        </select>

        {/* Upload button */}
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
          className="flex items-center gap-1.5 bg-white/10 hover:bg-white/20 disabled:opacity-50 text-white text-xs font-medium px-3 py-1.5 rounded-lg transition-colors"
        >
          {uploading ? (
            <>
              <Loader2 size={14} className="animate-spin" />
              {progress}
            </>
          ) : (
            <>
              <ImagePlus size={14} />
              Add Photos
            </>
          )}
        </button>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif"
        multiple
        onChange={handleFileSelect}
        className="hidden"
      />
    </div>
  );
};
