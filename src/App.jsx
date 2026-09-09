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

export default function App() {
  const { state, actions } = useGame();
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

  if (fullBleed) return <div className="stage is-fullbleed">{app}</div>;

  return (
    <div className="stage">
      <IOSDevice dark={DARK_SCREENS.includes(state.screen)}>{app}</IOSDevice>
    </div>
  );
}
