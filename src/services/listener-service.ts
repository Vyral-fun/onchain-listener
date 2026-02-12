import { ethers } from "ethers";
import { db } from "@/db";
import {
  contractEvents,
  contractListeners,
  jobs,
  listenerState,
} from "@/db/schema/event";
import { getEcosystemDetails } from "@/utils/ecosystem";
import { and, desc, eq, ne, sql } from "drizzle-orm";
import { LOG_EVERY_N_BLOCKS, NULL_ADDRESS } from "@/utils/constants";
import {
  createPublicClient,
  http,
  numberToHex,
  type PublicClient,
  type Transaction,
} from "viem";
import {
  getQueueForChain,
  getWorkerForChain,
  initializeAllChainQueues,
  shutdownQueueForChain,
} from "./network.queues";
import { sendNetworkAlert, getAlertThreshold, shouldSendAlert } from "./alert";

export interface JobEventSubscription {
  jobId: string;
  eventsToListenFor: string[];
  contractAddress: string;
  createdAt: Date;
}

export interface ContractSubscription {
  contractAddress: string;
  abi: any;
  iface: ethers.Interface;
  eventsBeingListened: Set<string>;
}

export interface NetworkListener {
  chainId: number;
  client: any;
  contracts: Map<string, ContractSubscription>;
  lastProcessedBlock: number;
  lastLoggedBlock: number;
  pollTimer: Timer | null;
  isActive: boolean;
  lastAlertSentAt: number;
  stop: () => Promise<void>;
}

export type NormalizedEvent = {
  name: string;
  address: string;
  sender?: string;
  receiver?: string;
  value?: bigint;
  blockNumber: number;
  transactionHash: string;
  rawArgs: any[];
};

const networkListeners: Map<number, NetworkListener> = new Map();

const POLL_INTERVAL = 10000;
const MAX_BLOCKS_PER_QUERY = 3;

export async function subscribeJobToContractListener(
  jobId: string,
  contractAddress: string,
  abi: any,
  chainId: number,
  eventsToListenFor: string[]
) {
  if (eventsToListenFor.length > 0) {
    const { invalid } = validateEvents(abi, eventsToListenFor);
    if (invalid.length > 0) {
      throw new Error(
        `Invalid events not found in contract ABI: ${invalid.join(", ")}`
      );
    }
  }

  const existingJob = await db
    .select()
    .from(jobs)
    .where(eq(jobs.id, jobId))
    .limit(1);

  if (existingJob.length > 0) {
    throw new Error(`Job with ID '${jobId}' already exists.`);
  }

  await db.insert(jobs).values({
    id: jobId,
    chainId,
    abi,
    contractAddress,
    events: eventsToListenFor,
  });

  const [existingListener] = await db
    .select({
      subscribedJobs: contractListeners.subscribedJobs,
    })
    .from(contractListeners)
    .where(
      and(
        eq(contractListeners.contractAddress, contractAddress),
        eq(contractListeners.chainId, chainId)
      )
    )
    .limit(1);

  if (!existingListener) {
    await db.insert(contractListeners).values({
      contractAddress,
      chainId,
      abi,
      subscribedJobs: [jobId],
      eventsBeingListened: eventsToListenFor.length ? eventsToListenFor : ["*"],
      isActive: true,
    });
  } else {
    await db
      .update(contractListeners)
      .set({
        subscribedJobs: [...existingListener.subscribedJobs, jobId],
        isActive: true,
      })
      .where(
        and(
          eq(contractListeners.contractAddress, contractAddress),
          eq(contractListeners.chainId, chainId)
        )
      );
  }

  let networkListener = networkListeners.get(chainId);
  if (!networkListener) {
    networkListener = await createNetworkListener(chainId);
    networkListeners.set(chainId, networkListener);
  }

  await addContractToNetworkListener(
    networkListener,
    contractAddress,
    abi,
    eventsToListenFor
  );

  return {
    jobId,
    contractAddress,
  };
}

