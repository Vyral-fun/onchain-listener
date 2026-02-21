const RAW_TOKEN_DECIMALS: Record<string, number> = {
  "295:0x0000000000000000000000000000000000000000": 8,
  "296:0x0000000000000000000000000000000000000000": 8,
  "84532:0x0000000000000000000000000000000000000000": 18,
  "84532:0xd311E0ccC2E34d636c5e32853ab5Bd8aF5dB0050": 18,
  "84532:0xf1966A1d1a6098c80341f38DCE1a54F8D67e8c87": 18,
  "84532:0x38E084778b69C65d2de43B44F04E2C1391a16c61": 18,
  "84532:0x1F54F51D1B172bF8C66C5c6dB11265FFea342cA5": 18,
  "8453:0x0000000000000000000000000000000000000000": 18,
  "8453:0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913": 6,
  "8453:0x98d0baa52b2D063E780DE12F615f963Fe8537553": 18,
  "10143:0x0000000000000000000000000000000000000000": 18,
  "143:0x0000000000000000000000000000000000000000": 18,
};

export const TOKEN_DECIMALS: Record<string, number> = Object.fromEntries(
  Object.entries(RAW_TOKEN_DECIMALS).map(([key, value]) => [
    key.toLowerCase(),
    value,
  ])
);

export function getTokenKey(chainId: number, address: string): string {
  return `${chainId}:${address.toLowerCase()}`;
}

export function getTokenDecimals(chainId: number, address: string): number {
  const decimal = TOKEN_DECIMALS[getTokenKey(chainId, address)];
  if (decimal === undefined) {
    throw new Error(
      `Decimals not found for token ${address} on chain ${chainId}`
    );
  }

  return decimal;
}
