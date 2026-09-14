"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPublicClient, webSocket } from "viem";
import { abi, addrLink, catLink, COLLECTION, HOOK, hookAbi, LINKS, robinhood, transferEvent, txLink, WSS_RPC } from "@/lib/hashcats";
import { mintGap, PACE_HOURS, strategy, value, type Chain, type Market, type Pace } from "@/lib/strategy";

type Move = { key: string; t: number; kind: "mint" | "burn" | "transfer" | "sale"; id: number; who?: string | null; price?: number; sym?: string; tx?: string | null };

const ZERO = "0x0000000000000000000000000000000000000000";
const BUTTON_FRAME = ["work", "chain", "mine", "rare", ""] as const;
// /api/market is cached for 2 minutes at the CDN, so polling faster only buys function runs.
const MARKET_POLL = 60_000;
const PACE_POLL = 5 * 60_000;
const short = (a?: string | null) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "");
const ago = (t: number, now: number) => {
  const s = Math.max(0, Math.round(now - t));
  return s < 60 ? `${s}s` : s < 3600 ? `${Math.floor(s / 60)}m` : `${Math.floor(s / 3600)}h`;
};
const pct = (m: number) => `${m >= 0 ? "+" : ""}${Math.round(m * 100)}%`;

export default function Dashboard() {
  const [chain, setChain] = useState<Chain | null>(null);
  const [market, setMarket] = useState<Market | null>(null);
  const [pace, setPace] = useState<Pace | null>(null);
  const [moves, setMoves] = useState<Move[]>([]);
  // Null until someone drags it: with minting stalled, the honest default is today's count.
  const [final, setFinal] = useState<number | null>(null);
  // One failed read shouldn't flip the light: live means a good read or a log in the last 15s.
  const [lastOk, setLastOk] = useState(0);
  const [now, setNow] = useState(() => Date.now() / 1000);
  const live = now - lastOk < 15;
  const seen = useRef(new Set<string>());

  const addMoves = (items: Move[]) => {
    const fresh = items.filter((m) => !seen.current.has(m.key));
    fresh.forEach((m) => seen.current.add(m.key));
    if (fresh.length) setMoves((prev) => [...fresh, ...prev].sort((a, b) => b.t - a.t).slice(0, 120));
  };

  // Chain: straight from the browser over the drpc websocket, pushed the moment it lands. No function time.
  useEffect(() => {
    const client = createPublicClient({ chain: robinhood, transport: webSocket(WSS_RPC, { reconnect: true }) });
    const c = (functionName: "totalMinted" | "currentEpoch" | "mintPrice" | "lastMintTime" | "burnedCount") =>
      ({ address: COLLECTION, abi, functionName }) as const;
    const h = (functionName: "currentFee" | "queue" | "buybackSpent" | "buybackBurned") => ({ address: HOOK, abi: hookAbi, functionName }) as const;
    let epochBounds: { epoch: number; start: number; size: number } | null = null;

    const refresh = async () => {
      try {
        const [total, epoch, price, last, burned, hookFee, queue, spent, bought] = await client.multicall({
          allowFailure: false,
          contracts: [c("totalMinted"), c("currentEpoch"), c("mintPrice"), c("lastMintTime"), c("burnedCount"), h("currentFee"), h("queue"), h("buybackSpent"), h("buybackBurned")],
        });
        // Epoch bounds only change when the epoch does.
        if (epochBounds?.epoch !== Number(epoch)) {
          const [start, size] = await client.multicall({
            allowFailure: false,
            contracts: [
              { address: COLLECTION, abi, functionName: "epochStart", args: [epoch] },
              { address: COLLECTION, abi, functionName: "epochSize", args: [epoch] },
            ],
          });
          epochBounds = { epoch: Number(epoch), start: Number(start), size: Number(size) };
        }
        setChain({
          total: Number(total),
          epoch: Number(epoch),
          mintPrice: Number(price) / 1e18,
          lastMint: Number(last),
          burned: Number(burned),
          hookFeeBps: Number(hookFee),
          epochStart: epochBounds.start,
          epochSize: epochBounds.size,
          buybackQueue: Number(queue) / 1e18,
          buybackSpent: Number(spent) / 1e18,
          buybackBurned: Number(bought) / 1e18,
        });
        setLastOk(Date.now() / 1000);
      } catch {}
    };

    // Mint pace: the same two counters read at blocks 1, 6 and 24 hours back. drpc keeps archive state.
    const loadPace = async () => {
      try {
        const head = await client.getBlock();
        const back = await client.getBlock({ blockNumber: head.number - 100_000n });
        const perSec = 100_000 / Number(head.timestamp - back.timestamp);
        const reads = await Promise.all(
          PACE_HOURS.map((hrs) =>
            client.multicall({
              allowFailure: false,
              blockNumber: head.number - BigInt(Math.round(hrs * 3600 * perSec)),
              contracts: [c("totalMinted"), c("burnedCount")],
            }),
          ),
        );
        const minted: Record<number, number> = {};
        const burned: Record<number, number> = {};
        PACE_HOURS.forEach((hrs, i) => {
          minted[hrs] = Number(reads[i][0]);
          burned[hrs] = Number(reads[i][1]);
        });
        setPace({ at: Date.now() / 1000, minted, burned });
      } catch {}
    };

    refresh();
    loadPace();
    const timer = setInterval(refresh, 5000);
    const paceTimer = setInterval(loadPace, PACE_POLL);
    const unwatch = client.watchEvent({
      address: COLLECTION,
      event: transferEvent,
      onLogs: (logs) => {
        addMoves(
          logs.map((l) => {
            const { from, to, tokenId } = l.args;
            const kind = from === ZERO ? "mint" : to === ZERO ? "burn" : "transfer";
            return {
              key: `${l.transactionHash}-${l.logIndex}`,
              t: Date.now() / 1000,
              kind,
              id: Number(tokenId),
              who: kind === "burn" ? from : to,
              tx: l.transactionHash,
            };
          }),
        );
        setLastOk(Date.now() / 1000);
        refresh();
      },
    });
    return () => {
      clearInterval(timer);
      clearInterval(paceTimer);
      unwatch();
    };
  }, []);

  // Market: OpenSea listings and sales plus the $HASH price. This is the only thing that runs a
  // Vercel function, so a tab in the background stops asking and catches up when it comes back.
  useEffect(() => {
    let lastLoad = 0;
    const load = async () => {
      if (document.hidden) return;
      lastLoad = Date.now();
      try {
        const m: Market = await (await fetch("/api/market")).json();
        setMarket(m);
        addMoves(m.sales.map((s) => ({ key: `sale-${s.tx}-${s.id}`, t: s.t, kind: "sale", id: s.id, who: s.buyer, price: s.price, sym: s.sym, tx: s.tx })));
      } catch {}
    };
    const onVisible = () => {
      if (!document.hidden && Date.now() - lastLoad > MARKET_POLL) load();
    };
    load();
    const timer = setInterval(load, MARKET_POLL);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now() / 1000), 1000);
    return () => clearInterval(timer);
  }, []);

  const total = Math.max(market?.total ?? 0, chain?.total ?? 0);
  const ends = final ?? total;
  const rows = useMemo(() => {
    if (!market?.hashEth) return [];
    return market.listings.map((l) => value(l, market.rentStep, market.hashEth!, total, ends)).sort((a, b) => b.x - a.x);
  }, [market, total, ends]);

  const floor = rows.reduce<(typeof rows)[number] | null>((m, r) => (!m || r.ask < m.ask ? r : m), null);
  const gap = chain && market?.hashEth ? mintGap(chain, market.hashEth, floor?.ask ?? null, market.saleFeePct) : null;
  const call = strategy(rows, gap, market?.sales ?? []);
  const f = (n?: number | null, d = 4) => (n == null ? "–" : n.toFixed(d));

  const since = (hrs: number) => (pace && chain ? chain.total - pace.minted[hrs] : null);
  const burnedSince = (hrs: number) => (pace && chain ? chain.burned - pace.burned[hrs] : null);
  const perDay = since(24);
  const inEpoch = chain ? chain.total - chain.epochStart + 1 : 0;
  const epochLeft = chain ? chain.epochSize - inEpoch : 0;
  const paceLine =
    perDay == null
      ? null
      : since(6)! <= 6 * 2
        ? `Stalled: ${since(6)} mints in 6 hours, after ${perDay.toLocaleString()} in the last day.`
        : `${since(1)} mints in the last hour, ${perDay.toLocaleString()} in the last day.`;
  const recentRate = since(6) != null ? since(6)! / 6 : null; // per hour
  const eta = recentRate && recentRate > 0 ? epochLeft / recentRate / 24 : null; // days

  return (
    <main>
      <header className="top">
        <div className="logo">
          <span><span className="h">HASH</span>CATS</span>
          <span className="tag">LIVE</span>
          <small>unofficial tracker</small>
        </div>
        <span className="chip frame mono">
          <i className={`dot ${live ? "on" : ""}`} />
          <span style={{ color: "var(--chain)" }}>{chain ? chain.total.toLocaleString() : "–"}</span> minted
          <span className="sep" />
          {market?.status.opensea ?? "loading market"}
        </span>
      </header>

      <section className="hero">
        <p className="kicker">{live ? "Where minting stands" : "Connecting to the chain"}</p>
        <h1 className={call.tone}>{call.sentence}</h1>
        <p className="sub">{call.sub}</p>
      </section>

      <section className={`frame verdict ${gap ? (gap.gap >= 0 ? "work" : "alarm") : ""}`}>
        <div className="bar">
          <span>Mint gap</span>
          <span>a fresh cat, minted and sold</span>
        </div>
        <div className="inner">
          {gap ? (
            <>
              <p className={`vline ${gap.gap >= 0 ? "good" : "bad"}`}>
                {gap.gap >= 0 ? `Up ${pct(gap.gap)} on every new cat.` : `Down ${Math.round(-gap.gap * 100)}% on every new cat.`}
              </p>
              <div className="vgrid">
                <div><span>Mint</span><b className="mono">{f(gap.mint)} ETH</b></div>
                <div><span>Burn, after {((chain?.hookFeeBps ?? 0) / 100).toFixed(1)}% swap fee</span><b className="mono">{f(gap.burnNet)} ETH</b></div>
                <div><span>Sell at floor, after {market?.saleFeePct}% fees</span><b className="mono">{f(gap.saleNet)} ETH</b></div>
                <div><span>Gap</span><b className={`mono ${gap.gap >= 0 ? "good" : "bad"}`}>{pct(gap.gap)}</b></div>
                <div><span>$HASH now</span><b className="mono">{f(market?.hashEth, 7)} ETH</b></div>
                <div><span>$HASH break-even</span><b className="mono">{f(gap.breakeven, 7)} ETH</b></div>
                <div><span>Move needed</span><b className={`mono ${gap.hashMove <= 0 ? "good" : "bad"}`}>{pct(gap.hashMove)}</b></div>
              </div>
              <p className="vnote">
                A cat burned in its own epoch pays the full 1000 $HASH, so that&apos;s the burn priced here. Hashing is close to free at
                today&apos;s target, which leaves the mint price as the whole cost. When $HASH clears the break-even, minting pays again.
              </p>
            </>
          ) : (
            <p className="dim">Reading the mint price, the pool and the floor…</p>
          )}
        </div>
      </section>

      <div className="panels">
        <section className="frame chain verdict">
          <div className="bar"><span>Pace</span><span>{chain ? `epoch ${chain.epoch}` : ""}</span></div>
          <div className="inner">
            {paceLine ? <p className={`vline ${since(6)! <= 12 ? "bad" : "calm"}`}>{paceLine}</p> : <p className="dim">Reading past blocks…</p>}
            <div className="vgrid">
              <div><span>Mints, last hour</span><b className="mono">{since(1) ?? "–"}</b></div>
              <div><span>Mints, 6 hours</span><b className="mono">{since(6) ?? "–"}</b></div>
              <div><span>Mints, 24 hours</span><b className="mono">{perDay?.toLocaleString() ?? "–"}</b></div>
              <div><span>Burns, 24 hours</span><b className="mono">{burnedSince(24)?.toLocaleString() ?? "–"}</b></div>
              <div><span>Last mint</span><b className="mono">{chain ? `${ago(chain.lastMint, now)} ago` : "–"}</b></div>
              <div><span>Epoch {chain?.epoch} filled</span><b className="mono">{chain ? `${inEpoch.toLocaleString()} / ${chain.epochSize.toLocaleString()}` : "–"}</b></div>
            </div>
            <p className="vnote">
              {chain && pace
                ? eta != null
                  ? `At the last 6 hours' pace the epoch fills in about ${eta < 2 ? `${Math.round(eta * 24)} hours` : `${Math.round(eta)} days`}.`
                  : "No mints in the last 6 hours, so the epoch isn't filling at all."
                : ""}
            </p>
          </div>
        </section>

        <section className="frame mine verdict">
          <div className="bar"><span>Buyback</span><span>the hook</span></div>
          <div className="inner">
            {chain ? (
              <>
                <p className="vline calm">{f(chain.buybackQueue, 2)} ETH waiting to buy $HASH.</p>
                <div className="vgrid">
                  <div><span>Queued</span><b className="mono">{f(chain.buybackQueue, 2)} ETH</b></div>
                  <div><span>Spent so far</span><b className="mono">{f(chain.buybackSpent, 1)} ETH</b></div>
                  <div><span>$HASH burned</span><b className="mono">{(chain.buybackBurned / 1e6).toFixed(2)}M</b></div>
                  <div><span>Cats alive</span><b className="mono">{(chain.total - chain.burned).toLocaleString()}</b></div>
                </div>
                <p className="vnote">
                  Mints fill the queue and the hook spends it on $HASH, which props up what a burn pays. No mints means nothing new
                  going in, so the queue is the buffer.
                </p>
              </>
            ) : (
              <p className="dim">Reading the hook…</p>
            )}
          </div>
        </section>
      </div>

      <div className="stats">
        {[
          ["Cats alive", chain ? (chain.total - chain.burned).toLocaleString() : "–", ""],
          ["Minted / burned", chain ? `${chain.total} / ${chain.burned}` : "–", ""],
          ["Mint price", chain ? `${f(chain.mintPrice)} ETH` : "–", "work"],
          ["$HASH", market?.hashEth ? `$${(market.hashEth * (market.ethUsd ?? 0)).toFixed(3)}` : "–", "chain"],
          ["Burn pays", market?.hashEth ? `${f(market.hashEth * 1000)} ETH` : "–", "mine"],
          ["Floor", floor ? `${f(floor.ask)} ETH` : "–", "rare"],
          ["Mints / 24h", perDay != null ? perDay.toLocaleString() : "–", ""],
        ].map(([label, val, tone]) => (
          <div key={label} className={`stat frame ${tone}`}>
            <span>{label}</span>
            <b>{label === "Floor" && floor ? <a href={catLink(floor.id)} target="_blank">{val} #{floor.id}</a> : val}</b>
          </div>
        ))}
      </div>

      <nav className="links">
        {Object.entries(LINKS).map(([label, url], i) => (
          <a key={label} className={`btn frame ${BUTTON_FRAME[i]}`} href={url} target="_blank">{label}</a>
        ))}
      </nav>

      <div className="cols">
        <section className="frame rare">
          <div className="bar"><span>Listings</span><span>{rows.length} for ETH</span></div>
          <div className="inner">
            <label className="final">
              Collection ends at <b className="mono">{ends.toLocaleString()}</b> cats{final == null ? " (today's count, since minting has stalled)" : ""}
              <input type="range" min={2000} max={20000} step={100} value={ends} onChange={(e) => setFinal(+e.target.value)} />
            </label>
            <div className="scroll">
              <table>
                <thead>
                  <tr><th>cat</th><th>ask</th><th>value</th><th>x</th><th>edge</th><th>rent owed</th><th>play</th></tr>
                </thead>
                <tbody>
                  {rows.length ? rows.slice(0, 40).map((r) => (
                    <tr key={r.id}>
                      <td className="mono"><a href={catLink(r.id)} target="_blank">#{r.id}</a></td>
                      <td className="mono">{f(r.ask)}</td>
                      <td className="mono">{f(r.value)}</td>
                      <td className={`mono ${r.x >= 1.15 ? "good" : "dim"}`}>{r.x.toFixed(2)}</td>
                      <td className={`mono ${r.edge > 0 ? "good" : "dim"}`}>{r.edge >= 0 ? "+" : ""}{f(r.edge)}</td>
                      <td className="mono">{f(r.claimable, 5)}</td>
                      <td className="mono">{r.path}</td>
                    </tr>
                  )) : (
                    <tr><td colSpan={7} className="dim">{market ? "No ETH listings." : "Loading listings…"}</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        <section className="frame chain">
          <div className="bar"><span>Moves</span><span className="mono" style={{ fontSize: 18 }}>{live ? "▪ live" : "▪ offline"}</span></div>
          <div className="inner">
            <ul className="feed">
              {moves.map((m) => (
                <li key={m.key} className={now - m.t < 3 ? "fresh" : ""}>
                  <span className={`kind ${m.kind}`}>{m.kind}</span>
                  <a className="mono" href={catLink(m.id)} target="_blank">#{m.id}</a>
                  {m.kind === "sale" && <b className="mono">{f(m.price)} {m.sym}</b>}
                  {m.who && <a className="mono dim" href={addrLink(m.who)} target="_blank">{short(m.who)}</a>}
                  {m.tx && <a className="mono" href={txLink(m.tx)} target="_blank">tx</a>}
                  <span className="when mono">{ago(m.t, now)}</span>
                </li>
              ))}
              {!moves.length && <li className="dim">Waiting for the first move…</li>}
            </ul>
          </div>
        </section>
      </div>

      <footer>
        The mint gap compares a new cat&apos;s cost with the better of burning it (1000 $HASH at spot, less the swap fee) or selling it at the floor
        (less OpenSea and creator fees). Listings are valued the old way: rent owed plus rent from future mints up to the count you set, or the burn
        reward at spot. Unofficial, not made by the Hashcats team. Not financial advice.
      </footer>
    </main>
  );
}
