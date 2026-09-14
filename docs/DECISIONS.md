# decisions

## chain data goes browser-direct, market data goes through a function

Vercel functions can't hold a websocket open, and polling the chain from a function would burn through the public RPC's rate limit fast. drpc's websocket accepts connections from any origin (tested from a vercel.app origin before building), so the browser subscribes itself. Every viewer gets their own stream and nobody shares a quota.

OpenSea needs a key, and a key can't ship to the browser. So that part runs server-side.

## 2 minute CDN cache on /api/market

This started at 30 seconds. On 14 Sep the logs had the function running three or four times a minute at about 3.6 seconds a go, which is roughly five hours of function time a day for a page a handful of people look at. Three things stacked up. The 30 second cache went stale almost every time a tab polled. Every tab polled every 30 seconds, even ones sitting in the background. And every run waited on vast.ai for a GPU price.

Now the cache is 2 minutes with 10 minutes of stale-while-revalidate, tabs poll once a minute and stop when hidden, and the vast.ai call is gone. Listings and sales don't change faster than that anyway. The chain half never touched the function and still doesn't.

It also keeps the OpenSea key comfortable. The free key allows 600 reads an hour and one run spends about 4.

## value only listed cats, not the whole collection

The local scanner values all ~1,100 cats, which is about 4,400 subcalls and 16 seconds. The page only needs the ~170 that are listed, so the function values those. One multicall, well under a second.

## the server returns numbers, the browser decides

The collection-size slider changes every hold value. If the server did the valuing, every slider move would need a round trip. Keeping `value()` and `strategy()` in `lib/strategy.ts` and running them client-side makes the slider instant and keeps the server cache useful.

## 1.15x before a listing gets a mention

Burn value assumes spot price with no slippage, and the $HASH pool moves a lot. Hold value assumes a collection size nobody can promise. A 15% cushion keeps a listing out of the headline on noise.

## the look matches hashcats.fun, rebuilt, not lifted

Same palette, same three Google fonts (Jersey 10, DotGothic16, VT323), same 3px pixel grid and dotted background. Their frames are 27px PNGs: an ink outline, a light edge top-left, a dark edge bottom-right, base colour between. Here they're three stacked inset box-shadows with the same colours, so there are no copied image files and any frame can take any colour.

The header says "unofficial tracker" and so does the footer. Borrowing their look is fine for a fan tool, passing as their site isn't.

## mint gap replaced mine or wait (14 Sep)

The first version priced a rented RTX 5090 against the target and said mine, close call or wait. By 14 Sep that question was dead. The target had fallen from 48 bits to 35, so hashing a cat costs close to nothing, and a public GPU miner (kaoscodes/hashcats-headless) had shipped anyway. The cost of a cat is now just the mint price.

And the mint price had run away. Epoch 10 costs 0.164 ETH. A fresh cat burns for 1000 $HASH, about 0.115 ETH after the swap fee, and the floor sells for about the same. Minting went from 1,164 cats in a day to 19 in six hours.

So the panel asks one thing: does a new cat pay back its mint? Two exits, same as before. Burning pays 1000 $HASH less the hook's swap fee, read live from the hook. Selling pays the OpenSea floor less OpenSea and creator fees. The better one is the exit, and the gap is exit over mint, minus one.

The number worth watching is the break-even: mint price over (1000 times what's left after the swap fee). That's the $HASH price where minting pays again, and the page shows how far off it is.

If mining ever gets expensive again, cost per cat is 2^256 divided by the current target. Don't average 2^(leading zeros) over winning hashes. That overshot 2 to 4 times on 11 Sep.

## eggs took the headline (14 Sep)

Minting stalled and the team moved on. On 12 Sep they posted a breeding teaser (Cat A and Cat B slots feeding an Egg slot), and on 13 Sep they said the first update ships within 48 hours and to have cats and $HASH ready. That's where the attention is, so that's the top of the page.

There's no contract to read yet. So the Eggs panel only shows things that are true however breeding works: the two cheapest listings added up (you need two cats), the $HASH price, cats alive and a countdown to the 48 hour mark. No guessed costs. When the contract ships, read the ABI out of the hashcats.fun bundle like last time and give the panel real numbers.

The mint gap still lives on, one panel in the row, with the break-even and the sales line as its note.

## pace and buyback read from the browser

Both panels are plain contract reads, so they go over the drpc socket like everything else on the chain side and cost no function time. Pace is `totalMinted` and `burnedCount` now minus the same reads at blocks 1, 6 and 24 hours back. Buyback is the hook's `queue`, `buybackSpent` and `buybackBurned`, the same calls hashcats.fun makes.

The listing slider now starts at today's count instead of 17,000. With minting stalled, rent from future mints is a guess, and the honest default is none.

## the OpenSea key expires

The free agent key from `POST /api/v2/auth/keys` expires after a week. When the market column goes quiet and the status says `OpenSea 401`, mint a new key and update `OPENSEA_API_KEY` in Vercel.
