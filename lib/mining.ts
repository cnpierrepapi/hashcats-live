/** The rig the verdict prices. Speed is hashcat's Keccak-256 benchmark (mode 17800) on a stock
 *  RTX 5090, the closest published stand-in for a custom miner: both do one Keccak-f per hash.
 *  No CUDA miner for this contract exists yet, so this is the best case, not a measurement. */
export const RIG = { name: "RTX 5090", ghs: 6.4 };

/** $HASH moved 15% in an hour while this was being built, so ask for a cushion before saying mine. */
export const CUSHION = 0.3;

export type Verdict = {
  tone: "mine" | "close" | "wait";
  line: string;
  sub: string;
  hashesPerCat: number;
  bits: number;
  hoursPerCat: number;
  gpuEth: number;
  cost: number;
  burnNet: number;
  saleNet: number | null;
  exit: number;
  margin: number;
};

type Inputs = {
  hashesPerCat: number; // 2^256 / current target: expected hashes to land one under it
  mintPrice: number;
  hashEth: number;
  ethUsd: number;
  usdPerHour: number;
  hookFeeBps: number;
  floor: number | null;
  saleFeePct: number;
};

const f = (n: number) => n.toFixed(4);
const pct = (m: number) => `${m >= 0 ? "+" : ""}${Math.round(m * 100)}%`;

export function miningVerdict(i: Inputs): Verdict {
  const hoursPerCat = i.hashesPerCat / (RIG.ghs * 1e9) / 3600;
  const gpuEth = (hoursPerCat * i.usdPerHour) / i.ethUsd;
  const cost = i.mintPrice + gpuEth;

  // A cat burned in its own epoch mints the full 1000 $HASH; selling it pays the hook's swap fee.
  const burnNet = 1000 * i.hashEth * (1 - i.hookFeeBps / 10000);
  const saleNet = i.floor ? i.floor * (1 - i.saleFeePct / 100) : null;
  const exit = Math.max(burnNet, saleNet ?? 0);
  const exitName = saleNet != null && saleNet > burnNet ? "OpenSea sale" : "burn";
  const margin = exit / cost - 1;

  // What it takes to clear the cushion, holding everything else where it is now.
  const hashNeeded = (cost * (1 + CUSHION)) / (1000 * (1 - i.hookFeeBps / 10000));
  const gpuBudgetEth = exit / (1 + CUSHION) - i.mintPrice;
  const maxBits = gpuBudgetEth > 0 ? Math.log2(((gpuBudgetEth * i.ethUsd) / i.usdPerHour) * 3600 * RIG.ghs * 1e9) : 0;
  const bits = Math.log2(i.hashesPerCat);

  const tone = margin >= CUSHION ? "mine" : margin >= 0 ? "close" : "wait";
  const line =
    tone === "mine"
      ? `Mine: a cat costs ${f(cost)} ETH on a ${RIG.name} and the ${exitName} brings back ${f(exit)}, ${pct(margin)}.`
      : tone === "close"
        ? `Close call: a cat costs ${f(cost)} ETH and brings back ${f(exit)}, only ${pct(margin)}, so wait unless your GPUs are already running.`
        : `Wait: a cat costs ${f(cost)} ETH to mine and only brings back ${f(exit)}.`;
  const sub =
    `The ${Math.round(CUSHION * 100)}% cushion needs $HASH above ${hashNeeded.toFixed(7)} ETH (now ${i.hashEth.toFixed(7)}) ` +
    (maxBits > 0 ? `and a target under ${maxBits.toFixed(1)} bits (now ${bits.toFixed(1)}).` : `and no target is easy enough at today's prices.`);

  return { tone, line, sub, hashesPerCat: i.hashesPerCat, bits, hoursPerCat, gpuEth, cost, burnNet, saleNet, exit, margin };
}
