import React, { useState, useEffect } from 'react';
import { Phone, PhoneCall, PhoneOff, CheckCircle, XCircle, Loader2, RotateCcw, Clock } from 'lucide-react';

export interface CallStatusData {
  id: string;
  callId: string;
  status: string;
  pizzeriaName: string;
  orderConfirmed: boolean;
  confirmedTotal: number | null;
  estimatedTime: string | null;
  summary: string | null;
  callDuration: number | null;
  callStartedAt: string | null;
  callEndedAt: string | null;
}

interface AICallStatusProps {
  aiPhoneCallId: string;
  pizzeriaName: string;
  onComplete: (data: CallStatusData) => void;
  onRetry: () => void;
  onCancel: () => void;
}

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || import.meta.env.VITE_API_URL || 'http://localhost:3006';

export const AICallStatus: React.FC<AICallStatusProps> = ({
  aiPhoneCallId,
  pizzeriaName,
  onComplete,
  onRetry,
  onCancel,
}) => {
  const [status, setStatus] = useState<string>('initiated');
  const [callData, setCallData] = useState<CallStatusData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [elapsedTime, setElapsedTime] = useState(0);

  // Poll for status updates
  useEffect(() => {
    let intervalId: NodeJS.Timeout;
    let timeIntervalId: NodeJS.Timeout;

    const fetchStatus = async () => {
      try {
        const token = localStorage.getItem('auth_token');
        const response = await fetch(`${BACKEND_URL}/api/ai-phone/${aiPhoneCallId}/status`, {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });

        if (!response.ok) {
          throw new Error('Failed to fetch call status');
        }

        const data: CallStatusData = await response.json();
        setCallData(data);
        setStatus(data.status);

        // If call is complete, stop polling
        if (['completed', 'failed', 'no_answer'].includes(data.status)) {
          clearInterval(intervalId);
          clearInterval(timeIntervalId);
          onComplete(data);
        }
      } catch (err) {
        console.error('Error fetching call status:', err);
        setError(err instanceof Error ? err.message : 'Failed to get call status');
      }
    };

    // Start polling
    fetchStatus();
    intervalId = setInterval(fetchStatus, 3000);

    // Update elapsed time
    timeIntervalId = setInterval(() => {
      setElapsedTime((prev) => prev + 1);
    }, 1000);

    return () => {
      clearInterval(intervalId);
      clearInterval(timeIntervalId);
    };
  }, [aiPhoneCallId, onComplete]);

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const getStatusIcon = () => {
    switch (status) {
      case 'initiated':
        return <Phone size={32} className="text-white/60" />;
      case 'ringing':
        return <Phone size={32} className="text-[#fbbf24] animate-bounce" />;
      case 'in_progress':
        return <PhoneCall size={32} className="text-[#39d98a]" />;
      case 'completed':
        return <CheckCircle size={32} className="text-[#39d98a]" />;
      case 'failed':
      case 'no_answer':
        return <PhoneOff size={32} className="text-[#ff393a]" />;
      default:
        return <Phone size={32} className="text-white/60" />;
    }
  };

  const getStatusMessage = () => {
    switch (status) {
      case 'initiated':
        return 'Initiating call...';
      case 'ringing':
        return `Calling ${pizzeriaName}...`;
      case 'in_progress':
        return 'AI is placing your order';
      case 'completed':
        return callData?.orderConfirmed ? 'Order confirmed!' : 'Call completed';
      case 'failed':
        return 'Call failed';
      case 'no_answer':
        return 'No answer';
      default:
        return 'Processing...';
    }
  };

  const isActiveCall = ['initiated', 'ringing', 'in_progress'].includes(status);
  const isFailedCall = ['failed', 'no_answer'].includes(status);

  return (
    <div className="text-center py-8">
      {/* Status Icon */}
      <div className="mb-6 flex justify-center">
        <div
          className={`w-20 h-20 rounded-full flex items-center justify-center ${
            status === 'completed' && callData?.orderConfirmed
              ? 'bg-[#39d98a]/20'
              : isFailedCall
              ? 'bg-[#ff393a]/20'
              : 'bg-white/10'
          }`}
        >
          {isActiveCall && status !== 'ringing' ? (
            <Loader2 size={32} className="text-[#8b5cf6] animate-spin" />
          ) : (
            getStatusIcon()
          )}
        </div>
      </div>

      {/* Status Message */}
      <h3 className="text-xl font-bold text-white mb-2">{getStatusMessage()}</h3>

      {/* Elapsed Time */}
      {isActiveCall && (
        <div className="flex items-center justify-center gap-2 text-white/60 mb-4">
          <Clock size={16} />
          <span>{formatTime(elapsedTime)}</span>
        </div>
      )}

      {/* Progress Indicators */}
      {isActiveCall && (
        <div className="flex justify-center gap-2 mb-6">
          <div
            className={`w-3 h-3 rounded-full ${
              status === 'initiated' ? 'bg-[#8b5cf6] animate-pulse' : 'bg-[#39d98a]'
            }`}
          />
          <div
            className={`w-3 h-3 rounded-full ${
              status === 'ringing' ? 'bg-[#fbbf24] animate-pulse' : status === 'in_progress' ? 'bg-[#39d98a]' : 'bg-white/20'
            }`}
          />
          <div
            className={`w-3 h-3 rounded-full ${
              status === 'in_progress' ? 'bg-[#39d98a] animate-pulse' : 'bg-white/20'
            }`}
          />
        </div>
      )}

      {/* Order Confirmation Details */}
      {status === 'completed' && callData?.orderConfirmed && (
        <div className="bg-[#39d98a]/10 border border-[#39d98a]/30 rounded-xl p-4 mb-6 text-left">
          <h4 className="font-medium text-[#39d98a] mb-2">Order Details</h4>
          <div className="space-y-1 text-sm">
            {callData.confirmedTotal && (
              <p className="text-white">
                <span className="text-white/60">Total:</span>{' '}
                ${(callData.confirmedTotal / 100).toFixed(2)}
              </p>
            )}
            {callData.estimatedTime && (
              <p className="text-white">
                <span className="text-white/60">Ready:</span> {callData.estimatedTime}
              </p>
            )}
          </div>
        </div>
      )}

      {/* Summary */}
      {callData?.summary && (
        <div className="bg-white/5 border border-white/10 rounded-xl p-4 mb-6 text-left">
          <h4 className="font-medium text-white mb-2">Summary</h4>
          <p className="text-white/70 text-sm">{callData.summary}</p>
        </div>
      )}

      {/* Error Message */}
      {error && (
        <div className="bg-[#ff393a]/10 border border-[#ff393a]/30 rounded-xl p-4 mb-6">
          <p className="text-[#ff393a] text-sm">{error}</p>
        </div>
      )}

      {/* Failed Call Actions */}
      {isFailedCall && (
        <div className="space-y-3">
          <p className="text-white/60 text-sm mb-4">
            {status === 'no_answer'
              ? 'The pizzeria did not answer. They may be busy or closed.'
              : 'There was a problem with the call. Please try again.'}
          </p>
          <button
            onClick={onRetry}
            className="w-full btn-primary flex items-center justify-center gap-2"
            style={{ backgroundColor: '#8b5cf6' }}
          >
            <RotateCcw size={18} />
            Try Again
          </button>
          <button onClick={onCancel} className="w-full btn-secondary">
            Cancel Order
          </button>
        </div>
      )}

      {/* Active Call - Cancel Option */}
      {isActiveCall && (
        <button
          onClick={onCancel}
          className="text-white/50 hover:text-white text-sm underline"
        >
          Cancel
        </button>
      )}
    </div>
  );
};
