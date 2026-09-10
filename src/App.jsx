import { useEffect, useMemo, useState } from 'react';
import IOSDevice from './ios/IOSDevice.jsx';
import { useGame } from './game/useGame.js';
import { deriveView } from './game/derive.js';
import { C, FONT } from './theme.js';

import LeagueHome from './screens/LeagueHome.jsx';
import TeamPage from './screens/TeamPage.jsx';
import NewGame from './screens/NewGame.jsx';
import LiveGame from './screens/LiveGame.jsx';
import ScanCamera from './screens/ScanCamera.jsx';
import ScanReview from './screens/ScanReview.jsx';
import PlayerProfile from './screens/PlayerProfile.jsx';
import RosterEditor from './screens/RosterEditor.jsx';
import TeamsEditor from './screens/TeamsEditor.jsx';
import TeamDetail from './screens/TeamDetail.jsx';
import GameDetail from './screens/GameDetail.jsx';
import TabBar from './components/TabBar.jsx';
import Toast from './components/Toast.jsx';
import { NameSheet } from './components/ResetSheets.jsx';
import SignIn from './screens/SignIn.jsx';
import SyncPrompt from './components/SyncPrompt.jsx';
import { useBackend } from './data/useBackend.js';
import AccountBar from './components/AccountBar.jsx';
import SignOutSheet from './components/SignOutSheet.jsx';
import { useSignInForm } from './data/useSignInForm.js';

const SCREENS = {
  league: LeagueHome,
  team: TeamPage,
  newgame: NewGame,
  live: LiveGame,
  scanCam: ScanCamera,
  scanReview: ScanReview,
  player: PlayerProfile,
  roster: RosterEditor,
  teams: TeamsEditor,
  teamDetail: TeamDetail,
  gameDetail: GameDetail,
};

// Screens that paint their own dark chrome need the status bar in white.
const DARK_SCREENS = ['live', 'scanCam'];

