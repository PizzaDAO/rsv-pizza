import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { AUTH_EXPIRED_EVENT } from '../lib/api';
import type { BankDetails, PayoutMethod } from '../types';

interface User {
  id: string;
  email: string;
  name?: string;
  username?: string;
  bio?: string;
  profilePictureUrl?: string;
  instagram?: string;
  twitter?: string;
  youtube?: string;
  tiktok?: string;
  linkedin?: string;
  website?: string;
  // arugula-38633 v3: persistent payout prefs, edited from PaymentDetailsCard
  // on the Payments tab. Hydrated by AuthContext via fetchUserMe() on mount
  // (when an auth token is present) so PaymentDetailsCard can render the
  // saved values without an extra round-trip.
  preferredPayoutMethod?: PayoutMethod | null;
  payoutWalletAddress?: string | null;
  payoutBankDetails?: BankDetails | null;
}

interface AuthContextType {
  user: User | null;
  loading: boolean;
  signIn: (email: string) => Promise<void>;
  signOut: () => void;
  setUser: (user: User | null) => void;
  updateProfile: (data: Partial<Omit<User, 'id' | 'email'>>) => Promise<User>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3006';

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  // Handle auth expiration event from API
  const handleAuthExpired = useCallback(() => {
    console.log('Auth token expired, clearing user state');
    setUser(null);
    // Storage is already cleared by apiRequest, but ensure consistency
    localStorage.removeItem('authToken');
    localStorage.removeItem('user');
  }, []);

  // Check for stored token on mount
  useEffect(() => {
    const token = localStorage.getItem('authToken');
    const storedUser = localStorage.getItem('user');

    if (token && storedUser) {
      try {
        setUser(JSON.parse(storedUser));
      } catch (error) {
        console.error('Error parsing stored user:', error);
        localStorage.removeItem('authToken');
        localStorage.removeItem('user');
      }
    }

    setLoading(false);
  }, []);

  // arugula-38633 v3: once we have an auth token, fetch the full /me record so
  // payout prefs (preferredPayoutMethod, payoutWalletAddress, payoutBankDetails)
  // are available to PaymentDetailsCard + NewPayoutForm without per-component
  // round-trips. We deliberately MERGE the response into the existing user
  // (rather than replacing it) — `/api/user/me` selects a narrower field set
  // than what's in localStorage, and we don't want to drop username/social
  // links that other UIs depend on.
  useEffect(() => {
    const token = localStorage.getItem('authToken');
    if (!token || !user?.id) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${API_URL}/api/user/me`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) return;
        const data = await res.json();
        const me = data?.user;
        if (!me || cancelled) return;
        setUser(prev => {
          if (!prev) return prev;
          const merged: User = {
            ...prev,
            preferredPayoutMethod: me.preferredPayoutMethod ?? null,
            payoutWalletAddress: me.payoutWalletAddress ?? null,
            payoutBankDetails: me.payoutBankDetails ?? null,
          };
          try { localStorage.setItem('user', JSON.stringify(merged)); } catch { /* quota */ }
          return merged;
        });
      } catch {
        // Network blip — fine, PaymentDetailsCard can still operate from its
        // own state; the merge will retry on next mount.
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  // Listen for auth expiration events
  useEffect(() => {
    window.addEventListener(AUTH_EXPIRED_EVENT, handleAuthExpired);
    return () => {
      window.removeEventListener(AUTH_EXPIRED_EVENT, handleAuthExpired);
    };
  }, [handleAuthExpired]);

  const signIn = async (email: string) => {
    const response = await fetch(`${API_URL}/api/auth/magic-link`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || 'Failed to send magic link');
    }

    return response.json();
  };

  const signOut = () => {
    localStorage.removeItem('authToken');
    localStorage.removeItem('user');
    setUser(null);
  };

  const updateProfile = async (data: Partial<Omit<User, 'id' | 'email'>>): Promise<User> => {
    const token = localStorage.getItem('authToken');
    if (!token) {
      throw new Error('Not authenticated');
    }

    const response = await fetch(`${API_URL}/api/auth/profile`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify(data),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || 'Failed to update profile');
    }

    const result = await response.json();
    const updatedUser = result.user;

    // Update local state and storage
    setUser(updatedUser);
    localStorage.setItem('user', JSON.stringify(updatedUser));

    return updatedUser;
  };

  return (
    <AuthContext.Provider value={{ user, loading, signIn, signOut, setUser, updateProfile }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
