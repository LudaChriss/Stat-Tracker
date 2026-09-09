import { C, btn, tnum } from '../../theme.js';
import { Avatar, DarkCard } from '../../components/ui.jsx';
import Diamond from './Diamond.jsx';

const pill = {
  border: 'none',
  color: '#fff',
  borderRadius: 9,
  padding: '0 11px',
  minHeight: 42,
  fontSize: 12.5,
  fontWeight: 800,
  ...btn,
};

/** Controls that appear when a runner on base is selected. */
function RunnerBar({ v, actions }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        margin: '2px 18px',
        background: C.panelHi,
        border: '1px solid rgba(45,225,252,.35)',
        borderRadius: 12,
        padding: '8px 12px',
        animation: 'popIn .18s ease-out',
      }}
    >
      <span style={{ flex: 1, fontSize: 12.5, fontWeight: 700, color: '#fff' }}>
        {v.selName} on {v.selBase}
      </span>
      <button
        onClick={actions.runnerAction('back')}
        style={{
          ...pill,
          background: 'rgba(255,255,255,.12)',
          border: '1px solid rgba(255,255,255,.25)',
          opacity: v.selBackOp,
        }}
      >
        ‹ Back
      </button>
      <button onClick={actions.runnerAction(true)} style={{ ...pill, background: C.teal }}>
        Adv ›
      </button>
      <button onClick={actions.runnerAction(false)} style={{ ...pill, background: C.coral }}>
        Out
      </button>
      <button
        onClick={actions.clearSel}
        style={{ background: 'none', border: 'none', color: C.mist, fontSize: 12.5, fontWeight: 700, ...btn }}
      >
        ✕
      </button>
    </div>
  );
}

/** Opponent quick-score panel, shown when we aren't tracking their at-bats. */
function QuickScore({ v, actions }) {
  return (
    <div style={{ padding: '8px 16px 16px' }}>
      <DarkCard style={{ padding: '14px 16px' }}>
        <div style={{ fontSize: 13, fontWeight: 800 }}>{v.opponent} at kick</div>
        <div style={{ fontSize: 11.5, color: C.mist, fontWeight: 600, marginTop: 3 }}>
          You're not tracking their at-bats. Adjust their runs if any score, then start your half.
        </div>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 14,
            marginTop: 14,
          }}
        >
          <button
            onClick={actions.quickRunMinus}
            style={{
              background: 'none',
              border: '1.5px solid rgba(255,255,255,.25)',
              color: '#fff',
              borderRadius: 99,
              width: 44,
              height: 44,
              fontSize: 19,
              fontWeight: 800,
              ...btn,
            }}
          >
            −
          </button>
          <span
            style={{ minWidth: 56, textAlign: 'center', fontSize: 34, fontWeight: 800, color: '#fff', ...tnum }}
          >
            {v.score.away}
          </span>
          <button
            onClick={() => actions.quick(true)}
            style={{
              background: C.teal,
              border: 'none',
              color: '#fff',
              borderRadius: 99,
              width: 44,
              height: 44,
              fontSize: 19,
              fontWeight: 800,
              ...btn,
            }}
          >
            +
          </button>
        </div>
        <div
          style={{
            textAlign: 'center',
            fontSize: 10,
            fontWeight: 800,
            letterSpacing: '.08em',
            color: C.muted,
            marginTop: 4,
          }}
        >
          THEIR RUNS
        </div>
      </DarkCard>
      <button
        onClick={actions.endTheirHalf}
        className="press-lg"
        style={{
          width: '100%',
          marginTop: 10,
          minHeight: 60,
          background: C.coral,
          border: 'none',
          color: '#fff',
          borderRadius: 15,
          fontSize: 16,
          fontWeight: 800,
          ...btn,
        }}
      >
        Their half is over — we're up
      </button>
    </div>
  );
}

