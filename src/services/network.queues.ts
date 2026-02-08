import connection from "@/redis";
import { Queue, Worker } from "bullmq";
import { processBlock } from "./listener-service";
import {
  getEcosystemDetails,
  getEnvChainIdsForActiveListeners,
} from "@/utils/ecosystem";
import { db } from "@/db";
import { jobs } from "@/db/schema/event";
import { and, eq } from "drizzle-orm";

const processBlockQueues = new Map<number, Queue>();
const processBlockWorkers = new Map<number, Worker>();

export function getQueueForChain(chainId: number): Queue {
  if (!processBlockQueues.has(chainId)) {
    const queue = new Queue(`processBlock-chain-${chainId}`, {
      connection,
      defaultJobOptions: {
        attempts: 5,
        backoff: {
          type: "exponential",
          delay: 1000,
        },
        removeOnComplete: {
          count: 100,
          age: 3600,
        },
        removeOnFail: {
          count: 1000,
          age: 86400,
        },
      },
    });

    processBlockQueues.set(chainId, queue);
    console.log(`Created queue for chain ${chainId}`);
  }

  return processBlockQueues.get(chainId)!;
}

export function getWorkerForChain(chainId: number): Worker {
  if (!processBlockWorkers.has(chainId)) {
    const worker = new Worker<{
      chainId: number;
      currentBlock: number;
      blockNumber: number;
    }>(
      `processBlock-chain-${chainId}`,
      async (job) => {
        const { chainId, currentBlock, blockNumber } = job.data;

        await processBlock(chainId, currentBlock, blockNumber);
      },
      {
        connection,
        concurrency: getConcurrencyForChain(chainId),
        limiter: {
          max: 20,
          duration: 1000,
        },
      }
    );

    worker.on("failed", (job, err) => {
      console.error(`[${chainId}] Job ${job?.id} failed:`, err.message);
    });

    worker.on("error", (err) => {
      console.error(`[${chainId}] Worker error:`, err);
    });

    processBlockWorkers.set(chainId, worker);
    console.log(
      `Created worker for chain ${chainId} with concurrency ${getConcurrencyForChain(
        chainId
      )}`
    );
  }

  return processBlockWorkers.get(chainId)!;
}

function getConcurrencyForChain(chainId: number): number {
  const details = getEcosystemDetails(chainId);
  const pollInterval = details.networkPollInterval || 2000;

  if (pollInterval <= 500) return 5;
  if (pollInterval <= 2000) return 3;
  return 2;
}

export async function initializeAllChainQueues() {
  const activeChainIds = getEnvChainIdsForActiveListeners();

  const activeJobs = await db
    .select()
    .from(jobs)
    .where(eq(jobs.isActive, true));

  const chainsWithJobs = new Set(activeJobs.map((j) => j.chainId));

  for (const chainId of activeChainIds) {
    if (!chainsWithJobs.has(chainId)) {
      await shutdownQueueForChain(chainId);
      continue;
    }

    getQueueForChain(chainId);
    getWorkerForChain(chainId);
  }

  console.log(
    `Initialized queues and workers for chains: ${activeChainIds.join(", ")}`
  );
}

export async function shutdownAllQueues() {
  console.log("Shutting down all queues and workers...");

  for (const [chainId, worker] of processBlockWorkers.entries()) {
    console.log(`Closing worker for chain ${chainId}`);
    await worker.close();
  }

  for (const [chainId, queue] of processBlockQueues.entries()) {
    console.log(`Closing queue for chain ${chainId}`);
    await queue.close();
  }

  processBlockWorkers.clear();
  processBlockQueues.clear();

  console.log("All queues and workers shut down");
}

export async function shutdownQueueForChain(chainId: number) {
  const worker = processBlockWorkers.get(chainId);
  const queue = processBlockQueues.get(chainId);

  if (queue) {
    await queue.pause();

    await queue.drain(true);

    await queue.obliterate({ force: true });

    await queue.close();
    processBlockQueues.delete(chainId);
  }

  if (worker) {
    await worker.close();
    processBlockWorkers.delete(chainId);
  }

  console.log(`Shut down queue and worker for chain ${chainId}`);
}
