import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.tsx';
import './styles/index.css';
import { pingWorker } from './api/workerClient.ts';

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);


if (import.meta.env.DEV) {
  console.debug('[main] env', {
    VITE_WORKER_BASE_URL: import.meta.env.VITE_WORKER_BASE_URL,
    VITE_WORKER_PROXY_TARGET: import.meta.env.VITE_WORKER_PROXY_TARGET,
    VITE_WORKER_PROXY_PATH: import.meta.env.VITE_WORKER_PROXY_PATH,
  });

  pingWorker()
    .then((res) => console.log('Workerからの返事:', res))
    .catch((err) => console.warn('Worker ping failed:', err));
}
