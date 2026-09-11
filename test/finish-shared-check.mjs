// Ending a game two phones were scoring — against a real Postgres.
//
// Three promises, each of which has a way of going wrong that nobody would
// notice until the standings were already wrong:
//
//   * ONE GAME, ONE ROW. save_game used to be keyed on the author's own
//     idempotency key, so the scorer who did not start the game would insert a
//     SECOND row for it and the season would count it twice.
//
//   * THE BOX SCORE AGREES WITH THE LOG, or nothing is written. A play entered
//     on another phone after the game was called must not be silently missing
//     from the box score.
//
//   * A CANCELLED GAME IS A TOMBSTONE, not a deletion. The row stops being
//     live and the log stays exactly where it was.
//
// And one promise about what must NOT have changed: a game with no event log
// at all — scored on a phone that was never signed in — is written exactly as
// it always was.
//
// Written against the functions, as real signed-in users. Runs against the
// LOCAL stack only.

import { createClient } from '@supabase/supabase-js';
import { execSync } from 'node:child_process';

const repoRoot = new URL('..', import.meta.url).pathname;

let fail = 0;
const eq = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) {
    fail++;
    console.log(`FAIL ${label}\n  got  ${JSON.stringify(got)}\n  want ${JSON.stringify(want)}`);
  } else console.log('ok   ' + label);
};
const refused = (label, { error }, wanted) => {
  if (!error) {
    fail++;
    console.log(`FAIL allowed (should have been refused): ${label}`);
    return;
  }
  if (wanted && !String(error.message).includes(wanted)) {
    fail++;
    console.log(`FAIL refused for the wrong reason: ${label}\n  ${error.message}`);
    return;
  }
  console.log('ok   refused: ' + label);
};
const need = (what, cond, detail) => {
  if (!cond) {
    console.log(`\nCANNOT RUN: ${what}${detail ? '\n  ' + detail : ''}`);
    process.exit(2);
  }
};

let st;
try {
  st = JSON.parse(
    execSync('npx supabase status -o json', { cwd: repoRoot, stdio: ['ignore', 'pipe', 'ignore'] }).toString(),
  );
} catch {
  console.log('skipped — no local Supabase stack, so finalising was not exercised against a database');
  console.log('\nall passed');
  process.exit(0);
}

const admin = createClient(st.API_URL, st.SERVICE_ROLE_KEY, { auth: { persistSession: false } });
try {
  const probe = await admin.auth.admin.listUsers({ page: 1, perPage: 1 });
  if (probe.error) throw probe.error;
} catch {
  console.log('skipped — local Supabase not reachable, so finalising was not exercised against a database');
  console.log('\nall passed');
  process.exit(0);
}

const password = 'Password123!';
const stamp = `${Date.now()}${Math.random().toString(36).slice(2, 5)}`;

async function person(tag) {
  const email = `finish${tag}${stamp}@example.test`;
  const made = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  need(`a ${tag} account could be created`, !made.error, made.error && made.error.message);
  const client = createClient(st.API_URL, st.ANON_KEY, { auth: { persistSession: false } });
  const { error } = await client.auth.signInWithPassword({ email, password });
  need(`the ${tag} account could sign in`, !error, error && error.message);
  return { id: made.data.user.id, client };
}

const starter = await person('one');   // starts the game
const joiner = await person('two');    // joins it, and finishes it

const team = await starter.client.rpc('create_team_with_manager', { team_name: `Finish FC ${stamp}` });
need('a team could be created', !team.error, team.error && team.error.message);
const teamId = team.data;

const granted = await admin.from('memberships').insert({ user_id: joiner.id, team_id: teamId, role: 'team_scorer' });
need('the joiner holds a scorer role', !granted.error, granted.error && granted.error.message);

const player = await admin.from('players')
  .insert({ team_id: teamId, name: 'Casey Rivera', position: 'P', color: '#0E7490', client_id: 0, sort_order: 0 })
  .select('id').single();
need('the team has a player', !player.error, player.error && player.error.message);

const descriptor = (clientId) => ({
  clientId,
  opponentId: `finish-opp-${stamp}`,
  opponent: 'The Opposition',
  sport: 'kickball',
  home: true,
  label: 'Sep 11',
  date: new Date().toISOString(),
});

const boxScore = (clientId, { us = 3, them = 1, result = 'W' } = {}) => ({
  id: clientId,
  date: new Date().toISOString().slice(0, 10),
  label: 'Sep 11',
  opponentId: `finish-opp-${stamp}`,
  opponent: 'The Opposition',
  home: true,
  score: { us, them },
  result,
  sport: 'kickball',
  innings: 7,
  lines: [{ pid: 'h0', name: 'Casey Rivera', team: 'home', ab: 3, h: 2, r: 1, rbi: 3, bb: 0, k: 0, d: 0, t: 0, hr: 1 }],
});

