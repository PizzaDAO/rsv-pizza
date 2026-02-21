import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';

const BLAND_API_KEY = Deno.env.get('BLAND_API_KEY') || '';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    if (!BLAND_API_KEY) {
      return new Response(
        JSON.stringify({ error: 'Bland AI API key not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Accept callId from query param (for <audio src>) or POST body
    let callId: string | null = null;

    const url = new URL(req.url);
    callId = url.searchParams.get('callId');

    if (!callId && req.method === 'POST') {
      const body = await req.json();
      callId = body.callId;
    }

    if (!callId) {
      return new Response(
        JSON.stringify({ error: 'callId is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const blandResponse = await fetch(`https://api.bland.ai/v1/calls/${callId}/recording`, {
      method: 'GET',
      headers: {
        'Authorization': BLAND_API_KEY,
      },
    });

    if (!blandResponse.ok) {
      return new Response(
        JSON.stringify({ error: 'Failed to fetch recording' }),
        { status: blandResponse.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const audioData = await blandResponse.arrayBuffer();

    return new Response(audioData, {
      headers: {
        ...corsHeaders,
        'Content-Type': blandResponse.headers.get('Content-Type') || 'audio/mpeg',
        'Content-Length': audioData.byteLength.toString(),
        'Cache-Control': 'public, max-age=3600',
      },
    });
  } catch (error) {
    console.error('Call recording error:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
