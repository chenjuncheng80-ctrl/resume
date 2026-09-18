/* =========================================================
   Physical skill fall — driven through real Chrome frames
   ---------------------------------------------------------
   `node tools/cdp_fall.mjs`   (Chrome must be up on :9333)

   Everything here has to run against real requestAnimationFrame
   ticks and real input events: the fall is a solver stepping at
   60Hz, and neither a virtual clock nor MouseEvents synthesised
   inside the page would exercise it.

   `ev()` round-trips through JSON.stringify inside the page, so a
   plain expression returning an object comes back as an object.
   ========================================================= */

const PORT = 9333;
const URL = 'file:///C:/Users/chenj/Desktop/portfolio/index.html';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const http = async (p, m = 'GET') =>
  (await fetch(`http://127.0.0.1:${PORT}${p}`, { method: m })).json().catch(() => ({}));

function connect(u) {
  return new Promise((res, rej) => {
    const ws = new WebSocket(u);
    let id = 0;
    const pending = new Map();
    const errors = [];
    ws.addEventListener('open', () =>
      res({
        errors,
        send(m, p = {}) {
          const i = ++id;
          ws.send(JSON.stringify({ id: i, method: m, params: p }));
          return new Promise((r, j) => pending.set(i, { r, j }));
        },
        close: () => ws.close(),
      })
    );
    ws.addEventListener('message', (e) => {
      const m = JSON.parse(e.data);
      if (m.id && pending.has(m.id)) {
        const p = pending.get(m.id);
        pending.delete(m.id);
        m.error ? p.j(new Error(JSON.stringify(m.error))) : p.r(m.result);
      } else if (m.method === 'Runtime.exceptionThrown') {
        errors.push('exception: ' + (m.params.exceptionDetails.text || ''));
      } else if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
        errors.push('console: ' + m.params.args.map((a) => a.value || a.description || '').join(' '));
      }
    });
    ws.addEventListener('error', rej);
  });
}

const target = await http(`/json/new?${encodeURIComponent(URL)}`, 'PUT');
const page = await connect(target.webSocketDebuggerUrl);
await page.send('Runtime.enable');
await page.send('Page.enable');
await sleep(2500);

async function ev(expr) {
  const raw = await page.send('Runtime.evaluate', {
    expression: 'JSON.stringify(' + expr + ')',
    returnByValue: true,
  });
  const s = raw.result && raw.result.value;
  if (s === undefined) return undefined;
  try { return JSON.parse(s); } catch (err) { return s; }
}

const mouse = (type, x, y) =>
  page.send('Input.dispatchMouseEvent', {
    type, x, y, button: 'left',
    buttons: type === 'mouseReleased' ? 0 : 1,
    clickCount: 1,
  });

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok: !!ok });
  console.log((ok ? '  PASS  ' : '  FAIL  ') + name + (detail === undefined ? '' : '   ' + detail));
}

const clear = () => ev(`(() => { const f = window.__skillFall; clearTimeout(f.spawnTimer);
  f.tokens.slice().forEach(t => f._removeToken(t)); return true; })()`);

/* Put one known word into play, dead still, so nothing about the measurement
   depends on the random nudge spawn() gives it. */
const drop = (word, x, y) => ev(`(() => { const f = window.__skillFall;
  f.bag = ['${word}']; f.spawn(${x}, ${y});
  const t = f.tokens[f.tokens.length - 1];
  if (t) { Matter.Body.setVelocity(t.body, {x:0,y:0}); Matter.Body.setAngularVelocity(t.body, 0); }
  return f.tokens.length; })()`);

async function until(expr, ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await ev(expr)) return true;
    await sleep(120);
  }
  return false;
}

/* Headless Chrome refuses to scroll from a script in this setup — neither
   scrollTo() with any behaviour nor assigning scrollTop moves the document,
   although real user input does. So scroll by wheel and read back what was
   actually reached. */
async function scrollTo(y, tol = 60) {
  for (let i = 0; i < 40; i++) {
    const cur = await ev('Math.round(window.scrollY)');
    if (Math.abs(cur - y) <= tol) return cur;
    const delta = Math.max(-500, Math.min(500, y - cur));
    await page.send('Input.dispatchMouseEvent', {
      type: 'mouseWheel', x: 700, y: 400, deltaX: 0, deltaY: delta,
    });
    await sleep(110);
  }
  return await ev('Math.round(window.scrollY)');
}

/* --- 1. boot ----------------------------------------------------------- */
check('matter-js is loaded', (await ev(`typeof window.Matter`)) === 'object');
check('layer exists once', (await ev(`document.querySelectorAll('.skill-fall').length`)) === 1);
const vocab = await ev(`window.__skillFall.words`);
check('vocabulary comes from the hero field',
  vocab.length > 25 && vocab.indexOf('Adobe') >= 0 && vocab.indexOf('Unity') >= 0,
  vocab.length + ' words');
