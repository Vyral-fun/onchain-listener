import { YAP_API_KEY, YAP_API_URL } from "@/utils/constants";

export async function handleYapRequestCreated(
  jobId: string,
  yapId: number,
  totalBudget: number,
  fee: number,
  chainId: number,
  txHash: string,
  creator: string,
  asset: string,
  blockNumber: number
) {
  try {
    const formData = new FormData();
    formData.append("escrowYapId", String(yapId));
    formData.append("totalBudget", String(totalBudget));
    formData.append("fee", String(fee));
    formData.append("chainId", String(chainId));
    formData.append("txHash", txHash);
    formData.append("creatorWalletAddress", creator);
    formData.append("assetContractAddress", asset);

    const res = await fetch(`${YAP_API_URL}/api/yap/job/${jobId}/deposit`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${YAP_API_KEY}`,
      },
      body: JSON.stringify({
        escrowYapId: Number(yapId),
        totalBudget: Number(totalBudget),
        fee: Number(fee),
        chainId,
        txHash,
        creatorWalletAddress: creator,
        assetContractAddress: asset,
      }),
    });

    if (!res.ok) {
      console.error(
        "handleYapRequestCreated failed:",
        res.status,
        await res.text()
      );
      return;
    }

    console.log(
      `[${chainId}] Successfully processed YapRequestCreated for jobId: ${jobId} at block ${blockNumber}`
    );
  } catch (err) {
    console.error("handleYapRequestCreated error:", err);
  }
}
