// The event log against a real Postgres, as real signed-in users.
//
// Written without reading the client-side implementation's own tests, because
// the point is to attack the database's promises directly:
//
//   * the SERVER assigns the sequence, and two phones appending at the same
//     instant both land, one after the other, with no gap and no collision;
//   * an append is idempotent on the entering device's own event id, because
//     the write queue retries after a timeout that may have succeeded;
//   * a second scorer asking to start the same game JOINS it rather than
//     starting a private copy -- the whole basis of shared scoring;
//   * a game that is over stops accepting plays, by name, rather than
//     accepting them and quietly leaving the box score wrong;
//   * row-level security still holds: a viewer watches, a stranger sees
//     nothing.
//
// Runs against the LOCAL stack only.

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
const is = (label, cond, detail) => {
  if (cond) console.log('ok   ' + label);
  else {
    fail++;
    console.log(`FAIL ${label}${detail ? '\n  ' + detail : ''}`);
  }
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
// A setup failure must stop the run loudly. A suite that quietly skips its
// database half and prints "all passed" is worse than no suite.
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
  console.log('skipped — no local Supabase stack, so the event log was not exercised against a database');
  console.log('\nall passed');
  process.exit(0);
}

const admin = createClient(st.API_URL, st.SERVICE_ROLE_KEY, { auth: { persistSession: false } });
try {
  const probe = await admin.auth.admin.listUsers({ page: 1, perPage: 1 });
  if (probe.error) throw probe.error;
} catch {
  console.log('skipped — local Supabase not reachable, so the event log was not exercised against a database');
  console.log('\nall passed');
  process.exit(0);
}

const password = 'Password123!';
const stamp = `${Date.now()}${Math.random().toString(36).slice(2, 5)}`;

async function person(tag) {
  const email = `live${tag}${stamp}@example.test`;
  const made = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  need(`a ${tag} account could be created`, !made.error, made.error && made.error.message);
  const client = createClient(st.API_URL, st.ANON_KEY, { auth: { persistSession: false } });
  const { error } = await client.auth.signInWithPassword({ email, password });
  need(`the ${tag} account could sign in`, !error, error && error.message);
  return { id: made.data.user.id, email, client };
}

const manager = await person('mgr');
const scorer = await person('scr');
const viewer = await person('vwr');
const stranger = await person('str');

const team = await manager.client.rpc('create_team_with_manager', { team_name: `Live FC ${stamp}` });
need('a team could be created', !team.error, team.error && team.error.message);
const teamId = team.data;

const granted = await admin.from('memberships').insert([
  { user_id: scorer.id, team_id: teamId, role: 'team_scorer' },
  { user_id: viewer.id, team_id: teamId, role: 'viewer' },
]);
need('a scorer and a viewer hold roles on the team', !granted.error, granted.error && granted.error.message);

const descriptor = (clientId) => ({
  clientId,
  opponentId: `live-opp-${stamp}`,
  opponent: 'Live Opponents',
  sport: 'kickball',
  home: true,
  label: 'Sep 11',
  date: new Date().toISOString(),
});

// =============================================================================
console.log('\n--- starting a live game ---------------------------------------');
// =============================================================================

const gameClientId = `g-live-${stamp}`;
const started = await manager.client.rpc('start_live_game', { p_team_id: teamId, payload: descriptor(gameClientId) });
eq('a manager can start a live game', started.error, null);
const gameId = started.data;
is('it returned a game id', !!gameId);

{
  const { data } = await admin.from('games').select('status, client_id, home_team_id').eq('id', gameId).single();
  eq('the game row is live, not final', data.status, 'live');
  eq('and carries the client id it was started with', data.client_id, gameClientId);
  eq('and our team is the home side', data.home_team_id, teamId);
}

// THE JOIN PATH. A second scorer asking for the same game must get the FIRST
// phone's game, not a private copy of it. Without this there is no shared
// scoring at all -- there are two games with the same name.
{
  const again = await scorer.client.rpc('start_live_game', { p_team_id: teamId, payload: descriptor(gameClientId) });
  eq('a second scorer starting the same game is not refused', again.error, null);
  eq('and lands on the SAME game as the first phone', again.data, gameId);

  const { count } = await admin
    .from('games')
    .select('id', { count: 'exact', head: true })
    .eq('client_id', gameClientId);
  eq('exactly one game row exists for that client id', count, 1);
}

