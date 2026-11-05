import { QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ApiError } from './api/client';
import { keys } from './api/queries';
import { router } from './router';
import { applyStoredTheme } from './lib/theme';
import './styles.css';

applyStoredTheme();

const queryClient: QueryClient = new QueryClient({
  queryCache: new QueryCache({
    // An expired session on any request sends the operator back to sign-in.
    onError: (error) => {
      if (error instanceof ApiError && error.status === 401) {
        queryClient.setQueryData(keys.session, null);
      }
    },
  }),
  defaultOptions: {
    queries: {
      staleTime: 15_000,
      refetchOnWindowFocus: true,
      // Retry only what the gateway marked retryable, and never more than twice.
      retry: (count, error) => error instanceof ApiError && error.retryable && count < 2,
    },
    mutations: { retry: false },
  },
});

const container = document.getElementById('root');
if (!container) throw new Error('index.html is missing #root');

createRoot(container).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);
