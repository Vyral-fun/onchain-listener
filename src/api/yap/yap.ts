import type { Yap } from "@/services/yappers";

const YAP_API_URL = Bun.env.YAP_API_URL;
const YAP_API_KEY = Bun.env.YAP_API_KEY;

export async function getYapMarketAddresses(
  twitterNames: string[]
): Promise<string[]> {
  if (twitterNames.length === 0) return [];

  try {
    const res = await fetch(`${YAP_API_URL}/api/yap/onchain/yappers`, {
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${YAP_API_KEY}`,
      },
    });

    if (!res.ok) {
      console.error(
        "getYapMarketAddresses failed:",
        res.status,
        await res.text()
      );
      return [];
    }

    const data: unknown = await res.json();
    if (!Array.isArray(data)) {
      console.warn("getYapMarketAddresses: response was not an array", data);
      return [];
    }

    const walletAddresses = data
      .filter((yapper) => twitterNames.includes(yapper.name))
      .map((yapper) => yapper.walletAddress);

    return walletAddresses;
  } catch (err) {
    console.error("getYapMarketAddresses error:", err);
    return [];
  }
}

export async function getJobYaps(jobId: string): Promise<Yap[]> {
  try {
    const res = await fetch(`${YAP_API_URL}/api/yap/onchain/${jobId}/yappers`, {
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${YAP_API_KEY}`,
      },
    });

    if (!res.ok) {
      console.error("getJobYaps failed:", res.status, await res.text());
      return [];
    }

    const data: unknown = await res.json();

    if (!Array.isArray(data)) {
      console.warn("getJobYaps: response was not an array", data);
      return [];
    }

    return data.map((item: any) => ({
      yapperid: item.yapperId,
      userId: item.userId,
      jobId: item.jobId,
      twitterUsername: item.username,
      walletAddress: item.walletAddress,
    }));
  } catch (err) {
    console.error("getJobYaps error:", err);
    return [];
  }
}
