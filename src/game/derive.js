// Turns raw state into everything the screens render. Keeping this in one
// place means the screen components stay declarative — they read values and
// wire up handlers, they don't compute standings or scorebook grids.

import { POSITIONS, TEMPLATES } from '../data/league.js';
import { oppPid, teamAbbrev } from '../data/ids.js';
import { tallyStandings, winPct } from './standings.js';
import { getPreserved } from './storage.js';
import {
  addLines,
  EMPTY_LINE,
  normalizeLine,
  obpString as lineObp,
  onBaseByGame,
  seasonTotals,
  teamSeason,
  withRates,
} from './stats.js';
import {
  awayLineup,
  currentKicker,
  homePid,
  initials,
  obpString,
  opponentTeam,
  ordinal,
  playerById,
  playerName,
  rateString,
  statLine,
} from './logic.js';
import { C } from '../theme.js';

const TONES = {
  teal: { bg: C.teal, fg: '#fff', bd: 'none' },
  slate: { bg: C.slate, fg: '#fff', bd: 'none' },
  line: { bg: 'transparent', fg: C.pale, bd: '1.5px solid rgba(255,255,255,.25)' },
};

const BASE_LABELS = ['1st', '2nd', '3rd'];

const STAT_SETS = [
  { label: 'Core', cols: ['AVG', 'OBP', 'OPS'], pick: (t) => [t.avg, t.obp, t.ops] },
  { label: 'Counting', cols: ['R', 'RBI', 'BB'], pick: (t) => [t.r, t.rbi, t.bb] },
];

// Static demo data for the OCR review screen — this is what "came off the page".
const SCANNED_BOOK = [
  { label: 'M. Ortiz',   sub: 'C',  cells: [{ sym: '1B' }, { sym: 'HR', fill: 1 }, { sym: '2B', fill: 1 }, { sym: 'F8' }, { sym: '1B' }] },
  { label: 'D. Wallace', sub: 'P',  cells: [{ sym: 'K' }, { sym: '1B', fill: 1 }, { sym: 'BB' }, { sym: '1B' }, { sym: 'FO', low: 1 }] },
  { label: 'P. Shah',    sub: 'SS', cells: [{ sym: '2B', fill: 1 }, { sym: 'F7' }, { sym: '1B', fill: 1 }, { sym: 'BB' }, { sym: '' }] },
  { label: 'C. Bennett', sub: '1B', cells: [{ sym: 'FO' }, { sym: '4-3', low: 1 }, { sym: 'K' }, { sym: '1B' }, { sym: '' }] },
  { label: 'A. Fuentes', sub: 'LF', cells: [{ sym: '1B', fill: 1 }, { sym: 'F8' }, { sym: 'BB' }, { sym: 'TO' }, { sym: '' }] },
];

const SCANNED_ROWS = [
  { name: 'M. Ortiz',   ab: 5, h: 4, r: 2, rbi: 3, lowH: false, lowAb: false },
  { name: 'D. Wallace', ab: 4, h: 2, r: 1, rbi: 1, lowH: false, lowAb: true },
  { name: 'P. Shah',    ab: 3, h: 2, r: 2, rbi: 1, lowH: true,  lowAb: false },
  { name: 'C. Bennett', ab: 4, h: 1, r: 0, rbi: 0, lowH: false, lowAb: false },
  { name: 'A. Fuentes', ab: 3, h: 1, r: 1, rbi: 0, lowH: false, lowAb: false },
];

const SCANNED_SCHEDULE = [
  { opp: 'Dirt Merchants', when: 'Sat Sep 12 · 10:00 AM', where: 'Riverbend Park #1', low: false },
  { opp: 'Sunday Scaries', when: 'Thu Sep 17 · 6:30 PM',  where: 'Eastside HS field',  low: true },
  { opp: 'The Ringers',    when: 'Sat Sep 19 · 11:30 AM', where: 'Riverbend Park #2', low: false },
  { opp: 'Rubber Chickens', when: 'Thu Sep 24 · 7:00 PM', where: 'Riverbend Park #2', low: false },
];

