DROP INDEX "unique_onchain_job_invitees_referral_code_inviteeXName";--> statement-breakpoint
DROP INDEX "unique_onchain_job_invitees_yapper_profile_id_inviteeXName";--> statement-breakpoint
ALTER TABLE "onchain_job_invites" ADD COLUMN "invitee_x_username" varchar;--> statement-breakpoint
CREATE UNIQUE INDEX "unique_yapper_wallet_invite" ON "onchain_job_invites" USING btree ("yapper_profile_id","invitee_wallet_address");--> statement-breakpoint
CREATE UNIQUE INDEX "unique_yapper_xname_invite" ON "onchain_job_invites" USING btree ("yapper_profile_id","invitee_x_username") WHERE "onchain_job_invites"."invitee_x_username" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "onchain_job_invites" DROP COLUMN "referral_code";--> statement-breakpoint
ALTER TABLE "onchain_job_invites" DROP COLUMN "initee_x_username";