import { Helmet } from 'react-helmet-async';
import { BRAND } from '../config/brand';

/**
 * App-wide default document metadata, sourced from the brand config so a
 * re-branded deploy gets correct title/OG/favicon with no code change. Rendered
 * once at the app root; page-level <Helmet>s (event pages, map, etc.) override
 * these per-route.
 *
 * Mirrors the tags previously hardcoded in index.html. Canonical/OG URLs use the
 * apex BRAND.url (see plans/whitelabel-brand-config.md — apex chosen over the
 * old www host). og:image is resolved to an absolute URL on the brand domain.
 */
const title = `${BRAND.name} - ${BRAND.tagline}`;
const description = 'Invite your friends to share some pizza!';
const ogImage = /^https?:\/\//i.test(BRAND.ogImageUrl)
  ? BRAND.ogImageUrl
  : `${BRAND.url}/${BRAND.ogImageUrl.replace(/^\/+/, '')}`;

export default function BrandHelmet() {
  return (
    <Helmet>
      <title>{title}</title>
      <link rel="icon" type="image/png" href={BRAND.logoUrl} />
      <meta name="title" content={title} />
      <meta name="description" content={description} />

      <meta property="og:type" content="website" />
      <meta property="og:url" content={`${BRAND.url}/`} />
      <meta property="og:title" content={title} />
      <meta property="og:description" content={description} />
      <meta property="og:image" content={ogImage} />
      <meta property="og:image:width" content="512" />
      <meta property="og:image:height" content="512" />
      <meta property="og:site_name" content={BRAND.name} />

      <meta name="twitter:card" content="summary" />
      <meta name="twitter:url" content={`${BRAND.url}/`} />
      <meta name="twitter:title" content={title} />
      <meta name="twitter:description" content={description} />
      <meta name="twitter:image" content={ogImage} />
    </Helmet>
  );
}
