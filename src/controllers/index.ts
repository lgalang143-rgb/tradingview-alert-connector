import * as paper from '../paper';
import express, { Router } from 'express';
import { validateAlert } from '../services';
import { DexRegistry } from '../services/dexRegistry';

const router: Router = express.Router();

/** Liveness */
router.get('/', async (_req, res) => {
  res.send('OK');
});

/** Account readiness across registered DEX adapters */
router.get('/accounts', async (_req, res) => {
  console.log('Received GET /accounts');

  const dexRegistry = new DexRegistry();
  const dexNames = ['dydxv3', 'dydxv4', 'perpetual', 'gmx', 'bluefin'];
  const dexClients = dexNames.map((name) => dexRegistry.getDex(name));

  try {
    const accountStatuses = await Promise.all(
      dexClients.map((client) => client.getIsAccountReady())
    );

    const message = {
      dYdX_v3: accountStatuses[0], // dydxv3
      dYdX_v4: accountStatuses[1], // dydxv4
      PerpetualProtocol: accountStatuses[2], // perpetual
      GMX: accountStatuses[3], // gmx
      Bluefin: accountStatuses[4], // bluefin
    };
    res.send(message);
  } catch (error) {
    console.error('Failed to get account readiness:', error);
    res.status(500).send('Internal server error');
  }
});

/**
 * Generic TradingView strategy webhook (legacy root).
 * Validates JSON, then dispatches to paper fast-path or a DexRegistry client.
 */
router.post('/', async (req, res) => {
  console.log('Received TradingView strategy alert:', req.body);

  const validated = await validateAlert(req.body);
  if (!validated) {
    return res.status(400).send('Error. alert message is not valid');
  }

  // default to dydxv3 for backwards compatibility
  const exchange = (req.body['exchange']?.toLowerCase() || 'dydxv3').trim();

  // ---- PAPER fast-path ----
  if (exchange === 'paper') {
    try {
      const result = await paper.placeOrder({
        market: req.body['market'],
        order: req.body['order'],       // "buy" | "sell"
        sizeUsd: req.body['sizeUsd'],   // preferred
        size: req.body['size'],         // fallback
        price: req.body['price'],       // required for paper (fill @ price)
        leverage: req.body['leverage'],
      });
      return res.json(result);
    } catch (e: any) {
      console.error('[paper]', e?.message || e);
      return res
        .status(400)
        .json({ ok: false, error: String(e?.message || e) });
    }
  }
  // -------------------------

  const dexClient = new DexRegistry().getDex(exchange);
  if (!dexClient) {
    return res
      .status(400)
      .send(`Error. Exchange: ${exchange} is not supported`);
  }

  // TODO: optionally add: await dexClient.assertReady();

  try {
    await dexClient.placeOrder(req.body);
    return res.send('OK');
  } catch (e) {
    console.error(`[${exchange}] placeOrder error:`, e);
    return res.status(400).send('error');
  }
});

/** Debug */
router.get('/debug-sentry', function mainHandler(_req, _res) {
  throw new Error('My first Sentry error!');
});

/* ============================================================================
 * PAPER endpoints
 * ==========================================================================*/

/**
 * Lightweight endpoint that bypasses validateAlert for paper sim.
 * Auth: requires X-Webhook-Secret (if set) and passphrase in body (if set).
 */
router.post('/paper', async (req, res) => {
  try {
    const expectedSecret = process.env.WEBHOOK_SECRET;
    const expectedPass = process.env.TRADINGVIEW_PASSPHRASE;
    const gotSecret = req.header('X-Webhook-Secret');
    const gotPass = req.body?.passphrase;

    if (expectedSecret && gotSecret !== expectedSecret) {
      return res.status(401).json({ ok: false, error: 'bad webhook secret' });
    }
    if (expectedPass && gotPass !== expectedPass) {
      return res.status(401).json({ ok: false, error: 'bad passphrase' });
    }

    const result = await paper.placeOrder({
      market: req.body['market'],
      order: req.body['order'],
      sizeUsd: req.body['sizeUsd'],
      size: req.body['size'],
      price: req.body['price'], // REQUIRED for paper to mark/fill
      leverage: req.body['leverage'],
    });
    return res.json(result);
  } catch (e: any) {
    console.error('[paper /paper]', e?.message || e);
    return res
      .status(400)
      .json({ ok: false, error: String(e?.message || e) });
  }
});

/** Inspect paper state (balances/positions/PNL) */
router.get('/paper/state', (_req, res) => {
  try {
    return res.json(paper.getState());
  } catch (e: any) {
    console.error('[paper /paper/state]', e?.message || e);
    return res
      .status(400)
      .json({ ok: false, error: String(e?.message || e) });
  }
});

/** Reset paper sim (clears trades/positions; restores USDC) */
router.post('/paper/reset', (_req, res) => {
  try {
    paper.reset();
    return res.json({ ok: true });
  } catch (e: any) {
    console.error('[paper /paper/reset]', e?.message || e);
    return res
      .status(400)
      .json({ ok: false, error: String(e?.message || e) });
  }
});

/**
 * TradingView-friendly paper endpoint: no X-Webhook-Secret header.
 * Checks passphrase in body against TRADINGVIEW_PASSPHRASE.
 */
router.post('/paper-tv', async (req, res) => {
  try {
    const expectedPass = process.env.TRADINGVIEW_PASSPHRASE;
    const gotPass = req.body?.passphrase;
    if (expectedPass && gotPass !== expectedPass) {
      return res.status(401).json({ ok: false, error: 'bad passphrase' });
    }

    const result = await paper.placeOrder({
      market: req.body['market'],
      order: req.body['order'],
      sizeUsd: req.body['sizeUsd'],
      size: req.body['size'],
      price: req.body['price'], // REQUIRED for fill
      leverage: req.body['leverage'],
    });
    return res.json(result);
  } catch (e: any) {
    console.error('[paper /paper-tv]', e?.message || e);
    return res
      .status(400)
      .json({ ok: false, error: String(e?.message || e) });
  }
});

/* ============================================================================
 * MEXC shim endpoints (use paper engine under the hood for now)
 * Switch to a real mexcAdapter when you’re ready.
 * ==========================================================================*/

/**
 * TradingView-friendly MEXC demo endpoint.
 * For now this reuses paper.placeOrder so you can see fills immediately.
 */
router.post('/mexc-tv', async (req, res) => {
  try {
    const expectedPass = process.env.TRADINGVIEW_PASSPHRASE;
    const gotPass = req.body?.passphrase;
    if (expectedPass && gotPass !== expectedPass) {
      return res.status(401).json({ ok: false, error: 'bad passphrase' });
    }

    const result = await paper.placeOrder({
      market: req.body['market'],
      order: req.body['order'],
      sizeUsd: req.body['sizeUsd'],
      size: req.body['size'],
      price: req.body['price'],
      leverage: req.body['leverage'],
    });
    return res.json({ ...result, exchange: 'mexc' });
  } catch (e: any) {
    console.error('[mexc /mexc-tv]', e?.message || e);
    return res
      .status(400)
      .json({ ok: false, error: String(e?.message || e) });
  }
});

/** Temporary MEXC state (mirrors paper state until real adapter exists) */
router.get('/mexc/state', (_req, res) => {
  try {
    return res.json({ ...paper.getState(), exchange: 'mexc' });
  } catch (e: any) {
    console.error('[mexc /mexc/state]', e?.message || e);
    return res
      .status(400)
      .json({ ok: false, error: String(e?.message || e) });
  }
});

export default router;
