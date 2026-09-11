# architecture

Two halves, split by how fast the data moves and who's allowed to hold a key.

## browser half (app/page.tsx)

Opens a websocket to `wss://robinhood.drpc.org` with viem and subscribes to `Transfer` logs on the collection. A transfer from zero is a mint, a transfer to zero is a burn, anything else is a transfer. Each one lands in the moves feed as it happens and triggers a fresh read of the chain tiles.

The tiles (minted, burned, epoch, target bits, mint price, last mint) come from one multicall over the same socket. It also re-reads every 5 seconds in case a log gets dropped.

The strategy sentence and the listing table are computed here too, from the market payload plus the live mint count. That's why the slider feels instant: moving it re-values every listing locally without calling the server.

## server half (app/api/market/route.ts)

One route. It does four things at once:

1. $HASH price from DexScreener, using the deepest pool
2. every ETH/WETH listing on OpenSea for `hash-cats`, keeping the lowest ask per cat
3. the last 40 OpenSea sales
4. `ownerOf`, `claimable`, `rentFloor` and `burnReward` for every listed cat, packed into one Multicall3 call against the public RPC

It returns raw numbers, not verdicts. The response carries `Cache-Control: s-maxage=30, stale-while-revalidate=60`, so Vercel's CDN answers repeat visitors and the function runs about twice a minute at most.

## contracts

| what | address |
| --- | --- |
| collection (ERC-721, mining, rent) | `0xCA75DF55Cc9C476DB27a7375D1fc8E794cf80721` |
| $HASH | `0xCA75082b85bb7Bec8325d513F615b16BDa260020` |
| Uniswap v4 hook | `0xca757986e932bc55776492cca0b413e9b3d02acc` |
| Multicall3 | `0xcA11bde05977b3631167028862bE2a173976CA11` |

Chain id 4663. The ABI fragments in `lib/hashcats.ts` came from the hashcats.fun bundle and were checked against the live contract with `eth_call`.
