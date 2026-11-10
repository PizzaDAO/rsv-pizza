/**
 * basil-14648: typed client for pizza-mcp's Open Pizza Ordering Protocol (OPOP).
 *
 * Types come from pizza-mcp's spec (openapi/pizza-mcp.openapi.json -> pizzaMcp.types.ts via
 * `npm run gen:pizza-mcp`). Every call:
 *   - mints its own 60 s ES256 JWT for the acting host (lib/pizzaMcpToken.ts),
 *   - maps an RFC 9457 problem+json answer to an AppError (code kept, `opop` payload attached
 *     so the UI can show `ask_user` / suggestions),
 *   - never forwards pizza-mcp 401/403 to the browser (the frontend treats a 401 as "log out").
 * `POST /orders` sends Idempotency-Key = sha256(partyId + recommendationVersion + shopId).
 * RSV never computes a binding price, never talks to Bland and never sees an OTP.
 */
import crypto from 'node:crypto';
import { AppError } from '../middleware/error.js';
import { mintPizzaMcpToken, pizzaMcpBaseUrl } from '../lib/pizzaMcpToken.js';
import type { components } from './pizzaMcp.types.js';

type S = components['schemas'];
export type OpopPizzeria = S['Pizzeria'];
export type OpopMenu = S['OpmsMenu'];
export type OpopResolveResult = S['ResolveResult'];
export type OpopCartRequest = S['CartRequest'];
export type OpopCart = S['Cart'];
export type OpopQuoteRequest = S['QuoteRequest'];
export type OpopQuote = S['Quote'];
export type OpopPlaceOrderRequest = S['PlaceOrderRequest'];
export type OpopPlaceOrderResult = S['PlaceOrderResult'];
export type OpopOrder = S['Order'];
export type OpopProblem = S['Problem'];
export type OpopOrderingLink = S['OrderingLink'];
export type OpopChecklist = S['Checklist'];
export type OpopHostMenuResult = S['HostMenuResult'];
export type OpopHostMenuDeleteResult = S['HostMenuDeleteResult'];
/** What rsv forwards for a host menu: the sniffed files (bytes and the type their bytes say), or a link. */
export type HostMenuInput = { kind: 'files'; files: Array<{ bytes: Buffer; mime: string }> } | { kind: 'url'; url: string };
/** pizza-mcp's handoff providers (ORDERING_PROVIDERS). */
export const OPOP_ORDERING_PROVIDERS = ['toast', 'square_online', 'chownow', 'slice', 'bentobox', 'website'] as const;
export type OpopOrderingProvider = (typeof OPOP_ORDERING_PROVIDERS)[number];

/**
 * What rsv reads of pizza-mcp's approval-page view (`GET /confirmations/{id}`, a public endpoint). It is not in the
 * spec (the response there is untyped), so this is the subset rsv relies on, from pizza-mcp 64fb2ac
 * `ConfirmationView` (services/listing-approval.ts). Every field is optional here: an older pizza-mcp omits them.
 */
export interface OpopConfirmation {
  id: string;
  kind?: 'place' | 'price_increase';
  status?: string;
  expires_at?: string;
  /** A price approval while the shop holds the line: when the hold ends (ISO). null otherwise. */
  hold_until?: string | null;
  /** Whether approving can still do anything (pending, unexpired, and the order still waiting on it). */
  live?: boolean;
  ended_by?: 'host' | 'too_many_codes' | 'client' | null;
  client_name?: string | null;
  party_name?: string | null;
}

/** Who is acting. The token is minted from this on every request. */
export interface OpopActor {
  userId: string;
  email?: string | null;
  partyId?: string;
}

export interface PizzaMcpClientOptions {
  /** Test seam: a fake pizza-mcp HTTP layer. Defaults to global fetch. */
  fetchImpl?: typeof fetch;
  baseUrl?: string;
  timeoutMs?: number;
}

const API_PREFIX = '/api/v1';
const DEFAULT_TIMEOUT_MS = 20_000;

/** sha256(partyId + recommendationVersion + shopId), hex. 64 chars: inside OPOP's 8-100 limit. */
export function orderIdempotencyKey(
  partyId: string,
  recommendationVersion: string,
  shopId: string,
  attempt = 0
): string {
  // `attempt` is 0 for the first try. A host who explicitly re-orders after a terminal
  // failure sends attempt >= 1 so the old (refused/unreachable) order is not replayed.
  const material = partyId + recommendationVersion + shopId + (attempt > 0 ? `#${attempt}` : '');
  return crypto.createHash('sha256').update(material).digest('hex');
}

