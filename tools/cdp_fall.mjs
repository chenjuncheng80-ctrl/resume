/* Skill-fall check — CDP harness (see cdp_cursor.mjs for the pattern).
   Verifies: the word pool comes from the hero field, tokens actually fall,
   they stop on the About section, and weight changes the fall speed.
   Usage: node tools/cdp_fall.mjs */
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

const boot = JSON.parse(await evalx(`JSON.stringify({
  exists: !!window.__skillFall,
  words: window.__skillFall ? window.__skillFall.words.length : 0,
  sample: window.__skillFall ? window.__skillFall.words.slice(0, 6) : [],
  hasRipple: !!(window.__skillFall && window.__skillFall.source.__asciiRipple),
  fieldStart: (document.getElementById('heroAscii').getAttribute('data-text') || '').slice(0, 40)
})`));
console.log('boot', JSON.stringify(boot));

// A heavy and a light word dropped from the same height — weight must show.
await evalx(`(() => {
  var f = window.__skillFall;
  f.tokens.length = 0; f.dust.length = 0;
  f.spawn(420, 260);            // whatever the bag gives us
  f.spawn(700, 260);            // second sample
  return true;
})()`);
await sleep(120);
const t0 = JSON.parse(await evalx(`JSON.stringify(window.__skillFall.tokens.map(function(t){return {w:t.word, weight:t.weight, y:+t.y.toFixed(1), vy:+t.vy.toFixed(1)};}))`));
await sleep(700);
const t1 = JSON.parse(await evalx(`JSON.stringify(window.__skillFall.tokens.map(function(t){return {w:t.word, weight:t.weight, y:+t.y.toFixed(1), vy:+t.vy.toFixed(1)};}))`));

// Landing line: About's BOTTOM edge, in document coordinates.
const landY = JSON.parse(await evalx(`JSON.stringify((function(){
  var r = document.querySelector('#about').getBoundingClientRect();
  var sy = window.scrollY || window.pageYOffset || 0;
  var top = r.top + sy, bottom = r.bottom + sy;
  return { aboutTopDoc: Math.round(top), aboutBottomDoc: Math.round(bottom),
           landY: Math.round(window.__skillFall._landY()),
           expected: Math.round(bottom - 30), innerH: window.innerHeight };
})())`));
console.log('landing line (document coords)', JSON.stringify(landY));
const landsNearAboutEnd =
  landY.landY > landY.aboutTopDoc + (landY.aboutBottomDoc - landY.aboutTopDoc) * 0.8;

// A heavy word dropped from the hero has to reach that line — which sits
// below the fold — and still be lying there when the reader scrolls down.
// The timed spawner is parked for this so the sample is not crowded.
await evalx(`(() => {
  var f = window.__skillFall;
  clearTimeout(f.spawnTimer); f.spawnTimer = 0;
  f.tokens.length = 0; f.dust.length = 0;
  f.tokens.push({ word: 'Premiere Pro', weight: 3, wn: 1, size: 17, x: 600, y: 300,
    vx: 0, vy: 0, rot: 0, spin: 0, phase: 0, alpha: 0, base: 0.34,
    born: performance.now(), landed: false, landedAt: 0, squash: 0, held: 0, seed: 1 });
  f._wake(); return true;
})()`);
await sleep(3400);
const rest = JSON.parse(await evalx(`JSON.stringify(window.__skillFall.tokens.map(function(t){
  return { w: t.word, y: Math.round(t.y), landed: t.landed, offScreen: t.y > window.innerHeight };
}))`));
console.log('after the fall', JSON.stringify(rest));
const restPP = rest.find((t) => t.w === 'Premiere Pro');
const landedOnLine = !!restPP && restPP.landed &&
  Math.abs(restPP.y - landY.landY) < 2 && restPP.offScreen === true;

// It came to rest below the fold, so the fade must have waited for a reader.
await sleep(1600);
const held = JSON.parse(await evalx(`JSON.stringify(window.__skillFall.tokens.map(function(t){
  return { w: t.word, y: Math.round(t.y), held: +(t.held).toFixed(2) };
}))`));
console.log('off-screen landing held', JSON.stringify(held));
const heldPP = held.find((t) => t.w === 'Premiere Pro');
const holdWorked = !!heldPP && heldPP.held > 0.5;

// Scroll it into view: the word is on screen, at the end of About.
await evalx(`window.scrollTo(0, document.querySelector('#about').offsetTop + document.querySelector('#about').offsetHeight - window.innerHeight + 40); 'ok'`);
await sleep(500);
const onScreen = JSON.parse(await evalx(`JSON.stringify((function(){
  var sy = window.scrollY || window.pageYOffset || 0;
  return { h: window.innerHeight, tokens: window.__skillFall.tokens.map(function(t){
    return { w: t.word, screenY: Math.round(t.y - sy), landed: t.landed };
  }) };
})())`));
console.log('after scrolling to About', JSON.stringify(onScreen));
const onScreenPP = onScreen.tokens.find((t) => t.w === 'Premiere Pro');
const visibleAfterScroll = !!onScreenPP &&
  onScreenPP.screenY > 0 && onScreenPP.screenY < onScreen.h;

