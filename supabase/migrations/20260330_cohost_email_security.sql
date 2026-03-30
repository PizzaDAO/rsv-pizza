-- Security: Strip co-host emails from public API responses
--
-- Creates a sanitized generated column (co_hosts_public) that removes
-- email, canEdit, and isUnderboss fields from co_hosts JSONB data.
-- Revokes anon/authenticated SELECT on the raw co_hosts column.

-- 1. Create the sanitization function
CREATE OR REPLACE FUNCTION sanitize_co_hosts(hosts jsonb)
RETURNS jsonb AS $$
  SELECT COALESCE(
    jsonb_agg(
      elem - 'email' - 'canEdit' - 'isUnderboss'
    ),
    '[]'::jsonb
  )
  FROM jsonb_array_elements(COALESCE(hosts, '[]'::jsonb)) AS elem;
$$ LANGUAGE sql IMMUTABLE;

-- 2. Add the generated column
ALTER TABLE parties ADD COLUMN co_hosts_public jsonb
  GENERATED ALWAYS AS (sanitize_co_hosts(co_hosts)) STORED;

-- 3. Revoke table-level SELECT (was granted broadly) and re-grant column-level
--    SELECT on all columns EXCEPT co_hosts and password
REVOKE SELECT ON parties FROM anon, authenticated;

GRANT SELECT (
  id, name, invite_code, date, pizza_style, max_guests, rsvp_closed_at,
  created_at, address, available_beverages, duration, event_image_url,
  description, custom_url, end_time, timezone, available_toppings,
  hide_guests, user_id, updated_at, require_approval, venue_name,
  selected_pizzerias, photos_enabled, photos_public, event_type, event_tags,
  budget_total, donation_enabled, donation_goal, donation_message,
  suggested_amounts, donation_recipient, share_to_unlock, share_tweet_text,
  donation_eth_address, fundraising_goal, report_recap, report_video_url,
  report_photos_url, flyer_artist, x_post_url, x_post_views,
  farcaster_post_url, farcaster_views, luma_url, luma_views, poap_event_id,
  poap_mints, poap_moments, report_published, report_public_slug,
  budget_enabled, music_enabled, music_notes, nft_enabled, nft_chain,
  kit_enabled, kit_deadline, photo_moderation, donation_recipient_url,
  pinned_apps, venue_status, venue_capacity, venue_cost, venue_point_person,
  venue_contact_name, venue_contact_email, venue_contact_phone,
  venue_organization, venue_website, venue_notes, region, report_password,
  report_stats_config, flyer_artist_url, venue_report_published,
  venue_report_slug, venue_report_password, venue_report_title,
  venue_report_notes, host_status, underboss_approved, host_tags,
  co_hosts_public
) ON parties TO anon, authenticated;
