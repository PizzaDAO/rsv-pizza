import React, { useState, useEffect, useCallback } from 'react';
import { Link as LinkIcon, AlertCircle, Check, Loader2 } from 'lucide-react';
import { validateCustomSlug } from '../lib/supabase';

interface CustomUrlInputProps {
  value: string;
  onChange: (value: string) => void;
  currentPartyId?: string;
  onValidationChange?: (isValid: boolean, error?: string) => void;
  onBlur?: () => void;
}

export function CustomUrlInput({
  value,
  onChange,
  currentPartyId,
  onValidationChange,
  onBlur,
}: CustomUrlInputProps) {
  const [validating, setValidating] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [isValid, setIsValid] = useState<boolean | null>(null);

  // Debounced validation
  const validateSlug = useCallback(async (slug: string) => {
    if (!slug.trim()) {
      setValidationError(null);
      setIsValid(null);
      onValidationChange?.(true);
      return;
    }

    setValidating(true);
    try {
      const result = await validateCustomSlug(slug, currentPartyId);
      setValidationError(result.valid ? null : result.error || 'Invalid URL');
      setIsValid(result.valid);
      onValidationChange?.(result.valid, result.error);
    } catch (err) {
      setValidationError('Failed to validate URL');
      setIsValid(false);
      onValidationChange?.(false, 'Failed to validate URL');
    } finally {
      setValidating(false);
    }
  }, [currentPartyId, onValidationChange]);

  // Validate on value change with debounce
  useEffect(() => {
    const timer = setTimeout(() => {
      validateSlug(value);
    }, 500);

    return () => clearTimeout(timer);
  }, [value, validateSlug]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '');
    onChange(newValue);
  };

  return (
    <div>
      <div className="relative flex items-center">
        <LinkIcon size={20} className="absolute left-3 text-white/40 pointer-events-none" />
        <span className="absolute left-12 text-white/60 pointer-events-none font-mono text-sm">rsv.pizza/</span>
        <input
          type="text"
          value={value}
          onChange={handleChange}
          onBlur={onBlur}
          placeholder="custom-url"
          className={`w-full font-mono text-sm ${
            validationError ? 'border-red-500 focus:border-red-500 focus:ring-red-500' : ''
          } ${isValid === true ? 'border-green-500 focus:border-green-500 focus:ring-green-500' : ''}`}
          style={{ paddingLeft: '130px', paddingRight: '40px' }}
          maxLength={50}
        />
        {/* Status indicator */}
        <div className="absolute right-3 flex items-center">
          {validating && (
            <Loader2 size={16} className="animate-spin text-white/40" />
          )}
          {!validating && isValid === true && value.trim() && (
            <Check size={16} className="text-green-500" />
          )}
          {!validating && isValid === false && (
            <AlertCircle size={16} className="text-red-500" />
          )}
        </div>
      </div>
      {validationError && (
        <p className="text-xs text-red-400 mt-1">{validationError}</p>
      )}
    </div>
  );
}
