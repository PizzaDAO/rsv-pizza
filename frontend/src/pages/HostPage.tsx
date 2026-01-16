import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Loader2, AlertCircle, Settings, Pizza, Users } from 'lucide-react';
import { PizzaProvider, usePizza } from '../contexts/PizzaContext';
import { Layout } from '../components/Layout';
import { PartyHeader } from '../components/PartyHeader';
import { GuestList } from '../components/GuestList';
import { PizzaOrderSummary } from '../components/PizzaOrderSummary';
import { PizzaSettings } from '../components/PizzaSettings';
import { BeverageSettings } from '../components/BeverageSettings';
import { ToppingsSettings } from '../components/ToppingsSettings';
import { GuestPreferencesList } from '../components/GuestPreferencesList';
import { EventDetailsTab } from '../components/EventDetailsTab';

type TabType = 'details' | 'pizza' | 'guests';

function HostPageContent() {
  const { inviteCode } = useParams<{ inviteCode: string }>();
  const navigate = useNavigate();
  const { loadParty, party, partyLoading, guests, generateRecommendations } = usePizza();
  const [error, setError] = useState<string | null>(null);
  const [loadedCode, setLoadedCode] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabType>('details');

  useEffect(() => {
    async function load() {
      if (inviteCode && inviteCode !== loadedCode) {
        setError(null);
        setLoadedCode(inviteCode);
        const success = await loadParty(inviteCode);
        if (!success) {
          setError('Party not found. The link may be invalid or expired.');
        }
      }
    }
    load();
  }, [inviteCode, loadParty, loadedCode]);

  if (partyLoading || (inviteCode && inviteCode !== loadedCode)) {
    return (
      <Layout>
        <div className="min-h-[60vh] flex items-center justify-center">
          <Loader2 className="w-8 h-8 animate-spin text-[#ff393a]" />
        </div>
      </Layout>
    );
  }

  if (error || !party) {
    return (
      <Layout>
        <div className="min-h-[60vh] flex items-center justify-center p-4">
          <div className="card p-8 max-w-md text-center">
            <AlertCircle className="w-16 h-16 text-[#ff393a] mx-auto mb-4" />
            <h1 className="text-2xl font-bold text-white mb-2">Party Not Found</h1>
            <p className="text-white/60 mb-6">{error || 'Unable to load party.'}</p>
            <button onClick={() => navigate('/')} className="btn-primary">
              Go to Home
            </button>
          </div>
        </div>
      </Layout>
    );
  }

  const tabs = [
    { id: 'details' as TabType, label: 'Settings', icon: Settings },
    { id: 'guests' as TabType, label: 'Guests', icon: Users },
    { id: 'pizza' as TabType, label: 'Pizza & Drinks', icon: Pizza },
  ];

  return (
    <Layout>
      <div className="max-w-6xl mx-auto px-4 py-8">
        <PartyHeader />

        {/* Tab Navigation */}
        <div className="border-b border-white/10 mb-6 flex gap-8 overflow-x-auto">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-2 px-1 pb-3 font-medium text-sm transition-all whitespace-nowrap relative ${
                  activeTab === tab.id
                    ? 'text-white'
                    : 'text-white/40 hover:text-white/60'
                }`}
              >
                <Icon size={18} />
                <span>{tab.label}</span>
                {activeTab === tab.id && (
                  <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-white" />
                )}
              </button>
            );
          })}
        </div>

        {/* Tab Content */}
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
          <div className="xl:col-span-2 space-y-3">
            {activeTab === 'guests' && (
              <>
                <GuestList />
              </>
            )}

            {activeTab === 'pizza' && (
              <>
                <GuestPreferencesList />
                <PizzaSettings />
                <ToppingsSettings />
                <BeverageSettings />
                <button
                  onClick={generateRecommendations}
                  disabled={guests.length === 0}
                  className="w-full btn-primary disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Create Order
                </button>
              </>
            )}

            {activeTab === 'details' && (
              <EventDetailsTab />
            )}
          </div>

          {/* Order Summary - Only on Pizza & Drinks Tab */}
          {activeTab === 'pizza' && (
            <div className="xl:col-span-1 space-y-3">
              <PizzaOrderSummary />
            </div>
          )}
        </div>
      </div>
    </Layout>
  );
}

export function HostPage() {
  return (
    <PizzaProvider>
      <HostPageContent />
    </PizzaProvider>
  );
}
