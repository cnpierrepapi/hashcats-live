"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPublicClient, webSocket } from "viem";
import { abi, addrLink, catLink, COLLECTION, EGGS, HOOK, hookAbi, LINKS, robinhood, transferEvent, txLink, WSS_RPC } from "@/lib/hashcats";
import { band, value, type Chain, type Market } from "@/lib/strategy";

type Move = { key: string; t: number; kind: "mint" | "burn" | "transfer" | "sale"; id: number; who?: string | null; price?: number; sym?: string; tx?: string | null };

const ZERO = "0x0000000000000000000000000000000000000000";
const BUTTON_FRAME = ["work", "chain", "mine", "rare", ""] as const;
// /api/market is cached for 2 minutes at the CDN, so polling faster only buys function runs.
const MARKET_POLL = 60_000;
const short = (a?: string | null) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "");
const ago = (t: number, now: number) => {
  const s = Math.max(0, Math.round(now - t));
  return s < 60 ? `${s}s` : s < 3600 ? `${Math.floor(s / 60)}m` : `${Math.floor(s / 3600)}h`;
};
const pct = (m: number) => `${m >= 0 ? "+" : ""}${Math.round(m * 100)}%`;

export default function Dashboard() {
  const [chain, setChain] = useState<Chain | null>(null);
  const [market, setMarket] = useState<Market | null>(null);
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
    const h = (functionName: "currentFee" | "queue" | "buybackSpent" | "buybackBurned" | "capPerBlock") =>
      ({ address: HOOK, abi: hookAbi, functionName }) as const;

    const refresh = async () => {
      try {
        const [total, epoch, price, last, burned, hookFee, queue, spent, bought, cap] = await client.multicall({
          allowFailure: false,
          contracts: [
            c("totalMinted"), c("currentEpoch"), c("mintPrice"), c("lastMintTime"), c("burnedCount"),
            h("currentFee"), h("queue"), h("buybackSpent"), h("buybackBurned"), h("capPerBlock"),
          ],
        });
        setChain({
          total: Number(total),
          epoch: Number(epoch),
          mintPrice: Number(price) / 1e18,
          lastMint: Number(last),
          burned: Number(burned),
          hookFeeBps: Number(hookFee),
          buybackQueue: Number(queue) / 1e18,
          buybackSpent: Number(spent) / 1e18,
          buybackBurned: Number(bought) / 1e18,
          buybackCap: Number(cap) / 1e18,
        });
        setLastOk(Date.now() / 1000);
      } catch {}
    };

    refresh();
    const timer = setInterval(refresh, 5000);
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
      unwatch();
    };
  }, []);

  // Market: OpenSea listings, sales and stats plus the $HASH price. This is the only thing that runs a
  // Vercel function, so a tab in the background stops asking and catches up when it comes back.
  useEffect(() => {
    let lastLoad = 0;
    const load = async (first = false) => {
      // The first load always runs, or a page opened in a background tab would sit blank.
      if (document.hidden && !first) return;
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
    load(true);
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

  const f = (n?: number | null, d = 4) => (n == null ? "–" : n.toFixed(d));
  const byAsk = [...rows].sort((a, b) => a.ask - b.ask);
  const floor = byAsk[0] ?? null;
  const osFloor = market?.stats?.floor ?? floor?.ask ?? null;
  // Breeding takes two cats, so the entry ticket is the two cheapest listings.
  const pair = byAsk.length >= 2 ? { ask: byAsk[0].ask + byAsk[1].ask, ids: [byAsk[0].id, byAsk[1].id] } : null;
  const b = chain && market?.hashEth ? band(chain, market.hashEth, osFloor) : null;
  const st = market?.stats ?? null;
  const usd = (eth: number) => (market?.ethUsd ? `$${Math.round(eth * market.ethUsd).toLocaleString()}` : "");

  const dueIn = EGGS.due - now;
  const dueLine =
    dueIn > 0
      ? `Update due in ${Math.floor(dueIn / 3600)}h ${Math.floor((dueIn % 3600) / 60)}m.`
      : "The 48 hours are up. Watch @hashcats_rh.";

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
          <span style={{ color: "var(--chain)" }}>{chain ? (chain.total - chain.burned).toLocaleString() : "–"}</span> cats alive
          <span className="sep" />
          {market?.status.opensea ?? "loading market"}
        </span>
      </header>

      <section className="hero">
        <p className="kicker">Next up: eggs</p>
        <h1 className="eggs">Two cats in, one egg out.</h1>
        <p className="sub">
          Hashcats teased breeding on 12 Sep. The first update is due by about 15 Sep, 22:00 UTC, and the team says to
          have cats and $HASH on hand when it lands. They also said $HASH is &quot;about to have a reason to be held.&quot;
        </p>
      </section>

      <section className="frame work verdict">
        <div className="bar"><span>Eggs</span><span>not on chain yet</span></div>
        <div className="inner">
          <p className="vline good">{dueLine}</p>
          <div className="vgrid">
            <div><span>Cheapest pair</span><b className="mono">{pair ? `${f(pair.ask)} ETH` : "–"}</b></div>
            <div><span>$HASH now</span><b className="mono">{market?.hashEth ? `${f(market.hashEth, 7)} ETH` : "–"}</b></div>
            <div><span>Cats alive</span><b className="mono">{chain ? (chain.total - chain.burned).toLocaleString() : "–"}</b></div>
            <div><span>Due by</span><b className="mono">15 Sep 22:00 UTC</b></div>
          </div>
          <p className="vnote">
            All anyone&apos;s seen is the <a href={EGGS.teaser} target="_blank">12 Sep teaser</a>: Cat A and Cat B go in, an egg comes out.
            No price, no timer, no contract yet. The owner wallet hasn&apos;t deployed anything new either.{" "}
            {pair && <>The cheapest pair right now is <a href={catLink(pair.ids[0])} target="_blank">#{pair.ids[0]}</a> and <a href={catLink(pair.ids[1])} target="_blank">#{pair.ids[1]}</a>. </>}
            The <a href={EGGS.update} target="_blank">13 Sep post</a> has the timing.
          </p>
        </div>
      </section>

      <div className="panels">
        <section className="frame chain verdict">
          <div className="bar"><span>$HASH band</span><span>set by the contract</span></div>
          <div className="inner">
            {b ? (
              <>
                <p className="vline calm">$HASH is at {Math.round(b.pct * 100)}% of its ceiling.</p>
                <div className="vgrid">
                  <div><span>$HASH now</span><b className="mono">{f(market?.hashEth, 7)}</b></div>
                  <div><span>Ceiling</span><b className="mono">{f(b.ceiling, 7)}</b></div>
                  <div><span>Room to ceiling</span><b className="mono">{pct(b.room)}</b></div>
                  <div><span>A cat burns for</span><b className="mono">{f(b.burnNet)} ETH</b></div>
                  <div><span>OpenSea floor</span><b className="mono">{f(osFloor)} ETH</b></div>
                  <div><span>Floor over burn</span><b className={`mono ${b.premium != null && b.premium > 0 ? "good" : "bad"}`}>{b.premium != null ? pct(b.premium) : "–"}</b></div>
                </div>
                <p className="vnote">
                  The floor: an epoch {chain?.epoch} cat burns for exactly 1,000 $HASH ({f(b.burnEth)} ETH at spot, {f(b.burnNet)} after the{" "}
                  {((chain?.hookFeeBps ?? 0) / 100).toFixed(1)}% swap fee). The ceiling: a cat mints for {f(chain?.mintPrice)} ETH, so if 1,000 $HASH
                  were worth more than that, people would mint and burn until it wasn&apos;t.
                </p>
              </>
            ) : (
              <p className="dim">Reading the pool and the contract…</p>
            )}
          </div>
        </section>

        <section className="frame rare verdict">
          <div className="bar"><span>Market</span><span>OpenSea</span></div>
          <div className="inner">
            {st ? (
              <>
                <p className="vline calm">{Math.round(st.vol24).toLocaleString()} ETH traded in the last day.</p>
                <div className="vgrid">
                  <div><span>Volume, 24h</span><b className="mono">{Math.round(st.vol24).toLocaleString()} ETH</b></div>
                  <div><span>Sales, 24h</span><b className="mono">{st.sales24.toLocaleString()}</b></div>
                  <div><span>Average sale</span><b className="mono">{st.sales24 ? f(st.vol24 / st.sales24) : "–"} ETH</b></div>
                  <div><span>Volume, 7 days</span><b className="mono">{Math.round(st.vol7).toLocaleString()} ETH</b></div>
                  <div><span>Holders</span><b className="mono">{st.owners.toLocaleString()}</b></div>
                </div>
                <p className="vnote">
                  That&apos;s about {usd(st.vol24)} in a day. The team says it&apos;s now #1 on Robinhood Chain by 7 day volume.
                </p>
              </>
            ) : (
              <p className="dim">{market ? `No stats: ${market.status.stats ?? "OpenSea didn't answer"}` : "Reading OpenSea…"}</p>
            )}
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
                  <div><span>Cap per block</span><b className="mono">{f(chain.buybackCap, 2)} ETH</b></div>
                  <div><span>Spent so far</span><b className="mono">{f(chain.buybackSpent, 1)} ETH</b></div>
                  <div><span>$HASH burned</span><b className="mono">{(chain.buybackBurned / 1e6).toFixed(2)}M</b></div>
                </div>
                <p className="vnote">
                  The hook spends the queue on $HASH and burns it, a slice per block. On 13 Sep the team raised the cap to 0.05 ETH, then set it
                  back to 0.04 about ninety minutes later.
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
          ["Holders", st ? st.owners.toLocaleString() : "–", ""],
          ["$HASH", market?.hashEth ? `$${(market.hashEth * (market.ethUsd ?? 0)).toFixed(3)}` : "–", "chain"],
          ["Of ceiling", b ? `${Math.round(b.pct * 100)}%` : "–", "chain"],
          ["Burn pays", b ? `${f(b.burnNet)} ETH` : "–", "mine"],
          ["Floor", floor ? `${f(floor.ask)} ETH` : "–", "rare"],
          ["Volume, 24h", st ? `${Math.round(st.vol24)} ETH` : "–", "work"],
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
              Collection ends at <b className="mono">{ends.toLocaleString()}</b> cats{final == null ? " (today's count)" : ""}
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
        The band comes straight from the contract: the burn reward sets the floor, the mint price over 1,000 sets the $HASH ceiling.
        Listings are valued as the better of two exits, rent (owed now plus future mints up to the count you set) or the burn reward at spot.
        Unofficial, not made by the Hashcats team. Not financial advice.
      </footer>
    </main>
  );
}
