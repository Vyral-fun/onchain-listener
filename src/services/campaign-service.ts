import { getEcosystemDetails, getEnvChainIds } from "@/utils/ecosystem";
import { abi } from "../escrowV2.json";
import { ethers } from "ethers";
import { handleYapRequestCreated } from "@/api/jobs/jobs";

export interface NetworkContractListener {
  contract: ethers.Contract;
  abi: any;
  provider: ethers.WebSocketProvider;
  chainId: number;
  isActive: boolean;
  stop: () => Promise<void>;
}

const runtimeNetworkListeners: Record<number, NetworkContractListener> = {};

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
    stop: async () => {
      await contract.removeAllListeners();
      await wsProvider.destroy();
      delete runtimeNetworkListeners[chainId];
      console.log(`Stopped listener for contract: ${contractAddress}`);
    },
  };

  contract.on(
    "YapRequestCreated",
    async (yapId, creator, jobId, asset, budget, fee, event) => {
      if (!listener.isActive) return;

      const txHash = event.log.transactionHash;
      console.log("tx hash", txHash);

      try {
        await handleYapRequestCreated(
          jobId,
          yapId,
          budget,
          fee,
          chainId,
          txHash,
          creator,
          asset
        );
      } catch (error) {
        console.error("Error processing YapRequestCreated:", error);
      }
    }
  );

  wsProvider.on("error", (error) => {
    console.error(
      `WebSocket Provider error for contract ${contractAddress}:`,
      error
    );
  });

  return listener;
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
    listener.stop();
  }

  listener = await createtNetworkListener(chainId, contractAddress);
  runtimeNetworkListeners[chainId] = listener;

  return listener;
}

export async function updateNetworksListeners() {
  let envChainIds = getEnvChainIds();

  for (const chainId of envChainIds) {
    try {
      const { escrowContract } = getEcosystemDetails(chainId);
      await updateNetworkContractListener(chainId, escrowContract);
      console.log(`Listener active on chain ${chainId}`);
    } catch (err) {
      console.error(`Failed to start listener on chain ${chainId}:`, err);
    }
  }
}
