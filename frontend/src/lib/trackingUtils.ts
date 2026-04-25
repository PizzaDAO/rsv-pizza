/**
 * Carrier detection utility for shipping tracking numbers.
 *
 * Priority order: UPS → USPS → DHL → FedEx
 */

const CARRIERS: { name: string; test: (num: string) => boolean; url: (num: string) => string }[] = [
  {
    name: 'UPS',
    test: (num) => /^1Z/i.test(num),
    url: (num) => `https://www.ups.com/track?tracknum=${encodeURIComponent(num)}`,
  },
  {
    name: 'USPS',
    test: (num) => /^94\d{18,}$/.test(num) || /^\d{20,22}$/.test(num),
    url: (num) => `https://tools.usps.com/go/TrackConfirmAction?tLabels=${encodeURIComponent(num)}`,
  },
  {
    name: 'DHL',
    test: (num) => /^JJD/i.test(num) || /^\d{10}$/.test(num),
    url: (num) => `https://www.dhl.com/us-en/home/tracking.html?tracking-id=${encodeURIComponent(num)}`,
  },
  {
    name: 'FedEx',
    test: (num) => /^\d{12,22}$/.test(num),
    url: (num) => `https://www.fedex.com/fedextrack/?trknbr=${encodeURIComponent(num)}`,
  },
];

/**
 * Detect the carrier name from a tracking number.
 * Returns the carrier name (e.g. "UPS") or null if not detected.
 */
export function detectCarrier(trackingNumber: string): string | null {
  const trimmed = trackingNumber.trim();
  if (!trimmed) return null;

  for (const carrier of CARRIERS) {
    if (carrier.test(trimmed)) return carrier.name;
  }
  return null;
}

/**
 * Detect a tracking URL from a tracking number.
 * Returns a full URL for the carrier tracking page, or null if not detected.
 */
export function detectTrackingUrl(trackingNumber: string): string | null {
  const trimmed = trackingNumber.trim();
  if (!trimmed) return null;

  for (const carrier of CARRIERS) {
    if (carrier.test(trimmed)) return carrier.url(trimmed);
  }
  return null;
}
