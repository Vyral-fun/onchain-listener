// src/api/controllers/referrals.ts
import type { Context } from "hono";
import { eq } from "drizzle-orm";
import { db } from "../../db";
import { yapperReferrals } from "@/db/schema/event";
import z from "zod";
import { addYapperReferralSchema } from "@/zod/yapper";

export async function addYapperReferral(c: Context) {
  try {
    const body = await c.req.json();
    const {
      yapperProfileId,
      referralCode,
      followerUsername,
      followerName,
      followerProfileImage,
      followerWalletAddress,
    } = body;

    const parsed = addYapperReferralSchema.safeParse(body);
    if (!parsed.success) {
      return c.json(
        { error: "Validation failed", details: parsed.error.flatten() },
        400
      );
    }

    const referralData = parsed.data;

    const [referral] = await db
      .insert(yapperReferrals)
      .values({
        yapperProfileId,
        referralCode,
        followerUsername,
        followerName,
        followerProfileImage,
        followerWalletAddress,
      })
      .returning();

    return c.json({ success: true, referral }, 201);
  } catch (error: any) {
    console.error("Yap.onchainListener.addYapperReferral.error:", error);
    return c.json({ error: "Internal server error" }, 500);
  }
}

export async function getYapperReferrals(c: Context) {
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

    const referrals = await db
      .select()
      .from(yapperReferrals)
      .where(eq(yapperReferrals.yapperProfileId, yapperId));

    return c.json({ success: true, referrals }, 200);
  } catch (error: any) {
    console.error("Yap.onchainListener.getYapperReferrals.error:", error);
    return c.json({ error: "Internal server error" }, 500);
  }
}
