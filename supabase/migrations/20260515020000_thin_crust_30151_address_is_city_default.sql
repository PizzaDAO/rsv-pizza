ALTER TABLE parties
  ADD COLUMN address_is_city_default boolean NOT NULL DEFAULT false;

GRANT SELECT (address_is_city_default) ON parties TO anon, authenticated;
