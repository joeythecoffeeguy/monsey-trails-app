import { createRoot } from 'react-dom/client';

import App from './App';
import { ErrorBoundary } from '@/components/error-boundary';

import './index.css';
import { APP_ROUTES, appUrl } from '@/lib/app-routes';

createRoot(document.getElementById('root')!, {
  // Keeps caught errors off reportError(), which would raise the dev overlay.
  onCaughtError: (error, errorInfo) => {
    console.error(error, errorInfo.componentStack);
  },
}).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>,
);

const passengerPath = appUrl(APP_ROUTES.passengers).replace(/\/+$/, '');
if (
  import.meta.env.PROD
  && 'serviceWorker' in navigator
  && window.location.pathname.replace(/\/+$/, '') === passengerPath
) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`, {
      scope: import.meta.env.BASE_URL,
    });
  });
}