/** Map an OPOP problem+json to the AppError the Express error handler renders. */
export function problemToAppError(status: number, body: unknown): AppError {
  const p = (body && typeof body === 'object' ? body : {}) as Partial<OpopProblem> & Record<string, unknown>;
  const code = typeof p.code === 'string' && p.code ? p.code : 'PIZZA_MCP_ERROR';
  const message =
    (typeof p.detail === 'string' && p.detail) || (typeof p.title === 'string' && p.title) || 'Ordering service error';
  const opop = {
    ask_user: p.ask_user ?? null,
    suggestions: p.suggestions ?? null,
    details: p.details ?? null,
    retryable: p.retryable ?? false,
    path: p.path ?? null,
  };
  // Our own credentials are wrong or not trusted: that is a server problem, not the browser's.
  if (status === 401 || code === 'UNAUTHENTICATED' || code === 'INVALID_CLIENT' || code === 'INSUFFICIENT_SCOPE') {
    return new AppError('Ordering service rejected our credentials', 502, 'PIZZA_MCP_AUTH');
  }
  if (status >= 500) {
    return new AppError(message, 502, code === 'INTERNAL' ? 'PIZZA_MCP_UNAVAILABLE' : code, { opop });
  }
  return new AppError(message, status >= 400 ? status : 502, code, { opop });
}

export class PizzaMcpClient {
  private readonly fetchImpl: typeof fetch;
  private readonly baseUrl: string | null;
  private readonly timeoutMs: number;

  constructor(opts: PizzaMcpClientOptions = {}) {
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.baseUrl = (opts.baseUrl ?? pizzaMcpBaseUrl())?.replace(/\/+$/, '') ?? null;
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  /** `actor: null` sends no token: only for pizza-mcp's public (human page) endpoints. */
  private async request<T>(
    actor: OpopActor | null,
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
    path: string,
    opts: {
      query?: Record<string, string | number | boolean | undefined>;
      body?: unknown;
      headers?: Record<string, string>;
      timeoutMs?: number;
      /** The endpoint answers 204 No Content: resolve with null instead of "unexpected response". */
      noContent?: boolean;
      /** A ready body (multipart FormData): sent as is, fetch sets its own Content-Type with the boundary. */
      rawBody?: FormData;
    } = {}
  ): Promise<T> {
    if (!this.baseUrl) throw new AppError('Ordering is not configured', 503, 'PIZZA_MCP_NOT_CONFIGURED');
    let token: string | null = null;
    if (actor) {
      try {
        token = mintPizzaMcpToken(actor);
      } catch {
        throw new AppError('Ordering is not configured', 503, 'PIZZA_MCP_NOT_CONFIGURED');
      }
    }
    const url = new URL(`${this.baseUrl}${API_PREFIX}${path}`);
    for (const [k, v] of Object.entries(opts.query ?? {})) {
      if (v !== undefined && v !== '') url.searchParams.set(k, String(v));
    }
    let res: Response;
    try {
      res = await this.fetchImpl(url.toString(), {
        method,
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          Accept: 'application/json',
          ...(opts.body !== undefined && !opts.rawBody ? { 'Content-Type': 'application/json' } : {}),
          ...opts.headers,
        },
        body: opts.rawBody ?? (opts.body !== undefined ? JSON.stringify(opts.body) : undefined),
        redirect: 'error',
        signal: AbortSignal.timeout(opts.timeoutMs ?? this.timeoutMs),
      });
    } catch {
      throw new AppError('The ordering service is unreachable. Try again in a minute.', 502, 'PIZZA_MCP_UNAVAILABLE');
    }
    const text = await res.text();
    let json: unknown = null;
    if (text) {
      try {
        json = JSON.parse(text);
      } catch {
        json = null;
      }
    }
    if (!res.ok) throw problemToAppError(res.status, json);
    if (opts.noContent && (res.status === 204 || json === null)) return null as T;
    if (json === null) throw new AppError('Unexpected response from the ordering service', 502, 'PIZZA_MCP_BAD_RESPONSE');
    return json as T;
  }

  findShops(actor: OpopActor, q: { near: string; radius_km?: number; q?: string }) {
    return this.request<{ pizzerias: OpopPizzeria[]; note?: string }>(actor, 'GET', '/pizzerias', {
      query: { near: q.near, radius_km: q.radius_km, q: q.q, fulfillment: 'pickup' },
    });
  }

  getShop(actor: OpopActor, shopId: string) {
    return this.request<OpopPizzeria>(actor, 'GET', `/pizzerias/${encodeURIComponent(shopId)}`);
  }

  getMenu(actor: OpopActor, shopId: string) {
    return this.request<OpopMenu>(actor, 'GET', `/pizzerias/${encodeURIComponent(shopId)}/menu`);
  }

  resolve(actor: OpopActor, shopId: string, text: string) {
    return this.request<OpopResolveResult>(actor, 'POST', `/pizzerias/${encodeURIComponent(shopId)}/menu/resolve`, {
      body: { text },
    });
  }

  createCart(actor: OpopActor, body: OpopCartRequest) {
    return this.request<OpopCart>(actor, 'POST', '/carts', { body });
  }