const OCR_STEPS = [
  { label: '✓ Captured' },
  { label: '✓ OCR · 23 symbols' },
  { label: '✓ Parsed to stat lines' },
  { label: '2 to check', warn: true },
];

const RANK_LABELS = ['1st', '2nd', '3rd', '4th', '5th'];

const RESULT_COLOR = { W: C.teal, L: C.fog, T: C.muted };

/** "2B", "HR×2" etc., appended after a name in the box score. */
function extraBaseTag(l) {
  const parts = [];
  if (l.hr) parts.push(l.hr > 1 ? `HR×${l.hr}` : 'HR');
  if (l.t) parts.push(l.t > 1 ? `3B×${l.t}` : '3B');
  if (l.d) parts.push(l.d > 1 ? `2B×${l.d}` : '2B');
  return parts.join(' ');
}

/** Newest-first game rows for the team page, derived from the history. */
function deriveTeamGames(s, actions) {
  const played = [...s.history].reverse().map((g) => ({
    key: g.id,
    tag: `${g.result} ${g.score.us}–${g.score.them}`,
    tagColor: RESULT_COLOR[g.result] ?? C.fog,
    line: `${g.home ? 'vs' : 'at'} ${g.opponent}`,
    sub: g.label,
    onTap: actions.openGame(g.id, 'team'),
  }));

  // A game in progress leads the list; once it's finalized it *is* the list.
  if (s.gameActive) {
    return [
      {
        key: 'current',
        tag: '● LIVE',
        tagColor: C.coral,
        line: `vs ${opponentTeam(s).name}`,
        sub: `${s.score.home}–${s.score.away}`,
      },
      ...played,
    ];
  }
  if (s.gameFinal) return played;
  return [
    { key: 'next', tag: 'NEXT', tagColor: C.coral, line: `vs ${opponentTeam(s).name}`, sub: 'Today 6:30' },
    ...played,
  ];
}

/** A single player's game-by-game line, pulled out of the stored box scores. */
function derivePlayerLog(s, pid, actions) {
  return [...s.history]
    .reverse()
    .map((g) => {
      const l = g.lines.find((x) => x.pid === pid);
      if (!l) return null;
      return {
        key: g.id,
        date: g.label,
        opp: `${g.home ? 'vs' : 'at'} ${g.opponent}`,
        line: `${l.h}-${l.ab} · ${l.r} R · ${l.rbi} RBI`,
        onTap: actions.openGame(g.id, 'player'),
      };
    })
    .filter(Boolean);
}

/** League table: pre-app baseline plus every game in the history. */
function deriveStandings(s, actions) {
  const rows = tallyStandings(s).sort((a, b) => winPct(b) - winPct(a));

  return rows.map((r, i) => {
    const you = r.you;
    return {
      rank: i + 1,
      name: r.name,
      w: r.w,
      l: r.l,
      gp: r.gp,
      pct: rateString(r.w + r.t / 2, r.gp),
      you,
      wt: you ? 800 : 600,
      bg: you ? '#F4FAFB' : '#fff',
      onTap: you ? actions.goTeam : actions.noop,
    };
  });
}

/**
 * The top of the league screen: tonight's game if there is one, then the most
 * recent results. Nothing here is invented — there is no fixture list, so we
 * only show games that exist.
 */
function deriveSchedule(s, actions) {
  const cards = [];
  const opp = s.teams.length ? opponentTeam(s).name : null;

  if (s.gameActive) {
    cards.push({
      key: 'now',
      tag: '● LIVE',
      tagColor: C.coral,
      line: `${teamAbbrev(s.myTeam.name)} ${s.score.home} · ${teamAbbrev(opponentTeam(s).name)} ${s.score.away}`,
      sub: `${s.half === 'top' ? '▲ ' : '▼ '}${ordinal(s.inning)}`,
      onTap: actions.go('live'),
    });
  } else if (opp) {
    cards.push({
      key: 'next',
      tag: 'NEXT',
      tagColor: C.coral,
      line: `${teamAbbrev(s.myTeam.name)} vs ${teamAbbrev(opp)}`,
      sub: 'Tap to start scoring',
      onTap: actions.goNewGame,
    });
  }

  [...s.history].reverse().slice(0, 3).forEach((g) => {
    cards.push({
      key: g.id,
      tag: `${g.result} ${g.score.us}–${g.score.them}`,
      tagColor: RESULT_COLOR[g.result] ?? C.fog,
      line: `${g.home ? 'vs' : 'at'} ${g.opponent}`,
      sub: g.label,
      onTap: actions.openGame(g.id, 'league'),
    });
  });

  return cards;
}

