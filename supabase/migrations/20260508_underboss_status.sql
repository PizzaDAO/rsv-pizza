-- Replace boolean underboss_approved with tri-state underboss_status
-- Phase 1: Add new column, backfill, re-issue GRANTs (keep old column for transition)

-- 1. Add the new column
ALTER TABLE parties ADD COLUMN underboss_status text DEFAULT 'pending';

-- 2. Backfill from the existing boolean column
UPDATE parties
SET underboss_status = CASE
  WHEN underboss_approved = true THEN 'approved'
  ELSE 'pending'
END;

-- 3. Re-issue column-level GRANTs to include underboss_status
--    (keep underboss_approved for Phase 2 cleanup)
--    IMPORTANT: This list must include ALL columns that SAFE_PARTY_COLUMNS selects
REVOKE SELECT ON parties FROM anon, authenticated;

GRANT SELECT (
  id, name, invite_code, custom_url, date, duration, end_time, timezone,
  pizza_style, available_beverages, available_toppings, available_dietary_options,
  max_guests, expected_guests, hide_guests, require_approval, venue_name,
  selected_pizzerias, event_image_url, description, address, latitude, longitude,
  country, rsvp_closed_at, co_hosts_public, created_at, updated_at, user_id,
  donation_enabled, donation_goal, donation_message, suggested_amounts,
  donation_recipient, donation_recipient_url, donation_eth_address,
  share_to_unlock, share_tweet_text, nft_enabled, nft_chain,
  photos_enabled, photos_public, photo_moderation,
  event_type, event_tags, budget_total, budget_enabled,
  music_enabled, music_notes, kit_enabled, kit_deadline,
  fundraising_goal, report_recap, report_video_url, report_photos_url,
  flyer_artist, flyer_artist_url, x_post_url, x_post_views,
  farcaster_post_url, farcaster_views, luma_url, luma_views,
  meetup_url, eventbrite_url, external_links,
  poap_event_id, poap_mints, poap_moments,
  report_published, report_public_slug, report_password, report_stats_config,
  venue_status, venue_capacity, venue_cost, venue_point_person,
  venue_contact_name, venue_contact_email, venue_contact_phone,
  venue_organization, venue_website, venue_notes,
  venue_report_published, venue_report_slug, venue_report_password,
  venue_report_title, venue_report_notes,
  pinned_apps, region, host_status, host_tags,
  underboss_approved, underboss_status,
  flyer_generated_at, hidden_gpp_photos, extra_gpp_photos,
  quiz_enabled, telegram_group, turtle_roles_enabled
) ON parties TO anon, authenticated;
