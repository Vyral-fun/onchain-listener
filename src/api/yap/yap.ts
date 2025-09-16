import type { Yap } from "@/services/yappers";

export async function getYapMarketAddresses(twitterNames: string[]) {
  return [];
}

export async function getJobYaps(jobId: string): Promise<Yap[]> {
  const allYaps: Yap[] = [];
  let page = 1;
  const limit = 10;
  const API_KEY = Bun.env.API_KEY;

  try {
    while (true) {
      const res = await fetch(
        `${process.env.API_BASE_URL}/activator/job/yap/${jobId}?limit=${limit}&page=${page}`,
        {
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${API_KEY ?? ""}`,
          },
        }
      );

      if (!res.ok) {
        throw new Error(
          `Failed to fetch yaps (page ${page}): ${res.statusText}`
        );
      }

      const data = await res.json();

      if (!Array.isArray(data) || data.length === 0) {
        break;
      }

      const mapped = data.map((item: any) => ({
        yapperid: item.yapperProfileId,
        userId: item.yapUserid,
        jobId: item.communityId ?? jobId,
        twitterUsername: item.yapUserUsername,
        walletAddress: item.yapperProfileWalletAddress,
      }));

      allYaps.push(...mapped);

      if (data.length < limit) {
        break;
      }

      page++;
    }
  } catch (err) {
    console.error("getJobYaps error:", err);
    return [];
  }

  return allYaps;
}
