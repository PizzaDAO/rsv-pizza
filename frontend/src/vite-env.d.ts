/// <reference types="vite/client" />

// White-label brand config env vars (see src/config/brand.ts). All optional —
// unset falls back to the built-in default brand. Merges with vite/client's
// ImportMetaEnv via interface declaration merging.
interface ImportMetaEnv {
  readonly VITE_BRAND_NAME?: string;
  readonly VITE_BRAND_TAGLINE?: string;
  readonly VITE_BRAND_DOMAIN?: string;
  readonly VITE_BRAND_LOGO_URL?: string;
  readonly VITE_BRAND_OG_IMAGE?: string;
  readonly VITE_BRAND_SUPPORT_EMAIL?: string;
  readonly VITE_BRAND_THEME_CLASS?: string;
}
