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
  const { contract } = listener;

  await contract.removeAllListeners();

  const requiredEvents = eventsToListenFor.length
    ? new Set(eventsToListenFor)
    : new Set(["*"]);

  if (requiredEvents.has("*")) {
    contract.on("*", async (event) => {
      console.log("  Event Detected:");
      console.log("  Event Name:", event.fragment.name);
      console.log("  Args:", event.args);
      console.log("  Block Number:", event.log.blockNumber);
      console.log("  Transaction Hash:", event.log.transactionHash);
      console.log("  Contract Address:", event.log.address);
      console.log("sender:", event.args.from);
      console.log("receiver:", event.args.to);
      console.log("value:", BigInt(event.args.value.toString()));
      console.log("  Chain ID:", listener.chainId);
      console.log("---");
      await routeEventToJobs(event, listener);
    });
    listener.eventsBeingListened = new Set(["*"]);
  } else {
    requiredEvents.forEach((eventName) => {
      contract.on(eventName, async (...args) => {
        const event = args[args.length - 1];
        console.log("  Event Detected:");
        console.log("  Event Name:", event.fragment.name);
        console.log("  Args:", event.args);
        console.log("  Block Number:", event.log.blockNumber);
        console.log("  Transaction Hash:", event.log.transactionHash);
        console.log("sender:", event.args.from);
        console.log("receiver:", event.args.to);
        console.log("value:", BigInt(event.args.value.toString()));
        console.log("  Chain ID:", listener.chainId);
        console.log("---");
        await routeEventToJobs(event, listener);
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

async function routeEventToJobs(event: any, listener: ContractListener) {
  const eventName = event.fragment.name;

  const jobRows = await db
    .select({
      id: jobs.id,
      events: jobs.events,
    })
    .from(jobs)
    .where(
      and(
        eq(jobs.contractAddress, event.log.address),
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
  event: any,
  jobIds: string[],
  chainId: number
) {
  try {
    const rows = jobIds.map((jobId) => ({
      jobId,
      chainId: chainId,
      contractAddress: event.log.address,
      eventName: event.fragment.name,
      sender: event.args.from,
      receiver: event.args.to,
      value: BigInt(event.args.value.toString()),
      blockNumber: BigInt(event.log.blockNumber),
      transactionHash: event.log.transactionHash,
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
