-- CreateTable
CREATE TABLE "rsvp_funnel_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "party_id" UUID NOT NULL,
    "step" TEXT NOT NULL,
    "visitor_hash" TEXT NOT NULL,
    "ip_address" TEXT,
    "user_agent" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rsvp_funnel_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "rsvp_funnel_events_party_id_visitor_hash_step_key" ON "rsvp_funnel_events"("party_id", "visitor_hash", "step");

-- AddForeignKey
ALTER TABLE "rsvp_funnel_events" ADD CONSTRAINT "rsvp_funnel_events_party_id_fkey" FOREIGN KEY ("party_id") REFERENCES "parties"("id") ON DELETE CASCADE ON UPDATE CASCADE;
