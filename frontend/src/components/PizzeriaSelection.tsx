import React, { useState, useEffect } from 'react';
import { MapPin, Star, Plus, X, Phone, Link as LinkIcon, Loader2 } from 'lucide-react';
import { usePizza } from '../contexts/PizzaContext';
import { updateParty } from '../lib/supabase';
import { searchPizzerias, geocodeAddress } from '../lib/ordering';
import { Pizzeria } from '../types';

export const PizzeriaSelection: React.FC = () => {
  const { party, loadParty } = usePizza();

  // Pizzeria selection state
  const [selectedPizzerias, setSelectedPizzerias] = useState<Pizzeria[]>([]);
  const [nearbyPizzerias, setNearbyPizzerias] = useState<Pizzeria[]>([]);
  const [loadingPizzerias, setLoadingPizzerias] = useState(false);
  const [showAddPizzeriaModal, setShowAddPizzeriaModal] = useState(false);
  const [customPizzeriaName, setCustomPizzeriaName] = useState('');
  const [customPizzeriaAddress, setCustomPizzeriaAddress] = useState('');
  const [customPizzeriaPhone, setCustomPizzeriaPhone] = useState('');
  const [customPizzeriaUrl, setCustomPizzeriaUrl] = useState('');
  const [savingField, setSavingField] = useState<string | null>(null);

  // Load party data
  useEffect(() => {
    if (party) {
      setSelectedPizzerias(party.selectedPizzerias || []);
    }
  }, [party]);

  // Fetch nearby pizzerias when address changes
  useEffect(() => {
    async function fetchNearbyPizzerias() {
      if (!party?.address) {
        setNearbyPizzerias([]);
        return;
      }

      setLoadingPizzerias(true);
      try {
        const location = await geocodeAddress(party.address);
        if (location) {
          const results = await searchPizzerias(location.lat, location.lng);
          setNearbyPizzerias(results);
        }
      } catch (err) {
        console.error('Failed to fetch pizzerias:', err);
      } finally {
        setLoadingPizzerias(false);
      }
    }

    fetchNearbyPizzerias();
  }, [party?.address]);

  // Save field helper
  const saveField = async (fieldName: string, updates: Record<string, any>) => {
    if (!party) return false;

    setSavingField(fieldName);

    try {
      const success = await updateParty(party.id, updates);
      if (success) {
        if (party?.inviteCode) {
          await loadParty(party.inviteCode);
        }
        return true;
      } else {
        throw new Error('Failed to save');
      }
    } catch (error) {
      console.error(`Error saving ${fieldName}:`, error);
      return false;
    } finally {
      setSavingField(null);
    }
  };

  // Pizzeria selection functions
  const selectPizzeria = async (pizzeria: Pizzeria) => {
    if (selectedPizzerias.length >= 3) return;
    if (selectedPizzerias.some(p => p.id === pizzeria.id)) return;

    const newSelected = [...selectedPizzerias, pizzeria];
    setSelectedPizzerias(newSelected);
    await savePizzerias(newSelected);
  };

  const removePizzeria = async (pizzeriaId: string) => {
    const newSelected = selectedPizzerias.filter(p => p.id !== pizzeriaId);
    setSelectedPizzerias(newSelected);
    await savePizzerias(newSelected);
  };

  const addCustomPizzeria = async () => {
    if (!customPizzeriaName.trim()) return;
    if (selectedPizzerias.length >= 3) return;

    const customPizzeria: Pizzeria = {
      id: `custom-${crypto.randomUUID()}`,
      placeId: '',
      name: customPizzeriaName.trim(),
      address: customPizzeriaAddress.trim() || '',
      phone: customPizzeriaPhone.trim() || undefined,
      url: customPizzeriaUrl.trim() || undefined,
      location: { lat: 0, lng: 0 },
      orderingOptions: [],
    };

    const newSelected = [...selectedPizzerias, customPizzeria];
    setSelectedPizzerias(newSelected);

    // Reset form and close modal
    setCustomPizzeriaName('');
    setCustomPizzeriaAddress('');
    setCustomPizzeriaPhone('');
    setCustomPizzeriaUrl('');
    setShowAddPizzeriaModal(false);

    await savePizzerias(newSelected);
  };

  const savePizzerias = async (pizzeriasToSave: Pizzeria[]) => {
    await saveField('pizzerias', { selected_pizzerias: pizzeriasToSave });
  };

  if (!party) return null;

  return (
    <>
      <div className="card p-6">
        <div className="mb-3">
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            <MapPin size={20} />
            Pizzeria Selection
          </h2>
          <p className="text-xs text-white/50 mt-1">
            Choose up to 3 pizzerias for guests to rank when they RSVP
          </p>
        </div>

        {/* Selected Pizzerias */}
        {selectedPizzerias.length > 0 && (
          <div className="space-y-2 mb-3">
            <p className="text-xs text-white/60 font-medium">Selected ({selectedPizzerias.length}/3):</p>
            {selectedPizzerias.map((pizzeria) => (
              <div
                key={pizzeria.id}
                className="flex items-center justify-between p-3 bg-white/5 rounded-xl border border-[#ff393a]/30"
              >
                <div className="flex items-center gap-3 flex-1 min-w-0">
                  <div className="w-10 h-10 rounded-full bg-[#ff393a]/20 flex items-center justify-center flex-shrink-0">
                    <MapPin className="w-5 h-5 text-[#ff393a]" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-white font-medium truncate">{pizzeria.name}</p>
                    {pizzeria.address && (
                      <p className="text-white/50 text-xs truncate">{pizzeria.address}</p>
                    )}
                    {(pizzeria.url || pizzeria.phone) && (
                      <div className="flex items-center gap-2 mt-1">
                        {pizzeria.url && (
                          <a
                            href={pizzeria.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-[#ff393a]/80 hover:text-[#ff393a] text-xs flex items-center gap-1"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <LinkIcon size={10} />
                            Website
                          </a>
                        )}
                        {pizzeria.phone && (
                          <a
                            href={`tel:${pizzeria.phone}`}
                            className="text-white/50 hover:text-white text-xs flex items-center gap-1"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <Phone size={10} />
                            {pizzeria.phone}
                          </a>
                        )}
                      </div>
                    )}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => removePizzeria(pizzeria.id)}
                  className="text-[#ff393a] hover:text-[#ff5a5b] p-1"
                >
                  <X size={18} />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Nearby Pizzerias (only show unselected ones) */}
        {party.address && (
          <div className="space-y-2 mb-3">
            <p className="text-xs text-white/60 font-medium">
              {loadingPizzerias ? 'Searching nearby...' : 'Nearby pizzerias:'}
            </p>
            {loadingPizzerias && (
              <div className="flex items-center justify-center py-4">
                <Loader2 size={20} className="animate-spin text-white/50" />
              </div>
            )}
            {!loadingPizzerias && nearbyPizzerias
              .filter(p => !selectedPizzerias.some(s => s.id === p.id))
              .slice(0, 5)
              .map((pizzeria) => (
                <button
                  key={pizzeria.id}
                  type="button"
                  onClick={() => selectPizzeria(pizzeria)}
                  disabled={selectedPizzerias.length >= 3}
                  className="w-full flex items-center justify-between p-3 bg-white/5 rounded-xl border border-white/10 hover:bg-white/10 hover:border-white/20 transition-all disabled:opacity-50 disabled:cursor-not-allowed text-left"
                >
                  <div className="flex items-center gap-3 flex-1 min-w-0">
                    <div className="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center flex-shrink-0">
                      <MapPin className="w-5 h-5 text-white/60" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-white font-medium truncate">{pizzeria.name}</p>
                        {pizzeria.rating && (
                          <span className="flex items-center gap-1 text-xs text-yellow-400">
                            <Star size={12} className="fill-yellow-400" />
                            {pizzeria.rating.toFixed(1)}
                          </span>
                        )}
                      </div>
                      <p className="text-white/50 text-xs truncate">{pizzeria.address}</p>
                    </div>
                  </div>
                  <Plus size={18} className="text-white/40 flex-shrink-0" />
                </button>
              ))}
            {!loadingPizzerias && nearbyPizzerias.length === 0 && party.address && (
              <p className="text-white/40 text-sm py-2">No pizzerias found nearby</p>
            )}
          </div>
        )}

        {/* Add Custom Pizzeria Button */}
        {selectedPizzerias.length < 3 && (
          <button
            type="button"
            onClick={() => setShowAddPizzeriaModal(true)}
            className="w-full btn-secondary flex items-center justify-center gap-2"
          >
            <Plus size={16} />
            Add Custom Pizzeria
          </button>
        )}
      </div>

      {/* Add Custom Pizzeria Modal */}
      {showAddPizzeriaModal && (
        <div className="fixed inset-0 z-50 flex items-start justify-center pt-20 p-4 bg-black/70" onClick={() => setShowAddPizzeriaModal(false)}>
          <div className="bg-[#1a1a2e] border border-white/10 rounded-2xl shadow-xl max-w-md w-full p-5" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-semibold text-white mb-4">Add Custom Pizzeria</h2>

            <div className="space-y-3">
              <input
                type="text"
                value={customPizzeriaName}
                onChange={(e) => setCustomPizzeriaName(e.target.value)}
                placeholder="Pizzeria Name *"
                className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-1 focus:ring-[#ff393a] focus:border-[#ff393a]"
                autoFocus
              />

              <input
                type="text"
                value={customPizzeriaAddress}
                onChange={(e) => setCustomPizzeriaAddress(e.target.value)}
                placeholder="Address (optional)"
                className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-1 focus:ring-[#ff393a] focus:border-[#ff393a]"
              />

              <input
                type="tel"
                value={customPizzeriaPhone}
                onChange={(e) => setCustomPizzeriaPhone(e.target.value)}
                placeholder="Phone (optional)"
                className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-1 focus:ring-[#ff393a] focus:border-[#ff393a]"
              />

              <input
                type="url"
                value={customPizzeriaUrl}
                onChange={(e) => setCustomPizzeriaUrl(e.target.value)}
                placeholder="Website URL (optional)"
                className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-1 focus:ring-[#ff393a] focus:border-[#ff393a]"
              />
            </div>

            <div className="flex gap-3 mt-4">
              <button
                type="button"
                onClick={() => setShowAddPizzeriaModal(false)}
                className="flex-1 bg-white/10 hover:bg-white/20 text-white font-medium py-2.5 rounded-lg transition-colors text-sm"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={addCustomPizzeria}
                disabled={!customPizzeriaName.trim()}
                className="flex-1 bg-[#ff393a] hover:bg-[#ff5a5b] disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium py-2.5 rounded-lg transition-colors text-sm flex items-center justify-center gap-2"
              >
                <Plus size={16} />
                Add Pizzeria
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
