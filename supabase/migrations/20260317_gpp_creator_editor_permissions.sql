-- Grant editor permissions to GPP event creators
-- Updates existing GPP events to set canEdit: true on the co-host entry
-- whose email matches the event creator's email
UPDATE parties p
SET co_hosts = (
  SELECT jsonb_agg(
    CASE
      WHEN lower(elem->>'email') = lower(u.email)
      THEN elem || '{"canEdit": true}'::jsonb
      ELSE elem
    END
    ORDER BY idx
  )
  FROM jsonb_array_elements(p.co_hosts) WITH ORDINALITY AS arr(elem, idx)
  JOIN users u ON u.id = p.user_id
)
WHERE p.event_type = 'gpp'
AND p.co_hosts IS NOT NULL
AND p.user_id IS NOT NULL;