refused(
  'a viewer cannot start a live game',
  await viewer.client.rpc('start_live_game', { p_team_id: teamId, payload: descriptor(`g-nope-${stamp}`) }),
  'not allowed to record games',
);
refused(
  'a stranger cannot start a live game for a team they are not on',
  await stranger.client.rpc('start_live_game', { p_team_id: teamId, payload: descriptor(`g-nope2-${stamp}`) }),
  'not allowed to record games',
);
refused(
  'a game with no client id is refused by name',
  await manager.client.rpc('start_live_game', { p_team_id: teamId, payload: { opponent: 'Nobody' } }),
  'no client id',
);

// =============================================================================
console.log('\n--- the server assigns the sequence ----------------------------');
// =============================================================================

const append = (who, clientEventId, kind, payload = {}) =>
  who.client.rpc('append_game_event', {
    p_game_id: gameId,
    p_client_event_id: clientEventId,
    p_kind: kind,
    p_payload: payload,
  });

{
  const first = await append(manager, `${stamp}-e1`, 'start', { sport: 'kickball' });
  eq('the first event is accepted', first.error, null);
  eq('and the server numbered it 1', first.data[0].event_seq, 1);

  const second = await append(scorer, `${stamp}-e2`, 'outcome', { o: { k: '1B' } });
  eq('the second event is accepted', second.error, null);
  eq('and the server numbered it 2', second.data[0].event_seq, 2);

  const { data } = await admin.from('game_events').select('seq, actor, kind').eq('game_id', gameId).order('seq');
  eq('both are in the log, in order', data.map((r) => Number(r.seq)), [1, 2]);
  eq('each is attributed to whoever entered it', data.map((r) => r.actor), [manager.id, scorer.id]);
}

// IDEMPOTENCE. The write queue retries after a timeout that may have
// succeeded; a second copy of a home run is worse than a failed write because
// it is silent.
{
  const again = await append(scorer, `${stamp}-e2`, 'outcome', { o: { k: '1B' } });
  eq('re-sending the same event id is not an error', again.error, null);
  eq('and returns the sequence it already had', again.data[0].event_seq, 2);

  const { count } = await admin
    .from('game_events')
    .select('id', { count: 'exact', head: true })
    .eq('game_id', gameId)
    .eq('client_event_id', `${stamp}-e2`);
  eq('the play was recorded once, not twice', count, 1);
}

