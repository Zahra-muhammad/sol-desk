CREATE TABLE "feed_sources" (
	"id" text PRIMARY KEY NOT NULL,
	"url" text NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"site" text DEFAULT '' NOT NULL,
	"image" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "feed_sources_url_idx" ON "feed_sources" USING btree ("url");