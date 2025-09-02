import z from "zod";

export const subscribeListenerSchema = z.object({
  contractAddress: z.string().length(42),
  abi: z.any(),
  chainId: z.number(),
  eventsToListenFor: z.array(z.string()).optional(),
});

export const unsubscribeListenerSchema = z.object({
  contractAddress: z.string().length(42),
});
