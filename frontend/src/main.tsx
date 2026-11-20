import { StrictMode, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
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
      {/* Wallet stack (wagmi/ConnectKit) is mounted lazily by <WalletGate> around wallet UI. */}
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    </Suspense>
    </ErrorBoundary>
  </StrictMode>
);
