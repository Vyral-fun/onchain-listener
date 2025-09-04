ALTER TABLE "contract_events" ALTER COLUMN "sender" SET DEFAULT '0x0000000000000000000000000000000000000000';--> statement-breakpoint
ALTER TABLE "contract_events" ALTER COLUMN "sender" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "contract_events" ALTER COLUMN "receiver" SET DEFAULT '0x0000000000000000000000000000000000000000';--> statement-breakpoint
ALTER TABLE "contract_events" ALTER COLUMN "receiver" DROP NOT NULL;