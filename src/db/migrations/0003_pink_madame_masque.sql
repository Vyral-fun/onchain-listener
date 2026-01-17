CREATE TABLE "listener_state" (
	"chain_id" integer NOT NULL,
	"last_processed_block" bigint NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "yappers_derived_address_activity" DROP COLUMN "last_updated";