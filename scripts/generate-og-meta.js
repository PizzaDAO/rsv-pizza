const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

const supabaseUrl = 'https://znpiwdvvsqaxuskpfleo.supabase.co';
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpucGl3ZHZ2c3FheHVza3BmbGVvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjgwMjA0ODQsImV4cCI6MjA4MzU5NjQ4NH0.yAb2_JOtyYD0uqvqoPufzc5kG2pNjyqd1pC97UViXuw';

const supabase = createClient(supabaseUrl, supabaseAnonKey);

async function generateOGMetaPages() {
  console.log('Generating static HTML pages with OG meta tags...\n');

  // Fetch all parties with custom URLs
  const { data: parties, error } = await supabase
    .from('parties')
    .select('*')
    .not('custom_url', 'is', null);

  if (error) {
    console.error('Error fetching parties:', error);
    return;
  }

  console.log(`Found ${parties.length} parties with custom URLs\n`);

  const baseUrl = 'https://www.rsv.pizza';
  const distDir = path.join(__dirname, '../frontend/dist');

  for (const party of parties) {
    const slug = party.custom_url;
    const pageUrl = `${baseUrl}/${slug}`;
    const ogImageUrl = (() => {
      if (!party.event_image_url) return `${baseUrl}/logo.png`;
      if (party.event_image_url.startsWith('http')) return party.event_image_url;
      if (party.event_image_url.startsWith('/')) return `${baseUrl}${party.event_image_url}`;
      return `${baseUrl}/${party.event_image_url}`;
    })();

    const eventDate = party.date ? new Date(party.date) : null;
    const formattedDate = eventDate?.toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });

    const formattedTime = eventDate?.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      timeZone: party.timezone || undefined,
    });

    const metaTitle = party.name;

    // Construct description: Host • Date @ Time • Location. Description
    const detailsParts = [];
    if (party.host_name) detailsParts.push(`Hosted by ${party.host_name}`);
    if (formattedDate) detailsParts.push(`${formattedDate}${formattedTime ? ` @ ${formattedTime}` : ''}`);
    if (party.address) detailsParts.push(party.address);

    const details = detailsParts.join(' • ');
    let metaDescription = details;

    if (party.description) {
      const remainingChars = 300 - details.length; // Allow more chars for OG tags
      if (remainingChars > 10) {
        metaDescription += `. ${party.description.substring(0, remainingChars)}${party.description.length > remainingChars ? '...' : ''}`;
      }
    } else if (!metaDescription) {
      metaDescription = `Join us for ${party.name}! RSVP now.`;
    }

    // Generate HTML for bots (no redirect needed, but good for safety)
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">

  <!-- Primary Meta Tags -->
  <title>${escapeHtml(metaTitle)} | RSVPizza</title>
  <meta name="title" content="${escapeHtml(metaTitle)}">
  <meta name="description" content="${escapeHtml(metaDescription)}">

  <!-- Open Graph / Facebook -->
  <meta property="og:site_name" content="RSV.Pizza">
  <meta property="og:type" content="website">
  <meta property="og:url" content="${pageUrl}">
  <meta property="og:title" content="${escapeHtml(metaTitle)}">
  <meta property="og:description" content="${escapeHtml(metaDescription)}">
  <meta property="og:image" content="${ogImageUrl}">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">

  <!-- Twitter -->
  <meta property="twitter:card" content="summary_large_image">
  <meta property="twitter:url" content="${pageUrl}">
  <meta property="twitter:title" content="${escapeHtml(metaTitle)}">
  <meta property="twitter:description" content="${escapeHtml(metaDescription)}">
  <meta property="twitter:image" content="${ogImageUrl}">

  ${eventDate ? `<meta property="event:start_time" content="${eventDate.toISOString()}">` : ''}
  ${party.duration && eventDate ? `<meta property="event:end_time" content="${new Date(eventDate.getTime() + party.duration * 3600000).toISOString()}">` : ''}
  ${party.address ? `<meta property="event:location" content="${escapeHtml(party.address)}">` : ''}

  <style>
    body { font-family: sans-serif; background: #1a1a1a; color: white; display: flex; align-items: center; justify-center; height: 100vh; }
  </style>
</head>
<body>
  <h1>${escapeHtml(metaTitle)}</h1>
  <script>window.location.href = '/${slug}';</script>
</body>
</html>`;

    // Ensure og-static directory exists
    const ogDir = path.join(distDir, 'og-static');
    if (!fs.existsSync(ogDir)) {
      fs.mkdirSync(ogDir, { recursive: true });
    }

    // Write slug.html to og-static directory
    const indexPath = path.join(ogDir, `${slug}.html`);
    fs.writeFileSync(indexPath, html, 'utf8');

    console.log(`✓ Generated og-static/${slug}.html`);
    console.log(`  Title: ${metaTitle}`);
    console.log(`  Image: ${ogImageUrl}\n`);
  }

  console.log(`Done! Generated ${parties.length} static pages.`);
}

function escapeHtml(text) {
  if (!text) return '';
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

generateOGMetaPages().catch(console.error);
