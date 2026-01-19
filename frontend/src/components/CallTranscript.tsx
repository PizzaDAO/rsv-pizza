import React, { useState, useEffect, useRef } from 'react';
import { FileText, Play, Pause, Volume2, ChevronDown, ChevronUp, Clock } from 'lucide-react';

interface TranscriptData {
  id: string;
  transcript: string | null;
  summary: string | null;
  recordingUrl: string | null;
  callDuration: number | null;
}

interface CallTranscriptProps {
  aiPhoneCallId: string;
  initialData?: Partial<TranscriptData>;
}

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || import.meta.env.VITE_API_URL || 'http://localhost:3006';

export const CallTranscript: React.FC<CallTranscriptProps> = ({
  aiPhoneCallId,
  initialData,
}) => {
  const [data, setData] = useState<TranscriptData | null>(
    initialData ? { id: aiPhoneCallId, ...initialData } as TranscriptData : null
  );
  const [loading, setLoading] = useState(!initialData?.transcript);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    if (initialData?.transcript) return;

    const fetchTranscript = async () => {
      try {
        const token = localStorage.getItem('auth_token');
        const response = await fetch(`${BACKEND_URL}/api/ai-phone/${aiPhoneCallId}/transcript`, {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });

        if (!response.ok) {
          throw new Error('Failed to fetch transcript');
        }

        const result = await response.json();
        setData(result);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load transcript');
      } finally {
        setLoading(false);
      }
    };

    fetchTranscript();
  }, [aiPhoneCallId, initialData?.transcript]);

  const formatDuration = (seconds: number | null) => {
    if (!seconds) return '--:--';
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const toggleAudio = () => {
    if (!audioRef.current) return;

    if (isPlaying) {
      audioRef.current.pause();
    } else {
      audioRef.current.play();
    }
    setIsPlaying(!isPlaying);
  };

  if (loading) {
    return (
      <div className="bg-white/5 border border-white/10 rounded-xl p-4">
        <div className="flex items-center gap-2 text-white/60">
          <FileText size={16} />
          <span>Loading transcript...</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-[#ff393a]/10 border border-[#ff393a]/30 rounded-xl p-4">
        <p className="text-[#ff393a] text-sm">{error}</p>
      </div>
    );
  }

  if (!data) return null;

  return (
    <div className="bg-white/5 border border-white/10 rounded-xl overflow-hidden">
      {/* Header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between p-4 hover:bg-white/5 transition-colors"
      >
        <div className="flex items-center gap-3">
          <FileText size={18} className="text-[#8b5cf6]" />
          <span className="font-medium text-white">Call Transcript</span>
          {data.callDuration && (
            <span className="text-white/50 text-sm flex items-center gap-1">
              <Clock size={12} />
              {formatDuration(data.callDuration)}
            </span>
          )}
        </div>
        {expanded ? (
          <ChevronUp size={18} className="text-white/50" />
        ) : (
          <ChevronDown size={18} className="text-white/50" />
        )}
      </button>

      {/* Expanded Content */}
      {expanded && (
        <div className="border-t border-white/10 p-4 space-y-4">
          {/* Audio Player */}
          {data.recordingUrl && (
            <div className="bg-white/5 rounded-lg p-3">
              <div className="flex items-center gap-3">
                <button
                  onClick={toggleAudio}
                  className="w-10 h-10 rounded-full bg-[#8b5cf6] flex items-center justify-center hover:bg-[#7c3aed] transition-colors"
                >
                  {isPlaying ? (
                    <Pause size={18} className="text-white" />
                  ) : (
                    <Play size={18} className="text-white ml-0.5" />
                  )}
                </button>
                <div className="flex-1">
                  <p className="text-white text-sm font-medium">Call Recording</p>
                  <p className="text-white/50 text-xs">{formatDuration(data.callDuration)}</p>
                </div>
                <Volume2 size={18} className="text-white/50" />
              </div>
              <audio
                ref={audioRef}
                src={data.recordingUrl}
                onEnded={() => setIsPlaying(false)}
                className="hidden"
              />
            </div>
          )}

          {/* Summary */}
          {data.summary && (
            <div>
              <h4 className="text-white/60 text-xs uppercase tracking-wide mb-2">Summary</h4>
              <p className="text-white text-sm">{data.summary}</p>
            </div>
          )}

          {/* Full Transcript */}
          {data.transcript && (
            <div>
              <h4 className="text-white/60 text-xs uppercase tracking-wide mb-2">
                Full Transcript
              </h4>
              <div className="bg-black/30 rounded-lg p-3 max-h-64 overflow-y-auto">
                <pre className="text-white/80 text-sm whitespace-pre-wrap font-sans">
                  {data.transcript}
                </pre>
              </div>
            </div>
          )}

          {!data.transcript && !data.summary && (
            <p className="text-white/50 text-sm text-center py-4">
              No transcript available for this call.
            </p>
          )}
        </div>
      )}
    </div>
  );
};
