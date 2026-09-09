const B = new URL('../src', import.meta.url).pathname;
const { applyOutcome, buildGameRecord, currentKicker, awayLineup, playerName, playerById, homePid, opponentTeam } = await import(`${B}/game/logic.js`);
const { tallyStandings } = await import(`${B}/game/standings.js`);
const { seasonTotals } = await import(`${B}/game/stats.js`);
const { INITIAL_STATE: BLANK, TEMPLATES } = await import(`${B}/data/league.js`);
const { SEEDED } = await import('./fixtures-history.js');
const INITIAL_STATE = SEEDED(BLANK);
const { oppPid, slugId, nextId } = await import(`${B}/data/ids.js`);

let fail = 0;
const eq = (l, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) { fail++; console.log(`FAIL ${l}\n  got  ${JSON.stringify(got)}\n  want ${JSON.stringify(want)}`); }
  else console.log('ok   ' + l);
};
const kb = k => TEMPLATES.kickball.groups.flatMap(g => g.outcomes).find(x => x.k === k);
const row = (s, name) => tallyStandings(s).find(r => r.name === name);

// --- id helpers ---
eq('slug from name', slugId('Bay Area Bandits', []), 'bay-area-bandits');
eq('slug avoids collision', slugId('Ringers', [{ id: 'ringers' }]), 'ringers-2');
eq('slug survives punctuation', slugId("Mike's Bar & Grill!", []), 'mike-s-bar-grill');
eq('nextId on empty', nextId([]), 0);
eq('nextId skips gaps', nextId([{ id: 0 }, { id: 5 }]), 6);

// --- opponent with no roster: anonymous slots, score only ---
let s = { ...INITIAL_STATE };
eq('seeded teams have no roster', opponentTeam(s).players.length, 0);
eq('anonymous lineup is 9 slots', awayLineup(s).length, 9);
eq('anonymous batter naming', awayLineup(s)[0].name, 'Batter 1');
eq('anonymous batter pid', awayLineup(s)[0].pid, 'a0');
eq('kicker in top half is anonymous', currentKicker({ ...s, half: 'top' }).name, 'Batter 1');

// --- add players to an opposing team: they become identified ---
const withRoster = {
  ...s,
  teams: s.teams.map(t => t.id === 'rubber-chickens'
    ? { ...t, players: [{ id: 0, name: 'R. Chen', num: 9, pos: 'P', c: '#000' }, { id: 1, name: 'D. Okafor', num: 2, pos: 'C', c: '#000' }] }
    : t),
};
eq('rostered opponent lineup length', awayLineup(withRoster).length, 2);
eq('rostered opponent pid namespaced', awayLineup(withRoster)[0].pid, oppPid('rubber-chickens', 0));
eq('rostered opponent name resolves', playerName(withRoster, oppPid('rubber-chickens', 0)), 'R. Chen');
eq('anon pid still resolves to a slot', playerName(withRoster, 'a3'), 'Batter 4');
eq('deleted player resolves safely', playerName(withRoster, oppPid('rubber-chickens', 99)), '—');
eq('unknown team resolves safely', playerName(withRoster, oppPid('nope', 0)), '—');

// Opposing player stats accumulate across games (anonymous ones cannot).
let g = { ...withRoster, gameActive: true, trackMode: 'both', half: 'top', opponentId: 'rubber-chickens' };
g = applyOutcome(g, kb('HR'));
eq('opponent HR credited to their id', g.gameStats[oppPid('rubber-chickens', 0)].hr, 1);
const rec = buildGameRecord(g, { date: new Date('2026-09-10') });
eq('record keeps opponent id', rec.opponentId, 'rubber-chickens');
eq('record keeps opponent name', rec.opponent, 'Rubber Chickens');
eq('opponent line in box score', rec.lines.find(l => l.team === 'away').name, 'R. Chen');
eq('opponent season accrues', seasonTotals([rec], oppPid('rubber-chickens', 0)).hr, 1);

// --- removing a player must not break the lineup ---
const removed = {
  ...s,
  roster: s.roster.filter(p => p.id !== 2),
  lineup: s.lineup.filter(x => x !== 2),
  bench: s.bench.filter(x => x !== 2),
};
eq('lineup drops removed player', removed.lineup.includes(2), false);
eq('remaining lineup still resolves', removed.lineup.every(id => !!playerById(removed, id)), true);
let r = { ...removed, gameActive: true, half: 'bot' };
for (let i = 0; i < 8; i++) r = applyOutcome(r, kb('1B'));
eq('batting through a shortened order works', r.score.home > 0, true);
eq('past games keep the removed name', s.history[0].lines.find(l => l.pid === homePid(2)).name, 'Priya Shah');

// --- removing a team ---
const teamGone = { ...s, teams: s.teams.filter(t => t.id !== 'the-ringers') };
eq('deleted team leaves the table', tallyStandings(teamGone).length, 4);
eq('our record still counts that game', [row(teamGone, 'Grass Stains').w, row(teamGone, 'Grass Stains').l], [7, 2]);
eq('history still names the deleted team', s.history.find(x => x.opponentId === 'the-ringers').opponent, 'The Ringers');

// --- an empty league (what #6 produces) ---
const blank = { ...INITIAL_STATE, myTeam: { name: 'My Team', priorW: 0, priorL: 0 }, roster: [], teams: [], lineup: [], bench: [], history: [], opponentId: null };
eq('blank standings show only us', tallyStandings(blank).map(r => [r.name, r.w, r.l]), [['My Team', 0, 0]]);
eq('blank opponent falls back', opponentTeam(blank).name, 'Opponent');
eq('blank away lineup is anonymous', awayLineup(blank).length, 9);
eq('blank season totals are empty', seasonTotals([], homePid(0)).avg, '—');

console.log(fail ? `\n${fail} FAILED` : '\nall passed');
process.exit(fail ? 1 : 0);
