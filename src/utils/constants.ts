import { Network } from "alchemy-sdk";
import { abi as escrowV2Abi } from "../escrowV2.json";
import { abi as monadEscrowV2Abi } from "../monadEscrowV2.json";
import {
  arbitrum,
  base,
  bsc,
  mainnet,
  monad,
  optimism,
  polygon,
} from "viem/chains";

export const BATCH_SIZE = 500;
export const MAX_BLOCKS_PER_QUERY = 3;
const isProd = Bun.env.NODE_ENV === "production";
export const TIMEOUT_MS = 30_000;
export const UPDATE_INTERVAL_MS = isProd ? 24 * 60 * 60 * 1000 : 1 * 60 * 1000;
export const LOG_EVERY_N_BLOCKS = isProd ? 100 : 20;
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
    chain: base,
    network: Network.BASE_SEPOLIA,
    apiKey: Bun.env.ALCHEMY_BASE_SEPOLIA_KEY,
    rpcUrl: Bun.env.BASE_SEPOLIA_PROVIDER_URL,
    depositRpcUrl: Bun.env.BASE_DEPOSIT_RPC_URL,
    networkPollInterval: 1000, // 1 second
    env: "development",
    forActiveListener: true,
    abi: escrowV2Abi,
  },
  {
    chainId: 8453,
    ecosystem: "base_mainnet",
    escrowContract: BASE_CONTRACT_ADDRESS,
    chain: base,
    network: Network.BASE_MAINNET,
    apiKey: Bun.env.ALCHEMY_BASE_MAINNET_KEY,
    rpcUrl: Bun.env.BASE_MAINNET_PROVIDER_URL,
    depositRpcUrl: Bun.env.BASE_DEPOSIT_RPC_URL,
    networkPollInterval: 1000, // 1 second
    env: "prod",
    forActiveListener: true,
    abi: escrowV2Abi,
  },
  {
    chainId: 10143,
    ecosystem: "monad_testnet",
    escrowContract: MONAD_ESCROW_CONTRACT,
    chain: monad,
    network: Network.MONAD_TESTNET,
    apiKey: Bun.env.ALCHEMY_MONAD_TESTNET_KEY,
    rpcUrl: Bun.env.MONAD_PROVIDER_URL,
    depositRpcUrl: Bun.env.MONAD_DEPOSIT_RPC_URL,
    networkPollInterval: 1000, // 1 second
    env: "development",
    forActiveListener: true,
    abi: monadEscrowV2Abi,
  },
  {
    chainId: 143,
    ecosystem: "monad_mainnet",
    escrowContract: MONAD_ESCROW_CONTRACT,
    chain: monad,
    network: Network.MONAD_TESTNET, // TODO: change when details are added to ethers
    apiKey: Bun.env.ALCHEMY_MONAD_TESTNET_KEY,
    rpcUrl: Bun.env.MONAD_PROVIDER_URL,
    depositRpcUrl: Bun.env.MONAD_DEPOSIT_RPC_URL,
    networkPollInterval: 1000, // 1 second
    env: "prod",
    forActiveListener: false,
    abi: monadEscrowV2Abi,
  },
  {
    chainId: 1,
    ecosystem: "ethereum_mainnet",
    escrowContract: NULL_ADDRESS,
    chain: mainnet,
    network: Network.ETH_MAINNET,
    apiKey: Bun.env.ALCHEMY_API_KEY,
    rpcUrl: Bun.env.ETHEREUM_PROVIDER_URL,
    depositRpcUrl: Bun.env.ETHEREUM_PROVIDER_URL,
    env: "prod",
    networkPollInterval: 12000, // 12 seconds
    forActiveListener: false,
    abi: escrowV2Abi,
  },
  {
    chainId: 11155111,
    ecosystem: "ethereum_sepolia",
    escrowContract: NULL_ADDRESS,
    network: Network.ETH_SEPOLIA,
    chain: mainnet,
    apiKey: Bun.env.ALCHEMY_API_KEY,
    rpcUrl: Bun.env.ETHEREUM_SEPOLIA_PROVIDER_URL,
    depositRpcUrl: Bun.env.ETHEREUM_SEPOLIA_PROVIDER_URL,
    networkPollInterval: 12000, // 12 seconds
    env: "development",
    forActiveListener: false,
    abi: escrowV2Abi,
  },
  {
    chainId: 10,
    ecosystem: "opt_mainnet",
    escrowContract: NULL_ADDRESS,
    chain: optimism,
    network: Network.OPT_MAINNET,
    apiKey: Bun.env.ALCHEMY_API_KEY,
    rpcUrl: Bun.env.OPT_MAINNET_PROVIDER_URL,
    depositRpcUrl: Bun.env.OPT_MAINNET_PROVIDER_URL,
    networkPollInterval: 2000, // 2 seconds
    env: "prod",
    forActiveListener: false,
    abi: escrowV2Abi,
  },
  {
    chainId: 11155420,
    ecosystem: "opt_sepolia",
    escrowContract: NULL_ADDRESS,
    chain: optimism,
    network: Network.OPT_SEPOLIA,
    apiKey: Bun.env.ALCHEMY_API_KEY,
    rpcUrl: Bun.env.OPT_SEPOLIA_PROVIDER_URL,
    depositRpcUrl: Bun.env.OPT_SEPOLIA_PROVIDER_URL,
    networkPollInterval: 2000, // 2 seconds
    env: "development",
    forActiveListener: false,
    abi: escrowV2Abi,
  },
  {
    chainId: 42161,
    ecosystem: "arbitrum_mainnet",
    escrowContract: NULL_ADDRESS,
    chain: arbitrum,
    network: Network.ARB_MAINNET,
    apiKey: Bun.env.ALCHEMY_API_KEY,
    rpcUrl: Bun.env.ARB_MAINNET_PROVIDER_URL,
    depositRpcUrl: Bun.env.ARB_MAINNET_PROVIDER_URL,
    networkPollInterval: 250, // 250 ms (very fast blocks)
    env: "prod",
    forActiveListener: false,
    abi: escrowV2Abi,
  },
  {
    chainId: 421614,
    ecosystem: "arb_sepolia",
    escrowContract: NULL_ADDRESS,
    chain: arbitrum,
    network: Network.ARB_SEPOLIA,
    apiKey: Bun.env.ALCHEMY_API_KEY,
    rpcUrl: Bun.env.ARB_SEPOLIA_PROVIDER_URL,
    depositRpcUrl: Bun.env.ARB_SEPOLIA_PROVIDER_URL,
    networkPollInterval: 500, // 500 ms
    env: "development",
    forActiveListener: false,
    abi: escrowV2Abi,
  },
  {
    chainId: 56,
    ecosystem: "bnb_mainnet",
    escrowContract: NULL_ADDRESS,
    chain: bsc,
    network: Network.BNB_MAINNET,
    apiKey: Bun.env.ALCHEMY_API_KEY,
    rpcUrl: Bun.env.BNB_MAINNET_PROVIDER_URL,
    depositRpcUrl: Bun.env.BNB_MAINNET_PROVIDER_URL,
    networkPollInterval: 3000, // 3 seconds
    env: "prod",
    forActiveListener: false,
    abi: escrowV2Abi,
  },
  {
    chainId: 97,
    ecosystem: "bnb_testnet",
    escrowContract: NULL_ADDRESS,
    chain: bsc,
    network: Network.BNB_TESTNET,
    apiKey: Bun.env.ALCHEMY_API_KEY,
    rpcUrl: Bun.env.BNB_TESTNET_PROVIDER_URL,
    depositRpcUrl: Bun.env.BNB_TESTNET_PROVIDER_URL,
    networkPollInterval: 3000, // 3 seconds
    env: "development",
    forActiveListener: false,
    abi: escrowV2Abi,
  },
  {
    chainId: 80002,
    ecosystem: "polygon_amoy",
    escrowContract: NULL_ADDRESS,
    chain: polygon,
    network: Network.POLYGONZKEVM_CARDONA,
    apiKey: Bun.env.ALCHEMY_API_KEY,
    rpcUrl: Bun.env.POLYGON_AMOY_PROVIDER_URL,
    depositRpcUrl: Bun.env.POLYGON_AMOY_PROVIDER_URL,
    networkPollInterval: 3000, // 3 seconds
    env: "development",
    forActiveListener: false,
    abi: escrowV2Abi,
  },
  {
    chainId: 137,
    ecosystem: "polygon_mainnet",
    escrowContract: NULL_ADDRESS,
    chain: polygon,
    network: Network.POLYGONZKEVM_CARDONA,
    apiKey: Bun.env.ALCHEMY_API_KEY,
    rpcUrl: Bun.env.POLYGON_MAINNET_PROVIDER_URL,
    depositRpcUrl: Bun.env.POLYGON_MAINNET_PROVIDER_URL,
    networkPollInterval: 3000, // 3 seconds
    env: "development",
    forActiveListener: false,
    abi: escrowV2Abi,
  },
];
