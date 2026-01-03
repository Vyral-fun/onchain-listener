import {
  getEcosystemDetails,
  getEnvChainIdsForActiveListeners,
} from "@/utils/ecosystem";
import { abi } from "../escrowV2.json";
import { abi as erc20Abi } from "../erc20.json";
import { ethers } from "ethers";
import { handleYapRequestCreated } from "@/api/jobs/jobs";
import { LOG_INTERVAL_MS, NULL_ADDRESS } from "@/utils/constants";
import WebSocket from "ws";

export interface NetworkContractListener {
  ws: WebSocket;
  abi: any;
  chainId: number;
  contractAddress: string;
  isActive: boolean;
  reconnectAttempts: number;
  lastEventTime: number;
  lastBlockEventTime: number;
  lastBlockLogTime: number;
  httpProvider: ethers.JsonRpcProvider;
  subscriptionId: string | null;
  blockSubscriptionId: string | null;
  iface: ethers.Interface;
  pingTimer: Timer | null;
  pongTimeout: Timer | null;
  stop: () => Promise<void>;
  reconnect: () => Promise<void>;
}

const MAX_RECONNECT_ATTEMPTS = 10;
const RECONNECT_DELAY = 5000; // 5 seconds
const HEALTH_CHECK_INTERVAL = 60000; // 1 minute
const PING_INTERVAL = 30000; // 30s
const PONG_TIMEOUT = 15000; // 15s

export const runtimeNetworkListeners: Record<number, NetworkContractListener> =
  {};

