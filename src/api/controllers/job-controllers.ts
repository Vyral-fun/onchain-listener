import type { Context } from "hono";
import z from "zod";
import { db } from "@/db";
import {
  contractEvents,
  jobs,
  onchainJobInvites,
  yappersDerivedAddressActivity,
} from "@/db/schema/event";
import { eq, desc, sql, inArray, and } from "drizzle-orm";
import { NULL_ADDRESS } from "@/utils/constants";
import { JobOnchainRewardBodySchema } from "@/zod/yapper";
import { getJobActivityDetails, type Job } from "@/services/job-service";
import { getYapperOnchainReward } from "@/services/yappers";

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
      // log and return error
      console.warn(`Job with id ${jobId} not found in getJobEvents`);
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
      console.warn(`Job with id ${jobId} not found in getJobEventAddresses`);
      return c.json({ success: true, addresses: [] }, 200);
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

    const yapperIds = Array.from(
      new Set(activities.map((act) => act.yapperid))
    );

    const affiliateAddresses =
      yapperIds.length > 0
        ? await db
            .select({
              yapperProfileId: onchainJobInvites.yapperProfileId,
              inviteeWalletAdress: onchainJobInvites.inviteeWalletAdress,
            })
            .from(onchainJobInvites)
            .where(inArray(onchainJobInvites.yapperProfileId, yapperIds))
        : [];

    const affiliateMap = new Map<string, Set<string>>();
    for (const invite of affiliateAddresses) {
      if (!affiliateMap.has(invite.yapperProfileId)) {
        affiliateMap.set(invite.yapperProfileId, new Set());
      }
      affiliateMap
        .get(invite.yapperProfileId)!
        .add(invite.inviteeWalletAdress.toLowerCase());
    }

    const jobAddresses = await db
      .select({
        senders: contractEvents.sender,
        contractAddress: contractEvents.contractAddress,
      })
      .from(contractEvents)
      .where(eq(contractEvents.jobId, jobId));

    const uniqueJobAddresses = Array.from(
      new Set(
        jobAddresses.flatMap((addr) => [addr.senders, addr.contractAddress])
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

    const isAffiliateAddress = (
      yapperProfileId: string,
      address: string,
      yapperOwnAddress: string
    ): boolean => {
      if (address.toLowerCase() === yapperOwnAddress.toLowerCase()) {
        return false;
      }
      const affiliates = affiliateMap.get(yapperProfileId);
      return affiliates ? affiliates.has(address.toLowerCase()) : false;
    };

    const serializedClusters = clusters.map((group) =>
      group.map((item) => ({
        ...item,
        value:
          typeof item.value === "bigint" ? item.value.toString() : item.value,
        isAffiliateAddress: isAffiliateAddress(
          item.yapperid,
          item.address,
          item.yapperAddress
        ),
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

export async function getJobOnchainLeaderboard(c: Context) {
  const jobId = c.req.param("jobId");
  const sortBy = c.req.query("sortBy");

  const validated = z
    .object({
      jobId: z
        .string()
        .length(21, { message: "Job id must be 21 characters long" }),
      sortBy: z
        .enum(["walletCount", "volume"])
        .optional()
        .default("walletCount"),
    })
    .safeParse({ jobId, sortBy });

  if (!validated.success) {
    return c.json({ error: validated.error.format() }, 400);
  }

  const { sortBy: sortOption } = validated.data;

  try {
    const yappersWithActivity = await db
      .selectDistinct({
        yapperid: yappersDerivedAddressActivity.yapperid,
        yapperUsername: yappersDerivedAddressActivity.yapperUsername,
        yapperAddress: yappersDerivedAddressActivity.yapperAddress,
      })
      .from(yappersDerivedAddressActivity)
      .where(eq(yappersDerivedAddressActivity.jobId, jobId));

    const leaderboardPromises = yappersWithActivity.map(async (yapper) => {
      const affiliates = await db
        .select({
          address: onchainJobInvites.inviteeWalletAdress,
        })
        .from(onchainJobInvites)
        .where(eq(onchainJobInvites.yapperProfileId, yapper.yapperid));

      const validAddresses = [
        yapper.yapperAddress.toLowerCase(),
        ...affiliates.map((a) => a.address.toLowerCase()),
      ];

      const walletCount = sql<number>`COUNT(DISTINCT ${yappersDerivedAddressActivity.address}) FILTER (WHERE ${yappersDerivedAddressActivity.interacted} = true)`;
      const volume = sql<string>`COALESCE(SUM(${yappersDerivedAddressActivity.value}) FILTER (WHERE ${yappersDerivedAddressActivity.interacted} = true), 0)`;

      const stats = await db
        .select({
          walletCount,
          volume,
        })
        .from(yappersDerivedAddressActivity)
        .where(
          and(
            eq(yappersDerivedAddressActivity.jobId, jobId),
            eq(yappersDerivedAddressActivity.yapperid, yapper.yapperid),
            inArray(
              sql`LOWER(${yappersDerivedAddressActivity.address})`,
              validAddresses
            )
          )
        );

      return {
        yapperId: yapper.yapperid,
        yapperUsername: yapper.yapperUsername,
        walletCount: stats[0]?.walletCount || 0,
        volume: stats[0]?.volume || "0",
      };
    });

    let leaderboard = await Promise.all(leaderboardPromises);

    leaderboard.sort((a, b) =>
      sortOption === "volume"
        ? Number(b.volume) - Number(a.volume)
        : b.walletCount - a.walletCount
    );

    return c.json({ success: true, leaderboard }, 200);
  } catch (error) {
    console.error("Yap.onchainListener.getJobOnchainLeaderboard.error:", error);
    return c.json({ error: "Internal server error" }, 500);
  }
}

export async function getJobOnchainRewards(c: Context) {
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

  const validatedBody = JobOnchainRewardBodySchema.safeParse(body);
  if (!validatedBody.success) {
    return c.json({ error: validatedBody.error }, 400);
  }

  const { yaps, onchainHeirarchy, onchainReward } = validatedBody.data;

  try {
    const adjustedBudget = onchainReward - 1;
    const jobActivity = await getJobActivityDetails(jobId, yaps);

    if (jobActivity.addresses.length === 0 && jobActivity.value === 0n) {
      return c.json({
        jobId,
        hierarchy: onchainHeirarchy,
        totalReward: adjustedBudget,
        rewards: yaps.map((yap) => ({
          yapperid: yap.yapperid,
          yapperAddress: yap.walletAddress,
          reward: "0.00",
        })),
      });
    }

    const job: Job = {
      id: jobId,
      onchainHeirarchy,
      onchainReward: adjustedBudget,
      addresses: jobActivity.addresses,
      value: jobActivity.value,
      totalInteractions: jobActivity.totalInteractions,
    };

    const rewards = await Promise.all(
      yaps.map((yap) => getYapperOnchainReward(yap, job))
    );

    const totalDistributed = rewards.reduce((sum, r) => sum + r.reward, 0);

    return c.json({
      jobId,
      hierarchy: onchainHeirarchy,
      totalReward: adjustedBudget,
      rewards: rewards.map((r) => ({
        yapperid: r.yapperId,
        yapperAddress: r.yapperAddress,
        reward: r.reward.toFixed(2),
      })),
    });
  } catch (error) {
    console.error("Yap.onchainListener.getJobOnchainRewards.error: ", error);
    return c.json({ error: "Internal server error" }, 500);
  }
}
