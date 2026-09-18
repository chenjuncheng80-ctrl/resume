/* About pin check — CDP harness.
   Verifies the section locks, the wheel drives two stages, the card arrives
   inside the viewport, and scrolling back up reverses the whole thing.
   Usage: node tools/cdp_pin.mjs */
const PORT = 9333;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const http = async (p, m = 'GET') => (await fetch(`http://127.0.0.1:${PORT}${p}`, { method: m })).json().catch(() => ({}));

function connect(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    let id = 0; const pending = new Map();
    ws.addEventListener('open', () => resolve({
      send(method, params = {}) {
        const mid = ++id;
        ws.send(JSON.stringify({ id: mid, method, params }));
        return new Promise((r, j) => pending.set(mid, { r, j }));
      },
      close: () => ws.close()
    }));
    ws.addEventListener('message', (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && pending.has(m.id)) {
        const p = pending.get(m.id); pending.delete(m.id);
        m.error ? p.j(new Error(JSON.stringify(m.error))) : p.r(m.result);
      }
    });
    ws.addEventListener('error', reject);
  });
}

const target = await http(`/json/new?${encodeURIComponent('file:///C:/Users/chenj/Desktop/portfolio/index.html')}`, 'PUT');
const page = await connect(target.webSocketDebuggerUrl);
await page.send('Runtime.enable');

const errs = [];
const log = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => log.addEventListener('open', r));
log.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data);
  if (m.method === 'Runtime.exceptionThrown') errs.push('EXC ' + (m.params.exceptionDetails.exception || {}).description);
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errs.push('CONSOLE ' + JSON.stringify(m.params.args.map((a) => a.value)));
});
await sleep(2500);

const evalx = async (e) => {
  const r = await page.send('Runtime.evaluate', { expression: e, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' :: ' + e);
  return r.result.value;
};

const geom = JSON.parse(await evalx(`JSON.stringify((function(){
  var pin = document.getElementById('aboutPin');
  var stage = pin.querySelector('.pin__stage');
  var fit = pin.querySelector('.pin__fit');
  return { ready: document.documentElement.classList.contains('pin-ready'),
           innerH: window.innerHeight,
           pinH: pin.offsetHeight,
           pinTop: pin.getBoundingClientRect().top + (window.scrollY||0),
           runway: pin.offsetHeight - window.innerHeight,
           fitVar: +getComputedStyle(stage).getPropertyValue('--fit'),
           fitNatural: fit.offsetHeight,
           fitScaled: Math.round(fit.getBoundingClientRect().height),
           stagePos: getComputedStyle(stage).position,
           cardShown: getComputedStyle(pin.querySelector('.pin__layer--card')).display };
})())`));
console.log('geometry', JSON.stringify(geom));

// Walk the wheel through the runway and read the scene at each stop.
const read = () => evalx(`JSON.stringify((function(){
  var pin = document.getElementById('aboutPin');
  var stage = pin.querySelector('.pin__stage');
  var cs = getComputedStyle(stage);
  var card = pin.querySelector('.namecard').getBoundingClientRect();
  var aboutLayer = pin.querySelector('.pin__layer--about');
  return { p: +(window.__aboutPin.progress).toFixed(3),
           out: +cs.getPropertyValue('--about-out'),
           inn: +cs.getPropertyValue('--card-in'),
           aboutOpacity: +getComputedStyle(aboutLayer).opacity,
           cardOpacity: +getComputedStyle(pin.querySelector('.pin__layer--card')).opacity,
           cardLive: pin.querySelector('.pin__layer--card').classList.contains('is-live'),
           cardTop: Math.round(card.top), cardBottom: Math.round(card.bottom),
           innerH: window.innerHeight };
})())`);

/* html has scroll-behavior: smooth, so a scrollTo is an animation, not a
   jump. Wait for it to actually land — reading 320ms after the call reads a
   frame from halfway through the easing, which on the long trip back to the
   top is still a fifth of the runway along. */
async function goto(p) {
  const want = geom.pinTop + geom.runway * p;
  await evalx(`window.scrollTo(0, ${want.toFixed(1)}); 'ok'`);
  for (let i = 0; i < 25; i++) {
    const y = JSON.parse(await evalx('Math.round(window.scrollY)'));
    if (Math.abs(y - want) < 12) break;
    await sleep(120);
  }
  await sleep(220);
  return JSON.parse(await read());
}

const stops = {};
for (const p of [0, 0.2, 0.45, 0.7, 1]) {
  stops[p] = await goto(p);
  console.log('p=' + p, JSON.stringify(stops[p]));
}

// and back up again
const back = await goto(0);
console.log('back to top', JSON.stringify(back));

const pass =
  geom.ready && geom.stagePos === 'sticky' && geom.cardShown === 'grid' &&
  geom.pinH > geom.innerH * 2 &&
  geom.fitVar <= 1 && geom.fitScaled <= geom.innerH &&
  // nothing moves during the dead zone
  stops[0].out === 0 && stops[0].inn === 0 &&
  // the text leaves, the card arrives, monotonically
  stops[0.2].out > 0 && stops[0.45].out > stops[0.2].out &&
  stops[0.45].inn > stops[0.2].inn && stops[0.7].inn > stops[0.45].inn &&
  stops[1].inn > 0.99 &&
  // at the end: text gone, card fully in, sitting inside the viewport
  stops[1].aboutOpacity < 0.02 && stops[1].cardOpacity > 0.99 &&
  stops[1].cardLive === true &&
  stops[1].cardTop > 0 && stops[1].cardBottom < stops[1].innerH &&
  // reversible
  back.out === 0 && back.inn === 0 &&
  errs.length === 0;

console.log('errors:', errs.length ? errs : 'none');
console.log(pass ? 'RESULT: PASS' : 'RESULT: FAIL');

await http(`/json/close/${target.id}`, 'PUT').catch(() => {});
page.close();
process.exit(pass ? 0 : 1);