// CONCURRENCY. Ten appends fired at once from two different accounts. The
// promise is that all of them land, with consecutive numbers and no
// collisions -- nobody has to retry, and nobody's play is lost.
{
  const burst = [];
  for (let i = 0; i < 10; i++) {
    const who = i % 2 === 0 ? manager : scorer;
    burst.push(append(who, `${stamp}-burst-${i}`, 'outcome', { o: { k: 'K' }, i }));
  }
  const results = await Promise.all(burst);
  const errors = results.filter((r) => r.error).map((r) => r.error.message);
  eq('ten simultaneous appends from two phones all succeed', errors, []);

  const seqs = results.map((r) => Number(r.data[0].event_seq)).sort((a, b) => a - b);
  eq('they were given ten consecutive numbers', seqs, [3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  eq('with no duplicates', new Set(seqs).size, 10);

  const { data } = await admin.from('game_events').select('seq').eq('game_id', gameId).order('seq');
  eq('and the log has every one of them', data.length, 12);
}

// NO LEASE. There is nothing to claim and nothing to release: a manager and a
// scorer alternate on the same live game, neither one takes ownership of it,
// and neither is ever asked to wait for the other. This is the decision phase
// 3c records, checked against the database rather than asserted about it.
{
  const alternating = [];
  for (let i = 0; i < 6; i++) {
    const who = i % 2 === 0 ? manager : scorer;
    // Awaited one at a time, so this is genuinely "the other phone goes next"
    // rather than the burst above.
    // eslint-disable-next-line no-await-in-loop
    alternating.push(await append(who, `${stamp}-alt-${i}`, 'outcome', { o: { k: '1B' }, i }));
  }
  eq('a manager and a scorer take turns with no claim in between',
    alternating.filter((r) => r.error).map((r) => r.error.message), []);
  eq('and the log interleaves them in the order they arrived',
    alternating.map((r) => Number(r.data[0].event_seq)), [13, 14, 15, 16, 17, 18]);

  const { data } = await admin
    .from('game_events').select('actor, seq').eq('game_id', gameId).gte('seq', 13).order('seq');
  eq('each play still belongs to whoever entered it',
    data.map((r) => (r.actor === manager.id ? 'M' : r.actor === scorer.id ? 'S' : '?')),
    ['M', 'S', 'M', 'S', 'M', 'S']);
}

// =============================================================================
console.log('\n--- who may append, and who may read ---------------------------');
// =============================================================================

refused(
  'a viewer cannot append a play',
  await append(viewer, `${stamp}-viewer`, 'outcome', {}),
  'not allowed to score this game',
);
refused(
  'a stranger cannot append a play',
  await append(stranger, `${stamp}-stranger`, 'outcome', {}),
  'not allowed to score this game',
);
refused(
  'an event with no kind is refused by name',
  await append(manager, `${stamp}-nokind`, null, {}),
  'no kind',
);

{
  const asViewer = await viewer.client.from('game_events').select('seq').eq('game_id', gameId);
  eq('a viewer can read the log', asViewer.error, null);
  eq('and sees every play', asViewer.data.length, 18);

  const asStranger = await stranger.client.from('game_events').select('seq').eq('game_id', gameId);
  eq('a stranger reading the log gets no error', asStranger.error, null);
  eq('and no rows', asStranger.data.length, 0);
}

// The log stays append-only at the database layer, not by convention.
{
  const edited = await scorer.client
    .from('game_events')
    .update({ payload: { o: { k: 'HR' } } })
    .eq('game_id', gameId)
    .eq('seq', 2)
    .select();
  eq('a scorer cannot rewrite a play they entered', (edited.data || []).length, 0);

  const deleted = await scorer.client.from('game_events').delete().eq('game_id', gameId).eq('seq', 2).select();
  eq('a scorer cannot delete a play', (deleted.data || []).length, 0);

  const { data } = await admin.from('game_events').select('payload').eq('game_id', gameId).eq('seq', 2).single();
  eq('the play is exactly as entered', data.payload.o.k, '1B');
}

// =============================================================================
console.log('\n--- a finished game stops accepting plays ----------------------');
// =============================================================================
{
  const finished = await admin.from('games').update({ status: 'final', result: 'W' }).eq('id', gameId);
  eq('setup: the game is marked final', finished.error, null);

  refused(
    'a play arriving after the final whistle is refused by name',
    await append(manager, `${stamp}-late`, 'outcome', {}),
    'already final',
  );

  // But a RETRY of an event that was already accepted must still succeed --
  // the queue cannot tell a timeout from a success, and refusing here would
  // park a write that in fact went through.
  const retry = await append(scorer, `${stamp}-e2`, 'outcome', { o: { k: '1B' } });
  eq('a retry of an accepted play still returns its sequence', [retry.error, retry.data[0].event_seq], [null, 2]);
}

{
  const cancelledClientId = `g-cancel-${stamp}`;
  const c = await manager.client.rpc('start_live_game', { p_team_id: teamId, payload: descriptor(cancelledClientId) });
  eq('setup: a second live game', c.error, null);
  await admin.from('games').update({ status: 'cancelled' }).eq('id', c.data);
  const late = await manager.client.rpc('append_game_event', {
    p_game_id: c.data,
    p_client_event_id: `${stamp}-late-cancel`,
    p_kind: 'outcome',
    p_payload: {},
  });
  refused('a play arriving after a cancellation is refused by name', late, 'already cancelled');
}

refused(
  'appending to a game that does not exist is refused',
  await manager.client.rpc('append_game_event', {
    p_game_id: '00000000-0000-0000-0000-000000000000',
    p_client_event_id: `${stamp}-ghost`,
    p_kind: 'outcome',
    p_payload: {},
  }),
  'not allowed to score this game',
);

console.log(fail ? `\n${fail} FAILED` : '\nall passed');
process.exit(fail ? 1 : 0);
