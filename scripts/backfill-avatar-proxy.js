const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://znpiwdvvsqaxuskpfleo.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

if (!SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Set SUPABASE_SERVICE_ROLE_KEY env var');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
const dryRun = !process.argv.includes('--apply');

async function proxyAvatar(url) {
  try {
    const response = await fetch(url);
    if (!response.ok) {
      console.error(`    Failed to fetch ${url}: ${response.status}`);
      return url;
    }

    const blob = await response.blob();
    const arrayBuffer = await blob.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Determine extension from content-type
    const contentType = response.headers.get('content-type') || 'image/png';
    const extMap = {
      'image/jpeg': 'jpg',
      'image/png': 'png',
      'image/gif': 'gif',
      'image/webp': 'webp',
      'image/svg+xml': 'svg',
    };
    const ext = extMap[contentType] || 'png';

    const fileName = `co-host-avatars/${Date.now()}-${Math.random().toString(36).substring(7)}.${ext}`;

    const { error } = await supabase.storage
      .from('event-images')
      .upload(fileName, buffer, {
        cacheControl: '3600',
        upsert: false,
        contentType,
      });

    if (error) {
      console.error(`    Upload error for ${url}:`, error.message);
      return url;
    }

    const { data: urlData } = supabase.storage
      .from('event-images')
      .getPublicUrl(fileName);

    console.log(`    -> ${urlData.publicUrl}`);
    return urlData.publicUrl;
  } catch (err) {
    console.error(`    Error proxying ${url}:`, err.message);
    return url;
  }
}

async function main() {
  console.log(dryRun ? 'DRY RUN — pass --apply to execute' : 'APPLYING changes...');

  const { data: parties, error } = await supabase
    .from('parties')
    .select('id, co_hosts')
    .not('co_hosts', 'is', null);

  if (error) {
    console.error(error);
    process.exit(1);
  }

  let totalProxied = 0;

  for (const party of parties) {
    const coHosts = party.co_hosts;
    if (!Array.isArray(coHosts)) continue;

    let changed = false;
    const updatedHosts = [];

    for (const host of coHosts) {
      if (host.avatar_url && !host.avatar_url.includes('.supabase.co/storage/')) {
        console.log(`  Party ${party.id}: ${host.name} -> ${host.avatar_url}`);

        if (!dryRun) {
          const newUrl = await proxyAvatar(host.avatar_url);
          if (newUrl !== host.avatar_url) {
            updatedHosts.push({ ...host, avatar_url: newUrl });
            changed = true;
            totalProxied++;
            continue;
          }
        } else {
          totalProxied++;
        }
      }
      updatedHosts.push(host);
    }

    if (changed && !dryRun) {
      const { error: updateError } = await supabase
        .from('parties')
        .update({ co_hosts: updatedHosts })
        .eq('id', party.id);

      if (updateError) console.error(`  Error updating party ${party.id}:`, updateError);
      else console.log(`  Updated party ${party.id}`);
    }
  }

  console.log(`\n${dryRun ? 'Would proxy' : 'Proxied'} ${totalProxied} avatar(s)`);
}

main();
