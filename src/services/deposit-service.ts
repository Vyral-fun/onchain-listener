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
  backupProvider: ethers.JsonRpcProvider;
  iface: ethers.Interface;
  pollTimer: Timer | null;
  consecutiveErrors: number;
  usingBackup: boolean;
  stop: () => Promise<void>;
}

const RPC_TIMEOUT = 30000; // 30 seconds
const MAX_CONSECUTIVE_ERRORS = 5;
const HEALTH_CHECK_INTERVAL = 60000; // 1 minute
export const runtimeNetworkListeners: Record<number, NetworkContractListener> =
  {};

export async function createNetworkListener(
  chainId: number,
  contractAddress: string
): Promise<NetworkContractListener> {
  const { depositRpcUrl, backupDepositRPC, abi } = getEcosystemDetails(chainId);

  const iface = new ethers.Interface(abi);
  const httpProvider = new ethers.JsonRpcProvider(depositRpcUrl);
  const backupProvider = new ethers.JsonRpcProvider(backupDepositRPC);
  const currentBlock = await withTimeout(
    httpProvider.getBlockNumber(),
    RPC_TIMEOUT,
    "getBlockNumber"
  );

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
    backupProvider,
    consecutiveErrors: 0,
    usingBackup: false,
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
  const { chainId, contractAddress, iface } = listener;
  const { networkPollInterval } = getEcosystemDetails(chainId);
  const poll = async () => {
    if (!listener.isActive) {
      if (listener.pollTimer) clearTimeout(listener.pollTimer);
      return;
    }

    let nextPollDelay = networkPollInterval;

    try {
      let httpProvider = listener.httpProvider;

      if (listener.consecutiveErrors >= 2 && !listener.usingBackup) {
        console.warn(
          `[${chainId}] Switching to backup provider due to consecutive errors (${listener.consecutiveErrors})`
        );
        httpProvider = listener.backupProvider;
        listener.usingBackup = true;
      }

      const currentBlock = await withTimeout(
        httpProvider.getBlockNumber(),
        RPC_TIMEOUT,
        "getBlockNumber"
      );

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

      const batchSize =
        blocksBehind > 1000
          ? 100
          : blocksBehind > 500
          ? 80
          : blocksBehind > 200
          ? 50
          : blocksBehind > 50
          ? 30
          : Math.min(blocksBehind, 20);

      const toBlock = Math.min(currentBlock, fromBlock + batchSize - 1);

      if (fromBlock > toBlock) {
        nextPollDelay = networkPollInterval;
        return;
      }

      const logs = await withTimeout(
        httpProvider.getLogs({
          address: contractAddress,
          topics: [
            ethers.id(
              "YapRequestCreated(uint256,address,string,address,uint256,uint256)"
            ),
          ],
          fromBlock,
          toBlock,
        }),
        RPC_TIMEOUT,
        `getLogs(${fromBlock}-${toBlock})`
      );

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
      listener.consecutiveErrors = 0;
      listener.lastPollTime = Date.now();

      if (listener.usingBackup) {
        console.log(
          `[${chainId}] Successfully polling with backup RPC. Will retry primary next time.`
        );
        listener.usingBackup = false;
      }

      const remainingBlocks = currentBlock - toBlock;
      const catchUpDelay = Math.min(networkPollInterval / 2, 500);
      nextPollDelay = remainingBlocks > 10 ? catchUpDelay : networkPollInterval;
    } catch (error) {
      listener.consecutiveErrors++;
      console.error(
        `[${chainId}] Polling error (${listener.consecutiveErrors}/${MAX_CONSECUTIVE_ERRORS}):`,
        error,
        {
          currentBlock: listener.lastProcessedBlock,
          errorDetails: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
        }
      );

      if (
        listener.usingBackup &&
        listener.consecutiveErrors < MAX_CONSECUTIVE_ERRORS
      ) {
        console.warn(
          `[${chainId}] Backup RPC failed, switching back to primary`
        );
        listener.usingBackup = false;
      }

      if (listener.consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
        console.error(
          `[${chainId}] Too many consecutive errors. Stopping listener. Manual intervention required.`
        );
        await listener.stop();
        return;
      }
      nextPollDelay = networkPollInterval;
    } finally {
      if (listener.isActive) {
        listener.pollTimer = setTimeout(poll, nextPollDelay);
      }
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
      console.log(`  - Using backup RPC: ${listener.usingBackup}`);
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

function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  operation: string
): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(
        () => reject(new Error(`${operation} timeout after ${ms}ms`)),
        ms
      )
    ),
  ]);
}
