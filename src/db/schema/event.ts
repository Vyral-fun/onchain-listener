import { sql } from "drizzle-orm";
import {
  bigint,
  bigserial,
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  varchar,
} from "drizzle-orm/pg-core";
import { nanoid } from "nanoid";

export const contractEvents = pgTable(
  "contract_events",
  {
    id: varchar("id").primaryKey().$defaultFn(nanoid),
    jobId: varchar("job_id", { length: 255 }).notNull(),
    chainId: integer("chain_id").notNull(),
    contractAddress: varchar("contract_address", { length: 42 }).notNull(),
    eventName: varchar("event_name", { length: 255 }),
    sender: varchar("sender", { length: 42 }).default(
      "0x0000000000000000000000000000000000000000"
    ),
    receiver: varchar("receiver", { length: 42 }).default(
      "0x0000000000000000000000000000000000000000"
    ),
    value: numeric("value", { mode: "bigint" }),
    transactionHash: varchar("transaction_hash", { length: 66 }).notNull(),
    blockNumber: bigint("block_number", { mode: "bigint" }).notNull(),
    detectedAt: timestamp("detected_at").defaultNow().notNull(),
  },
  (table) => [
    index("idx_job_detected").on(table.jobId, table.detectedAt),
    index("idx_contract_detected").on(table.contractAddress, table.detectedAt),
    index("idx_sender_receiver").on(table.sender, table.receiver),
  ]
);

export const jobs = pgTable("jobs", {
  id: varchar("id").primaryKey(),
  contractAddress: varchar("contract_address", { length: 42 }).notNull(),
  chainId: integer("chain_id").notNull(),
  events: text("events").array().notNull(),
  eventAddresses: varchar("event_address", { length: 42 }).array(),
  abi: jsonb("abi").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  isActive: boolean("is_active").default(true).notNull(),
});

export const contractListeners = pgTable(
  "contract_listeners",
  {
    contractAddress: varchar("contract_address", { length: 42 }).primaryKey(),
    chainId: integer("chain_id").notNull(),
    abi: jsonb("abi").notNull(),
    subscribedJobs: text("subscribed_jobs").array().notNull(),
    eventsBeingListened: text("events_being_listened").array().notNull(),
    startTime: timestamp("start_time").defaultNow().notNull(),
    isActive: boolean("is_active").default(true).notNull(),
  },
  (table) => [
    unique("uq_chain_contract").on(table.chainId, table.contractAddress),
  ]
);

export const jobSubscriptions = pgTable("job_subscriptions", {
  jobId: varchar("job_id").primaryKey().notNull(),
  contractAddress: varchar("contract_address", { length: 42 }).notNull(),
  eventsFilter: text("events_filter").array(),
  chainId: integer("chain_id").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  lastEventAt: timestamp("last_event_at"),
  isActive: boolean("is_active").default(true).notNull(),
});

export const yappersDerivedAddressActivity = pgTable(
  "yappers_derived_address_activity",
  {
    id: varchar("id").primaryKey().$defaultFn(nanoid),
    yapperid: varchar("yapperid").notNull(),
    yapperUsername: varchar("yapper_username").notNull(),
    yapperUserId: varchar("yapper_user_id").notNull(),
    jobId: varchar("job_id").notNull(),
    yapperAddress: varchar("yapper_address", { length: 42 }).notNull(),
    address: varchar("address", { length: 42 }).notNull(),
    event: varchar("event", { length: 255 }),
    value: numeric("value", { mode: "bigint" }),
    transactionHash: varchar("transaction_hash", { length: 66 }),
    interacted: boolean("interacted").default(false),
    lastUpdated: timestamp("last_updated").defaultNow(),
  },
  (table) => ({
    uniqueYapperAddressJob: unique().on(
      table.yapperid,
      table.address,
      table.jobId
    ),
  })
);

export const onchainJobInvites = pgTable(
  "onchain_job_invites",
  {
    id: varchar("id").primaryKey().$defaultFn(nanoid),
    yapperProfileId: varchar("yapper_profile_id").notNull(),
    inviteeXName: varchar("invitee_x_username"),
    inviteeWalletAdress: varchar("invitee_wallet_address").notNull(),
  },
  (table) => [
    uniqueIndex("unique_yapper_wallet_invite").on(
      table.yapperProfileId,
      table.inviteeWalletAdress
    ),

    uniqueIndex("unique_yapper_xname_invite")
      .on(table.yapperProfileId, table.inviteeXName)
      .where(sql`${table.inviteeXName} IS NOT NULL`),
  ]
);
