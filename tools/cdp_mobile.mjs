/* =========================================================
   Phone pass — the site through a 390x844 touch viewport
   ---------------------------------------------------------
   `node tools/cdp_mobile.mjs`   (Chrome must be up on :9333)

   Two things make this harness different from the desktop ones:

     - neither window.scrollTo nor scrollTop moves the document under
       device emulation, so scrolling is done with real touch gestures
       (Input.dispatchTouchEvent) and closed in a loop;
     - a finger has no hover, so the layout assertions here are about
       overflow and hit areas rather than about pointer feedback.

   Every check is a rule the phone layout is supposed to keep, so a CSS
   change that breaks it fails here instead of on someone's phone.
   ========================================================= */

const PORT = 9333;
const URL = 'file:///C:/Users/chenj/Desktop/portfolio/index.html';
/* 390x844 is an iPhone 14; pass a size to check another phone
   (`node tools/cdp_mobile.mjs 360 800` for a small Android). */
const W = Number(process.argv[2] || 390);
const H = Number(process.argv[3] || 844);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const http = async (p, m = 'GET') =>
  (await fetch(`http://127.0.0.1:${PORT}${p}`, { method: m })).json().catch(() => ({}));

function connect(u) {
  return new Promise((res, rej) => {
    const ws = new WebSocket(u);
    let id = 0;
    const pending = new Map();
    const errors = [];
    ws.addEventListener('open', () => res({
      errors,
      send(m, p = {}) {
        const i = ++id;
        ws.send(JSON.stringify({ id: i, method: m, params: p }));
        return new Promise((r, j) => pending.set(i, { r, j }));
      },
      close: () => ws.close(),
    }));
    ws.addEventListener('message', (e) => {
      const m = JSON.parse(e.data);
      if (m.id && pending.has(m.id)) {
        const p = pending.get(m.id); pending.delete(m.id);
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
await page.send('Emulation.setDeviceMetricsOverride', {
  width: W, height: H, deviceScaleFactor: 2, mobile: true,
});
await page.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
await page.send('Emulation.setUserAgentOverride', {
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
});
await sleep(2600);

const ev = async (expr) => {
  const raw = await page.send('Runtime.evaluate', { expression: 'JSON.stringify(' + expr + ')', returnByValue: true });
  const s = raw.result && raw.result.value;
  if (s === undefined) return undefined;
  try { return JSON.parse(s); } catch (e) { return s; }
};

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok: !!ok });
  console.log((ok ? '  PASS  ' : '  FAIL  ') + name + (detail === undefined ? '' : '   ' + detail));
}
/* Landscape on a phone is 844x390: wider than the 640px breakpoint, so it gets
   the desktop nav, and only 390 tall, which the card page fills completely. A
   few portrait assertions do not apply there; say so rather than fail. */
const landscape = W > 640 || H < 560;
function skip(name, why) {
  console.log('  skip  ' + name + '   ' + why);
}

/* ---------- touch scrolling ------------------------------------------- */
async function swipe(dy) {
  const x = 195, y0 = 700;
  const dist = Math.min(420, Math.abs(dy));
  const dir = dy > 0 ? -1 : 1;                 // finger up => page down
  await page.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y: y0 }] });
  for (let i = 1; i <= 8; i++) {
    await page.send('Input.dispatchTouchEvent', {
      type: 'touchMove', touchPoints: [{ x, y: y0 + dir * dist * i / 8 }],
    });
    await sleep(20);
  }
  await page.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await sleep(420);
}
async function scrollToY(y, tries = 40) {
  for (let i = 0; i < tries; i++) {
    const cur = await ev('Math.round(window.scrollY)');
    if (Math.abs(cur - y) < 30) break;
    await swipe(Math.max(-420, Math.min(420, y - cur)));
  }
  return await settle();
}

