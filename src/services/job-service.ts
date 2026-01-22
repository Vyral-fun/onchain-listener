import {
  contractEvents,
  jobs,
  onchainJobInvites,
  yappersDerivedAddressActivity,
} from "@/db/schema/event";
import { recordYapperClusterActivity, type Yap } from "./yappers";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { leaderboardUpdateQueue, recordYapperClusterQueue } from "./queue";
import { unsubscribeJobFromContractListener } from "./listener-service";
import { getJobYaps } from "@/api/yap/yap";
import { NULL_ADDRESS } from "@/utils/constants";

export interface ContractJobEvents {
  jobId: string;
  chainId: number;
  eventName: string;
  sender: string;
  reciever: string;
  contractAddress: string;
  value: string;
  transactionHash: string;
  blockNumber: string;
}

export interface Job {
  id: string;
  onchainHeirarchy: "volume" | "walletCount";
  onchainReward: number;
  addresses: string[];
  value: bigint;
  totalInteractions: number;
}

export async function recordJobYapsActivity(yaps: Yap[], jobId: string) {
  const job = await db
    .select({
      id: jobs.id,
      chainId: jobs.chainId,
    })
    .from(jobs)
    .where(eq(jobs.id, jobId));

  if (!job || job.length === 0) {
    return;
  }

  const chainId = job[0]!.chainId;

  const dbEvents = await db
    .select({
      jobId: contractEvents.jobId,
      chainId: contractEvents.chainId,
      eventName: contractEvents.eventName,
      sender: contractEvents.sender,
      reciever: contractEvents.receiver,
      contractAddress: contractEvents.contractAddress,
      value: contractEvents.value,
      transactionHash: contractEvents.transactionHash,
      blockNumber: contractEvents.blockNumber,
    })
    .from(contractEvents)
    .where(eq(contractEvents.jobId, jobId));

  const uniqueEventsMap = new Map<string, (typeof dbEvents)[0]>();

  for (const ev of dbEvents) {
    const uniqueKey = `${ev.sender?.toLowerCase()}-${ev.reciever?.toLowerCase()}-${
      ev.transactionHash
    }-${ev.blockNumber}`;

    if (!uniqueEventsMap.has(uniqueKey)) {
      uniqueEventsMap.set(uniqueKey, ev);
    }
  }

  const uniqueDbEvents = Array.from(uniqueEventsMap.values());

  const jobEvents: ContractJobEvents[] = uniqueDbEvents.map((ev) => ({
    jobId: ev.jobId,
    chainId: ev.chainId,
    eventName: ev.eventName ?? "",
    sender: ev.sender ?? "",
    reciever: ev.reciever ?? "",
    contractAddress: ev.contractAddress ?? "",
    value: ev.value?.toString() ?? "0",
    transactionHash: ev.transactionHash ?? "",
    blockNumber: ev.blockNumber?.toString() ?? "0",
  }));

  for (const yap of yaps) {
    await recordYapperClusterQueue.add(
      "recordYapperCluster",
      {
        yap,
        chainId,
        contractEvents: jobEvents,
      },
      {
        jobId: "recordYapperCluster" + `-${yap.jobId}` + `-${yap.yapperid}`,
        removeOnComplete: true,
      }
    );
    console.log(
      `Enqueued yapper ${yap.yapperid} for job ${jobId} into recordYapperClusterQueue`
    );
  }
}

export async function stopJobContractEventListener(jobId: string) {
  await unsubscribeJobFromContractListener(jobId);
}

export async function updateJobOnchainLeaderboard(jobId: string) {
  const yaps = await getJobYaps(jobId);
  await recordJobYapsActivity(yaps, jobId);
}

export async function getJobActivityDetails(
  jobId: string,
  yaps: Yap[]
): Promise<{
  addresses: string[];
  value: bigint;
  totalInteractions: number;
}> {
  const affilites = await db
    .select({
      address: onchainJobInvites.inviteeWalletAdress,
    })
    .from(onchainJobInvites);

  const affiliateAndYapperAddresses = Array.from(
    new Set([
      ...affilites.map((a) => a.address.toLowerCase()),
      ...yaps.map((y) => y.walletAddress.toLowerCase()),
    ])
  );

  if (affiliateAndYapperAddresses.length === 0) {
    return {
      addresses: [],
      value: 0n,
      totalInteractions: 0,
    };
  }

  const subquery = db
    .select({
      transactionHash: yappersDerivedAddressActivity.transactionHash,
      value: sql<string>`MAX(${yappersDerivedAddressActivity.value})`.as(
        "value"
      ),
    })
    .from(yappersDerivedAddressActivity)
    .where(
      and(
        eq(yappersDerivedAddressActivity.jobId, jobId),
        eq(yappersDerivedAddressActivity.interacted, true),
        inArray(
          sql`LOWER(${yappersDerivedAddressActivity.address})`,
          affiliateAndYapperAddresses
        )
      )
    )
    .groupBy(yappersDerivedAddressActivity.transactionHash)
    .as("sub");

  const result = await db
    .select({
      totalInteractions: sql<number>`COUNT(*)`,
      totalValue: sql<string>`COALESCE(SUM(${subquery.value}), 0)`,
      addresses: sql<string[]>`
      ARRAY(
        SELECT DISTINCT LOWER(address)
        FROM ${yappersDerivedAddressActivity}
        WHERE job_id = ${jobId}
          AND interacted = true
          AND LOWER(address) IN (${sql.join(
            affiliateAndYapperAddresses.map((a) => sql`${a}`),
            sql`, `
          )})
      )
    `,
    })
    .from(subquery);

  const data = result[0];

  const validAddresses = (data?.addresses || []).filter(
    (addr) => addr && addr !== NULL_ADDRESS
  );

  return {
    addresses: validAddresses,
    value: BigInt(data?.totalValue || 0),
    totalInteractions: data?.totalInteractions || 0,
  };
}
