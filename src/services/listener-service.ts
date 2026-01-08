import { ethers } from "ethers";
import { db } from "@/db";
import { contractEvents, contractListeners, jobs } from "@/db/schema/event";
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

export interface ContractListener {
  ws: WebSocket;
  abi: any;
  iface: ethers.Interface;
  httpProvider: ethers.JsonRpcProvider;
  contractAddress: string;
  eventsBeingListened: Set<string>;
  chainId: number;
  startTime: Date;
  subscriptionId: string | null;
  pingTimer: Timer | null;
  pongTimeout: Timer | null;
  isActive: boolean;
  reconnectAttempts: number;
  stop: () => Promise<void>;
  reconnect: () => Promise<void>;
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

const MAX_RECONNECT_ATTEMPTS = 10;
const RECONNECT_DELAY = 5000;
const PING_INTERVAL = 30000;
const PONG_TIMEOUT = 15000;

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
  const { wsUrl, rpcUrl } = getEcosystemDetails(chainId);
  if (!wsUrl) {
    throw new Error(`WebSocket URL not found for chain ID: ${chainId}`);
  }

  const iface = new ethers.Interface(abi);
  const httpProvider = new ethers.JsonRpcProvider(rpcUrl);

  const listener: ContractListener = {
    ws: null as any,
    abi,
    iface,
    httpProvider,
    chainId,
    contractAddress,
    eventsBeingListened: new Set(
      eventsToListenFor.length ? eventsToListenFor : ["*"]
    ),
    startTime: new Date(),
    subscriptionId: null,
    pingTimer: null,
    pongTimeout: null,
    isActive: true,
    reconnectAttempts: 0,
    async stop() {
      console.log(
        `[${chainId}] Stopping listener for contract: ${contractAddress}`
      );
      listener.isActive = false;

      if (listener.pingTimer) clearInterval(listener.pingTimer);
      if (listener.pongTimeout) clearTimeout(listener.pongTimeout);

      if (listener.ws && listener.subscriptionId) {
        try {
          await sendRpc(listener.ws, {
            method: "eth_unsubscribe",
            params: [listener.subscriptionId],
          });
        } catch (err) {
          console.error(`[${chainId}] Unsubscribe error:`, err);
        }
      }

      if (listener.ws) {
        listener.ws.close(1000, "Stopping listener");
      }

      delete runtimeListeners[contractAddress];
      console.log(
        `[${chainId}] Stopped listener for contract: ${contractAddress}`
      );
    },
    async reconnect() {
      if (!listener.isActive) return;

      if (listener.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
        console.error(
          `[${chainId}] Max reconnects reached. Manual intervention required.`
        );
        return;
      }

      listener.reconnectAttempts++;
      console.log(
        `[${chainId}] Reconnecting (attempt ${listener.reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})`
      );

      if (listener.pingTimer) clearInterval(listener.pingTimer);
      if (listener.pongTimeout) clearTimeout(listener.pongTimeout);

      if (listener.ws) {
        listener.ws.removeAllListeners();
        listener.ws.close();
      }

      const delay =
        RECONNECT_DELAY * Math.pow(1.5, listener.reconnectAttempts - 1);
      await new Promise((r) => setTimeout(r, delay));

      setupWebSocket(listener, contractAddress, wsUrl, eventsToListenFor);
    },
  };

  setupWebSocket(listener, contractAddress, wsUrl, eventsToListenFor);
  return listener;
}

function sendRpc(ws: WebSocket, payload: any): Promise<any> {
  return new Promise((resolve, reject) => {
    const id = Date.now();
    const timeoutId = setTimeout(() => {
      reject(new Error("RPC request timeout"));
    }, 10000);

    ws.send(JSON.stringify({ jsonrpc: "2.0", id, ...payload }));

    const handler = (data: Buffer) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.id === id) {
          clearTimeout(timeoutId);
          ws.off("message", handler);
          if (msg.error) reject(msg.error);
          else resolve(msg.result);
        }
      } catch (err) {}
    };

    ws.on("message", handler);
  });
}