check('the layer does not swallow clicks',
  (await ev(`getComputedStyle(document.querySelector('.skill-fall')).pointerEvents`)) === 'none');

/* --- 2. a body is really being simulated ------------------------------- */
await clear();
const landY = await ev(`Math.round(window.__skillFall._landY())`);
await drop('Photoshop', 600, 200);
await sleep(700);
const flying = await ev(`(() => { const t = window.__skillFall.tokens[0]; if (!t) return null;
  return { y: Math.round(t.body.position.y), vy: +t.body.velocity.y.toFixed(3),
           els: document.querySelectorAll('.skill-fall__word').length,
           tx: t.el.style.transform.slice(0, 22), op: +t.el.style.opacity, base: +t.base.toFixed(3) }; })()`);
check('a spawned word has a live body', flying && flying.y > 260, 'y=' + (flying && flying.y));
check('a spawned word has a DOM element', flying && flying.els === 1);
check('the element is positioned from the body', flying && /translate3d/.test(flying.tx), flying && flying.tx);
check('it fades in rather than popping', flying && flying.op > 0.05 && flying.op <= flying.base + 0.001,
  'opacity=' + (flying && flying.op) + '/' + (flying && flying.base));

/* --- 3. weight has to be legible in the fall --------------------------- */
const speedOf = async (word) => {
  await clear();
  await drop(word, 600, 120);
  await sleep(1500);
  return await ev(`(() => { const t = window.__skillFall.tokens[0]; return t ? Math.abs(t.body.velocity.y) * 60 : 0; })()`);
};
const vHeavy = await speedOf('Premiere Pro');
const vLight = await speedOf('Curious');
check('heavy words fall faster than light ones', vHeavy / vLight > 1.6 && vHeavy / vLight < 3,
  Math.round(vLight) + ' -> ' + Math.round(vHeavy) + ' px/s (x' + (vHeavy / vLight).toFixed(2) + ')');
check('nothing falls so fast it cannot be read', vHeavy < 700, Math.round(vHeavy) + ' px/s');

/* --- 4. words stack instead of overlapping ----------------------------- */
await clear();
const parked = await scrollTo(landY - 400);
await sleep(400);
check('test scaffolding: the page really scrolled', Math.abs(parked - (landY - 400)) < 80, 'scrollY=' + parked);
await drop('Adobe', 700, landY - 420);
const landedFirst = await until(`(() => { const f = window.__skillFall; return f.tokens.length && f.tokens[0].landed; })()`, 8000);
const lower = await ev(`(() => { const t = window.__skillFall.tokens[0]; return t ? { y: Math.round(t.y), h: t.h, landed: t.landed } : null; })()`);
check('a word lands and the landing is noticed', landedFirst && lower && lower.landed, JSON.stringify(lower));
check('it rests on the landing line, not through it',
  lower && Math.abs(lower.y + lower.h / 2 - landY) < 8,
  'bottom=' + (lower && Math.round(lower.y + lower.h / 2)) + ' line=' + landY);

await drop('Blender', 700, landY - 420);
const landedSecond = await until(`(() => { const f = window.__skillFall; return f.tokens.length > 1 && f.tokens[1].landed; })()`, 8000);
const stack = await ev(`(() => { const ts = window.__skillFall.tokens.slice().sort((a,b) => a.y - b.y);
  if (ts.length < 2) return null;
  const top = ts[0], bot = ts[1];
  return { gap: Math.round(bot.y - top.y), need: Math.round((bot.h + top.h) / 2) }; })()`);
check('a second word settles on top of the first', landedSecond && stack && stack.gap > 0, JSON.stringify(stack));
check('and does not sink into it', stack && stack.gap > stack.need * 0.6,
  'gap=' + (stack && stack.gap) + ' ~ needed ' + (stack && stack.need));

/* --- 5. five seconds on the floor, then gone --------------------------- */
await clear();
const parked2 = await scrollTo(landY - 400);
check('test scaffolding: still scrolled for the fade test', Math.abs(parked2 - (landY - 400)) < 80, 'scrollY=' + parked2);
await drop('Unity', 600, landY - 300);
const landedThird = await until(`(() => { const f = window.__skillFall; return f.tokens.length && f.tokens[0].landed; })()`, 9000);
await sleep(3000);
const mid = await ev(`(() => { const t = window.__skillFall.tokens[0]; return t ? { op: +t.el.style.opacity, base: +t.base.toFixed(3), since: Math.round(performance.now() - t.landedAt) } : null; })()`);
const late = await ev(`(() => { const f = window.__skillFall; return { n: f.tokens.length, detached: f.tokens[0] ? f.tokens[0].detached : null }; })()`);
await sleep(2600);
const gone = await ev(`(() => ({ n: window.__skillFall.tokens.length, els: document.querySelectorAll('.skill-fall__word').length }))()`);
check('the countdown starts on landing', landedThird);
check('it is still lying there around 3s', mid && mid.op > 0.02, JSON.stringify(mid));
check('it has faded by then', mid && mid.op < mid.base * 0.8, 'op=' + (mid && mid.op) + ' base=' + (mid && mid.base));
check('it leaves the simulation once half faded', late && late.detached === true, JSON.stringify(late));
check('and is gone by five seconds', gone.n === 0 && gone.els === 0, JSON.stringify(gone));

