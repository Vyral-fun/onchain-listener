import type { Context } from "hono";

import z from "zod";
import {
  subscribeListenerSchema,
  unsubscribeListenerSchema,
} from "@/zod/events";
import {
  subscribeJobToContractListener,
  unsubscribeJobFromContractListener,
} from "@/services/contract-listener";
import { db } from "@/db";
import { contractEvents, jobs } from "@/db/schema/event";
import { eq, desc } from "drizzle-orm";
import { NULL_ADDRESS } from "@/utils/constants";

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
  } = validatedBody.data;

  try {
    const result = await subscribeJobToContractListener(
      jobId,
      contractAddress,
      abi,
      chainId,
      eventsToListenFor
    );

    return c.json(
      {
        success: true,
        message: `Job '${jobId}' subscribed to ${contractAddress}`,
      },
      200
    );
  } catch (error) {
    console.error(
      "Yap.listeners.subscribeContractEventListener.error: ",
      error
    );
    return c.json({ error: "Internal server error" }, 500);
  }
}

export async function stopContractEventListener(c: Context) {
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

  const body = await c.req.json();
  const validatedBody = unsubscribeListenerSchema.safeParse(body);

  if (!validatedBody.success) {
    return c.json({ error: validatedBody.error }, 400);
  }

  const { contractAddress } = validatedBody.data;

  try {
    await unsubscribeJobFromContractListener(jobId);
    return c.json(
      {
        success: true,
        message: `Job '${jobId}' unsubscribed from ${contractAddress}`,
      },
      200
    );
  } catch (error) {
    console.error(
      "Yap.listeners.unsubscribeContractEventListener.error: ",
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
        events: jobs.events,
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
    console.error("Yap.listeners.getJobEvents.error: ", error);
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
        events: jobs.events,
        createdAt: jobs.createdAt,
        isActive: jobs.isActive,
      })
      .from(jobs)
      .orderBy(desc(jobs.createdAt));

    return c.json({ success: true, jobs: allJobs }, 200);
  } catch (error) {
    console.error("Yap.listeners.getAllJobs.error: ", error);
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
        events: jobs.events,
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
      (addr) => addr !== job[0]!.contractAddress && addr !== NULL_ADDRESS
    );

    return c.json({ success: true, addresses: filteredAddresses }, 200);
  } catch (error) {
    console.error("Yap.listeners.getJobEventAddresses.error: ", error);
    return c.json({ error: "Internal server error" }, 500);
  }
}
