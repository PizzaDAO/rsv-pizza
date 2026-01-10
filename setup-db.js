const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  'https://znpiwdvvsqaxuskpfleo.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpucGl3ZHZ2c3FheHVza3BmbGVvIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2ODAyMDQ4NCwiZXhwIjoyMDgzNTk2NDg0fQ.KkAjyc8k6FbX4YxWPJEhOsInijffOcPtp6roESj4U9s'
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
