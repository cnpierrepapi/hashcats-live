import { defineChain, parseAbi, parseAbiItem } from "viem";

export const COLLECTION = "0xCA75DF55Cc9C476DB27a7375D1fc8E794cf80721" as const;
export const HASH_TOKEN = "0xCA75082b85bb7Bec8325d513F615b16BDa260020" as const;
export const MULTICALL3 = "0xcA11bde05977b3631167028862bE2a173976CA11" as const;
export const HOOK = "0xca757986e932bc55776492cca0b413e9b3d02acc" as const;
export const HTTP_RPC = "https://rpc.mainnet.chain.robinhood.com";
export const WSS_RPC = "wss://robinhood.drpc.org";
export const SLUG = "hash-cats";

export const robinhood = defineChain({
  id: 4663,
  name: "Robinhood Chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [HTTP_RPC], webSocket: [WSS_RPC] } },
  contracts: { multicall3: { address: MULTICALL3 } },
});

export const abi = parseAbi([
  "function totalMinted() view returns (uint256)",
  "function currentEpoch() view returns (uint256)",
  "function mintPrice() view returns (uint256)",
  "function lastMintTime() view returns (uint256)",
  "function currentTarget() view returns (uint256)",
  "function burnedCount() view returns (uint256)",
  "function RENT_STEP() view returns (uint256)",
  "function ownerOf(uint256 id) view returns (address)",
  "function claimable(uint256 id) view returns (uint256)",
  "function rentFloor(uint256 id) view returns (uint256)",
  "function burnReward(uint256 id) view returns (uint256)",
]);

// The Uniswap v4 hook: its swap fee on the ether side of every $HASH trade, and the buyback
// it runs with mint proceeds. Same reads hashcats.fun makes.
export const hookAbi = parseAbi([
  "function currentFee() view returns (uint16)",
  "function queue() view returns (uint256)",
  "function buybackSpent() view returns (uint128)",
  "function buybackBurned() view returns (uint128)",
  "function capPerBlock() view returns (uint256)",
]);

export const transferEvent = parseAbiItem(
  "event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)",
);

export const LINKS = {
  "Mine a cat": "https://hashcats.fun/mine",
  OpenSea: `https://opensea.io/collection/${SLUG}`,
  "$HASH chart": "https://dexscreener.com/robinhood/0x42b009f327076bc462dc1725c29221938f8f96307f356121a8445b889d036ea7",
  "Buy $HASH": `https://app.uniswap.org/swap?chain=robinhood&outputCurrency=${HASH_TOKEN}`,
  Contract: `https://robinhoodchain.blockscout.com/address/${COLLECTION}`,
};

// Breeding, as teased on X. Nothing is on chain yet, so this is all the page knows.
// The 13 Sep post said the first update ships "within 48 hours".
export const EGGS = {
  teaser: "https://x.com/hashcats_rh/status/2098872023543943354",
  update: "https://x.com/hashcats_rh/status/2099257805387509791",
  due: Date.parse("2026-09-15T22:03:57Z") / 1000,
};

export const catLink =(id: number) => `https://opensea.io/item/robinhood/${COLLECTION.toLowerCase()}/${id}`;
export const txLink = (hash: string) => `https://robinhoodchain.blockscout.com/tx/${hash}`;
export const addrLink = (a: string) => `https://robinhoodchain.blockscout.com/address/${a}`;
