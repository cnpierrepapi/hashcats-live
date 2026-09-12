# maintenance

What it takes to keep this running. Most of it is one chore.

## the OpenSea key (every 7 days)

The key is a free agent key from `POST https://api.opensea.io/api/v2/auth/keys`. It lasts a week and allows 600 reads an hour. The current one expires **18 Sep 2026, 21:31 UTC**.

When it lapses, listings, sales and sale fees go blank and the status reads `OpenSea 401`. The chain feed keeps going, and so does the burn side of the verdict.

To renew:

```
curl -s -X POST https://api.opensea.io/api/v2/auth/keys      # take api_key from the reply
npx vercel env rm OPENSEA_API_KEY production -y
npx vercel env add OPENSEA_API_KEY production                # paste the new key
npx vercel env rm OPENSEA_API_KEY preview -y
npx vercel env add OPENSEA_API_KEY preview
git commit --allow-empty -m "Pick up the new OpenSea key" && git push
```

The push matters. Vercel only reads env vars at deploy time.

Or skip all that: make a proper key once at opensea.io/settings/developer and it stops expiring.

## things that can fall over

Every data source is free with no promises attached.

- **drpc websocket** (`WSS_RPC` in `lib/hashcats.ts`) carries the live feed. If the light stays off, point it at another Robinhood Chain websocket. The official RPC has no websocket.
- **Robinhood's public RPC** rate-limits chatty clients. The server makes one multicall per refresh, so it stays under.
- **vast.ai** gives the 5090 price. If it breaks, the mine-or-wait panel waits forever. A fallback price would fix that, and it hasn't been written yet.
- **DexScreener** gives the $HASH price. The "$HASH chart" link is pinned to one pair, and it goes stale if liquidity moves pools.

## numbers that go stale

- `RIG.ghs` in `lib/mining.ts` is hashcat's benchmark for a stock 5090 (6.40 GH/s). Swap in a real measurement if a miner ever gets written.
- The listing reader stops at 600 listings (6 pages). There were about 300 on 12 Sep.
- OpenSea spend is about 5 reads per refresh against a 30 second cache, which comes to roughly 600 an hour. That's the whole budget. If 429s appear, raise `s-maxage` in `app/api/market/route.ts`.

## dependencies

Keep TypeScript on 5.x. The scaffold pulled 7 and Next didn't like it. Every so often: `npm update`, `npm run build`, push, and keep an eye on Next.js security advisories.

## when it stops mattering

The contract makes cats harder to mine from cat 16,376. Somewhere past 17k minting stops, rent stops with it, and the verdict will just say wait. That's the natural end.
