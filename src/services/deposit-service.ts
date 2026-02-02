import {
  getEcosystemDetails,
  getEnvChainIdsForActiveListeners,
} from "@/utils/ecosystem";
import { abi as erc20Abi } from "../erc20.json";
import { ethers } from "ethers";
import { handleYapRequestCreated } from "@/api/jobs/jobs";
import {
  LOG_EVERY_N_BLOCKS,
  MAX_BLOCKS_PER_QUERY,
  NULL_ADDRESS,
} from "@/utils/constants";
import { handleYapRequestCreatedQueue } from "./queue";

export const decimalsCache = new Map<string, number>();

export type ERC20 = {
  decimals(): Promise<number>;
};

export interface NetworkContractListener {
  abi: any;
  chainId: number;
  contractAddress: string;
  isActive: boolean;
  lastProcessedBlock: number;
  lastBlockLogTime: number;
  lastLoggedBlock: number;
  lastPollTime: number;
  httpProvider: ethers.JsonRpcProvider;
  iface: ethers.Interface;
  pollTimer: Timer | null;
  consecutiveErrors: number;
  stop: () => Promise<void>;
}

const MAX_CONSECUTIVE_ERRORS = 5;
const HEALTH_CHECK_INTERVAL = 60000; // 1 minute
const POLL_INTERVAL = 8000;
export const runtimeNetworkListeners: Record<number, NetworkContractListener> =
  {};

export async function createNetworkListener(
  chainId: number,
  contractAddress: string
): Promise<NetworkContractListener> {
  const { depositRpcUrl, abi } = getEcosystemDetails(chainId);

  const iface = new ethers.Interface(abi);
  const httpProvider = new ethers.JsonRpcProvider(depositRpcUrl);
  const currentBlock = await httpProvider.getBlockNumber();

  const listener: NetworkContractListener = {
    abi,
    chainId,
    contractAddress,
    isActive: true,
    lastProcessedBlock: currentBlock,
    lastLoggedBlock: currentBlock,
    lastBlockLogTime: 0,
    lastPollTime: Date.now(),
    iface,
    pollTimer: null,
    httpProvider,
    consecutiveErrors: 0,
    async stop() {
      listener.isActive = false;

      if (listener.pollTimer) {
        clearTimeout(listener.pollTimer);
        listener.pollTimer = null;
      }

      delete runtimeNetworkListeners[chainId];
    },
  };

  startPolling(listener);

  return listener;
}

