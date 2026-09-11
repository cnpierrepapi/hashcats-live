"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPublicClient, webSocket } from "viem";
import { abi, addrLink, catLink, COLLECTION, LINKS, robinhood, transferEvent, txLink, WSS_RPC } from "@/lib/hashcats";
import { strategy, value, type Chain, type Market } from "@/lib/strategy";

type Move = { key: string; t: number; kind: "mint" | "burn" | "transfer" | "sale"; id: number; who?: string | null; price?: number; sym?: string; tx?: string | null };

const ZERO = "0x0000000000000000000000000000000000000000";
const short = (a?: string | null) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "");
const ago = (t: number, now: number) => {
  const s = Math.max(0, Math.round(now - t));
  return s < 60 ? `${s}s` : s < 3600 ? `${Math.floor(s / 60)}m` : `${Math.floor(s / 3600)}h`;
};

export default function Dashboard() {
  const [chain, setChain] = useState<Chain | null>(null);
  const [market, setMarket] = useState<Market | null>(null);
  const [moves, setMoves] = useState<Move[]>([]);
  const [final, setFinal] = useState(17000);
  const [live, setLive] = useState(false);
  const [now, setNow] = useState(() => Date.now() / 1000);
  const seen = useRef(new Set<string>());

  const addMoves = (items: Move[]) => {
    const fresh = items.filter((m) => !seen.current.has(m.key));
    fresh.forEach((m) => seen.current.add(m.key));
    if (fresh.length) setMoves((prev) => [...fresh, ...prev].sort((a, b) => b.t - a.t).slice(0, 120));
  };

  // Chain: straight from the browser over the drpc websocket, pushed the moment it lands.
  useEffect(() => {
    const client = createPublicClient({ chain: robinhood, transport: webSocket(WSS_RPC, { reconnect: true }) });
    const c = (functionName: "totalMinted" | "currentEpoch" | "mintPrice" | "lastMintTime" | "currentTarget" | "burnedCount") =>
      ({ address: COLLECTION, abi, functionName }) as const;
    const refresh = async () => {
      try {
        const [total, epoch, price, last, target, burned] = await client.multicall({
          allowFailure: false,
          contracts: [c("totalMinted"), c("currentEpoch"), c("mintPrice"), c("lastMintTime"), c("currentTarget"), c("burnedCount")],
        });
        setChain({
          total: Number(total),
          epoch: Number(epoch),
          mintPrice: Number(price) / 1e18,
          lastMint: Number(last),
          targetBits: 256 - target.toString(2).length,
          burned: Number(burned),
        });
        setLive(true);
      } catch {
        setLive(false);
      }
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
        refresh();
      },
      onError: () => setLive(false),
    });
    return () => {
      clearInterval(timer);
      unwatch();
    };
  }, []);

  // Market: OpenSea listings and sales, $HASH price, valued on the server every 30s.
  useEffect(() => {
    const load = async () => {
      try {
        const m: Market = await (await fetch("/api/market")).json();
        setMarket(m);
        addMoves(m.sales.map((s) => ({ key: `sale-${s.tx}-${s.id}`, t: s.t, kind: "sale", id: s.id, who: s.buyer, price: s.price, sym: s.sym, tx: s.tx })));
      } catch {}
    };
    load();
    const timer = setInterval(load, 30000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now() / 1000), 1000);
    return () => clearInterval(timer);
  }, []);

  const rows = useMemo(() => {
    if (!market?.hashEth) return [];
    const total = Math.max(market.total, chain?.total ?? 0);
    return market.listings.map((l) => value(l, market.rentStep, market.hashEth!, total, final)).sort((a, b) => b.x - a.x);
  }, [market, chain?.total, final]);

  const call = strategy(rows, market?.hashEth ?? null, chain, final);
  const floor = rows.reduce<(typeof rows)[number] | null>((m, r) => (!m || r.ask < m.ask ? r : m), null);
  const f = (n?: number | null, d = 4) => (n == null ? "–" : n.toFixed(d));

  return (
    <main>
      <div className="top">
        <h1>Hashcats live</h1>
        <span className="live mono">
          <i className={live ? "on" : ""} />
          {live ? "chain live" : "connecting"} · {market?.status.opensea ?? "loading market"}
        </span>
      </div>

      <div className={`call ${call.tone}`}>
        <p>{call.sentence}</p>
        <p>{call.sub}</p>
      </div>

      <div className="stats mono">
        <div><span>Cats</span><b>{chain ? `${chain.total} · ${chain.burned} burned` : "–"}</b></div>
        <div><span>Epoch · target</span><b>{chain ? `${chain.epoch} · ${chain.targetBits} bits` : "–"}</b></div>
        <div><span>Mint price</span><b>{f(chain?.mintPrice)} ETH</b></div>
        <div><span>$HASH</span><b>{market?.hashEth ? `$${(market.hashEth * (market.ethUsd ?? 0)).toFixed(3)}` : "–"}</b></div>
        <div><span>Burn pays</span><b>{market?.hashEth ? `${f(market.hashEth * 1000)} ETH` : "–"}</b></div>
        <div><span>Floor</span><b>{floor ? <a href={catLink(floor.id)} target="_blank">{f(floor.ask)} #{floor.id}</a> : "–"}</b></div>
        <div><span>Last mint</span><b>{chain ? `${ago(chain.lastMint, now)} ago` : "–"}</b></div>
      </div>

      <nav className="links">
        {Object.entries(LINKS).map(([label, url]) => (
          <a key={label} href={url} target="_blank">{label} ↗</a>
        ))}
      </nav>

      <div className="cols">
        <section>
          <h2>Listings, best value per ETH first</h2>
          <label className="final">
            Collection ends at <b className="mono">{final.toLocaleString()}</b> cats
            <input type="range" min={2000} max={20000} step={500} value={final} onChange={(e) => setFinal(+e.target.value)} />
          </label>
          <div className="scroll">
            <table className="mono">
              <thead>
                <tr><th>cat</th><th>ask</th><th>value</th><th>x</th><th>edge</th><th>rent owed</th><th>play</th></tr>
              </thead>
              <tbody>
                {rows.length ? rows.slice(0, 40).map((r) => (
                  <tr key={r.id}>
                    <td><a href={catLink(r.id)} target="_blank">#{r.id}</a></td>
                    <td>{f(r.ask)}</td>
                    <td>{f(r.value)}</td>
                    <td className={r.x >= 1.15 ? "good" : "dim"}>{r.x.toFixed(2)}</td>
                    <td className={r.edge > 0 ? "good" : "dim"}>{r.edge >= 0 ? "+" : ""}{f(r.edge)}</td>
                    <td>{f(r.claimable, 5)}</td>
                    <td>{r.path}</td>
                  </tr>
                )) : (
                  <tr><td colSpan={7} className="dim">{market ? "No ETH listings." : "Loading listings…"}</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section>
          <h2>Moves: chain live, sales every 30s</h2>
          <ul className="feed">
            {moves.map((m) => (
              <li key={m.key} className={now - m.t < 3 ? "fresh" : ""}>
                <span className={`tag ${m.kind}`}>{m.kind}</span>
                <a href={catLink(m.id)} target="_blank">#{m.id}</a>
                {m.kind === "sale" && <b className="mono">{f(m.price)} {m.sym}</b>}
                {m.who && <a className="mono dim" href={addrLink(m.who)} target="_blank">{short(m.who)}</a>}
                {m.tx && <a href={txLink(m.tx)} target="_blank">tx</a>}
                <span className="when mono">{ago(m.t, now)}</span>
              </li>
            ))}
            {!moves.length && <li className="dim">Waiting for the first move…</li>}
          </ul>
        </section>
      </div>

      <footer>
        Value is the better of two exits. Hold: rent owed now plus 0.000014 ETH for every future mint until the collection ends at the count you set.
        Burn: rent owed now plus the burn reward in $HASH at the spot price, before slippage. Not financial advice.
      </footer>
    </main>
  );
}
