CREATE TABLE "yapper_referrals" (
	"id" varchar PRIMARY KEY NOT NULL,
	"yapper_profile_id" varchar NOT NULL,
	"referral_code" varchar NOT NULL,
	"follower_username" varchar NOT NULL,
	"follower_name" varchar NOT NULL,
	"follower_profile_image" varchar,
	"follower_wallet_address" varchar NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "unique_referral_code_follower" ON "yapper_referrals" USING btree ("referral_code","follower_wallet_address");