import { z } from "zod";

export const joinOnchainInviteSchema = z.object({
  username: z
    .string()
    .min(1, { message: "Username is required." })
    .max(50, { message: "Username must be at most 50 characters long." })
    .optional(),
  walletAddress: z
    .string()
    .refine(
      (val) =>
        val.startsWith("0x") &&
        val.length === 42 &&
        /^[0-9a-fA-F]+$/.test(val.slice(2)),
      {
        message:
          "Invalid wallet address. Must start with 0x and contain 40 hex characters.",
      }
    ),
});

export const YapSchema = z.object({
  yapperid: z.string().length(21, {
    message: "yapper id must be 21 characters long",
  }),
  userId: z.string(),
  jobId: z.string().length(21, {
    message: "Job id must be 21 characters long",
  }),
  twitterUsername: z
    .string()
    .min(1, { message: "Twitter username is required." })
    .max(15, {
      message: "Twitter username must be at most 15 characters long.",
    }),
  walletAddress: z
    .string()
    .refine(
      (val) =>
        val.startsWith("0x") &&
        val.length === 42 &&
        /^[0-9a-fA-F]+$/.test(val.slice(2)),
      {
        message:
          "Invalid wallet address. Must start with 0x and contain 40 hex characters.",
      }
    ),
});

export const JobOnchainRewardBodySchema = z.object({
  onchainHeirarchy: z.enum(["volume", "walletCount"]),
  onchainReward: z.number({ message: "onchainReward must be a number" }),
  yaps: z.array(YapSchema).min(1, "At least one yap is required"),
});
