import { z } from "zod";

export const joinOnchainInviteSchema = z.object({
  referralCode: z.string().min(10, "referralCode is required"),
  name: z
    .string()
    .min(1, { message: "Username is required." })
    .max(50, { message: "Username must be at most 50 characters long." }),
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