async function createNetworkListener(
  chainId: number
): Promise<NetworkListener> {
  const { rpcUrl } = getEcosystemDetails(chainId);
  if (!rpcUrl) {
    throw new Error(`RPC URL not found for chain ID: ${chainId}`);
  }

  const httpProvider = createPublicClient({
    chain: getEcosystemDetails(chainId).chain,
    transport: http(rpcUrl, {
      batch: {
        batchSize: 50,
        wait: 100, // 100 ms
      },
      retryCount: 5,
      retryDelay: 1500, // 1.5 seconds
    }),
  });

  const activeJobs = await db
    .select({ id: jobs.id })
    .from(jobs)
    .where(and(eq(jobs.chainId, chainId), eq(jobs.isActive, true)))
    .limit(1);

  let lastBlockProcessed: number;

  if (activeJobs.length === 0) {
    const currentBlock = await httpProvider.getBlockNumber();
    lastBlockProcessed = Number(currentBlock);
    console.log(
      `[Chain ${chainId}] No active jobs, starting from current block: ${lastBlockProcessed}`
    );

    await db.delete(listenerState).where(eq(listenerState.chainId, chainId));
    console.log(
      `[Chain ${chainId}] Cleared saved listener state due to no active jobs`
    );
    await shutdownQueueForChain(chainId);
  } else {
    const savedBlock = await getLastProcessedBlock(chainId);
    const currentBlock = await httpProvider.getBlockNumber();
    const blockLag = Number(currentBlock) - (savedBlock ?? 0);

    if (savedBlock === null || blockLag > 50) {
      lastBlockProcessed = Number(currentBlock);
      console.log(
        `[Chain ${chainId}] No saved state, starting from current block: ${lastBlockProcessed}`
      );
      await saveLastProcessedBlock(chainId, lastBlockProcessed);
    } else {
      lastBlockProcessed = savedBlock;
      console.log(
        `[Chain ${chainId}] Resuming from saved block: ${lastBlockProcessed}`
      );
    }
  }

  if (lastBlockProcessed === null) {
    let blockNumber = await httpProvider.getBlockNumber();
    lastBlockProcessed = Number(blockNumber);
    await saveLastProcessedBlock(chainId, lastBlockProcessed);
  }

  const listener: NetworkListener = {
    chainId,
    client: httpProvider,
    contracts: new Map(),
    lastProcessedBlock: lastBlockProcessed,
    lastLoggedBlock: lastBlockProcessed,
    pollTimer: null,
    isActive: true,
    lastAlertSentAt: 0,
    async stop() {
      listener.isActive = false;

      if (listener.pollTimer) {
        clearInterval(listener.pollTimer);
        listener.pollTimer = null;
      }

      await saveLastProcessedBlock(chainId, listener.lastProcessedBlock);
      await shutdownQueueForChain(chainId);

      networkListeners.delete(chainId);
    },
  };

  getQueueForChain(chainId);
  getWorkerForChain(chainId);

  startNetworkPolling(listener);
  return listener;
}

async function addContractToNetworkListener(
  listener: NetworkListener,
  contractAddress: string,
  abi: any,
  eventsToListenFor: string[]
) {
  const normalizedAddress = contractAddress.toLowerCase();
  const iface = new ethers.Interface(abi);

  const existingContract = listener.contracts.get(normalizedAddress);
  if (existingContract) {
    const newEvents = new Set([
      ...existingContract.eventsBeingListened,
      ...(eventsToListenFor.length ? eventsToListenFor : ["*"]),
    ]);

    existingContract.eventsBeingListened = newEvents;
    existingContract.abi = abi;
    existingContract.iface = iface;
  } else {
    listener.contracts.set(normalizedAddress, {
      contractAddress: normalizedAddress,
      abi,
      iface,
      eventsBeingListened: new Set(
        eventsToListenFor.length ? eventsToListenFor : ["*"]
      ),
    });
  }
}

