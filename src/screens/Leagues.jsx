import { useEffect, useMemo, useState } from 'react';
import { C, btn, tnum } from '../theme.js';
import { Avatar, Card, Section } from '../components/ui.jsx';
import {
  LEAGUE_INVITABLE_ROLES,
  LEAGUE_ROLE_BLURB,
  LEAGUE_ROLE_LABEL,
  bucketLeagueGames,
  normalizeCode,
  scorerLine,
} from '../data/leagues.js';
import { leagueLeaders, leagueStandings, statLabel } from '../game/leagueTables.js';
import { initials } from '../game/logic.js';
import { rateString } from '../game/stats.js';

// One screen for both halves of a league: the ones you are in, and the one you
// are looking at. Two screens would mean two places for "which league am I on"
// to be true, and a back button that has to know which.
//
// Everything a commissioner can do is behind their own role, read from the
// database rather than assumed — the same rule the invite button follows. A
// follower sees the same league and no buttons that would be refused.

const label = { fontSize: 12.5, color: C.muted, fontWeight: 600, lineHeight: 1.45 };

const primary = {
  width: '100%',
  marginTop: 12,
  background: C.coral,
  border: 'none',
  color: '#fff',
  borderRadius: 14,
  padding: 14,
  minHeight: 48,
  fontSize: 15,
  fontWeight: 800,
  ...btn,
};

const secondary = {
  width: '100%',
  marginTop: 8,
  background: '#fff',
  border: `1.5px solid ${C.stroke}`,
  color: C.ink,
  borderRadius: 14,
  padding: 13,
  minHeight: 48,
  fontSize: 15,
  fontWeight: 800,
  ...btn,
};

const quiet = {
  background: 'none',
  border: 'none',
  color: C.muted,
  padding: '12px 4px',
  minHeight: 44,
  fontSize: 13.5,
  fontWeight: 700,
  ...btn,
};

const field = {
  width: '100%',
  boxSizing: 'border-box',
  marginTop: 8,
  border: `1.5px solid ${C.stroke}`,
  borderRadius: 13,
  padding: '13px 12px',
  minHeight: 48,
  fontSize: 15,
  fontWeight: 700,
  color: C.ink,
};

const noticeBlock = {
  marginTop: 12,
  background: '#DDF1F4',
  border: `1px solid ${C.teal}`,
  borderRadius: 11,
  padding: '9px 11px',
  fontSize: 12.5,
  color: C.ink,
  fontWeight: 600,
  lineHeight: 1.45,
};

const errorBlock = {
  marginTop: 12,
  background: '#FFECE6',
  border: `1px solid ${C.coral}`,
  borderRadius: 11,
  padding: '9px 11px',
  fontSize: 12.5,
  color: C.ink,
  fontWeight: 600,
  lineHeight: 1.45,
};

