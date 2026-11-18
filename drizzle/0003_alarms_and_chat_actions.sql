CREATE TABLE "alarms" (
	"id" text PRIMARY KEY NOT NULL,
	"label" text DEFAULT '' NOT NULL,
	"at" timestamp with time zone NOT NULL,
	"dismissed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "chat_messages" ADD COLUMN "actions" text DEFAULT '' NOT NULL;--> statement-breakpoint
CREATE INDEX "alarms_synced_at_idx" ON "alarms" USING btree ("synced_at");--> statement-breakpoint
CREATE INDEX "alarms_at_idx" ON "alarms" USING btree ("at");