function startNetworkPolling(listener: NetworkListener) {
  const { chainId, client } = listener;
  const pollInterval =
    getEcosystemDetails(chainId).networkPollInterval || POLL_INTERVAL;
  const alertThreshold = getAlertThreshold(chainId);

  listener.pollTimer = setInterval(async () => {
    if (!listener.isActive || listener.contracts.size === 0) {
      return;
    }

    const publicClient: PublicClient = client;
    let currentBlock: number;

    try {
      const currentBlockBig = await publicClient.getBlockNumber();
      currentBlock = Number(currentBlockBig);
    } catch (err: any) {
      const msg = err.shortMessage || err.message || String(err);
      console.warn(`[${chainId}] Failed to get current block number: ${msg}`);

      if (msg.includes("Too Many Requests") || err.code === -32005) {
        console.warn(
          `[${chainId}] Rate limited on getBlockNumber → backoff 15s`
        );
        await new Promise((r) => setTimeout(r, 1000));
      }
      return;
    }

    let nextBlock = listener.lastProcessedBlock + 1;
    if (nextBlock > currentBlock) return;

    const queue = getQueueForChain(chainId);
    const blocksBehind = currentBlock - listener.lastProcessedBlock;
    const blocksToQueue = Math.min(MAX_BLOCKS_PER_QUERY, blocksBehind);

    if (blocksBehind > alertThreshold) {
      console.warn(
        `[${chainId}] Falling behind! ${blocksBehind} blocks behind current block ${currentBlock}`
      );
      if (shouldSendAlert(listener)) {
        await sendNetworkAlert(
          `${[chainId]}:` +
            `Listener falling behind!\n` +
            `Blocks behind: ${blocksBehind}\n` +
            `Current block: ${currentBlock}\n` +
            `Last processed: ${listener.lastProcessedBlock}\n` +
            `Threshold: ${alertThreshold}`
        );
        listener.lastAlertSentAt = Date.now();
      }
    }

    const queuePromises = [];
    for (let i = 0; i < blocksToQueue; i++) {
      const blockNumber = nextBlock + i;

      console.log(
        `[${chainId}] Queuing block ${blockNumber} for processing (current: ${currentBlock})`
      );

      queuePromises.push(
        queue.add(
          "processBlock",
          {
            chainId,
            currentBlock,
            blockNumber,
          },
          {
            jobId: `${chainId}-${blockNumber}`,
          }
        )
      );
    }

    await Promise.all(queuePromises);

    listener.lastProcessedBlock = nextBlock + blocksToQueue - 1;
    await saveLastProcessedBlock(chainId, listener.lastProcessedBlock);

    if (
      listener.lastProcessedBlock - listener.lastLoggedBlock >=
      LOG_EVERY_N_BLOCKS
    ) {
      console.log(
        `[Chain ${chainId}] Processed up to block ${listener.lastProcessedBlock}`
      );
      listener.lastLoggedBlock = listener.lastProcessedBlock;
    }
  }, pollInterval);
}

export async function processBlock(
  chainId: number,
  currentBlock: number,
  blockNumber: number
) {
  const listener = networkListeners.get(chainId);
  if (!listener) {
    console.warn(
      `[${chainId}] No active listener found for processing block ${blockNumber}`
    );
    return;
  }

  const ecosystem = getEcosystemDetails(chainId);
  if (ecosystem?.chainId === 295 || ecosystem?.chainId === 296) {
    await processHederaBlock(chainId, currentBlock, blockNumber);
  } else {
    await processEVMBlock(chainId, currentBlock, blockNumber);
  }
}

