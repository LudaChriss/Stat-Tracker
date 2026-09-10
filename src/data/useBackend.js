// Deciding, on launch, which season the app is looking at.
//
// The sequence is: is there a backend at all -> is anyone signed in -> which
// team is theirs -> does this device agree with the account. Only the last step
// can ever need the user, and only when the two genuinely disagree.
//
// The invariant running through all of it: local data is never deleted and
// never modified by any of these paths. Adopting the account's season demotes
// the local copy to a cache; it stays on the device and stays exportable.

import { useCallback, useEffect, useRef, useState } from 'react';
import { getSupabase, isSupabaseConfigured } from './supabaseClient.js';
import { createAuth } from './auth.js';
import { createLocalRepository } from './localRepository.js';
import { createSupabaseRepository } from './supabaseRepository.js';
import { decideSync, summarize, verifyMigration } from './seasonSync.js';
import { buildExport } from '../game/export.js';

const TEAM_KEY = 'score-tracker:teamId';

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

export function useBackend() {
  const client = getSupabase();
  const authRef = useRef(null);
  if (!authRef.current) authRef.current = createAuth(client);
  const auth = authRef.current;

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
  }));

  const teamIdRef = useRef(null);

  const makeRemote = useCallback(
    (teamId) => {
      teamIdRef.current = teamId;
      return createSupabaseRepository(client, { getTeamId: () => teamIdRef.current, cache: local });
    },
    [client, local],
  );

  /** Which team does this account score for? */
  const resolvePrimaryTeam = useCallback(async () => {
    const profile = await client.from('profiles').select('primary_team_id').maybeSingle();
    if (profile.data && profile.data.primary_team_id) return profile.data.primary_team_id;
    const remembered = readTeamId();
    if (remembered) return remembered;
    return null;
  }, [client]);

  /** Work out what to do, and do it when it is unambiguous. */
  const reconcile = useCallback(
    async (session) => {
      if (!session) {
        setState((s) => ({ ...s, status: 'signed-out', session: null, repository: local }));
        return;
      }

      setState((s) => ({ ...s, status: 'preparing', session, error: null }));

      try {
        const teamId = await resolvePrimaryTeam();
        const localSeason = local.loadSync();
        const remoteRepo = teamId ? makeRemote(teamId) : null;
        const remoteSeason = remoteRepo ? await remoteRepo.load() : null;

        const decision = decideSync({ local: localSeason, remote: remoteSeason, signedIn: true });

        if (decision.action === 'adopt-backend') {
          if (teamId) writeTeamId(teamId);
          setState((s) => ({
            ...s,
            status: 'ready',
            session,
            teamId,
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
    [local, makeRemote, resolvePrimaryTeam],
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
      setState((s) => ({ ...s, status: 'ready', teamId, repository: remoteRepo, error: null }));
    },
    [client, local, makeRemote],
  );

  // Follow the session for the life of the app.
  useEffect(() => {
    if (!isSupabaseConfigured) return undefined;
    let cancelled = false;

    auth.getSession().then((session) => {
      if (!cancelled) reconcile(session);
    });
    const stop = auth.onChange((session) => {
      if (!cancelled) reconcile(session);
    });

    return () => {
      cancelled = true;
      stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth]);

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

    dismissError: () => setState((s) => ({ ...s, error: null })),

    signOut: async () => {
      await auth.signOut();
      teamIdRef.current = null;
      setState((s) => ({ ...s, status: 'signed-out', session: null, repository: local }));
    },
  };

  return { ...state, actions, localRepository: local };
}
