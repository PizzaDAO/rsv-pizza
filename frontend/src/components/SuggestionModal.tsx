import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X, Loader2, Pencil, ImagePlus } from 'lucide-react';
import { IconInput } from './IconInput';
import { useAuth } from '../contexts/AuthContext';
import { uploadEventImage, submitSuggestion } from '../lib/supabase';

interface SuggestionModalProps {
  open: boolean;
  onClose: () => void;
}

const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const MAX_SIZE = 10 * 1024 * 1024; // 10MB

export function SuggestionModal({ open, onClose }: SuggestionModalProps) {
  const { user } = useAuth();

  const [body, setBody] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Reset + prefill from auth when opened
  useEffect(() => {
    if (open) {
      setBody('');
      setName(user?.name || '');
      setEmail(user?.email || '');
      setImageFile(null);
      setImagePreview(null);
      setSubmitting(false);
      setError(null);
      setSuccess(false);
    }
  }, [open, user]);

  // Revoke object URL on change/unmount to avoid leaks
  useEffect(() => {
    return () => {
      if (imagePreview) URL.revokeObjectURL(imagePreview);
    };
  }, [imagePreview]);

  // ESC closes
  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  const handleFilePick = (e: React.ChangeEvent<HTMLInputElement>) => {
    setError(null);
    const file = e.target.files?.[0];
    // Allow re-picking the same file later
    e.target.value = '';
    if (!file) return;

    if (!ACCEPTED_TYPES.includes(file.type)) {
      setError('Please choose a JPEG, PNG, WebP, or GIF image.');
      return;
    }
    if (file.size > MAX_SIZE) {
      setError('Image must be 10MB or smaller.');
      return;
    }

    if (imagePreview) URL.revokeObjectURL(imagePreview);
    setImageFile(file);
    setImagePreview(URL.createObjectURL(file));
  };

  const removeImage = () => {
    if (imagePreview) URL.revokeObjectURL(imagePreview);
    setImageFile(null);
    setImagePreview(null);
  };

  const handleSubmit = async () => {
    if (!body.trim()) {
      setError('Please enter a suggestion.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      let imageUrl: string | undefined;
      if (imageFile) {
        imageUrl = await uploadEventImage(imageFile);
      }
      await submitSuggestion({
        body: body.trim(),
        name: name.trim() || undefined,
        email: email.trim() || undefined,
        imageUrl,
        pageUrl: window.location.href,
      });
      setSuccess(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-md max-h-[90vh] overflow-y-auto rounded-2xl bg-white text-gray-900 shadow-2xl p-6"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Close button */}
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute top-3 right-3 z-10 w-8 h-8 flex items-center justify-center rounded-full bg-gray-100 text-gray-500 hover:text-gray-900 hover:bg-gray-200 transition-colors"
        >
          <X size={20} />
        </button>

        {success ? (
          <div className="flex flex-col items-center text-center py-6">
            <div className="text-4xl mb-3">🍕</div>
            <h2 className="text-lg font-semibold text-gray-900 mb-2">Thanks! 🍕 We'll take a look.</h2>
            <p className="text-sm text-gray-600 mb-6">Your suggestion has been sent.</p>
            <button
              type="button"
              onClick={onClose}
              className="px-5 py-2 rounded-lg bg-[#ff393a] text-white font-medium hover:bg-[#e62f30] transition-colors"
            >
              Close
            </button>
          </div>
        ) : (
          <>
            <div className="flex items-center gap-2 mb-1">
              <Pencil size={20} className="text-[#ff393a]" />
              <h2 className="text-lg font-semibold text-gray-900">Suggest an improvement</h2>
            </div>
            <p className="text-sm text-gray-600 mb-4">
              Spotted something? Share an idea to make the site better.
            </p>

            <div className="space-y-3">
              <IconInput
                multiline
                rows={4}
                required
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder="Share an idea to improve the site…"
              />
              <IconInput
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Your name (optional)"
              />
              <IconInput
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Email (optional, if you'd like a reply)"
              />

              {/* Image picker */}
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleFilePick}
              />
              {imagePreview ? (
                <div className="relative inline-block">
                  <img
                    src={imagePreview}
                    alt="Selected attachment"
                    className="max-h-32 rounded-lg border border-gray-200 object-cover"
                  />
                  <button
                    type="button"
                    onClick={removeImage}
                    aria-label="Remove image"
                    className="absolute -top-2 -right-2 w-6 h-6 flex items-center justify-center rounded-full bg-gray-900 text-white hover:bg-black transition-colors"
                  >
                    <X size={14} />
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="flex items-center gap-2 px-3 py-2 rounded-lg border border-gray-200 text-sm text-gray-600 hover:bg-gray-50 transition-colors"
                >
                  <ImagePlus size={18} />
                  Add an image (optional)
                </button>
              )}

              {error && <p className="text-sm text-red-600">{error}</p>}

              <button
                type="button"
                onClick={handleSubmit}
                disabled={submitting}
                className="w-full flex items-center justify-center gap-2 px-5 py-2.5 rounded-lg bg-[#ff393a] text-white font-medium hover:bg-[#e62f30] disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
              >
                {submitting && <Loader2 size={18} className="animate-spin" />}
                {submitting ? 'Sending…' : 'Send suggestion'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>,
    document.body
  );
}