async function startPolling(listener: NetworkContractListener) {
  const { chainId, contractAddress, httpProvider, iface } = listener;
  const poll = async () => {
    if (!listener.isActive) {
      if (listener.pollTimer) clearTimeout(listener.pollTimer);
      return;
    }

    try {
      const currentBlock = await httpProvider.getBlockNumber();
      const fromBlock = listener.lastProcessedBlock + 1;
      const blocksBehind = currentBlock - listener.lastProcessedBlock;

      if (
        blocksBehind > 10 &&
        currentBlock - listener.lastLoggedBlock >= LOG_EVERY_N_BLOCKS
      ) {
        console.log(
          `[${chainId}] Deposit Polling | head=${currentBlock} lastProcessed=${listener.lastProcessedBlock} lag=${blocksBehind}`
        );

        listener.lastLoggedBlock = currentBlock;
      }

      const dynamicInterval =
        blocksBehind > 100 ? 1000 : blocksBehind > 50 ? 1500 : POLL_INTERVAL;

      const batchSize =
        blocksBehind > 1000
          ? 100
          : blocksBehind > 500
          ? 50
          : blocksBehind > 50
          ? 30
          : blocksBehind > 50
          ? 20
          : blocksBehind > 10
          ? 10
          : MAX_BLOCKS_PER_QUERY;

      const toBlock = Math.min(currentBlock, fromBlock + batchSize - 1);

      if (fromBlock > toBlock) {
        listener.lastPollTime = Date.now();
        listener.pollTimer = setTimeout(poll, dynamicInterval);
        return;
      }

      const logs = await httpProvider.getLogs({
        address: contractAddress,
        topics: [
          ethers.id(
            "YapRequestCreated(uint256,address,string,address,uint256,uint256)"
          ),
        ],
        fromBlock,
        toBlock,
      });

      for (const log of logs) {
        try {
          const parsed = iface.parseLog({
            topics: log.topics as string[],
            data: log.data,
          });

          if (parsed?.name === "YapRequestCreated") {
            const { yapId, creator, jobId, asset, budget, fee } = parsed.args;

            let decimals = 18;
            if (asset !== NULL_ADDRESS) {
              try {
                const cached = decimalsCache.get(asset);
                if (cached !== undefined) {
                  decimals = cached;
                } else {
                  const tokenContract = new ethers.Contract(
                    asset,
                    erc20Abi,
                    httpProvider
                  ) as unknown as ERC20;

                  decimals = await tokenContract.decimals();
                  decimalsCache.set(asset, decimals);
                }
              } catch (error) {
                console.error(
                  `[${chainId}] Error fetching decimals for asset ${asset}:`,
                  error
                );
              }
            }

            const adjustedBudget = Number(ethers.formatUnits(budget, decimals));
            const adjustedFee = Number(ethers.formatUnits(fee, decimals));

            console.log(
              `[${chainId}] YapRequestCreated event detected for job: ${jobId}`
            );

            await handleYapRequestCreatedQueue.add(
              "handleYapRequestCreated",
              {
                jobId,
                yapId: Number(yapId),
                adjustedBudget,
                adjustedFee,
                chainId,
                transactionHash: log.transactionHash,
                creator,
                asset,
                blockNumber: log.blockNumber,
              },
              {
                jobId:
                  "handleYapRequestCreated" +
                  `-${jobId}` +
                  `-${yapId}` +
                  `-${log.transactionHash}`,
                removeOnComplete: true,
              }
            );
          }
        } catch (parseError) {
          console.error(`[${chainId}] Error parsing log:`, parseError);
        }
      }

      listener.lastProcessedBlock = toBlock;
      listener.lastPollTime = Date.now();
      listener.consecutiveErrors = 0;

      const remainingBlocks = currentBlock - toBlock;
      const nextPollDelay = remainingBlocks > 10 ? 0 : dynamicInterval;
      listener.pollTimer = setTimeout(poll, nextPollDelay);
    } catch (error) {
      listener.consecutiveErrors++;
      console.error(
        `[${chainId}] Polling error (${listener.consecutiveErrors}/${MAX_CONSECUTIVE_ERRORS}):`,
        error
      );

      if (listener.consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
        console.error(
          `[${chainId}] Too many consecutive errors. Stopping listener. Manual intervention required.`
        );
        await listener.stop();
        return;
      }

      listener.pollTimer = setTimeout(poll, POLL_INTERVAL);
    }
  };

  poll();
}

export function startHealthCheck() {
  setInterval(() => {
    const now = Date.now();
    console.log("=== Health Check ===");

    for (const [chainId, listener] of Object.entries(runtimeNetworkListeners)) {
      const timeSinceLastPoll = now - listener.lastPollTime;
      const secondsSinceLastPoll = Math.floor(timeSinceLastPoll / 1000);

      console.log(`[${chainId}] Status:`);
      console.log(`  - Active: ${listener.isActive}`);
      console.log(`  - Last processed block: ${listener.lastProcessedBlock}`);
      console.log(`  - Last poll: ${secondsSinceLastPoll} seconds ago`);
      console.log(`  - Consecutive errors: ${listener.consecutiveErrors}`);

      const MAX_POLL_DELAY = 60000;
      if (timeSinceLastPoll > MAX_POLL_DELAY && listener.isActive) {
        console.error(
          `[${chainId}] WARNING: No successful poll for ${secondsSinceLastPoll}s. Polling may be stalled.`
        );
      }
    }

    console.log("====================");
  }, HEALTH_CHECK_INTERVAL);
}

export async function updateNetworkContractListener(
  chainId: number,
  contractAddress: string
): Promise<NetworkContractListener> {
  const listener = runtimeNetworkListeners[chainId];

  if (listener?.contractAddress === contractAddress) {
    return listener;
  }

  if (listener) {
    await listener.stop();
  }

  const newListener = await createNetworkListener(chainId, contractAddress);
  runtimeNetworkListeners[chainId] = newListener;

  return newListener;
}

export async function updateNetworksListeners() {
  const envChainIds = getEnvChainIdsForActiveListeners();

  for (const chainId of envChainIds) {
    try {
      const { escrowContract } = getEcosystemDetails(chainId);
      await updateNetworkContractListener(chainId, escrowContract);
    } catch (err) {
      console.error(`[${chainId}] Failed to start listener:`, err);
    }
  }

  startHealthCheck();
}

export async function resumeFrom(chainId: number, block: number) {
  const listener = runtimeNetworkListeners[chainId];
  if (!listener) {
    console.error(
      `[${chainId}] Cannot resume listener: Listener does not exist`
    );
    return;
  }
  listener.lastProcessedBlock = block;
  listener.lastLoggedBlock = block;
  listener.consecutiveErrors = 0;

  console.log(`[${chainId}] Listener resumed from block ${block}`);
}
