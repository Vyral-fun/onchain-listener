import z from "zod";

export const subscribeListenerSchema = z.object({
  contractAddress: z.string().length(42),
  abi: z.any(),
  chainId: z.number(),
  eventToListenFor: z.array(z.string()),
  endDate: z
    .preprocess(
      (val) => (typeof val === "string" ? new Date(val) : val),
      z.date({ invalid_type_error: "Invalid date format for endDate" })
    )
    .refine((date) => !isNaN(date.getTime()), {
      message: "endDate must be a valid date",
    }),
});

export const unsubscribeListenerSchema = z.object({
  contractAddress: z.string().length(42),
});
