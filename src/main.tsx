import { createRoot } from 'react-dom/client';
import { App } from './App';
import { AppProvider } from './store';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <AppProvider>
    <App />
  </AppProvider>,
);

// オフライン対応（本番ビルドのみ。開発中はキャッシュで古い画面が出ないよう登録しない）
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => undefined);
  });
}