export default function EntryTab({ v, actions }) {
  return (
    <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
      {/* Diamond + who's up */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px 4px' }}>
        <Diamond b1={v.b1} b2={v.b2} b3={v.b3} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontSize: 10.5,
              fontWeight: 800,
              letterSpacing: '.08em',
              textTransform: 'uppercase',
              color: C.muted,
            }}
          >
            {v.kickerHeading}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginTop: 5 }}>
            <Avatar
              ini={v.kicker.ini}
              c={v.kicker.c}
              size={42}
              fs={16}
              style={{ border: '2px solid rgba(45,225,252,.4)' }}
            />
            <span style={{ minWidth: 0 }}>
              <span
                style={{
                  display: 'block',
                  fontSize: 17,
                  fontWeight: 800,
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                {v.kicker.name}
              </span>
              <span style={{ display: 'block', fontSize: 11, color: C.mist, fontWeight: 700, ...tnum }}>
                {v.kicker.line}
              </span>
              <span
                style={{
                  display: 'block',
                  fontSize: 11,
                  color: C.cyan,
                  fontWeight: 800,
                  marginTop: 1,
                  ...tnum,
                }}
              >
                {v.kickerToday}
              </span>
            </span>
          </div>
        </div>
      </div>

      {/* On deck / in the hole */}
      <div style={{ display: 'flex', gap: 8, padding: '4px 14px 2px', overflowX: 'auto' }}>
        {v.onDeck.map((d) => (
          <div
            key={d.tag}
            style={{
              flex: '0 0 auto',
              display: 'flex',
              alignItems: 'center',
              gap: 7,
              background: C.panel,
              border: '1px solid rgba(255,255,255,.1)',
              borderRadius: 99,
              padding: '5px 12px 5px 6px',
            }}
          >
            <Avatar ini={d.ini} c={d.c} size={22} fs={9} />
            <span style={{ fontSize: 11, fontWeight: 800, color: C.muted, whiteSpace: 'nowrap' }}>
              {d.tag} <span style={{ color: '#fff' }}>{d.name}</span>{' '}
              <span style={{ color: C.mist, fontWeight: 700, ...tnum }}>{d.stat}</span>
            </span>
          </div>
        ))}
      </div>

      {v.hasSel && <RunnerBar v={v} actions={actions} />}

      {/* Undo + last play */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 18px 2px', minHeight: 30 }}>
        <button
          onClick={actions.undo}
          style={{
            background: 'none',
            border: '1.5px solid rgba(255,255,255,.25)',
            color: '#fff',
            borderRadius: 99,
            padding: '0 16px',
            minHeight: 44,
            fontSize: 12.5,
            fontWeight: 800,
            flex: '0 0 auto',
            ...btn,
          }}
        >
          ↩ Undo
        </button>
        {v.hasLast && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 7,
              minWidth: 0,
              animation: 'popIn .2s ease-out',
            }}
          >
            <span
              style={{
                background: 'rgba(45,225,252,.15)',
                color: C.cyan,
                borderRadius: 6,
                padding: '2px 7px',
                fontSize: 11.5,
                fontWeight: 800,
                flex: '0 0 auto',
                ...tnum,
              }}
            >
              {v.lastK}
            </span>
            <span
              style={{
                fontSize: 12,
                fontWeight: 600,
                color: C.mist,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {v.lastDetail}
            </span>
          </div>
        )}
      </div>

      <div
        style={{
          padding: '2px 18px 4px',
          fontSize: 10.5,
          fontWeight: 700,
          color: C.slate,
          letterSpacing: '.06em',
          ...tnum,
        }}
      >
        SCOREBOOK&nbsp;&nbsp;{v.tapeStr}
      </div>

      <div style={{ flex: 1 }} />

      {v.quickMode ? (
        <QuickScore v={v} actions={actions} />
      ) : (
        <div style={{ padding: '8px 14px 14px', display: 'flex', flexDirection: 'column', gap: 9 }}>
          {v.groups.map((grp) => (
            <div key={grp.label}>
              <div
                style={{
                  fontSize: 10.5,
                  fontWeight: 800,
                  letterSpacing: '.1em',
                  color: C.muted,
                  margin: '0 4px 5px',
                }}
              >
                {grp.label}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 7 }}>
                {grp.outcomes.map((o) => (
                  <button
                    key={o.k}
                    onClick={o.onTap}
                    className="press"
                    style={{
                      minHeight: 52,
                      borderRadius: 13,
                      border: o.bd,
                      background: o.bg,
                      color: o.fg,
                      fontSize: 15,
                      fontWeight: 800,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 7,
                      ...btn,
                    }}
                  >
                    {o.label}
                    <span style={{ fontSize: 10.5, fontWeight: 800, opacity: 0.6, ...tnum }}>{o.k}</span>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
