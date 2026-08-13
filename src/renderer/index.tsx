import React from 'react';
import ReactDOM from 'react-dom/client';
import { Toaster } from 'react-hot-toast';
import App from './App';
import { ThemeProvider, initTheme } from './lib/theme/ThemeProvider';
import './lib/styles/globals.css';

// Apply the persisted theme before the first paint so the UI never flashes.
initTheme();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ThemeProvider>
      <App />
      <Toaster
        position="bottom-right"
        toastOptions={{
          style: {
            background: 'rgb(var(--color-card))',
            color: 'rgb(var(--color-foreground))',
            border: '1px solid rgb(var(--color-line) / 0.08)',
            borderRadius: '8px',
            fontSize: '13px',
          },
          success: {
            iconTheme: {
              primary: 'rgb(var(--color-success))',
              secondary: 'rgb(var(--color-card))',
            },
          },
          error: {
            iconTheme: {
              primary: 'rgb(var(--color-danger))',
              secondary: 'rgb(var(--color-card))',
            },
          },
          duration: 4000,
        }}
      />
    </ThemeProvider>
  </React.StrictMode>
);
