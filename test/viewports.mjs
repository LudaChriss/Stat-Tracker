// Responsive audit. Needs a dev server on :5173 and Chrome started with
// --remote-debugging-port=9222; run manually, not part of `npm test`.
import { writeFileSync } from 'node:fs';
const OUT = process.env.SHOT_DIR || '/tmp';
const SRC=new URL('../src', import.meta.url).pathname;
// Shared with the browser harnesses that measure states this file cannot reach.
const { VIEWPORTS, MEASURE, CLIPPED } = await import('./viewport-measure.mjs');

// Build a fully-populated season in Node, then inject it.
const { INITIAL_STATE } = await import(`${SRC}/data/league.js`);
const { SEEDED } = await import('./fixtures-history.js');
const { applyOutcome, buildGameRecord } = await import(`${SRC}/game/logic.js`);
const { TEMPLATES } = await import(`${SRC}/data/league.js`);
const kb = k => TEMPLATES.kickball.groups.flatMap(g=>g.outcomes).find(x=>x.k===k);

let seeded = SEEDED(INITIAL_STATE);
// a game in progress, with runners and stats, for the live screens
let live = { ...seeded, gameActive: true, half: 'bot', trackMode: 'both' };
['1B','2B','HR','BB','K','1B','F8','3B'].forEach(k => { live = applyOutcome(live, kb(k)); });
const finished = buildGameRecord({ ...live, score: { home: 6, away: 4 } }, { date: new Date('2026-09-09') });
const withGame = { ...seeded, history: [...seeded.history, finished] };

const SCREENS = [
  ['league',     { ...withGame, screen: 'league' }],
  ['team',       { ...withGame, screen: 'team' }],
  ['newgame',    { ...withGame, screen: 'newgame' }],
  ['live-entry', { ...live, screen: 'live', liveTab: 'entry' }],
  ['live-book',  { ...live, screen: 'live', liveTab: 'book' }],
  ['live-lineup',{ ...live, screen: 'live', liveTab: 'lineup' }],
  ['live-stats', { ...live, screen: 'live', liveTab: 'stats' }],
  ['player',     { ...withGame, screen: 'player', playerId: 0 }],
  ['gameDetail', { ...withGame, screen: 'gameDetail', viewGameId: finished.id, gameFrom: 'team' }],
  ['roster',     { ...withGame, screen: 'roster' }],
  ['teams',      { ...withGame, screen: 'teams' }],
  ['teamDetail', { ...withGame, screen: 'teamDetail', editTeamId: 'rubber-chickens' }],
  // Signed out, so the league screen measures its "leagues need an account"
  // state without waiting on a network round trip. The signed-in states of
  // this screen are measured by hand in browser-leagues.mjs.
  ['leagues',    { ...withGame, screen: 'leagues' }],
];

const t=(await (await fetch('http://localhost:9222/json')).json()).find(x=>x.type==='page');
const ws=new WebSocket(t.webSocketDebuggerUrl); await new Promise(r=>ws.addEventListener('open',r));
let id=0; const pend=new Map();
ws.addEventListener('message',e=>{const m=JSON.parse(e.data); if(m.id&&pend.has(m.id)){pend.get(m.id)(m);pend.delete(m.id);}});
const send=(m,p={})=>new Promise((res,rej)=>{const i=++id;pend.set(i,x=>x.error?rej(new Error(m+JSON.stringify(x.error))):res(x.result));ws.send(JSON.stringify({id:i,method:m,params:p}));});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const js=async e=>{const r=await send('Runtime.evaluate',{expression:e,returnByValue:true}); if(r.exceptionDetails) return {ERR:(r.exceptionDetails.exception?.description||'').split('\n')[0]}; return r.result.value;};

await send('Page.enable'); await send('Runtime.enable');
await send('Page.navigate',{url:'http://localhost:5173'}); await sleep(2000);

const rows = [];
for (const [vpName, w, h, dsf] of VIEWPORTS) {
  await send('Emulation.setDeviceMetricsOverride',{width:w,height:h,deviceScaleFactor:dsf,mobile:false});
  // Scan screens can't be restored from storage by design — navigate to them.
  {
    await js(`localStorage.setItem('score-tracker:state', ${JSON.stringify(JSON.stringify({version:3, state:{...withGame, screen:'team'}}))})`);
    await send('Page.reload'); await sleep(800);
    const clickTxt = (t) => js(`(()=>{const n=e=>(e.textContent||'').replace(/\\s+/g,' ').trim();
      const el=[...document.querySelectorAll('button,div,span')].reverse().find(e=>n(e)===${'`'}${'$'}{JSON.stringify(t)}${'`'});
      if(!el) return 'MISS'; el.click(); return 'OK';})()`);
    await clickTxt('⌗ Scan scorecard'); await sleep(500);
    rows.push({ vp: vpName, screen: 'scanCam', ...(await js(MEASURE)), clipped: await js(CLIPPED) });
    await js(`document.querySelector('button[aria-label="Capture"]').click()`); await sleep(600);
    rows.push({ vp: vpName, screen: 'scanReview', ...(await js(MEASURE)), clipped: await js(CLIPPED) });
  }

  for (const [name, state] of SCREENS) {
    await js(`localStorage.setItem('score-tracker:state', ${JSON.stringify(JSON.stringify({version:3, state}))})`);
    await send('Page.reload'); await sleep(750);
    const m = await js(MEASURE);
    rows.push({ vp: vpName, screen: name, ...m, clipped: await js(CLIPPED) });
    if (process.env.SHOT && vpName === process.env.SHOT) {
      const {data} = await send('Page.captureScreenshot',{format:'png'});
      writeFileSync(`${OUT}/vp-${name}.png`, Buffer.from(data,'base64'));
    }
  }
}

const bad = rows.filter(r => r.ERR || r.overflow > 0 || (r.wide||[]).length || (r.clipped||[]).length || (r.clipped && r.clipped.ERR));
console.log('OVERFLOW / CLIPPING');
if (!bad.length) console.log('  none across', rows.length, 'screen×viewport combinations');
for (const r of bad) console.log(`  ${r.vp.padEnd(18)} ${r.screen.padEnd(12)} overflow=${r.overflow}px ${r.ERR||''} ${(r.wide||[]).join(' ; ')} ${Array.isArray(r.clipped) && r.clipped.length ? 'clipped: ' + r.clipped.join(' ; ') : ''}`);

console.log('\nTAP TARGETS UNDER 44px (count per screen, worst viewport)');
const byScreen = {};
for (const r of rows) byScreen[r.screen] = Math.max(byScreen[r.screen]||0, r.smallCount||0);
Object.entries(byScreen).filter(([,c])=>c>0).forEach(([s,c])=>console.log(`  ${s.padEnd(12)} ${c}`));
console.log('\nEVERY CONTROL UNDER 44px (iPhone SE)');
const se = rows.filter(r => r.vp === 'iPhone SE');
for (const r of se) if ((r.small||[]).length) console.log('  ' + r.screen.padEnd(12) + (r.small||[]).join('  |  '));
ws.close();
