import {
  contractEvents,
  jobs,
  yappersDerivedAddressActivity,
} from "@/db/schema/event";
import { type Yap } from "./yappers";
import { eq } from "drizzle-orm";
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
  value: number;
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

  console.log(
    `Fetched ${jobEvents.length} contract events for job ${jobId} to record yap activities`
  );
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

  const schedulerId = `leaderboard-${jobId}`;
  try {
    await leaderboardUpdateQueue.removeJobScheduler(schedulerId);
    console.log(`Removed periodic leaderboard scheduler for job ${jobId}`);
  } catch (err) {
    console.warn(`Could not remove leaderboard scheduler for ${jobId}`, err);
  }

  try {
    await updateJobOnchainLeaderboard(jobId);
    console.log(`Final leaderboard update done for job ${jobId}`);
  } catch {}

  console.log(`Stopped contract event listener for job ${jobId}`);
}

export async function updateJobOnchainLeaderboard(jobId: string) {
  const yaps = await getJobYaps(jobId);
  await recordJobYapsActivity(yaps, jobId);

  console.log(
    `Updated on-chain leaderboard for job ${jobId} after recording yap activities`
  );
}

export async function getJobActivityDetails(jobId: string): Promise<{
  addresses: string[];
  value: number;
}> {
  const result = await db
    .select({
      yapperAddress: yappersDerivedAddressActivity.yapperAddress,
      address: yappersDerivedAddressActivity.address,
      value: yappersDerivedAddressActivity.value,
    })
    .from(yappersDerivedAddressActivity)
    .where(eq(yappersDerivedAddressActivity.jobId, jobId));

  const uniqueAddressesSet = new Set<string>();
  let totalValue = 0;

  for (const row of result) {
    if (row.address && row.address !== NULL_ADDRESS) {
      uniqueAddressesSet.add(row.address);
    }
    if (row.yapperAddress && row.yapperAddress !== NULL_ADDRESS) {
      uniqueAddressesSet.add(row.yapperAddress);
    }
    totalValue += Number(row.value ?? 0);
  }

  return {
    addresses: Array.from(uniqueAddressesSet),
    value: totalValue,
  };
}
