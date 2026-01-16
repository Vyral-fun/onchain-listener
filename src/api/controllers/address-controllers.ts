import { sql } from "drizzle-orm";
import { db } from "@/db";
import type { Context } from "hono";
import { contractEvents } from "@/db/schema/event";
import { startsWith } from "zod/v4";
import { walletAddressSchema } from "@/zod/address";

export async function getAddressInteractions(c: Context) {
  try {
    const body = await c.req.json();

    const parsed = walletAddressSchema.safeParse(body);
    if (!parsed.success) {
      return c.json(
        { error: "Validation failed", details: parsed.error.message },
        400
      );
    }

    const { walletAddress } = parsed.data;
    const address = walletAddress.toLowerCase();

    const result = await db.execute(sql`
      SELECT
        COUNT(*) FILTER (
          WHERE ${contractEvents.detectedAt} >= NOW() - INTERVAL '7 days'
        )  AS "last7days",
  
        COUNT(*) FILTER (
          WHERE ${contractEvents.detectedAt} >= NOW() - INTERVAL '30 days'
        ) AS "last30days",
  
        COUNT(*) FILTER (
          WHERE ${contractEvents.detectedAt} >= NOW() - INTERVAL '90 days'
        ) AS "last90days",
  
        COUNT(*) FILTER (
          WHERE ${contractEvents.detectedAt} >= NOW() - INTERVAL '180 days'
        ) AS "last180days",
  
        COUNT(*) FILTER (
          WHERE ${contractEvents.detectedAt} >= NOW() - INTERVAL '365 days'
        ) AS "last365days"
      FROM ${contractEvents}
      WHERE LOWER(${contractEvents.sender}) = ${address}
    `);

    const row = result[0] ?? {
      last7days: 0,
      last30days: 0,
      last90days: 0,
      last180days: 0,
      last365days: 0,
    };

    return c.json(
      {
        success: true,
        last7Days: Number(row.last7days),
        last30Days: Number(row.last30days),
        last90Days: Number(row.last90days),
        last180Days: Number(row.last180days),
        last365Days: Number(row.last365days),
      },
      200
    );
  } catch (error: any) {
    console.error("Yap.onchainListener.getAddressInteractions.error:", error);
    return c.json({ error: "Internal server error" }, 500);
  }
}
