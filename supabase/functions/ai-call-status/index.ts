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

    const { callId } = await req.json();

    if (!callId) {
      return new Response(
        JSON.stringify({ error: 'callId is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const blandResponse = await fetch(`https://api.bland.ai/v1/calls/${callId}`, {
      method: 'GET',
      headers: {
        'Authorization': BLAND_API_KEY,
      },
    });

    if (!blandResponse.ok) {
      const errorData = await blandResponse.json();
      return new Response(
        JSON.stringify({ error: errorData.message || 'Failed to get call status' }),
        { status: blandResponse.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const data = await blandResponse.json();

    // Build concatenated transcript text
    let transcript = '';
    if (data.concatenated_transcript) {
      transcript = data.concatenated_transcript;
    } else if (data.transcripts && Array.isArray(data.transcripts)) {
      transcript = data.transcripts
        .map((t: { user: string; text: string }) => `${t.user}: ${t.text}`)
        .join('\n');
    }

    return new Response(
      JSON.stringify({
        status: data.status || data.call_status || 'unknown',
        recordingUrl: data.recording_url || null,
        transcript,
        callLength: data.call_length || null,
        answeredBy: data.answered_by || 'unknown',
        endedReason: data.ended_reason || null,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Call status error:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
