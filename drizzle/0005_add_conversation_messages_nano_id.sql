ALTER TABLE "conversation_messages" ADD COLUMN "nano_id" varchar(21);--> statement-breakpoint
CREATE INDEX "conversation_messages_nano_id_idx" ON "conversation_messages" USING btree ("nano_id");