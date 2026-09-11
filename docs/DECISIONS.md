# decisions

## chain data goes browser-direct, market data goes through a function

Vercel functions can't hold a websocket open, and polling the chain from a function would burn through the public RPC's rate limit fast. drpc's websocket accepts connections from any origin (tested from a vercel.app origin before building), so the browser subscribes itself. Every viewer gets their own stream and nobody shares a quota.

OpenSea needs a key, and a key can't ship to the browser. So that part runs server-side.

## 30 second CDN cache on /api/market

The free OpenSea key allows 600 reads an hour. One refresh spends roughly 4 (a couple of listing pages plus sales). Uncached, ten open tabs would blow the limit in fifteen minutes. With `s-maxage=30` the function runs at most about 120 times an hour no matter the traffic, which is around 480 reads. Tight but inside the limit. If listings grow past a few hundred, raise the cache to 45s.

## value only listed cats, not the whole collection

The local scanner values all ~1,100 cats, which is about 4,400 subcalls and 16 seconds. The page only needs the ~170 that are listed, so the function values those. One multicall, well under a second.

## the server returns numbers, the browser decides

The collection-size slider changes every hold value. If the server did the valuing, every slider move would need a round trip. Keeping `value()` and `strategy()` in `lib/strategy.ts` and running them client-side makes the slider instant and keeps the server cache useful.

## 1.15x before the page says buy

Burn value assumes spot price with no slippage, and the $HASH pool moves a lot. Hold value assumes a collection size nobody can promise. A 15% cushion keeps the sentence from flipping to "buy" on noise.

## the look matches hashcats.fun, rebuilt, not lifted

Same palette, same three Google fonts (Jersey 10, DotGothic16, VT323), same 3px pixel grid and dotted background. Their frames are 27px PNGs: an ink outline, a light edge top-left, a dark edge bottom-right, base colour between. Here they're three stacked inset box-shadows with the same colours, so there are no copied image files and any frame can take any colour.

The header says "unofficial tracker" and so does the footer. Borrowing their look is fine for a fan tool, passing as their site isn't.

## the OpenSea key expires

The free agent key from `POST /api/v2/auth/keys` expires after a week. When the market column goes quiet and the status says `OpenSea 401`, mint a new key and update `OPENSEA_API_KEY` in Vercel.
