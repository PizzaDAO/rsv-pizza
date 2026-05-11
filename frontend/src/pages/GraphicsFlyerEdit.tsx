import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { PizzaProvider, usePizza } from '../contexts/PizzaContext';
import { FlyerTab } from '../components/flyer/FlyerTab';
import { Header } from '../components/Header';
import { Footer } from '../components/Footer';

function FlyerEditInner() {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const { party, partyLoading, loadParty } = usePizza();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!slug) return;
    loadParty(slug).then(success => {
      if (!success) setError('Event not found');
    });
  }, [slug, loadParty]);

  if (partyLoading) {
    return (
      <div className="flex items-center justify-center py-32">
        <Loader2 size={32} className="animate-spin text-white/40" />
      </div>
    );
  }

  if (error || !party) {
    return (
      <div className="flex flex-col items-center justify-center py-32">
        <p className="text-white/50">{error || 'Event not found'}</p>
        <button
          onClick={() => navigate('/graphics')}
          className="mt-4 px-4 py-2 bg-white/10 text-white rounded-lg text-sm hover:bg-white/20 transition-colors"
        >
          Back to Graphics
        </button>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-6">
        <button
          onClick={() => navigate('/graphics')}
          className="flex items-center gap-2 text-white/50 hover:text-white transition-colors text-sm"
        >
          <ArrowLeft size={16} />
          Back to Graphics Dashboard
        </button>
      </div>
      <FlyerTab />
    </div>
  );
}

export function GraphicsFlyerEdit() {
  return (
    <div className="min-h-screen bg-[#0a0a0a]">
      <Helmet>
        <title>Edit Flyer | RSV.Pizza</title>
      </Helmet>
      <Header />
      <main className="max-w-4xl mx-auto px-4 sm:px-6 py-8">
        <PizzaProvider>
          <FlyerEditInner />
        </PizzaProvider>
      </main>
      <Footer />
    </div>
  );
}
