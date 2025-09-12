import connection from "@/redis";
import { Queue, Worker } from "bullmq";
import { recordYapperClusterActivity, type Yap } from "./yappers";
import {
  stopJobContractEventListener,
  type ContractJobEvents,
} from "./job-service";
export const recordYapperClusterQueue = new Queue("recordYapperClusterQueue", {
  connection,
});
export const stopJobQueue = new Queue("stopJobQueue", { connection });

export const recordYapperClusterWorker = new Worker<{
  yap: Yap;
  chainId: number;
  contractEvents: ContractJobEvents[];
}>(
  "recordYapperClusterQueue",
  async (yapActivity) => {
    const { yap, chainId, contractEvents } = yapActivity.data;
    await recordYapperClusterActivity(yap, chainId, contractEvents);
    console.log(
      `recordYapperClusterWorker Yapper ${yap.yapperid} ---- for job ${yap.jobId}`
    );
  },
  {
    connection,
    concurrency: 5,
  }
);

export const stopJobWorker = new Worker(
  "stopJobQueue",
  async (job) => {
    const { jobId } = job.data;
    await stopJobContractEventListener(jobId);
    console.log(`stopJobWorker job ---- ${jobId}`);
  },
  { connection }
);

recordYapperClusterWorker.on("failed", (job, err) => {
  const yapperId = job?.data?.yap?.yapperid ?? "unknown";
  const jobId = job?.data?.yap?.jobId ?? "unknown";
  console.error(
    `recordYapperClusterWorker for Yapper ${yapperId} (Job ${jobId}) | Error: ${err.message}`
  );
});
recordYapperClusterWorker.on("stalled", (job) => {
  console.error(`recordYapperClusterWorker Job ID ${job} stalled`);
});

stopJobWorker.on("failed", (job, err) =>
  console.error(`stopJobWorker job ${job?.id} failed:`, err)
);
stopJobWorker.on("stalled", (job) =>
  console.error(`stopJobWorker job ${job} stalled:`)
);
