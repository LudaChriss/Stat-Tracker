const B = new URL('../src', import.meta.url).pathname;
const { applyOutcome } = await import(`${B}/game/logic.js`);
const { tallyStandings } = await import(`${B}/game/standings.js`);
const { seasonTotals } = await import(`${B}/game/stats.js`);
const { deriveView } = await import(`${B}/game/derive.js`);
const { INITIAL_STATE: BLANK, TEMPLATES } = await import(`${B}/data/league.js`);
const { SEEDED } = await import('./fixtures-history.js');

const seeded = SEEDED(BLANK);
let fail = 0;
const eq = (l, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) { fail++; console.log(`FAIL ${l}\n  got  ${JSON.stringify(got)}\n  want ${JSON.stringify(want)}`); }
  else console.log('ok   ' + l);
};
const kb = k => TEMPLATES.kickball.groups.flatMap(g => g.outcomes).find(x => x.k === k);
const A = new Proxy({}, { get: () => (...a) => () => {} });

// Mirror of useGame.cancelGame.
const cancelGame = (s) => ({
  ...s, screen: 'newgame', gameActive: false, gameFinal: false, liveTab: 'entry',
  half: 'top', inning: 1, outs: 0, bases: [null, null, null], score: { home: 0, away: 0 },
  kiHome: 0, kiAway: 0, gameStats: {}, events: [], undoStack: [], tape: [], lastPlay: null,
  bookOff: null, selRunner: null, posMenu: null, confirmFinal: false, confirmCancelGame: false,
});

// Play a substantial game so there is plenty to lose.
let s = { ...seeded, gameActive: true, half: 'bot', trackMode: 'both', screen: 'live', liveTab: 'book' };
['1B', '2B', 'HR', 'BB', 'K', '1B', 'F8', '3B', 'HR'].forEach((k) => { s = applyOutcome(s, kb(k)); });
eq('game in progress has a score', s.score.home > 0, true);
eq('game in progress has stats', Object.keys(s.gameStats).length > 0, true);
eq('game in progress has scorebook events', s.events.length, 9);

const before = {
  history: s.history.length,
  standings: tallyStandings(s).find((t) => t.you),
  ortiz: seasonTotals(s.history, 'h0'),
};

const after = cancelGame(s);

// Nothing recorded.
eq('no history entry', after.history.length, before.history);
eq('history is untouched', after.history, s.history);
eq('no stats recorded', after.gameStats, {});
eq('no scorebook events', after.events, []);
eq('no play tape', after.tape, []);
eq('no last play', after.lastPlay, null);
eq('undo stack cleared', after.undoStack, []);

// No standings change.
eq('standings unchanged', tallyStandings(after).find((t) => t.you), before.standings);
eq('season stats unchanged', seasonTotals(after.history, 'h0').avg, before.ortiz.avg);
eq('games played unchanged', seasonTotals(after.history, 'h0').gp, before.ortiz.gp);

// Back to a clean pre-game state.
eq('game no longer active', after.gameActive, false);
eq('not marked final', after.gameFinal, false);
eq('score reset', after.score, { home: 0, away: 0 });
eq('innings reset', [after.inning, after.half, after.outs], [1, 'top', 0]);
eq('bases cleared', after.bases, [null, null, null]);
eq('batting index reset', [after.kiHome, after.kiAway], [0, 0]);
eq('returns to the setup screen', after.screen, 'newgame');
eq('live tab reset for next time', after.liveTab, 'entry');
eq('open sheets closed', [after.confirmFinal, after.confirmCancelGame, after.posMenu], [false, false, null]);

// Season setup survives — only the game is discarded.
eq('batting order kept', after.lineup, s.lineup);
eq('bench kept', after.bench, s.bench);
eq('roster kept', after.roster.length, s.roster.length);
eq('teams kept', after.teams.length, s.teams.length);
eq('opponent kept', after.opponentId, s.opponentId);
eq('manual record kept', after.myTeam, s.myTeam);

// Starting again begins from nothing.
let again = { ...after, gameActive: true, half: 'bot' };
again = applyOutcome(again, kb('1B'));
eq('next game starts from zero', [again.score.home, again.events.length], [0, 1]);

// The warning names what is about to be lost.
const v = deriveView({ ...s, confirmCancelGame: true }, A);
eq('confirm is exposed', v.confirmCancelGame, true);
eq('summary shows the score', v.cancelSummary.includes(String(s.score.home)), true);
eq('detail counts the plays', v.cancelDetail.includes('9 plays'), true);
eq('detail names the half', v.cancelDetail.startsWith('Bottom of the'), true);

// Header label stays short unless tracking is limited.
eq('default tracking not spelled out', deriveView({ ...s, trackMode: 'both' }, A).trackLabel, '');
eq('limited tracking is flagged', deriveView({ ...s, trackMode: 'ours' }, A).trackLabel, ' · OUR TEAM ONLY');

console.log(fail ? `\n${fail} FAILED` : '\nall passed');
process.exit(fail ? 1 : 0);
