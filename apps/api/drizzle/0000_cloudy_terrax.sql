CREATE TYPE "public"."episode_status" AS ENUM('planned', 'live', 'ended');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('admin', 'producer', 'engineer');--> statement-breakpoint
CREATE TABLE "episodes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"program_id" uuid NOT NULL,
	"title" text NOT NULL,
	"starts_at" timestamp with time zone,
	"status" "episode_status" DEFAULT 'planned' NOT NULL,
	"livekit_room" text NOT NULL,
	"started_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "episodes_livekit_room_unique" UNIQUE("livekit_room")
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"episode_id" uuid,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor" text NOT NULL,
	"type" text NOT NULL,
	"payload" jsonb
);
--> statement-breakpoint
CREATE TABLE "guests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"episode_id" uuid NOT NULL,
	"display_name" text NOT NULL,
	"caspar_name" text,
	"language" text DEFAULT 'ku' NOT NULL,
	"phone" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invites" (
	"token" text PRIMARY KEY NOT NULL,
	"guest_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"max_uses" integer DEFAULT 0 NOT NULL,
	"uses" integer DEFAULT 0 NOT NULL,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "programs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"settings" jsonb NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "slots" (
	"episode_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"guest_id" uuid,
	"output_name" text,
	CONSTRAINT "slots_episode_id_number_pk" PRIMARY KEY("episode_id","number")
);
--> statement-breakpoint
CREATE TABLE "stats_samples" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"episode_id" uuid NOT NULL,
	"identity" text NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"rtt_ms" integer,
	"loss_pct" real,
	"kbps" integer,
	"width" integer,
	"height" integer,
	"fps" real,
	"path" text,
	"relay" boolean
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"role" "user_role" NOT NULL,
	"password_hash" text NOT NULL,
	"disabled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "episodes" ADD CONSTRAINT "episodes_program_id_programs_id_fk" FOREIGN KEY ("program_id") REFERENCES "public"."programs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_episode_id_episodes_id_fk" FOREIGN KEY ("episode_id") REFERENCES "public"."episodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guests" ADD CONSTRAINT "guests_episode_id_episodes_id_fk" FOREIGN KEY ("episode_id") REFERENCES "public"."episodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invites" ADD CONSTRAINT "invites_guest_id_guests_id_fk" FOREIGN KEY ("guest_id") REFERENCES "public"."guests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slots" ADD CONSTRAINT "slots_episode_id_episodes_id_fk" FOREIGN KEY ("episode_id") REFERENCES "public"."episodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slots" ADD CONSTRAINT "slots_guest_id_guests_id_fk" FOREIGN KEY ("guest_id") REFERENCES "public"."guests"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stats_samples" ADD CONSTRAINT "stats_samples_episode_id_episodes_id_fk" FOREIGN KEY ("episode_id") REFERENCES "public"."episodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "episodes_program_idx" ON "episodes" USING btree ("program_id");--> statement-breakpoint
CREATE INDEX "events_episode_at_idx" ON "events" USING btree ("episode_id","at");--> statement-breakpoint
CREATE INDEX "guests_episode_idx" ON "guests" USING btree ("episode_id");--> statement-breakpoint
CREATE INDEX "invites_guest_idx" ON "invites" USING btree ("guest_id");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "sessions_expires_idx" ON "sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "stats_episode_identity_at_idx" ON "stats_samples" USING btree ("episode_id","identity","at");