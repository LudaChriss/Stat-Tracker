import { useMemo } from 'react';
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
import TabBar from './components/TabBar.jsx';
import Toast from './components/Toast.jsx';

const SCREENS = {
  league: LeagueHome,
  team: TeamPage,
  newgame: NewGame,
  live: LiveGame,
  scanCam: ScanCamera,
  scanReview: ScanReview,
  player: PlayerProfile,
};

// Screens that paint their own dark chrome need the status bar in white.
const DARK_SCREENS = ['live', 'scanCam'];

export default function App() {
  const { state, actions } = useGame();
  const v = useMemo(() => deriveView(state, actions), [state, actions]);

  const Screen = SCREENS[state.screen];

  return (
    <div className="stage">
      <IOSDevice dark={DARK_SCREENS.includes(state.screen)}>
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
          }}
        >
          <Screen v={v} actions={actions} />
          {v.toastMsg && <Toast message={v.toastMsg} />}
          {v.showTabs && <TabBar v={v} />}
        </div>
      </IOSDevice>
    </div>
  );
}
