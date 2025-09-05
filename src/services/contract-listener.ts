import { ethers } from "ethers";
import { db } from "@/db";
import { contractEvents, contractListeners, jobs } from "@/db/schema/event";
import { getEcosystemDetails } from "@/utils/ecosystem";
import { and, eq } from "drizzle-orm";

export interface JobEventSubscription {
  jobId: string;
  eventsToListenFor: string[];
  contractAddress: string;
  createdAt: Date;
}

export interface ContractListener {
  contract: ethers.Contract;
  abi: any;
  provider: ethers.WebSocketProvider;
  eventsBeingListened: Set<string>;
  chainId: number;
  startTime: Date;
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

const runtimeListeners: Record<string, ContractListener> = {};

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

  await db.insert(jobs).values({
    id: jobId,
    chainId,
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

  let listener = runtimeListeners[contractAddress];
  if (!listener) {
    listener = await createContractListener(
      contractAddress,
      abi,
      chainId,
      eventsToListenFor
    );
    runtimeListeners[contractAddress] = listener;
  } else {
    await updateListenerEvents(listener, eventsToListenFor);
  }

  console.log(`Job '${jobId}' subscribed to contract ${contractAddress}`);
  console.log(
    `Listening for: ${
      eventsToListenFor.length === 0
        ? "ALL events"
        : eventsToListenFor.join(", ")
    }`
  );

  return {
    jobId,
    contractAddress,
  };
}

async function createContractListener(
  contractAddress: string,
  abi: any,
  chainId: number,
  eventsToListenFor: string[]
): Promise<ContractListener> {
  const { wsUrl } = getEcosystemDetails(chainId);
  if (!wsUrl) {
    throw new Error(`WebSocket URL not found for chain ID: ${chainId}`);
  }
  const wsProvider = new ethers.WebSocketProvider(wsUrl);
  const contract = new ethers.Contract(contractAddress, abi, wsProvider);

  const listener: ContractListener = {
    contract,
    abi,
    provider: wsProvider,
    chainId,
    eventsBeingListened: new Set(
      eventsToListenFor.length ? eventsToListenFor : ["*"]
    ),
    startTime: new Date(),
    stop: async () => {
      await contract.removeAllListeners();
      await wsProvider.destroy();
      delete runtimeListeners[contractAddress];
      console.log(`Stopped listener for contract: ${contractAddress}`);
    },
  };

  await updateListenerEvents(listener, eventsToListenFor);

  wsProvider.on("error", (error) => {
    console.error(
      `WebSocket Provider error for contract ${contractAddress}:`,
      error
    );
  });

  return listener;
}

async function updateListenerEvents(
  listener: ContractListener,
  eventsToListenFor: string[]
) {
  const { contract, provider, abi } = listener;

  await contract.removeAllListeners();

  const iface = new ethers.Interface(abi);

  const requiredEvents = eventsToListenFor.length
    ? new Set(eventsToListenFor)
    : new Set(["*"]);

  if (requiredEvents.has("*")) {
    const filter = { address: contract.target };
    provider.on(filter, async (log) => {
      try {
        const parsed = iface.parseLog({
          topics: log.topics,
          data: log.data,
        });
        if (!parsed) {
          console.log("⚠️ Unrecognized event log:", log);
          return;
        }
        const normalizedEvent = normalizeEvent(parsed, log);
        logEvent(normalizedEvent);
        await routeEventToJobs(normalizedEvent, listener);
      } catch (err) {
        console.log("⚠️ Could not parse log:", err);
      }
    });
    listener.eventsBeingListened = new Set(["*"]);
  } else {
    requiredEvents.forEach((eventName) => {
      contract.on(eventName, async (...args) => {
        const event = args[args.length - 1];
        const parsed = iface.parseLog(event);
        if (!parsed) {
          console.log("⚠️ Unrecognized event log:", event);
          return;
        }
        const normalizedEvent = normalizeEvent(parsed, event);
        logEvent(normalizedEvent);
        await routeEventToJobs(normalizedEvent, listener);
      });
    });
    listener.eventsBeingListened = new Set(requiredEvents);
  }
}

function calculateRequiredEvents(
  jobSubscriptions: Map<string, JobEventSubscription>
): Set<string> {
  const requiredEvents = new Set<string>();

  for (const subscription of jobSubscriptions.values()) {
    if (subscription.eventsToListenFor.length === 0) {
      requiredEvents.add("*");
      break;
    } else {
      subscription.eventsToListenFor.forEach((event) =>
        requiredEvents.add(event)
      );
    }
  }

  return requiredEvents;
}

async function routeEventToJobs(
  event: NormalizedEvent,
  listener: ContractListener
) {
  const eventName = event.name;

  const jobRows = await db
    .select({
      id: jobs.id,
      events: jobs.events,
    })
    .from(jobs)
    .where(
      and(
        eq(jobs.contractAddress, event.address),
        eq(jobs.chainId, listener.chainId)
      )
    );

  if (!jobRows) {
    return;
  }

  const interestedJobs = jobRows
    .filter((job) => job.events.length === 0 || job.events.includes(eventName))
    .map((j) => j.id);

  if (interestedJobs.length > 0) {
    console.log(
      `Event '${eventName}' routing to jobs: ${interestedJobs.join(", ")}`
    );
    await storeEventForJobs(event, interestedJobs, listener.chainId);
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

  const jobRows = await db
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

  if (jobRows.length === 0) {
    await db
      .delete(contractListeners)
      .where(eq(contractListeners.contractAddress, contractAddress));

    const runtime = runtimeListeners[contractAddress];
    if (runtime) {
      await runtime.stop();
    }
    console.log(
      `No more subscriptions, stopped listener for contract: ${contractAddress}`
    );
  } else {
    await db
      .update(contractListeners)
      .set({ subscribedJobs: jobRows.map((j) => j.id) })
      .where(eq(contractListeners.contractAddress, contractAddress));
  }

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

function normalizeEvent(parsed: any, log: any): NormalizedEvent {
  const isAddress = (value: any): boolean => {
    try {
      return ethers.isAddress(value);
    } catch {
      return false;
    }
  };

  const contractAddress = log.address.toLowerCase();
  let sender: string | undefined;
  let receiver: string | undefined;

  if (parsed.args?.from && isAddress(parsed.args.from)) {
    const fromAddress = parsed.args.from.toLowerCase();
    if (fromAddress !== contractAddress) {
      sender = parsed.args.from;
    }
  }
  if (parsed.args?.to && isAddress(parsed.args.to)) {
    const toAddress = parsed.args.to.toLowerCase();
    if (toAddress !== contractAddress) {
      receiver = parsed.args.to;
    }
  }

  if ((!sender || !receiver) && parsed.args) {
    const addresses = Object.values(parsed.args).filter(
      (v: any): v is string => {
        if (!isAddress(v)) return false;
        return (v as string).toLowerCase() !== contractAddress;
      }
    );

    if (!sender && addresses.length > 0) sender = addresses[0];
    if (!receiver && addresses.length > 1) receiver = addresses[1];
  }

  return {
    name: parsed.fragment?.name || parsed.name,
    address: log.address,
    value: parsed?.args?.value
      ? BigInt(parsed.args.value.toString())
      : undefined,
    sender,
    receiver,
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
