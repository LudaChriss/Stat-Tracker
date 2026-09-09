// Turns raw state into everything the screens render. Keeping this in one
// place means the screen components stay declarative — they read values and
// wire up handlers, they don't compute standings or scorebook grids.

import {
  AWAY_NAMES,
  AWAY_TEAM,
  HOME_TEAM,
  POSITIONS,
  ROSTER,
  TEMPLATES,
} from '../data/league.js';
import { currentKicker, initials, obpString, ordinal, rateString, statLine } from './logic.js';
import { C } from '../theme.js';

const TONES = {
  teal: { bg: C.teal, fg: '#fff', bd: 'none' },
  slate: { bg: C.slate, fg: '#fff', bd: 'none' },
  line: { bg: 'transparent', fg: C.pale, bd: '1.5px solid rgba(255,255,255,.25)' },
};

const BASE_LABELS = ['1st', '2nd', '3rd'];

// Season standings before tonight's result is folded in.
const BASE_STANDINGS = [
  [HOME_TEAM, 7, 2, true],
  [AWAY_TEAM, 6, 3, false],
  ['Dirt Merchants', 5, 4, false],
  ['Sunday Scaries', 3, 6, false],
  ['The Ringers', 2, 7, false],
];

const TREND_VALUES = [38, 42, 40, 47, 44, 52, 49, 55, 58];

const STAT_SETS = [
  { label: 'Core', cols: ['AVG', 'OBP', 'OPS'], pick: (p) => [p.avg, p.obp, p.ops] },
  { label: 'Counting', cols: ['R', 'RBI', 'BB'], pick: (p) => [p.r, p.rbi, p.bb] },
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
  { opp: AWAY_TEAM,        when: 'Thu Sep 24 · 7:00 PM',  where: 'Riverbend Park #2', low: false },
];

const OCR_STEPS = [
  { label: '✓ Captured' },
  { label: '✓ OCR · 23 symbols' },
  { label: '✓ Parsed to stat lines' },
  { label: '2 to check', warn: true },
];

const GAME_LOG = [
  { date: 'Aug 30', opp: 'vs Dirt Merchants', line: '3-4 · 2 R · 1 RBI' },
  { date: 'Aug 23', opp: 'at The Ringers',    line: '1-3 · 0 R · 1 RBI' },
  { date: 'Aug 16', opp: 'vs Sunday Scaries', line: '2-3 · 2 R · 2 RBI' },
  { date: 'Aug 9',  opp: `vs ${AWAY_TEAM}`,   line: '2-4 · 1 R · 0 RBI' },
];

const RANK_LABELS = ['1st', '2nd', '3rd', '4th', '5th'];

/** League table, re-sorted once tonight's game is final. */
function deriveStandings(s, actions) {
  const rows = BASE_STANDINGS.map((t) => [...t]);
  if (s.gameFinal) {
    const won = s.score.home >= s.score.away;
    rows[0][1] += won ? 1 : 0;
    rows[0][2] += won ? 0 : 1;
    rows[1][1] += won ? 0 : 1;
    rows[1][2] += won ? 1 : 0;
  }
  rows.sort((a, b) => b[1] / (b[1] + b[2]) - a[1] / (a[1] + a[2]));

  return rows.map(([name, w, l, you], i) => ({
    rank: i + 1,
    name,
    w,
    l,
    pct: rateString(w, w + l),
    you,
    wt: you ? 800 : 600,
    bg: you ? '#F4FAFB' : '#fff',
    onTap: you ? actions.goTeam : actions.noop,
  }));
}

/** The three "this week" cards; the first reflects tonight's game state. */
function deriveSchedule(s) {
  let tonight;
  if (s.gameFinal) {
    tonight = {
      tag: 'FINAL',
      tagColor: C.teal,
      line: `GS ${s.score.home} · RC ${s.score.away}`,
      sub: 'Today · Riverbend #2',
    };
  } else if (s.gameActive) {
    tonight = {
      tag: '● LIVE',
      tagColor: C.coral,
      line: `GS ${s.score.home} · RC ${s.score.away}`,
      sub: `${s.half === 'top' ? '▲ ' : '▼ '}${ordinal(s.inning)}`,
    };
  } else {
    tonight = { tag: 'TONIGHT', tagColor: C.coral, line: 'GS vs RC', sub: '6:30 PM · Riverbend #2' };
  }

  return [
    tonight,
    { tag: 'THU', tagColor: C.muted, line: 'DM vs SS', sub: '7:00 PM · Riverbend #1' },
    { tag: 'SAT', tagColor: C.muted, line: 'TR vs GS', sub: '10:00 AM · Eastside HS' },
  ];
}

