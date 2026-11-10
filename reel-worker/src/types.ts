/** Render spec stored in reels.spec by the backend (backend/src/lib/reelSpec.ts). Keep in sync. */
export type Ratio = '9x16' | '16x9'

export interface Timeline {
  titleSeconds: number
  endSeconds: number
  itemSeconds: number
  transitionSeconds: number
  totalSeconds: number
}

export interface Brand {
  red: string
  sky: string
  yellow: string
  ink: string
}

export interface ReelSpec {
  version: 1
  reelId: string
  partyId: string
  title: string
  city: string | null
  dateLabel: string | null
  guestCount: number | null
  siteDomain: string
  ratios: Ratio[]
  items: Array<{ id: string; url: string }>
  sponsors: Array<{ id: string; name: string; logoUrl: string }>
  gppLogoUrl: string | null
  music: { key: string; title: string } | null
  timeline: Timeline
  brand: Brand
  outputPrefix: string
}

/** variant name -> public URL. Variants: 9x16, 16x9, 9x16_nomusic, 16x9_nomusic, poster. */
export type ReelOutputs = Record<string, string>
