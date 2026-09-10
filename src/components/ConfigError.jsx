import { C, FONT } from '../theme.js';

/**
 * Shown instead of the app when a production build has no backend configured.
 *
 * The alternative — starting up and falling back to local storage — would show
 * an empty season on a device that has none yet, which is indistinguishable
 * from having lost everything. Better to stop and say exactly what is missing.
 */
export default function ConfigError({ missing }) {
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
      <div style={{ maxWidth: 420 }}>
        <div style={{ fontSize: 20, fontWeight: 800 }}>This build has no backend configured</div>
        <div style={{ fontSize: 13.5, color: C.muted, fontWeight: 600, marginTop: 6 }}>
          The app stopped rather than starting up empty — an empty season looks
          the same as a lost one, and it isn&apos;t worth the doubt.
        </div>

        <div
          style={{
            background: '#FFF8E8',
            border: `1.5px solid ${C.amberLine}`,
            borderRadius: 13,
            padding: '12px 14px',
            marginTop: 16,
          }}
        >
          <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '.06em', color: '#6B4E00' }}>
            MISSING
          </div>
          {missing.map((name) => (
            <div key={name} style={{ fontSize: 14, fontWeight: 800, color: '#6B4E00', marginTop: 4 }}>
              {name}
            </div>
          ))}
        </div>

        <div style={{ fontSize: 13, color: C.muted, fontWeight: 600, marginTop: 16 }}>
          Set both in your hosting provider&apos;s environment variables, then{' '}
          <strong style={{ color: C.ink }}>redeploy</strong> — they are baked in
          at build time, so an existing deployment will not pick them up.
        </div>
        <div style={{ fontSize: 12, color: C.fog, fontWeight: 600, marginTop: 10 }}>
          Use the <strong>anon</strong> key, never the service role key.
        </div>
      </div>
    </div>
  );
}
