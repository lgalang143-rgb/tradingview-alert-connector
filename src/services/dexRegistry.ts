// src/services/dexRegistry.ts
import { MexcClient } from './adapters/mexc';
// ...existing imports...

export class DexRegistry {
  getDex(name: string) {
    const key = (name || '').toLowerCase();
    switch (key) {
      // ...existing exchanges...
      case 'mexc':
        return new MexcDexAdapter(); // see below
      default:
        return undefined;
    }
  }
}

/** Thin Dex-like wrapper so TAC can call placeOrder(req.body) */
class MexcDexAdapter {
  private mexc = new MexcClient();

  async getIsAccountReady() {
    try {
      const assets = await this.mexc.getAssets();
      return !!assets?.success;
    } catch {
      return false;
    }
  }

  /**
   * Expects TAC alert body fields:
   * - market: "BTC_USDT"
   * - order: "buy" | "sell"
   * - sizeUsd: string (we’ll convert to contracts roughly by price)
   * - price: optional for market
   * - leverage: optional
   *
   * NOTE: On MEXC futures, `vol` is contract quantity, not USD.
   * For a simple first pass: 1 contract ~ 1 USD notional on major pairs (adjust if needed).
   */
  async placeOrder(body: any) {
    const symbol = body.market || 'BTC_USDT';
    const sideWord = (body.order || '').toLowerCase(); // "buy" | "sell"
    const orderType: 1 | 5 = body.price ? 1 : 5; // limit if price given, else market
    const openType: 1 | 2 = 1;                   // default isolated
    const leverage = body.leverage ? String(body.leverage) : undefined;

    // Very simple USD->contracts mapping for demo:
    const sizeUsd = Number(body.sizeUsd || body.size || '10');
    const vol = String(Math.max(1, Math.floor(sizeUsd))); // naive 1 contract ~= 1 USD

    // Side mapping (simplest): buy = open long (1), sell = open short (3).
    // For closing logic you’ll map to 2/4 depending on position direction.
    const side: 1 | 3 = sideWord === 'sell' ? 3 : 1;

    const req = {
      symbol,
      vol,
      price: body.price ? String(body.price) : undefined,
      leverage,
      side,              // 1 open long, 3 open short
      openType,          // 1 isolated
      orderType,         // 1 limit, 5 market
      externalOid: `tac-${Date.now()}`,
    };

    return this.mexc.submitOrder(req);
  }

  async getState() {
    const [assets, positions, orders] = await Promise.all([
      this.mexc.getAssets(),
      this.mexc.getOpenPositions(),
      this.mexc.getOpenOrders(),
    ]);
    return { assets, positions, orders };
  }
}
