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
- **Robinhood's public RPC** rate-limits chatty clients. The server makes two multicalls per refresh, so it stays under.
- **DexScreener** gives the $HASH price. The "$HASH chart" link is pinned to one pair, and it goes stale if liquidity moves pools.

## function time

`/api/market` is the only thing that bills. If usage climbs again, check the runtime logs first: lots of `cache=STALE` or `MISS` rows on `/api/market` means the function is running more than the cache should allow. The knobs are `s-maxage` in `app/api/market/route.ts` and `MARKET_POLL` in `app/page.tsx`. Don't add chain reads to the route. They belong in the browser.

## numbers that go stale

- The listing reader goes 14 pages deep (1,400 orders) or 9 seconds, whichever comes first, and each instance keeps the result for 10 minutes. On 14 Sep the first ~700 orders were three wallets relisting three cats at 0.1148 every 15 minutes, and real listings started on page 8. If the table thins out again, check for the same thing before raising the page count.
- `EGGS.due` in `lib/hashcats.ts` is the 48 hour mark from the team's 13 Sep post. Once breeding ships, swap the countdown for the real contract reads.
- OpenSea spend: up to 14 listing reads every 10 minutes per instance, plus sales and stats on every run. Call it under 200 an hour for one busy region, against 600.

## dependencies

Keep TypeScript on 5.x. The scaffold pulled 7 and Next didn't like it. Every so often: `npm update`, `npm run build`, push, and keep an eye on Next.js security advisories.

## when it stops mattering

The contract makes cats harder to mine from cat 16,376. Somewhere past 17k minting stops, rent stops with it, and the verdict will just say wait. That's the natural end.