function setupWebSocket(
  listener: ContractListener,
  contractAddress: string,
  wsUrl: string,
  eventsToListenFor: string[]
) {
  const ws = new WebSocket(wsUrl);
  listener.ws = ws;
  const { chainId, iface, httpProvider } = listener;

  ws.on("open", async () => {
    console.log(
      `[${chainId}] WebSocket opened for contract: ${contractAddress}`
    );
    listener.reconnectAttempts = 0;

    try {
      const filter: any = { address: contractAddress };

      if (eventsToListenFor.length > 0 && !eventsToListenFor.includes("*")) {
        const topics = eventsToListenFor.map((eventName) => {
          const fragment = iface.getEvent(eventName);
          return ethers.id(fragment!.format("sighash"));
        });
        filter.topics = [topics];
      }

      const subId = await sendRpc(ws, {
        method: "eth_subscribe",
        params: ["logs", filter],
      });

      listener.subscriptionId = subId;
      console.log(
        `[${chainId}] eth_subscribe active (id: ${subId}) for events: ${
          eventsToListenFor.length ? eventsToListenFor.join(", ") : "ALL"
        }`
      );

      listener.pingTimer = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.ping();
          listener.pongTimeout = setTimeout(() => {
            console.warn(`[${chainId}] Pong timeout → forcing reconnect`);
            ws.close(1006, "Pong timeout");
          }, PONG_TIMEOUT);
        }
      }, PING_INTERVAL);
    } catch (err) {
      console.error(`[${chainId}] Subscription failed:`, err);
      listener.reconnect();
    }
  });

  ws.on("message", async (data: Buffer) => {
    if (!listener.isActive) return;

    try {
      const msg = JSON.parse(data.toString());

      if (msg.method === "eth_subscription") {
        const { subscription, result } = msg.params;

        if (subscription === listener.subscriptionId) {
          const log = result;

          try {
            const parsed = iface.parseLog({
              topics: log.topics,
              data: log.data,
            });

            if (!parsed) {
              console.log("⚠️ Unrecognized event log:", log);
              return;
            }

            const normalizedEvent = await normalizeEvent(
              parsed,
              log,
              httpProvider
            );
            logEvent(normalizedEvent);
            await routeEventToJobs(normalizedEvent, listener);
          } catch (err) {
            console.log("⚠️ Could not parse log:", err);
          }
        }
      }
    } catch (err) {
      console.error(`[${chainId}] Message processing error:`, err);
    }
  });

  ws.on("pong", () => {
    if (listener.pongTimeout) {
      clearTimeout(listener.pongTimeout);
      listener.pongTimeout = null;
    }
  });

  ws.on("close", (code, reason) => {
    console.warn(
      `[${chainId}] WebSocket closed: ${code} - ${reason.toString()}`
    );

    if (listener.pingTimer) clearInterval(listener.pingTimer);
    if (listener.pongTimeout) clearTimeout(listener.pongTimeout);

    if (listener.isActive) {
      listener.reconnect();
    }
  });

  ws.on("error", (err) => {
    console.error(`[${chainId}] WebSocket error:`, err);
    if (listener.isActive) {
      listener.reconnect();
    }
  });
}

async function updateListenerEvents(
  listener: ContractListener,
  eventsToListenFor: string[]
) {
  const requiredEvents = new Set(
    eventsToListenFor.length ? eventsToListenFor : ["*"]
  );

  const currentEvents = listener.eventsBeingListened;
  const needsUpdate =
    currentEvents.size !== requiredEvents.size ||
    ![...currentEvents].every((e) => requiredEvents.has(e));

  if (needsUpdate) {
    console.log(
      `[${listener.chainId}] Updating listener events from [${[
        ...currentEvents,
      ].join(", ")}] to [${[...requiredEvents].join(", ")}]`
    );

    if (listener.ws && listener.subscriptionId) {
      try {
        await sendRpc(listener.ws, {
          method: "eth_unsubscribe",
          params: [listener.subscriptionId],
        });
        listener.subscriptionId = null;
      } catch (err) {
        console.error("Error unsubscribing:", err);
      }
    }

    const { wsUrl } = getEcosystemDetails(listener.chainId);
    const eventsArray = [...requiredEvents].filter((e) => e !== "*");
    setupWebSocket(listener, listener.contractAddress, wsUrl!, eventsArray);

    listener.eventsBeingListened = requiredEvents;
  }
}

async function routeEventToJobs(
  event: NormalizedEvent,
  listener: ContractListener
) {
  const eventName = event.name;
  console.log(
    `Routing event '${eventName}' from contract ${event.address} on chain ${listener.chainId}`
  );

  const jobRows = await db
    .select({
      id: jobs.id,
      events: jobs.events,
    })
    .from(jobs)
    .where(
      and(
        eq(sql`LOWER(${jobs.contractAddress})`, event.address.toLowerCase()),
        eq(jobs.chainId, listener.chainId),
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

  console.log(`interestedJobs:`, interestedJobs);
  console.log(`jobRows:`, jobRows);

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

    const runtime = runtimeListeners[contractAddress];
    if (runtime) {
      const allEvents = jobRows.flatMap((j) => j.events);
      await updateListenerEvents(runtime, allEvents);
    }
  }

  const addresses = await db
    .select({
      sender: contractEvents.sender,
      receiver: contractEvents.receiver,
    })
    .from(contractEvents)
    .where(eq(contractEvents.jobId, jobId))
    .orderBy(desc(contractEvents.detectedAt));

  const uniqueAddresses = Array.from(
    new Set(addresses.flatMap((addr) => [addr.sender, addr.receiver]))
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

  console.log(`Job '${jobId}' unsubscribed from contract listener.`);

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
  const isAddress = (value: any): boolean => {
    try {
      return ethers.isAddress(value);
    } catch {
      return false;
    }
  };

  const contractAddress = log.address;
  let sender: string | undefined;
  let receiver: string | undefined;

  if (parsed.args?.from && isAddress(parsed.args.from)) {
    const fromAddress = parsed.args.from;
    if (fromAddress !== contractAddress) {
      sender = parsed.args.from;
    }
  }
  if (parsed.args?.to && isAddress(parsed.args.to)) {
    const toAddress = parsed.args.to;
    if (toAddress !== contractAddress) {
      receiver = parsed.args.to;
    }
  }

  if ((!sender || !receiver) && parsed.args) {
    const addresses = Object.values(parsed.args).filter(
      (v: any): v is string => {
        if (!isAddress(v)) return false;
        return (v as string) !== contractAddress;
      }
    );

    if (!sender && addresses.length > 0) sender = addresses[0];
    if (!receiver && addresses.length > 1) receiver = addresses[1];
  }

  let value: bigint | undefined;
  if (parsed?.args?.value) {
    value = BigInt(parsed.args.value.toString());
  } else {
    const tx = await provider.getTransaction(log.transactionHash);
    if (tx && tx.value && tx.value > 0n) {
      value = tx.value;
      sender = tx.from;
      receiver = tx.to || receiver;
    }
  }

  return {
    name: parsed.fragment?.name || parsed.name,
    address: log.address,
    value,
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
