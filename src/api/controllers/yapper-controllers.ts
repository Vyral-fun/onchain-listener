import type { Context } from "hono";
import { and, eq, or } from "drizzle-orm";
import { db } from "../../db";
import { onchainJobInvites } from "@/db/schema/event";
import z from "zod";
import { joinOnchainInviteSchema } from "@/zod/yapper";
import { checkRefereeWalletAddress } from "../yap/yap";

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
    const { username, walletAddress } = body;

    const parsed = joinOnchainInviteSchema.safeParse(body);
    if (!parsed.success) {
      return c.json(
        { error: "Validation failed", details: parsed.error.message },
        400
      );
    }

    const existingInvite = await db
      .select()
      .from(onchainJobInvites)
      .where(
        eq(onchainJobInvites.inviteeWalletAdress, walletAddress.toLowerCase())
      )
      .limit(1);

    if (existingInvite.length > 0) {
      return c.json({ error: "User has already been referred" }, 400);
    }

    if (username && username.length > 0) {
      const existingUsername = await db
        .select()
        .from(onchainJobInvites)
        .where(eq(onchainJobInvites.inviteeXName, username))
        .limit(1);

      if (existingUsername.length > 0) {
        return c.json({ error: "Username has already been referred" }, 400);
      }
    }

    const isYapper = await checkRefereeWalletAddress(walletAddress);
    if (isYapper) {
      return c.json(
        { error: "The referred wallet address is already a Yapper." },
        400
      );
    }

    const [invite] = await db
      .insert(onchainJobInvites)
      .values({
        yapperProfileId,
        inviteeXName: username,
        inviteeWalletAdress: walletAddress.toLowerCase(),
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

export async function getOnchainInviteByWallet(c: Context) {
  try {
    const walletAddress = c.req.param("walletAddress");
    const validateWallet = z
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
      )
      .safeParse(walletAddress);

    if (!validateWallet.success) {
      return c.json({ error: "Invalid wallet address" }, 400);
    }

    const invites = await db
      .select()
      .from(onchainJobInvites)
      .where(
        eq(onchainJobInvites.inviteeWalletAdress, walletAddress.toLowerCase())
      );

    return c.json(invites, 200);
  } catch (error: any) {
    console.error("Yap.onchainListener.getOnchainInviteByWallet.error:", error);
    return c.json({ error: "Internal server error" }, 500);
  }
}
