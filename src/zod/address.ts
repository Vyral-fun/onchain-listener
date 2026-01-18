import z from "zod";

export const walletAddressSchema = z.object({
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
