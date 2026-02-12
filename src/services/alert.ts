import TelegramBot from "node-telegram-bot-api";
import { sendAlertQueue } from "./queue";
import type { NetworkListener } from "./listener-service";
import { ALERT_COOLDOWN_MS, CHAIN_ALERT_THRESHOLDS } from "@/utils/constants";
import type { NetworkContractListener } from "./deposit-service";

export const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN!, {
  polling: true,
});

const groupId = Number(process.env.TELEGRAM_GROUP_ID);

export function connectBot() {
  console.log("Telegram bot started and listening...");

  bot.on("message", (msg) => {
    const chatId = msg.chat.id;

    console.log("Received message from user:", msg.from);
    console.log("Chat ID:", chatId);
    console.log("Chat Type:", msg.chat.type);
    console.log("Chat Title:", msg.chat.title);
  });

  bot.on("polling_error", (error) => {
    console.error("Telegram polling error:", error);
  });
}

export async function sendAlert(message: string) {
  try {
    await bot.sendMessage(groupId, message);
  } catch (error) {
    console.error("Failed to send Telegram alert:", error);
  }
}

export async function sendNetworkAlert(message: string) {
  sendAlertQueue.add("sendAlert", { message }, { removeOnComplete: true });
}

export async function sendDepositAlert(chainId: number, message: string) {
  try {
    await sendAlertQueue.add(
      "sendAlert",
      { message: `💰 [Deposit-Chain ${chainId}] ${message}` },
      {
        attempts: 3,
        backoff: {
          type: "exponential",
          delay: 1000,
        },
      }
    );
  } catch (error) {
    console.error(
      `Failed to queue Telegram alert for chain ${chainId}:`,
      error
    );
  }
}

export function shouldSendAlert(listener: NetworkListener): boolean {
  const now = Date.now();
  if (now - listener.lastAlertSentAt < ALERT_COOLDOWN_MS) {
    return false;
  }
  return true;
}

export function getAlertThreshold(chainId: number): number {
  return CHAIN_ALERT_THRESHOLDS[chainId] || 50;
}

export function shouldSendDepositAlert(
  listener: NetworkContractListener
): boolean {
  const now = Date.now();
  if (now - listener.lastAlertSentAt < ALERT_COOLDOWN_MS) {
    return false;
  }
  return true;
}
