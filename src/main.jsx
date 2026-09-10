import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import ErrorBoundary from './components/ErrorBoundary.jsx';
import ConfigError from './components/ConfigError.jsx';
import { backendConfigError } from './data/supabaseClient.js';
import './styles.css';

// Register the offline shell. Dev is excluded so Vite's HMR assets are never
// cached out from under a reload.
//
// Note: the service worker only ever touches the Cache Storage API, which is a
// separate store from localStorage. Purging caches on activate — which is what
// every deploy does — cannot affect a saved season.
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      // No service worker just means no offline support; the app still runs.
    });
  });
}

// A production build with no backend configured stops here and says so, rather
// than starting up and showing an empty season.
const configError = backendConfigError();

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
      {configError ? <ConfigError missing={configError} /> : <App />}
    </ErrorBoundary>
  </React.StrictMode>,
);
