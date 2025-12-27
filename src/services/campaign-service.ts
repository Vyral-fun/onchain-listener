import {
  getEcosystemDetails,
  getEnvChainIdsForActiveListeners,
} from "@/utils/ecosystem";
import { abi } from "../escrowV2.json";
import { abi as erc20Abi } from "../erc20.json";
import { ethers } from "ethers";
import { handleYapRequestCreated } from "@/api/jobs/jobs";
import { NULL_ADDRESS } from "@/utils/constants";

export interface NetworkContractListener {
  contract: ethers.Contract;
  abi: any;
  provider: ethers.WebSocketProvider;
  chainId: number;
  isActive: boolean;
  reconnectAttempts: number;
  lastEventTime: number;
  teardown: () => Promise<void>;
  stop: () => Promise<void>;
  reconnect: () => Promise<void>;
}

const MAX_RECONNECT_ATTEMPTS = 5;
const RECONNECT_DELAY = 5000; // 5 seconds
const HEALTH_CHECK_INTERVAL = 60000; // 1 minute

export const runtimeNetworkListeners: Record<number, NetworkContractListener> =
  {};

export async function createtNetworkListener(
  chainId: number,
  contractAddress: string
): Promise<NetworkContractListener> {
  const { wsUrl } = getEcosystemDetails(chainId);
  if (!wsUrl) {
    throw new Error(`WebSocket URL not found for chain ID: ${chainId}`);
  }

  const wsProvider = new ethers.WebSocketProvider(wsUrl);
  const contract = new ethers.Contract(contractAddress, abi, wsProvider);

  const listener: NetworkContractListener = {
    contract,
    abi,
    provider: wsProvider,
    chainId,
    isActive: true,
    reconnectAttempts: 0,
    lastEventTime: Date.now(),
    stop: async () => {
      console.log(
        `[${chainId}] Stopping listener for contract: ${contractAddress}`
      );
      listener.isActive = false;
      await contract.removeAllListeners();
      await wsProvider.destroy();
      delete runtimeNetworkListeners[chainId];
      console.log(`Stopped listener for contract: ${contractAddress}`);
    },
    reconnect: async () => {
      if (!listener.isActive) return;

      console.log(
        `[${chainId}] Attempting reconnection (attempt ${
          listener.reconnectAttempts + 1
        }/${MAX_RECONNECT_ATTEMPTS})`
      );

      if (listener.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
        console.error(
          `[${chainId}] Max reconnection attempts reached. Manual intervention required.`
        );
        return;
      }

      listener.reconnectAttempts++;

      try {
        await listener.stop();
        await new Promise((resolve) => setTimeout(resolve, RECONNECT_DELAY));

        const newListener = await createtNetworkListener(
          chainId,
          contractAddress
        );
        runtimeNetworkListeners[chainId] = newListener;

        console.log(`[${chainId}] Reconnection successful`);
      } catch (error) {
        console.error(`[${chainId}] Reconnection failed:`, error);
        setTimeout(() => listener.reconnect(), RECONNECT_DELAY);
      }
    },
    teardown: async () => {
      console.log(
        `[${chainId}] Tearing down listener for contract: ${contractAddress}`
      );
      listener.isActive = false;
      await contract.removeAllListeners();
      await wsProvider.destroy();
      console.log(
        `[${chainId}] Teardown complete for contract: ${contractAddress}`
      );
    },
  };

  contract.on(
    "YapRequestCreated",
    async (yapId, creator, jobId, asset, budget, fee, event) => {
      if (!listener.isActive) {
        console.log(
          `[${chainId}] Event received but listener is inactive. Ignoring.`
        );
        return;
      }

      listener.lastEventTime = Date.now();
      listener.reconnectAttempts = 0;

      let decimals: number;
      if (asset === NULL_ADDRESS) {
        decimals = 18;
      } else {
        try {
          const tokenContract = new ethers.Contract(
            asset,
            erc20Abi,
            wsProvider
          );
          decimals = await tokenContract.decimals();
        } catch (error) {
          console.error(
            `[${chainId}] Error fetching decimals for asset ${asset}:`,
            error
          );
          decimals = 18;
        }
      }

      const adjustedBudget = Number(ethers.formatUnits(budget, decimals));
      const adjustedFee = Number(ethers.formatUnits(fee, decimals));

      const txHash = event.log.transactionHash;
      console.log("YapRequestCreated event detected:");
      console.log("chainId", chainId);
      console.log("jobId", jobId);
      console.log("budget", adjustedBudget.toString());
      console.log("fee", adjustedFee.toString());
      console.log("tx hash", txHash);
      console.log(" ");

      try {
        console.log("Processing YapRequestCreated for jobId:", jobId);
        await handleYapRequestCreated(
          jobId,
          yapId,
          adjustedBudget,
          adjustedFee,
          chainId,
          txHash,
          creator,
          asset
        );
        console.log("Processed YapRequestCreated for jobId:", jobId);
        console.log(" ");
      } catch (error) {
        console.error("Error processing YapRequestCreated:", error);
      }
    }
  );

  wsProvider.on("open", () => {
    console.log(`[${chainId}] Provider reports WebSocket opened`);
  });

  wsProvider.on("close", (code, reason) => {
    console.warn(`[${chainId}] Provider reports close`, { code, reason });
    if (listener.isActive) listener.reconnect();
  });

  wsProvider.on("error", (error) => {
    console.error(`[${chainId}] Provider error`, error);
    if (listener.isActive) listener.reconnect();
  });

  console.log(`[${chainId}] Listener created successfully`);
  return listener;
}

export function startHealthCheck() {
  setInterval(() => {
    const now = Date.now();
    console.log("=== Health Check ===");

    for (const [chainId, listener] of Object.entries(runtimeNetworkListeners)) {
      const timeSinceLastEvent = now - listener.lastEventTime;
      const minutesSinceLastEvent = Math.floor(timeSinceLastEvent / 60000);

      console.log(`[${chainId}] Status:`);
      console.log(`  - Active: ${listener.isActive}`);
      console.log(`  - Last event: ${minutesSinceLastEvent} minutes ago`);
      console.log(`  - Reconnect attempts: ${listener.reconnectAttempts}`);
    }

    console.log("====================");
  }, HEALTH_CHECK_INTERVAL);
}

export async function updateNetworkContractListener(
  chainId: number,
  contractAddress: string
): Promise<NetworkContractListener> {
  let listener = runtimeNetworkListeners[chainId];
  let previousContractAddress = await listener?.contract.getAddress();

  if (previousContractAddress === contractAddress && listener) {
    return listener;
  }

  if (listener) {
    await listener.stop();
  }

  listener = await createtNetworkListener(chainId, contractAddress);
  runtimeNetworkListeners[chainId] = listener;

  return listener;
}

export async function updateNetworksListeners() {
  let envChainIds = getEnvChainIdsForActiveListeners();

  for (const chainId of envChainIds) {
    try {
      const { escrowContract } = getEcosystemDetails(chainId);
      await updateNetworkContractListener(chainId, escrowContract);
      console.log(`Listener active on chain ${chainId}`);
    } catch (err) {
      console.error(`Failed to start listener on chain ${chainId}:`, err);
    }
  }

  startHealthCheck();
  console.log("Health check monitoring started");
}
