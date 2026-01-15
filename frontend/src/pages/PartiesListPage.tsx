import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { getAllParties, DbParty } from '../lib/supabase';
import { Calendar, Users, MapPin, ChevronRight, PartyPopper } from 'lucide-react';

export const PartiesListPage: React.FC = () => {
  const [parties, setParties] = useState<DbParty[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchParties = async () => {
      const data = await getAllParties();
      setParties(data);
      setLoading(false);
    };
    fetchParties();
  }, []);

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return null;
    return new Date(dateStr).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  };

  const formatCreatedAt = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-[#1a1a2e] to-[#16213e] flex items-center justify-center">
        <div className="text-white/60">Loading parties...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#1a1a2e] to-[#16213e] py-8 px-4">
      <div className="max-w-2xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <PartyPopper className="text-[#ff393a]" />
            All Parties
          </h1>
          <Link
            to="/"
            className="px-4 py-2 bg-[#ff393a] text-white rounded-lg text-sm font-medium hover:bg-[#ff393a]/90 transition-colors"
          >
            + New Party
          </Link>
        </div>

        {parties.length === 0 ? (
          <div className="card p-8 text-center">
            <p className="text-white/60">No parties found.</p>
            <Link to="/" className="text-[#ff393a] hover:underline mt-2 inline-block">
              Create your first party
            </Link>
          </div>
        ) : (
          <div className="space-y-3">
            {parties.map((party) => (
              <Link
                key={party.id}
                to={`/manage/${party.invite_code}`}
                className="block card p-4 hover:bg-white/[0.07] transition-all group"
              >
                <div className="flex items-center justify-between">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <h2 className="text-lg font-semibold text-white truncate">
                        {party.name}
                      </h2>
                      {party.rsvp_closed_at && (
                        <span className="text-[10px] px-1.5 py-0.5 bg-red-500/20 text-red-300 rounded">
                          Closed
                        </span>
                      )}
                    </div>
                    <div className="flex flex-wrap items-center gap-3 text-sm text-white/60">
                      {party.host_name && (
                        <span>Host: {party.host_name}</span>
                      )}
                      {party.date && (
                        <span className="flex items-center gap-1">
                          <Calendar size={12} />
                          {formatDate(party.date)}
                        </span>
                      )}
                      {party.max_guests && (
                        <span className="flex items-center gap-1">
                          <Users size={12} />
                          {party.max_guests} guests
                        </span>
                      )}
                      {party.address && (
                        <span className="flex items-center gap-1 truncate max-w-[200px]">
                          <MapPin size={12} />
                          {party.address}
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-white/40 mt-1">
                      Created: {formatCreatedAt(party.created_at)} | Code: {party.invite_code}
                    </div>
                  </div>
                  <ChevronRight
                    size={20}
                    className="text-white/30 group-hover:text-white/60 transition-colors flex-shrink-0 ml-2"
                  />
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
