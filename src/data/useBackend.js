// Deciding, on launch, which season the app is looking at.
//
// The sequence is: is there a backend at all -> is anyone signed in -> which
// team is theirs -> does this device agree with the account. Only the last step
// can ever need the user, and only when the two genuinely disagree.
//
// The invariant running through all of it: local data is never deleted and
// never modified by any of these paths. Adopting the account's season demotes
// the local copy to a cache; it stays on the device and stays exportable.
//
// There are three account states, not two, and the middle one is the point:
//
//   ready       signed in, the account is reachable
//   stale       we hold a session but could not reach the server. NOT signed
//               out. The season stays on screen, finalising a game still saves
//               and still queues, and everything syncs when the signal returns.
//   signed-out  nobody is signed in, or the server rejected the refresh token.
//               The local season is still fully usable; sign-in is offered,
//               never imposed.
//
// Conflating the middle one with the last is what locked someone out of a
// season sitting on their own phone.

import { useCallback, useEffect, useRef, useState } from 'react';
import { getSupabase, isSupabaseConfigured } from './supabaseClient.js';
import { createAuth } from './auth.js';
import { createLocalRepository } from './localRepository.js';
import { createSupabaseRepository, forgetSyncedGames } from './supabaseRepository.js';
import { decideSync, isEmptySeason, summarize, verifyMigration } from './seasonSync.js';
import { createInvites } from './invites.js';
import { buildExport } from '../game/export.js';

const TEAM_KEY = 'score-tracker:teamId';
// Who was last signed in here. Needed when we hold a session we cannot use:
// writes still have to be stamped with the account they belong to, and there
// is no session object to read the id from.
const USER_KEY = 'score-tracker:userId';

// How long to wait for the auth server before showing the season anyway.
// supabase-js retries a failed refresh with backoff — measured at 26 seconds
// on a blocked endpoint — and a splash screen for that long, holding a season
// that is already on the device, is indistinguishable from the app being
// broken.
const AUTH_PATIENCE_MS = 2500;

const readTeamId = () => {
  try {
    return localStorage.getItem(TEAM_KEY);
  } catch {
    return null;
  }
};
const writeTeamId = (id) => {
  try {
    if (id) localStorage.setItem(TEAM_KEY, id);
  } catch {
    /* best effort */
  }
};

const readUserId = () => {
  try {
    return localStorage.getItem(USER_KEY);
  } catch {
    return null;
  }
};
const writeUserId = (id) => {
  try {
    if (id) localStorage.setItem(USER_KEY, id);
    // Not data: it only records which account this device last spoke to.
    else localStorage.removeItem(USER_KEY);
  } catch {
    /* best effort */
  }
};

