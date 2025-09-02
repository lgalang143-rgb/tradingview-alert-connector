// src/services/adapters/mexc.ts
import crypto from 'crypto';
import fetch from 'node-fetch';

type PlaceOrderBody = {
  symbol: string;        // e.g. "BTC_USDT"
  price?: string;        // optional for market
  vol: string;           // contract quantity (NOT USD); you can map from USD outside
  leverage?: string;     // e.g. "3"
  side: 1 | 2 | 3 | 4;   // 1 open long, 2 close short, 3 open short, 4 close long
  openType?: 1 | 2;      // 1 isolated, 2 cross
  orderType?: 1 | 5;     // 1 limit, 5 market
  externalOid?: string;  // client order id
};

function nowMs() { return Date.now().toString(); }

function hmacSha256Hex(message: string, secret: string) {
  return crypto.createHmac('sha256', secret).update(message).digest('hex');
}

/**
 * MEXC Futures (Contract) REST client (Demo or Main).
 * Docs (Futures): auth & headers and endpoints:
 * - Base URL: https://contract.mexc.com  (Demo: https://contract-test.mexc.com)
 * - Private headers: ApiKey, Request-Time, Signature, (optional) Recv-Window
 *
 * Auth rule: signature = HMAC_SHA256(accessKey + requestTime + paramString)
 * - For POST: paramString is the JSON string body (no sorting)
 * - For GET/DELETE: paramString is the URL-encoded query string in key-sorted order
 * Source: MEXC Integration Guide. 
 */
export class MexcClient {
  private baseUrl: string;
  private apiKey: string;
  private apiSecret: string;
  private recvWindow?: string;

  constructor(opts?: {
    baseUrl?: string;
    apiKey?: string;
    apiSecret?: string;
    recvWindow?: string;
  }) {
    this.baseUrl   = opts?.baseUrl   || process.env.MEXC_BASE_URL || 'https://contract-test.mexc.com';
    this.apiKey    = opts?.apiKey    || process.env.MEXC_API_KEY  || '';
    this.apiSecret = opts?.apiSecret || process.env.MEXC_API_SECRET || '';
    this.recvWindow = opts?.recvWindow || process.env.MEXC_RECV_WINDOW; // e.g. "20"
    if (!this.apiKey || !this.apiSecret) {
      console.warn('[MEXC] Missing API key/secret; private endpoints will fail.');
    }
  }

  private headersForPrivate(postBody?: any) {
    const reqTime = nowMs();
    const paramString = postBody ? JSON.stringify(postBody) : '';
    const signature = hmacSha256Hex(this.apiKey + reqTime + paramString, this.apiSecret);

    const h: Record<string, string> = {
      'ApiKey': this.apiKey,
      'Request-Time': reqTime,
      'Signature': signature,
      'Content-Type': 'application/json',
    };
    if (this.recvWindow) h['Recv-Window'] = this.recvWindow;
    return h;
  }

  // ---------- Public (no auth) ----------

  async ping() {
    const url = `${this.baseUrl}/api/v1/contract/ping`;
    const r = await fetch(url);
    return r.json();
  }

  // ---------- Private (auth) ----------

  /** GET all assets */
  async getAssets() {
    const path = `/api/v1/private/account/assets`;
    const url = `${this.baseUrl}${path}`;
    const r = await fetch(url, { headers: this.headersForPrivate() });
    return r.json();
  }

  /** GET open positions (optionally symbol) */
  async getOpenPositions(symbol?: string) {
    const qs = symbol ? `/${encodeURIComponent(symbol)}` : '';
    // Some docs show .../open_positions with symbol as query;
    // use the generic path then add ?symbol= if provided:
    const url = `${this.baseUrl}/api/v1/private/position/open_positions${symbol ? `?symbol=${encodeURIComponent(symbol)}` : ''}`;
    const r = await fetch(url, { headers: this.headersForPrivate() });
    return r.json();
  }

  /** GET open orders (optionally symbol) */
  async getOpenOrders(symbol?: string) {
    const url = `${this.baseUrl}/api/v1/private/order/list/open_orders/${symbol ? encodeURIComponent(symbol) : ''}`;
    const r = await fetch(url, { headers: this.headersForPrivate() });
    return r.json();
  }

  /** POST place order */
  async submitOrder(b: PlaceOrderBody) {
    const path = `/api/v1/private/order/submit`;
    const url = `${this.baseUrl}${path}`;
    const headers = this.headersForPrivate(b);
    const r = await fetch(url, { method: 'POST', headers, body: JSON.stringify(b) });
    const j = await r.json();
    if (!r.ok || j?.success === false) {
      throw new Error(`MEXC submitOrder failed: HTTP ${r.status} ${r.statusText} ${JSON.stringify(j)}`);
    }
    return j;
  }
}
