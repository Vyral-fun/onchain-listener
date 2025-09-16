import { db } from "@/db";
import { NULL_ADDRESS } from "@/utils/constants";
import { getAlchemyInstance, getEcosystemDetails } from "@/utils/ecosystem";
import { AssetTransfersCategory } from "alchemy-sdk";
import { Interface } from "ethers";
import { ethers } from "ethers";
import { getAddress } from "viem";

export async function getOnchainAddressesInteractedWith(
  address: string,
  chainId: number
) {
  try {
    const alchemy = getAlchemyInstance(chainId);

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
    return {
      outwardTransferData: { transfers: [] },
      inwardTransferData: { transfers: [] },
      allAddresses: [] as string[],
    };
  }
}

export async function checkENS(
  names: string[]
): Promise<{ name: string; address: string }[]> {
  const results: { name: string; address: string }[] = [];

  const allENSNames = new Set<string>();
  for (const name of names) {
    const extractedNames = extractENSNames(name);
    extractedNames.forEach((ensName) => allENSNames.add(ensName));
  }

  const resolutionPromises = Array.from(allENSNames).map(async (ensName) => {
    try {
      const address = getAddress(ensName);
      return address ? { name: ensName, address } : null;
    } catch (error) {
      console.error(`Error resolving ${ensName}:`, error);
      return null;
    }
  });

  const settled = await Promise.allSettled(resolutionPromises);

  return settled
    .filter(
      (
        r
      ): r is PromiseFulfilledResult<{
        name: string;
        address: `0x${string}`;
      }> => r.status === "fulfilled" && r.value !== null
    )
    .map((r) => r.value);
}

export function hasEvent(
  eventName: string,
  contractAddress: string,
  abi: any
): boolean {
  const { rpcUrl } = getEcosystemDetails(84532);
  const provider = new ethers.JsonRpcProvider(rpcUrl);

  const contract = new ethers.Contract(contractAddress, abi, provider);

  try {
    const event = contract.interface.getEvent(eventName);
    if (!event) {
      console.log(`Event ${eventName} not found in contract ABI.`);
      return false;
    }
    console.log(`Event ${eventName} found in contract ABI:`, event);
    return !!event;
  } catch (err) {
    console.error("Event not found:", err);
    return false;
  }
}

export function getAllEvents(abi: any) {
  const iface = new Interface(abi);
  return iface.fragments.filter((f) => f.type === "event");
}

export function getAllFunctions(abi: any) {
  const iface = new Interface(abi);
  return iface.fragments.filter((f) => f.type === "function");
}

function extractENSNames(text: string): string[] {
  const ensNames: string[] = [];

  const ensTlds = [".eth", ".base.eth"];

  for (const tld of ensTlds) {
    const regex = new RegExp(
      `([a-zA-Z0-9][a-zA-Z0-9-]*[a-zA-Z0-9]*\\${tld.replace(".", "\\.")})`,
      "gi"
    );
    const matches = text.match(regex);

    if (matches) {
      ensNames.push(...matches.map((match) => match.toLowerCase()));
    }
  }

  return [...new Set(ensNames)];
}