export function useBackend() {
  const client = getSupabase();
  const authRef = useRef(null);
  if (!authRef.current) authRef.current = createAuth(client);
  const auth = authRef.current;

  const invitesRef = useRef(null);
  if (!invitesRef.current) invitesRef.current = createInvites(client);

  const localRef = useRef(null);
  if (!localRef.current) localRef.current = createLocalRepository();
  const local = localRef.current;

  const [state, setState] = useState(() => ({
    status: isSupabaseConfigured ? 'loading' : 'local-only',
    session: null,
    repository: local,
    teamId: null,
    error: null,
    choice: null,
    // Which role this account holds on the team it is looking at. Null until
    // resolved, and never assumed: the UI offers to invite only when the
    // database has said this user manages the team.
    role: null,
  }));

  // Actions are called from event handlers long after they were defined, so
  // they read the live state through a ref rather than a captured copy.
  const stateRef = useRef(state);
  stateRef.current = state;

  const teamIdRef = useRef(null);
  // Whose writes the queue is stamping. Kept in a ref so the repository reads
  // the current value rather than one captured when it was built.
  const userIdRef = useRef(null);

  const makeRemote = useCallback(
    (teamId) => {
      teamIdRef.current = teamId;
      // Each repository is bound to the team it was BUILT for.
      //
      // This used to read the shared ref instead, which was fine while a device
      // only ever looked at one team. It is not fine once you can switch: a
      // season write is debounced, so the previous team's repository still had
      // a save in flight when the ref moved — and that save then resolved
      // against the NEW team and wrote one team's roster into another team's
      // row. Caught by browser-team-switch.mjs against a real database.
      //
      // The ref remains as the fallback for the case it was added for: a
      // repository built before the team id is known.
      const boundTeamId = teamId || null;
      return createSupabaseRepository(client, {
        getTeamId: () => boundTeamId || teamIdRef.current,
        getUserId: () => userIdRef.current,
        cache: local,
      });
    },
    [client, local],
  );

  /**
   * Which role do we hold on this team?
   *
   * Read rather than inferred. A manager and a scorer see the same season, and
   * guessing wrong in the generous direction would show someone an invite
   * button the database will refuse.
   */
  const resolveRole = useCallback(
    async (teamId) => {
      if (!teamId) return null;
      const { data, error } = await client
        .from('memberships')
        .select('role')
        .eq('team_id', teamId)
        .maybeSingle();
      if (error || !data) return null;
      return data.role;
    },
    [client],
  );

  /** Which team does this account score for? */
  const resolvePrimaryTeam = useCallback(async () => {
    const profile = await client.from('profiles').select('primary_team_id').maybeSingle();
    if (profile.data && profile.data.primary_team_id) return profile.data.primary_team_id;
    const remembered = readTeamId();
    if (remembered) return remembered;
    return null;
  }, [client]);

  /**
   * We hold a session but cannot reach the account.
   *
   * The repository stays REMOTE on purpose. The local adapter's saveGame is a
   * no-op, so swapping to it would mean a game finalised here never reaches the
   * account at all. The remote adapter already falls back to the local mirror
   * when a load fails and queues every write, which is exactly the behaviour
   * wanted: nothing lost, everything sent when the signal returns.
   */
  const enterStale = useCallback(() => {
    const teamId = teamIdRef.current || readTeamId();
    teamIdRef.current = teamId;
    // There is no session to read an id from, but writes made now still belong
    // to the account whose session is sitting unusable on this device.
    userIdRef.current = userIdRef.current || readUserId();
    setState((s) => ({
      ...s,
      status: 'stale',
      repository: teamId ? makeRemote(teamId) : local,
      teamId,
      error: null,
    }));
  }, [local, makeRemote]);

  // Which account a reconciliation is already running for.
  //
  // On a first launch with a stored session, supabase-js answers twice: the
  // explicit getSession resolves, and INITIAL_SESSION arrives through onChange.
  // Both used to start a full reconciliation, and when the decision was
  // "upload this device's season" that meant import_season_and_claim ran TWICE,
  // milliseconds apart. Confirmed against a real database: two complete sets of
  // opposing teams, after which the read-back check correctly reported that the
  // uploaded season did not match the device, discarded it, and told the person
  // their season could not be uploaded — for a season that was perfectly fine.
  //
  // Collapsing duplicates for the same account is safe: the second call carries
  // the same user, so the work is identical. A different account, or the same
  // one after this settles, still reconciles normally.
  const reconcilingRef = useRef(null);

  /** Work out what to do, and do it when it is unambiguous. */
  const reconcileOnce = useCallback(
    async (session) => {
      if (!session) {
        // Local data is never hidden behind this: App renders the season and
        // offers sign-in rather than demanding it.
        userIdRef.current = null;
        setState((s) => ({ ...s, status: 'signed-out', session: null, repository: local }));
        return;
      }

      userIdRef.current = (session.user && session.user.id) || null;
      writeUserId(userIdRef.current);

      setState((s) => ({ ...s, status: 'preparing', session, error: null }));

      try {
        const teamId = await resolvePrimaryTeam();
        const localSeason = local.loadSync();
        const remoteRepo = teamId ? makeRemote(teamId) : null;
        const remoteSeason = remoteRepo ? await remoteRepo.load() : null;

        const decision = decideSync({ local: localSeason, remote: remoteSeason, signedIn: true });

        if (decision.action === 'adopt-backend') {
          if (teamId) writeTeamId(teamId);
          const role = await resolveRole(teamId);
          setState((s) => ({
            ...s,
            status: 'ready',
            session,
            teamId,
            role,
            repository: teamId ? remoteRepo : local,
            error: null,
          }));
          return;
        }

        if (decision.action === 'migrate-up') {
          await migrate(session, localSeason);
          return;
        }

        // Genuinely ambiguous: both sides have a season and they differ.
        setState((s) => ({
          ...s,
          status: 'ask',
          session,
          teamId,
          repository: local, // stay local until the user chooses
          choice: { local: summarize(localSeason), remote: summarize(remoteSeason) },
        }));
      } catch (err) {
        // Anything unexpected leaves the device on its own data rather than
        // showing an account season we could not verify.
        setState((s) => ({
          ...s,
          status: 'ready',
          session,
          repository: local,
          error: err && err.message ? err.message : String(err),
        }));
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [local, makeRemote, resolvePrimaryTeam, resolveRole],
  );

  /** One reconciliation per account at a time. See reconcilingRef above. */
  const reconcile = useCallback(
    async (session) => {
      const who = session ? (session.user && session.user.id) || 'unknown' : 'signed-out';
      if (reconcilingRef.current === who) return;
      reconcilingRef.current = who;
      try {
        await reconcileOnce(session);
      } finally {
        reconcilingRef.current = null;
      }
    },
    [reconcileOnce],
  );

  /** Send this device's season up, and only trust it once it reads back right. */
  const migrate = useCallback(
    async (session, localSeason) => {
      setState((s) => ({ ...s, status: 'preparing', session, error: null }));

      const imported = await client.rpc('import_season_and_claim', {
        payload: buildExport(localSeason),
      });
      if (imported.error) {
        setState((s) => ({
          ...s,
          status: 'ready',
          repository: local,
          error: `Could not upload this season: ${imported.error.message}. Nothing was changed on this device.`,
        }));
        return;
      }

      const teamId = imported.data;
      const remoteRepo = makeRemote(teamId);
      const readBack = await remoteRepo.load();
      const verdict = verifyMigration(localSeason, readBack);

      if (!verdict.ok) {
        // Do not keep a half-trusted copy in the account.
        await client.rpc('discard_import', { team_id: teamId }).catch(() => {});
        teamIdRef.current = null;
        setState((s) => ({
          ...s,
          status: 'ready',
          repository: local,
          error: `The uploaded season did not match this device (${verdict.differences.join('; ')}). It was removed and this device is still in charge.`,
        }));
        return;
      }

      writeTeamId(teamId);
      const role = await resolveRole(teamId);
      setState((s) => ({ ...s, status: 'ready', teamId, role, repository: remoteRepo, error: null }));
    },
    [client, local, makeRemote, resolveRole],
  );

  // Follow the session for the life of the app.
  useEffect(() => {
    if (!isSupabaseConfigured) return undefined;
    let cancelled = false;

    // Show the season rather than a splash if the auth server is slow to
    // answer. A late answer still upgrades this: a session resolves into a
    // normal sign-in, and a genuine rejection into signed-out.
    let settled = false;
    const patience = setTimeout(() => {
      if (!cancelled && !settled && auth.hasStoredSession()) enterStale();
    }, AUTH_PATIENCE_MS);

    auth.getSessionDetailed().then(({ session, reason }) => {
      settled = true;
      clearTimeout(patience);
      if (cancelled) return;
      if (session) {
        reconcile(session);
      } else if (reason === 'offline') {
        // A session is on this device; the server just is not answering.
        enterStale();
      } else {
        reconcile(null);
      }
    });

    const stop = auth.onChange((session, event) => {
      if (cancelled) return;
      if (session) {
        // A refreshed token for the person already signed in is not news. It
        // used to re-run the whole reconciliation, which drops the app back to
        // a splash and unmounts whatever was open — every hour, mid-game if the
        // timing landed there. Keep the fresher session and carry on.
        const sameUser = !!userIdRef.current && session.user && session.user.id === userIdRef.current;
        if (sameUser && stateRef.current.status === 'ready') {
          setState((s) => ({ ...s, session }));
          return;
        }
        // Anything else — first sign-in, a different account, or coming back
        // from stale — genuinely needs working out again.
        reconcile(session);
        return;
      }
      // No session in the event. A deliberate sign-out is exactly that; a
      // failed refresh while we still hold a stored session is not.
      if (event === 'SIGNED_OUT' && !auth.hasStoredSession()) {
        reconcile(null);
      } else if (auth.hasStoredSession()) {
        enterStale();
      } else {
        reconcile(null);
      }
    });

    return () => {
      cancelled = true;
      clearTimeout(patience);
      stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth, enterStale]);

  const actions = {
    auth,

    /** Keep the account's season. Local is untouched and stays exportable. */
    useBackendSeason: () => {
      const teamId = teamIdRef.current || readTeamId();
      writeTeamId(teamId);
      setState((s) => ({
        ...s,
        status: 'ready',
        repository: teamId ? makeRemote(teamId) : local,
        choice: null,
      }));
    },

    /** Send this device's season up as an additional team, keeping both. */
    importLocalAsSecondTeam: async () => {
      setState((s) => ({ ...s, status: 'preparing' }));
      const localSeason = local.loadSync();
      const imported = await client.rpc('import_season', { payload: buildExport(localSeason) });
      if (imported.error) {
        setState((s) => ({
          ...s,
          status: 'ask',
          error: `Could not upload: ${imported.error.message}. Nothing on this device changed.`,
        }));
        return;
      }
      writeTeamId(imported.data);
      setState((s) => ({
        ...s,
        status: 'ready',
        teamId: imported.data,
        repository: makeRemote(imported.data),
        choice: null,
        error: null,
      }));
    },

    cancelChoice: () => setState((s) => ({ ...s, status: 'ready', repository: local, choice: null })),

    invites: invitesRef.current,

    /**
     * Redeem an invite.
     *
     * The membership is the easy half. The judgement is what to do with the
     * season already on this device, and the rule is the one that governs
     * everything else here: it is never touched without being asked.
     *
     *   nothing local yet  -> adopt the team that was joined. There is nothing
     *                         to lose, and landing somewhere is the whole point
     *                         of accepting an invite.
     *   a season is here   -> the membership is granted and NOTHING ELSE
     *                         HAPPENS. The device keeps showing what it was
     *                         showing. Switching between two seasons is phase
     *                         4; doing it implicitly here would let an invite
     *                         code replace what is on someone's screen.
     */
    acceptInvite: async (code) => {
      const invites = invitesRef.current;
      const { membership, error } = await invites.accept(code);
      if (error) return { error };

      const teamId = membership && membership.team_id;
      const role = membership && membership.role;

      // What the code said it was for, for the confirmation wording.
      const { invite } = await invites.peek(code);
      const teamName = (invite && invite.team_name) || null;

      const localSeason = local.loadSync();
      const nothingToLose = isEmptySeason(localSeason);

      if (!nothingToLose || !teamId) {
        // Deliberately inert. Not even the primary team is repointed: that is
        // what decides which season loads on the next launch.
        return { role, teamName, switched: false };
      }

      const claimed = await client.rpc('set_primary_team', { team_id: teamId });
      if (claimed.error) {
        // The membership stands; only the landing failed. Say so rather than
        // pretending, and leave the device where it was.
        return { role, teamName, switched: false, error: null };
      }

      writeTeamId(teamId);
      const remoteRepo = makeRemote(teamId);
      setState((s) => ({ ...s, status: 'ready', teamId, role, repository: remoteRepo, error: null }));
      return { role, teamName, switched: true };
    },

    /**
     * Every team this account holds a role on, with that role.
     *
     * Read from memberships rather than from teams: a public league makes every
     * team in it readable, and "teams I can see" is not the question. Only the
     * ones you are actually on can be switched to.
     */
    myTeams: async () => {
      const { data, error } = await client
        .from('memberships')
        .select('role, team_id, teams(id, name)')
        .not('team_id', 'is', null);
      if (error) return { teams: [], error };
      const teams = (data || [])
        .filter((m) => m.teams)
        .map((m) => ({ id: m.teams.id, name: m.teams.name, role: m.role }))
        .sort((a, b) => a.name.localeCompare(b.name));
      return { teams, error: null };
    },

    /**
     * Look at a different team.
     *
     * The primary team is written to the profile, not merely to this device:
     * it is what decides which season loads on the next launch, on any phone.
     *
     * Nothing local is deleted. The mirror is stamped with the team it belongs
     * to, so the new team simply has no mirror yet and the app waits for the
     * account rather than painting the previous team's roster under the new
     * team's name — which is how one team's season would have been written into
     * another team's row.
     */
    switchTeam: async (teamId) => {
      if (!teamId || teamId === teamIdRef.current) return { error: null };
      const claimed = await client.rpc('set_primary_team', { team_id: teamId });
      if (claimed.error) return { error: claimed.error };

      writeTeamId(teamId);
      const remoteRepo = makeRemote(teamId);
      const role = await resolveRole(teamId);
      setState((s) => ({ ...s, status: 'ready', teamId, role, repository: remoteRepo, error: null }));
      return { error: null };
    },

    /** What is still waiting to reach the account, so sign-out can warn. */
    unsentWrites: () => {
      const repo = stateRef.current.repository;
      return repo && repo.unsent ? repo.unsent() : { pending: 0, parked: 0 };
    },

    /** One more attempt to drain the queue, offered before signing out. */
    syncNow: async () => {
      const repo = stateRef.current.repository;
      if (repo && repo.flushNow) await repo.flushNow();
      return stateRef.current.repository && stateRef.current.repository.unsent
        ? stateRef.current.repository.unsent()
        : { pending: 0, parked: 0 };
    },

    dismissError: () => setState((s) => ({ ...s, error: null })),

    /**
     * Sign out without losing anything.
     *
     * The season stays in localStorage, and so does the write queue: unsent
     * writes are stamped with the account they belong to and wait for it. The
     * caller is expected to have warned about them first — this does not
     * refuse, because refusing would trap someone with no signal into staying
     * signed in.
     *
     * The synced-games marker IS cleared, because it is a claim about "the
     * account" and we no longer know which one that is.
     */
    signOut: async () => {
      await auth.signOut();
      teamIdRef.current = null;
      userIdRef.current = null;
      writeUserId(null);
      forgetSyncedGames();
      setState((s) => ({ ...s, status: 'signed-out', session: null, teamId: null, repository: local }));
    },
  };

  return {
    ...state,
    actions,
    localRepository: local,
    // Whether this device already has something to lose, which is what decides
    // if accepting an invite may land you anywhere.
    hasLocalSeason: !isEmptySeason(local.loadSync()),
  };
}
