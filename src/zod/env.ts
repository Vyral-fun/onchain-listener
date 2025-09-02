import { z } from "zod";

export const envSchema = z.object({
  NODE_ENV: z
    .enum(["development", "production", "preview"])
    .default("development"),
  CLIENT_URL: z.url({
    message: "CLIENT_URL must be a valid URL",
  }),
  PORT: z.string().min(1, { message: "PORT is required" }),

  API_KEY: z.string().min(1, { message: "API_KEY is required" }),

  POSTGRES_USER: z.string().min(1, { message: "POSTGRES_USER is required" }),
  POSTGRES_PASSWORD: z
    .string()
    .min(1, { message: "POSTGRES_PASSWORD is required" }),
  POSTGRES_DB: z.string().min(1, { message: "POSTGRES_DB is required" }),
  DATABASE_URL: z.string().min(1, { message: "DATABASE_URL is required" }),

  MONAD_PROVIDER_URL: z.url({
    message: "MONAD_PROVIDER_URL must be a valid URL",
  }),

  ALCHEMY_API_KEY: z
    .string()
    .min(1, { message: "ALCHEMY_API_KEY is required" }),

  AWS_SECRETS_MANAGER_SECRET_NAME: z
    .string()
    .min(1, { message: "AWS_SECRETS_MANAGER_SECRET_NAME is required" }),
  AWS_KMS_REGION: z.string().min(1, { message: "AWS_KMS_REGION is required" }),
  AWS_KMS_ACCESS_KEY: z
    .string()
    .min(1, { message: "AWS_KMS_ACCESS_KEY is required" }),
  AWS_KMS_ACCESS_SECRET: z
    .string()
    .min(1, { message: "AWS_KMS_ACCESS_SECRET is required" }),

  AWS_BUCKET_NAME: z
    .string()
    .min(1, { message: "AWS_BUCKET_NAME is required" }),
  AWS_BUCKET_REGION: z
    .string()
    .min(1, { message: "AWS_BUCKET_REGION is required" }),
  AWS_ACCESS_KEY: z.string().min(1, { message: "AWS_ACCESS_KEY is required" }),
  AWS_ACCESS_SECRET: z
    .string()
    .min(1, { message: "AWS_ACCESS_SECRET is required" }),
  AWS_CLOUDFRONT_URL: z.url({
    message: "AWS_CLOUDFRONT_URL must be a valid URL",
  }),

  VENICE_BASE_URL: z.url({ message: "VENICE_BASE_URL must be a valid URL" }),

  PROVIDER_URL: z.url({
    message: "PROVIDER_URL must be a valid WebSocket or RPC URL",
  }),
  ESCROW_CONTRACT: z
    .string()
    .min(1, { message: "ESCROW_CONTRACT is required" }),

  MONAD_ESCROW_CONTRACT: z
    .string()
    .min(1, { message: "MONAD_ESCROW_CONTRACT is required" }),
});

export default function parseEnv() {
  try {
    envSchema.parse(Bun.env);
  } catch (error) {
    console.error("Invalid environment variables: ", error);
    process.exit(1);
  }
}

export type EnvSchemaType = z.infer<typeof envSchema>;

declare module "bun" {
  interface Env extends EnvSchemaType {}
}