/** Who's up next and in the hole, with their line so far today. */
function deriveOnDeck(s) {
  if (!s.gameActive) return [];

  return [1, 2].map((d) => {
    let name;
    let c;
    let pid;
    if (s.half === 'bot') {
      const p = playerById(s, s.lineup[(s.kiHome + d) % s.lineup.length]);
      name = p.name;
      c = p.c;
      pid = homePid(p.id);
    } else {
      const order = awayLineup(s);
      const batter = order[(s.kiAway + d) % order.length];
      name = batter.name;
      c = batter.c;
      pid = batter.pid;
    }
    const g = statLine(s.gameStats, pid);
    return {
      name,
      ini: initials(name),
      c,
      tag: d === 1 ? 'ON DECK' : 'IN HOLE',
      stat: g.ab || g.bb ? `${g.h}-${g.ab}` : '',
    };
  });
}

/**
 * The live scorebook grid, flattened to a single list so it can drop straight
 * into a CSS grid: a name cell followed by one diamond per inning column.
 */
function deriveBook(s, posOf) {
  const start = s.bookOff != null ? s.bookOff : Math.max(1, s.inning - 2);
  const cols = [0, 1, 2].map((i) => ({ n: start + i }));

  const flat = [];
  s.lineup.forEach((id, idx) => {
    const p = playerById(s, id);
    const pid = homePid(p.id);
    const [first, last] = p.name.split(' ');
    flat.push({
      isName: true,
      isCell: false,
      slot: idx + 1,
      label: `${first[0]}. ${last}`,
      sub: posOf(p),
    });
    cols.forEach((col) => {
      const pa = s.events.filter((e) => e.pid === pid && e.inning === col.n && e.half === 'bot');
      const ev = pa[pa.length - 1];
      flat.push({
        isName: false,
        isCell: true,
        sym: ev ? ev.sym : '',
        fill: ev && ev.scored ? C.teal : ev ? 'rgba(255,255,255,.06)' : 'transparent',
        bd: ev ? 'rgba(255,255,255,.45)' : 'rgba(255,255,255,.2)',
        bs: ev ? 'solid' : 'dashed',
        fg: ev && ev.scored ? '#fff' : C.chalk,
      });
    });
  });

  return { cols, flat, range: `${start}–${start + 2}`, start };
}

/** Flatten the OCR'd scorecard the same way, for the review screen. */
function deriveScannedBook() {
  const cells = [];
  SCANNED_BOOK.forEach((p) => {
    cells.push({ isName: true, isCell: false, label: p.label, sub: p.sub });
    p.cells.forEach((c) =>
      cells.push({
        isName: false,
        isCell: true,
        sym: c.sym,
        low: !!c.low,
        fill: c.fill ? C.teal : c.sym ? 'rgba(255,255,255,.06)' : 'transparent',
        bd: c.low ? C.amber : c.sym ? 'rgba(255,255,255,.4)' : 'rgba(255,255,255,.14)',
        fg: c.fill ? '#fff' : C.chalk,
      }),
    );
  });
  return cells;
}