export async function processEVMBlock(
  chainId: number,
  currentBlock: number,
  blockNumber: number
) {
  let listener = networkListeners.get(chainId);
  if (!listener || !listener.isActive) {
    console.warn(
      `[${chainId}] No listener found for processing block ${blockNumber}`
    );
    return;
  }
  const contractAddresses = Array.from(listener.contracts.keys());
  const filter: any = {
    address: contractAddresses,
    fromBlock: numberToHex(blockNumber),
    toBlock: numberToHex(blockNumber),
  };
  console.log(
    `[${listener.chainId}] Processing block ${blockNumber} with current ${currentBlock}`
  );
  const publicClient: PublicClient = listener.client;
  const block = await publicClient.getBlock({
    blockNumber: BigInt(blockNumber),
    includeTransactions: true,
  });

  if (!block) {
    console.warn(`[${listener.chainId}] Block ${blockNumber} returned null`);
    return;
  }

  let blockLogs: any[] = [];
  try {
    blockLogs = await publicClient.getLogs(filter);

    if (blockLogs == null || blockLogs === undefined) {
      blockLogs = [];
    }
  } catch (logsErr: any) {
    const msg = logsErr.message || logsErr.shortMessage || String(logsErr);
    console.warn(
      `[${listener.chainId}] getLogs failed for block ${blockNumber}: ${msg}`
    );

    if (msg.includes("Too Many Requests") || logsErr.code === -32005) {
      console.warn(
        `[${listener.chainId}] Rate limit on logs for ${blockNumber}`
      );
    }

    blockLogs = [];
  }

  if (!Array.isArray(blockLogs)) {
    console.warn(
      `[${
        listener.chainId
      }] getLogs returned non-array for ${blockNumber}: ${typeof blockLogs}`
    );
    blockLogs = [];
  }

  if (blockLogs.length === 0) {
    return;
  }

  for (const log of blockLogs) {
    const normalizedAddress = log.address.toLowerCase();
    const contractSub = listener.contracts.get(normalizedAddress);

    if (!contractSub) {
      console.warn(
        `[${listener.chainId}] Log for untracked contract ${normalizedAddress} at block ${log.blockNumber}`
      );
      continue;
    }

    let parsedLog: any;
    try {
      parsedLog = contractSub.iface.parseLog({
        topics: log.topics,
        data: log.data,
      });
    } catch (err) {
      console.warn(
        `[${listener.chainId}] Unable to parse log for contract ${normalizedAddress} at block ${log.blockNumber}`
      );
      continue;
    }

    const eventName = parsedLog.fragment?.name || parsedLog.name;
    if (
      !contractSub.eventsBeingListened.has("*") &&
      !contractSub.eventsBeingListened.has(eventName)
    ) {
      continue;
    }

    const txIndex = Number(log.transactionIndex);
    const tx = block.transactions[txIndex] as Transaction;

    if (!tx) {
      console.warn(
        `[${listener.chainId}] Tx index ${txIndex} missing in block ${blockNumber}`
      );
      continue;
    }

    const normalizedEvent = await normalizeEvent(parsedLog, log, tx);
    logEvent(normalizedEvent);
    await routeEventToJobs(normalizedEvent, listener.chainId);
  }
}

