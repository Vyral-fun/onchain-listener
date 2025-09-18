import type { Context } from "hono";
import { eq } from "drizzle-orm";
import { db } from "../../db";
import { onchainJobInvites } from "@/db/schema/event";
import z from "zod";
import { joinOnchainInviteSchema } from "@/zod/yapper";

export async function joinOnchainInvite(c: Context) {
  const yapperProfileId = c.req.param("yapperId");
  const validateParams = z
    .string()
    .min(21, { message: "Yapper id is required." })
    .safeParse(yapperProfileId);
  if (!validateParams.success) {
    return c.json({ error: validateParams.error.message }, 400);
  }

  try {
    const body = await c.req.json();
    const { referralCode, name, walletAddress } = body;

    const parsed = joinOnchainInviteSchema.safeParse(body);
    if (!parsed.success) {
      return c.json(
        { error: "Validation failed", details: parsed.error.message },
        400
      );
    }

    const [invite] = await db
      .insert(onchainJobInvites)
      .values({
        yapperProfileId,
        referralCode,
        inviteeXName: name,
        inviteeWalletAdress: walletAddress,
      })
      .returning();

    return c.json({ success: true, invite }, 201);
  } catch (error: any) {
    console.error("Yap.onchainListener.joinOnchainInvite.error:", error);
    return c.json({ error: "Internal server error" }, 500);
  }
}

export async function getYapperOnchainInvites(c: Context) {
  try {
    const yapperId = c.req.param("yapperId");
    const validateProfileId = z
      .string({
        message: "ProfileId is required",
      })
      .length(21, {
        message: "Invalid profileId",
      })
      .safeParse(yapperId);

    if (!validateProfileId.success) {
      return c.json({ error: "Invalid profileId" }, 400);
    }

    const invites = await db
      .select()
      .from(onchainJobInvites)
      .where(eq(onchainJobInvites.yapperProfileId, yapperId));

    return c.json({ success: true, invites }, 200);
  } catch (error: any) {
    console.error("Yap.onchainListener.getYapperOnchainInvites.error:", error);
    return c.json({ error: "Internal server error" }, 500);
  }
}
