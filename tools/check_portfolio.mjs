/* Browser regression check. Start a static server on :8080 and Chrome with
   --remote-debugging-port=9333, then run node tools/check_portfolio.mjs.
   Uses Chrome's real layout engine and native dialog behavior; no packages. */
import fs from 'node:fs';

const base = process.argv[2] || 'http://127.0.0.1:8080';
const debug = process.argv[3] || 'http://127.0.0.1:9333';
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const target = await (await fetch(`${debug}/json/new?about:blank`, {method: 'PUT'})).json();
const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise(resolve => socket.addEventListener('open', resolve));
let id = 0, failures = 0, checks = 0;
const pending = new Map(), exceptions = [];
socket.addEventListener('message', event => {
  const message = JSON.parse(event.data);
  if (message.method === 'Runtime.exceptionThrown') exceptions.push(message.params.exceptionDetails);
  if (message.id && pending.has(message.id)) {
    const {resolve, reject} = pending.get(message.id);
    pending.delete(message.id);
    message.error ? reject(new Error(JSON.stringify(message.error))) : resolve(message.result);
  }
});
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const callId = ++id;
  pending.set(callId, {resolve, reject});
  socket.send(JSON.stringify({id: callId, method, params}));
});
const evaluate = async expression => {
  const result = await send('Runtime.evaluate', {expression, returnByValue: true, awaitPromise: true});
  if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
  return result.result.value;
};
const check = (label, okay, detail) => {
  checks++;
  if (!okay) failures++;
  console.log(`${okay ? 'PASS' : 'FAIL'} ${label}${!okay && detail ? ': ' + JSON.stringify(detail) : ''}`);
};
const shot = async name => {
  const result = await send('Page.captureScreenshot', {format: 'png'});
  fs.mkdirSync('.workbuddy', {recursive: true});
  fs.writeFileSync(`.workbuddy/verified-${name}.png`, Buffer.from(result.data, 'base64'));
};
await send('Page.enable');
await send('Runtime.enable');
await send('Page.bringToFront');
await send('Page.addScriptToEvaluateOnNewDocument', {source: `localStorage.setItem('ccs-lang', 'en');`});

async function viewport(width, height = 900, lang = 'en', reduced = false) {
  await send('Emulation.setDeviceMetricsOverride', {width, height, deviceScaleFactor: 1, mobile: width < 640});
  await send('Emulation.setTouchEmulationEnabled', {enabled: width < 901, maxTouchPoints: 1});
  await send('Emulation.setEmulatedMedia', {features: [{name: 'prefers-reduced-motion', value: reduced ? 'reduce' : 'no-preference'}]});
  await send('Page.navigate', {url: base});
  await wait(900);
  await evaluate('document.fonts.ready');
  await evaluate(`document.documentElement.style.scrollBehavior = 'auto'; document.querySelector('[data-lang="${lang}"]').click();`);
  await wait(200);
}

