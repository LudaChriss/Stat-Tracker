// Close every private browser context left open in the Chrome on :9222.
//
// A harness that stopped before it could tidy up leaves its phones behind, and
// enough of them start killing CDP sessions in later runs for reasons that have
// nothing to do with the app. The default context — the browser's own window —
// is never touched.
//
//   node test/dispose-contexts.mjs

const version = await (await fetch('http://localhost:9222/json/version')).json();
const ws = new WebSocket(version.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r));

let id = 0;
const pending = new Map();
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) {
    pending.get(m.id)(m);
    pending.delete(m.id);
  }
});
const send = (method, params = {}) =>
  new Promise((res) => {
    const i = ++id;
    pending.set(i, res);
    ws.send(JSON.stringify({ id: i, method, params }));
  });

const { result } = await send('Target.getBrowserContexts');
const ids = (result && result.browserContextIds) || [];
for (const browserContextId of ids) await send('Target.disposeBrowserContext', { browserContextId });
console.log(`disposed ${ids.length} private browser context${ids.length === 1 ? '' : 's'}`);
ws.close();
