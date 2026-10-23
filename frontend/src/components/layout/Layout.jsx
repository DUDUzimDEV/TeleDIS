import React, { useEffect, useState } from 'react';
import Sidebar from './Sidebar';
import Topbar from './Topbar';

export default function Layout({ children }) {
  const [mobileNavigationOpen, setMobileNavigationOpen] = useState(false);
  const [presentationMode, setPresentationMode] = useState(() => localStorage.getItem('teledis_presentation_mode') === 'true');

  useEffect(() => {
    document.documentElement.classList.toggle('presentation-mode', presentationMode);
    localStorage.setItem('teledis_presentation_mode', String(presentationMode));
    return () => document.documentElement.classList.remove('presentation-mode');
  }, [presentationMode]);

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
        presentationMode={presentationMode}
      />

      <main className="content-area">
        <Topbar
          menuOpen={mobileNavigationOpen}
          onMenuClick={() => setMobileNavigationOpen((open) => !open)}
          presentationMode={presentationMode}
          onTogglePresentation={() => setPresentationMode((active) => !active)}
        />
        <div className="page-content">{children}</div>
      </main>
    </div>
  );
}
