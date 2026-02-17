const { createClient } = require('@supabase/supabase-js');

require('dotenv').config();

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function verify() {
  console.log('Verifying tables...');

  // Check parties table
  const { data: parties, error: pErr } = await supabase.from('parties').select('*').limit(1);
  if (pErr) {
    console.error('Parties table error:', pErr.message);
  } else {
    console.log('✓ Parties table exists');
  }

  // Check guests table
  const { data: guests, error: gErr } = await supabase.from('guests').select('*').limit(1);
  if (gErr) {
    console.error('Guests table error:', gErr.message);
  } else {
    console.log('✓ Guests table exists');
  }

  // Test creating a party
  console.log('\nTesting party creation...');
  const { data: newParty, error: createErr } = await supabase
    .from('parties')
    .insert({ name: 'Test Party', host_name: 'Test Host', pizza_style: 'new-york' })
    .select()
    .single();

  if (createErr) {
    console.error('Create error:', createErr.message);
  } else {
    console.log('✓ Created test party:', newParty.name, '- invite code:', newParty.invite_code);

    // Clean up
    await supabase.from('parties').delete().eq('id', newParty.id);
    console.log('✓ Cleaned up test party');
  }

  console.log('\nDatabase ready!');
}

verify();
