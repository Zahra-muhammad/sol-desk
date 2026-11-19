CREATE TABLE "saved_articles" (
	"id" text PRIMARY KEY NOT NULL,
	"feed" text NOT NULL,
	"link" text NOT NULL,
	"title" text NOT NULL,
	"subtitle" text DEFAULT '' NOT NULL,
	"author" text DEFAULT '' NOT NULL,
	"source_title" text DEFAULT '' NOT NULL,
	"source_image" text DEFAULT '' NOT NULL,
	"image" text DEFAULT '' NOT NULL,
	"date" text DEFAULT '' NOT NULL,
	"html" text DEFAULT '' NOT NULL,
	"saved_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "saved_articles_saved_at_idx" ON "saved_articles" USING btree ("saved_at");