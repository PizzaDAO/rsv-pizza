import { StrictMode, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { WagmiProvider } from 'wagmi';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ConnectKitProvider } from 'connectkit';
import posthog from 'posthog-js';
import { wagmiConfig } from './lib/wagmiConfig';
import App from './App.tsx';
import './i18n';
import './index.css';

const ADMIN_ROUTES: RegExp[] = [
  /^\/underboss(\/|$)/,
  /^\/admin(\/|$)/,
  /^\/shipping(\/|$)/,
  /^\/graphics(\/|$)/,
  /^\/partner(\/|$)/,        // matches /partner and /partner/*, NOT /partner-intake/*
  /^\/host(\/|$)/,
  /^\/checkin(\/|$)/,
  /^\/dj(\/|$)/,
  /^\/post(\/|$)/,
  /^\/display(\/|$)/,
  /^\/account(\/|$)/,
  /^\/new$/,
];

const posthogKey = import.meta.env.VITE_POSTHOG_KEY;
if (posthogKey) {
  posthog.init(posthogKey, {
    api_host: 'https://eu.i.posthog.com',
    autocapture: { url_ignorelist: ADMIN_ROUTES },
  });
}

const queryClient = new QueryClient();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Suspense fallback={null}>
      <WagmiProvider config={wagmiConfig}>
        <QueryClientProvider client={queryClient}>
          <ConnectKitProvider theme="midnight">
            <App />
          </ConnectKitProvider>
        </QueryClientProvider>
      </WagmiProvider>
    </Suspense>
  </StrictMode>
);
