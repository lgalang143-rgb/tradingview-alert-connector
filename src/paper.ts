// src/paper.ts
type Side = "buy" | "sell";
type Market = string; // e.g. "BTC_USD"

interface Fill { ts:number; market:Market; side:Side; qty:number; price:number; notional:number; leverage:number; }
interface Position { side:"long"|"short"|"flat"; base:number; entry:number; leverage:number; realizedPnl:number; }
interface State { balances:{USDC:number}; lastPrice:Record<Market,number|undefined>; positions:Record<Market,Position>; trades:Fill[]; }

const startUSDC = Number(process.env.PAPER_BASE_USDC || 10_000);
const defaultLev = Number(process.env.PAPER_DEFAULT_LEVERAGE || 2);

const state: State = { balances:{USDC:startUSDC}, lastPrice:{}, positions:{}, trades:[] };

function mark(market: Market, price?: number) {
  if (price) state.lastPrice[market] = price;
  return state.lastPrice[market];
}
function ensurePos(market: Market): Position {
  if (!state.positions[market]) state.positions[market] = { side:"flat", base:0, entry:0, leverage:defaultLev, realizedPnl:0 };
  return state.positions[market];
}
function applyFill(market:Market, side:Side, qty:number, price:number, lev:number){
  const pos = ensurePos(market); const dir = side==="buy"?+1:-1; const baseDelta = dir*qty;
  if (pos.base===0 || Math.sign(pos.base)===Math.sign(baseDelta)) {
    const oldNotional = Math.abs(pos.base)*pos.entry; const newBase = pos.base+baseDelta; const addNotional = Math.abs(baseDelta)*price;
    pos.entry = newBase!==0 ? (oldNotional+addNotional)/Math.abs(newBase) : 0;
    pos.base = newBase; pos.side = pos.base>0?"long":pos.base<0?"short":"flat"; pos.leverage = lev;
  } else {
    const reduce = Math.min(Math.abs(pos.base), Math.abs(baseDelta))*Math.sign(baseDelta);
    const reducedAbs = Math.abs(reduce); const pnlPerUnit = (pos.base>0?(price-pos.entry):(pos.entry-price));
    pos.realizedPnl += pnlPerUnit*reducedAbs; pos.base += baseDelta;
    if (pos.base===0){ pos.side="flat"; pos.entry=0; } else if (Math.sign(pos.base)!==Math.sign(reduce)){ pos.entry=price; pos.side=pos.base>0?"long":"short"; pos.leverage=lev; }
  }
}

export async function init(){ console.log(`[paper] starting with USDC=${state.balances.USDC}`); }
export async function accounts(){ return { Paper:true }; }

export async function placeOrder(params:{ market:Market; order:Side; sizeUsd?:string|number; size?:string|number; price?:string|number; leverage?:string|number; }){
  const market = params.market; const side:Side = params.order; const lev = Number(params.leverage ?? defaultLev);
  const pHint = params.price!=null ? Number(params.price) : undefined; const p = mark(market, pHint);
  if (!p) throw new Error(`[paper] no price for ${market} (pass "price" in alert JSON)`);
  const sizeUsd = params.sizeUsd!=null ? Number(params.sizeUsd) : undefined; const qty = sizeUsd!=null ? (sizeUsd/p) : Number(params.size ?? 0);
  if (!qty || qty<=0) throw new Error(`[paper] invalid qty/sizeUsd`);
  const notional = qty*p; const maxNotional = state.balances.USDC*lev;
  if (notional>maxNotional) throw new Error(`[paper] exceeds notional limit: ${notional.toFixed(2)} > ${maxNotional.toFixed(2)}`);
  applyFill(market, side, qty, p, lev);
  const pos = state.positions[market];
  const uPnl = pos.base!==0 ? (pos.base>0 ? (p-pos.entry) : (pos.entry-p))*Math.abs(pos.base) : 0;
  const fill: Fill = { ts:Date.now(), market, side, qty, price:p, notional, leverage:lev }; state.trades.push(fill);
  return { ok:true, market, side, qty, price:p, leverage:lev, position:{ side:pos.side, base:pos.base, entry:pos.entry, realizedPnl:pos.realizedPnl, unrealizedPnl:uPnl }, balances:state.balances, trades:state.trades.slice(-5) };
}

export function getState(){ return state; }
export function reset(){ state.balances.USDC=startUSDC; state.lastPrice={}; state.positions={}; state.trades=[]; }
