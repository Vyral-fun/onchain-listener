CREATE TABLE "contract_events" (
	"id" varchar PRIMARY KEY NOT NULL,
	"job_id" varchar(255) NOT NULL,
	"chain_id" integer NOT NULL,
	"contract_address" varchar(42) NOT NULL,
	"event_name" varchar(255),
	"sender" varchar(42) DEFAULT '0x0000000000000000000000000000000000000000',
	"receiver" varchar(42) DEFAULT '0x0000000000000000000000000000000000000000',
	"value" numeric,
	"transaction_hash" varchar(66) NOT NULL,
	"block_number" bigint NOT NULL,
	"detected_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contract_listeners" (
	"contract_address" varchar(42) PRIMARY KEY NOT NULL,
	"chain_id" integer NOT NULL,
	"abi" jsonb NOT NULL,
	"subscribed_jobs" text[] NOT NULL,
	"events_being_listened" text[] NOT NULL,
	"start_time" timestamp DEFAULT now() NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "uq_chain_contract" UNIQUE("chain_id","contract_address")
);
--> statement-breakpoint
CREATE TABLE "job_subscriptions" (
	"job_id" varchar PRIMARY KEY NOT NULL,
	"contract_address" varchar(42) NOT NULL,
	"events_filter" text[],
	"chain_id" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"last_event_at" timestamp,
	"is_active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" varchar PRIMARY KEY NOT NULL,
	"contract_address" varchar(42) NOT NULL,
	"chain_id" integer NOT NULL,
	"events" text[] NOT NULL,
	"event_address" varchar(42)[],
	"abi" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE INDEX "idx_job_detected" ON "contract_events" USING btree ("job_id","detected_at");--> statement-breakpoint
CREATE INDEX "idx_contract_detected" ON "contract_events" USING btree ("contract_address","detected_at");--> statement-breakpoint
CREATE INDEX "idx_sender_receiver" ON "contract_events" USING btree ("sender","receiver");