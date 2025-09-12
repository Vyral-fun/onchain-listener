import { db } from "@/db";
import { checkENS, getAddressesInteractedWith } from "./address";
import type { ContractJobEvents } from "./job-service";
import { getTwitterFollowersName } from "./twitter";
import { BATCH_SIZE, NULL_ADDRESS } from "@/utils/constants";
import { yappersDerivedAddressActivity } from "@/db/schema/event";

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

  const [ensResults, onchainAddresses, yapMarketAddresses] = await Promise.all([
    checkENS(twitterFollowersNames),
    getAddressesInteractedWith(yap.walletAddress, chainId),
    getYapMarketAddresses(twitterFollowersNames),
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
    ...(twitterAddresses || []),
    ...(addressesData.allAddresses || []),
    ...(yapMarketAddresses || []),
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

export async function getYapMarketAddresses(twitterNames: string[]) {
  return [];
}

export async function getJobYaps(jobId: string): Promise<Yap[]> {
  return [];
}
