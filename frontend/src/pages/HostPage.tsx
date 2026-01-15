import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Loader2, AlertCircle, Settings, Pizza, Users } from 'lucide-react';
import { PizzaProvider, usePizza } from '../contexts/PizzaContext';
import { Layout } from '../components/Layout';
import { PartyHeader } from '../components/PartyHeader';
import { GuestList } from '../components/GuestList';
import { AddGuestForm } from '../components/AddGuestForm';
import { PizzaOrderSummary } from '../components/PizzaOrderSummary';
import { PizzaSettings } from '../components/PizzaSettings';
import { BeverageSettings } from '../components/BeverageSettings';
import { EventDetailsTab } from '../components/EventDetailsTab';

type TabType = 'details' | 'pizza' | 'guests';

function HostPageContent() {
  const { inviteCode } = useParams<{ inviteCode: string }>();
  const navigate = useNavigate();
  const { loadParty, party, partyLoading } = usePizza();
  const [error, setError] = useState<string | null>(null);
  const [loadedCode, setLoadedCode] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabType>('guests');

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
    { id: 'guests' as TabType, label: 'Guests & RSVPs', icon: Users },
    { id: 'details' as TabType, label: 'Event Details', icon: Settings },
    { id: 'pizza' as TabType, label: 'Pizza & Beverages', icon: Pizza },
  ];

  return (
    <Layout>
      <div className="max-w-6xl mx-auto px-4 py-8">
        <header className="text-center mb-8">
          <h1 className="text-3xl sm:text-4xl font-bold text-white mb-3">
            Pizza Party Planner
          </h1>
          <p className="text-white/60 max-w-2xl mx-auto">
            Manage your party, view guest responses, and get pizza recommendations!
          </p>
        </header>

        <PartyHeader />

        {/* Tab Navigation */}
        <div className="card p-2 mb-6 flex gap-2 overflow-x-auto">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-lg font-medium text-sm transition-all whitespace-nowrap ${
                  activeTab === tab.id
                    ? 'bg-[#ff393a] text-white'
                    : 'text-white/60 hover:text-white hover:bg-white/5'
                }`}
              >
                <Icon size={18} />
                <span className="hidden sm:inline">{tab.label}</span>
              </button>
            );
          })}
        </div>

        {/* Tab Content */}
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
          <div className="xl:col-span-2 space-y-6">
            {activeTab === 'guests' && (
              <>
                <AddGuestForm />
                <GuestList />
              </>
            )}

            {activeTab === 'pizza' && (
              <>
                <PizzaSettings />
                <BeverageSettings />
              </>
            )}

            {activeTab === 'details' && (
              <EventDetailsTab />
            )}
          </div>

          {/* Order Summary - Always Visible */}
          <div className="xl:col-span-1 space-y-6">
            <PizzaOrderSummary />
          </div>
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