function Header({ title, sub, onBack }) {
  return (
    <div
      style={{
        background: `linear-gradient(160deg,${C.header},${C.teal})`,
        padding: 'var(--hdr-top) 20px 18px',
        color: '#fff',
      }}
    >
      <button onClick={onBack} style={{ ...quiet, color: C.frost, padding: '10px 0', minHeight: 44 }}>
        ‹ Back
      </button>
      <div style={{ fontSize: 'clamp(19px, 5.6vw, 23px)', fontWeight: 800, letterSpacing: '-.01em', overflowWrap: 'anywhere' }}>
        {title}
      </div>
      {sub && <div style={{ fontSize: 12.5, fontWeight: 600, color: C.frost, marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

/** The list: leagues you are in, plus the two ways to get into another. */
function LeagueList({ leagues, actions }) {
  const { mine, status, busy, error, isAvailable } = leagues;
  const [makeName, setMakeName] = useState('');
  const [code, setCode] = useState('');
  const [bringTeam, setBringTeam] = useState(true);
  const [open, setOpen] = useState(null); // 'create' | 'join' | null

  if (!isAvailable) {
    return (
      <div style={{ padding: 16 }}>
        <Card style={{ padding: 16 }}>
          <div style={{ fontSize: 15, fontWeight: 800 }}>Leagues need an account</div>
          <div style={{ ...label, marginTop: 4 }}>
            This build has no backend configured, so there is nothing to join. Everything else on
            this phone works exactly as it does now.
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div style={{ padding: 16 }}>
      <Section>Your leagues</Section>

      {status === 'loading' && <div style={label}>Looking…</div>}

      {status !== 'loading' && !mine.length && (
        <Card style={{ padding: 16 }}>
          <div style={{ fontSize: 15, fontWeight: 800 }}>You are not in a league yet</div>
          <div style={{ ...label, marginTop: 4 }}>
            A league is how several teams share one table and one schedule. Start one, or enter the
            code somebody sent you.
          </div>
        </Card>
      )}

      {mine.map((l) => (
        <Card
          key={l.id}
          onClick={() => actions.open(l.id)}
          style={{ padding: '13px 14px', marginBottom: 8, cursor: 'pointer', minHeight: 44 }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ flex: 1, fontSize: 15, fontWeight: 800, overflowWrap: 'anywhere' }}>{l.name}</span>
            <span
              style={{
                fontSize: 9.5,
                fontWeight: 800,
                color: C.teal,
                background: '#DDF1F4',
                borderRadius: 5,
                padding: '3px 6px',
                whiteSpace: 'nowrap',
              }}
            >
              {(LEAGUE_ROLE_LABEL[l.role] || l.role).toUpperCase()}
            </span>
          </div>
          <div style={{ ...label, marginTop: 2 }}>
            {l.sport === 'softball' ? 'Softball' : 'Kickball'} · {l.visibility === 'private' ? 'Private' : 'Public'}
          </div>
        </Card>
      ))}

      {error && <div style={errorBlock}>{error}</div>}

      {open !== 'join' && (
        <>
          {open === 'create' ? (
            <Card style={{ padding: 14, marginTop: 14 }}>
              <div style={{ fontSize: 15, fontWeight: 800 }}>Start a league</div>
              <div style={{ ...label, marginTop: 2 }}>You run it, and you decide who gets in.</div>
              <input
                autoFocus
                value={makeName}
                onChange={(e) => setMakeName(e.target.value)}
                placeholder="Thursday Night Kickball"
                style={field}
              />
              <button
                onClick={async () => {
                  await actions.create(makeName);
                  setMakeName('');
                  setOpen(null);
                }}
                disabled={busy || !makeName.trim()}
                style={{ ...primary, opacity: busy || !makeName.trim() ? 0.45 : 1 }}
              >
                {busy ? 'Creating…' : 'Create it'}
              </button>
              <button onClick={() => setOpen(null)} disabled={busy} style={{ ...quiet, width: '100%' }}>
                Cancel
              </button>
            </Card>
          ) : (
            <button onClick={() => setOpen('create')} style={primary}>
              Start a league
            </button>
          )}
        </>
      )}

      {open !== 'create' && (
        <>
          {open === 'join' ? (
            <Card style={{ padding: 14, marginTop: 14 }}>
              <div style={{ fontSize: 15, fontWeight: 800 }}>Join a league</div>
              <div style={{ ...label, marginTop: 2 }}>Enter the code the commissioner gave you.</div>
              <input
                autoFocus
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                placeholder="BQ7K-2M9X-RT"
                autoCapitalize="characters"
                autoCorrect="off"
                spellCheck={false}
                style={{ ...field, letterSpacing: '.1em', textAlign: 'center', fontSize: 18, fontWeight: 800 }}
              />
              <label
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  marginTop: 12,
                  minHeight: 44,
                  cursor: 'pointer',
                }}
              >
                <input
                  type="checkbox"
                  checked={bringTeam}
                  onChange={(e) => setBringTeam(e.target.checked)}
                  style={{ width: 22, height: 22 }}
                />
                <span style={{ fontSize: 13.5, fontWeight: 700, color: C.ink }}>
                  Bring my team into this league
                </span>
              </label>
              <div style={{ ...label, marginTop: 2 }}>
                Only a team you manage can join. Leave this off to follow the league without
                entering a team.
              </div>
              <button
                onClick={async () => {
                  await actions.join(code, bringTeam);
                  setCode('');
                  setOpen(null);
                }}
                disabled={busy || normalizeCode(code).length < 6}
                style={{ ...primary, opacity: busy || normalizeCode(code).length < 6 ? 0.45 : 1 }}
              >
                {busy ? 'Joining…' : 'Join'}
              </button>
              <button onClick={() => setOpen(null)} disabled={busy} style={{ ...quiet, width: '100%' }}>
                Cancel
              </button>
            </Card>
          ) : (
            <button onClick={() => setOpen('join')} style={secondary}>
              I have a code
            </button>
          )}
        </>
      )}
    </div>
  );
}

const TABLE_GRID = '20px minmax(0, 1fr) 28px 28px 28px 46px';

/** The league table. Every final game in the league, not just ours. */
function Table({ rows, myTeamId }) {
  return (
    <Card style={{ overflow: 'hidden' }}>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: TABLE_GRID,
          padding: '10px 12px 8px',
          fontSize: 11,
          fontWeight: 700,
          color: C.muted,
          letterSpacing: '.05em',
        }}
      >
        <span />
        <span>TEAM</span>
        <span style={{ textAlign: 'center' }}>W</span>
        <span style={{ textAlign: 'center' }}>L</span>
        <span style={{ textAlign: 'center' }}>T</span>
        <span style={{ textAlign: 'right' }}>PCT</span>
      </div>
      {rows.map((r, i) => (
        <div
          key={r.id}
          style={{
            display: 'grid',
            gridTemplateColumns: TABLE_GRID,
            alignItems: 'center',
            padding: '11px 12px',
            borderTop: `1px solid ${C.hair}`,
            fontSize: 14,
            background: r.id === myTeamId ? '#F4FAFB' : '#fff',
          }}
        >
          <span style={{ fontWeight: 700, color: C.fog, fontSize: 12 }}>{i + 1}</span>
          <span
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              fontWeight: r.id === myTeamId ? 800 : 600,
              minWidth: 0,
            }}
          >
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.name}</span>
            {r.id === myTeamId && (
              <span
                style={{
                  fontSize: 9.5,
                  fontWeight: 800,
                  color: C.teal,
                  background: '#DDF1F4',
                  borderRadius: 5,
                  padding: '2px 5px',
                  flex: '0 0 auto',
                }}
              >
                YOU
              </span>
            )}
          </span>
          <span style={{ textAlign: 'center', fontWeight: 800, ...tnum }}>{r.w}</span>
          <span style={{ textAlign: 'center', fontWeight: 600, color: C.muted, ...tnum }}>{r.l}</span>
          <span style={{ textAlign: 'center', fontWeight: 600, color: C.muted, ...tnum }}>{r.t}</span>
          <span style={{ textAlign: 'right', fontWeight: 600, color: C.muted, ...tnum }}>
            {rateString(r.w + r.t / 2, r.gp)}
          </span>
        </div>
      ))}
    </Card>
  );
}

