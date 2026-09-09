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

/**
 * True when launched from the home screen. Installed, the phone *is* the
 * frame, so the simulated bezel is dropped and the app runs full-bleed.
 */
function useStandalone() {
  const [standalone, setStandalone] = useState(() => {
    if (typeof window === 'undefined') return false;
    return (
      window.matchMedia('(display-mode: standalone)').matches ||
      window.navigator.standalone === true
    );
  });

  useEffect(() => {
    const mq = window.matchMedia('(display-mode: standalone)');
    const onChange = (e) => setStandalone(e.matches || window.navigator.standalone === true);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  return standalone;
}

export default function App() {
  const { state, actions } = useGame();
  const v = useMemo(() => deriveView(state, actions), [state, actions]);

  const Screen = SCREENS[state.screen];
  const standalone = useStandalone();

  const app = (
    <div
      style={{
        position: 'relative',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        background: C.bg,
        fontFamily: FONT,
        color: C.ink,
        overflow: 'hidden',
        // Installed, content runs under the home indicator without this.
        paddingBottom: standalone ? 'env(safe-area-inset-bottom)' : 0,
      }}
    >
      <Screen v={v} actions={actions} />
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

  if (standalone) return <div className="stage">{app}</div>;

  return (
    <div className="stage">
      <IOSDevice dark={DARK_SCREENS.includes(state.screen)}>{app}</IOSDevice>
    </div>
  );
}
