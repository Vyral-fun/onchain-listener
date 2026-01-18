import type { Context } from "hono";

import z from "zod";
import { subscribeListenerSchema } from "@/zod/events";
import { subscribeJobToContractListener } from "@/services/listener-service";
import { leaderboardUpdateQueue, stopJobQueue } from "@/services/queue";
import { UPDATE_INTERVAL_MS } from "@/utils/constants";

export async function startContractEventListener(c: Context) {
  const jobId = c.req.param("jobId");
  const body = await c.req.json();

  const validatedParams = z
    .object({
      jobId: z.string().length(21, {
        message: "Job id must be 21 characters long",
      }),
    })
    .safeParse({ jobId });

  if (!validatedParams.success) {
    return c.json({ error: validatedParams.error }, 400);
  }

  const validatedBody = subscribeListenerSchema.safeParse(body);

  if (!validatedBody.success) {
    return c.json({ error: validatedBody.error }, 400);
  }

  const { contractAddress, abi, chainId, eventsToListenFor, endDate } =
    validatedBody.data;

  try {
    const result = await subscribeJobToContractListener(
      jobId,
      contractAddress,
      abi,
      chainId,
      eventsToListenFor
    );

    let stopDelayMs = endDate.getTime() - Date.now();
    let endDateAdjusted = endDate;

    if (Bun.env.NODE_ENV !== "production") {
      stopDelayMs = 15 * 60 * 1000; // 15 minutes for non-production
    }

    if (Bun.env.NODE_ENV !== "production") {
      endDateAdjusted = new Date(Date.now() + stopDelayMs);
    }

    await stopJobQueue.add(
      "stopJob",
      { jobId },
      {
        delay: stopDelayMs,
        removeOnComplete: true,
      }
    );

    await leaderboardUpdateQueue.add(
      "updateLeaderboard",
      { jobId },
      {
        repeat: {
          endDate: endDateAdjusted,
          every: UPDATE_INTERVAL_MS,
        },
        jobId: `leaderboard:${jobId}`,
      }
    );

    return c.json(
      {
        success: true,
        message: `Job '${jobId}' subscribed to ${result.contractAddress}`,
      },
      200
    );
  } catch (error) {
    console.error(
      "Yap.onchainListener.subscribeContractEventListener.error: ",
      error
    );
    return c.json({ error: "Internal server error" }, 500);
  }
}
