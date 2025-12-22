import { z } from "zod";

export const envSchema = z.object({
  NODE_ENV: z
    .enum(["development", "production", "preview"])
    .default("development"),
  PORT: z.string({
    required_error: "PORT is required",
  }),
  API_KEY: z.string({
    required_error: "API_KEY is required",
  }),

  YAP_API_URL: z.string({
    required_error: "YAP_API_URL is required",
  }),
  YAP_API_KEY: z.string({
    required_error: "YAP_API_KEY is required",
  }),

  CLIENT_URL: z.string({
    required_error: "CLIENT_URL is required",
  }),

  DATABASE_URL: z.string({
    required_error: "DATABASE_URL is required",
  }),

  REDIS_URL: z.string({
    required_error: "REDIS_URL is required",
  }),

  ALCHEMY_API_KEY: z.string({
    required_error: "ALCHEMY_API_KEY is required",
  }),
  ALCHEMY_BASE_SEPOLIA_KEY: z.string({
    required_error: "ALCHEMY_BASE_SEPOLIA_KEY is required",
  }),
  BASE_SEPOLIA_PROVIDER_URL: z.string({
    required_error: "BASE_SEPOLIA_PROVIDER_URL is required",
  }),
  BASE_SEPOLIA_WS_PROVIDER_URL: z.string({
    required_error: "BASE_SEPOLIA_WS_PROVIDER_URL is required",
  }),
  ALCHEMY_BASE_MAINNET_KEY: z.string({
    required_error: "ALCHEMY_BASE_MAINNET_KEY is required",
  }),
  BASE_MAINNET_PROVIDER_URL: z.string({
    required_error: "BASE_MAINNET_PROVIDER_URL is required",
  }),
  BASE_MAINNET_WS_PROVIDER_URL: z.string({
    required_error: "BASE_MAINNET_WS_PROVIDER_URL is required",
  }),
  ALCHEMY_MONAD_TESTNET_KEY: z.string({
    required_error: "ALCHEMY_MONAD_TESTNET_KEY is required",
  }),
  MONAD_PROVIDER_URL: z.string({
    required_error: "MONAD_PROVIDER_URL is required",
  }),
  MONAD_WS_PROVIDER_URL: z.string({
    required_error: "MONAD_WS_PROVIDER_URL is required",
  }),
  ETHEREUM_PROVIDER_URL: z.string({
    required_error: "ETHEREUM_PROVIDER_URL is required",
  }),
  ETHEREUM_WS_PROVIDER_URL: z.string({
    required_error: "ETHEREUM_WS_PROVIDER_URL is required",
  }),
  ETHEREUM_SEPOLIA_PROVIDER_URL: z.string({
    required_error: "ETHEREUM_SEPOLIA_PROVIDER_URL is required",
  }),
  ETHEREUM_SEPOLIA_WS_PROVIDER_URL: z.string({
    required_error: "ETHEREUM_SEPOLIA_WS_PROVIDER_URL is required",
  }),
  OPT_MAINNET_PROVIDER_URL: z.string({
    required_error: "OPT_MAINNET_PROVIDER_URL is required",
  }),
  OPT_MAINNET_WS_PROVIDER_URL: z.string({
    required_error: "OPT_MAINNET_WS_PROVIDER_URL is required",
  }),
  OPT_SEPOLIA_PROVIDER_URL: z.string({
    required_error: "OPT_SEPOLIA_PROVIDER_URL is required",
  }),
  OPT_SEPOLIA_WS_PROVIDER_URL: z.string({
    required_error: "OPT_SEPOLIA_WS_PROVIDER_URL is required",
  }),
  ARB_MAINNET_PROVIDER_URL: z.string({
    required_error: "ARB_MAINNET_PROVIDER_URL is required",
  }),
  ARB_MAINNET_WS_PROVIDER_URL: z.string({
    required_error: "ARB_MAINNET_WS_PROVIDER_URL is required",
  }),
  ARB_SEPOLIA_PROVIDER_URL: z.string({
    required_error: "ARB_SEPOLIA_PROVIDER_URL is required",
  }),
  ARB_SEPOLIA_WS_PROVIDER_URL: z.string({
    required_error: "ARB_SEPOLIA_WS_PROVIDER_URL is required",
  }),
  BNB_MAINNET_PROVIDER_URL: z.string({
    required_error: "BNB_MAINNET_PROVIDER_URL is required",
  }),
  BNB_MAINNET_WS_PROVIDER_URL: z.string({
    required_error: "BNB_MAINNET_WS_PROVIDER_URL is required",
  }),
  BNB_TESTNET_PROVIDER_URL: z.string({
    required_error: "BNB_TESTNET_PROVIDER_URL is required",
  }),
  BNB_TESTNET_WS_PROVIDER_URL: z.string({
    required_error: "BNB_TESTNET_WS_PROVIDER_URL is required",
  }),

  TWITTER_API_KEY: z.string({
    required_error: "TWITTER_API_KEY is required",
  }),

  BASE_ESCROW_CONTRACT: z.string({
    required_error: "BASE_ESCROW_CONTRACT is required",
  }),
  MONAD_ESCROW_CONTRACT: z.string({
    required_error: "MONAD_ESCROW_CONTRACT is required",
  }),
});

export default function parseEnv() {
  try {
    return envSchema.parse(Bun.env);
  } catch (error) {
    console.error("Invalid environment variables: ", error);
    process.exit(1);
  }
}

export type EnvSchemaType = z.infer<typeof envSchema>;

declare module "bun" {
  interface Env extends EnvSchemaType {}
}
