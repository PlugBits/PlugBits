import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.tsx';
import './styles/index.css';
import { pingWorker } from "./api/workerClient";

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);


pingWorker()
  .then((res) => console.log("Workerからの返事:", res))
  .catch((err) => console.error("エラー:", err));
