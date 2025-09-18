CREATE TABLE "onchain_job_invites" (
	"id" varchar PRIMARY KEY NOT NULL,
	"yapper_profile_id" varchar NOT NULL,
	"referral_code" varchar NOT NULL,
	"initee_x_username" varchar NOT NULL,
	"invitee_wallet_address" varchar NOT NULL
);
--> statement-breakpoint
DROP TABLE "yapper_referrals" CASCADE;--> statement-breakpoint
CREATE UNIQUE INDEX "unique_onchain_job_invitees_referral_code_inviteeXName" ON "onchain_job_invites" USING btree ("referral_code","initee_x_username");--> statement-breakpoint
CREATE UNIQUE INDEX "unique_onchain_job_invitees_yapper_profile_id_inviteeXName" ON "onchain_job_invites" USING btree ("yapper_profile_id","initee_x_username");