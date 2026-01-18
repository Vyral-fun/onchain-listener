import {
  contractEvents,
  jobs,
  yappersDerivedAddressActivity,
} from "@/db/schema/event";
import { type Yap } from "./yappers";
import { and, eq, sql } from "drizzle-orm";
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
  value: number;
  transactionHash: string;
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
    })
    .from(contractEvents)
    .where(eq(contractEvents.jobId, jobId));

  const jobEvents: ContractJobEvents[] = dbEvents.map((ev) => ({
    jobId: ev.jobId,
    chainId: ev.chainId,
    eventName: ev.eventName ?? "",
    sender: ev.sender ?? "",
    reciever: ev.reciever ?? "",
    contractAddress: ev.contractAddress ?? "",
    value: Number(ev.value ?? 0),
    transactionHash: ev.transactionHash ?? "",
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

export async function getJobActivityDetails(jobId: string): Promise<{
  addresses: string[];
  value: bigint;
  totalInteractions: number;
}> {
  const result = await db
    .select({
      totalInteractions: sql<number>`COUNT(*)`,
      totalValue: sql<string>`COALESCE(SUM(${yappersDerivedAddressActivity.value}), 0)`,
      addresses: sql<
        string[]
      >`ARRAY_AGG(DISTINCT ${yappersDerivedAddressActivity.address})`,
    })
    .from(yappersDerivedAddressActivity)
    .where(
      and(
        eq(yappersDerivedAddressActivity.jobId, jobId),
        eq(yappersDerivedAddressActivity.interacted, true)
      )
    );

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
