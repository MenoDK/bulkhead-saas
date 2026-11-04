import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App } from './App';
import { ApiClient, ApiError } from './lib/api';
import { ApiProvider } from './lib/ApiContext';
import './styles.css';
import { ThemeProvider } from './theme/ThemeProvider';
import { ToastProvider } from './ui/Toast';

const api = new ApiClient({ baseUrl: '/api' });
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 15_000,
      refetchOnWindowFocus: true,
      // Retrying a 4xx never helps; transient failures get two quiet retries.
      retry: (count, error) => !(error instanceof ApiError && error.status < 500) && count < 2,
    },
  },
});

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root element');

createRoot(root).render(
  <StrictMode>
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <ApiProvider client={api}>
          <ToastProvider>
            <BrowserRouter basename={import.meta.env.BASE_URL.replace(/\/$/, '')}>
              <App />
            </BrowserRouter>
          </ToastProvider>
        </ApiProvider>
      </QueryClientProvider>
    </ThemeProvider>
  </StrictMode>,
);
