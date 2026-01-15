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

  const baseUrl = 'https://pizzadao.github.io';
  const distDir = path.join(__dirname, '../frontend/dist');

  for (const party of parties) {
    const slug = party.custom_url;
    const pageUrl = `${baseUrl}/rsv-pizza/${slug}`;
    const ogImageUrl = party.event_image_url?.startsWith('/')
      ? `${baseUrl}${party.event_image_url}`
      : party.event_image_url || `${baseUrl}/rsv-pizza/logo.png`;

    const eventDate = party.date ? new Date(party.date) : null;
    const formattedDate = eventDate?.toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });

    const metaTitle = party.name;
    const metaDescription = party.description
      ? party.description.substring(0, 160) + (party.description.length > 160 ? '...' : '')
      : `Join ${party.host_name || 'us'} for ${party.name}${formattedDate ? ` on ${formattedDate}` : ''}${party.address ? ` at ${party.address}` : ''}. RSVP now!`;

    // Generate HTML file with meta tags that redirects to the React app
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

  <!-- Redirect to React app -->
  <meta http-equiv="refresh" content="0; url=/rsv-pizza/${slug}">
  <link rel="canonical" href="${pageUrl}">

  <style>
    body {
      margin: 0;
      padding: 0;
      font-family: system-ui, -apple-system, sans-serif;
      background: linear-gradient(135deg, #1a1a1a 0%, #2d2d2d 100%);
      color: white;
      display: flex;
      align-items: center;
      justify-center;
      min-height: 100vh;
    }
    .loading {
      text-align: center;
    }
    .spinner {
      width: 40px;
      height: 40px;
      border: 4px solid rgba(255, 57, 58, 0.2);
      border-top-color: #ff393a;
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
      margin: 0 auto 20px;
    }
    @keyframes spin {
      to { transform: rotate(360deg); }
    }
  </style>
</head>
<body>
  <div class="loading">
    <div class="spinner"></div>
    <p>Loading event...</p>
  </div>
  <script>
    // JavaScript redirect as backup
    window.location.href = '/rsv-pizza/${slug}';
  </script>
</body>
</html>`;

    // Create directory for the event
    const eventDir = path.join(distDir, slug);
    if (!fs.existsSync(eventDir)) {
      fs.mkdirSync(eventDir, { recursive: true });
    }

    // Write index.html file
    const indexPath = path.join(eventDir, 'index.html');
    fs.writeFileSync(indexPath, html, 'utf8');

    console.log(`✓ Generated ${slug}/index.html`);
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
