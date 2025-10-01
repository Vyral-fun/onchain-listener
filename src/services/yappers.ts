import { db } from "@/db";
import { checkENS, getOnchainAddressesInteractedWith } from "./address";
import type { ContractJobEvents } from "./job-service";
import { getTwitterFollowersName } from "../api/twitter/twitter";
import { BATCH_SIZE, NULL_ADDRESS } from "@/utils/constants";
import {
  onchainJobInvites,
  yappersDerivedAddressActivity,
} from "@/db/schema/event";
import { getYapMarketAddresses } from "@/api/yap/yap";
import { eq } from "drizzle-orm";

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
    new Set(allAddresses.filter((a) => a && a !== NULL_ADDRESS))
  );

  const records = filtered.map((addr) => {
    const matchingEvent = contractEvents.find(
      (ev) =>
        ev.sender.toLowerCase() === addr.toLowerCase() ||
        ev.reciever.toLowerCase() === addr.toLowerCase()
    );

    return {
      yapperid: yap.yapperid,
      yapperUserId: yap.userId,
      jobId: matchingEvent?.jobId ?? yap.jobId,
      yapperAddress: yap.walletAddress,
      address: addr,
      event: matchingEvent?.eventName ?? null,
      value: matchingEvent?.value ? BigInt(matchingEvent.value) : null,
      transactionHash: matchingEvent?.transactionHash ?? null,
      interacted: !!matchingEvent,
    };
  });

  if (records.length > 0) {
    for (let i = 0; i < records.length; i += BATCH_SIZE) {
      const chunk = records.slice(i, i + BATCH_SIZE);
      await db.insert(yappersDerivedAddressActivity).values(chunk);
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
