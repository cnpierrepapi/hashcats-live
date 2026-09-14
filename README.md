# hashcats live

A live tracker for [Hashcats](https://hashcats.fun), proof-of-work cats on Robinhood Chain.

The top of the page is eggs. On 12 Sep the team teased breeding: two cats go in, an egg comes out. They said the first update ships within 48 hours of 13 Sep and to keep cats and $HASH around. Nothing's on chain yet, so the Eggs panel sticks to what you'd need either way. The cheapest two cats on OpenSea, the $HASH price, a countdown.

Minting isn't the story anymore. Epoch 10 costs 0.164 ETH and hardly anyone pays it, so it's off the page.

## what's on it

Eggs, as above. It'll get real numbers when the contract lands.

The $HASH band. The team pointed out two bounds that live in the contract. A cat burns for 1,000 $HASH, so that's its floor. And a cat mints for 0.16368 ETH, so $HASH can't sit above 0.00016368 for long, or people would mint and burn for free money. The panel shows where $HASH is between those, and how the OpenSea floor compares to the burn.

Market, from OpenSea's stats: volume and sales for the day and the week, plus holders.

Buyback. What the hook has queued to buy $HASH, how much it'll spend per block, what it's spent, and how much $HASH it's burned.

Listings, valued as the better of rent or burn. And a feed of every mint, burn, transfer and sale.

## where the data comes from

Everything on the chain side comes straight into your browser over the drpc websocket. No server, nothing billed.

OpenSea listings, sales and stats plus the $HASH price come through `/api/market`. The CDN holds that for 2 minutes, and a tab in the background stops asking, so the function runs about once every two minutes however many people are watching.

## run it

```
npm install
echo OPENSEA_API_KEY=your_key > .env.local
npm run dev
```

A free key comes back from `curl -X POST https://api.opensea.io/api/v2/auth/keys`. It lasts a week and allows 600 reads an hour.

Not financial advice.