try {
  for (const [width, height, lang] of [[1440,900,'en'], [1280,800,'en'], [1024,768,'en'], [900,900,'en'], [768,1024,'en'], [390,844,'en'], [360,800,'en'], [320,740,'en'], [844,390,'en'], [390,844,'zh'], [1280,800,'zh']]) {
    await viewport(width, height, lang);
    const metrics = await evaluate(`(() => {
      const rect = s => document.querySelector(s).getBoundingClientRect();
      const x = rect('#workGrid').x;
      const heads = [...document.querySelectorAll('.section__head')].map(el => el.getBoundingClientRect().x);
      const brand = rect('.nav__brand'), language = rect('.lang-switch'), toggle = rect('.nav__toggle'), links = rect('.nav__links');
      const navFits = width => width <= 900 ? brand.right <= language.left + 1 && language.right <= toggle.left + 1 : brand.right <= links.left + 1 && links.right <= language.left + 1;
      return {overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
        aligned: heads.every(left => Math.abs(left - x) < 1) && Math.abs(brand.x - x) < 1,
        navFits: navFits(innerWidth), pinned: document.documentElement.classList.contains('pin-ready'),
        titleFits: rect('.hero__title-text').width <= innerWidth,
        gridColumns: getComputedStyle(document.querySelector('#workGrid')).gridTemplateColumns,
        headers: heads, x};
    })()`);
    check(`${width}×${height} ${lang}: no horizontal overflow`, !metrics.overflow, metrics);
    check(`${width}×${height} ${lang}: shared content and navigation edges`, metrics.aligned, metrics);
    check(`${width}×${height} ${lang}: navigation controls fit`, metrics.navFits, metrics);
    check(`${width}×${height} ${lang}: readable About layout`, metrics.pinned === (width > 900 && height >= 650), metrics);
  }

  await viewport(1440);
  await evaluate(`window.scrollTo(0, document.getElementById('aboutPin').getBoundingClientRect().top + scrollY + (document.getElementById('aboutPin').offsetHeight - innerHeight));`);
  await wait(250);
  check('desktop contact card arrives and inactive About is inert', await evaluate(`document.querySelector('.pin__layer--card').getAttribute('aria-hidden') !== 'true' && !document.querySelector('.pin__layer--card').inert && document.querySelector('.pin__layer--about').inert`));
  await evaluate(`window.scrollTo(0, document.getElementById('aboutPin').getBoundingClientRect().top + scrollY);`);
  await wait(250);
  check('scrolling back restores About and hides card from keyboard', await evaluate(`!document.querySelector('.pin__layer--about').inert && document.querySelector('.pin__layer--card').inert`));
  await evaluate(`document.querySelector('[data-filter="photography"]').click(); document.querySelector('#work').scrollIntoView();`);
  await wait(1000);
  check('filter shows six photographs and updates count', await evaluate(`document.querySelectorAll('#workGrid .card:not(.is-hidden)').length === 6 && document.getElementById('workCount').textContent === '6 of 23 works'`));
  await evaluate(`document.querySelector('#workGrid .card:not(.is-hidden)').click()`);
  await wait(250);
  check('image opens in native modal with uncropped artwork', await evaluate(`document.getElementById('workViewer').open && !!document.querySelector('#viewerMedia img') && getComputedStyle(document.querySelector('#viewerMedia img')).objectFit === 'contain'`));
  check('viewer traps focus inside dialog', await evaluate(`document.getElementById('workViewer').contains(document.activeElement)`));
  await shot('desktop-viewer');
  await send('Input.dispatchKeyEvent', {type: 'keyDown', key: 'ArrowRight', code: 'ArrowRight'});
  check('arrow key advances within filtered works', await evaluate(`document.getElementById('viewerPosition').textContent === '2 / 6'`));
  await send('Input.dispatchKeyEvent', {type: 'keyDown', key: 'Escape', code: 'Escape'});
  await wait(100);
  const afterEscape = await evaluate(`({open: document.getElementById('workViewer').open, focus: document.activeElement.className, locked: document.documentElement.classList.contains('viewer-open')})`);
  check('Escape closes viewer and restores card focus', !afterEscape.open && afterEscape.focus.includes('card') && !afterEscape.locked, afterEscape);

  await evaluate(`document.querySelector('[data-lang="zh"]').click()`);
  await wait(100);
  check('language change preserves category and translates count', await evaluate(`document.querySelector('[data-filter="photography"]').getAttribute('aria-pressed') === 'true' && document.getElementById('workCount').textContent === '6 / 23 件作品'`));
  await evaluate(`document.querySelector('#workGrid .card:not(.is-hidden)').click()`);
  check('viewer title follows translated card title', await evaluate(`document.getElementById('viewerTitle').textContent === '巷弄裡的生活節奏'`));
  await evaluate(`document.getElementById('workViewer').close(); document.querySelector('[data-lang="en"]').click(); document.querySelector('[data-filter="motion"]').click();`);
  await wait(200);
  await evaluate(`document.querySelector('#workGrid .card:not(.is-hidden) video').closest('.card').click()`);
  await wait(350);
  check('working video opens with playback controls', await evaluate(`!!document.querySelector('#viewerMedia video[controls]')`));
  const playback = await evaluate(`(async () => { const v = document.querySelector('#viewerMedia video'); v.muted = true; await v.play(); await new Promise(r => setTimeout(r, 350)); return {time: v.currentTime, width: v.videoWidth, error: !!v.error}; })()`);
  check('video decodes and plays', playback.width > 0 && playback.time > 0 && !playback.error, playback);
  await evaluate(`document.getElementById('workViewer').close(); document.querySelector('[data-filter="video"]').click(); [...document.querySelectorAll('#workGrid .card')].find(c => c.getAttribute('href') === 'assets/videos/video-01.mp4').click();`);
  await wait(500);
  const missing = await evaluate(`({open: document.getElementById('workViewer').open, notice: !document.getElementById('viewerNotice').hidden, image: !!document.querySelector('#viewerMedia img'), title: document.getElementById('viewerTitle').textContent})`);
  check('missing video gives cover and readable fallback', missing.open && missing.notice && missing.image, missing);
  await evaluate(`document.getElementById('workViewer').close()`);

  await viewport(390, 844, 'zh');
  await evaluate(`document.getElementById('navToggle').click()`);
  check('mobile menu locks background and moves focus', await evaluate(`document.getElementById('navToggle').getAttribute('aria-expanded') === 'true' && document.querySelector('main').inert && document.getElementById('navLinks').contains(document.activeElement)`));
  await shot('mobile-menu');
  await send('Input.dispatchKeyEvent', {type: 'keyDown', key: 'Escape', code: 'Escape'});
  check('Escape restores menu focus and page scrolling', await evaluate(`document.getElementById('navToggle').getAttribute('aria-expanded') === 'false' && !document.querySelector('main').inert && document.activeElement.id === 'navToggle'`));
  await evaluate(`document.querySelector('#work').scrollIntoView(); document.querySelector('#workGrid .card').click()`);
  await wait(250);
  await shot('mobile-viewer');
  check('mobile viewer fits viewport', await evaluate(`(() => { const r = document.getElementById('workViewer').getBoundingClientRect(); return r.x >= 0 && r.right <= innerWidth && r.height <= innerHeight; })()`));
  await evaluate(`document.getElementById('workViewer').close()`);

  await viewport(768, 1024);
  await evaluate(`document.getElementById('work').scrollIntoView()`);
  await wait(150);
  await evaluate(`document.getElementById('navToggle').click()`);
  check('tablet menu fills viewport after scrolling', await evaluate(`document.getElementById('navLinks').getBoundingClientRect().height >= innerHeight - 1`));
  await evaluate(`document.getElementById('navToggle').click()`);

  await viewport(1280, 800, 'en', true);
  check('reduced motion uses ordinary About flow and visible content', await evaluate(`!document.documentElement.classList.contains('pin-ready') && getComputedStyle(document.querySelector('.about__big')).opacity === '1' && getComputedStyle(document.querySelector('.hero__marquee-track')).animationDuration === '1e-05s'`));
  await send('Emulation.setScriptExecutionDisabled', {value: true});
  await send('Page.navigate', {url: base});
  await wait(500);
  await send('Emulation.setScriptExecutionDisabled', {value: false});
  check('without JavaScript, page copy and contact card remain visible', await evaluate(`getComputedStyle(document.querySelector('.about__big')).opacity === '1' && getComputedStyle(document.querySelector('.pin__layer--card')).display !== 'none'`));
  check('no uncaught JavaScript exceptions', exceptions.length === 0, exceptions);
} finally {
  socket.close();
  await fetch(`${debug}/json/close/${target.id}`);
}
console.log(`${checks - failures}/${checks} browser checks passed`);
process.exitCode = failures ? 1 : 0;
