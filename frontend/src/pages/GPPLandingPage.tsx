import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import { Globe, Pizza, Users, Camera, CheckCircle, Loader2, ArrowRight, MessageCircle, BookOpen, HelpCircle } from 'lucide-react';
import { Header } from '../components/Header';
import { Footer } from '../components/Footer';
import { CornerLinks } from '../components/CornerLinks';
import { createGPPEvent } from '../lib/api';

export function GPPLandingPage() {
  const navigate = useNavigate();
  const [city, setCity] = useState('');
  const [hostName, setHostName] = useState('');
  const [email, setEmail] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<{ hostPageUrl: string; eventName: string } | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);

    try {
      const response = await createGPPEvent({
        city: city.trim(),
        hostName: hostName.trim(),
        email: email.trim(),
      });

      if (response.success) {
        setSuccess({
          hostPageUrl: response.hostPageUrl,
          eventName: response.event.name,
        });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create event. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Success state
  if (success) {
    return (
      <div className="min-h-screen">
        <Helmet>
          <title>Event Created! | Global Pizza Party</title>
        </Helmet>

        <Header variant="transparent" />

        <div className="flex items-center justify-center min-h-[calc(100vh-80px)] px-4 py-12">
          <div className="max-w-lg w-full text-center">
            <div className="w-20 h-20 bg-[#39d98a]/20 rounded-full flex items-center justify-center mx-auto mb-6">
              <CheckCircle className="w-10 h-10 text-[#39d98a]" />
            </div>

            <h1 className="text-3xl font-bold text-white mb-4">
              Your Global Pizza Party is Live!
            </h1>

            <p className="text-white/70 text-lg mb-8">
              <span className="text-white font-medium">{success.eventName}</span> has been created.
              Check your email for a login code to access your host dashboard.
            </p>

            <div className="space-y-4">
              <button
                onClick={() => window.location.href = success.hostPageUrl}
                className="w-full btn-primary flex items-center justify-center gap-2 py-4 text-lg"
              >
                Go to Host Dashboard
                <ArrowRight size={20} />
              </button>

              <button
                onClick={() => navigate('/')}
                className="w-full btn-secondary"
              >
                Return Home
              </button>
            </div>

            <p className="text-white/50 text-sm mt-8">
              Didn't receive an email? Check your spam folder or request a new login code from the host page.
            </p>
          </div>
        </div>

        <CornerLinks />
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      <Helmet>
        <title>Host a Global Pizza Party | RSV.Pizza</title>
        <meta name="description" content="Join the worldwide celebration of pizza! Host a Global Pizza Party in your city and connect with pizza lovers around the world." />
      </Helmet>

      <Header variant="transparent" />

      {/* Hero Section */}
      <div className="relative overflow-hidden">
        {/* Background gradient */}
        <div className="absolute inset-0 bg-gradient-to-br from-[#ff6b35]/20 via-transparent to-[#ff393a]/20" />

        <div className="relative max-w-6xl mx-auto px-4 py-16 md:py-24">
          <div className="grid md:grid-cols-2 gap-12 items-center">
            {/* Left: Hero Content */}
            <div>
              <div className="inline-flex items-center gap-2 bg-[#ff6b35]/20 text-[#ff6b35] px-4 py-2 rounded-full text-sm font-medium mb-6">
                <Globe className="w-4 h-4" />
                Join the Worldwide Celebration
              </div>

              <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold text-white mb-6 leading-tight">
                Host a Global<br />
                <span className="text-[#ff6b35]">Pizza Party</span>
              </h1>

              <p className="text-xl text-white/70 mb-8 leading-relaxed">
                Connect with hundreds of cities worldwide celebrating the universal language of pizza.
                Create your event in seconds and join the party!
              </p>

              {/* Features list */}
              <div className="grid grid-cols-2 gap-4 mb-8">
                <div className="flex items-center gap-3 text-white/80">
                  <div className="w-8 h-8 bg-[#ff393a]/20 rounded-lg flex items-center justify-center">
                    <Pizza className="w-4 h-4 text-[#ff393a]" />
                  </div>
                  <span className="text-sm">Pre-designed event page</span>
                </div>
                <div className="flex items-center gap-3 text-white/80">
                  <div className="w-8 h-8 bg-[#ff393a]/20 rounded-lg flex items-center justify-center">
                    <Users className="w-4 h-4 text-[#ff393a]" />
                  </div>
                  <span className="text-sm">RSVP management</span>
                </div>
                <div className="flex items-center gap-3 text-white/80">
                  <div className="w-8 h-8 bg-[#ff393a]/20 rounded-lg flex items-center justify-center">
                    <Camera className="w-4 h-4 text-[#ff393a]" />
                  </div>
                  <span className="text-sm">Photo sharing</span>
                </div>
                <div className="flex items-center gap-3 text-white/80">
                  <div className="w-8 h-8 bg-[#ff393a]/20 rounded-lg flex items-center justify-center">
                    <Globe className="w-4 h-4 text-[#ff393a]" />
                  </div>
                  <span className="text-sm">Global GPP network</span>
                </div>
              </div>
            </div>

            {/* Right: Sign Up Form */}
            <div className="card p-8">
              <h2 className="text-2xl font-bold text-white mb-2">Create Your Event</h2>
              <p className="text-white/60 mb-6">Fill in your details to get started</p>

              <form onSubmit={handleSubmit} className="space-y-5">
                {error && (
                  <div className="bg-[#ff393a]/10 border border-[#ff393a]/30 text-[#ff393a] p-4 rounded-xl text-sm">
                    {error}
                  </div>
                )}

                <div>
                  <label htmlFor="city" className="block text-sm font-medium text-white/80 mb-2">
                    What city are you hosting in?
                  </label>
                  <input
                    id="city"
                    type="text"
                    value={city}
                    onChange={(e) => setCity(e.target.value)}
                    placeholder="e.g., New York, London, Tokyo"
                    className="w-full"
                    required
                    disabled={isSubmitting}
                  />
                </div>

                <div>
                  <label htmlFor="hostName" className="block text-sm font-medium text-white/80 mb-2">
                    What's your name?
                  </label>
                  <input
                    id="hostName"
                    type="text"
                    value={hostName}
                    onChange={(e) => setHostName(e.target.value)}
                    placeholder="Your name"
                    className="w-full"
                    required
                    disabled={isSubmitting}
                  />
                </div>

                <div>
                  <label htmlFor="email" className="block text-sm font-medium text-white/80 mb-2">
                    Email address
                  </label>
                  <input
                    id="email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@example.com"
                    className="w-full"
                    required
                    disabled={isSubmitting}
                  />
                  <p className="text-xs text-white/50 mt-2">
                    We'll send you a login code to manage your event
                  </p>
                </div>

                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="w-full btn-primary flex items-center justify-center gap-2 py-4 text-lg"
                >
                  {isSubmitting ? (
                    <>
                      <Loader2 className="w-5 h-5 animate-spin" />
                      Creating Your Event...
                    </>
                  ) : (
                    <>
                      Create Your GPP Event
                      <ArrowRight size={20} />
                    </>
                  )}
                </button>
              </form>

              <p className="text-center text-white/50 text-sm mt-6">
                Already have an account?{' '}
                <a href="/login" className="text-[#ff393a] hover:underline">
                  Sign in
                </a>
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Resources Section */}
      <div className="border-t border-white/10">
        <div className="max-w-6xl mx-auto px-4 py-16">
          <h2 className="text-2xl font-bold text-white text-center mb-12">Resources for Hosts</h2>

          <div className="grid md:grid-cols-3 gap-6">
            <a
              href="https://docs.google.com/presentation/d/e/2PACX-1vSNFVmhuegxE6QhHFHBC1WCVGJ4eA-Zl-SpzcQG0kMuG1bQf3GA_01BaWtLoL-VUgTT0y3M330lGB5D/pub?start=false&loop=false&delayms=3000"
              target="_blank"
              rel="noopener noreferrer"
              className="card p-6 hover:bg-white/5 transition-colors group"
            >
              <div className="w-12 h-12 bg-[#ff6b35]/20 rounded-xl flex items-center justify-center mb-4 group-hover:bg-[#ff6b35]/30 transition-colors">
                <BookOpen className="w-6 h-6 text-[#ff6b35]" />
              </div>
              <h3 className="text-lg font-semibold text-white mb-2">GPP Host Guide</h3>
              <p className="text-white/60 text-sm">
                Everything you need to know about hosting a successful Global Pizza Party.
              </p>
            </a>

            <a
              href="https://t.me/+Qr-B8Y6DYH4yMjIx"
              target="_blank"
              rel="noopener noreferrer"
              className="card p-6 hover:bg-white/5 transition-colors group"
            >
              <div className="w-12 h-12 bg-[#39d98a]/20 rounded-xl flex items-center justify-center mb-4 group-hover:bg-[#39d98a]/30 transition-colors">
                <MessageCircle className="w-6 h-6 text-[#39d98a]" />
              </div>
              <h3 className="text-lg font-semibold text-white mb-2">Telegram Community</h3>
              <p className="text-white/60 text-sm">
                Join fellow hosts and the PizzaDAO team for support and coordination.
              </p>
            </a>

            <a
              href="https://pizzadao.xyz/landing"
              target="_blank"
              rel="noopener noreferrer"
              className="card p-6 hover:bg-white/5 transition-colors group"
            >
              <div className="w-12 h-12 bg-[#5c7cfa]/20 rounded-xl flex items-center justify-center mb-4 group-hover:bg-[#5c7cfa]/30 transition-colors">
                <HelpCircle className="w-6 h-6 text-[#5c7cfa]" />
              </div>
              <h3 className="text-lg font-semibold text-white mb-2">PizzaDAO Links</h3>
              <p className="text-white/60 text-sm">
                Common questions about hosting and what to expect on the day.
              </p>
            </a>
          </div>
        </div>
      </div>

      <Footer className="border-t border-white/10" />
      <CornerLinks />
    </div>
  );
}
