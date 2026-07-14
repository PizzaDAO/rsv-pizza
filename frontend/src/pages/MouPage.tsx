import React, { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { Loader2, FileSignature, AlertCircle, Check, Mail, User } from 'lucide-react';
import { Mou } from '../types';
import { getPublicMou, recordMouView, signMou } from '../lib/api';
import { IconInput } from '../components/IconInput';
import { Checkbox } from '../components/Checkbox';

export function MouPage() {
  const { viewToken } = useParams<{ viewToken: string }>();
  const [mou, setMou] = useState<Mou | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Sign panel state
  const [signerName, setSignerName] = useState('');
  const [agree, setAgree] = useState(false);
  const [signing, setSigning] = useState(false);
  const [signError, setSignError] = useState<string | null>(null);

  useEffect(() => {
    if (!viewToken) return;

    const loadMou = async () => {
      setLoading(true);
      try {
        const result = await getPublicMou(viewToken);
        if (result) {
          setMou(result.mou);
          // Record view on first load
          await recordMouView(viewToken);
        } else {
          setError('MOU not found');
        }
      } catch {
        setError('Failed to load MOU');
      } finally {
        setLoading(false);
      }
    };

    loadMou();
  }, [viewToken]);

  const handleSign = async () => {
    if (!viewToken) return;
    if (!signerName.trim()) {
      setSignError('Please type your full name to sign');
      return;
    }
    if (!agree) {
      setSignError('You must agree to the terms to sign');
      return;
    }

    setSigning(true);
    setSignError(null);
    try {
      const result = await signMou(viewToken, { signerName: signerName.trim(), agree });
      if (result) {
        setMou(result.mou);
      } else {
        setSignError('Failed to sign MOU');
      }
    } catch (err) {
      setSignError(err instanceof Error ? err.message : 'Failed to sign MOU');
    } finally {
      setSigning(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <Loader2 size={32} className="animate-spin text-gray-400" />
      </div>
    );
  }

  if (error || !mou) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <div className="text-center">
          <AlertCircle size={48} className="mx-auto text-gray-400 mb-4" />
          <h1 className="text-xl font-semibold text-gray-800 mb-2">MOU Not Found</h1>
          <p className="text-gray-500">{error || 'This MOU link may be invalid or expired.'}</p>
        </div>
      </div>
    );
  }

  const effectiveDateText = mou.effectiveDate
    ? new Date(mou.effectiveDate).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
    : null;

  const mouDate = mou.sentAt
    ? new Date(mou.sentAt).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
    : new Date(mou.createdAt).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

  const signedAtText = mou.signedAt
    ? new Date(mou.signedAt).toLocaleString('en-US', { year: 'numeric', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' })
    : null;

  const statusBadge = () => {
    switch (mou.status) {
      case 'signed':
        return <span className="px-3 py-1 bg-green-100 text-green-700 text-sm font-medium rounded-full">Signed</span>;
      case 'issued':
      case 'viewed':
        return <span className="px-3 py-1 bg-blue-100 text-blue-700 text-sm font-medium rounded-full">Awaiting Signature</span>;
      case 'draft':
        return <span className="px-3 py-1 bg-gray-100 text-gray-600 text-sm font-medium rounded-full">Draft</span>;
      case 'cancelled':
        return <span className="px-3 py-1 bg-red-100 text-red-600 text-sm font-medium rounded-full">Cancelled</span>;
      default:
        return null;
    }
  };

  const canSign = mou.status === 'issued' || mou.status === 'viewed';

  return (
    <div className="min-h-screen bg-gray-50 py-8 px-4">
      {/* Action bar */}
      <div className="max-w-3xl mx-auto mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2 text-gray-500 text-sm">
          <FileSignature size={16} />
          MOU #{mou.mouNumber}
          {mou.party?.name && <span>- {mou.party.name}</span>}
        </div>
      </div>

      {/* MOU */}
      <div className="max-w-3xl mx-auto bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
        {/* Header */}
        <div className="p-8 pb-6">
          <div className="flex justify-between items-start">
            <div>
              <h1 className="text-3xl font-bold text-gray-900 mb-1">{mou.title}</h1>
              <p className="text-gray-500">{mou.party?.name || ''}</p>
            </div>
            <div className="text-right">
              <div className="flex items-center gap-3 justify-end mb-2">
                {statusBadge()}
              </div>
              <p className="text-gray-800 font-semibold">#{mou.mouNumber}</p>
              <p className="text-gray-500 text-sm">Date: {mouDate}</p>
              {effectiveDateText && (
                <p className="text-gray-500 text-sm">Effective: {effectiveDateText}</p>
              )}
            </div>
          </div>
        </div>

        {/* Parties */}
        <div className="px-8 pb-6">
          <h3 className="text-xs uppercase tracking-wider text-gray-400 mb-2 font-medium">Between</h3>
          <div className="text-gray-700">
            <p className="font-semibold text-gray-900">{mou.party?.name || ''}</p>
            <p className="text-gray-400 text-sm my-1">and</p>
            {mou.counterpartyCompany && (
              <p className="font-semibold text-gray-900">{mou.counterpartyCompany}</p>
            )}
            {mou.counterpartyContact && (
              <p>ATTN: {mou.counterpartyContact}</p>
            )}
            <p>{mou.counterpartyEmail}</p>
          </div>
        </div>

        {/* Body */}
        <div className="px-8 pb-6">
          <div className="text-gray-700 whitespace-pre-wrap leading-relaxed">{mou.bodyMarkdown}</div>
        </div>

        {/* Term */}
        {mou.termText && (
          <div className="px-8 pb-6">
            <h4 className="text-xs uppercase tracking-wider text-gray-400 mb-1 font-medium">Term</h4>
            <p className="text-gray-700">{mou.termText}</p>
          </div>
        )}

        {/* Signed banner */}
        {mou.status === 'signed' && (
          <div className="px-8 pb-8">
            <div className="bg-green-50 border border-green-200 rounded-lg p-4">
              <div className="flex items-center gap-2 text-green-700 font-semibold text-lg mb-1">
                <Check size={20} />
                Signed
              </div>
              {mou.signerName && (
                <p className="text-green-700 text-sm">
                  By <strong>{mou.signerName}</strong>
                  {mou.signerEmail && ` (${mou.signerEmail})`}
                </p>
              )}
              {signedAtText && (
                <p className="text-green-600 text-sm mt-0.5">on {signedAtText}</p>
              )}
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="px-8 py-4 bg-gray-50 border-t border-gray-100 text-center text-xs text-gray-400">
          Generated by <a href="https://rsv.pizza" className="text-gray-500 hover:text-gray-700">RSV.Pizza</a>
        </div>
      </div>

      {/* Sign panel — below MOU card */}
      {canSign && (
        <div className="max-w-3xl mx-auto mt-6 bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-1 flex items-center gap-2">
            <FileSignature size={18} />
            Sign this MOU
          </h3>
          <p className="text-gray-500 text-sm mb-4">
            By signing, you confirm you are authorized to enter into this agreement on behalf of {mou.counterpartyCompany || 'your organization'}.
          </p>

          {signError && (
            <div className="flex items-center gap-2 p-3 mb-4 bg-red-50 border border-red-200 rounded-lg text-red-600 text-sm">
              <AlertCircle size={16} />
              {signError}
            </div>
          )}

          <div className="space-y-3">
            <IconInput
              icon={User}
              value={signerName}
              onChange={e => setSignerName(e.target.value)}
              placeholder="Type your full legal name to sign"
            />
            <div className="flex items-center gap-2 text-sm text-gray-600">
              <Mail size={14} />
              Signing as {mou.counterpartyEmail}
            </div>
            <Checkbox
              checked={agree}
              onChange={() => setAgree(prev => !prev)}
              label="I have read and agree to the terms of this Memorandum of Understanding."
              labelClassName="text-sm text-gray-700"
            />
          </div>

          <button
            onClick={handleSign}
            disabled={signing || !signerName.trim() || !agree}
            className="mt-5 w-full flex items-center justify-center gap-2 px-4 py-3 text-sm font-medium bg-[#ff393a] hover:bg-[#ff393a]/90 text-white rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {signing ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
            Sign MOU
          </button>
        </div>
      )}
    </div>
  );
}
