import { useState, useEffect, useCallback, useRef } from 'react';
import { getCallStatus, getCallRecordingUrl, CallStatus } from '../lib/ordering';

interface UseCallRecordingReturn {
  status: CallStatus['status'];
  transcript: string;
  recordingUrl: string | null;
  callLength: number | null;
  answeredBy: CallStatus['answeredBy'];
  error: string | null;
  isPolling: boolean;
}

export function useCallRecording(callId: string | null): UseCallRecordingReturn {
  const [status, setStatus] = useState<CallStatus['status']>('queued');
  const [transcript, setTranscript] = useState('');
  const [recordingUrl, setRecordingUrl] = useState<string | null>(null);
  const [callLength, setCallLength] = useState<number | null>(null);
  const [answeredBy, setAnsweredBy] = useState<CallStatus['answeredBy']>('unknown');
  const [error, setError] = useState<string | null>(null);
  const [isPolling, setIsPolling] = useState(false);

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startTimeRef = useRef<number>(Date.now());
  const pollCountRef = useRef(0);

  const getInterval = useCallback(() => {
    const elapsed = Date.now() - startTimeRef.current;
    if (elapsed < 60_000) return 5_000;       // First minute: every 5s
    if (elapsed < 180_000) return 10_000;      // Next 2 min: every 10s
    return 15_000;                              // After that: every 15s
  }, []);

  const poll = useCallback(async () => {
    if (!callId) return;

    try {
      const data = await getCallStatus(callId);
      setStatus(data.status);
      setTranscript(data.transcript);
      setCallLength(data.callLength);
      setAnsweredBy(data.answeredBy);

      if (data.status === 'completed') {
        setRecordingUrl(getCallRecordingUrl(callId));
        setIsPolling(false);
        return;
      }

      if (data.status === 'failed') {
        setError(data.endedReason || 'Call failed');
        setIsPolling(false);
        return;
      }

      // Check max polling duration (15 min)
      const elapsed = Date.now() - startTimeRef.current;
      if (elapsed > 15 * 60_000) {
        setIsPolling(false);
        setError('Polling timed out after 15 minutes');
        return;
      }

      pollCountRef.current++;
      timerRef.current = setTimeout(poll, getInterval());
    } catch (err) {
      // Don't stop polling on transient errors, just log
      pollCountRef.current++;
      if (pollCountRef.current > 3) {
        setError(err instanceof Error ? err.message : 'Failed to get call status');
      }
      timerRef.current = setTimeout(poll, getInterval());
    }
  }, [callId, getInterval]);

  useEffect(() => {
    if (!callId) return;

    startTimeRef.current = Date.now();
    pollCountRef.current = 0;
    setIsPolling(true);
    setError(null);
    setStatus('queued');
    setTranscript('');
    setRecordingUrl(null);
    setCallLength(null);
    setAnsweredBy('unknown');

    poll();

    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      setIsPolling(false);
    };
  }, [callId, poll]);

  return { status, transcript, recordingUrl, callLength, answeredBy, error, isPolling };
}
