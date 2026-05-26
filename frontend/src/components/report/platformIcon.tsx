import React from 'react';
import { Instagram, Youtube, Linkedin, Globe, Facebook } from 'lucide-react';

// pecorino-64118: shared platform-icon helpers, extracted from PartnerDashboardPage
// so both the dashboard and the consolidated report render the same real-logo SVGs.

// Detect platform from URL domain
export function detectPlatform(url: string): string {
  try {
    const host = new URL(url).hostname.replace('www.', '');
    if (host.includes('instagram.com')) return 'Instagram';
    if (host.includes('twitter.com') || host.includes('x.com')) return 'X';
    if (host.includes('youtube.com') || host.includes('youtu.be')) return 'YouTube';
    if (host.includes('tiktok.com')) return 'TikTok';
    if (host.includes('linkedin.com')) return 'LinkedIn';
    if (host.includes('facebook.com') || host.includes('fb.com')) return 'Facebook';
    if (host.includes('farcaster') || host.includes('warpcast.com')) return 'Farcaster';
    return 'Website';
  } catch {
    return 'Website';
  }
}

// X (Twitter) icon
const XIcon: React.FC<{ size: number }> = ({ size }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
    <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
  </svg>
);

// TikTok icon
const TikTokIcon: React.FC<{ size: number }> = ({ size }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
    <path d="M19.59 6.69a4.83 4.83 0 01-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 01-5.2 1.74 2.89 2.89 0 012.31-4.64 2.93 2.93 0 01.88.13V9.4a6.84 6.84 0 00-1-.05A6.33 6.33 0 005 20.1a6.34 6.34 0 0010.86-4.43v-7a8.16 8.16 0 004.77 1.52v-3.4a4.85 4.85 0 01-1-.1z" />
  </svg>
);

// Farcaster icon
const FarcasterIcon: React.FC<{ size: number }> = ({ size }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
    <path d="M5.315 3.401h13.37v17.198h-1.689V7.68H6.998v12.919H5.315V3.401zm3.371 7.674h6.628v1.414h-6.628v-1.414z" />
  </svg>
);

export function PlatformIcon({ platform, size = 12 }: { platform: string; size?: number }) {
  switch (platform) {
    case 'Instagram': return <Instagram size={size} />;
    case 'X': return <XIcon size={size} />;
    case 'YouTube': return <Youtube size={size} />;
    case 'TikTok': return <TikTokIcon size={size} />;
    case 'LinkedIn': return <Linkedin size={size} />;
    case 'Facebook': return <Facebook size={size} />;
    case 'Farcaster': return <FarcasterIcon size={size} />;
    default: return <Globe size={size} />;
  }
}
