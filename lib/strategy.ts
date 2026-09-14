export type Listing = {
  id: number;
  ask: number;
  claimable: number;
  rentFloor: number;
  burnReward: number;
};

export type Sale = {
  t: number;
  id: number;
  price: number;
  sym: string;
  buyer: string | null;
  seller: string | null;
  tx: string | null;
};

export type Market = {
  hashEth: number | null;
  ethUsd: number | null;
  total: number;
  rentStep: number;
  listings: Listing[];
  sales: Sale[];
  status: Record<string, string>;
  fetchedAt: number;
  saleFeePct: number; // OpenSea + creator fee on a sale
};

export type Chain = {
  total: number;
  epoch: number;
  mintPrice: number;
  lastMint: number;
  burned: number;
  hookFeeBps: number;
  epochStart: number; // first cat id of the current epoch
  epochSize: number;
  buybackQueue: number; // ETH the hook is holding for $HASH buybacks
  buybackSpent: number;
  buybackBurned: number; // $HASH bought back and burned
};

/** totalMinted and burnedCount as they stood 1, 6 and 24 hours back, keyed by hours. */
export type Pace = { at: number; minted: Record<number, number>; burned: Record<number, number> };
export const PACE_HOURS = [1, 6, 24] as const;

export type Gap = {
  mint: number;
  burnNet: number;
  saleNet: number | null;
  exit: number;
  exitName: "burn" | "sale";
  gap: number; // exit / mint - 1, negative means minting loses money
  breakeven: number; // $HASH price in ETH where burning a fresh cat pays back the mint
  hashMove: number; // how far $HASH has to move to get there
};

/** A freshly minted cat has two exits: burn it for the full 1000 $HASH, or sell it at the floor. */
export function mintGap(chain: Chain, hashEth: number, floor: number | null, saleFeePct: number): Gap {
  const keep = 1 - chain.hookFeeBps / 10000;
  const burnNet = 1000 * hashEth * keep;
  const saleNet = floor ? floor * (1 - saleFeePct / 100) : null;
  const exitName = saleNet != null && saleNet > burnNet ? "sale" : "burn";
  const exit = Math.max(burnNet, saleNet ?? 0);
  const breakeven = chain.mintPrice / (1000 * keep);
  return { mint: chain.mintPrice, burnNet, saleNet, exit, exitName, gap: exit / chain.mintPrice - 1, breakeven, hashMove: breakeven / hashEth - 1 };
}

export type Valued = Listing & {
  hold: number;
  burn: number;
  value: number;
  path: "hold" | "burn";
  x: number;
  edge: number;
};

/** A cat pays out one of two ways, and it is worth the better one.
 *  hold: rent already owed + RENT_STEP for every mint past its rentFloor, up to `final` cats.
 *  burn: rent already owed + its burn reward in $HASH at the spot price (no slippage). */
export function value(l: Listing, rentStep: number, hashEth: number, total: number, final: number): Valued {
  const hold = l.claimable + rentStep * Math.max(0, final - Math.max(total, l.rentFloor));
  const burn = l.claimable + l.burnReward * hashEth;
  const v = Math.max(hold, burn);
  return { ...l, hold, burn, value: v, path: hold >= burn ? "hold" : "burn", x: v / l.ask, edge: v - l.ask };
}

export type Call = { tone: "open" | "stalled"; sentence: string; sub: string };

const f = (n: number, d = 4) => n.toFixed(d);
export const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

/** The headline is the state of minting. A listing only gets a mention when it clears 1.15x. */
export function strategy(rows: Valued[], gap: Gap | null, sales: Sale[]): Call {
  if (!gap) return { tone: "stalled", sentence: "Reading the chain, OpenSea and the pool.", sub: "" };
  const sub: string[] = [];
  const sentence =
    gap.gap < 0
      ? `Minting is underwater: a new cat costs ${f(gap.mint)} ETH and its best exit pays ${f(gap.exit)}.`
      : `Minting pays again: a new cat costs ${f(gap.mint)} ETH and the ${gap.exitName} brings back ${f(gap.exit)}.`;
  if (gap.gap < 0) sub.push(`$HASH has to reach ${gap.breakeven.toFixed(7)} ETH, up ${Math.round(gap.hashMove * 100)}%, before it pays again.`);

  // OpenSea returns sales newest first.
  const recent = sales.filter((s) => ["ETH", "WETH"].includes(s.sym)).slice(0, 10).map((s) => s.price);
  if (recent.length >= 3) {
    const m = median(recent);
    sub.push(`The last ${recent.length} sales went for a median ${f(m)} ETH, ${f(m / gap.burnNet, 2)}x what burning a fresh cat pays.`);
  }
  const best = rows[0];
  if (best && best.x >= 1.15) sub.push(`One listing still pays: #${best.id} at ${f(best.ask)} ETH is worth ${f(best.value)} if you ${best.path} it.`);
  return { tone: gap.gap < 0 ? "stalled" : "open", sentence, sub: sub.join(" ") };
}
