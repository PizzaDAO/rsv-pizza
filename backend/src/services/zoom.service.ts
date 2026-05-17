const ZOOM_API_BASE = 'https://api.zoom.us/v2';
const ZOOM_OAUTH_URL = 'https://zoom.us/oauth/token';

// Refresh token at ~55min mark (Zoom tokens are 1hr) to give a safety margin.
const TOKEN_REFRESH_BEFORE_EXPIRY_MS = 5 * 60 * 1000;

let cachedToken: { token: string; expiresAt: number } | null = null;

export async function getZoomAccessToken(): Promise<string> {
  const now = Date.now();
  if (cachedToken && cachedToken.expiresAt > now + TOKEN_REFRESH_BEFORE_EXPIRY_MS) {
    return cachedToken.token;
  }

  const accountId = process.env.ZOOM_ACCOUNT_ID;
  const clientId = process.env.ZOOM_CLIENT_ID;
  const clientSecret = process.env.ZOOM_CLIENT_SECRET;
  if (!accountId || !clientId || !clientSecret) {
    throw new Error('Zoom credentials not configured (ZOOM_ACCOUNT_ID, ZOOM_CLIENT_ID, ZOOM_CLIENT_SECRET)');
  }

  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  const body = new URLSearchParams({
    grant_type: 'account_credentials',
    account_id: accountId,
  }).toString();

  const res = await fetch(ZOOM_OAUTH_URL, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basic}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Zoom OAuth failed (${res.status}): ${text}`);
  }

  const data = (await res.json()) as { access_token: string; expires_in: number };
  if (!data.access_token) {
    throw new Error('Zoom OAuth response missing access_token');
  }

  cachedToken = {
    token: data.access_token,
    expiresAt: now + (data.expires_in ?? 3600) * 1000,
  };
  return cachedToken.token;
}

interface RegisterParams {
  meetingId: string;
  email: string;
  firstName: string;
  lastName?: string;
}

interface RegisterResult {
  registrantId: string;
  joinUrl: string;
}

async function findExistingRegistrant(
  meetingId: string,
  email: string,
  token: string,
): Promise<RegisterResult | null> {
  const normalized = email.trim().toLowerCase();
  let pageToken: string | undefined;

  do {
    const url = new URL(`${ZOOM_API_BASE}/meetings/${meetingId}/registrants`);
    url.searchParams.set('status', 'approved');
    url.searchParams.set('page_size', '300');
    if (pageToken) url.searchParams.set('next_page_token', pageToken);

    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Zoom registrant lookup failed (${res.status}): ${text}`);
    }

    const data = (await res.json()) as {
      registrants?: Array<{ id?: string; email?: string; join_url?: string }>;
      next_page_token?: string;
    };

    const match = (data.registrants || []).find(
      (r) => (r.email || '').trim().toLowerCase() === normalized,
    );
    if (match && match.id && match.join_url) {
      return { registrantId: match.id, joinUrl: match.join_url };
    }

    pageToken = data.next_page_token || undefined;
  } while (pageToken);

  return null;
}

export async function registerForMeeting(
  params: RegisterParams,
): Promise<RegisterResult> {
  const { meetingId, email, firstName, lastName } = params;
  const token = await getZoomAccessToken();

  const res = await fetch(`${ZOOM_API_BASE}/meetings/${meetingId}/registrants`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      email,
      first_name: firstName,
      last_name: lastName ?? '',
    }),
  });

  if (res.ok) {
    const data = (await res.json()) as { registrant_id?: string; id?: string; join_url?: string };
    const registrantId = data.registrant_id || data.id || '';
    const joinUrl = data.join_url || '';
    if (!registrantId || !joinUrl) {
      throw new Error('Zoom registration response missing registrant_id or join_url');
    }
    return { registrantId, joinUrl };
  }

  // Zoom returns 300 with "Meeting registrant has already registered" or 409 on duplicates.
  if (res.status === 300 || res.status === 409) {
    const existing = await findExistingRegistrant(meetingId, email, token);
    if (existing) return existing;
    const text = await res.text();
    throw new Error(`Zoom duplicate registration but no existing registrant found: ${text}`);
  }

  const text = await res.text();
  throw new Error(`Zoom registration failed (${res.status}): ${text}`);
}
