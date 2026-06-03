import React, { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Loader2, Camera, Check, Hash } from 'lucide-react';
import { uploadEventImage } from '../../lib/supabase';
import {
  submitSuperlative,
  ScorecardItem as ScorecardItemType,
  PublicEventSponsor,
} from '../../lib/api';
import { ScorecardItemKey } from './ScorecardItem';
import { IconInput } from '../IconInput';

interface PhotoGameModalProps {
  inviteCode: string;
  hostName?: string | null;
  sponsors?: PublicEventSponsor[];
  items: ScorecardItemType[];
  onComplete: (itemKey: ScorecardItemKey, proofUrl?: string, proofType?: string) => Promise<void> | void;
  onClose: () => void;
}

type PhotoChallengeKey = 'sign_pizza_box' | 'photo_box_stack' | 'photo_host' | 'photo_partner';
type SuperlativeKey = 'super_slices' | 'super_cheese_pull' | 'super_box_stack';

const SUPERLATIVE_CONFIG: Record<SuperlativeKey, { label: string; emoji: string; numeric?: boolean }> = {
  super_slices: { label: 'Most people with a slice', emoji: '🍕', numeric: true },
  super_cheese_pull: { label: 'Best cheese pull', emoji: '🧀' },
  super_box_stack: { label: 'Tallest box stack', emoji: '📦' },
};

