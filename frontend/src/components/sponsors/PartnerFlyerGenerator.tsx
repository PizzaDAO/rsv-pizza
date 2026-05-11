import React, { useState, useEffect, useRef } from 'react';
import { Download } from 'lucide-react';
import { Sponsor } from '../../types';
import { renderPartnerFlyer } from '../flyer/renderFlyer';

interface PartnerFlyerGeneratorProps {
  sponsors: Sponsor[];
  cityName: string;
}

export function PartnerFlyerGenerator({ sponsors, cityName }: PartnerFlyerGeneratorProps) {
  const [selectedId, setSelectedId] = useState<string>(sponsors[0]?.id ?? '');
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [fontsReady, setFontsReady] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // Load fonts on mount
  useEffect(() => {
    (async () => {
      try {
        const regular = new FontFace('Hub 191', 'url(/fonts/Hub-191-Regular.otf)');
        const display = new FontFace('Hub 191 Display', 'url(/fonts/Hub-191-Display.otf)');
        const [reg, disp] = await Promise.all([regular.load(), display.load()]);
        document.fonts.add(reg);
        document.fonts.add(disp);
      } catch {
        // fallback fonts
      }
      setFontsReady(true);
    })();
  }, []);

  // Generate preview when selection changes or fonts load
  useEffect(() => {
    if (!fontsReady || !selectedId) return;
    const sponsor = sponsors.find(s => s.id === selectedId);
    if (!sponsor?.logoUrl) return;

    let cancelled = false;
    (async () => {
      try {
        const canvas = await renderPartnerFlyer(cityName, sponsor.logoUrl!);
        if (cancelled) return;
        canvasRef.current = canvas;
        setPreviewUrl(canvas.toDataURL('image/png'));
      } catch (err) {
        console.error('Failed to render partner flyer:', err);
      }
    })();

    return () => { cancelled = true; };
  }, [fontsReady, selectedId, cityName, sponsors]);

  if (sponsors.length === 0) return null;

  const selectedSponsor = sponsors.find(s => s.id === selectedId);

  const handleDownload = () => {
    if (!previewUrl || !selectedSponsor) return;
    const a = document.createElement('a');
    a.href = previewUrl;
    const safeName = selectedSponsor.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
    a.download = `partner-flyer-${safeName}.png`;
    a.click();
  };

  return (
    <div className="card bg-theme-header border-theme-stroke p-4">
      <h3 className="text-sm font-semibold text-theme-text mb-3">Partner Flyer</h3>

      <select
        value={selectedId}
        onChange={e => setSelectedId(e.target.value)}
        className="w-full mb-3 px-3 py-2 bg-theme-surface border border-theme-stroke rounded-lg text-theme-text text-sm"
      >
        {sponsors.map(s => (
          <option key={s.id} value={s.id}>{s.name}</option>
        ))}
      </select>

      {previewUrl && (
        <img
          src={previewUrl}
          alt="Partner flyer preview"
          className="w-full max-w-[400px] rounded-lg mb-3"
        />
      )}

      <button
        onClick={handleDownload}
        disabled={!previewUrl}
        className="flex items-center gap-2 px-3 py-2 bg-[#ff393a] hover:bg-[#ff393a]/80 disabled:opacity-50 text-white rounded-lg transition-colors text-sm"
      >
        <Download size={16} />
        Download
      </button>
    </div>
  );
}
