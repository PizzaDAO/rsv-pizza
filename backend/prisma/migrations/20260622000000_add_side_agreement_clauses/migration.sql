-- rigatoni-58919: side-event (PizzaDAO conference side-event) agreement clauses.
-- Exact mirror of gpp_agreement_clauses. Seed copy below is PLACEHOLDER —
-- final copy is DB-editable (UPDATE the rows / add a new version + flip active).

CREATE TABLE IF NOT EXISTS "side_agreement_clauses" (
  "id"           UUID         NOT NULL DEFAULT gen_random_uuid(),
  "version"      TEXT         NOT NULL,
  "sort_order"   INTEGER      NOT NULL,
  "heading"      TEXT,
  "body"         TEXT         NOT NULL,
  "requires_ack" BOOLEAN      NOT NULL DEFAULT true,
  "active"       BOOLEAN      NOT NULL DEFAULT true,
  "created_at"   TIMESTAMPTZ  NOT NULL DEFAULT now(),
  "updated_at"   TIMESTAMPTZ  NOT NULL DEFAULT now(),
  CONSTRAINT "side_agreement_clauses_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "side_agreement_clauses_active_version_sort_order_idx"
  ON "side_agreement_clauses" ("active", "version", "sort_order");

-- Placeholder seed clauses (version '1.0'). Final copy is DB-editable.
INSERT INTO "side_agreement_clauses" ("version", "sort_order", "heading", "body", "requires_ack", "active")
VALUES
  (
    '1.0', 1, 'Code of Conduct',
    E'I agree that my side event will:\n- Be **welcoming, safe, and inclusive** for all attendees.\n- Follow the **PizzaDAO community code of conduct** and any rules of the host conference/venue.\n- Have **no tolerance** for harassment, discrimination, or unsafe behavior.',
    true, true
  ),
  (
    '1.0', 2, 'Reimbursement Rules',
    E'I understand that:\n- Only **pizza costs** are eligible for reimbursement, and a **valid receipt** is required.\n- **I will confirm** my approved maximum reimbursement amount before my event is listed.\n- Reimbursement is typically processed within **2–3 weeks**, and at least **~7 days after submission**.',
    true, true
  ),
  (
    '1.0', 3, 'Hosting Requirements',
    E'I understand that:\n- I must provide required event documentation, including **a group photo of attendees, a photo of the pizza box stack, and a photo of the pizza**.\n- **Fraud or dishonest behavior** may result in reimbursement being denied or revoked.',
    true, true
  );
