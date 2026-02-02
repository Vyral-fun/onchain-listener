import {
  decimalsCache,
  runtimeNetworkListeners,
  type ERC20,
} from "@/services/deposit-service";
import { NULL_ADDRESS } from "@/utils/constants";
import { ethers } from "ethers";
import { abi as erc20Abi } from "../src/erc20.json";
import { handleYapRequestCreatedQueue } from "@/services/queue";
import { getEcosystemDetails } from "@/utils/ecosystem";

export async function processBlock(
  chainId: number,
  fromBlock: number,
  toBlock: number
) {
  const { depositRpcUrl, escrowContract, abi } = getEcosystemDetails(chainId);

  const iface = new ethers.Interface(abi);
  const httpProvider = new ethers.JsonRpcProvider(depositRpcUrl);

  const contractAddress = escrowContract;

  try {
    const logs = await httpProvider.getLogs({
      address: contractAddress,
      topics: [
        ethers.id(
          "YapRequestCreated(uint256,address,string,address,uint256,uint256)"
        ),
      ],
      fromBlock,
      toBlock,
    });

    for (const log of logs) {
      try {
        const parsed = iface.parseLog({
          topics: log.topics as string[],
          data: log.data,
        });

        if (parsed?.name === "YapRequestCreated") {
          const { yapId, creator, jobId, asset, budget, fee } = parsed.args;

          let decimals = 18;
          if (asset !== NULL_ADDRESS) {
            try {
              const cached = decimalsCache.get(asset);
              if (cached !== undefined) {
                decimals = cached;
              } else {
                const tokenContract = new ethers.Contract(
                  asset,
                  erc20Abi,
                  httpProvider
                ) as unknown as ERC20;

                decimals = await tokenContract.decimals();
                decimalsCache.set(asset, decimals);
              }
            } catch (error) {
              console.error(
                `[${chainId}] Error fetching decimals for asset ${asset}:`,
                error
              );
            }
          }

          const adjustedBudget = Number(ethers.formatUnits(budget, decimals));
          const adjustedFee = Number(ethers.formatUnits(fee, decimals));

          console.log(
            `[${chainId}] YapRequestCreated event detected for job: ${jobId} from manual script at block ${log.blockNumber}`
          );

          await handleYapRequestCreatedQueue.add(
            "handleYapRequestCreated",
            {
              jobId,
              yapId: Number(yapId),
              adjustedBudget,
              adjustedFee,
              chainId,
              transactionHash: log.transactionHash,
              creator,
              asset,
              blockNumber: log.blockNumber,
            },
            {
              jobId:
                "handleYapRequestCreated" +
                `-${jobId}` +
                `-${yapId}` +
                `-${log.transactionHash}`,
              removeOnComplete: true,
            }
          );
        }
      } catch (parseError) {
        console.error(`[${chainId}] Error parsing log:`, parseError);
      }
    }
  } catch (error) {
    console.error(
      `[${chainId}] Error fetching logs from block ${fromBlock} to ${toBlock}:`,
      error
    );
  }
}
