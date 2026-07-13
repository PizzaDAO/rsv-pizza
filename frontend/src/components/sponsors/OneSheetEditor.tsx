import React, { useState } from 'react';
import {
  Plus,
  X,
  Trash2,
  Save,
  Check,
  ExternalLink,
  Type,
  FileText,
  Tag,
  DollarSign,
  ListChecks,
} from 'lucide-react';
import { IconInput } from '../IconInput';
import { updateParty } from '../../lib/supabase';
import { uuid } from '../../lib/utils';
import type { Party, OneSheetConfig, OneSheetTier, OneSheetSection } from '../../types';

interface OneSheetEditorProps {
  party: Party;
  onSaved?: (config: OneSheetConfig) => void;
}

// focaccina-58550: host editor for the customizable public one-sheet
// (/onesheet/:slug). Edits headline/blurb, sponsorship pricing tiers, and
// free-text detail sections; the public page renders them read-only.
export function OneSheetEditor({ party, onSaved }: OneSheetEditorProps) {
  const initial = party.oneSheetConfig ?? {};
  const [headline, setHeadline] = useState<string>(initial.headline ?? '');
  const [blurb, setBlurb] = useState<string>(initial.blurb ?? '');
  const [tiers, setTiers] = useState<OneSheetTier[]>(
    (initial.tiers ?? []).map((t) => ({
      id: t.id || uuid(),
      name: t.name ?? '',
      price: t.price ?? '',
      benefits: Array.isArray(t.benefits) ? [...t.benefits] : [],
    }))
  );
  const [sections, setSections] = useState<OneSheetSection[]>(
    (initial.sections ?? []).map((s) => ({
      id: s.id || uuid(),
      heading: s.heading ?? '',
      body: s.body ?? '',
    }))
  );

  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Tier helpers
  const addTier = () =>
    setTiers((prev) => [...prev, { id: uuid(), name: '', price: '', benefits: [] }]);
  const removeTier = (id: string) => setTiers((prev) => prev.filter((t) => t.id !== id));
  const updateTier = (id: string, patch: Partial<OneSheetTier>) =>
    setTiers((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  const addBenefit = (tierId: string) =>
    updateTierBenefits(tierId, (b) => [...b, '']);
  const removeBenefit = (tierId: string, index: number) =>
    updateTierBenefits(tierId, (b) => b.filter((_, i) => i !== index));
  const setBenefit = (tierId: string, index: number, value: string) =>
    updateTierBenefits(tierId, (b) => b.map((x, i) => (i === index ? value : x)));
  function updateTierBenefits(tierId: string, fn: (benefits: string[]) => string[]) {
    setTiers((prev) =>
      prev.map((t) => (t.id === tierId ? { ...t, benefits: fn(t.benefits) } : t))
    );
  }

  // Section helpers
  const addSection = () =>
    setSections((prev) => [...prev, { id: uuid(), heading: '', body: '' }]);
  const removeSection = (id: string) =>
    setSections((prev) => prev.filter((s) => s.id !== id));
  const updateSection = (id: string, patch: Partial<OneSheetSection>) =>
    setSections((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)));

  // Build a cleaned config: drop empty strings/benefits and fully-empty entries.
  const buildConfig = (): OneSheetConfig => {
    const cfg: OneSheetConfig = {};
    const h = headline.trim();
    const b = blurb.trim();
    if (h) cfg.headline = h;
    if (b) cfg.blurb = b;

    const cleanTiers = tiers
      .map((t) => ({
        id: t.id,
        name: (t.name ?? '').trim(),
        price: (t.price ?? '').trim(),
        benefits: t.benefits.map((x) => x.trim()).filter(Boolean),
      }))
      .filter((t) => t.name || t.price || t.benefits.length > 0)
      .map((t) => {
        const tier: OneSheetTier = { id: t.id, name: t.name, benefits: t.benefits };
        if (t.price) tier.price = t.price;
        return tier;
      });
    if (cleanTiers.length > 0) cfg.tiers = cleanTiers;

    const cleanSections = sections
      .map((s) => ({
        id: s.id,
        heading: (s.heading ?? '').trim(),
        body: (s.body ?? '').trim(),
      }))
      .filter((s) => s.heading || s.body);
    if (cleanSections.length > 0) cfg.sections = cleanSections;

    return cfg;
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      const config = buildConfig();
      const ok = await updateParty(party.id, { one_sheet_config: config });
      if (!ok) {
        setError('Could not save. Please try again.');
        return;
      }
      onSaved?.(config);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const oneSheetUrl = `/onesheet/${party.customUrl || party.inviteCode}`;

  return (
    <div className="card bg-theme-header border-theme-stroke p-4 space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-theme-text">One Sheet</h2>
          <p className="text-xs text-theme-text-faint mt-0.5">
            Customize your public sponsorship one sheet — headline, pricing packages, and detail sections.
          </p>
        </div>
        <a
          href={oneSheetUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1.5 px-3 py-2 text-sm rounded-lg bg-white/5 hover:bg-white/10 text-theme-text transition-colors shrink-0"
        >
          <ExternalLink size={16} />
          <span className="hidden sm:inline">View one sheet</span>
        </a>
      </div>

      {/* Intro headline + blurb */}
      <div className="space-y-3">
        <IconInput
          icon={Type}
          type="text"
          placeholder="Headline (e.g. Partner with us this year)"
          value={headline}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setHeadline(e.target.value)}
          maxLength={120}
        />
        <IconInput
          icon={FileText}
          multiline
          rows={3}
          placeholder="Intro blurb — a short paragraph shown under the flyer"
          value={blurb}
          onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setBlurb(e.target.value)}
          maxLength={2000}
        />
      </div>

      {/* Pricing tiers */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-theme-text">Sponsorship packages</h3>
          <button
            type="button"
            onClick={addTier}
            className="flex items-center gap-1.5 px-2.5 py-1.5 text-sm rounded-lg bg-white/5 hover:bg-white/10 text-theme-text transition-colors"
          >
            <Plus size={16} />
            Add package
          </button>
        </div>

        {tiers.map((tier) => (
          <div
            key={tier.id}
            className="rounded-xl bg-white/5 border border-theme-stroke p-3 space-y-3"
          >
            <div className="flex items-start gap-2">
              <div className="flex-1 space-y-3">
                <IconInput
                  icon={Tag}
                  type="text"
                  placeholder="Package name (e.g. Gold)"
                  value={tier.name}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                    updateTier(tier.id, { name: e.target.value })
                  }
                  maxLength={120}
                />
                <IconInput
                  icon={DollarSign}
                  type="text"
                  placeholder="Price (e.g. $500, In-kind, Contact us)"
                  value={tier.price ?? ''}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                    updateTier(tier.id, { price: e.target.value })
                  }
                  maxLength={60}
                />
              </div>
              <button
                type="button"
                onClick={() => removeTier(tier.id)}
                title="Remove package"
                className="p-2 rounded-lg text-theme-text-muted hover:text-red-400 hover:bg-white/5 transition-colors shrink-0"
              >
                <Trash2 size={16} />
              </button>
            </div>

            {/* Benefits */}
            <div className="space-y-2 pl-1">
              {tier.benefits.map((benefit, i) => (
                <div key={i} className="flex items-center gap-2">
                  <div className="flex-1">
                    <IconInput
                      icon={ListChecks}
                      type="text"
                      placeholder="Benefit (e.g. Logo on flyer)"
                      value={benefit}
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                        setBenefit(tier.id, i, e.target.value)
                      }
                      maxLength={200}
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => removeBenefit(tier.id, i)}
                    title="Remove benefit"
                    className="p-2 rounded-lg text-theme-text-muted hover:text-red-400 hover:bg-white/5 transition-colors shrink-0"
                  >
                    <X size={16} />
                  </button>
                </div>
              ))}
              <button
                type="button"
                onClick={() => addBenefit(tier.id)}
                className="flex items-center gap-1.5 text-xs text-theme-text-muted hover:text-theme-text transition-colors"
              >
                <Plus size={14} />
                Add benefit
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Detail sections */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-theme-text">Detail sections</h3>
          <button
            type="button"
            onClick={addSection}
            className="flex items-center gap-1.5 px-2.5 py-1.5 text-sm rounded-lg bg-white/5 hover:bg-white/10 text-theme-text transition-colors"
          >
            <Plus size={16} />
            Add section
          </button>
        </div>

        {sections.map((section) => (
          <div
            key={section.id}
            className="rounded-xl bg-white/5 border border-theme-stroke p-3 space-y-3"
          >
            <div className="flex items-start gap-2">
              <div className="flex-1 space-y-3">
                <IconInput
                  icon={Tag}
                  type="text"
                  placeholder="Section heading (e.g. About the event)"
                  value={section.heading}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                    updateSection(section.id, { heading: e.target.value })
                  }
                  maxLength={120}
                />
                <IconInput
                  icon={FileText}
                  multiline
                  rows={3}
                  placeholder="Section body — free text shown on the one sheet"
                  value={section.body}
                  onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) =>
                    updateSection(section.id, { body: e.target.value })
                  }
                  maxLength={4000}
                />
              </div>
              <button
                type="button"
                onClick={() => removeSection(section.id)}
                title="Remove section"
                className="p-2 rounded-lg text-theme-text-muted hover:text-red-400 hover:bg-white/5 transition-colors shrink-0"
              >
                <Trash2 size={16} />
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Save */}
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[#ff393a] hover:bg-[#ff393a]/80 text-white font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {saved ? <Check size={18} /> : <Save size={18} />}
          {saving ? 'Saving…' : saved ? 'Saved' : 'Save one sheet'}
        </button>
        {error && <span className="text-sm text-red-400">{error}</span>}
      </div>
    </div>
  );
}
