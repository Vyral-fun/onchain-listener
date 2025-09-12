import { Alchemy, Network } from "alchemy-sdk";

export const BATCH_SIZE = 500;

export const NULL_ADDRESS = "0x0000000000000000000000000000000000000000";

export const ECOSYSTEM_DETAILS = [
  {
    chainId: 84532,
    ecosystem: "base_sepolia",
    network: Network.BASE_SEPOLIA,
    apiKey: Bun.env.ALCHEMY_BASE_SEPOLIA_KEY,
    rpcUrl: Bun.env.BASE_SEPOLIA_PROVIDER_URL,
    wsUrl: Bun.env.BASE_SEPOLIA_WS_PROVIDER_URL,
  },
  {
    chainId: 8453,
    ecosystem: "base_mainnet",
    network: Network.BASE_MAINNET,
    apiKey: Bun.env.ALCHEMY_BASE_MAINNET_KEY,
    rpcUrl: Bun.env.BASE_MAINNET_PROVIDER_URL,
    wsUrl: Bun.env.BASE_MAINNET_WS_PROVIDER_URL,
  },
  {
    chainId: 10143,
    ecosystem: "monad_testnet",
    network: Network.MONAD_TESTNET,
    apiKey: Bun.env.ALCHEMY_MONAD_TESTNET_KEY,
    rpcUrl: Bun.env.MONAD_PROVIDER_URL,
    wsUrl: Bun.env.MONAD_WS_PROVIDER_URL,
  },
];
