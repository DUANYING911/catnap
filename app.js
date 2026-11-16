// ============================================================================
//  CatNap: app logic
//  Adjustable values live in config.js; you normally don't need to edit this.
//
//  States:
//    setup    researcher panel is open
//    resume   "tap to start" screen (settings already saved)
//    falling  falling-asleep animation (about 4 s)
//    resting  asleep: breathing + rare small movements
//    waking   waking animation (about 1.5 s)
//    awake    phone is in use; waits until it is still in the dock again
// ============================================================================
(() => {
  'use strict';
  const C = window.CATNAP_CONFIG;
  const $ = (id) => document.getElementById(id);
  const rand = (a, b) => a + Math.random() * (b - a);
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  const now = () => performance.now();

  // Apply colours and dimming from config.js
  for (const [k, v] of Object.entries(C.colors)) document.documentElement.style.setProperty('--' + k, v);
  $('stage').style.opacity = C.faceOpacity;
  $('drift').style.transition = `transform ${C.driftTransition}ms linear`;

  // --------------------------------------------------------------------------
  //  Saved settings (localStorage)
  // --------------------------------------------------------------------------
  const SETTINGS_KEY = 'catnap.settings';
  const LOG_KEY = 'catnap.log';
  const DEFAULTS = { x: 0, y: 0, scale: 1, bpm: C.defaultBreathsPerMinute, mode: 'cat', setupDone: false };

  function load(key, fallback) {
    try { const v = JSON.parse(localStorage.getItem(key)); return v == null ? fallback : v; }
    catch { return fallback; }
  }
  const S = { ...DEFAULTS, ...load(SETTINGS_KEY, {}) };
  function saveSettings() { try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(S)); } catch {} }

  // --------------------------------------------------------------------------
  //  Research log (localStorage)
  // --------------------------------------------------------------------------
  let log = load(LOG_KEY, []);
  let sessionId = '';

  function logEvent(event, extra = {}) {
    log.push({
      session: sessionId, event,
      method: extra.method || '',
      away_s: extra.away_s ?? '',
      t: Date.now(), mode: S.mode, bpm: S.bpm,
    });
    try { localStorage.setItem(LOG_KEY, JSON.stringify(log)); } catch {}
    updateLogCount();
  }

  function updateLogCount() { $('logCount').textContent = `${log.length} event${log.length === 1 ? '' : 's'} logged`; }

  function csvCell(v) {
    const s = String(v ?? '');
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  async function exportCSV() {
    const header = ['session_id', 'event', 'method', 'away_seconds', 'iso_time_utc', 'local_time', 'epoch_ms', 'mode', 'breaths_per_min'];
    const rows = log.map((r) => [r.session, r.event, r.method, r.away_s,
      new Date(r.t).toISOString(), new Date(r.t).toLocaleString(), r.t, r.mode, r.bpm]);
    const csv = [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n');
    const name = `catnap-log-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.csv`;
    const file = new File([csv], name, { type: 'text/csv' });

    // In an iOS home-screen app, downloads don't work well: use the share sheet.
    if (navigator.standalone && navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], title: name }); return; } catch {}
    }
    const url = URL.createObjectURL(file);
    const a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }

  // --------------------------------------------------------------------------
  //  Face position (calibration) and burn-in drift
  // --------------------------------------------------------------------------
  const calibEl = $('calib'), driftEl = $('drift'), breathEl = $('breath');

  function applyCalib() {
    calibEl.style.transform = `translate(-50%, -50%) translate(${S.x}px, ${S.y}px) scale(${S.scale})`;
    $('size').value = S.scale;
  }

  let driftTimer = null;
  function startDrift() {
    clearInterval(driftTimer);
    driftTimer = setInterval(() => {
      const m = C.driftMaxPx;
      driftEl.style.transform = `translate(${Math.round(rand(-m, m))}px, ${Math.round(rand(-m, m))}px)`;
    }, C.driftEvery);
  }
  function stopDrift() {
    clearInterval(driftTimer);
    driftEl.style.transition = 'none';
    driftEl.style.transform = '';
    void driftEl.offsetWidth;
    driftEl.style.transition = `transform ${C.driftTransition}ms linear`;
  }

  // --------------------------------------------------------------------------
  //  Cat animation building blocks (Web Animations API, no per-frame JS)
  // --------------------------------------------------------------------------
  const eyeOpenEls = [...document.querySelectorAll('.eye-open')];
  const eyeClosedEls = [...document.querySelectorAll('.eye-closed')];
  const headEl = $('head'), settleEl = $('settle'), mouthEl = $('mouth'), yawnEl = $('yawn');
  const earL = $('earL'), earR = $('earR'), whL = $('whL'), whR = $('whR');

  let eyeLevel = 0;      // 0 = closed, 1 = wide open
  let eyeAnims = [];
  // points: [[timeMs, openness], ...], first time must be 0
  function eyesTo(points, delay = 0) {
    const dur = points[points.length - 1][0] || 1;
    const vis = (v) => Math.min(1, v * 5);           // open eye fades in quickly once lids part
    const open = points.map(([t, v]) => ({ offset: t / dur, transform: `scaleY(${Math.max(v, 0.04).toFixed(3)})`, opacity: vis(v), easing: 'ease-in-out' }));
    const closed = points.map(([t, v]) => ({ offset: t / dur, opacity: 1 - vis(v), easing: 'ease-in-out' }));
    eyeAnims.forEach((a) => a.cancel());
    eyeAnims = [];
    const opts = { duration: dur, delay, fill: 'forwards' };
    eyeOpenEls.forEach((el) => eyeAnims.push(el.animate(open, opts)));
    eyeClosedEls.forEach((el) => eyeAnims.push(el.animate(closed, opts)));
    eyeLevel = points[points.length - 1][1];
  }

  function yawn(delay, dur, size = 1) {
    yawnEl.animate([
      { transform: 'scale(0)', easing: 'ease-out' },
      { transform: `scale(${size})`, offset: 0.35, easing: 'linear' },
      { transform: `scale(${size})`, offset: 0.6, easing: 'ease-in' },
      { transform: 'scale(0)' },
    ], { duration: dur, delay });
    headEl.animate([      // head lifts a little during the yawn
      { transform: 'translateY(0)', easing: 'ease-out' },
      { transform: 'translateY(-3px) rotate(-1deg)', offset: 0.4, easing: 'linear' },
      { transform: 'translateY(-3px) rotate(-1deg)', offset: 0.6, easing: 'ease-in-out' },
      { transform: 'translateY(0)' },
    ], { duration: dur, delay });
  }

  let settleAnim = null, settleY = 0;
  function settleTo(y, dur, delay = 0) {   // y > 0: head sinks slightly (curled up)
    const from = settleY;
    settleAnim?.cancel();
    settleAnim = settleEl.animate([
      { transform: `translateY(${from}px)` },
      { transform: `translateY(${y}px)` },
    ], { duration: dur, delay, fill: 'forwards', easing: 'ease-in-out' });
    settleY = y;
  }

  // ---- Falling asleep (~4 s): small yawn, slow blink, eyes close, settle ----
  function playFallAsleep() {
    const T = C.fallAsleepDuration / 4000;   // stretch all timings if the duration changes
    const t = (ms) => Math.round(ms * T);
    eyesTo([[0, eyeLevel], [t(400), 0.75], [t(650), 0.35], [t(1500), 0.35], [t(1800), 0.65],
            [t(2200), 0.6], [t(2600), 0.06], [t(2950), 0.45], [t(3250), 0.4], [t(3850), 0], [t(4000), 0]]);
    yawn(t(550), t(1150), 0.9);
    settleTo(4, t(1200), t(2800));
  }

  // ---- Waking (~1.5 s): eyes open slowly, small yawn, one slow blink ----
  function playWake() {
    const T = C.wakeDuration / 1500;
    const t = (ms) => Math.round(ms * T);
    settleTo(0, t(600));
    eyesTo([[0, eyeLevel], [t(450), 0.55], [t(560), 0.55], [t(700), 0.3], [t(1000), 0.3],
            [t(1120), 0.7], [t(1290), 0.08], [t(1500), 0.72]]);
    yawn(t(560), t(520), 0.6);
  }

  // ---- Relaxed slow blink while awake (a cat's friendly "I'm comfortable") ----
  function slowBlink() {
    eyesTo([[0, eyeLevel], [400, 0.05], [650, 0.05], [1150, 0.72]]);
  }

  // ---- Rare, subtle movements while sleeping ----
  const idleMoves = [
    { weight: 0.35, run() {                        // ear twitch (sometimes a double flick)
        const el = pick([earL, earR]);
        const dir = el === earL ? -1 : 1;
        const k = Math.random() < 0.35 ? [0, 9, -2, 0, 7, 0] : [0, 10, -2, 0];
        el.animate(k.map((v) => ({ transform: `rotate(${v * dir}deg)` })), { duration: k.length * 110, easing: 'ease-in-out' });
      } },
    { weight: 0.25, run() {                        // whisker flick
        const els = Math.random() < 0.5 ? [whL, whR] : [pick([whL, whR])];
        els.forEach((el) => {
          const d = el === whL ? 1 : -1;
          el.animate([0, 4, -1.5, 0].map((v) => ({ transform: `rotate(${v * d}deg)` })), { duration: 600, easing: 'ease-in-out' });
        });
      } },
    { weight: 0.2, run() {                         // tiny mouth movement, as if dreaming
        mouthEl.animate([
          { transform: 'translateY(0)' }, { transform: 'translateY(.8px) scaleY(1.08)' },
          { transform: 'translateY(0)' }, { transform: 'translateY(.6px) scaleY(1.05)' },
          { transform: 'translateY(0)' },
        ], { duration: rand(1400, 2200), easing: 'ease-in-out' });
      } },
    { weight: 0.2, run() {                         // slight head tilt, held a moment
        const a = rand(1.5, 3) * (Math.random() < 0.5 ? -1 : 1);
        headEl.animate([
          { transform: 'rotate(0deg)', easing: 'ease-in-out' },
          { transform: `rotate(${a}deg)`, offset: 0.3, easing: 'linear' },
          { transform: `rotate(${a}deg)`, offset: 0.7, easing: 'ease-in-out' },
          { transform: 'rotate(0deg)' },
        ], { duration: rand(4000, 7000) });
      } },
  ];

  let idleTimer = null;
  function scheduleIdle() {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      if (state === 'resting' && S.mode === 'cat' && !document.hidden) {
        let r = Math.random();
        for (const m of idleMoves) { if ((r -= m.weight) <= 0) { m.run(); break; } }
      }
      scheduleIdle();
    }, rand(C.idleMinGap, C.idleMaxGap));
  }
  function stopIdle() { clearTimeout(idleTimer); }

  let awakeBlinkTimer = null;
  function scheduleAwakeBlink() {
    clearTimeout(awakeBlinkTimer);
    awakeBlinkTimer = setTimeout(() => {
      if (state === 'awake' && S.mode === 'cat') { slowBlink(); scheduleAwakeBlink(); }
    }, rand(C.awakeBlinkMinGap, C.awakeBlinkMaxGap));
  }

  // --------------------------------------------------------------------------
  //  Breathing: one breath at a time, each slightly different
  // --------------------------------------------------------------------------
  let breathing = false, breathTimer = null, breathAnim = null;

  function nextBreath() {
    if (!breathing) return;
    let dur = (60000 / S.bpm) * (1 + rand(-C.breathLengthVariation, C.breathLengthVariation));
    let depth = C.breathDepth * (1 + rand(-C.breathDepthVariation, C.breathDepthVariation));
    if (Math.random() < C.deepBreathChance) { dur *= C.deepBreathLength; depth *= C.deepBreathDepth; }
    const inhale = Math.min(0.6, Math.max(0.25, C.inhaleShare * (1 + rand(-0.1, 0.1))));

    breathAnim = breathEl.animate([
      { transform: 'scale(1)', easing: 'ease-in-out' },
      { transform: `scale(${(1 + depth).toFixed(4)})`, offset: inhale, easing: 'ease-in-out' },
      { transform: 'scale(1)' },
    ], { duration: dur });
    breathAnim.onfinish = () => {
      const pause = Math.random() < C.pauseChance ? rand(C.pauseMin, C.pauseMax) : 0;
      breathTimer = setTimeout(nextBreath, pause);
    };
  }
  function startBreathing() {
    if (breathing || S.mode !== 'cat') return;
    breathing = true; nextBreath();
  }
  function stopBreathing() {
    breathing = false; clearTimeout(breathTimer);
    if (breathAnim) { breathAnim.onfinish = null; breathAnim.cancel(); }
  }

  // --------------------------------------------------------------------------
  //  Control mode clock (static, dim; only the digits change once a minute)
  // --------------------------------------------------------------------------
  let clockTimer = null;
  function updateClock() {
    const d = new Date();
    $('clock').textContent = String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
    clearTimeout(clockTimer);
    clockTimer = setTimeout(updateClock, 60000 - (Date.now() % 60000) + 50);
  }

  function applyMode() {
    document.body.classList.toggle('control', S.mode === 'control');
    $('modeCat').classList.toggle('on', S.mode === 'cat');
    $('modeControl').classList.toggle('on', S.mode === 'control');
    if (S.mode === 'cat') startBreathing(); else stopBreathing();
    updateClock();
  }

  // --------------------------------------------------------------------------
  //  Motion sensing
  // --------------------------------------------------------------------------
  const sensor = {
    active: false,     // true once readings arrive
    g: null,           // smoothed gravity direction
    base: null,        // gravity direction when resting in the dock
    tilt: 0, dev: 0, rot: 0,
    lastMoving: 0,     // last time the phone was not still
    moveStart: 0, lastMove: 0,   // for the "sustained movement" pick-up rule
  };

  function angleBetween(a, b) {
    const dot = a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    const m = Math.hypot(...a) * Math.hypot(...b) || 1;
    return Math.acos(Math.max(-1, Math.min(1, dot / m))) * 180 / Math.PI;
  }

  function onMotion(e) {
    const a = e.accelerationIncludingGravity;
    if (!a || a.x == null) return;
    sensor.active = true;
    const t = now();
    const raw = [a.x, a.y, a.z];
    sensor.dev = Math.abs(Math.hypot(...raw) - 9.81);           // shaking
    const r = e.rotationRate;
    sensor.rot = r ? Math.hypot(r.alpha || 0, r.beta || 0, r.gamma || 0) : 0;   // turning
    sensor.g = sensor.g ? sensor.g.map((v, i) => v + 0.15 * (raw[i] - v)) : raw;
    sensor.tilt = sensor.base ? angleBetween(sensor.g, sensor.base) : 0;   // tilt away from dock

    const tilted = sensor.tilt > C.liftTiltDegrees;
    if (tilted || sensor.dev > C.stillAccel || sensor.rot > C.stillRotationSpeed) sensor.lastMoving = t;

    // Pick-up: clear movement that lasts at least liftMinDuration (desk bumps are shorter)
    if (tilted || sensor.dev > C.liftShakeAccel || sensor.rot > C.liftRotationSpeed) {
      if (t - sensor.lastMove > C.liftGapTolerance) sensor.moveStart = t;
      sensor.lastMove = t;
      if (t - sensor.moveStart >= C.liftMinDuration) wake('motion');
    }

    // While resting still, follow very slow changes in the dock's angle
    if (state === 'resting' && sensor.base && t - sensor.lastMoving > 2000) {
      sensor.base = sensor.base.map((v, i) => v + 0.002 * (sensor.g[i] - v));
    }
  }

  let motionListening = false;
  async function enableMotion() {
    let perm = 'granted';
    if (typeof DeviceMotionEvent !== 'undefined' && typeof DeviceMotionEvent.requestPermission === 'function') {
      try { perm = await DeviceMotionEvent.requestPermission(); } catch { perm = 'denied'; }
    }
    if (perm === 'granted' && !motionListening && 'DeviceMotionEvent' in window) {
      window.addEventListener('devicemotion', onMotion);
      motionListening = true;
    }
    return perm;
  }

  // --------------------------------------------------------------------------
  //  Screen Wake Lock (keeps the screen on)
  // --------------------------------------------------------------------------
  let wakeLock = null;
  async function requestWakeLock() {
    if (!('wakeLock' in navigator)) return false;
    try { wakeLock = await navigator.wakeLock.request('screen'); return true; }
    catch { return false; }
  }

  // --------------------------------------------------------------------------
  //  Session state machine
  // --------------------------------------------------------------------------
  let state = 'setup';
  let inSession = false;
  let stateTimer = null, checkTimer = null;
  let pickupAt = 0, awakeSince = 0, lastTouch = -1e9, lastVisibleAt = 0;

  function fallAsleep() {
    state = 'falling';
    clearTimeout(stateTimer); clearTimeout(awakeBlinkTimer); stopIdle();
    if (S.mode === 'cat') playFallAsleep();
    stateTimer = setTimeout(() => {
      state = 'resting';
      if (!sensor.base && sensor.g) sensor.base = [...sensor.g];   // remember the dock position
      scheduleIdle();
    }, C.fallAsleepDuration);
  }

  function wake(method) {
    if (!inSession || (state !== 'resting' && state !== 'falling')) return;
    pickupAt = Date.now();
    logEvent('pickup', { method });
    state = 'waking';
    clearTimeout(stateTimer); stopIdle();
    if (S.mode === 'cat') playWake();
    stateTimer = setTimeout(() => {
      state = 'awake'; awakeSince = now();
      scheduleAwakeBlink();
    }, C.wakeDuration);
  }

  // Is the phone resting in the dock again?
  function readyToSleep() {
    const t = now();
    if (document.hidden) return false;
    if (t - lastTouch < C.touchQuietTime) return false;
    if (sensor.active) {
      const nearDock = !sensor.base || sensor.tilt < C.liftTiltDegrees;
      return nearDock && t - sensor.lastMoving > C.stillDuration;
    }
    // No motion sensor: fall back to "untouched for a while"
    return t - Math.max(lastTouch, lastVisibleAt, awakeSince) > C.noSensorQuietTime;
  }

  function checkPutBack() {
    if (state === 'awake' && readyToSleep()) {
      logEvent('putback', { away_s: ((Date.now() - pickupAt) / 1000).toFixed(1) });
      fallAsleep();
    }
  }

  async function startSession() {
    // 1. Motion permission (must come first: iOS needs it straight from the tap)
    const perm = await enableMotion();
    // 2. Full screen + portrait lock where supported (Android)
    try {
      if (document.documentElement.requestFullscreen && !document.fullscreenElement) {
        await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
      }
    } catch {}
    try { await screen.orientation?.lock?.('portrait'); } catch {}
    // 3. Keep the screen on
    const locked = await requestWakeLock();

    S.setupDone = true; saveSettings();
    const d = new Date();
    sessionId = 'S' + d.toISOString().slice(0, 19).replace(/[-:T]/g, '');
    inSession = true;
    logEvent('session_start', { method: `sensors:${perm}; wakelock:${locked ? 'on' : 'unavailable'}` });

    $('setup').style.display = 'none';
    $('resume').style.display = 'none';
    sensor.base = null; sensor.lastMoving = now();
    lastTouch = -1e9; lastVisibleAt = now();
    applyMode();
    startDrift();
    fallAsleep();
    clearInterval(checkTimer);
    checkTimer = setInterval(checkPutBack, 250);

    $('sensorStatus').textContent = `Motion sensors: ${perm}. Wake lock: ${locked ? 'on' : 'not available (set Auto-Lock to Never)'}.`;
  }

  function endSession(method) {
    if (!inSession) return;
    logEvent('session_end', { method });
    inSession = false;
    clearInterval(checkTimer); clearTimeout(stateTimer); clearTimeout(awakeBlinkTimer); stopIdle();
  }

  function openSetup() {
    endSession('setup_opened');
    state = 'setup';
    stopDrift();
    $('resume').style.display = 'none';
    $('setup').style.display = 'block';
    $('setup').classList.remove('collapsed');
    $('collapse').textContent = 'Hide panel';
    if (S.mode === 'cat') { eyesTo([[0, eyeLevel], [600, 0]]); settleTo(4, 600); }
    applyMode();
    startSensorReadout();
  }

  function showResume() {
    state = 'resume';
    $('setup').style.display = 'none';
    $('resume').style.display = 'flex';
  }

  // --------------------------------------------------------------------------
  //  Page visibility: leaving the page / switching apps counts as a pick-up
  // --------------------------------------------------------------------------
  document.addEventListener('visibilitychange', () => {
    if (!inSession) return;
    if (document.hidden) {
      wake('visibility');
    } else {
      lastVisibleAt = now();
      requestWakeLock();          // the lock is released whenever the page is hidden
    }
  });
  window.addEventListener('pagehide', (e) => { if (!e.persisted) endSession('page_closed'); });

  // --------------------------------------------------------------------------
  //  Touches on the resting screen
  // --------------------------------------------------------------------------
  const stage = $('stage');
  let cornerTaps = [];

  stage.addEventListener('pointerdown', (e) => {
    if (state === 'setup') return onSetupPointerDown(e);
    if (state === 'resume') return;

    // Hidden corner: quick taps in the top-left open the setup panel
    if (e.clientX < C.cornerSize && e.clientY < C.cornerSize) {
      const t = now();
      cornerTaps = cornerTaps.filter((x) => t - x < C.cornerTapWindow);
      cornerTaps.push(t);
      if (cornerTaps.length >= C.cornerTaps) { cornerTaps = []; openSetup(); }
      return;
    }
    lastTouch = now();
    wake('touch');
  });

  $('resume').addEventListener('click', (e) => {
    if (e.target.id === 'openSetup') return openSetup();
    startSession();
  });

  // --------------------------------------------------------------------------
  //  Setup: drag / pinch / wheel to place and size the face
  // --------------------------------------------------------------------------
  const pointers = new Map();
  let gesture = null;

  function beginGesture() {
    const pts = [...pointers.values()];
    if (!pts.length) { gesture = null; return; }
    const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
    const cy = pts.reduce((s, p) => s + p.y, 0) / pts.length;
    const dist = pts.length > 1 ? Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) : 0;
    gesture = { cx, cy, dist, x: S.x, y: S.y, scale: S.scale };
  }
  function onSetupPointerDown(e) {
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    try { stage.setPointerCapture(e.pointerId); } catch {}
    beginGesture();
  }
  stage.addEventListener('pointermove', (e) => {
    if (state !== 'setup' || !pointers.has(e.pointerId) || !gesture) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const pts = [...pointers.values()];
    const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
    const cy = pts.reduce((s, p) => s + p.y, 0) / pts.length;
    S.x = Math.round(gesture.x + cx - gesture.cx);
    S.y = Math.round(gesture.y + cy - gesture.cy);
    if (pts.length > 1 && gesture.dist > 0) {
      const d = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      S.scale = Math.min(3, Math.max(0.3, gesture.scale * d / gesture.dist));
    }
    applyCalib();
  });
  const endPointer = (e) => {
    if (!pointers.delete(e.pointerId)) return;
    beginGesture();
    saveSettings();
  };
  stage.addEventListener('pointerup', endPointer);
  stage.addEventListener('pointercancel', endPointer);
  stage.addEventListener('wheel', (e) => {
    if (state !== 'setup') return;
    e.preventDefault();
    S.scale = Math.min(3, Math.max(0.3, S.scale * Math.exp(-e.deltaY * 0.001)));
    applyCalib(); saveSettings();
  }, { passive: false });

  // --------------------------------------------------------------------------
  //  Setup panel controls
  // --------------------------------------------------------------------------
  $('size').addEventListener('input', (e) => { S.scale = +e.target.value; applyCalib(); saveSettings(); });
  $('resetPos').addEventListener('click', () => { S.x = 0; S.y = 0; S.scale = 1; applyCalib(); saveSettings(); });

  function setBpm(v) {
    v = Math.round(Math.min(60, Math.max(6, +v || C.defaultBreathsPerMinute)));
    S.bpm = v; $('bpm').value = v; $('bpmRange').value = v; saveSettings();
  }
  $('bpmRange').addEventListener('input', (e) => setBpm(e.target.value));
  $('bpm').addEventListener('change', (e) => setBpm(e.target.value));

  $('modeCat').addEventListener('click', () => { S.mode = 'cat'; saveSettings(); applyMode(); });
  $('modeControl').addEventListener('click', () => { S.mode = 'control'; saveSettings(); applyMode(); });

  $('collapse').addEventListener('click', () => {
    const c = $('setup').classList.toggle('collapsed');
    $('collapse').textContent = c ? 'Show panel' : 'Hide panel';
  });
  $('start').addEventListener('click', startSession);
  $('export').addEventListener('click', exportCSV);
  $('clear').addEventListener('click', () => {
    if (!confirm(`Delete all ${log.length} logged events from this phone? This cannot be undone. Export first if you need them.`)) return;
    log = [];
    try { localStorage.removeItem(LOG_KEY); } catch {}
    updateLogCount();
  });

  // Live sensor readout on the setup panel (helps when tuning thresholds)
  let readoutTimer = null;
  function startSensorReadout() {
    clearInterval(readoutTimer);
    readoutTimer = setInterval(() => {
      if (state !== 'setup') return clearInterval(readoutTimer);
      if (!sensor.active) return;
      $('sensorStatus').textContent =
        `tilt ${sensor.tilt.toFixed(1)}°  shake ${sensor.dev.toFixed(2)} m/s²  turn ${sensor.rot.toFixed(0)}°/s`;
    }, 300);
  }

  // --------------------------------------------------------------------------
  //  Start-up
  // --------------------------------------------------------------------------
  setBpm(S.bpm);
  applyCalib();
  applyMode();
  updateLogCount();
  settleTo(4, 1);
  if (S.setupDone) showResume(); else openSetup();

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
  }
})();