export async function processHederaBlock(
  chainId: number,
  currentBlock: number,
  blockNumber: number
) {
  let listener = networkListeners.get(chainId);
  if (!listener || !listener.isActive) {
    console.warn(
      `[${chainId}] No listener found for processing block ${blockNumber}`
    );
    return;
  }

  const contractAddresses = Array.from(listener.contracts.keys());
  const publicClient: PublicClient = listener.client;
  const filter: any = {
    address: contractAddresses,
    fromBlock: numberToHex(blockNumber),
    toBlock: numberToHex(blockNumber),
  };
  console.log(
    `[${listener.chainId}] Processing block ${blockNumber} with current ${currentBlock}`
  );

  let blockLogs: any[] = [];
  try {
    blockLogs = (await publicClient.getLogs(filter)) ?? [];
  } catch (err: any) {
    console.warn(`[${chainId}] getLogs failed:`, err.message);
    return;
  }

  if (!Array.isArray(blockLogs)) {
    console.warn(
      `[${chainId}] getLogs returned non-array for ${blockNumber}: ${typeof blockLogs}`
    );
    return;
  }

  if (blockLogs.length === 0) return;

  if (!Array.isArray(blockLogs)) {
    console.warn(
      `[${
        listener.chainId
      }] getLogs returned non-array for ${blockNumber}: ${typeof blockLogs}`
    );
    blockLogs = [];
  }

  const txCache = new Map<string, Transaction>();

  for (const log of blockLogs) {
    const normalizedAddress = log.address.toLowerCase();
    const contractSub = listener.contracts.get(normalizedAddress);

    if (!contractSub) {
      console.warn(
        `[${listener.chainId}] Log for untracked contract ${normalizedAddress} at block ${log.blockNumber}`
      );
      continue;
    }

    let parsedLog: any;
    try {
      parsedLog = contractSub.iface.parseLog({
        topics: log.topics,
        data: log.data,
      });

      if (!parsedLog) continue;
    } catch (err) {
      console.warn(
        `[${listener.chainId}] Unable to parse log for contract ${normalizedAddress} at block ${log.blockNumber}`
      );
      continue;
    }

    const eventName = parsedLog.fragment?.name || parsedLog.name;
    if (
      !contractSub.eventsBeingListened.has("*") &&
      !contractSub.eventsBeingListened.has(eventName)
    ) {
      continue;
    }

    const txHash = log.transactionHash?.toLowerCase();
    if (!txHash) continue;

    let tx = txCache.get(txHash);

    if (!tx) {
      try {
        tx = await publicClient.getTransaction({
          hash: log.transactionHash as `0x${string}`,
        });

        if (tx) txCache.set(txHash, tx);
      } catch (err) {
        console.warn(
          `[${listener.chainId}] Failed to fetch tx ${log.transactionHash} for log in block ${blockNumber}`
        );
        continue;
      }
    }

    if (!tx) {
      console.warn(
        `[${listener.chainId}] Tx ${log.transactionHash} not found for log in block ${blockNumber}`
      );
      continue;
    }

    const normalizedEvent = await normalizeEvent(parsedLog, log, tx);
    logEvent(normalizedEvent);
    await routeEventToJobs(normalizedEvent, listener.chainId);
  }
}

async function routeEventToJobs(event: NormalizedEvent, chainId: number) {
  const eventName = event.name;

  const jobRows = await db
    .select({
      id: jobs.id,
      events: jobs.events,
    })
    .from(jobs)
    .where(
      and(
        eq(sql`LOWER(${jobs.contractAddress})`, event.address.toLowerCase()),
        eq(jobs.chainId, chainId),
        eq(jobs.isActive, true)
      )
    );

  if (!jobRows || jobRows.length === 0) {
    console.log(`No jobs found for contract: ${event.address}`);
    return;
  }

  const interestedJobs = jobRows
    .filter((job) => job.events.length === 0 || job.events.includes(eventName))
    .map((j) => j.id);

  if (interestedJobs.length > 0) {
    await storeEventForJobs(event, interestedJobs, chainId);
  }
}

async function storeEventForJobs(
  event: NormalizedEvent,
  jobIds: string[],
  chainId: number
) {
  try {
    const rows = jobIds.map((jobId) => ({
      jobId,
      chainId: chainId,
      contractAddress: event.address,
      eventName: event.name,
      sender: event.sender,
      receiver: event.receiver,
      value: event.value!,
      blockNumber: BigInt(event.blockNumber),
      transactionHash: event.transactionHash,
    }));

    await db.transaction(async (tx) => {
      await tx.insert(contractEvents).values(rows);
    });
  } catch (error) {
    console.error("Error storing event for jobs:", error);
  }
}