function useMediaQuery(query) {
  const [matches, setMatches] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(query).matches,
  );

  useEffect(() => {
    const mq = window.matchMedia(query);
    const onChange = (e) => setMatches(e.matches);
    setMatches(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [query]);

  return matches;
}

/**
 * Drop the simulated bezel whenever the real screen is the frame: installed to
 * a home screen, or any viewport too narrow to show a 402px phone inside it.
 * Anything wider keeps the bezel as a desktop preview.
 */
function useFullBleed() {
  const installed = useMediaQuery('(display-mode: standalone)');
  const narrow = useMediaQuery('(max-width: 560px)');
  const iosStandalone = typeof window !== 'undefined' && window.navigator.standalone === true;
  return installed || iosStandalone || narrow;
}

function GameApp({ repository, backend, onSignIn, onSignOut }) {
  const { state, actions } = useGame(repository);
  const v = useMemo(() => deriveView(state, actions), [state, actions]);

  const Screen = SCREENS[state.screen];
  const fullBleed = useFullBleed();

  const app = (
    <div
      className="app-shell"
      style={{
        position: 'relative',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        background: C.bg,
        fontFamily: FONT,
        color: C.ink,
        overflow: 'hidden',
        // Keeps content clear of the home indicator when installed.
        paddingBottom: 'var(--safe-bottom)',
      }}
    >
      <AccountBar status={backend.status} onSignIn={onSignIn} />
      <Screen
        v={{ ...v, account: { status: backend.status, email: (backend.session && backend.session.user && backend.session.user.email) || null } }}
        actions={{ ...actions, openSignOut: onSignOut, openSignIn: onSignIn }}
      />
      {v.needsSetup && (
        <NameSheet
          title="Welcome — what's your team called?"
          subtitle="Then add your players and the teams you play against."
          cta="Get started"
          onSubmit={actions.startFreshSeason}
        />
      )}
      {v.toastMsg && <Toast message={v.toastMsg} />}
      {v.showTabs && <TabBar v={v} />}
    </div>
  );

  if (fullBleed) return <div className="stage is-fullbleed">{app}</div>;

  return (
    <div className="stage">
      <IOSDevice dark={DARK_SCREENS.includes(state.screen)}>{app}</IOSDevice>
    </div>
  );
}


/**
 * Chooses what the app is looking at before the game shell ever renders.
 *
 * Order matters: no backend at all is a valid, fully working mode; signed out
 * blocks on sign-in; a disagreement between this device and the account is the
 * only case that asks the user anything.
 *
 * The game shell is keyed on the repository so that swapping adapters — local
 * to backend, on sign-in — remounts it and re-hydrates cleanly rather than
 * leaving stale state behind.
 */
export default function App() {
  const backend = useBackend();
  const signIn = useSignInForm(backend.actions.auth);
  // Sign-in is a screen the app can show, not a gate it sits behind. Being
  // signed out is a fact about syncing; the season is on the phone either way.
  const [showSignIn, setShowSignIn] = useState(false);
  const [signOutSheet, setSignOutSheet] = useState(null);
  const [signingOut, setSigningOut] = useState(false);

  if (backend.status === 'loading' || backend.status === 'preparing') {
    return <Splash label={backend.status === 'preparing' ? 'Checking your season…' : 'Loading…'} />;
  }

  if (showSignIn && backend.status === 'signed-out') {
    return <SignIn {...signIn} onDismiss={() => setShowSignIn(false)} />;
  }

  const repoKey = backend.teamId || 'local';

  return (
    <>
      <GameApp
        key={repoKey}
        repository={backend.repository}
        backend={backend}
        onSignIn={() => setShowSignIn(true)}
        onSignOut={() => setSignOutSheet(backend.actions.unsentWrites())}
      />
      {signOutSheet && (
        <SignOutSheet
          email={(backend.session && backend.session.user && backend.session.user.email) || null}
          unsent={signOutSheet}
          busy={signingOut}
          onSyncNow={async () => {
            setSigningOut(true);
            const left = await backend.actions.syncNow();
            setSignOutSheet(left);
            setSigningOut(false);
          }}
          onSignOut={async () => {
            setSigningOut(true);
            await backend.actions.signOut();
            setSigningOut(false);
            setSignOutSheet(null);
          }}
          onClose={() => setSignOutSheet(null)}
        />
      )}
      {backend.status === 'ask' && backend.choice && (
        <SyncPrompt
          local={backend.choice.local}
          remote={backend.choice.remote}
          busy={false}
          onUseBackend={backend.actions.useBackendSeason}
          onImportLocalAsSecondTeam={backend.actions.importLocalAsSecondTeam}
          onCancel={backend.actions.cancelChoice}
        />
      )}
      {backend.error && <BackendNotice message={backend.error} onDismiss={backend.actions.dismissError} />}
    </>
  );
}

function Splash({ label }) {
  return (
    <div className="stage is-fullbleed">
      <div
        style={{
          height: '100%',
          display: 'grid',
          placeItems: 'center',
          background: C.bg,
          fontFamily: FONT,
          color: C.muted,
          fontSize: 14,
          fontWeight: 700,
        }}
      >
        {label}
      </div>
    </div>
  );
}

/** Backend trouble is reported, never swallowed — the app keeps working locally. */
function BackendNotice({ message, onDismiss }) {
  return (
    <div
      onClick={onDismiss}
      style={{
        position: 'fixed',
        left: 12,
        right: 12,
        bottom: 'calc(12px + env(safe-area-inset-bottom, 0px))',
        zIndex: 100,
        background: '#FFF8E8',
        border: '1.5px solid #F0B429',
        borderRadius: 13,
        padding: '12px 14px',
        fontFamily: FONT,
        fontSize: 12.5,
        fontWeight: 700,
        color: '#6B4E00',
        boxShadow: '0 10px 26px rgba(8,30,48,.25)',
      }}
    >
      {message}
      <div style={{ fontWeight: 600, marginTop: 4, opacity: 0.8 }}>Tap to dismiss</div>
    </div>
  );
}
