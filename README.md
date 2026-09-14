# hashcats live

Is minting on [Hashcats](https://hashcats.fun) worth it right now, and if not, how far off is it? That's the sentence at the top of the page. It updates as mints, burns and sales land.

Hashcats are proof-of-work cats on Robinhood Chain. In September 2026 the mint price hit 0.164 ETH in epoch 10, while a fresh cat only burns or sells for about 0.115. Minting mostly stopped. So the page tracks the gap between those two numbers and the $HASH price that would close it.

## what's on it

The mint gap. A new cat's cost against its better exit: burn it for 1000 $HASH (less the swap fee), or sell it at the OpenSea floor (less fees). Plus the $HASH price where the two meet.

Pace. Mints in the last hour, 6 hours and day, burns, and how full the epoch is. That's the difference between a slow day and a full stop.

Buyback. What the hook has queued to buy $HASH, what it's spent, and how much $HASH it's burned. Mints fill the queue. No mints, nothing new goes in.

Listings, valued the old way: rent owed plus rent from future mints up to a collection size you pick, or the burn reward at spot. The slider starts at today's count because nobody's minting.

And a feed of every mint, burn, transfer and sale.

## where the data comes from

Everything on the chain side comes straight into your browser over the drpc websocket. No server, nothing billed.

OpenSea listings, sales and the $HASH price come through `/api/market`. The CDN holds that for 2 minutes, and a tab in the background stops asking, so the function runs about once every two minutes however many people are watching.

## run it

```
npm install
echo OPENSEA_API_KEY=your_key > .env.local
npm run dev
```

A free key comes back from `curl -X POST https://api.opensea.io/api/v2/auth/keys`. It lasts a week and allows 600 reads an hour.

Not financial advice.