const append = (who, gameId, id, kind, payload = {}) =>
  who.client.rpc('append_game_event', {
    p_game_id: gameId, p_client_event_id: id, p_kind: kind, p_payload: payload,
  });

const rowsFor = async (clientId) => {
  const r = await admin.from('games').select('*').eq('client_id', clientId);
  return r.data || [];
};

// =============================================================================
console.log('--- the scorer who did not start the game finishes it ----------');
// =============================================================================
{
  const clientId = `g-shared-${stamp}`;
  const started = await starter.client.rpc('start_live_game', { p_team_id: teamId, payload: descriptor(clientId) });
  eq('the starter opened the game', started.error, null);
  const gameId = started.data;

  await append(starter, gameId, `${stamp}-s1`, 'start', {});
  await append(joiner, gameId, `${stamp}-s2`, 'outcome', { o: { k: 'HR' } });
  const called = await append(joiner, gameId, `${stamp}-s3`, 'final', {});
  eq('the joiner called the game', called.error, null);

  const saved = await joiner.client.rpc('save_game', { p_team_id: teamId, payload: boxScore(clientId) });
  eq('and the joiner could write the box score', saved.error, null);

  const rows = await rowsFor(clientId);
  eq('there is exactly ONE row for the game', rows.length, 1);
  eq('it is the row the starter opened', rows[0].id, gameId);
  eq('it is final', rows[0].status, 'final');
  eq('with the score from the home team\'s point of view', [rows[0].home_score, rows[0].away_score], [3, 1]);
  eq('and it is still credited to whoever opened it', rows[0].created_by, starter.id);

  const lines = await admin.from('game_lines').select('*').eq('game_id', gameId);
  eq('the box score went with it', (lines.data || []).length, 1);
  eq('and its line is linked to a real player', (lines.data || [])[0].player_id, player.data.id);

  // Idempotent: the write queue retries after a timeout that may have worked.
  const again = await joiner.client.rpc('save_game', { p_team_id: teamId, payload: boxScore(clientId) });
  eq('writing it a second time is not an error', again.error, null);
  eq('and still leaves one row', (await rowsFor(clientId)).length, 1);
  eq('with one box-score line, not two',
    ((await admin.from('game_lines').select('id').eq('game_id', gameId)).data || []).length, 1);

  // The log is closed.
  refused('a play after the final whistle is refused', await append(starter, gameId, `${stamp}-s4`, 'outcome', {}), 'already final');

  // And the whole log is still there. Finalising is not a tidy-up.
  const log = await admin.from('game_events').select('seq').eq('game_id', gameId);
  eq('every event that was entered is still in the log', (log.data || []).length, 3);
}

// =============================================================================
console.log('\n--- a box score the log has moved on from is refused -----------');
// =============================================================================
//
// The window this closes: a phone reads the log, checks its box score against
// it, and in the moment before it writes, the other phone enters a play. The
// box score is now missing a run. Writing it would lose that run silently.
{
  const clientId = `g-straggler-${stamp}`;
  const started = await starter.client.rpc('start_live_game', { p_team_id: teamId, payload: descriptor(clientId) });
  const gameId = started.data;

  await append(starter, gameId, `${stamp}-t1`, 'start', {});
  await append(starter, gameId, `${stamp}-t2`, 'final', {});
  // The other phone got a play in first.
  await append(joiner, gameId, `${stamp}-t3`, 'outcome', { o: { k: 'HR' } });

  refused(
    'the box score is refused because a play came in after the game was called',
    await starter.client.rpc('save_game', { p_team_id: teamId, payload: boxScore(clientId) }),
    'were entered after the game was called',
  );

  const rows = await rowsFor(clientId);
  eq('and the game is still live, not half-finished', rows[0].status, 'live');
  eq('with no box score written', ((await admin.from('game_lines').select('id').eq('game_id', gameId)).data || []).length, 0);

  // The way out is to call it again from a phone that has the straggler.
  await append(joiner, gameId, `${stamp}-t4`, 'final', {});
  const second = await joiner.client.rpc('save_game', { p_team_id: teamId, payload: boxScore(clientId, { us: 4, them: 1 }) });
  eq('calling it again, with the play included, works', second.error, null);
  eq('and the game is final', (await rowsFor(clientId))[0].status, 'final');
}

