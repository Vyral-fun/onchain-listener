import type { Context } from "hono";

import z from "zod";
import { subscribeListenerSchema } from "@/zod/events";
import { subscribeJobToContractListener } from "@/services/listener-service";
import { db } from "@/db";
import {
  contractEvents,
  jobs,
  yappersDerivedAddressActivity,
} from "@/db/schema/event";
import { eq, desc } from "drizzle-orm";
import { NULL_ADDRESS } from "@/utils/constants";
import { stopJobQueue } from "@/services/queue";

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

  const {
    contractAddress,
    abi,
    chainId,
    eventsToListenFor = [],
    endDate,
  } = validatedBody.data;

  try {
    const result = await subscribeJobToContractListener(
      jobId,
      contractAddress,
      abi,
      chainId,
      eventsToListenFor
    );

    let stopDelayMs = endDate.getTime() - Date.now();

    if (Bun.env.NODE_ENV !== "production") {
      stopDelayMs = 4 * 60 * 1000;
    }

    await stopJobQueue.add(
      "stopJob",
      { jobId },
      {
        delay: stopDelayMs,
        removeOnComplete: true,
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

export async function getJobEvents(c: Context) {
  const jobId = c.req.param("jobId");
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

  try {
    const job = await db
      .select({
        id: jobs.id,
        contractAddress: jobs.contractAddress,
        chainId: jobs.chainId,
        eventsListenedOn: jobs.events,
        createdAt: jobs.createdAt,
        isActive: jobs.isActive,
      })
      .from(jobs)
      .where(eq(jobs.id, jobId));

    if (job.length === 0) {
      return c.json({ error: "Job not found" }, 404);
    }

    const jobEvents = await db
      .select({
        name: contractEvents.eventName,
        sender: contractEvents.sender,
        receiver: contractEvents.receiver,
        value: contractEvents.value,
        transactionHash: contractEvents.transactionHash,
      })
      .from(contractEvents)
      .where(eq(contractEvents.jobId, jobId))
      .orderBy(desc(contractEvents.detectedAt));

    const serializedEvents = jobEvents.map((event) => ({
      ...event,
      value: event.value ? event.value.toString() : null,
    }));

    return c.json({ success: true, job: job, events: serializedEvents }, 200);
  } catch (error) {
    console.error("Yap.onchainListener.getJobEvents.error: ", error);
    return c.json({ error: "Internal server error" }, 500);
  }
}

export async function getAllJobs(c: Context) {
  try {
    const allJobs = await db
      .select({
        id: jobs.id,
        contractAddress: jobs.contractAddress,
        chainId: jobs.chainId,
        eventsListenedOn: jobs.events,
        createdAt: jobs.createdAt,
        isActive: jobs.isActive,
      })
      .from(jobs)
      .orderBy(desc(jobs.createdAt));

    return c.json({ success: true, jobs: allJobs }, 200);
  } catch (error) {
    console.error("Yap.onchainListener.getAllJobs.error: ", error);
    return c.json({ error: "Internal server error" }, 500);
  }
}

export async function getJobEventAddresses(c: Context) {
  const jobId = c.req.param("jobId");
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

  try {
    const job = await db
      .select({
        id: jobs.id,
        contractAddress: jobs.contractAddress,
        chainId: jobs.chainId,
        eventsListenedOn: jobs.events,
        createdAt: jobs.createdAt,
        isActive: jobs.isActive,
      })
      .from(jobs)
      .where(eq(jobs.id, jobId));

    if (job.length === 0) {
      return c.json({ error: "Job not found" }, 404);
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
      (addr) =>
        addr !== job[0]!.contractAddress &&
        addr !== NULL_ADDRESS &&
        addr!.startsWith("0x")
    );

    return c.json({ success: true, addresses: filteredAddresses }, 200);
  } catch (error) {
    console.error("Yap.onchainListener.getJobEventAddresses.error: ", error);
    return c.json({ error: "Internal server error" }, 500);
  }
}

export async function getJobClusters(c: Context) {
  const jobId = c.req.param("jobId");
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

  try {
    const activities = await db
      .select()
      .from(yappersDerivedAddressActivity)
      .where(eq(yappersDerivedAddressActivity.jobId, jobId));

    const jobAddresses = await db
      .select({
        senders: contractEvents.sender,
        receivers: contractEvents.receiver,
        contractAddress: contractEvents.contractAddress,
      })
      .from(contractEvents)
      .where(eq(contractEvents.jobId, jobId));

    const uniqueJobAddresses = Array.from(
      new Set(
        jobAddresses.flatMap((addr) => [
          addr.senders,
          addr.receivers,
          addr.contractAddress,
        ])
      )
    ).filter(
      (addr) =>
        addr &&
        addr !== NULL_ADDRESS &&
        addr.startsWith("0x") &&
        addr !== jobAddresses[0]?.contractAddress
    );

    const yapperDerivedAddresses = Array.from(
      new Set(activities.flatMap((addr) => [addr.yapperAddress, addr.address]))
    ).filter(
      (addr) =>
        addr &&
        addr !== NULL_ADDRESS &&
        addr.startsWith("0x") &&
        addr !== jobAddresses[0]?.contractAddress
    );

    const interactedYapperAddresses = Array.from(
      new Set(
        activities
          .filter((act) => act.interacted)
          .flatMap((addr) => [addr.yapperAddress, addr.address])
      )
    ).filter(
      (addr) =>
        addr &&
        addr !== NULL_ADDRESS &&
        addr.startsWith("0x") &&
        addr !== jobAddresses[0]?.contractAddress
    );

    const yapperDerivedSet = new Set(yapperDerivedAddresses);

    const interactedYapperCount = interactedYapperAddresses.filter((addr) =>
      yapperDerivedSet.has(addr)
    ).length;

    const yapperInteractionPercentage =
      yapperDerivedAddresses.length === 0
        ? 0
        : (interactedYapperCount / yapperDerivedAddresses.length) * 100;

    const clustersMap: Record<string, typeof activities> = {};
    for (const act of activities) {
      if (!clustersMap[act.yapperid]) {
        clustersMap[act.yapperid] = [];
      }
      clustersMap[act.yapperid]!.push(act);
    }

    const clusters = Object.values(clustersMap).map((acts) => {
      const own = acts.find(
        (a) => a.yapperAddress.toLowerCase() === a.address.toLowerCase()
      );
      const others = acts.filter(
        (a) => a.yapperAddress.toLowerCase() !== a.address.toLowerCase()
      );

      return own ? [own, ...others] : acts;
    });

    const serializedClusters = clusters.map((group) =>
      group.map((item) => ({
        ...item,
        value:
          typeof item.value === "bigint" ? item.value.toString() : item.value,
      }))
    );

    const yapperInteractionCounts = Object.entries(clustersMap).map(
      ([yapperId, acts]) => {
        const interactedCount = acts.filter((act) => act.interacted).length;
        const totalAddresses = acts.length;
        const yapperUserId = acts[0]?.yapperUserId;
        const yapperUsername = acts[0]?.yapperUsername;

        return {
          yapperId,
          yapperUserId,
          yapperUsername,
          interactedCount,
          totalAddresses,
          interactionRate:
            totalAddresses > 0 ? (interactedCount / totalAddresses) * 100 : 0,
        };
      }
    );

    const topContributors = yapperInteractionCounts
      .sort((a, b) => b.interactedCount - a.interactedCount)
      .slice(0, 5);

    return c.json(
      {
        totalUniqueWalletsDuringJob: uniqueJobAddresses.length,
        interactionPercentage: Number(yapperInteractionPercentage.toFixed(2)),
        totalYapperDerivedAddresses: yapperDerivedAddresses.length,
        interactedYapperCount: interactedYapperCount,
        topContributors,
        clusters: serializedClusters,
      },
      200
    );
  } catch (error) {
    console.error("Yap.onchainListener.getJobClusters.error: ", error);
    return c.json({ error: "Internal server error" }, 500);
  }
}

// export async function stopContractEventListener(c: Context) {
//   const jobId = c.req.param("jobId");
//   const validatedParams = z
//     .object({
//       jobId: z.string().length(21, {
//         message: "Job id must be 21 characters long",
//       }),
//     })
//     .safeParse({ jobId });

//   if (!validatedParams.success) {
//     return c.json({ error: validatedParams.error }, 400);
//   }

//   const body = await c.req.json();
//   const validatedBody = unsubscribeListenerSchema.safeParse(body);

//   if (!validatedBody.success) {
//     return c.json({ error: validatedBody.error }, 400);
//   }

//   const { contractAddress } = validatedBody.data;

//   try {
//     await unsubscribeJobFromContractListener(jobId);
//     return c.json(
//       {
//         success: true,
//         message: `Job '${jobId}' unsubscribed from ${contractAddress}`,
//       },
//       200
//     );
//   } catch (error) {
//     console.error(
//       "Yap.onchainListener.unsubscribeContractEventListener.error: ",
//       error
//     );
//     return c.json({ error: "Internal server error" }, 500);
//   }
// }
