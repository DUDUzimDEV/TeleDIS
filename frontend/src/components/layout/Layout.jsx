import React, { useEffect, useState } from 'react';
import Sidebar from './Sidebar';
import Topbar from './Topbar';

export default function Layout({ children }) {
  const [mobileNavigationOpen, setMobileNavigationOpen] = useState(false);

  useEffect(() => {
    if (!mobileNavigationOpen) return undefined;
    function closeOnEscape(event) {
      if (event.key === 'Escape') setMobileNavigationOpen(false);
    }
    document.addEventListener('keydown', closeOnEscape);
    return () => document.removeEventListener('keydown', closeOnEscape);
  }, [mobileNavigationOpen]);

  return (
    <div className={`app-shell${mobileNavigationOpen ? ' mobile-navigation-open' : ''}`}>
      {mobileNavigationOpen ? (
        <button
          className="sidebar-backdrop"
          type="button"
          aria-label="Fechar menu"
          onClick={() => setMobileNavigationOpen(false)}
        />
      ) : null}
      <Sidebar
        mobileOpen={mobileNavigationOpen}
        onNavigate={() => setMobileNavigationOpen(false)}
      />

      <main className="content-area">
        <Topbar
          menuOpen={mobileNavigationOpen}
          onMenuClick={() => setMobileNavigationOpen((open) => !open)}
        />
        <div className="page-content">{children}</div>
      </main>
    </div>
  );
}
