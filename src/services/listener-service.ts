import { ethers } from "ethers";
import { db } from "@/db";
import {
  contractEvents,
  contractListeners,
  jobs,
  listenerState,
} from "@/db/schema/event";
import { getEcosystemDetails } from "@/utils/ecosystem";
import { and, desc, eq, sql } from "drizzle-orm";
import { NULL_ADDRESS } from "@/utils/constants";
import WebSocket from "ws";

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
  httpProvider: ethers.JsonRpcProvider;
  contracts: Map<string, ContractSubscription>;
  lastProcessedBlock: number;
  pollTimer: Timer | null;
  isActive: boolean;
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
const BLOCKS_PER_POLL = 100;

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

  const httpProvider = new ethers.JsonRpcProvider(rpcUrl);
  let lastBlockProcessed = await getLastProcessedBlock(chainId);

  if (lastBlockProcessed === null) {
    lastBlockProcessed = await httpProvider.getBlockNumber();
    await saveLastProcessedBlock(chainId, lastBlockProcessed);
  }

  const listener: NetworkListener = {
    chainId,
    httpProvider,
    contracts: new Map(),
    lastProcessedBlock: lastBlockProcessed,
    pollTimer: null,
    isActive: true,
    async stop() {
      listener.isActive = false;

      if (listener.pollTimer) {
        clearInterval(listener.pollTimer);
        listener.pollTimer = null;
      }

      await saveLastProcessedBlock(chainId, listener.lastProcessedBlock);

      networkListeners.delete(chainId);
    },
  };

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
  const { chainId, httpProvider } = listener;
  const pollInterval =
    getEcosystemDetails(chainId).networkPollInterval || POLL_INTERVAL;

  listener.pollTimer = setInterval(async () => {
    if (!listener.isActive || listener.contracts.size === 0) {
      return;
    }

    try {
      const currentBlock = await httpProvider.getBlockNumber();
      const fromBlock = listener.lastProcessedBlock + 1;
      const toBlock = Math.min(currentBlock, fromBlock + BLOCKS_PER_POLL - 1);

      if (fromBlock > currentBlock) {
        return;
      }

      const contractAddresses = Array.from(listener.contracts.keys());

      const filter: any = {
        address: contractAddresses,
        fromBlock,
        toBlock,
      };

      const logs = await httpProvider.getLogs(filter);

      for (const log of logs) {
        const normalizedAddress = log.address.toLowerCase();
        const contractSub = listener.contracts.get(normalizedAddress);

        if (!contractSub) {
          continue;
        }

        try {
          const parsed = contractSub.iface.parseLog({
            topics: log.topics as string[],
            data: log.data,
          });

          if (!parsed) {
            continue;
          }

          const eventName = parsed.fragment?.name || parsed.name;
          const eventsBeingListened = contractSub.eventsBeingListened;

          if (
            !eventsBeingListened.has("*") &&
            !eventsBeingListened.has(eventName)
          ) {
            continue;
          }

          const normalizedEvent = await normalizeEvent(
            parsed,
            log,
            httpProvider
          );
          await routeEventToJobs(normalizedEvent, chainId);
        } catch (err) {
          console.warn("Could not parse log:", err);
        }
      }

      listener.lastProcessedBlock = toBlock;
      await saveLastProcessedBlock(chainId, toBlock);
    } catch (error) {
      console.error(`[Chain ${chainId}] Polling error:`, error);
    }
  }, pollInterval);
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

      if (networkListener.contracts.size === 0) {
        await networkListener.stop();
      }
    }
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
  provider: ethers.Provider
): Promise<NormalizedEvent> {
  const contractAddress = log.address;
  const tx = await provider.getTransaction(log.transactionHash);

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
  console.log("Initializing contract listeners from database...");

  try {
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
      } catch (error) {
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
