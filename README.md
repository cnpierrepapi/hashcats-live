# hashcats live

One sentence at the top of the page tells you what to do with [Hashcats](https://hashcats.fun) right now. Buy a specific cat, buy one and burn it, or wait. It changes the second a mint, burn or sale moves the numbers.

Hashcats are proof-of-work cats on Robinhood Chain. Every cat earns rent from later mints, and every cat can be burned for $HASH. So each one has two prices hiding in it, and OpenSea listings drift away from both. This page does the arithmetic on every listing and puts the best one first.

## how a cat gets valued

A cat is worth the better of its two exits.

- Hold it: the rent it's already owed, plus 0.000014 ETH for every mint still to come, up to the collection size you pick on the slider (the docs expect 17 to 20k).
- Burn it: the rent it's owed, plus its burn reward in $HASH at the pool's spot price. Slippage isn't counted.

Divide that by the ask and you get the `x` column. Anything past 1.15x turns the sentence green.

The hold number leans hard on that slider. At 17,000 cats most listings look cheap. Drag it to 5,000 and almost nothing does. Treat it like a bet on how long people keep mining.

## where the data comes from

Chain moves come straight into your browser over the drpc websocket. No server in the middle, nothing to cache.

OpenSea listings and sales come through `/api/market`, which also reads each listed cat's rent and burn reward from the contract in a single multicall. The CDN holds that response for 30 seconds, so the OpenSea key does about 4 reads per refresh however many people have the page open.

## run it

```
npm install
echo OPENSEA_API_KEY=your_key > .env.local
npm run dev
```

A free key comes back from `curl -X POST https://api.opensea.io/api/v2/auth/keys`. It lasts a week and allows 600 reads an hour.

Not financial advice. The numbers are only as good as the slider.