/* --- 6. pick one up ---------------------------------------------------- */
await clear();
await drop('Figma', 500, landY - 300);
await until(`(() => { const f = window.__skillFall; return f.tokens.length && f.tokens[0].landed; })()`, 9000);
const before = await ev(`(() => { const t = window.__skillFall.tokens[0]; const sy = window.scrollY;
  return { sx: Math.round(t.x), sy: Math.round(t.y - sy) }; })()`);
await mouse('mousePressed', before.sx, before.sy);
await sleep(80);
const grabbed = await ev(`window.__skillFall.dragToken && window.__skillFall.dragToken.word`);
check('a word can be picked up with the mouse', grabbed === 'Figma', String(grabbed));
await mouse('mouseMoved', before.sx + 40, before.sy - 60);
await sleep(60);
await mouse('mouseMoved', before.sx + 120, before.sy - 180);
await sleep(600);
const held = await ev(`(() => { const t = window.__skillFall.dragToken; if (!t) return null;
  return { x: Math.round(t.x), y: Math.round(t.y), sy: Math.round(window.scrollY) }; })()`);
await mouse('mouseReleased', before.sx + 120, before.sy - 180);
await sleep(150);
const released = await ev(`window.__skillFall.drag === null && window.__skillFall.dragToken === null`);
check('it follows the cursor while held', held && Math.abs(held.x - (before.sx + 120)) < 110,
  JSON.stringify(held));
check('and lets go on release', released === true);
await sleep(1800);
const afterThrow = await ev(`(() => { const t = window.__skillFall.tokens[0];
  return t ? { y: Math.round(t.y), line: ${landY} } : { y: null, line: ${landY} }; })()`);
check('then falls back down to the line', afterThrow.y === null || afterThrow.y > afterThrow.line - 260,
  JSON.stringify(afterThrow));

/* --- 7. it stays out of the way ---------------------------------------- */
await scrollTo(0);
await sleep(400);
const pluckAt = await ev(`(function () { var h = document.querySelector('.hero').getBoundingClientRect();
  return { x: Math.round(h.left + h.width / 2), y: Math.round(h.top + h.height - 30) }; })()`);
await ev(`(function () { window.__navClicks = 0;
  var a = document.querySelector('.nav a[href="#about"]');
  if (a) a.addEventListener('click', function (e) { window.__navClicks++; e.preventDefault(); });
  return a ? a.textContent : null; })()`);
check('the nav link probe is wired up', (await ev('window.__navClicks')) === 0, 'clicks=' + (await ev('window.__navClicks')));

await mouse('mousePressed', 700, 300);
await sleep(80);
check('a press on empty space grabs nothing', (await ev('window.__skillFall.drag === null')) === true);
await mouse('mouseReleased', 700, 300);
await sleep(250);

const link = await ev(`(function () { var a = document.querySelector('.nav a[href="#about"]');
  var r = a.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`);
await mouse('mousePressed', link.x, link.y);
await sleep(60);
await mouse('mouseReleased', link.x, link.y);
await sleep(300);
const navClicks = await ev('window.__navClicks');
check('links under the layer still receive clicks', navClicks > 0, 'clicks=' + navClicks);

// Count alone is not enough: a word that finished its five seconds can be
// collected in the same instant, so watch for a NEWLY BORN token instead.
const beforePluck = await ev('window.__skillFall.tokens.reduce(function (m, t) { return Math.max(m, t.born); }, 0)');
await mouse('mousePressed', pluckAt.x, pluckAt.y);
await sleep(400);
await mouse('mouseReleased', pluckAt.x, pluckAt.y);
const afterPluck = await ev('window.__skillFall.tokens.reduce(function (m, t) { return Math.max(m, t.born); }, 0)');
check('clicking the hero still plucks a word', afterPluck > beforePluck,
  'newest token ' + Math.round(beforePluck) + ' -> ' + Math.round(afterPluck));

/* --- 8. nothing leaked ------------------------------------------------- */
await clear();
await sleep(300);
const leftovers = await ev(`document.querySelectorAll('.skill-fall__word').length`);
check('no DOM words left behind', leftovers === 0, String(leftovers));
if (page.errors.length) console.log('\npage complained:\n' + page.errors.map((e) => '  ' + e).join('\n'));
check('no errors logged', page.errors.length === 0, page.errors.length + ' logged');

const failed = results.filter((r) => !r.ok);
console.log('\n' + (results.length - failed.length) + '/' + results.length + ' checks passed');
await http(`/json/close/${target.id}`, 'PUT').catch(() => {});
page.close();
process.exit(failed.length ? 1 : 0);
