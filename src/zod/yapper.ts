import { z } from "zod";

export const addYapperReferralSchema = z.object({
  yapperProfileId: z.string().min(21, "yapperProfileId is required"),
  referralCode: z.string().min(10, "referralCode is required"),
  followerUsername: z.string(),
  followerName: z.string(),
  followerProfileImage: z.string().url().optional(),
  followerWalletAddress: z
    .string()
    .min(42, "followerWalletAddress is required"),
});
