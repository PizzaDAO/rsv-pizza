import { StrictMode, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { WagmiProvider } from 'wagmi';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ConnectKitProvider } from 'connectkit';
import { wagmiConfig } from './lib/wagmiConfig';
import App from './App.tsx';
import './i18n';
import './index.css';
import { ErrorBoundary, reportError } from './components/ErrorBoundary';

window.addEventListener('error', (e) => reportError('window.onerror', e.error ?? e.message));
window.addEventListener('unhandledrejection', (e) => reportError('unhandledrejection', e.reason));

const queryClient = new QueryClient();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
    <Suspense
      fallback={
        <div
          role="status"
          aria-label="Loading"
          style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#111', color: '#fff', fontFamily: 'system-ui, sans-serif' }}
        >
          Loading…
        </div>
      }
    >
      <WagmiProvider config={wagmiConfig}>
        <QueryClientProvider client={queryClient}>
          <ConnectKitProvider theme="midnight">
            <App />
          </ConnectKitProvider>
        </QueryClientProvider>
      </WagmiProvider>
    </Suspense>
    </ErrorBoundary>
  </StrictMode>
);
