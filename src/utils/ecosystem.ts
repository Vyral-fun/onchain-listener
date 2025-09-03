import { ECOSYSTEM_DETAILS } from "./constants";

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
