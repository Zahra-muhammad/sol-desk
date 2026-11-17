CREATE TABLE "time_entries" (
	"id" text PRIMARY KEY NOT NULL,
	"label" text DEFAULT '' NOT NULL,
	"project" text,
	"started_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "time_entries_project_check" CHECK ("time_entries"."project" is null or "time_entries"."project" in ('p1', 'p2'))
);
--> statement-breakpoint
CREATE INDEX "time_entries_synced_at_idx" ON "time_entries" USING btree ("synced_at");--> statement-breakpoint
CREATE INDEX "time_entries_started_at_idx" ON "time_entries" USING btree ("started_at");