import React, { useState, useEffect, useMemo } from 'react';
import { Pizza, Phone, ExternalLink, Check, Users } from 'lucide-react';
import { Party, Guest } from '../../types';
import { Checkbox } from '../Checkbox';
import { usePizza } from '../../contexts/PizzaContext';

interface PizzaStatusCardProps {
  party: Party;
  guests?: Guest[];
}

interface PizzeriaShape {
  name?: string;
  phone?: string;
  website?: string;
  address?: string;
}

/**
 * Day-of pizza partner status. Ordering pizza is the single most important
 * day-of task, so this card sits at the top of the Party Guide dashboard
 * (capicola-71402) and surfaces:
 *   - A clear call-to-action with an "Order placed" toggle persisted to
 *     localStorage per pizzeria.
 *   - A brief summary of guest preferences (dietary, top toppings, top
 *     beverages) so the host can use it to inform the order without
 *     digging into the Guests/Pizza tabs.
 *   - The selected pizzerias with tap-to-call / tap-to-map / site links.
 */
export const PizzaStatusCard: React.FC<PizzaStatusCardProps> = ({ party, guests }) => {
  const pizzerias = (party.selectedPizzerias || []) as PizzeriaShape[];
  const storageKey = `dayof.pizza.orderPlaced.${party.id}`;
  const { availableToppings, availableBeverages } = usePizza();

  const [orderState, setOrderState] = useState<Record<string, boolean>>({});

  useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) setOrderState(JSON.parse(raw));
    } catch {
      /* ignore */
    }
  }, [storageKey]);

  const toggle = (key: string) => {
    setOrderState((prev) => {
      const next = { ...prev, [key]: !prev[key] };
      try {
        localStorage.setItem(storageKey, JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  };

  // ---- Guest preference aggregation -------------------------------------
  // Falls back to party.guests if the caller didn't pass a refreshed list.
  const effectiveGuests = useMemo<Guest[]>(
    () => guests ?? party.guests ?? [],
    [guests, party.guests]
  );

  // Restrict to actually-attending guests (skip declined / waitlisted / rejected).
  // approved===false means the host explicitly rejected the RSVP.
  // status==='DECLINED' / 'WAITLISTED' should not influence the order.
  const attendingGuests = useMemo<Guest[]>(() => {
    return effectiveGuests.filter((g) => {
      if (g.approved === false) return false;
      if (g.status === 'DECLINED' || g.status === 'WAITLISTED') return false;
      return true;
    });
  }, [effectiveGuests]);

  const guestStats = useMemo(() => {
    const total = attendingGuests.length;
    const confirmed = attendingGuests.filter(
      (g) => g.status === 'CONFIRMED' || g.approved === true
    ).length;
    const waitlisted = effectiveGuests.filter((g) => g.status === 'WAITLISTED').length;
    return { total, confirmed, waitlisted };
  }, [attendingGuests, effectiveGuests]);

  // Dietary: case-insensitive count of unique restriction strings.
  const dietaryCounts = useMemo<Array<{ label: string; count: number }>>(() => {
    const counts = new Map<string, { label: string; count: number }>();
    attendingGuests.forEach((g) => {
      (g.dietaryRestrictions || []).forEach((raw) => {
        const trimmed = String(raw || '').trim();
        if (!trimmed) return;
        const key = trimmed.toLowerCase();
        const existing = counts.get(key);
        if (existing) {
          existing.count += 1;
        } else {
          counts.set(key, { label: trimmed, count: 1 });
        }
      });
    });
    return Array.from(counts.values()).sort((a, b) => b.count - a.count);
  }, [attendingGuests]);

  // Toppings: net = liked - disliked, keep entries with net > 0.
  const topToppings = useMemo<Array<{ label: string; count: number }>>(() => {
    const net = new Map<string, number>();
    attendingGuests.forEach((g) => {
      (g.toppings || []).forEach((id) => {
        net.set(id, (net.get(id) || 0) + 1);
      });
      (g.dislikedToppings || []).forEach((id) => {
        net.set(id, (net.get(id) || 0) - 1);
      });
    });
    const nameById = (id: string) =>
      availableToppings.find((t) => t.id === id)?.name || id;
    return Array.from(net.entries())
      .filter(([, count]) => count > 0)
      .map(([id, count]) => ({ label: nameById(id), count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);
  }, [attendingGuests, availableToppings]);

  // Beverages: same net logic.
  const topBeverages = useMemo<Array<{ label: string; count: number }>>(() => {
    const net = new Map<string, number>();
    attendingGuests.forEach((g) => {
      (g.likedBeverages || []).forEach((id) => {
        net.set(id, (net.get(id) || 0) + 1);
      });
      (g.dislikedBeverages || []).forEach((id) => {
        net.set(id, (net.get(id) || 0) - 1);
      });
    });
    const nameById = (id: string) =>
      availableBeverages.find((b) => b.id === id)?.name || id;
    return Array.from(net.entries())
      .filter(([, count]) => count > 0)
      .map(([id, count]) => ({ label: nameById(id), count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);
  }, [attendingGuests, availableBeverages]);

  const hasAnyPrefData =
    dietaryCounts.length > 0 || topToppings.length > 0 || topBeverages.length > 0;

  const isGppEvent = party.eventType === 'gpp';

  return (
    <div className="card p-5 space-y-4 border border-[#ff393a]/40 bg-theme-surface">
      {/* ---- Call to action ---- */}
      <div className="space-y-1.5">
        <div className="flex items-center gap-2">
          <Pizza size={22} className="text-[#ff393a]" />
          <h3 className="text-xl font-bold text-theme-text">Order the pizza</h3>
        </div>
        <p className="text-sm text-theme-text-muted">
          This is the most important thing you'll do today.
        </p>
      </div>

      {/* ---- Guest preference summary ---- */}
      {guestStats.total > 0 && (
        <div className="rounded-lg border border-white/10 bg-black/20 p-3 space-y-2">
          <div className="flex items-center gap-2 text-sm font-semibold text-theme-text">
            <Users size={14} className="text-[#ff393a]" />
            <span>Guest preferences</span>
          </div>

          {/* Headline counts */}
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm">
            <span className="text-theme-text">
              <span className="font-semibold">{guestStats.total}</span>{' '}
              {guestStats.total === 1 ? 'guest' : 'guests'}
            </span>
            {guestStats.waitlisted > 0 && (
              <span className="text-theme-text-muted text-xs">
                ({guestStats.waitlisted} waitlisted)
              </span>
            )}
          </div>

          {/* Dietary breakdown */}
          {dietaryCounts.length > 0 && (
            <div>
              <p className="text-xs uppercase tracking-wide text-theme-text-faint mb-1">
                Dietary
              </p>
              <div className="flex flex-wrap gap-1.5">
                {dietaryCounts.map(({ label, count }) => (
                  <span
                    key={label}
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-purple-500/15 text-purple-200 text-xs border border-purple-500/30"
                  >
                    <span>{label}</span>
                    <span className="px-1 rounded bg-purple-500/30 text-purple-100 font-semibold">
                      {count}
                    </span>
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Top toppings */}
          {topToppings.length > 0 && (
            <div>
              <p className="text-xs uppercase tracking-wide text-theme-text-faint mb-1">
                Top toppings
              </p>
              <div className="flex flex-wrap gap-1.5">
                {topToppings.map(({ label, count }) => (
                  <span
                    key={label}
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-[#ff393a]/15 text-[#ff8a8b] text-xs border border-[#ff393a]/30"
                  >
                    <span>{label}</span>
                    <span className="px-1 rounded bg-[#ff393a]/30 text-white font-semibold">
                      {count}
                    </span>
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Top beverages (hide for GPP events — beverages are de-emphasized there) */}
          {!isGppEvent && topBeverages.length > 0 && (
            <div>
              <p className="text-xs uppercase tracking-wide text-theme-text-faint mb-1">
                Top beverages
              </p>
              <div className="flex flex-wrap gap-1.5">
                {topBeverages.map(({ label, count }) => (
                  <span
                    key={label}
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-blue-500/15 text-blue-200 text-xs border border-blue-500/30"
                  >
                    <span>{label}</span>
                    <span className="px-1 rounded bg-blue-500/30 text-blue-100 font-semibold">
                      {count}
                    </span>
                  </span>
                ))}
              </div>
            </div>
          )}

          {!hasAnyPrefData && (
            <p className="text-xs text-theme-text-muted italic">
              No preference data submitted yet.
            </p>
          )}
        </div>
      )}

      {/* ---- Selected pizzerias ---- */}
      <div className="space-y-2">
        <p className="text-xs uppercase tracking-wide text-theme-text-faint">
          Pizza partners
        </p>
        {pizzerias.length === 0 ? (
          <p className="text-sm text-theme-text-muted italic">
            No pizzerias selected yet — pick one on the Pizza tab.
          </p>
        ) : (
          <ul className="space-y-3">
            {pizzerias.map((p, idx) => {
              const key = `${p.name || 'pizzeria'}-${idx}`;
              const placed = !!orderState[key];
              const mapsUrl = p.address
                ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(p.address)}`
                : null;
              return (
                <li
                  key={key}
                  className={`p-3 rounded-lg border ${
                    placed ? 'border-green-500/40 bg-green-500/5' : 'border-white/10'
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-theme-text truncate">
                        {p.name || 'Pizzeria'}
                      </p>
                      {p.address && (
                        mapsUrl ? (
                          <a
                            href={mapsUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs text-theme-text-muted truncate hover:text-theme-text hover:underline block"
                          >
                            {p.address}
                          </a>
                        ) : (
                          <p className="text-xs text-theme-text-muted truncate">{p.address}</p>
                        )
                      )}
                      <div className="flex gap-3 mt-1.5">
                        {p.phone && (
                          <a
                            href={`tel:${p.phone}`}
                            className="inline-flex items-center gap-1 text-sm text-[#ff393a] hover:underline"
                          >
                            <Phone size={14} />
                            {p.phone}
                          </a>
                        )}
                        {p.website && (
                          <a
                            href={p.website}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-sm text-theme-text-secondary hover:underline"
                          >
                            <ExternalLink size={14} />
                            Site
                          </a>
                        )}
                      </div>
                    </div>
                    {placed && <Check size={18} className="text-green-500 flex-shrink-0" />}
                  </div>
                  <div className="mt-2">
                    <Checkbox
                      checked={placed}
                      onChange={() => toggle(key)}
                      label="Order placed"
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
};
