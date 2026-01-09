import { db } from "@/db";
import { checkENS, getOnchainAddressesInteractedWith } from "./address";
import { type ContractJobEvents, type Job } from "./job-service";
import { getTwitterFollowersName } from "../api/twitter/twitter";
import { BATCH_SIZE, NULL_ADDRESS } from "@/utils/constants";
import {
  onchainJobInvites,
  yappersDerivedAddressActivity,
} from "@/db/schema/event";
import { getYapMarketAddresses } from "@/api/yap/yap";
import { and, eq, sql } from "drizzle-orm";

export interface Yap {
  yapperid: string;
  userId: string;
  jobId: string;
  twitterUsername: string;
  walletAddress: string;
}

export async function recordYapperClusterActivity(
  yap: Yap,
  chainId: number,
  contractEvents: ContractJobEvents[]
) {
  const twitterFollowersNames = await getTwitterFollowersName(
    yap.twitterUsername
  );

  const onchainInvitesData = await getYapperOnchainInvitesData(yap.yapperid);
  const onchainInvitesAddresses = onchainInvitesData.map(
    (r) => r.walletAddresses
  );
  const onchainInvitesTwitterNames = onchainInvitesData.map((r) => r.names);

  const allTwitterNamesSet = new Set<string>([
    ...(twitterFollowersNames ?? []),
    ...(onchainInvitesTwitterNames ?? []),
  ]);

  const allTwitterNames = [...allTwitterNamesSet];

  const [ensResults, onchainAddresses, yapMarketAddresses] = await Promise.all([
    checkENS(twitterFollowersNames),
    getOnchainAddressesInteractedWith(yap.walletAddress, chainId),
    getYapMarketAddresses(allTwitterNames),
  ]);

  const twitterAddresses = ensResults
    .map((res) => res.address)
    .filter((addr): addr is string => !!addr);

  const addressesData = onchainAddresses ?? {
    outwardTransferData: { transfers: [] },
    inwardTransferData: { transfers: [] },
    allAddresses: [],
  };

  const allAddresses = [
    yap.walletAddress,
    ...(twitterAddresses || []),
    ...(addressesData.allAddresses || []),
    ...(yapMarketAddresses || []),
    ...(onchainInvitesAddresses || []),
  ];

  const filtered = Array.from(
    new Set(
      allAddresses
        .filter((a) => a && a !== NULL_ADDRESS)
        .map((a) => a.toLowerCase())
    )
  );

  const eventsByAddress = new Map<string, ContractJobEvents[]>();

  for (const event of contractEvents) {
    const sender = event.sender.toLowerCase();
    const receiver = event.reciever.toLowerCase();

    if (!eventsByAddress.has(sender)) {
      eventsByAddress.set(sender, []);
    }
    if (!eventsByAddress.has(receiver)) {
      eventsByAddress.set(receiver, []);
    }

    eventsByAddress.get(sender)?.push(event);
    if (sender !== receiver) {
      eventsByAddress.get(receiver)?.push(event);
    }
  }

  const records = filtered.map((addr) => {
    const matchingEvents = eventsByAddress.get(addr) || [];

    const totalValue = matchingEvents.reduce(
      (sum, ev) => sum + BigInt(ev.value || 0),
      0n
    );

    const interactionCount = matchingEvents.length;
    const hasInteraction = interactionCount > 0;

    const latestEvent = matchingEvents[matchingEvents.length - 1];

    return {
      yapperid: yap.yapperid,
      yapperUsername: yap.twitterUsername,
      yapperUserId: yap.userId,
      jobId: yap.jobId,
      yapperAddress: yap.walletAddress,
      address: addr,
      event: latestEvent?.eventName ?? null,
      value: totalValue > 0n ? totalValue : null,
      transactionHash: latestEvent?.transactionHash ?? null,
      interacted: hasInteraction,
      lastUpdated: new Date(),
    };
  });

  if (records.length > 0) {
    for (let i = 0; i < records.length; i += BATCH_SIZE) {
      const chunk = records.slice(i, i + BATCH_SIZE);

      await db
        .insert(yappersDerivedAddressActivity)
        .values(chunk)
        .onConflictDoUpdate({
          target: [
            yappersDerivedAddressActivity.yapperid,
            yappersDerivedAddressActivity.address,
            yappersDerivedAddressActivity.jobId,
          ],
          set: {
            value: sql`COALESCE(${yappersDerivedAddressActivity.value}, 0) + COALESCE(EXCLUDED.value, 0)`,
            event: sql`EXCLUDED.event`,
            transactionHash: sql`EXCLUDED.transaction_hash`,
            interacted: sql`EXCLUDED.interacted OR ${yappersDerivedAddressActivity.interacted}`,
            lastUpdated: sql`EXCLUDED.last_updated`,
          },
        });
    }
  }

  return records;
}

export async function getYapperOnchainInvitesData(yapperId: string) {
  try {
    const referrals = await db
      .select({
        names: onchainJobInvites.inviteeXName,
        walletAddresses: onchainJobInvites.inviteeWalletAdress,
      })
      .from(onchainJobInvites)
      .where(eq(onchainJobInvites.yapperProfileId, yapperId));

    return referrals;
  } catch (error: any) {
    console.error(
      "Yap.onchainListener.getYapperOnchainInvitesData.error:",
      error
    );
    return [];
  }
}

export async function getYapperOnchainReward(
  yap: Yap,
  job: Job
): Promise<{ yapperAddress: string; reward: bigint }> {
  try {
    const hierarchy = job.onchainHeirarchy;
    const yapperContribution = await db
      .select({
        interactionCount: sql<number>`
          COUNT(*) FILTER (WHERE ${yappersDerivedAddressActivity.interacted} = true)
        `,
        totalValue: sql<string>`
          COALESCE(SUM(${yappersDerivedAddressActivity.value}), 0)
        `,
      })
      .from(yappersDerivedAddressActivity)
      .where(
        and(
          eq(yappersDerivedAddressActivity.jobId, job.id),
          eq(yappersDerivedAddressActivity.yapperid, yap.yapperid)
        )
      );

    if (!yapperContribution || yapperContribution.length === 0) {
      return { yapperAddress: yap.walletAddress, reward: 0n };
    }

    const contribution = yapperContribution[0];

    let rewardPercentage: number;

    if (hierarchy === "volume") {
      const yapperValue = BigInt(contribution!.totalValue || 0);
      const totalValue = BigInt(job.value || 0);

      if (totalValue === 0n) {
        return { yapperAddress: yap.walletAddress, reward: 0n };
      }

      rewardPercentage = Number((yapperValue * 10000n) / totalValue) / 100;
    } else {
      const yapperInteractions = contribution!.interactionCount || 0;
      const totalInteractions = job.addresses.length || 0;

      if (totalInteractions === 0) {
        return { yapperAddress: yap.walletAddress, reward: 0n };
      }

      rewardPercentage = (yapperInteractions / totalInteractions) * 100;
    }

    const rewardAmount = BigInt(
      Math.floor((rewardPercentage / 100) * job.onchainReward)
    );

    return {
      yapperAddress: yap.walletAddress,
      reward: rewardAmount,
    };
  } catch (error: any) {
    console.error("Yap.onchainListener.getYapperOnchainReward.error:", error);
    return { yapperAddress: yap.walletAddress, reward: 0n };
  }
}