export async function createtNetworkListener(
  chainId: number,
  contractAddress: string
): Promise<NetworkContractListener> {
  const { wsUrl, rpcUrl } = getEcosystemDetails(chainId);
  if (!wsUrl) {
    throw new Error(`WebSocket URL not found for chain ID: ${chainId}`);
  }

  const iface = new ethers.Interface(abi);
  const httpProvider = new ethers.JsonRpcProvider(rpcUrl);

  const listener: NetworkContractListener = {
    ws: null as any,
    abi,
    chainId,
    contractAddress,
    isActive: true,
    reconnectAttempts: 0,
    lastEventTime: Date.now(),
    lastBlockEventTime: 0,
    lastBlockLogTime: 0,
    subscriptionId: null,
    blockSubscriptionId: null,
    iface,
    httpProvider,
    pingTimer: null,
    pongTimeout: null,
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

      if (listener.blockSubscriptionId) {
        try {
          await sendRpc(listener.ws, {
            method: "eth_unsubscribe",
            params: [listener.blockSubscriptionId],
          });
        } catch (err) {
          console.error(`[${chainId}] Unsubscribe blocks error:`, err);
        }
      }

      if (listener.ws) {
        listener.ws.close(1000, "Stopping listener");
      }

      delete runtimeNetworkListeners[chainId];
      console.log(`[${chainId}] Listener stopped successfully`);
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

      setupWebSocket();
    },
  };

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

  function setupWebSocket() {
    const ws = new WebSocket(wsUrl);
    listener.ws = ws;

    ws.on("open", async () => {
      console.log(`[${chainId}] WebSocket opened`);
      listener.reconnectAttempts = 0;

      try {
        const subId = await sendRpc(ws, {
          method: "eth_subscribe",
          params: [
            "logs",
            {
              address: contractAddress,
              topics: [
                ethers.id(
                  "YapRequestCreated(uint256,address,string,address,uint256,uint256)"
                ),
              ],
            },
          ],
        });

        listener.subscriptionId = subId;
        console.log(
          `[${chainId}] eth_subscribe logs active (id: ${subId}) for contract ${contractAddress} with wsUrl ${wsUrl}`
        );

        const blockSubId = await sendRpc(ws, {
          method: "eth_subscribe",
          params: ["newHeads"],
        });
        listener.blockSubscriptionId = blockSubId;

        console.log(
          `[${chainId}] eth_subscribe blocks active (id: ${blockSubId})`
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
            listener.lastEventTime = Date.now();
            listener.reconnectAttempts = 0;

            try {
              const parsed = listener.iface.parseLog({
                topics: log.topics,
                data: log.data,
              });

              if (parsed?.name === "YapRequestCreated") {
                const { yapId, creator, jobId, asset, budget, fee } =
                  parsed.args;

                let decimals = 18;
                if (asset !== NULL_ADDRESS) {
                  try {
                    const tokenContract = new ethers.Contract(
                      asset,
                      erc20Abi,
                      httpProvider
                    );
                    decimals = await tokenContract.decimals();
                  } catch (error) {
                    console.error(
                      `[${chainId}] Error fetching decimals for asset ${asset}:`,
                      error
                    );
                  }
                }

                const adjustedBudget = Number(
                  ethers.formatUnits(budget, decimals)
                );
                const adjustedFee = Number(ethers.formatUnits(fee, decimals));

                console.log(`[${chainId}] YapRequestCreated event detected:`);
                console.log(`  - JobId: ${jobId}`);
                console.log(`  - YapId: ${yapId}`);
                console.log(`  - Budget: ${adjustedBudget}`);
                console.log(`  - Fee: ${adjustedFee}`);
                console.log(`  - TxHash: ${log.transactionHash}`);
                console.log(`  - Creator: ${creator}`);
                console.log(`  - Asset: ${asset}`);

                try {
                  await handleYapRequestCreated(
                    jobId,
                    yapId,
                    adjustedBudget,
                    adjustedFee,
                    chainId,
                    log.transactionHash,
                    creator,
                    asset
                  );
                  console.log(
                    `[${chainId}] Successfully processed YapRequestCreated for jobId: ${jobId}`
                  );
                } catch (error) {
                  console.error(
                    `[${chainId}] Error processing YapRequestCreated for jobId ${jobId}:`,
                    error
                  );
                }
              }
            } catch (e) {
              console.error(`[${chainId}] Log decode failed:`, e);
            }
          } else if (subscription === listener.blockSubscriptionId) {
            const blockNumber = parseInt(result.number, 16);
            const now = Date.now();
            listener.lastBlockEventTime = now;

            if (now - listener.lastBlockLogTime > LOG_INTERVAL_MS) {
              console.log(
                `[${chainId}] New block received: #${blockNumber} - ${result.hash}`
              );
              listener.lastBlockLogTime = now;
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

  setupWebSocket();
  return listener;
}

export function startHealthCheck() {
  setInterval(() => {
    const now = Date.now();
    console.log("=== Health Check ===");

    for (const [chainId, listener] of Object.entries(runtimeNetworkListeners)) {
      const timeSinceLastEvent = now - listener.lastEventTime;
      const timeSinceLastBlockEvent = now - listener.lastBlockEventTime;
      const minutesSinceLastEvent = Math.floor(timeSinceLastEvent / 60000);
      const minutesSinceLastBlockEvent = Math.floor(
        timeSinceLastBlockEvent / 60000
      );

      console.log(`[${chainId}] Status:`);
      console.log(`  - Active: ${listener.isActive}`);
      console.log(`  - WS State: ${listener.ws?.readyState ?? "N/A"} (1=OPEN)`);
      console.log(`  - Subscription: ${listener.subscriptionId ?? "none"}`);
      console.log(`  - Last event: ${minutesSinceLastEvent} minutes ago`);
      console.log(
        `  - Last block event: ${minutesSinceLastBlockEvent} minutes ago`
      );
      console.log(`  - Reconnect attempts: ${listener.reconnectAttempts}`);

      const MAX_IDLE_TIME = 1 * 60 * 1000; // 5 minutes
      if (
        timeSinceLastEvent > MAX_IDLE_TIME &&
        listener.isActive &&
        timeSinceLastBlockEvent > MAX_IDLE_TIME
      ) {
        console.warn(
          `[${chainId}] No events for ${minutesSinceLastEvent} minutes. Forcing reconnection...`
        );
        listener.reconnect();
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

  if (listener?.contractAddress === contractAddress && listener) {
    console.log(
      `[${chainId}] Listener already exists for contract ${contractAddress}`
    );
    return listener;
  }

  if (listener) {
    console.log(`[${chainId}] Updating listener to new contract address`);
    await listener.stop();
  }

  const newListener = await createtNetworkListener(chainId, contractAddress);
  runtimeNetworkListeners[chainId] = newListener;

  return newListener;
}

export async function updateNetworksListeners() {
  const envChainIds = getEnvChainIdsForActiveListeners();

  for (const chainId of envChainIds) {
    try {
      const { escrowContract } = getEcosystemDetails(chainId);
      await updateNetworkContractListener(chainId, escrowContract);
      console.log(`[${chainId}] Listener active on chain ${chainId}`);
    } catch (err) {
      console.error(`[${chainId}] Failed to start listener:`, err);
    }
  }

  startHealthCheck();
  console.log("Health check monitoring started");
}
