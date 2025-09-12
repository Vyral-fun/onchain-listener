import { ECOSYSTEM_DETAILS } from "./constants";
import { Alchemy } from "alchemy-sdk";

const alchemyCache: Record<number, Alchemy> = {};

export function getChainId(ecosystem: string): number {
  const details = ECOSYSTEM_DETAILS.find((eco) => eco.ecosystem === ecosystem);
  if (!details) {
    throw new Error(`No chain id found for ${ecosystem}`);
  }

  return details.chainId;
}

export function getEcosystemDetails(chainId: number) {
  const details = ECOSYSTEM_DETAILS.find((eco) => eco.chainId === chainId);
  if (!details) {
    throw new Error(`No ecosystem found for chainId ${chainId}`);
  }
  return details;
}

export function getAlchemyInstance(chainId: number): Alchemy {
  if (!alchemyCache[chainId]) {
    const details = ECOSYSTEM_DETAILS.find((eco) => eco.chainId === chainId);
    if (!details) {
      throw new Error(`No Alchemy configuration found for chainId ${chainId}`);
    }

    alchemyCache[chainId] = new Alchemy({
      apiKey: details.apiKey,
      network: details.network,
    });
  }
  return alchemyCache[chainId];
}
