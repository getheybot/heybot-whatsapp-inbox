CREATE INDEX "contacts_last_message_at_id_idx" ON "contacts" USING btree ("last_message_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "conversation_messages_conversation_id_id_idx" ON "conversation_messages" USING btree ("conversation_id","id");--> statement-breakpoint
CREATE INDEX "conversations_contact_id_idx" ON "conversations" USING btree ("contact_id");