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

  private async request<T>(
    actor: OpopActor,
    method: 'GET' | 'POST' | 'PATCH',
    path: string,
    opts: { query?: Record<string, string | number | boolean | undefined>; body?: unknown; headers?: Record<string, string> } = {}
  ): Promise<T> {
    if (!this.baseUrl) throw new AppError('Ordering is not configured', 503, 'PIZZA_MCP_NOT_CONFIGURED');
    let token: string;
    try {
      token = mintPizzaMcpToken(actor);
    } catch {
      throw new AppError('Ordering is not configured', 503, 'PIZZA_MCP_NOT_CONFIGURED');
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
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
          ...(opts.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
          ...opts.headers,
        },
        body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
        redirect: 'error',
        signal: AbortSignal.timeout(this.timeoutMs),
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
}

let shared: PizzaMcpClient | null = null;
export function getPizzaMcpClient(): PizzaMcpClient {
  return (shared ??= new PizzaMcpClient());
}
/** Test seam: swap the shared client (pass null to reset). */
export function setPizzaMcpClientForTests(c: PizzaMcpClient | null) {
  shared = c;
}
