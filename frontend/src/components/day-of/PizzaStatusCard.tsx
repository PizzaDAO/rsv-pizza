import React, { useState, useEffect } from 'react';
import { Pizza, Phone, ExternalLink, Check } from 'lucide-react';
import { Party } from '../../types';
import { Checkbox } from '../Checkbox';

interface PizzaStatusCardProps {
  party: Party;
}

interface PizzeriaShape {
  name?: string;
  phone?: string;
  website?: string;
  address?: string;
}

/**
 * Day-of pizza partner status. Shows selected pizzerias with a tap-to-call,
 * plus a localStorage-persisted "Order placed" checkbox per pizzeria.
 */
export const PizzaStatusCard: React.FC<PizzaStatusCardProps> = ({ party }) => {
  const pizzerias = (party.selectedPizzerias || []) as PizzeriaShape[];
  const storageKey = `dayof.pizza.orderPlaced.${party.id}`;

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

  return (
    <div className="card p-5 space-y-3">
      <div className="flex items-center gap-2">
        <Pizza size={18} className="text-[#ff393a]" />
        <h3 className="text-lg font-semibold text-theme-text">Pizza partners</h3>
      </div>

      {pizzerias.length === 0 ? (
        <p className="text-sm text-theme-text-muted italic">No pizzerias selected.</p>
      ) : (
        <ul className="space-y-3">
          {pizzerias.map((p, idx) => {
            const key = `${p.name || 'pizzeria'}-${idx}`;
            const placed = !!orderState[key];
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
                      <p className="text-xs text-theme-text-muted truncate">{p.address}</p>
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
  );
};