/* A touch fling keeps gliding after the finger is up, so anything measured
   right after a swipe is measured against a moving page — a word that has
   landed correctly reads as being hundreds of pixels off. Wait for the
   document to stop first. */
async function settle() {
  let last = -1;
  for (let i = 0; i < 25; i++) {
    const y = await ev('Math.round(window.scrollY)');
    if (y === last) return y;
    last = y;
    await sleep(300);
  }
  return last;
}

const vh = await ev('window.innerHeight');

/* --- 1. the phone kit is actually in the document ---------------------- */
const head = await ev(`(() => { const vp = document.querySelector('meta[name=viewport]');
  const tc = document.querySelector('meta[name=theme-color]');
  return { vp: vp && vp.getAttribute('content'), theme: tc && tc.getAttribute('content') }; })()`);
check('viewport is device-width', /width=device-width/.test(head.vp || ''), head.vp);
check('a theme colour is set for the phone chrome', !!head.theme, String(head.theme));

/* --- 2. nothing runs off the side of the screen ------------------------ */
const fit = await ev(`(() => {
  const vw = document.documentElement.clientWidth;
  const over = [];
  const els = document.querySelectorAll('.section__title, .namecard, .contact__row, .timeline__role, .hero__title-text, .edu__card, .btn');
  els.forEach((el) => {
    const r = el.getBoundingClientRect();
    if (r.width === 0) return;
    if (r.left < -0.5 || r.right > vw + 0.5) {
      over.push((el.className || el.tagName) + ' ' + Math.round(r.left) + '..' + Math.round(r.right));
    }
  });
  return { vw, scrollW: document.documentElement.scrollWidth, over: over.slice(0, 5) };
})()`);
check('no horizontal scroll', fit.scrollW <= fit.vw + 1, 'scrollW=' + fit.scrollW + ' vw=' + fit.vw);
check('headings, cards and rows stay inside the screen', fit.over.length === 0, JSON.stringify(fit.over));

/* --- 3. the hero reads as a phone hero --------------------------------- */
// The block itself is full width by design, so measure the ink: a Range over
// its contents gives the box the glyphs actually occupy.
const hero = await ev(`(() => {
  const el = document.querySelector('.hero__title-text');
  const range = document.createRange(); range.selectNodeContents(el);
  const t = range.getBoundingClientRect();
  const block = el.getBoundingClientRect();
  const vw = document.documentElement.clientWidth;
  const size = parseFloat(getComputedStyle(el).fontSize);
  return { left: Math.round(t.left), right: Math.round(t.right), h: Math.round(t.height), vw, size,
           lines: +(block.height / size / 0.96).toFixed(1) }; })()`);
check('the title keeps a margin on both sides', hero.left > 8 && hero.right < hero.vw - 8,
  'left=' + hero.left + ' right=' + hero.right + ' vw=' + hero.vw);
check('the title fits on one or two lines', hero.lines <= 2.05, hero.lines + ' lines @ ' + hero.size + 'px');

/* --- 4. tap targets ---------------------------------------------------- */
const toggle = await ev(`(() => { const b = document.querySelector('.nav__toggle');
  const r = b.getBoundingClientRect(); const cs = getComputedStyle(b);
  return { display: cs.display, x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2),
           w: Math.round(r.width), h: Math.round(r.height) }; })()`);
if (landscape) skip('the menu button is shown on a phone', 'landscape keeps the desktop nav');
else check('the menu button is shown on a phone', toggle.display === 'flex', toggle.display);
const hitToggle = await ev(`(() => { const b = document.querySelector('.nav__toggle');
  const r = b.getBoundingClientRect();
  const el = document.elementFromPoint(r.left + r.width / 2, r.bottom + 8);
  return el ? (el.className || el.tagName) : null; })()`);
if (landscape) skip('...and its tap area reaches past its ink', 'no hamburger to hit');
else check('...and its tap area reaches past its ink', /nav__toggle/.test(String(hitToggle)), String(hitToggle));

