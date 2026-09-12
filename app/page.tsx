"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPublicClient, webSocket } from "viem";
import { abi, addrLink, catLink, COLLECTION, HOOK, hookAbi, LINKS, robinhood, transferEvent, txLink, WSS_RPC } from "@/lib/hashcats";
import { miningVerdict, RIG } from "@/lib/mining";
import { strategy, value, type Chain, type Market } from "@/lib/strategy";

type Move = { key: string; t: number; kind: "mint" | "burn" | "transfer" | "sale"; id: number; who?: string | null; price?: number; sym?: string; tx?: string | null };

const ZERO = "0x0000000000000000000000000000000000000000";
const TONE_FRAME = { buy: "work", burn: "mine", wait: "rare" } as const;
const BUTTON_FRAME = ["work", "chain", "mine", "rare", ""] as const;
const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
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
  // One failed read shouldn't flip the light: live means a good read or a log in the last 15s.
  const [lastOk, setLastOk] = useState(0);
  // The target swings a couple of bits with the mint streak, so price mining off the median of recent reads.
  const [samples, setSamples] = useState<number[]>([]);
  const [now, setNow] = useState(() => Date.now() / 1000);
  const live = now - lastOk < 15;
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
        const [total, epoch, price, last, target, burned, hookFee] = await client.multicall({
          allowFailure: false,
          contracts: [
            c("totalMinted"), c("currentEpoch"), c("mintPrice"), c("lastMintTime"), c("currentTarget"), c("burnedCount"),
            { address: HOOK, abi: hookAbi, functionName: "currentFee" },
          ],
        });
        setChain({
          total: Number(total),
          epoch: Number(epoch),
          mintPrice: Number(price) / 1e18,
          lastMint: Number(last),
          targetBits: 256 - target.toString(2).length,
          burned: Number(burned),
          hookFeeBps: Number(hookFee),
        });
        setSamples((prev) => [...prev, Number((1n << 256n) / target)].slice(-12));
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
  const verdict =
    chain && market?.hashEth && market.ethUsd && market.usdPerHour && samples.length
      ? miningVerdict({
          hashesPerCat: median(samples),
          mintPrice: chain.mintPrice,
          hashEth: market.hashEth,
          ethUsd: market.ethUsd,
          usdPerHour: market.usdPerHour,
          hookFeeBps: chain.hookFeeBps,
          floor: floor?.ask ?? null,
          saleFeePct: market.saleFeePct,
        })
      : null;
  const VERDICT_FRAME = { mine: "work", close: "rare", wait: "alarm" } as const;

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
        <p className="kicker">{live ? "The play right now" : "Connecting to the chain"}</p>
        <h1 className={call.tone}>{call.sentence}</h1>
        <p className="sub">{call.sub}</p>
      </section>

      <section className={`frame verdict ${verdict ? VERDICT_FRAME[verdict.tone] : ""}`}>
        <div className="bar">
          <span>Mine or wait</span>
          <span>{market?.usdPerHour ? `${RIG.name} at $${market.usdPerHour.toFixed(3)}/hr` : RIG.name}</span>
        </div>
        <div className="inner">
          {verdict ? (
            <>
              <p className={`vline ${verdict.tone}`}>{verdict.line}</p>
              <div className="vgrid">
                <div><span>Hashes per cat</span><b className="mono">2^{verdict.bits.toFixed(1)}</b></div>
                <div><span>GPU time</span><b className="mono">{verdict.hoursPerCat.toFixed(1)} h</b></div>
                <div><span>GPU cost</span><b className="mono">{f(verdict.gpuEth)} ETH</b></div>
                <div><span>Mint</span><b className="mono">{f(chain?.mintPrice)} ETH</b></div>
                <div><span>Total cost</span><b className="mono">{f(verdict.cost)} ETH</b></div>
                <div><span>Burn, after {((chain?.hookFeeBps ?? 0) / 100).toFixed(1)}% swap fee</span><b className="mono">{f(verdict.burnNet)} ETH</b></div>
                <div><span>Sell, after {market?.saleFeePct}% fees</span><b className="mono">{f(verdict.saleNet)} ETH</b></div>
                <div><span>Margin</span><b className={`mono ${verdict.margin >= 0 ? "good" : "bad"}`}>{verdict.margin >= 0 ? "+" : ""}{Math.round(verdict.margin * 100)}%</b></div>
              </div>
              <p className="vnote">
                {verdict.sub} Speed is hashcat&apos;s {RIG.ghs} GH/s on a stock {RIG.name}. No GPU miner for this contract exists yet, so treat this as the best case.
              </p>
            </>
          ) : (
            <p className="dim">Reading the target, the pool and GPU prices…</p>
          )}
        </div>
      </section>

      <div className="stats">
        {[
          ["Cats", chain ? `${chain.total} / ${chain.burned} burned` : "–", ""],
          ["Epoch · target", chain ? `${chain.epoch} · ${chain.targetBits} bits` : "–", ""],
          ["Mint price", chain ? `${f(chain.mintPrice)} ETH` : "–", "work"],
          ["$HASH", market?.hashEth ? `$${(market.hashEth * (market.ethUsd ?? 0)).toFixed(3)}` : "–", "chain"],
          ["Burn pays", market?.hashEth ? `${f(market.hashEth * 1000)} ETH` : "–", "mine"],
          ["Floor", floor ? `${f(floor.ask)} ETH` : "–", "rare"],
          ["Last mint", chain ? `${ago(chain.lastMint, now)} ago` : "–", ""],
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
        <section className={`frame ${TONE_FRAME[call.tone]}`}>
          <div className="bar"><span>Listings</span><span>best value per ETH</span></div>
          <div className="inner">
            <label className="final">
              Collection ends at <b className="mono">{final.toLocaleString()}</b> cats
              <input type="range" min={2000} max={20000} step={500} value={final} onChange={(e) => setFinal(+e.target.value)} />
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
        Value is the better of two exits. Hold: rent owed now plus 0.000014 ETH for every future mint until the collection ends at the count you set.
        Burn: rent owed now plus the burn reward in $HASH at the spot price, before slippage. Unofficial, not made by the Hashcats team. Not financial advice.
      </footer>
    </main>
  );
}
