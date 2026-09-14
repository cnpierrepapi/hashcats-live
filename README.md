# hashcats live

A live tracker for [Hashcats](https://hashcats.fun), proof-of-work cats on Robinhood Chain.

The top of the page is eggs now. On 12 Sep the team teased breeding: two cats go in, an egg comes out. They said the first update ships within 48 hours of 13 Sep and to keep cats and $HASH around. Nothing's on chain yet, so the Eggs panel sticks to what you'd need either way. The cheapest two cats on OpenSea, the $HASH price, a countdown.

Minting got pushed down the page. The mint price hit 0.164 ETH in epoch 10 while a fresh cat only burns or sells for about 0.11, so hardly anyone mints. It's still tracked, just not the headline.

## what's on it

Eggs, as above. It'll get real numbers when the contract lands.

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
