CREATE TABLE "contacts" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"bsuid" varchar(128),
	"phone" numeric(20, 0),
	"username" varchar(35),
	"name" varchar(255),
	"last_message_at" timestamp (0),
	"created_at" timestamp (0),
	"updated_at" timestamp (0),
	CONSTRAINT "contacts_phone_unsigned" CHECK ("contacts"."phone" >= 0 AND "contacts"."phone" <= 18446744073709551615)
);
