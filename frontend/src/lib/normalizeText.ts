// Common letters NFD does not decompose (no combining-mark form).
const SPECIAL: Record<string, string> = {
  ł: 'l', Ł: 'l', ø: 'o', Ø: 'o', đ: 'd', Đ: 'd', ð: 'd', Ð: 'd',
  ı: 'i', İ: 'i', ß: 'ss', æ: 'ae', Æ: 'ae', œ: 'oe', Œ: 'oe', þ: 'th',
};

/** Lowercase + strip diacritics for accent-insensitive search/compare. */
export function normalizeText(s: string | null | undefined): string {
  return (s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // strip combining marks
    .replace(/[łŁøØđĐðÐıİßæÆœŒþ]/g, (c) => SPECIAL[c] ?? c)
    .toLowerCase();
}
