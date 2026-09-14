import { NextResponse } from "next/server";
import { createPublicClient, http } from "viem";
import { abi, COLLECTION, HASH_TOKEN, SLUG, robinhood } from "@/lib/hashcats";
import type { Listing, Market, Sale } from "@/lib/strategy";

// Every run costs function time, so the CDN answers from cache for 2 minutes and serves the
// stale copy for 10 more while one run refreshes it. Listings and sales don't move faster than that.
export const dynamic = "force-dynamic";
export const maxDuration = 15;

// A hung upstream shouldn't hold the function open. Each source gets 6s, then counts as failed.
const TIMEOUT = 6000;
const client = createPublicClient({ chain: robinhood, transport: http(undefined, { timeout: TIMEOUT }) });
const wei = (v: bigint) => Number(v) / 1e18;

async function opensea(path: string, key: string) {
  const r = await fetch(`https://api.opensea.io/api/v2${path}`, {
    headers: { "X-API-KEY": key, accept: "application/json" },
    cache: "no-store",
    signal: AbortSignal.timeout(TIMEOUT),
  });
  if (!r.ok) throw new Error(`OpenSea ${r.status}`);
  return r.json();
}

async function listings(key: string) {
  const asks = new Map<number, number>();
  let next = "";
  for (let page = 0; page < 6; page++) {
    const d = await opensea(`/listings/collection/${SLUG}/all?limit=100${next ? `&next=${encodeURIComponent(next)}` : ""}`, key);
    for (const l of d.listings ?? []) {
      const p = l.price?.current;
      if (!p || !["ETH", "WETH"].includes(p.currency)) continue;
      const id = Number(l.protocol_data.parameters.offer[0].identifierOrCriteria);
      const eth = Number(p.value) / 10 ** p.decimals;
      if (!asks.has(id) || eth < asks.get(id)!) asks.set(id, eth);
    }
    if (!d.next) break;
    next = d.next;
  }
  return asks;
}

async function sales(key: string): Promise<Sale[]> {
  const d = await opensea(`/events/collection/${SLUG}?event_type=sale&limit=40`, key);
  return (d.asset_events ?? []).map((e: any) => ({
    t: e.event_timestamp,
    id: Number(e.nft.identifier),
    price: Number(e.payment.quantity) / 10 ** e.payment.decimals,
    sym: e.payment.symbol,
    buyer: e.buyer ?? null,
    seller: e.seller ?? null,
    tx: e.transaction ?? null,
  }));
}

async function hashPrice() {
  const r = await fetch(`https://api.dexscreener.com/tokens/v1/robinhood/${HASH_TOKEN}`, { cache: "no-store", signal: AbortSignal.timeout(TIMEOUT) });
  const pairs: any[] = await r.json();
  const best = pairs.reduce((m, p) => ((p.liquidity?.usd ?? 0) > (m.liquidity?.usd ?? 0) ? p : m), pairs[0]);
  const native = Number(best.priceNative);
  return { hashEth: native, ethUsd: Number(best.priceUsd) / native };
}

// OpenSea + creator fee on a sale. It barely ever changes, so one read per instance per 6h.
let feeCache: { pct: number; at: number } | null = null;
async function saleFees(key: string) {
  if (feeCache && Date.now() - feeCache.at < 6 * 3600_000) return feeCache.pct;
  const d = await opensea(`/collections/${SLUG}`, key);
  const pct = (d.fees ?? []).reduce((s: number, fee: any) => s + Number(fee.fee), 0);
  feeCache = { pct, at: Date.now() };
  return pct;
}

const read = (functionName: "ownerOf" | "claimable" | "rentFloor" | "burnReward", id: number) =>
  ({ address: COLLECTION, abi, functionName, args: [BigInt(id)] }) as const;

async function valueListings(asks: Map<number, number>) {
  const [total, rentStep] = await client.multicall({
    allowFailure: false,
    contracts: [
      { address: COLLECTION, abi, functionName: "totalMinted" },
      { address: COLLECTION, abi, functionName: "RENT_STEP" },
    ],
  });
  const ids = [...asks.keys()];
  // One eth_call for everything: the public RPC rate-limits anything chattier.
  const res = await client.multicall({
    allowFailure: true,
    batchSize: 512_000,
    contracts: ids.flatMap((id) => [read("ownerOf", id), read("claimable", id), read("rentFloor", id), read("burnReward", id)]),
  });
  const out: Listing[] = [];
  ids.forEach((id, i) => {
    const [owner, claim, floor, burn] = res.slice(4 * i, 4 * i + 4);
    if (owner.status !== "success") return; // burned since it was listed
    out.push({
      id,
      ask: asks.get(id)!,
      claimable: claim.status === "success" ? wei(claim.result as bigint) : 0,
      rentFloor: floor.status === "success" ? Number(floor.result) : 0,
      burnReward: burn.status === "success" ? wei(burn.result as bigint) : 0,
    });
  });
  return { total: Number(total), rentStep: wei(rentStep), listings: out };
}

export async function GET() {
  const key = process.env.OPENSEA_API_KEY;
  const status: Record<string, string> = {};
  const noKey = () => Promise.reject(new Error("no OPENSEA_API_KEY"));
  const [px, asks, recent, fees] = await Promise.allSettled([
    hashPrice(),
    key ? listings(key) : noKey(),
    key ? sales(key) : noKey(),
    key ? saleFees(key) : noKey(),
  ]);

  const body: Market = {
    hashEth: null, ethUsd: null, total: 0, rentStep: 0, listings: [], sales: [], status, fetchedAt: Date.now() / 1000,
    saleFeePct: 6, // 1% OpenSea + 5% creator, as read on 12 Sep; used only if the read fails
  };
  if (px.status === "fulfilled") Object.assign(body, px.value);
  else status.dex = px.reason.message;
  if (fees.status === "fulfilled") body.saleFeePct = fees.value;
  else status.fees = fees.reason.message;
  if (recent.status === "fulfilled") body.sales = recent.value;
  else status.sales = recent.reason.message;

  try {
    const v = await valueListings(asks.status === "fulfilled" ? asks.value : new Map());
    Object.assign(body, v);
    status.opensea = asks.status === "fulfilled" ? `${v.listings.length} listings` : asks.reason.message;
  } catch (e) {
    status.chain = (e as Error).message.slice(0, 120);
  }

  return NextResponse.json(body, {
    headers: { "Cache-Control": "public, s-maxage=120, stale-while-revalidate=600" },
  });
}