export async function unsubscribeJobFromContractListener(jobId: string) {
  const updatedJobs = await db
    .update(jobs)
    .set({
      isActive: false,
    })
    .where(eq(jobs.id, jobId))
    .returning({
      contractAddress: jobs.contractAddress,
      chainId: jobs.chainId,
    });

  if (updatedJobs.length === 0) {
    return false;
  }

  const { contractAddress, chainId } = updatedJobs[0]!;

  const remainingJobRows = await db
    .select({
      id: jobs.id,
      events: jobs.events,
    })
    .from(jobs)
    .where(
      and(
        eq(jobs.contractAddress, contractAddress),
        eq(jobs.chainId, chainId),
        eq(jobs.isActive, true)
      )
    );

  if (remainingJobRows.length === 0) {
    await db
      .delete(contractListeners)
      .where(
        and(
          eq(contractListeners.contractAddress, contractAddress),
          eq(contractListeners.chainId, chainId)
        )
      );

    const networkListener = networkListeners.get(chainId);
    if (networkListener) {
      const normalizedAddress = contractAddress.toLowerCase();
      networkListener.contracts.delete(normalizedAddress);

      await networkListener.stop();
    }

    await db.delete(listenerState).where(eq(listenerState.chainId, chainId));
    console.log(
      `[Chain ${chainId}] Deleted listener state, stopped chain listener due to no active contracts`
    );
  } else {
    await db
      .update(contractListeners)
      .set({ subscribedJobs: remainingJobRows.map((j) => j.id) })
      .where(
        and(
          eq(contractListeners.contractAddress, contractAddress),
          eq(contractListeners.chainId, chainId)
        )
      );

    const networkListener = networkListeners.get(chainId);
    if (networkListener) {
      const normalizedAddress = contractAddress.toLowerCase();
      const contractSub = networkListener.contracts.get(normalizedAddress);

      if (contractSub) {
        const allEvents = remainingJobRows.flatMap((j) => j.events);
        contractSub.eventsBeingListened = new Set(
          allEvents.length ? allEvents : ["*"]
        );
      }
    }
  }

  const addresses = await db
    .select({
      sender: contractEvents.sender,
    })
    .from(contractEvents)
    .where(eq(contractEvents.jobId, jobId))
    .orderBy(desc(contractEvents.detectedAt));

  const uniqueAddresses = Array.from(
    new Set(addresses.flatMap((addr) => [addr.sender]))
  );

  const filteredAddresses = uniqueAddresses.filter(
    (addr): addr is string =>
      !!addr &&
      addr !== contractAddress &&
      addr !== NULL_ADDRESS &&
      addr.startsWith("0x")
  );

  await db
    .update(jobs)
    .set({ eventAddresses: filteredAddresses })
    .where(eq(jobs.id, jobId));

  return true;
}

export function validateEvents(
  abi: any,
  eventsToListenFor: string[]
): { valid: string[]; invalid: string[] } {
  if (eventsToListenFor.length === 0) {
    return { valid: [], invalid: [] };
  }

  const contractInterface = new ethers.Interface(abi);
  const valid: string[] = [];
  const invalid: string[] = [];

  eventsToListenFor.forEach((eventName) => {
    try {
      contractInterface.getEvent(eventName);
      valid.push(eventName);
    } catch {
      invalid.push(eventName);
    }
  });

  return { valid, invalid };
}

async function normalizeEvent(
  parsed: any,
  log: any,
  tx: Transaction
): Promise<NormalizedEvent> {
  const contractAddress = log.address;

  const sender: string = tx?.from || "";
  let receiver: string | undefined;
  let value: bigint | undefined;

  if (parsed?.args) {
    if (parsed.args.from && parsed.args.to) {
      receiver =
        parsed.args.to !== contractAddress ? parsed.args.to : undefined;
    }

    if (parsed.args.value !== undefined) {
      value = BigInt(parsed.args.value.toString());
    }
  }

  if ((value === undefined || value === 0n) && tx?.value && tx.value > 0n) {
    value = tx.value;
    receiver = tx.to ?? receiver;
  }

  return {
    name: parsed.fragment?.name || parsed.name,
    address: contractAddress,
    sender,
    receiver,
    value,
    blockNumber: log.blockNumber,
    transactionHash: log.transactionHash,
    rawArgs: parsed?.args,
  };
}