/**
 * A fixture: when, and who. Shared by the schedule and the games in progress,
 * so a game that has started still looks like the thing that was on the
 * calendar; what goes under it is up to the section.
 */
function FixtureCard({ game: g, teamName, children }) {
  return (
    <Card style={{ padding: '12px 14px', marginBottom: 8 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: C.coral }}>{g.label || 'FIXTURE'}</div>
      <div style={{ fontSize: 14.5, fontWeight: 800, marginTop: 2, overflowWrap: 'anywhere' }}>
        {teamName(g.home_team_id)} vs {teamName(g.away_team_id)}
      </div>
      <div style={{ ...label, marginTop: 2, ...tnum }}>
        {new Date(g.scheduled_at).toLocaleString('en-US', {
          weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
        })}
      </div>
      {children}
    </Card>
  );
}

/** One league: its teams, its fixtures, and what a commissioner can do to them. */
function LeagueDetail({ leagues, actions, myTeamId, userId, onScoreFixture }) {
  const { detail, busy, error, code, notice } = leagues;
  const { league, teams, games, role } = detail;
  const lines = detail.lines || [];
  const isAdmin = role === 'league_admin';
  const [statKey, setStatKey] = useState('r');

  const table = useMemo(() => leagueStandings(teams, games), [teams, games]);
  const leaders = useMemo(
    () => leagueLeaders(lines, teams, { stat: statKey, limit: 5 }),
    [lines, teams, statKey],
  );
  const trackedGames = table.reduce((n, r) => n + r.tracked, 0) / 2;
  const priors = table.reduce((n, r) => n + (r.gp - r.tracked), 0);

  const [inviteRole, setInviteRole] = useState('viewer');
  const [showInvite, setShowInvite] = useState(false);
  const [showFixture, setShowFixture] = useState(false);
  const [home, setHome] = useState('');
  const [away, setAway] = useState('');
  const [when, setWhen] = useState('');

  const teamName = (id) => {
    const t = teams.find((x) => x.id === id);
    return t ? t.name : 'A team';
  };

  const { fixtures, inProgress, played } = bucketLeagueGames(games);
  const scorers = detail.scorers || {};

  return (
    <div style={{ padding: 16 }}>
      {teams.length > 0 && (
        <>
          <Section>Table</Section>
          <Table rows={table} myTeamId={myTeamId} />
          {priors > 0 && (
            <div style={{ fontSize: 11, color: C.fog, fontWeight: 600, margin: '6px 2px 0' }}>
              Includes {priors} {priors === 1 ? 'game' : 'games'} entered by hand, with no box
              score. Each team keeps its own.
            </div>
          )}
          {trackedGames === 0 && (
            <div style={{ fontSize: 11, color: C.fog, fontWeight: 600, margin: '6px 2px 0' }}>
              No games scored in this league yet.
            </div>
          )}
          <div style={{ height: 14 }} />
        </>
      )}

      {leaders.length > 0 && (
        <>
          <div
            style={{
              display: 'flex',
              alignItems: 'baseline',
              justifyContent: 'space-between',
              marginBottom: 8,
            }}
          >
            <Section style={{ marginBottom: 0 }}>Leaders</Section>
            <div style={{ display: 'flex', gap: 4 }}>
              {['r', 'rbi', 'h', 'hr'].map((k) => (
                <button
                  key={k}
                  onClick={() => setStatKey(k)}
                  style={{
                    background: statKey === k ? '#DDF1F4' : 'none',
                    border: `1px solid ${statKey === k ? C.teal : 'transparent'}`,
                    color: statKey === k ? C.header : C.muted,
                    borderRadius: 99,
                    padding: '0 10px',
                    minHeight: 44,
                    // "R" and "H" are one letter; without this they are 30px
                    // wide, which the viewport audit caught once it could reach
                    // this screen.
                    minWidth: 44,
                    fontSize: 11.5,
                    fontWeight: 800,
                    ...btn,
                  }}
                >
                  {k.toUpperCase()}
                </button>
              ))}
            </div>
          </div>
          <Card style={{ padding: '6px 0' }}>
            {leaders.map((p) => (
              <div
                key={p.key}
                style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 14px' }}
              >
                <Avatar ini={initials(p.name)} c={C.teal} size={30} fs={12} />
                <span style={{ flex: 1, fontWeight: 700, fontSize: 13.5, minWidth: 0 }}>
                  <span style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {p.name}
                  </span>
                  {p.team && (
                    <span style={{ display: 'block', color: C.fog, fontWeight: 600, fontSize: 11.5 }}>
                      {p.team}
                    </span>
                  )}
                </span>
                <span style={{ fontSize: 19, fontWeight: 800, color: C.header, ...tnum }}>{p[statKey]}</span>
              </div>
            ))}
          </Card>
          <div style={{ fontSize: 11, color: C.fog, fontWeight: 600, margin: '6px 2px 0' }}>
            {statLabel[statKey]} across every game scored in this league.
          </div>
          <div style={{ height: 14 }} />
        </>
      )}

      <Section>Teams · {teams.length}</Section>
      {!teams.length && (
        <Card style={{ padding: 14 }}>
          <div style={{ ...label }}>
            No teams yet. {isAdmin ? 'Send a manager the code below and they can bring theirs in.' : 'The commissioner adds them.'}
          </div>
        </Card>
      )}
      {teams.map((t) => (
        <Card key={t.id} style={{ padding: '12px 14px', marginBottom: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ flex: 1, fontSize: 14.5, fontWeight: 800, overflowWrap: 'anywhere' }}>{t.name}</span>
            {t.id === myTeamId && (
              <span
                style={{
                  fontSize: 9.5,
                  fontWeight: 800,
                  color: C.teal,
                  background: '#DDF1F4',
                  borderRadius: 5,
                  padding: '3px 6px',
                }}
              >
                YOURS
              </span>
            )}
          </div>
          {t.id === myTeamId && (
            <button onClick={() => actions.removeTeam(t.id)} disabled={busy} style={{ ...quiet, padding: '10px 0' }}>
              Leave this league
            </button>
          )}
        </Card>
      ))}

      {myTeamId && !teams.some((t) => t.id === myTeamId) && (
        <button onClick={() => actions.addTeam(myTeamId)} disabled={busy} style={secondary}>
          {busy ? 'Adding…' : 'Bring my team into this league'}
        </button>
      )}

      <div style={{ height: 14 }} />
      <Section>Schedule · {fixtures.length}</Section>
      {!fixtures.length && (
        <Card style={{ padding: 14 }}>
          <div style={label}>Nothing scheduled.</div>
        </Card>
      )}
      {fixtures.map((g) => {
        // Ours to score only if our team is in it. The opposition is the other
        // side, named by its real id — which is what makes the result land in
        // this table rather than against a name typed into a phone.
        const mine = myTeamId && (g.home_team_id === myTeamId || g.away_team_id === myTeamId);
        const otherId = g.home_team_id === myTeamId ? g.away_team_id : g.home_team_id;
        const other = teams.find((t) => t.id === otherId);
        return (
          <FixtureCard key={g.id} game={g} teamName={teamName}>
            {mine && other && (
              <button
                onClick={() =>
                  onScoreFixture({ fixture: g, opponent: other, home: g.home_team_id === myTeamId })
                }
                style={{
                  width: '100%',
                  marginTop: 10,
                  background: C.coral,
                  border: 'none',
                  color: '#fff',
                  borderRadius: 13,
                  padding: 12,
                  minHeight: 46,
                  fontSize: 14.5,
                  fontWeight: 800,
                  ...btn,
                }}
              >
                Score this game
              </button>
            )}
          </FixtureCard>
        );
      })}

      {inProgress.length > 0 && (
        <>
          <div style={{ height: 14 }} />
          <Section>In progress · {inProgress.length}</Section>
          {inProgress.map((g) => (
            // No "Score this game" here. Starting a fixture appends a start
            // event, and a second start on a log that already has plays in it
            // resets the game for every phone watching. A phone on one of the
            // teams is offered to JOIN it instead, which is the safe way in.
            <FixtureCard key={g.id} game={g} teamName={teamName}>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 7,
                  marginTop: 8,
                  fontSize: 12.5,
                  fontWeight: 800,
                  color: C.teal,
                  overflowWrap: 'anywhere',
                }}
              >
                <span
                  aria-hidden="true"
                  style={{ width: 8, height: 8, borderRadius: 99, background: C.teal, flex: '0 0 auto' }}
                />
                {scorerLine(scorers[g.id], { teams, userId })}
              </div>
            </FixtureCard>
          ))}
        </>
      )}

      {played.length > 0 && (
        <>
          <div style={{ height: 14 }} />
          <Section>Played · {played.length}</Section>
          {played.map((g) => (
            <Card key={g.id} style={{ padding: '12px 14px', marginBottom: 8 }}>
              <div style={{ fontSize: 14.5, fontWeight: 800, overflowWrap: 'anywhere', ...tnum }}>
                {teamName(g.home_team_id)} {g.home_score} — {teamName(g.away_team_id)} {g.away_score}
              </div>
              <div style={{ ...label, marginTop: 2 }}>{g.label || ''}</div>
            </Card>
          ))}
        </>
      )}

      {notice && <div style={noticeBlock}>{notice}</div>}
      {error && <div style={errorBlock}>{error}</div>}

      {code && (
        <div style={noticeBlock}>
          <div style={{ fontWeight: 800, marginBottom: 4 }}>Give them this code</div>
          <div style={{ fontSize: 22, fontWeight: 800, letterSpacing: '.14em', ...tnum }}>{code}</div>
          <div style={{ marginTop: 4 }}>
            Single use, and it expires. It is not stored anywhere you can look it up again — mint
            another if you lose it.
          </div>
        </div>
      )}

      {isAdmin && (
        <>
          <div style={{ height: 14 }} />
          <Section>Commissioner</Section>

          {showInvite ? (
            <Card style={{ padding: 14 }}>
              <div style={{ fontSize: 15, fontWeight: 800 }}>Invite someone</div>
              {LEAGUE_INVITABLE_ROLES.map((r) => (
                <button
                  key={r}
                  onClick={() => setInviteRole(r)}
                  style={{
                    width: '100%',
                    textAlign: 'left',
                    marginTop: 8,
                    background: inviteRole === r ? '#DDF1F4' : '#fff',
                    border: `1.5px solid ${inviteRole === r ? C.teal : C.stroke}`,
                    borderRadius: 13,
                    padding: '11px 12px',
                    minHeight: 48,
                    ...btn,
                  }}
                >
                  <span style={{ display: 'block', fontSize: 14, fontWeight: 800, color: C.ink }}>
                    {LEAGUE_ROLE_LABEL[r]}
                  </span>
                  <span style={{ display: 'block', ...label, marginTop: 1 }}>{LEAGUE_ROLE_BLURB[r]}</span>
                </button>
              ))}
              <button
                onClick={async () => {
                  await actions.invite(inviteRole);
                  setShowInvite(false);
                }}
                disabled={busy}
                style={primary}
              >
                {busy ? 'Minting…' : 'Make a code'}
              </button>
              <button onClick={() => setShowInvite(false)} disabled={busy} style={{ ...quiet, width: '100%' }}>
                Cancel
              </button>
            </Card>
          ) : (
            <button onClick={() => setShowInvite(true)} style={secondary}>
              Invite someone to this league
            </button>
          )}

          {showFixture ? (
            <Card style={{ padding: 14, marginTop: 10 }}>
              <div style={{ fontSize: 15, fontWeight: 800 }}>Schedule a game</div>
              {teams.length < 2 ? (
                <div style={{ ...label, marginTop: 4 }}>
                  Two teams have to be in the league before there is a fixture to make.
                </div>
              ) : (
                <>
                  <div style={{ ...label, marginTop: 8 }}>Home</div>
                  <select value={home} onChange={(e) => setHome(e.target.value)} style={field}>
                    <option value="">Pick a team</option>
                    {teams.map((t) => (
                      <option key={t.id} value={t.id}>{t.name}</option>
                    ))}
                  </select>
                  <div style={{ ...label, marginTop: 8 }}>Away</div>
                  <select value={away} onChange={(e) => setAway(e.target.value)} style={field}>
                    <option value="">Pick a team</option>
                    {teams.map((t) => (
                      <option key={t.id} value={t.id}>{t.name}</option>
                    ))}
                  </select>
                  <div style={{ ...label, marginTop: 8 }}>When</div>
                  <input
                    type="datetime-local"
                    value={when}
                    onChange={(e) => setWhen(e.target.value)}
                    style={field}
                  />
                  <button
                    onClick={async () => {
                      await actions.schedule({
                        homeTeamId: home,
                        awayTeamId: away,
                        scheduledAt: when || undefined,
                        sport: league.sport,
                      });
                      setHome('');
                      setAway('');
                      setWhen('');
                      setShowFixture(false);
                    }}
                    disabled={busy || !home || !away}
                    style={{ ...primary, opacity: busy || !home || !away ? 0.45 : 1 }}
                  >
                    {busy ? 'Adding…' : 'Add to the schedule'}
                  </button>
                </>
              )}
              <button onClick={() => setShowFixture(false)} disabled={busy} style={{ ...quiet, width: '100%' }}>
                Cancel
              </button>
            </Card>
          ) : (
            <button onClick={() => setShowFixture(true)} style={{ ...secondary, marginTop: 10 }}>
              Schedule a game
            </button>
          )}
        </>
      )}
    </div>
  );
}

export default function Leagues({ v, actions }) {
  const leagues = v.leagues;
  const la = leagues.actions;

  // Nothing is fetched until somebody opens this screen. A league is not needed
  // to score a game, and a phone at a field should not be waiting on one.
  useEffect(() => {
    la.refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const detail = leagues.detail;

  return (
    <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
      <Header
        title={detail ? detail.league.name : 'Leagues'}
        sub={
          detail
            ? `${LEAGUE_ROLE_LABEL[detail.role] || 'Member'} · ${detail.league.visibility === 'private' ? 'Private' : 'Public'}`
            : 'Several teams, one table, one schedule'
        }
        onBack={detail ? la.close : actions.goLeague}
      />
      {detail ? (
        <LeagueDetail
          leagues={leagues}
          actions={la}
          myTeamId={v.account.teamId}
          userId={v.account.userId}
          onScoreFixture={actions.startFixture}
        />
      ) : (
        <LeagueList leagues={leagues} actions={la} />
      )}
    </div>
  );
}
