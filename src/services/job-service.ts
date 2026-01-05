import { contractEvents, jobs } from "@/db/schema/event";
import { type Yap } from "./yappers";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { recordYapperClusterQueue } from "./queue";
import { unsubscribeJobFromContractListener } from "./listener-service";
import { getJobYaps } from "@/api/yap/yap";

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
      `✅ Enqueued yapper ${yap.yapperid} for job ${jobId} into recordYapperClusterQueue`
    );
  }
}

export async function stopJobContractEventListener(jobId: string) {
  await unsubscribeJobFromContractListener(jobId);
  const yaps = await getJobYaps(jobId);
  await recordJobYapsActivity(yaps, jobId);

  console.log(
    `Stopped contract event listener for job ${jobId} after recording yap activities`
  );
}
