CREATE TYPE "public"."conversation_mode" AS ENUM('human', 'agent', 'flow', 'workflow', 'other');
--> statement-breakpoint
CREATE TYPE "public"."conversation_status" AS ENUM('open', 'close');
--> statement-breakpoint
CREATE TABLE "conversations" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"contact_id" bigint NOT NULL,
	"mode" "conversation_mode" DEFAULT 'human' NOT NULL,
	"status" "conversation_status" NOT NULL,
	"unread" bigint DEFAULT 0 NOT NULL,
	"last_message_at" timestamp (0),
	"closed_at" timestamp (0),
	"created_at" timestamp (0),
	"updated_at" timestamp (0),
	CONSTRAINT "conversations_unread_unsigned" CHECK ("conversations"."unread" >= 0 AND "conversations"."unread" <= 4294967295)
);
--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;
