import connection from "@/redis";
import { Queue, Worker } from "bullmq";
import { recordYapperClusterActivity, type Yap } from "./yappers";
import {
  stopJobContractEventListener,
  updateJobOnchainLeaderboard,
  type ContractJobEvents,
} from "./job-service";
import { processBlock } from "./listener-service";
import { handleYapRequestCreated } from "@/api/jobs/jobs";

export const recordYapperClusterQueue = new Queue("recordYapperClusterQueue", {
  connection,
});
export const processBlockQueue = new Queue("processBlockQueue", {
  connection,
  defaultJobOptions: {
    attempts: 5,
    backoff: {
      type: "exponential",
      delay: 1000,
    },
  },
});
export const stopJobQueue = new Queue("stopJobQueue", {
  connection,
  defaultJobOptions: {
    attempts: 3,
  },
});
export const handleYapRequestCreatedQueue = new Queue(
  "handleYapRequestCreatedQueue",
  {
    connection,
    defaultJobOptions: {
      attempts: 5,
      backoff: {
        type: "exponential",
        delay: 2000,
      },
    },
  }
);
export const leaderboardUpdateQueue = new Queue("leaderboardUpdateQueue", {
  connection,
});

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

export const processBlockWorker = new Worker<{
  chainId: number;
  currentBlock: number;
  blockNumber: number;
}>(
  "processBlockQueue",
  async (processBlockPayload) => {
    const { chainId, currentBlock, blockNumber } = processBlockPayload.data;
    await processBlock(chainId, currentBlock, blockNumber);
    console.log(
      `processBlockWorker processed block ---- ${blockNumber} for listener ${chainId}`
    );
  },
  {
    connection,
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

export const leaderboardUpdateWorker = new Worker(
  "leaderboardUpdateQueue",
  async (job) => {
    const { jobId } = job.data;
    await updateJobOnchainLeaderboard(jobId);
    console.log(`leaderboardUpdateWorker updated job ---- ${jobId}`);
  },
  { connection }
);

export const handleYapRequestCreatedWorker = new Worker(
  "handleYapRequestCreatedQueue",
  async (job) => {
    const {
      jobId,
      yapId,
      adjustedBudget,
      adjustedFee,
      chainId,
      transactionHash,
      creator,
      asset,
      blockNumber,
    } = job.data;
    await handleYapRequestCreated(
      jobId,
      yapId,
      adjustedBudget,
      adjustedFee,
      chainId,
      transactionHash,
      creator,
      asset,
      blockNumber
    );
    console.log(
      `handleYapRequestCreatedWorker processed yap request ---- ${yapId} for job ${jobId}`
    );
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

processBlockWorker.on("failed", (job, err) =>
  console.error(`processBlockWorker job ${job?.id} failed:`, err)
);
processBlockWorker.on("stalled", (job) =>
  console.error(`processBlockWorker job ${job} stalled:`)
);

handleYapRequestCreatedWorker.on("failed", (job, err) =>
  console.error(`handleYapRequestCreatedWorker job ${job?.id} failed:`, err)
);
handleYapRequestCreatedWorker.on("stalled", (job) =>
  console.error(`handleYapRequestCreatedWorker job ${job} stalled:`)
);

stopJobWorker.on("failed", (job, err) =>
  console.error(`stopJobWorker job ${job?.id} failed:`, err)
);
stopJobWorker.on("stalled", (job) =>
  console.error(`stopJobWorker job ${job} stalled:`)
);

leaderboardUpdateWorker.on("failed", (job, err) =>
  console.error(`leaderboardUpdateWorker job ${job?.id} failed:`, err)
);
leaderboardUpdateWorker.on("stalled", (job) =>
  console.error(`leaderboardUpdateWorker job ${job} stalled:`)
);
