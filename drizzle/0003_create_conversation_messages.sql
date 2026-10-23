CREATE TYPE "public"."message_direction" AS ENUM('inbound', 'outbound');
--> statement-breakpoint
CREATE TABLE "conversation_messages" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"wamid" varchar(255) NOT NULL,
	"conversation_id" bigint NOT NULL,
	"direction" "message_direction" NOT NULL,
	"message_type" varchar(30) NOT NULL,
	"delivery_status" varchar(30) NOT NULL,
	"content" json NOT NULL,
	"event_at" timestamp (0),
	"created_at" timestamp (0),
	"updated_at" timestamp (0)
);
--> statement-breakpoint
ALTER TABLE "conversation_messages" ADD CONSTRAINT "conversation_messages_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "conversation_messages_wamid_idx" ON "conversation_messages" USING btree ("wamid");
