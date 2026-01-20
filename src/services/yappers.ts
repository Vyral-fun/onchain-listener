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
import { and, eq, inArray, sql } from "drizzle-orm";

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

  const filteredSet = new Set(filtered);
  const relevantEvents = contractEvents.filter((event) =>
    filteredSet.has(event.sender.toLowerCase())
  );

  const eventsByAddress = new Map<string, ContractJobEvents[]>();

  for (const event of relevantEvents) {
    const sender = event.sender.toLowerCase();

    if (!eventsByAddress.has(sender)) {
      eventsByAddress.set(sender, []);
    }

    eventsByAddress.get(sender)?.push(event);
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
      yapperAddress: yap.walletAddress.toLowerCase(),
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
            value: sql`EXCLUDED.value`,
            event: sql`EXCLUDED.event`,
            transactionHash: sql`EXCLUDED.transaction_hash`,
            interacted: sql`EXCLUDED.interacted OR ${yappersDerivedAddressActivity.interacted}`,
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
): Promise<{ yapperAddress: string; yapperId: string; reward: number }> {
  try {
    const hierarchy = job.onchainHeirarchy;

    const yapperAffiliates = await db
      .select({
        address: onchainJobInvites.inviteeWalletAdress,
      })
      .from(onchainJobInvites)
      .where(eq(onchainJobInvites.yapperProfileId, yap.yapperid));

    const affiliateAddresses = Array.from(
      new Set([
        ...yapperAffiliates.map((a) => a.address.toLowerCase()),
        yap.walletAddress.toLowerCase(),
      ])
    );

    if (affiliateAddresses.length === 0) {
      return {
        yapperAddress: yap.walletAddress,
        yapperId: yap.yapperid,
        reward: 0,
      };
    }

    const subquery = db
      .select({
        address: yappersDerivedAddressActivity.address,
        transactionHash: yappersDerivedAddressActivity.transactionHash,
        value: sql<string>`SUM(${yappersDerivedAddressActivity.value})`.as(
          "value"
        ),
      })
      .from(yappersDerivedAddressActivity)
      .where(
        and(
          eq(yappersDerivedAddressActivity.jobId, job.id),
          eq(yappersDerivedAddressActivity.yapperid, yap.yapperid),
          eq(yappersDerivedAddressActivity.interacted, true),
          inArray(
            sql`LOWER(${yappersDerivedAddressActivity.address})`,
            affiliateAddresses
          )
        )
      )
      .groupBy(
        yappersDerivedAddressActivity.address,
        yappersDerivedAddressActivity.transactionHash
      )
      .as("sub");

    const yapperContribution = await db
      .select({
        interactionCount: sql<number>`COUNT(*)`,
        totalValue: sql<string>`COALESCE(SUM(${subquery.value}), 0)`,
      })
      .from(subquery);

    if (
      !yapperContribution ||
      yapperContribution.length === 0 ||
      !yapperContribution[0]
    ) {
      return {
        yapperAddress: yap.walletAddress,
        yapperId: yap.yapperid,
        reward: 0,
      };
    }

    const contribution = yapperContribution[0];
    let rewardAmount: number;

    if (hierarchy === "volume") {
      const yapperValue = BigInt(contribution.totalValue || 0);
      const totalValue = job.value;

      if (totalValue === 0n) {
        return {
          yapperAddress: yap.walletAddress,
          yapperId: yap.yapperid,
          reward: 0,
        };
      }

      const proportion = Number(yapperValue) / Number(totalValue);
      rewardAmount = proportion * job.onchainReward;
    } else {
      const yapperInteractions = contribution.interactionCount || 0;
      const totalInteractions = job.totalInteractions || 0;

      if (totalInteractions === 0) {
        return {
          yapperAddress: yap.walletAddress,
          yapperId: yap.yapperid,
          reward: 0,
        };
      }

      const proportion = yapperInteractions / totalInteractions;
      rewardAmount = proportion * job.onchainReward;
    }

    return {
      yapperAddress: yap.walletAddress,
      yapperId: yap.yapperid,
      reward: rewardAmount,
    };
  } catch (error: any) {
    console.error("Yap.onchainListener.getYapperOnchainReward.error:", error);
    return {
      yapperAddress: yap.walletAddress,
      yapperId: yap.yapperid,
      reward: 0,
    };
  }
}
