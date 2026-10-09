import React from 'react';
import Sidebar from './Sidebar';
import Topbar from './Topbar';

export default function Layout({ children }) {
  return (
    <div className="app-shell">
      <Sidebar />

      <main className="content-area">
        <Topbar />
        <div className="page-content">{children}</div>
      </main>
    </div>
  );
}