// Words must keep falling while About is on screen, not just while the hero is.
await evalx(`(() => { var f = window.__skillFall; f.tokens.length = 0; f._queueSpawn(); return true; })()`);
await sleep(3000);
const whileReading = JSON.parse(await evalx(`JSON.stringify({
  scrollY: Math.round(window.scrollY),
  tokens: window.__skillFall.tokens.length,
  fieldVisible: window.__skillFall.fieldVisible,
  aboutVisible: window.__skillFall.aboutVisible })`));
console.log('spawning while About is on screen', JSON.stringify(whileReading));
const spawnsWhileReading = whileReading.tokens > 0 && whileReading.fieldVisible === false;

await evalx(`window.scrollTo(0, 0); 'ok'`);
await sleep(600);
console.log('t+0.1s ', JSON.stringify(t0));
console.log('t+0.8s ', JSON.stringify(t1));

// Auto-spawns must start in the top half of the field, or a word barely falls.
const spawnY = JSON.parse(await evalx(`(() => {
  var f = window.__skillFall;
  var r = f.source.getBoundingClientRect();
  f.tokens.length = 0;
  var ys = [];
  for (var i = 0; i < 12; i++) { f.spawn(); ys.push(f.tokens[f.tokens.length - 1].y); }
  return JSON.stringify({ ys: ys.map(function(y){return Math.round(y);}), h: Math.round(r.height) });
})()`));
console.log('spawn heights', JSON.stringify(spawnY));

// let them reach the ground
await sleep(2200);
const landed = JSON.parse(await evalx(`JSON.stringify({
  tokens: window.__skillFall.tokens.length,
  landedFlags: window.__skillFall.tokens.map(function(t){return t.landed;}),
  ys: window.__skillFall.tokens.map(function(t){return +t.y.toFixed(1);}),
  dust: window.__skillFall.dust.length
})`));
console.log('after 3s', JSON.stringify(landed));

// explicit weight race: Premiere Pro (3.0) vs Curious (0.7)
await evalx(`(() => {
  var f = window.__skillFall;
  f.tokens.length = 0; f.dust.length = 0;
  f.bag = [];
  f.spawn(300, 200);
  return true;
})()`);
const race = JSON.parse(await evalx(`(() => {
  var f = window.__skillFall;
  f.tokens.length = 0;
  // push two known words by hand, same height
  ['Premiere Pro', 'Curious'].forEach(function (word, i) {
    var weight = f._weightOf(word);
    f.tokens.push({ word: word, weight: weight, wn: (weight - 0.5) / 2.5, size: 16,
      x: 300 + i * 400, y: 200, vx: 0, vy: 0, rot: 0, spin: 0, phase: 0,
      alpha: 0, base: 0.34, born: performance.now(), landed: false, landedAt: 0, squash: 0, seed: 1 });
  });
  f._wake();
  return JSON.stringify({ ok: true });
})()`));
await sleep(600);
const raceState = JSON.parse(await evalx(`JSON.stringify(window.__skillFall.tokens.map(function(t){return {w:t.word, weight:t.weight, y:+t.y.toFixed(1), vy:+t.vy.toFixed(1)};}))`));
console.log('weight race @0.6s', JSON.stringify(raceState));

const pass =
  boot.exists && boot.words > 20 && boot.hasRipple &&
  boot.fieldStart.indexOf('Adobe') === 0 &&
  t1.length > 0 && t1.every((t) => t.y > t0[0].y) &&
  Math.abs(landY.landY - landY.expected) < 1 &&
  landsNearAboutEnd && landedOnLine && holdWorked &&
  visibleAfterScroll && spawnsWhileReading &&
  spawnY.ys.length === 12 && spawnY.ys.every((y) => y < spawnY.h * 0.55) &&
  errs.length === 0;
const heavy = raceState.find((t) => t.w === 'Premiere Pro');
const light = raceState.find((t) => t.w === 'Curious');
console.log('heavy/light speed ratio =', (heavy.vy / light.vy).toFixed(2), '(expect > 1.5)');
console.log('errors:', errs.length ? errs : 'none');
console.log(pass && heavy.vy / light.vy > 1.5 ? 'RESULT: PASS' : 'RESULT: FAIL');

log.close();
await http(`/json/close/${target.id}`, 'PUT').catch(() => {});
page.close();
process.exit(pass ? 0 : 1);
