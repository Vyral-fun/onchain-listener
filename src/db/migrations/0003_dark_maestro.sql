ALTER TABLE "contract_events" ALTER COLUMN "event_name" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "contract_events" ALTER COLUMN "value" SET DATA TYPE numeric;