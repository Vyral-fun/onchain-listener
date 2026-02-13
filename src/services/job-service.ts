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

const INCOM_RWA_POOLS = new Set(
  [
    "0x775D5061C477B1564f2d957C4791bcC089F3D0D7",
    "0x6B025e8F3A76573D9D411Be4B12E2c6BBd56f75f",
    "0x18B3be6313673336A48D3a9f4522AA62CDC5a34f",
    "0x9e39337907553d2408009EF1C164FfA783Da721c",
    "0x5C1BeAc829aAB316A6Cd3690f756f83a05dA31ED",
  ].map((addr) => addr.toLowerCase())
);

const INCOM_RWA_TOKEN =
  "0x833f973406E07830d494cBe5FaBBc3AE9c750c1F".toLowerCase();

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

function shouldIncludeEvent(contract: string, receiver: string): boolean {
  if (contract === INCOM_RWA_TOKEN) {
    let shouldinclude = !!receiver && INCOM_RWA_POOLS.has(receiver);
    console.log(
      `Contract is token contract and reciever is pool: ${shouldinclude}`
    );
    return shouldinclude;
  }

  return true;
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

    const contract = ev.contractAddress?.toLowerCase() ?? "";
    const receiver = ev.reciever?.toLowerCase() ?? "";

    if (
      !uniqueEventsMap.has(uniqueKey) &&
      shouldIncludeEvent(contract, receiver)
    ) {
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
