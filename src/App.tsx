import { supabaseConfiguration } from './lib/supabase'
import './App.css'

function App() {
  return (
    <div className="app-shell">
      <header className="site-header">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none">
              <path d="M7 3.75h7l4.25 4.3v12.2H7a2 2 0 0 1-2-2v-12.5a2 2 0 0 1 2-2Z" />
              <path d="M14 3.9v4.4h4.1M8.5 12h7M8.5 15.5h7" />
            </svg>
          </span>
          <span className="brand-name">Shyam <span>Project Notes</span></span>
        </div>
        <span className="header-label">PERSONAL WORKSPACE</span>
      </header>

      <main className="main-content">
        <section className="page-heading" aria-labelledby="page-title">
          <p className="eyebrow">A PLACE FOR WHAT YOU LEARN</p>
          <h1 id="page-title">My Practiced Notes</h1>
          <p className="page-description">
            A thoughtful home for the things you practice and want to remember.
          </p>
        </section>

        <section className="workspace" aria-label="Notes workspace">
          <div
            className={`connection-status connection-status--${supabaseConfiguration.state}`}
            role="status"
            aria-live="polite"
          >
            <span className="status-indicator" aria-hidden="true" />
            <span>{supabaseConfiguration.message}</span>
          </div>

          <div className="empty-state">
            <div className="empty-state-icon" aria-hidden="true">
              <svg viewBox="0 0 48 48" fill="none">
                <rect x="10.5" y="7.5" width="27" height="33" rx="5.5" />
                <path d="M18 18h12M18 24h12M18 30h7" />
                <path d="M15.5 7.8v-1a2.3 2.3 0 0 1 2.3-2.3h12.4a2.3 2.3 0 0 1 2.3 2.3v1" />
              </svg>
            </div>
            <h2>Your notes structure will appear here</h2>
            <p>
              This workspace is ready for setup. No notes have been created or
              saved yet.
            </p>
          </div>
        </section>
      </main>

      <footer className="site-footer">
        <span>Shyam Project Notes</span>
        <span>Made for learning, one note at a time.</span>
      </footer>
    </div>
  )
}

export default App
