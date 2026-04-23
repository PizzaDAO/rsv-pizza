import React, { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Image as ImageIcon, Loader2 } from 'lucide-react';
import { uploadDescriptionImage } from '../lib/supabase';

interface DescriptionEditorProps {
  value: string;
  onChange: (val: string) => void;
  onSave: () => void;
  onClose: () => void;
  saving: boolean;
  partyId: string;
}

export const DescriptionEditor: React.FC<DescriptionEditorProps> = ({
  value,
  onChange,
  onSave,
  onClose,
  saving,
  partyId,
}) => {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Reset file input so the same file can be selected again
    e.target.value = '';

    // Validate file type
    if (!file.type.startsWith('image/')) {
      alert('Please select an image file.');
      return;
    }

    // Validate file size (5MB max)
    if (file.size > 5 * 1024 * 1024) {
      alert('Image must be under 5MB.');
      return;
    }

    setUploading(true);

    const url = await uploadDescriptionImage(file, partyId);

    if (!url) {
      alert('Failed to upload image. Please try again.');
      setUploading(false);
      return;
    }

    // Insert markdown image at cursor position
    const textarea = textareaRef.current;
    const cursorPos = textarea?.selectionStart ?? value.length;
    const imageMarkdown = `\n![image](${url})\n`;
    const newValue = value.slice(0, cursorPos) + imageMarkdown + value.slice(cursorPos);
    onChange(newValue);

    setUploading(false);

    // Restore focus and set cursor after inserted text
    requestAnimationFrame(() => {
      if (textarea) {
        textarea.focus();
        const newPos = cursorPos + imageMarkdown.length;
        textarea.selectionStart = newPos;
        textarea.selectionEnd = newPos;
      }
    });
  };

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-20 p-4 bg-black/70"
      onClick={onClose}
    >
      <div
        className="bg-theme-header border border-theme-stroke rounded-2xl shadow-xl max-w-lg w-full p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-theme-text">Description</h2>
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="flex items-center gap-1.5 text-xs text-white/60 hover:text-white/90 bg-theme-surface border border-theme-stroke rounded-lg px-2.5 py-1.5 transition-colors disabled:opacity-50"
          >
            {uploading ? (
              <>
                <Loader2 size={14} className="animate-spin" />
                Uploading...
              </>
            ) : (
              <>
                <ImageIcon size={14} />
                Add Image
              </>
            )}
          </button>
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={handleImageUpload}
        />

        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Describe your event..."
          className="w-full bg-theme-surface border border-theme-stroke rounded-lg px-3 py-3 text-theme-text text-sm focus:outline-none focus:ring-1 focus:ring-[#ff393a] focus:border-[#ff393a] min-h-[200px] resize-y"
          autoFocus
        />

        <button
          type="button"
          onClick={onSave}
          disabled={saving || uploading}
          className="w-full mt-4 bg-[#ff393a] hover:bg-[#ff5a5b] disabled:opacity-50 text-white font-medium py-2.5 rounded-lg transition-colors text-sm flex items-center justify-center gap-2"
        >
          {saving ? (
            <>
              <Loader2 size={14} className="animate-spin" />
              Saving...
            </>
          ) : (
            'Done'
          )}
        </button>
      </div>
    </div>,
    document.body
  );
};
