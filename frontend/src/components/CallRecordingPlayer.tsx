import React, { useState, useEffect, useRef } from 'react';
import { useCallRecording } from '../hooks/useCallRecording';
import { Phone, Loader2, ChevronDown, ChevronUp, AlertCircle, PhoneOff } from 'lucide-react';

interface CallRecordingPlayerProps {
  callId: string;
  pizzeriaName?: string;
}

export const CallRecordingPlayer: React.FC<CallRecordingPlayerProps> = ({ callId, pizzeriaName }) => {
  const { status, transcript, recordingUrl, callLength, answeredBy, error, isPolling } = useCallRecording(callId);
  const [showTranscript, setShowTranscript] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const startRef = useRef(Date.now());

  // Elapsed timer while call is in progress
  useEffect(() => {
    if (status !== 'queued' && status !== 'in-progress') return;

    startRef.current = Date.now();
    const interval = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startRef.current) / 1000));
    }, 1000);

    return () => clearInterval(interval);
  }, [status]);

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  // Queued state
  if (status === 'queued') {
    return (
      <div className="p-4 bg-[#8b5cf6]/10 border border-[#8b5cf6]/30 rounded-xl">
        <div className="flex items-center gap-3">
          <div className="relative">
            <Phone size={20} className="text-[#8b5cf6]" />
            <span className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-[#8b5cf6] rounded-full animate-pulse" />
          </div>
          <div className="flex-1">
            <p className="text-white font-medium text-sm">
              Dialing{pizzeriaName ? ` ${pizzeriaName}` : ''}...
            </p>
            <p className="text-white/50 text-xs">Waiting for the call to connect</p>
          </div>
          <Loader2 size={18} className="text-[#8b5cf6] animate-spin" />
        </div>
      </div>
    );
  }

  // In-progress state
  if (status === 'in-progress') {
    return (
      <div className="p-4 bg-[#8b5cf6]/10 border border-[#8b5cf6]/30 rounded-xl">
        <div className="flex items-center gap-3">
          <div className="relative">
            <Phone size={20} className="text-[#8b5cf6]" />
            <span className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-[#39d98a] rounded-full animate-pulse" />
          </div>
          <div className="flex-1">
            <p className="text-white font-medium text-sm">
              AI is on the phone{pizzeriaName ? ` with ${pizzeriaName}` : ''}
            </p>
            <p className="text-white/50 text-xs">
              {formatTime(elapsed)} elapsed
              {answeredBy !== 'unknown' && ` \u00b7 Answered by ${answeredBy}`}
            </p>
          </div>
          <div className="flex items-center gap-1">
            <span className="w-1.5 h-3 bg-[#39d98a] rounded-full animate-pulse" />
            <span className="w-1.5 h-4 bg-[#39d98a] rounded-full animate-pulse" style={{ animationDelay: '0.15s' }} />
            <span className="w-1.5 h-2.5 bg-[#39d98a] rounded-full animate-pulse" style={{ animationDelay: '0.3s' }} />
            <span className="w-1.5 h-3.5 bg-[#39d98a] rounded-full animate-pulse" style={{ animationDelay: '0.45s' }} />
          </div>
        </div>

        {/* Live transcript preview */}
        {transcript && (
          <div className="mt-3 pt-3 border-t border-white/10">
            <button
              onClick={() => setShowTranscript(!showTranscript)}
              className="flex items-center gap-1 text-xs text-white/50 hover:text-white/70 transition-colors"
            >
              {showTranscript ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
              Live transcript
            </button>
            {showTranscript && (
              <pre className="mt-2 text-xs text-white/60 whitespace-pre-wrap font-mono bg-black/20 p-3 rounded-lg max-h-40 overflow-y-auto">
                {transcript}
              </pre>
            )}
          </div>
        )}
      </div>
    );
  }

  // Failed state
  if (status === 'failed') {
    return (
      <div className="p-4 bg-[#ff393a]/10 border border-[#ff393a]/30 rounded-xl">
        <div className="flex items-center gap-3">
          <PhoneOff size={20} className="text-[#ff393a]" />
          <div className="flex-1">
            <p className="text-white font-medium text-sm">Call failed</p>
            <p className="text-white/50 text-xs">{error || 'The call could not be completed'}</p>
          </div>
        </div>
        {transcript && (
          <div className="mt-3 pt-3 border-t border-white/10">
            <button
              onClick={() => setShowTranscript(!showTranscript)}
              className="flex items-center gap-1 text-xs text-white/50 hover:text-white/70 transition-colors"
            >
              {showTranscript ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
              Transcript
            </button>
            {showTranscript && (
              <pre className="mt-2 text-xs text-white/60 whitespace-pre-wrap font-mono bg-black/20 p-3 rounded-lg max-h-40 overflow-y-auto">
                {transcript}
              </pre>
            )}
          </div>
        )}
      </div>
    );
  }

  // Completed state
  if (status === 'completed') {
    return (
      <div className="p-4 bg-[#39d98a]/10 border border-[#39d98a]/30 rounded-xl">
        <div className="flex items-center gap-3 mb-3">
          <Phone size={20} className="text-[#39d98a]" />
          <div className="flex-1">
            <p className="text-white font-medium text-sm">
              Call completed{pizzeriaName ? ` with ${pizzeriaName}` : ''}
            </p>
            <p className="text-white/50 text-xs">
              {callLength ? `${callLength.toFixed(1)} min` : 'Duration unknown'}
              {answeredBy !== 'unknown' && ` \u00b7 Answered by ${answeredBy}`}
            </p>
          </div>
        </div>

        {/* Audio player */}
        {recordingUrl && (
          <audio
            controls
            src={recordingUrl}
            className="w-full h-10 rounded-lg"
            preload="none"
            style={{ filter: 'invert(1) hue-rotate(180deg)', opacity: 0.8 }}
          />
        )}

        {/* Transcript */}
        {transcript && (
          <div className="mt-3 pt-3 border-t border-white/10">
            <button
              onClick={() => setShowTranscript(!showTranscript)}
              className="flex items-center gap-1 text-xs text-white/50 hover:text-white/70 transition-colors"
            >
              {showTranscript ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
              View transcript
            </button>
            {showTranscript && (
              <pre className="mt-2 text-xs text-white/60 whitespace-pre-wrap font-mono bg-black/20 p-3 rounded-lg max-h-60 overflow-y-auto">
                {transcript}
              </pre>
            )}
          </div>
        )}
      </div>
    );
  }

  // Unknown / loading state
  if (error && !isPolling) {
    return (
      <div className="p-4 bg-white/5 border border-white/10 rounded-xl">
        <div className="flex items-center gap-3">
          <AlertCircle size={20} className="text-white/40" />
          <div>
            <p className="text-white/60 text-sm">Unable to load call status</p>
            <p className="text-white/40 text-xs">{error}</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 bg-white/5 border border-white/10 rounded-xl">
      <div className="flex items-center gap-3">
        <Loader2 size={18} className="text-white/40 animate-spin" />
        <p className="text-white/50 text-sm">Loading call status...</p>
      </div>
    </div>
  );
};
