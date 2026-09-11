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
};

export type Chain = {
  total: number;
  epoch: number;
  mintPrice: number;
  lastMint: number;
  targetBits: number;
  burned: number;
};

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

export type Call = { tone: "buy" | "burn" | "wait"; sentence: string; sub: string };

const f = (n: number, d = 4) => n.toFixed(d);

export function strategy(rows: Valued[], hashEth: number | null, chain: Chain | null, final: number): Call {
  if (hashEth == null || !chain) return { tone: "wait", sentence: "Reading the chain, OpenSea and the pool.", sub: "" };
  const burnNew = 1000 * hashEth;
  const sub: string[] = [];
  if (chain.mintPrice > 0) {
    sub.push(`Mining and burning a new cat pays ${f(burnNew / chain.mintPrice, 1)}x the ${f(chain.mintPrice)} ETH entry, if you have the hashrate for a ${chain.targetBits}-bit target.`);
  }
  if (!rows.length) return { tone: "wait", sentence: "Wait: there are no ETH listings to buy.", sub: sub.join(" ") };

  const best = rows[0];
  const floor = rows.reduce((m, r) => (r.ask < m.ask ? r : m), rows[0]);
  sub.push(`Floor ${f(floor.ask)} ETH, held to ${final.toLocaleString()} cats it is worth ${f(floor.hold)}, burned ${f(floor.burn)}.`);

  if (best.x >= 1.15) {
    return {
      tone: best.path === "burn" ? "burn" : "buy",
      sentence: best.path === "burn"
        ? `Buy #${best.id} at ${f(best.ask)} ETH and burn it: the $HASH pays ${f(best.burn)} ETH, ${f(best.x, 2)}x the ask.`
        : `Buy #${best.id} at ${f(best.ask)} ETH and hold it: the rent is worth ${f(best.hold)} ETH, ${f(best.x, 2)}x the ask.`,
      sub: sub.join(" "),
    };
  }
  return {
    tone: "wait",
    sentence: `Wait: the best listing, #${best.id} at ${f(best.ask)} ETH, is only ${f(best.x, 2)}x its value.`,
    sub: sub.join(" "),
  };
}
