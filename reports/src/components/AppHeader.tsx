import { useMemo } from 'react';
import { useLocation } from 'react-router-dom';
import { getQueryParams } from '../utils/urlParams';

const AppHeader = () => {
  const location = useLocation();
  const params = useMemo(
    () => getQueryParams(location.search, location.hash),
    [location.search, location.hash],
  );
  const rawReturnOrigin = params.get('returnOrigin') ?? '';
  const safeReturnOrigin = useMemo(() => {
    if (!rawReturnOrigin) return '';
    try {
      const url = new URL(rawReturnOrigin);
      if (url.protocol !== 'http:' && url.protocol !== 'https:') return '';
      return url.toString();
    } catch {
      return '';
    }
  }, [rawReturnOrigin]);

  const handleBack = () => {
    if (safeReturnOrigin) {
      window.location.href = safeReturnOrigin;
      return;
    }
    if (window.history.length > 1) {
      window.history.back();
      return;
    }
    window.location.href = '/#/';
  };

  return (
    <header className="app-header">
      <div className="app-header-left">
        <button
          type="button"
          className="ghost app-back-button"
          onClick={handleBack}
        >
          ← 設定に戻る
        </button>
        <p className="app-title">PlugBits 帳票デザイナー</p>
      </div>
      <nav className="app-nav">
        <a href="https://plugbits.com" target="_blank" rel="noreferrer">
          ドキュメント
        </a>
      </nav>
    </header>
  );
};

export default AppHeader;
