import { alchemy, NULL_ADDRESS } from "@/utils/constants";
import { AssetTransfersCategory } from "alchemy-sdk";
import { ethers } from "ethers";

export async function getAddressesInteractedWith(address: string) {
  try {
    const outwardTransferData = await alchemy.core.getAssetTransfers({
      fromBlock: "0x0",
      fromAddress: address,
      category: [
        AssetTransfersCategory.ERC20,
        AssetTransfersCategory.EXTERNAL,
        AssetTransfersCategory.ERC721,
        AssetTransfersCategory.ERC1155,
      ],
    });

    const outwardAddresses = [
      ...new Set(
        outwardTransferData.transfers
          .map((t) => t.to)
          .filter((a): a is string => !!a && a !== NULL_ADDRESS)
      ),
    ];

    console.log(
      `${outwardAddresses.length} unique outward addresses:`,
      outwardAddresses
    );

    const inwardTransferData = await alchemy.core.getAssetTransfers({
      fromBlock: "0x0",
      toAddress: address,
      category: [
        AssetTransfersCategory.ERC20,
        AssetTransfersCategory.EXTERNAL,
        AssetTransfersCategory.ERC721,
        AssetTransfersCategory.ERC1155,
      ],
    });

    const inwardAddresses = [
      ...new Set(
        inwardTransferData.transfers
          .map((t) => t.from)
          .filter((a): a is string => !!a && a !== NULL_ADDRESS)
      ),
    ];

    console.log(
      `${inwardAddresses.length} unique inward addresses:`,
      inwardAddresses
    );

    const allAddresses = [
      ...new Set([...outwardAddresses, ...inwardAddresses]),
    ];

    console.log(
      `${allAddresses.length} total unique interacted addresses:`,
      allAddresses
    );

    return { outwardTransferData, inwardTransferData, allAddresses };
  } catch (error) {
    console.error("Error fetching asset transfers:", error);
  }
}

export async function checkENS(
  names: string[],
  rpcUrl: string
): Promise<{ name: string; address: string }[]> {
  const provider = new ethers.JsonRpcProvider(rpcUrl);

  const results: { name: string; address: string }[] = [];
  for (const name of names) {
    if (!name.toLowerCase().endsWith(".eth")) continue;
    try {
      const address = await provider.resolveName(name);
      if (address) {
        console.log(`ENS name ${name} resolves to address: ${address}`);
        results.push({ name, address });
      } else {
        console.log(`ENS name ${name} does not resolve to any address.`);
      }
    } catch (error) {
      console.error("Error resolving ENS name:", error);
    }
  }
  return results;
}