const chips = await ev(`(() => { const out = {};
  document.querySelectorAll('.lang-switch__opt').forEach((b) => {
    const r = b.getBoundingClientRect();
    const el = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    out[b.dataset.lang] = el === b ? 'self' : (el ? (el.className || el.tagName) : 'none');
  });
  return out; })()`);
check('each language chip owns its own centre tap',
  chips.en === 'self' && chips.zh === 'self', JSON.stringify(chips));

/* --- 5. the phone settings in the scripts ------------------------------ */
const js = await ev(`(() => {
  const f = window.__skillFall;
  const ripple = document.getElementById('heroAscii').__asciiRipple;
  const word = document.querySelector('.skill-fall__word');
  return { maxTokens: f && f.o.maxTokens, fontSize: f && f.o.fontSize,
           rippleFont: ripple && ripple.opts.fontSize, rippleOpacity: ripple && ripple.opts.textOpacity,
           rippleRes: ripple && ripple.opts.resolution, dpr: ripple && ripple.opts.maxDPR,
           touch: (function () { var p = document.createElement('span');
             p.className = 'skill-fall__word'; document.body.appendChild(p);
             var v = getComputedStyle(p).touchAction; p.remove(); return v; })() }; })()`);
check('the word pile is smaller on a phone', js.maxTokens <= 4, 'maxTokens=' + js.maxTokens);
check('...and its type is smaller with it', js.fontSize <= 14, 'fontSize=' + js.fontSize);
if (W >= 760) skip('the glyph field is coarser and quieter on a phone', 'a landscape phone is 844 wide and already sparse');
else check('the glyph field is coarser and quieter on a phone',
  js.rippleFont >= 22 && js.rippleOpacity <= 0.055 && js.rippleRes <= 3,
  JSON.stringify({ font: js.rippleFont, opacity: js.rippleOpacity, res: js.rippleRes }));

/* --- 6. a finger still scrolls, even over a word ----------------------- */
await scrollToY(600);
const afterSwipe = await ev('Math.round(window.scrollY)');
check('a swipe scrolls the page', afterSwipe > 300, 'scrollY=' + afterSwipe);
// Park a word on the floor line and start the swipe right on top of it: this
// is the case that used to be a dead zone, because the word claimed every
// touch that landed on it and the page could not be scrolled from there.
await settle();
const onWord = await ev(`(() => {
  const f = window.__skillFall; const sy = window.scrollY;
  f.tokens.slice().forEach((t) => f._removeToken(t));
  f.bag = ['Adobe']; f.spawn(195, sy + 120);
  const t = f.tokens[f.tokens.length - 1];
  t.landed = true; t.landedAt = performance.now();
  // in the middle of the screen, not on the floor: this far up the page the
  // floor is deliberately off screen, and the probe has to be where a thumb is
  t.y = sy + window.innerHeight - 140;
  if (t.body) Matter.Body.setPosition(t.body, { x: 195, y: t.y });
  f._render();
  const r = t.el.getBoundingClientRect();
  const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
  const el = document.elementFromPoint(cx, cy);
  return { hit: el ? (el.className || el.tagName) : null,
           x: Math.round(cx), y: Math.round(cy), w: Math.round(r.width), h: Math.round(r.height),
           inView: r.top >= 0 && r.bottom <= window.innerHeight && r.width > 0 }; })()`);
check('the probe starts on a word that is on screen', onWord.inView, JSON.stringify(onWord));
const before = await ev('Math.round(window.scrollY)');
const y0 = Math.min(vh - 12, onWord.y);
await page.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: onWord.x, y: y0 }] });
for (let i = 1; i <= 8; i++) {
  await page.send('Input.dispatchTouchEvent', {
    type: 'touchMove', touchPoints: [{ x: onWord.x, y: Math.max(60, y0 - i * 40) }],
  });
  await sleep(20);
}
await page.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
await sleep(500);
const afterWord = await ev('Math.round(window.scrollY)');
check('a swipe that starts on a falling word still scrolls',
  afterWord > before + 100, before + ' -> ' + afterWord);
