import { Alchemy, Network } from "alchemy-sdk";

export const BATCH_SIZE = 500;

export const NULL_ADDRESS = "0x0000000000000000000000000000000000000000";
export const YAP_API_URL = Bun.env.YAP_API_URL;
export const YAP_API_KEY = Bun.env.YAP_API_KEY;
export const BASE_CONTRACT_ADDRESS = Bun.env.BASE_ESCROW_CONTRACT;
export const MONAD_ESCROW_CONTRACT = Bun.env.MONAD_ESCROW_CONTRACT;

export const ECOSYSTEM_DETAILS = [
  {
    chainId: 84532,
    ecosystem: "base_sepolia",
    escrowContract: BASE_CONTRACT_ADDRESS,
    network: Network.BASE_SEPOLIA,
    apiKey: Bun.env.ALCHEMY_BASE_SEPOLIA_KEY,
    rpcUrl: Bun.env.BASE_SEPOLIA_PROVIDER_URL,
    wsUrl: Bun.env.BASE_SEPOLIA_WS_PROVIDER_URL,
    env: "development",
  },
  {
    chainId: 8453,
    ecosystem: "base_mainnet",
    escrowContract: BASE_CONTRACT_ADDRESS,
    network: Network.BASE_MAINNET,
    apiKey: Bun.env.ALCHEMY_BASE_MAINNET_KEY,
    rpcUrl: Bun.env.BASE_MAINNET_PROVIDER_URL,
    wsUrl: Bun.env.BASE_MAINNET_WS_PROVIDER_URL,
    env: "prod",
  },
  {
    chainId: 10143,
    ecosystem: "monad_testnet",
    escrowContract: MONAD_ESCROW_CONTRACT,
    network: Network.MONAD_TESTNET,
    apiKey: Bun.env.ALCHEMY_MONAD_TESTNET_KEY,
    rpcUrl: Bun.env.MONAD_PROVIDER_URL,
    wsUrl: Bun.env.MONAD_WS_PROVIDER_URL,
    env: "development",
  },
  {
    chainId: 143,
    ecosystem: "monad_mainnet",
    escrowContract: MONAD_ESCROW_CONTRACT,
    network: Network.MONAD_TESTNET, // TODO: change when details are added to ethers
    apiKey: Bun.env.ALCHEMY_MONAD_TESTNET_KEY,
    rpcUrl: Bun.env.MONAD_PROVIDER_URL,
    wsUrl: Bun.env.MONAD_WS_PROVIDER_URL,
    env: "prod",
  },
];
