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

/** OpenSea's collection stats. */
export type Stats = {
  vol24: number;
  sales24: number;
  vol7: number;
  owners: number;
  floor: number | null;
};

export type Market = {
  hashEth: number | null;
  ethUsd: number | null;
  total: number;
  rentStep: number;
  listings: Listing[];
  sales: Sale[];
  stats: Stats | null;
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
  buybackQueue: number; // ETH the hook is holding for $HASH buybacks
  buybackSpent: number;
  buybackBurned: number; // $HASH bought back and burned
  buybackCap: number; // most the hook will spend in one block, in ETH
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

export type Band = {
  burnEth: number; // 1000 $HASH at spot
  burnNet: number; // same, after the hook's swap fee
  ceiling: number; // $HASH price in ETH past which minting and burning would print money
  pct: number; // where $HASH sits against that ceiling
  room: number; // how far $HASH could still rise to hit it
  premium: number | null; // OpenSea floor over the burn floor
};

/** The two bounds the team pointed at on 13 Sep, both set by the contract.
 *  Floor: a current-epoch cat burns for exactly 1000 $HASH, so it can't be worth less.
 *  Ceiling: a cat mints for mintPrice and burns for 1000 $HASH, so $HASH can't
 *  sustainably trade above mintPrice / 1000. */
export function band(chain: Chain, hashEth: number, osFloor: number | null): Band {
  const burnEth = 1000 * hashEth;
  const burnNet = burnEth * (1 - chain.hookFeeBps / 10000);
  const ceiling = chain.mintPrice / 1000;
  return { burnEth, burnNet, ceiling, pct: hashEth / ceiling, room: ceiling / hashEth - 1, premium: osFloor ? osFloor / burnNet - 1 : null };
}