check('the word itself is marked pan-y, not none', js.touch === 'pan-y', String(js.touch));

/* --- 7. the pinned scene survives the phone ---------------------------- */
const runway = await ev(`Math.round(document.querySelector('#aboutPin').offsetHeight - window.innerHeight)`);
const aboutTop = await ev(`Math.round(document.querySelector('#about').getBoundingClientRect().top + window.scrollY)`);
const got = await scrollToY(aboutTop + Math.round(runway * 0.95));
const scene = await ev(`(() => { const pin = document.getElementById('aboutPin');
  const stage = pin.querySelector('.pin__stage'); const cs = getComputedStyle(stage);
  const card = document.querySelector('.namecard').getBoundingClientRect();
  return { cardIn: +cs.getPropertyValue('--card-in'), sticky: cs.position, stageH: Math.round(stage.getBoundingClientRect().height),
           card: { top: Math.round(card.top), bottom: Math.round(card.bottom) }, vh: window.innerHeight }; })()`);
check('page two still arrives on a phone',
  scene.cardIn > 0.99 && scene.sticky === 'sticky', JSON.stringify(scene.cardIn) + ' ' + scene.sticky);
check('the card fits inside the viewport',
  scene.card.top > 0 && scene.card.bottom < scene.vh, JSON.stringify(scene.card) + ' vh=' + scene.vh);
check('the stage is exactly one screen tall',
  Math.abs(scene.stageH - scene.vh) <= 2, scene.stageH + ' vs ' + scene.vh + ' at scrollY=' + got);

/* --- 8. words land at the foot of page two, under the card ------------- */
const landing = await ev(`(() => { const f = window.__skillFall; const sy = window.scrollY;
  f.tokens.slice().forEach((t) => f._removeToken(t));
  f.bag = ['Blender']; f.spawn(195, sy + 100);
  return { line: Math.round(f._landY()), sy: Math.round(sy) }; })()`);
const landed = await (async () => {
  for (let i = 0; i < 60; i++) {
    const n = await ev(`window.__skillFall.tokens.filter((t) => t.landed).length`);
    if (n > 0) return true;
    await sleep(220);
  }
  return false;
})();
await settle();
/* Floor, word and card have to be read in the same breath: the floor rides
   the viewport, so a reading taken while the page is still gliding compares
   a resting word against a line that has since moved. */
const rest = await ev(`(() => { const f = window.__skillFall; const t = f.tokens[0];
  const card = document.querySelector('.namecard').getBoundingClientRect();
  return t ? { bottom: Math.round(t.y + t.h / 2), h: t.h,
               view: Math.round(t.y - window.scrollY),
               floor: Math.round(f._landY()),
               cardBottom: Math.round(card.bottom), vh: window.innerHeight } : null; })()`);
check('a word lands at the foot of the card page',
  landed && rest && Math.abs(rest.bottom - rest.floor) < 25 && rest.view < rest.vh,
  JSON.stringify(rest));
if (landscape) skip('...below the card, not on it', 'the card fills a 390px-tall viewport');
else check('...below the card, not on it',
  rest && rest.view > rest.cardBottom, 'view=' + (rest && rest.view) + ' cardBottom=' + (rest && rest.cardBottom));

/* --- 9. nothing leaked ------------------------------------------------- */
if (page.errors.length) console.log('\npage complained:\n' + page.errors.map((e) => '  ' + e).join('\n'));
check('no errors logged', page.errors.length === 0, page.errors.length + ' logged');

const failed = results.filter((r) => !r.ok);
console.log('\n' + (results.length - failed.length) + '/' + results.length + ' checks passed');
await http(`/json/close/${target.id}`, 'PUT').catch(() => {});
page.close();
process.exit(failed.length ? 1 : 0);