export function deriveView(s, actions) {
  const tpl = TEMPLATES[s.sport];
  const dark = s.screen === 'live';
  const posOf = (p) => s.posOverride[p.id] || p.pos;

  // ---- Entry buttons -------------------------------------------------------
  const groups = tpl.groups.map((g) => ({
    label: g.label,
    outcomes: g.outcomes.map((o) => ({ ...o, ...TONES[g.tone], onTap: () => actions.record(o) })),
  }));

  // ---- Diamond -------------------------------------------------------------
  const base = (i) => {
    const occupied = !!s.bases[i];
    const selected = s.selRunner === i;
    return {
      tap: () => actions.selectRunner(i),
      border: selected ? C.coral : occupied ? C.cyan : 'rgba(255,255,255,.3)',
      bg: occupied ? (selected ? C.coral : C.teal) : C.panel,
      anim: occupied ? 'basePop .25s ease-out' : 'none',
    };
  };

  // ---- Who's up ------------------------------------------------------------
  const kicker = s.gameActive
    ? currentKicker(s)
    : { name: '—', c: C.muted, ini: '·', line: '', slot: 1, of: 7 };
  const kickerGame = statLine(s.gameStats, kicker.pid);

  const standings = deriveStandings(s, actions);
  const me = standings.find((t) => t.you);
  const set = STAT_SETS[s.statSet];

  // ---- Lineup / bench ------------------------------------------------------
  const lineupView = s.lineup.map((id, idx) => {
    const p = playerById(s, id);
    const g = s.gameStats[homePid(p.id)];
    const upNow = s.gameActive && s.half === 'bot' && idx === s.kiHome % s.lineup.length;
    return {
      key: homePid(p.id),
      slot: idx + 1,
      name: p.name,
      ini: initials(p.name),
      c: p.c,
      pos: posOf(p),
      stat: g
        ? `Today ${g.h}-${g.ab} · ${g.r} R`
        : (() => {
            const t = seasonTotals(s.history, homePid(p.id));
            return t.gp ? `${t.avg} AVG · ${t.ops} OPS` : 'No games yet';
          })(),
      upNow,
      upTag: upNow ? 'UP' : '',
      goEntry: upNow ? actions.setLiveTab('entry') : actions.noop,
      bg: upNow ? 'rgba(45,225,252,.1)' : 'transparent',
      openPos: actions.openPosMenu(p.id),
      up: actions.moveLineup(idx, -1),
      down: actions.moveLineup(idx, 1),
    };
  });

  const benchView = s.bench.map((id) => {
    const p = playerById(s, id);
    return { key: homePid(p.id), name: p.name, ini: initials(p.name), c: p.c, add: actions.addFromBench(id) };
  });

  // ---- Live stats table ----------------------------------------------------
  const statsHome = s.statsTeam === 'home';
  const statRoster = statsHome
    ? s.lineup.map((id, idx) => {
        const p = playerById(s, id);
        return {
          pid: homePid(p.id),
          name: p.name,
          up: s.half === 'bot' && idx === s.kiHome % s.lineup.length,
        };
      })
    : awayLineup(s).map((b, idx) => ({
        pid: b.pid,
        name: b.name,
        up: s.half === 'top' && idx === s.kiAway % awayLineup(s).length,
      }));

  const liveStatRows = statRoster.map((row) => {
    const g = statLine(s.gameStats, row.pid);
    const isUp = row.up && s.gameActive;
    return {
      key: row.pid,
      name: row.name,
      upTag: isUp ? '●' : '',
      ab: g.ab,
      h: g.h,
      r: g.r,
      rbi: g.rbi,
      obp: obpString(g),
      bg: isUp ? 'rgba(45,225,252,.07)' : 'transparent',
    };
  });

  const book = deriveBook(s, posOf);
  const onDeck = deriveOnDeck(s);
  // With an empty roster there is nobody to profile. Everything downstream
  // still has to render — a crash here takes the whole app down.
  const profPlayer = playerById(s, s.playerId) || s.roster[0] || null;
  const prof = profPlayer || { id: -1, name: '—', num: null, pos: '—', c: C.muted };
  const profPid = profPlayer ? homePid(profPlayer.id) : 'none';
  const posMenuPlayer = s.posMenu != null ? playerById(s, s.posMenu) : null;
  const quickMode = s.gameActive && s.trackMode === 'ours' && s.half === 'top';
  const sel = s.selRunner;

  const tabDefs = [
    ['League', 'L', 'league'],
    ['Team', 'T', 'team'],
    ['Game', 'G', s.gameActive ? 'live' : 'newgame'],
  ];

  return {
    // ---- Routing -----------------------------------------------------------
    screen: s.screen,
    dark,
    showTabs: ['league', 'team', 'live', 'newgame'].includes(s.screen),
    tabBarBg: dark ? C.deep : '#fff',
    tabBarLine: dark ? 'rgba(255,255,255,.08)' : C.hair2,
    tabs: tabDefs.map(([label, glyph, sc]) => {
      const active = s.screen === sc || (label === 'Game' && (s.screen === 'live' || s.screen === 'newgame'));
      return {
        label,
        glyph,
        onTap: actions.go(sc),
        fg: active ? (dark ? C.cyan : C.header) : dark ? C.muted : C.fog,
        iconBg: active ? (dark ? C.teal : C.header) : dark ? 'rgba(255,255,255,.08)' : C.hair2,
        iconFg: active ? '#fff' : dark ? C.mist : C.fog,
      };
    }),

    // ---- Roster & team editing ---------------------------------------------
    myTeamName: s.myTeam.name,
    rosterCount: s.roster.length,
    teamCount: s.teams.length,
    rosterEditRows: s.roster.map((p) => {
      const t = seasonTotals(s.history, homePid(p.id));
      return {
        key: homePid(p.id),
        id: p.id,
        name: p.name,
        ini: initials(p.name),
        c: p.c,
        meta: `${p.num != null ? `#${p.num} · ` : ''}${p.pos}${
          s.lineup.includes(p.id) ? ' · in order' : ' · bench'
        }`,
        season: t.gp ? `${t.avg} · ${t.gp}G` : 'no games',
        onEdit: actions.openPlayerEditor(null, p.id),
      };
    }),
    teamRows: s.teams.map((t) => {
      const row = standings.find((r) => r.id === t.id);
      return {
        id: t.id,
        name: t.name,
        abbrev: teamAbbrev(t.name),
        sub: t.players.length
          ? `${t.players.length} ${t.players.length === 1 ? 'player' : 'players'} on file`
          : 'No roster — score only',
        record: row ? `${row.w}–${row.l}` : '0–0',
        onOpen: actions.openTeamDetail(t.id),
      };
    }),
    resetFlow: s.resetFlow,
    importPreview: s.importPreview,
    importError: s.importError,
    hasPreserved: !!getPreserved(),
    confirmDeleteGame: s.confirmDeleteGame,
    // A team with no name means this is a fresh install.
    needsSetup: !s.myTeam.name,
    resetSummary: [
      { label: 'Players on your roster', count: s.roster.length },
      { label: 'Opposing teams', count: s.teams.length },
      { label: 'Recorded games', count: s.history.length },
    ],
    playerEditor: s.playerEditor,
    playerEditorTarget: (() => {
      const e = s.playerEditor;
      if (!e || e.id == null) return null;
      if (e.teamId == null) return playerById(s, e.id);
      const team = s.teams.find((t) => t.id === e.teamId);
      return team ? team.players.find((p) => p.id === e.id) : null;
    })(),
    teamEditor: s.teamEditor,
    teamEditorTarget: s.teamEditor && s.teamEditor.id != null
      ? s.teams.find((t) => t.id === s.teamEditor.id)
      : null,
    teamDetail: (() => {
      const team = s.teams.find((t) => t.id === s.editTeamId);
      if (!team) return null;
      const row = standings.find((r) => r.id === team.id);
      return {
        id: team.id,
        name: team.name,
        record: row ? `${row.w}–${row.l}` : '0–0',
        playerCount: team.players.length,
        players: team.players.map((p) => {
          const t = seasonTotals(s.history, oppPid(team.id, p.id));
          return {
            key: `${team.id}:${p.id}`,
            name: p.name,
            ini: initials(p.name),
            c: p.c,
            meta: `${p.num != null ? `#${p.num} · ` : ''}${p.pos}`,
            season: t.gp ? `${t.avg} · ${t.gp}G` : 'no games',
            onEdit: actions.openPlayerEditor(team.id, p.id),
          };
        }),
      };
    })(),

    // League header — derived, not invented.
    myTeamUpper: (s.myTeam.name || 'My team').toUpperCase(),
    teamSubtitle: `${tpl.name} · ${s.roster.length} ${s.roster.length === 1 ? 'player' : 'players'}`,
    leagueTitle: s.myTeam.name || 'My team',
    leagueEyebrow: `${tpl.name} · ${s.teams.length + 1} ${s.teams.length === 0 ? 'team' : 'teams'}`,
    hasSchedule: s.gameActive || s.teams.length > 0 || s.history.length > 0,
    notSynced: !s.synced,
    toastMsg: s.toast,

    // ---- League ------------------------------------------------------------
    schedule: deriveSchedule(s, actions),
    standings,
    leaders: s.roster.map((p) => ({ player: p, total: seasonTotals(s.history, homePid(p.id)) }))
      .filter(({ total }) => total.gp > 0)
      .sort((a, b) => b.total.r - a.total.r || b.total.opsValue - a.total.opsValue)
      .slice(0, 3)
      .map(({ player, total }) => ({
        name: player.name,
        team: teamAbbrev(s.myTeam.name),
        val: total.r,
        c: player.c,
        ini: initials(player.name),
        onTap: actions.openPlayer(player.id, 'league'),
      })),

    // ---- Team --------------------------------------------------------------
    teamRecord: `${me.w}–${me.l} · ${RANK_LABELS[me.rank - 1]} in league`,
    teamAgg: (() => {
      const t = teamSeason(s.history);
      return [
        { k: 'TEAM AVG', v: t.avg },
        { k: 'TEAM OPS', v: t.ops },
        { k: 'RUNS/GM', v: t.gp ? t.runsPerGame.toFixed(1) : '—' },
        { k: 'GAMES', v: t.gp },
      ];
    })(),
    statSetLabel: set.label === 'Core' ? 'AVG · OBP · OPS' : 'R · RBI · BB',
    statCols: set.cols,
    rosterView: s.roster.map((p) => {
      const v = set.pick(seasonTotals(s.history, homePid(p.id)));
      return {
        ...p,
        ini: initials(p.name),
        s1: v[0],
        s2: v[1],
        s3: v[2],
        onTap: actions.openPlayer(p.id, 'team'),
      };
    }),
    teamGames: deriveTeamGames(s, actions),

    // ---- New game ----------------------------------------------------------
    canStartGame: s.roster.length > 0 && s.teams.length > 0,
    startBlockedReason: !s.roster.length
      ? 'Add players to your roster first'
      : !s.teams.length
        ? 'Add an opposing team first'
        : '',
    opponent: opponentTeam(s).name,
    opponentUpper: opponentTeam(s).name.toUpperCase(),
    opponentPickerOpen: s.opponentPicker,
    opponentOptions: s.teams.map((t) => ({
      id: t.id,
      name: t.name,
      sub: t.players.length ? `${t.players.length} players` : 'No roster — score only',
      current: t.id === s.opponentId,
      onTap: actions.setOpponent(t.id),
    })),
    hasTeams: s.teams.length > 0,
    sport: s.sport,
    trackMode: s.trackMode,
    kbBorder: s.sport === 'kickball' ? C.teal : C.line,
    sbBorder: s.sport === 'softball' ? C.teal : C.line,
    trBothBorder: s.trackMode === 'both' ? C.teal : C.line,
    trOursBorder: s.trackMode === 'ours' ? C.teal : C.line,

    // ---- Live header -------------------------------------------------------
    sportName: tpl.name,
    trackLabel: s.trackMode === 'both' ? 'TRACKING BOTH' : 'OUR TEAM ONLY',
    score: s.score,
    halfArrow: s.half === 'top' ? '▲' : '▼',
    inningLabel: ordinal(s.inning),
    awayLabelColor: s.half === 'top' ? '#fff' : C.muted,
    homeLabelColor: s.half === 'bot' ? '#fff' : C.muted,
    outDots: [0, 1, 2].map((i) => ({ bg: i < s.outs ? C.coral : 'transparent' })),
    liveTabs: [
      ['ENTRY', 'entry'],
      ['BOOK', 'book'],
      ['LINEUP', 'lineup'],
      ['STATS', 'stats'],
    ].map(([label, id]) => ({
      label,
      onTap: actions.setLiveTab(id),
      line: s.liveTab === id ? C.cyan : 'transparent',
      fg: s.liveTab === id ? '#fff' : C.muted,
    })),
    liveTab: s.liveTab,

    // ---- Entry tab ---------------------------------------------------------
    b1: base(0),
    b2: base(1),
    b3: base(2),
    kicker,
    kickerHeading: `${s.half === 'bot' ? 'Now kicking · ' : 'Opponent up · '}${kicker.slot} of ${kicker.of}`,
    kickerToday:
      s.gameActive && (kickerGame.ab || kickerGame.bb)
        ? `Today ${kickerGame.h}-${kickerGame.ab} · ${kickerGame.r} R · ${kickerGame.rbi} RBI`
        : 'First plate appearance today',
    onDeck,
    hasSel: sel != null && !!s.bases[sel],
    selName: playerName(s, s.bases[sel]),
    selBase: sel != null ? BASE_LABELS[sel] : '',
    selBackOp: sel != null && sel > 0 && !s.bases[sel - 1] ? 1 : 0.35,
    hasLast: !!s.lastPlay,
    lastK: s.lastPlay ? s.lastPlay.k : '',
    lastDetail: s.lastPlay ? s.lastPlay.detail : '',
    tapeStr: s.tape.length ? s.tape.join(' · ') : '— no plays yet',
    groups,
    quickMode,

    // ---- Book tab ----------------------------------------------------------
    bookCols: book.cols,
    bookFlat: book.flat,
    bookRange: book.range,
    bookPrev: actions.setBookOff(Math.max(1, book.start - 1)),
    bookNext: actions.setBookOff(book.start + 1),

    // ---- Lineup tab --------------------------------------------------------
    lineupView,
    lineupCount: s.lineup.length,
    benchView,
    hasBench: s.bench.length > 0,
    posMenuOpen: s.posMenu != null,
    posMenuName: posMenuPlayer ? posMenuPlayer.name : '',
    posOptions: POSITIONS.map((pos) => {
      const cur = posMenuPlayer && posOf(posMenuPlayer) === pos;
      return {
        label: pos,
        bg: cur ? C.teal : 'rgba(255,255,255,.05)',
        bd: cur ? C.cyan : 'rgba(255,255,255,.18)',
        fg: cur ? '#fff' : C.pale,
        onTap: actions.setPos(pos),
      };
    }),

    // ---- Stats tab ---------------------------------------------------------
    shBg: statsHome ? C.teal : 'transparent',
    shFg: statsHome ? '#fff' : C.muted,
    saBg: !statsHome ? C.teal : 'transparent',
    saFg: !statsHome ? '#fff' : C.muted,
    statsAvailable: statsHome || s.trackMode === 'both',
    liveStatRows,

    // ---- Finalize ----------------------------------------------------------
    confirmFinal: s.confirmFinal,
    finalLine: `${s.myTeam.name} ${s.score.home} — ${opponentTeam(s).name} ${s.score.away}`,
    finalHeading: s.inning >= 7 ? 'End of the 7th — finalize game?' : 'Finalize game?',

    // ---- Scan --------------------------------------------------------------
    scanTitle: s.scanType === 'scorecard' ? 'Scan scorecard' : 'Scan schedule',
    reviewTitle: s.scanType === 'scorecard' ? 'Review scorecard' : 'Review schedule',
    isScorecardScan: s.scanType === 'scorecard',
    paperCells: Array.from({ length: 25 }, (_, i) => ({ o: i % 5 === 0 ? 0.85 : 0.45 })),
    ocrSteps: OCR_STEPS.map((st, i, arr) => ({
      label: st.label,
      arrow: i < arr.length - 1,
      bg: st.warn ? '#FFF1D6' : '#DDF1F4',
      bd: st.warn ? C.amberLine : '#9FD6DE',
      fg: st.warn ? '#8A6100' : C.teal,
    })),
    bookCells: deriveScannedBook(),
    scanRows: SCANNED_ROWS.map((r) => ({
      ...r,
      abBd: r.lowAb ? C.amberLine : C.line,
      abBg: r.lowAb ? '#FFF8E8' : '#fff',
      hBd: r.lowH ? C.amberLine : C.line,
      hBg: r.lowH ? '#FFF8E8' : '#fff',
    })),
    schedRows: SCANNED_SCHEDULE.map((g) => ({ ...g, bd: g.low ? C.amberLine : C.line })),

    // ---- One past game -----------------------------------------------------
    gameDetail: (() => {
      const g = s.history.find((x) => x.id === s.viewGameId);
      if (!g) return null;

      const dress = (lines) =>
        lines.map((raw) => {
          const l = normalizeLine(raw);
          return { ...l, pid: raw.pid, name: raw.name, obp: lineObp(l), extra: extraBaseTag(l) };
        });
      const sum = (lines) => {
        const total = lines.reduce((a, l) => addLines(a, normalizeLine(l)), { ...EMPTY_LINE });
        return { ...withRates(total), obp: lineObp(total) };
      };

      const homeLines = g.lines.filter((l) => l.team === 'home');
      const awayLines = g.lines.filter((l) => l.team === 'away');
      const won = g.result === 'W';
      const tied = g.result === 'T';

      return {
        id: g.id,
        opponent: g.opponent,
        homeAway: g.home ? 'vs' : 'at',
        dateLabel: g.label,
        sportLabel: (g.sport || 'kickball').replace(/^./, (c) => c.toUpperCase()),
        score: `${g.score.us}–${g.score.them}`,
        resultLabel: tied ? 'TIE' : won ? 'WIN' : 'LOSS',
        resultBg: tied ? 'rgba(255,255,255,.2)' : won ? '#DDF1F4' : 'rgba(255,255,255,.2)',
        resultFg: tied ? '#fff' : won ? C.teal : '#fff',
        inningsLabel: g.innings ? `${g.innings} inn` : '',
        homeLines: dress(homeLines),
        awayLines: dress(awayLines),
        homeTotals: sum(homeLines),
        awayTotals: sum(awayLines),
      };
    })(),

    // ---- Player profile ----------------------------------------------------
    prof: {
      ...prof,
      ini: initials(prof.name),
      // Number is optional, so only show the "#" when there is one.
      meta: [prof.num != null ? `#${prof.num}` : null, prof.pos, s.myTeam.name]
        .filter(Boolean)
        .join(' · '),
    },
    profStats: (() => {
      const t = seasonTotals(s.history, profPid);
      return [
        { k: 'AVG', v: t.avg },
        { k: 'OBP', v: t.obp },
        { k: 'SLG', v: t.slg },
        { k: 'OPS', v: t.ops },
        { k: 'RUNS', v: t.r },
        { k: 'RBI', v: t.rbi },
        { k: 'BB', v: t.bb },
        { k: 'K', v: t.k },
      ];
    })(),
    profSummary: (() => {
      const t = seasonTotals(s.history, profPid);
      if (!t.gp) return 'SEASON · no games played yet';
      return `SEASON · ${t.gp} ${t.gp === 1 ? 'GAME' : 'GAMES'} · ${t.h}-for-${t.ab} · ${t.hr} HR · ${t.tb} TB`;
    })(),
    trend: (() => {
      const games = onBaseByGame(s.history, profPid).slice(-9);
      const peak = Math.max(1, ...games.map((g) => g.obp));
      return games.map((g, i) => ({
        key: g.id,
        h: `${Math.round((g.obp / peak) * 100)}%`,
        c: i === games.length - 1 ? C.coral : C.teal,
      }));
    })(),
    trendFirst: (() => {
      const g = onBaseByGame(s.history, profPid).slice(-9);
      return g.length ? g[0].label : '';
    })(),
    trendLast: (() => {
      const g = onBaseByGame(s.history, profPid).slice(-9);
      return g.length ? g[g.length - 1].label : '';
    })(),
    gameLog: derivePlayerLog(s, profPid, actions),
    goBackFromPlayer: actions.go(s.playerFrom === 'league' ? 'league' : 'team'),
  };
}