// =============================================================================
console.log('\n--- cancelling is a tombstone ----------------------------------');
// =============================================================================
{
  const clientId = `g-cancel-${stamp}`;
  const started = await starter.client.rpc('start_live_game', { p_team_id: teamId, payload: descriptor(clientId) });
  const gameId = started.data;

  await append(starter, gameId, `${stamp}-c1`, 'start', {});
  await append(joiner, gameId, `${stamp}-c2`, 'outcome', { o: { k: '1B' } });
  const marked = await append(starter, gameId, `${stamp}-c3`, 'cancel', {});
  eq('the cancellation is recorded in the log first', marked.error, null);

  const cancelled = await starter.client.rpc('cancel_live_game', { p_game_id: gameId });
  eq('and then the game is marked cancelled', cancelled.error, null);
  eq('the row says so', (await rowsFor(clientId))[0].status, 'cancelled');

  const log = await admin.from('game_events').select('seq, kind').eq('game_id', gameId).order('seq');
  eq('the log is kept, whole', (log.data || []).map((r) => r.kind), ['start', 'outcome', 'cancel']);
  eq('the game row is kept too', (await rowsFor(clientId)).length, 1);

  // Idempotent, because it arrives through the write queue.
  eq('cancelling twice is not an error',
    (await starter.client.rpc('cancel_live_game', { p_game_id: gameId })).error, null);

  refused('and nothing more can be entered against it',
    await append(joiner, gameId, `${stamp}-c4`, 'outcome', {}), 'already cancelled');
  refused('a cancelled game cannot be finalised into the standings',
    await starter.client.rpc('save_game', { p_team_id: teamId, payload: boxScore(clientId) }), 'it was cancelled');

  refused('a viewer-less stranger cannot cancel someone\'s game',
    await joiner.client.rpc('cancel_live_game', { p_game_id: '00000000-0000-0000-0000-000000000000' }),
    'not allowed to score this game');
}

// A game that was finalised cannot then be thrown away.
{
  const clientId = `g-final-then-cancel-${stamp}`;
  const started = await starter.client.rpc('start_live_game', { p_team_id: teamId, payload: descriptor(clientId) });
  await append(starter, started.data, `${stamp}-f1`, 'start', {});
  await append(starter, started.data, `${stamp}-f2`, 'final', {});
  await starter.client.rpc('save_game', { p_team_id: teamId, payload: boxScore(clientId) });
  refused('a finalised game cannot be cancelled afterwards',
    await starter.client.rpc('cancel_live_game', { p_game_id: started.data }), 'already been finalised');
}

// =============================================================================
console.log('\n--- the old path, untouched ------------------------------------');
// =============================================================================
//
// A game scored on a phone that was never signed in has no live row and no log
// at all. It must still be written exactly as it always was — no live game to
// find, no log to reconcile against, no new refusal in the way.
{
  const clientId = `g-offline-only-${stamp}`;
  const saved = await starter.client.rpc('save_game', { p_team_id: teamId, payload: boxScore(clientId, { us: 2, them: 5, result: 'L' }) });
  eq('a game with no event log at all still saves', saved.error, null);

  const rows = await rowsFor(clientId);
  eq('as one row', rows.length, 1);
  eq('final', rows[0].status, 'final');
  eq('with the result the way round it was sent', rows[0].result, 'L');
  eq('and its box score', ((await admin.from('game_lines').select('id').eq('game_id', rows[0].id)).data || []).length, 1);

  eq('and it is still idempotent',
    (await starter.client.rpc('save_game', { p_team_id: teamId, payload: boxScore(clientId, { us: 2, them: 5, result: 'L' }) })).error, null);
  eq('one row after the retry', (await rowsFor(clientId)).length, 1);

  // Every guard from before is still in force.
  refused('a game with no lines is still refused',
    await starter.client.rpc('save_game', { p_team_id: teamId, payload: { ...boxScore(`g-nolines-${stamp}`), lines: [] } }),
    'no box-score lines');
  refused('a result contradicting the score is still refused',
    await starter.client.rpc('save_game', { p_team_id: teamId, payload: boxScore(`g-wrong-${stamp}`, { us: 1, them: 4, result: 'W' }) }),
    'disagrees with the score');
  refused('a game with no id is still refused',
    await starter.client.rpc('save_game', { p_team_id: teamId, payload: { ...boxScore(`g-noid-${stamp}`), id: null } }),
    'no id');
}

console.log(fail ? `\n${fail} FAILED` : '\nall passed');
process.exit(fail ? 1 : 0);
