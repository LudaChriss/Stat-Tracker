import { Component } from 'react';
import { C, FONT, btn } from '../theme.js';

/**
 * Last line of defence. A render error would otherwise blank the screen with
 * no way back — and on a phone the only copy of the season is in this
 * browser's localStorage. So the fallback's first job is to get the data out.
 *
 * It reads storage directly rather than going through app state, which by
 * definition can't be trusted at this point.
 */
export default class ErrorBoundary extends Component {
  state = { error: null };

  static getDerivedStateFromError(error) {
    return { error };
  }

  saveBackup = () => {
    try {
      const raw = localStorage.getItem('score-tracker:state');
      if (!raw) return;
      const url = URL.createObjectURL(new Blob([raw], { type: 'application/json' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `score-tracker-recovery-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      /* nothing more we can do */
    }
  };

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <div
        style={{
          minHeight: '100vh',
          display: 'grid',
          placeItems: 'center',
          padding: 24,
          background: C.bg,
          fontFamily: FONT,
          color: C.ink,
        }}
      >
        <div style={{ maxWidth: 380 }}>
          <div style={{ fontSize: 20, fontWeight: 800 }}>Something went wrong</div>
          <div style={{ fontSize: 13.5, color: C.muted, fontWeight: 600, marginTop: 6 }}>
            Your season is still saved on this device. Download a copy before
            anything else, then reload.
          </div>
          <button
            onClick={this.saveBackup}
            style={{
              width: '100%',
              marginTop: 16,
              background: C.coral,
              border: 'none',
              color: '#fff',
              borderRadius: 14,
              padding: 15,
              fontSize: 15,
              fontWeight: 800,
              ...btn,
            }}
          >
            ⤓ Download my data
          </button>
          <button
            onClick={() => window.location.reload()}
            style={{
              width: '100%',
              marginTop: 8,
              background: '#fff',
              border: `1.5px solid ${C.stroke}`,
              color: C.header,
              borderRadius: 14,
              padding: 13,
              fontSize: 14,
              fontWeight: 800,
              ...btn,
            }}
          >
            Reload the app
          </button>
          <pre
            style={{
              marginTop: 14,
              fontSize: 11,
              color: C.fog,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
            }}
          >
            {String(this.state.error && this.state.error.message)}
          </pre>
        </div>
      </div>
    );
  }
}
