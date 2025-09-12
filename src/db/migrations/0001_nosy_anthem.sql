CREATE TABLE "yappers_derived_address_activity" (
	"id" varchar PRIMARY KEY NOT NULL,
	"yapperid" varchar NOT NULL,
	"yapper_user_id" varchar NOT NULL,
	"job_id" varchar NOT NULL,
	"yapper_address" varchar(42) NOT NULL,
	"address" varchar(42) NOT NULL,
	"event" varchar(255),
	"value" numeric,
	"transaction_hash" varchar(66),
	"interacted" boolean DEFAULT false
);