function logEvent(event: NormalizedEvent) {
  console.log("  Event Name:", event.name);
  console.log("  Contract Address:", event.address);
  console.log("Transaction Hash:", event.transactionHash);
  if (event.sender) console.log("  Sender:", event.sender);
  if (event.receiver) console.log("  Receiver:", event.receiver);
  if (event.value) console.log("  Value:", event.value);
  console.log("---");
}

async function getLastProcessedBlock(chainId: number): Promise<number | null> {
  try {
    const [result] = await db
      .select({ lastBlock: listenerState.lastProcessedBlock })
      .from(listenerState)
      .where(eq(listenerState.chainId, chainId))
      .limit(1);

    if (result) {
      return Number(result.lastBlock);
    }

    return null;
  } catch (error) {
    console.error(
      `Error getting last processed block for chain ${chainId}:`,
      error
    );
    return null;
  }
}

async function saveLastProcessedBlock(
  chainId: number,
  blockNumber: number
): Promise<void> {
  try {
    await db
      .insert(listenerState)
      .values({
        chainId,
        lastProcessedBlock: BigInt(blockNumber),
      })
      .onConflictDoUpdate({
        target: listenerState.chainId,
        set: {
          lastProcessedBlock: BigInt(blockNumber),
          updatedAt: new Date(),
        },
      });
  } catch (error) {
    console.error(
      `Error saving last processed block for chain ${chainId}:`,
      error
    );
  }
}

export async function initializeListenersFromDatabase() {
  try {
    await initializeAllChainQueues();

    const activeListeners = await db
      .select()
      .from(contractListeners)
      .where(eq(contractListeners.isActive, true));

    const listenersByChain = activeListeners.reduce((acc, listener) => {
      (acc[listener.chainId] ??= []).push(listener);
      return acc;
    }, {} as Record<number, typeof activeListeners>);

    for (const [chainIdStr, listeners] of Object.entries(listenersByChain)) {
      const chainId = parseInt(chainIdStr);

      try {
        const jobRows = await db
          .select({
            id: jobs.id,
            events: jobs.events,
          })
          .from(jobs)
          .where(and(eq(jobs.chainId, chainId), eq(jobs.isActive, true)));

        if (!jobRows || jobRows.length === 0) {
          console.log(
            `No jobs found for network: ${chainId}. Skipping listener initialization.`
          );

          await db
            .update(contractListeners)
            .set({ isActive: false })
            .where(eq(contractListeners.chainId, chainId));

          return;
        }
        const networkListener = await createNetworkListener(chainId);
        networkListeners.set(chainId, networkListener);

        for (const listener of listeners) {
          await addContractToNetworkListener(
            networkListener,
            listener.contractAddress,
            listener.abi,
            listener.eventsBeingListened
          );
        }

        console.log(
          `Initialized listener for chain ${chainId} with ${listeners.length} contracts.`
        );
      } catch (error) {
        await sendNetworkAlert(
          `${[chainId]}:` +
            `Failed to initialize listener\n` +
            `Error: ${error instanceof Error ? error.message : String(error)}`
        );
        console.error(`Error initializing chain ${chainId}:`, error);
      }
    }
  } catch (error) {
    console.error("Error initializing listeners from database:", error);
  }
}

export async function stopAllListeners() {
  for (const [chainId, listener] of networkListeners.entries()) {
    try {
      await listener.stop();
    } catch (error) {
      console.error(`Error stopping listener for chain ${chainId}:`, error);
    }
  }

  console.log("All network listeners stopped");
}