  updateCart(actor: OpopActor, cartId: string, body: OpopCartRequest, ifMatch?: number) {
    return this.request<OpopCart>(actor, 'PATCH', `/carts/${encodeURIComponent(cartId)}`, {
      body,
      headers: ifMatch !== undefined ? { 'If-Match': String(ifMatch) } : undefined,
    });
  }

  getCart(actor: OpopActor, cartId: string) {
    return this.request<OpopCart>(actor, 'GET', `/carts/${encodeURIComponent(cartId)}`);
  }

  quote(actor: OpopActor, cartId: string, body: OpopQuoteRequest) {
    return this.request<OpopQuote>(actor, 'POST', `/carts/${encodeURIComponent(cartId)}/quote`, { body });
  }

  placeOrder(actor: OpopActor, body: OpopPlaceOrderRequest, idempotencyKey: string) {
    return this.request<OpopPlaceOrderResult>(actor, 'POST', '/orders', {
      body,
      headers: { 'Idempotency-Key': idempotencyKey },
    });
  }

  cancelOrder(actor: OpopActor, orderId: string, reason = 'customer_request') {
    return this.request<OpopOrder>(actor, 'POST', `/orders/${encodeURIComponent(orderId)}/cancel`, { body: { reason } });
  }

  getOrder(actor: OpopActor, orderId: string) {
    return this.request<OpopOrder>(actor, 'GET', `/orders/${encodeURIComponent(orderId)}`);
  }

  /** basil-14648 P2: the host adds the shop's own ordering page. Private to that host on pizza-mcp (422 LINK_NOT_RECOGNIZED). */
  addOrderingLink(actor: OpopActor, shopId: string, url: string) {
    return this.request<OpopOrderingLink>(actor, 'POST', `/pizzerias/${encodeURIComponent(shopId)}/ordering-links`, { body: { url } });
  }

  deleteOrderingLink(actor: OpopActor, shopId: string, linkId: string) {
    return this.request<null>(actor, 'DELETE', `/pizzerias/${encodeURIComponent(shopId)}/ordering-links/${encodeURIComponent(linkId)}`, {
      noContent: true,
    });
  }

  /** Aggregate funnel counter on pizza-mcp (204). Needs a cart this host owns; stores no principal, cart or party. */
  recordHandoff(actor: OpopActor, cartId: string, body: { provider: OpopOrderingProvider; event: 'opened' | 'marked_ordered' | 'unmarked' }) {
    return this.request<null>(actor, 'POST', `/carts/${encodeURIComponent(cartId)}/handoff`, { body, noContent: true, timeoutMs: 5000 });
  }

  /**
   * basil-14648 P2: the host's own menu for a listing shop (pizza-mcp #5/#8, behind its HOST_MENUS switch). Photos
   * or a PDF go as multipart `files[]` (rsv has already checked the bytes), a link as JSON. Private to this host on
   * pizza-mcp: it only changes THEIR new carts. A vision read can take 15-40 s, hence the long timeout.
   */
  submitHostMenu(actor: OpopActor, shopId: string, input: HostMenuInput) {
    const path = `/pizzerias/${encodeURIComponent(shopId)}/menu/host`;
    if (input.kind === 'url') return this.request<OpopHostMenuResult>(actor, 'POST', path, { body: { url: input.url }, timeoutMs: 60_000 });
    const form = new FormData();
    input.files.forEach((f, i) => {
      const ext = f.mime === 'application/pdf' ? 'pdf' : f.mime.split('/')[1];
      // the Buffer itself (a Uint8Array view): Blob copies exactly its bytes, once
      form.append('files[]', new Blob([f.bytes as Uint8Array<ArrayBuffer>], { type: f.mime }), `menu-${i + 1}.${ext}`);
    });
    return this.request<OpopHostMenuResult>(actor, 'POST', path, { rawBody: form, timeoutMs: 60_000 });
  }

  /** Stop using this host's menu for new carts (carts already built keep theirs until they are rebuilt). */
  deleteHostMenu(actor: OpopActor, shopId: string) {
    return this.request<OpopHostMenuDeleteResult>(actor, 'DELETE', `/pizzerias/${encodeURIComponent(shopId)}/menu/host`);
  }

  /**
   * The approval page's view of one confirmation. Public on pizza-mcp (the page reads it with no login), so no token
   * is minted: this also works from the webhook, where no host is acting. Short timeout: callers treat a failure as
   * "no extra detail", never as an error.
   */
  getConfirmation(confirmationId: string, timeoutMs = 3000) {
    return this.request<OpopConfirmation>(null, 'GET', `/confirmations/${encodeURIComponent(confirmationId)}`, { timeoutMs });
  }
}

let shared: PizzaMcpClient | null = null;
export function getPizzaMcpClient(): PizzaMcpClient {
  return (shared ??= new PizzaMcpClient());
}
/** Test seam: swap the shared client (pass null to reset). */
export function setPizzaMcpClientForTests(c: PizzaMcpClient | null) {
  shared = c;
}
