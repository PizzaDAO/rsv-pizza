import { useState } from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';

const STORAGE_KEY = 'gppPromoBannerDismissed';

function readDismissed(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

/** Red "Planning a Global Pizza Party?" promo; dismissal is remembered in localStorage. */
export function DismissibleGppBanner({ message }: { message: string }) {
  const { t } = useTranslation('common');
  const [dismissed, setDismissed] = useState(readDismissed);
  if (dismissed) return null;
  return (
    <div className="relative bg-gradient-to-r from-[#ff393a] to-[#ff5a5b] text-white">
      <Link to="/gpp" className="block text-center py-3 pl-4 pr-12 text-sm font-medium hover:opacity-90 transition-opacity">
        {message}
      </Link>
      <button
        type="button"
        aria-label={t('banner.dismiss')}
        onClick={() => {
          try {
            localStorage.setItem(STORAGE_KEY, '1');
          } catch {
            /* storage unavailable: dismiss for this view only */
          }
          setDismissed(true);
        }}
        className="absolute right-2 top-1/2 -translate-y-1/2 p-2 rounded hover:bg-white/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
      >
        <X size={16} />
      </button>
    </div>
  );
}
