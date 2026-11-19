import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// basil-14648: retired. It dialed any number with the public anon key. AI ordering goes through pizza-mcp now.
serve((req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  return new Response(
    JSON.stringify({ error: 'This endpoint is no longer available.', code: 'ENDPOINT_RETIRED' }),
    { status: 410, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  );
});
