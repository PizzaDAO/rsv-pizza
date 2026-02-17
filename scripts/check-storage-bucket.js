const { createClient } = require('@supabase/supabase-js');

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY;

const supabase = createClient(supabaseUrl, supabaseAnonKey);

async function checkStorageBucket() {
  console.log('Checking storage bucket...\n');

  // List all buckets
  const { data: buckets, error: bucketsError } = await supabase.storage.listBuckets();

  if (bucketsError) {
    console.error('❌ Error listing buckets:', bucketsError);
    return;
  }

  console.log('Available buckets:', buckets.map(b => b.name).join(', '));

  const eventImagesBucket = buckets.find(b => b.name === 'event-images');

  if (!eventImagesBucket) {
    console.log('\n❌ event-images bucket NOT found!');
    console.log('Please create the bucket manually:');
    console.log('1. Go to Supabase Dashboard → Storage');
    console.log('2. Click "New bucket"');
    console.log('3. Name: event-images');
    console.log('4. Public bucket: YES');
    console.log('5. File size limit: 5MB');
    console.log('6. Allowed MIME types: image/jpeg, image/png, image/gif, image/webp');
    return;
  }

  console.log('\n✓ event-images bucket exists');
  console.log('  Public:', eventImagesBucket.public);
  console.log('  File size limit:', eventImagesBucket.file_size_limit, 'bytes');

  // Try to upload a test file
  console.log('\nTesting upload...');
  const testContent = new Blob(['test'], { type: 'text/plain' });
  const testFileName = `test-${Date.now()}.txt`;

  const { data: uploadData, error: uploadError } = await supabase.storage
    .from('event-images')
    .upload(testFileName, testContent);

  if (uploadError) {
    console.error('❌ Upload test failed:', uploadError);
    console.log('\nPossible issues:');
    console.log('1. Check RLS policies on storage.objects table');
    console.log('2. Ensure bucket allows anonymous uploads');
    console.log('3. Run the SQL from backend/sql/create-event-images-bucket.sql');
    return;
  }

  console.log('✓ Upload test successful');

  // Get public URL
  const { data: urlData } = supabase.storage
    .from('event-images')
    .getPublicUrl(testFileName);

  console.log('✓ Public URL:', urlData.publicUrl);

  // Clean up test file
  const { error: deleteError } = await supabase.storage
    .from('event-images')
    .remove([testFileName]);

  if (!deleteError) {
    console.log('✓ Test file cleaned up');
  }

  console.log('\n✅ Storage bucket is working correctly!');
}

checkStorageBucket().catch(console.error);