/** Who's up next and in the hole, with their line so far today. */
function deriveOnDeck(s) {
  if (!s.gameActive) return [];

  return [1, 2].map((d) => {
    let name;
    let c;
    if (s.half === 'bot') {
      const p = ROSTER[s.lineup[(s.kiHome + d) % s.lineup.length]];
      name = p.name;
      c = p.c;
    } else {
      name = AWAY_NAMES[(s.kiAway + d) % AWAY_NAMES.length];
      c = C.muted;
    }
    const g = statLine(s.gameStats, name);
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
    const p = ROSTER[id];
    const [first, last] = p.name.split(' ');
    flat.push({
      isName: true,
      isCell: false,
      slot: idx + 1,
      label: `${first[0]}. ${last}`,
      sub: posOf(p),
    });
    cols.forEach((col) => {
      const pa = s.events.filter((e) => e.name === p.name && e.inning === col.n && e.half === 'bot');
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
  const kickerGame = statLine(s.gameStats, kicker.name);

  const standings = deriveStandings(s, actions);
  const me = standings.find((t) => t.you);
  const set = STAT_SETS[s.statSet];

  // ---- Lineup / bench ------------------------------------------------------
  const lineupView = s.lineup.map((id, idx) => {
    const p = ROSTER[id];
    const g = s.gameStats[p.name];
    const upNow = s.gameActive && s.half === 'bot' && idx === s.kiHome % s.lineup.length;
    return {
      slot: idx + 1,
      name: p.name,
      ini: initials(p.name),
      c: p.c,
      pos: posOf(p),
      stat: g ? `Today ${g.h}-${g.ab} · ${g.r} R` : `${p.avg} AVG · ${p.ops} OPS`,
      upNow,
      upTag: upNow ? 'UP NOW ›' : '',
      goEntry: upNow ? actions.setLiveTab('entry') : actions.noop,
      bg: upNow ? 'rgba(45,225,252,.1)' : 'transparent',
      openPos: actions.openPosMenu(p.id),
      up: actions.moveLineup(idx, -1),
      down: actions.moveLineup(idx, 1),
    };
  });

  const benchView = s.bench.map((id) => {
    const p = ROSTER[id];
    return { name: p.name, ini: initials(p.name), c: p.c, add: actions.addFromBench(id) };
  });

  // ---- Live stats table ----------------------------------------------------
  const statsHome = s.statsTeam === 'home';
  const statRoster = statsHome
    ? s.lineup.map((id, idx) => ({
        name: ROSTER[id].name,
        up: s.half === 'bot' && idx === s.kiHome % s.lineup.length,
      }))
    : AWAY_NAMES.map((n, idx) => ({ name: n, up: s.half === 'top' && idx === s.kiAway % AWAY_NAMES.length }));

  const liveStatRows = statRoster.map((row) => {
    const g = statLine(s.gameStats, row.name);
    const isUp = row.up && s.gameActive;
    return {
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
  const prof = ROSTER[s.playerId] || ROSTER[0];
  const posMenuPlayer = s.posMenu != null ? ROSTER[s.posMenu] : null;
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

    notSynced: !s.synced,
    toastMsg: s.toast,

    // ---- League ------------------------------------------------------------
    schedule: deriveSchedule(s),
    standings,
    leaders: [
      {
        name: 'Priya Shah',
        team: 'GS',
        val: 16 + (s.gameFinal ? statLine(s.gameStats, 'Priya Shah').r : 0),
        c: C.coral,
        pid: 2,
      },
      { name: 'Maya Ortiz', team: 'GS', val: 14, c: C.teal, pid: 0 },
      { name: 'R. Chen', team: 'RC', val: 13, c: C.muted, pid: -1 },
    ].map((p) => ({
      ...p,
      ini: initials(p.name),
      onTap: p.pid >= 0 ? actions.openPlayer(p.pid, 'league') : actions.noop,
    })),

    // ---- Team --------------------------------------------------------------
    teamRecord: `${me.w}–${me.l} · ${RANK_LABELS[me.rank - 1]} in league`,
    teamAgg: [
      { k: 'TEAM AVG', v: '.428' },
      { k: 'TEAM OPS', v: '1.021' },
      { k: 'RUNS/GM', v: '8.8' },
      { k: 'ERRORS', v: '11' },
    ],
    statSetLabel: set.label === 'Core' ? 'AVG · OBP · OPS' : 'R · RBI · BB',
    statCols: set.cols,
    rosterView: ROSTER.map((p) => {
      const v = set.pick(p);
      return {
        ...p,
        ini: initials(p.name),
        s1: v[0],
        s2: v[1],
        s3: v[2],
        onTap: actions.openPlayer(p.id, 'team'),
      };
    }),
    teamGames: [
      s.gameFinal
        ? {
            tag: 'FINAL',
            tagColor: C.teal,
            line: `vs ${AWAY_TEAM}`,
            sub: `${s.score.home >= s.score.away ? 'W ' : 'L '}${s.score.home}–${s.score.away}`,
          }
        : {
            tag: s.gameActive ? '● LIVE' : 'NEXT',
            tagColor: C.coral,
            line: `vs ${AWAY_TEAM}`,
            sub: s.gameActive ? `${s.score.home}–${s.score.away}` : 'Today 6:30',
          },
      { tag: 'W 9–4', tagColor: C.teal, line: 'vs Dirt Merchants', sub: 'Aug 30' },
      { tag: 'L 3–5', tagColor: C.fog, line: 'at The Ringers', sub: 'Aug 23' },
    ],

    // ---- New game ----------------------------------------------------------
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
    selName: sel != null ? s.bases[sel] : '',
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
    finalLine: `${HOME_TEAM} ${s.score.home} — ${AWAY_TEAM} ${s.score.away}`,
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

    // ---- Player profile ----------------------------------------------------
    prof: { ...prof, ini: initials(prof.name) },
    profStats: [
      { k: 'AVG', v: prof.avg },
      { k: 'OBP', v: prof.obp },
      { k: 'SLG', v: prof.slg },
      { k: 'OPS', v: prof.ops },
      { k: 'RUNS', v: prof.r },
      { k: 'RBI', v: prof.rbi },
      { k: 'BB', v: prof.bb },
      { k: 'K', v: prof.k },
    ],
    trend: TREND_VALUES.map((v, i) => ({
      h: `${Math.round((v / 58) * 100)}%`,
      c: i === TREND_VALUES.length - 1 ? C.coral : C.teal,
    })),
    gameLog: GAME_LOG,
    goBackFromPlayer: actions.go(s.playerFrom === 'league' ? 'league' : 'team'),
  };
}
