import React, { useState, useEffect } from 'react';
import { MapPin, Star, Plus, X, Phone, Link as LinkIcon, Loader2, Store, Users } from 'lucide-react';
import { usePizza } from '../contexts/PizzaContext';
import { updateParty } from '../lib/supabase';
import { searchPizzerias, geocodeAddress } from '../lib/ordering';
import { Pizzeria } from '../types';
import { PlaceAutocomplete } from './PlaceAutocomplete';
import { LocationAutocomplete } from './LocationAutocomplete';
import { IconInput } from './IconInput';

interface PizzeriaSelectionProps {
  embedded?: boolean;
}

export const PizzeriaSelection: React.FC<PizzeriaSelectionProps> = ({ embedded = false }) => {
  const { party, loadParty, guests } = usePizza();

  // Pizzeria selection state
  const [selectedPizzerias, setSelectedPizzerias] = useState<Pizzeria[]>([]);
  const [nearbyPizzerias, setNearbyPizzerias] = useState<Pizzeria[]>([]);
  const [loadingPizzerias, setLoadingPizzerias] = useState(false);
  const [showAddPizzeriaModal, setShowAddPizzeriaModal] = useState(false);
  const [savingField, setSavingField] = useState<string | null>(null);

  // Modal state
  const [selectedPlace, setSelectedPlace] = useState<Partial<Pizzeria> | null>(null);
  const [manualMode, setManualMode] = useState(false);
  const [customPizzeriaName, setCustomPizzeriaName] = useState('');
  const [customPizzeriaAddress, setCustomPizzeriaAddress] = useState('');
  const [customPizzeriaPhone, setCustomPizzeriaPhone] = useState('');
  const [customPizzeriaUrl, setCustomPizzeriaUrl] = useState('');
  const [customPizzeriaLocation, setCustomPizzeriaLocation] = useState<{ lat: number; lng: number } | null>(null);

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

  const handlePlaceSelected = (place: Partial<Pizzeria>) => {
    setSelectedPlace(place);
    setManualMode(false);
  };

  const addSelectedPlace = async () => {
    if (!selectedPlace?.name) return;
    if (selectedPizzerias.length >= 3) return;

    const pizzeria: Pizzeria = {
      id: selectedPlace.id || `custom-${crypto.randomUUID()}`,
      placeId: selectedPlace.placeId || '',
      name: selectedPlace.name,
      address: selectedPlace.address || '',
      phone: selectedPlace.phone,
      url: selectedPlace.url,
      rating: selectedPlace.rating,
      reviewCount: selectedPlace.reviewCount,
      priceLevel: selectedPlace.priceLevel,
      isOpen: selectedPlace.isOpen,
      location: selectedPlace.location || { lat: 0, lng: 0 },
      orderingOptions: selectedPlace.orderingOptions || [],
    };

    const newSelected = [...selectedPizzerias, pizzeria];
    setSelectedPizzerias(newSelected);
    resetModal();
    await savePizzerias(newSelected);
  };

  const addManualPizzeria = async () => {
    if (!customPizzeriaName.trim()) return;
    if (selectedPizzerias.length >= 3) return;

    const customPizzeria: Pizzeria = {
      id: `custom-${crypto.randomUUID()}`,
      placeId: '',
      name: customPizzeriaName.trim(),
      address: customPizzeriaAddress.trim() || '',
      phone: customPizzeriaPhone.trim() || undefined,
      url: customPizzeriaUrl.trim() || undefined,
      location: customPizzeriaLocation || { lat: 0, lng: 0 },
      orderingOptions: [],
    };

    const newSelected = [...selectedPizzerias, customPizzeria];
    setSelectedPizzerias(newSelected);
    resetModal();
    await savePizzerias(newSelected);
  };

  const resetModal = () => {
    setSelectedPlace(null);
    setManualMode(false);
    setCustomPizzeriaName('');
    setCustomPizzeriaAddress('');
    setCustomPizzeriaPhone('');
    setCustomPizzeriaUrl('');
    setCustomPizzeriaLocation(null);
    setShowAddPizzeriaModal(false);
  };

  const savePizzerias = async (pizzeriasToSave: Pizzeria[]) => {
    await saveField('pizzerias', { selected_pizzerias: pizzeriasToSave });
  };

  // Aggregate guest suggestions
  const guestSuggestions = React.useMemo(() => {
    if (!guests || guests.length === 0) return [];

    const sugMap = new Map<string, { pizzeria: Pizzeria; count: number; suggestedBy: string[] }>();

    for (const guest of guests) {
      if (!guest.suggestedPizzerias || guest.suggestedPizzerias.length === 0) continue;
      for (const p of guest.suggestedPizzerias) {
        const key = p.placeId || p.name;
        if (!key) continue;
        const existing = sugMap.get(key);
        if (existing) {
          existing.count++;
          existing.suggestedBy.push(guest.name);
        } else {
          sugMap.set(key, { pizzeria: p, count: 1, suggestedBy: [guest.name] });
        }
      }
    }

    return Array.from(sugMap.values()).sort((a, b) => b.count - a.count);
  }, [guests]);

  if (!party) return null;

  const innerContent = (
    <>
      {/* Header */}
      <div className="mb-3">
        <h3 className={embedded ? "text-sm font-semibold text-white/70 uppercase tracking-wider mb-1" : "text-xl font-bold text-white flex items-center gap-2 mb-1"}>
          {!embedded && <MapPin size={20} />}
          Pizzeria Selection
        </h3>
        <p className="text-xs text-white/50">
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
                  <div className="flex items-center gap-2">
                    <p className="text-white font-medium truncate">{pizzeria.name}</p>
                    {pizzeria.rating && (
                      <span className="flex items-center gap-1 text-xs text-yellow-400">
                        <Star size={12} className="fill-yellow-400" />
                        {pizzeria.rating.toFixed(1)}
                      </span>
                    )}
                  </div>
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

      {/* Guest Suggestions */}
      {guestSuggestions.length > 0 && (
        <div className="space-y-2 mb-3">
          <p className="text-xs text-white/60 font-medium flex items-center gap-1.5">
            <Users size={12} />
            Guest suggestions:
          </p>
          {guestSuggestions
            .filter(s => !selectedPizzerias.some(p => (p.placeId && p.placeId === s.pizzeria.placeId) || p.name === s.pizzeria.name))
            .map((suggestion) => (
              <button
                key={suggestion.pizzeria.placeId || suggestion.pizzeria.name}
                type="button"
                onClick={() => selectPizzeria(suggestion.pizzeria)}
                disabled={selectedPizzerias.length >= 3}
                className="w-full flex items-center justify-between p-3 bg-white/5 rounded-xl border border-white/10 hover:bg-white/10 hover:border-white/20 transition-all disabled:opacity-50 disabled:cursor-not-allowed text-left"
              >
                <div className="flex items-center gap-3 flex-1 min-w-0">
                  <div className="w-10 h-10 rounded-full bg-purple-500/20 flex items-center justify-center flex-shrink-0">
                    <Users className="w-5 h-5 text-purple-400" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-white font-medium truncate">{suggestion.pizzeria.name}</p>
                      {suggestion.pizzeria.rating && (
                        <span className="flex items-center gap-1 text-xs text-yellow-400">
                          <Star size={12} className="fill-yellow-400" />
                          {suggestion.pizzeria.rating.toFixed(1)}
                        </span>
                      )}
                      <span className="text-xs text-purple-400 bg-purple-400/10 px-1.5 py-0.5 rounded">
                        {suggestion.count} {suggestion.count === 1 ? 'vote' : 'votes'}
                      </span>
                    </div>
                    {suggestion.pizzeria.address && (
                      <p className="text-white/50 text-xs truncate">{suggestion.pizzeria.address}</p>
                    )}
                    <p className="text-white/30 text-xs truncate mt-0.5">
                      Suggested by {suggestion.suggestedBy.join(', ')}
                    </p>
                  </div>
                </div>
                <Plus size={18} className="text-white/40 flex-shrink-0" />
              </button>
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
    </>
  );

  return (
    <>
      {embedded ? (
        <div>{innerContent}</div>
      ) : (
        <div className="card p-6">{innerContent}</div>
      )}

      {/* Add Custom Pizzeria Modal */}
      {showAddPizzeriaModal && (
        <div className="fixed inset-0 z-50 flex items-start justify-center pt-20 p-4 bg-black/60 backdrop-blur-sm" onClick={resetModal}>
          <div className="bg-[#1a1a2e] border border-white/10 rounded-2xl shadow-xl max-w-md w-full p-5" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-white">Add Pizzeria</h2>
              <button onClick={resetModal} className="text-white/50 hover:text-white transition-colors">
                <X size={20} />
              </button>
            </div>

            {!manualMode && !selectedPlace && (
              <div className="space-y-3">
                <PlaceAutocomplete
                  onPlaceSelected={handlePlaceSelected}
                  placeholder="Search for a pizzeria..."
                  autoFocus
                />
                <button
                  type="button"
                  onClick={() => setManualMode(true)}
                  className="text-sm text-white/50 hover:text-white/80 transition-colors"
                >
                  Can't find it? Enter manually
                </button>
              </div>
            )}

            {/* Selected Place Preview */}
            {selectedPlace && (
              <div className="space-y-3">
                <div className="p-4 bg-white/5 rounded-xl border border-white/10">
                  <div className="flex items-center gap-2 mb-1">
                    <p className="text-white font-semibold">{selectedPlace.name}</p>
                    {selectedPlace.rating && (
                      <span className="flex items-center gap-1 text-xs text-yellow-400">
                        <Star size={12} className="fill-yellow-400" />
                        {selectedPlace.rating.toFixed(1)}
                        {selectedPlace.reviewCount && (
                          <span className="text-white/40">({selectedPlace.reviewCount})</span>
                        )}
                      </span>
                    )}
                  </div>
                  {selectedPlace.address && (
                    <p className="text-white/50 text-xs">{selectedPlace.address}</p>
                  )}
                  <div className="flex items-center gap-3 mt-2">
                    {selectedPlace.phone && (
                      <span className="text-white/40 text-xs flex items-center gap-1">
                        <Phone size={10} />
                        {selectedPlace.phone}
                      </span>
                    )}
                    {selectedPlace.url && (
                      <a
                        href={selectedPlace.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[#ff393a]/80 hover:text-[#ff393a] text-xs flex items-center gap-1"
                      >
                        <LinkIcon size={10} />
                        Website
                      </a>
                    )}
                    {selectedPlace.priceLevel && (
                      <span className="text-white/40 text-xs">
                        {'$'.repeat(selectedPlace.priceLevel)}
                      </span>
                    )}
                  </div>
                </div>

                <div className="flex gap-3">
                  <button
                    type="button"
                    onClick={() => setSelectedPlace(null)}
                    className="flex-1 bg-white/10 hover:bg-white/20 text-white font-medium py-2.5 rounded-lg transition-colors text-sm"
                  >
                    Back
                  </button>
                  <button
                    type="button"
                    onClick={addSelectedPlace}
                    className="flex-1 bg-[#ff393a] hover:bg-[#ff5a5b] text-white font-medium py-2.5 rounded-lg transition-colors text-sm flex items-center justify-center gap-2"
                  >
                    <Plus size={16} />
                    Add Pizzeria
                  </button>
                </div>
              </div>
            )}

            {/* Manual Entry Mode */}
            {manualMode && (
              <div className="space-y-3">
                <IconInput
                  icon={Store}
                  type="text"
                  value={customPizzeriaName}
                  onChange={(e) => setCustomPizzeriaName(e.target.value)}
                  placeholder="Pizzeria Name"
                  required
                  autoFocus
                />

                <LocationAutocomplete
                  value={customPizzeriaAddress}
                  onChange={setCustomPizzeriaAddress}
                  placeholder="Address"
                  onPlaceSelected={(address) => {
                    setCustomPizzeriaAddress(address);
                  }}
                />

                <IconInput
                  icon={Phone}
                  type="tel"
                  value={customPizzeriaPhone}
                  onChange={(e) => setCustomPizzeriaPhone(e.target.value)}
                  placeholder="Phone"
                />

                <IconInput
                  icon={LinkIcon}
                  type="url"
                  value={customPizzeriaUrl}
                  onChange={(e) => setCustomPizzeriaUrl(e.target.value)}
                  placeholder="Website URL"
                />

                <div className="flex gap-3">
                  <button
                    type="button"
                    onClick={() => setManualMode(false)}
                    className="flex-1 bg-white/10 hover:bg-white/20 text-white font-medium py-2.5 rounded-lg transition-colors text-sm"
                  >
                    Back
                  </button>
                  <button
                    type="button"
                    onClick={addManualPizzeria}
                    disabled={!customPizzeriaName.trim()}
                    className="flex-1 bg-[#ff393a] hover:bg-[#ff5a5b] disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium py-2.5 rounded-lg transition-colors text-sm flex items-center justify-center gap-2"
                  >
                    <Plus size={16} />
                    Add Pizzeria
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
};