export function PhotoGameModal({
  inviteCode,
  hostName,
  sponsors,
  items,
  onComplete,
  onClose,
}: PhotoGameModalProps) {
  const [uploadingKey, setUploadingKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Superlatives submitted this session (keyed by superlative key)
  const [submitted, setSubmitted] = useState<Record<string, boolean>>({});
  // Numeric inputs for superlatives that need one
  const [numericValues, setNumericValues] = useState<Record<string, string>>({});

  const fileInputs = useRef<Record<string, HTMLInputElement | null>>({});

  const isComplete = (key: string) => items.find((i) => i.itemKey === key)?.completed ?? false;

  const PHOTO_CHALLENGES: { key: PhotoChallengeKey; label: string; emoji: string }[] = [
    { key: 'sign_pizza_box', label: 'Photo of your signature on the box', emoji: '✍️' },
    { key: 'photo_box_stack', label: 'Photo with the box stack', emoji: '📦' },
    { key: 'photo_host', label: `Photo with ${hostName ?? 'the host'}`, emoji: '🧑‍🍳' },
    { key: 'photo_partner', label: 'Photo with a partner', emoji: '🤝' },
  ];

  const triggerPicker = (key: string) => {
    setError(null);
    fileInputs.current[key]?.click();
  };

  const handleChallengeFile = async (
    key: PhotoChallengeKey,
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setUploadingKey(key);
    setError(null);
    try {
      const url = await uploadEventImage(file);
      if (!url) {
        setError('Photo upload failed. Please try again.');
        return;
      }
      await onComplete(key, url, 'photo_id');
    } catch (err: any) {
      setError(err?.message || 'Photo upload failed. Please try again.');
    } finally {
      setUploadingKey(null);
    }
  };

  const handleSuperlativeFile = async (
    key: SuperlativeKey,
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setUploadingKey(key);
    setError(null);
    try {
      const url = await uploadEventImage(file);
      if (!url) {
        setError('Photo upload failed. Please try again.');
        return;
      }
      const rawNumeric = numericValues[key];
      const numericValue =
        SUPERLATIVE_CONFIG[key].numeric && rawNumeric ? Number(rawNumeric) : undefined;
      await submitSuperlative(inviteCode, {
        superlativeKey: key,
        photoUrl: url,
        numericValue: Number.isFinite(numericValue as number) ? numericValue : undefined,
      });
      setSubmitted((prev) => ({ ...prev, [key]: true }));
    } catch (err: any) {
      setError(err?.message || 'Submission failed. Please try again.');
    } finally {
      setUploadingKey(null);
    }
  };

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md max-h-[85vh] overflow-y-auto rounded-2xl bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="sticky top-0 flex items-center justify-between border-b border-gray-200 bg-white px-5 py-4">
          <h2 className="text-lg font-bold text-gray-900">Photo Game</h2>
          <button
            onClick={onClose}
            className="rounded-full p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-900"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-6 px-5 py-4">
          {error && (
            <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
          )}

          {/* Challenges */}
          <section>
            <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-gray-500">
              Challenges
            </h3>
            <div className="space-y-2">
              {PHOTO_CHALLENGES.map(({ key, label, emoji }) => {
                const done = isComplete(key);
                const busy = uploadingKey === key;
                return (
                  <div key={key}>
                    <div
                      className={`flex items-center gap-3 rounded-xl border px-3 py-3 ${
                        done ? 'border-green-200 bg-green-50' : 'border-gray-200 bg-gray-50'
                      }`}
                    >
                      <span className="text-2xl leading-none">{done ? '✅' : emoji}</span>
                      <span
                        className={`flex-1 text-sm ${
                          done ? 'text-green-700' : 'text-gray-700'
                        }`}
                      >
                        {label}
                      </span>
                      {done ? (
                        <span className="flex items-center gap-1 text-xs font-medium text-green-600">
                          <Check className="h-3.5 w-3.5" /> Done
                        </span>
                      ) : (
                        <button
                          onClick={() => triggerPicker(key)}
                          disabled={busy}
                          className="flex items-center gap-1.5 rounded-full bg-[#ff393a] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#ff5a5b] disabled:opacity-50"
                        >
                          {busy ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Camera className="h-3.5 w-3.5" />
                          )}
                          Upload
                        </button>
                      )}
                    </div>
                    {/* Partner prompts: show sponsor names/logos as hints */}
                    {key === 'photo_partner' && !done && sponsors && sponsors.length > 0 && (
                      <div className="ml-9 mt-1.5 flex flex-wrap items-center gap-2">
                        {sponsors.map((s) => (
                          <span
                            key={s.id}
                            className="inline-flex items-center gap-1.5 rounded-full bg-gray-100 px-2 py-1 text-xs text-gray-600"
                          >
                            {s.logoUrl && (
                              <img
                                src={s.logoUrl}
                                alt=""
                                className="h-4 w-4 rounded-full object-contain"
                              />
                            )}
                            {s.name}
                          </span>
                        ))}
                      </div>
                    )}
                    <input
                      ref={(el) => {
                        fileInputs.current[key] = el;
                      }}
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(e) => handleChallengeFile(key, e)}
                    />
                  </div>
                );
              })}
            </div>
          </section>

          {/* Superlatives */}
          <section>
            <h3 className="mb-1 text-sm font-semibold uppercase tracking-wide text-gray-500">
              Best Of
            </h3>
            <p className="mb-2 text-xs text-gray-400">
              Submit your best shot — judged after the event.
            </p>
            <div className="space-y-2">
              {(Object.keys(SUPERLATIVE_CONFIG) as SuperlativeKey[]).map((key) => {
                const config = SUPERLATIVE_CONFIG[key];
                const done = submitted[key];
                const busy = uploadingKey === key;
                return (
                  <div
                    key={key}
                    className={`rounded-xl border px-3 py-3 ${
                      done ? 'border-blue-200 bg-blue-50' : 'border-gray-200 bg-gray-50'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <span className="text-2xl leading-none">{config.emoji}</span>
                      <span className="flex-1 text-sm text-gray-700">{config.label}</span>
                      {done ? (
                        <span className="text-xs font-medium text-blue-600">
                          Submitted — judged after the event
                        </span>
                      ) : (
                        <button
                          onClick={() => triggerPicker(key)}
                          disabled={busy}
                          className="flex items-center gap-1.5 rounded-full bg-gray-800 px-3 py-1.5 text-xs font-medium text-white hover:bg-gray-700 disabled:opacity-50"
                        >
                          {busy ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Camera className="h-3.5 w-3.5" />
                          )}
                          Submit
                        </button>
                      )}
                    </div>
                    {config.numeric && !done && (
                      <div className="ml-9 mt-2">
                        <IconInput
                          icon={Hash}
                          type="number"
                          min={0}
                          value={numericValues[key] ?? ''}
                          onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                            setNumericValues((prev) => ({ ...prev, [key]: e.target.value }))
                          }
                          placeholder="How many people?"
                          className="text-sm"
                        />
                      </div>
                    )}
                    <input
                      ref={(el) => {
                        fileInputs.current[key] = el;
                      }}
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(e) => handleSuperlativeFile(key, e)}
                    />
                  </div>
                );
              })}
            </div>
          </section>
        </div>
      </div>
    </div>,
    document.body
  );
}
