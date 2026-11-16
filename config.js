// ============================================================================
//  CatNap: SETTINGS YOU CAN CHANGE
//  ---------------------------------------------------------------------------
//  Edit a value, save this file, and reload the page.
//  Times are in milliseconds: 1000 = 1 second, 60000 = 1 minute.
//  (Breathing rate, face position and size, and Cat/Control mode are set on
//   the setup screen instead, and are remembered on the phone.)
// ============================================================================
window.CATNAP_CONFIG = {

  // ---------- Breathing ----------------------------------------------------
  defaultBreathsPerMinute: 22,  // starting value on the setup screen
  breathDepth: 0.012,           // how much the face grows when breathing in (0.012 = 1.2%)
  breathDepthVariation: 0.15,   // each breath is up to 15% shallower or deeper
  breathLengthVariation: 0.10,  // each breath is up to 10% shorter or longer
  inhaleShare: 0.42,            // part of each breath spent breathing in (the rest is breathing out)
  deepBreathChance: 0.07,       // chance (0-1) that a breath is a deeper, slower sigh
  deepBreathDepth: 1.8,         //   ...how much deeper (x)
  deepBreathLength: 1.5,        //   ...how much longer (x)
  pauseChance: 0.06,            // chance of a short pause after a breath
  pauseMin: 500,                //   shortest pause
  pauseMax: 1500,               //   longest pause

  // ---------- Small movements while sleeping ---------------------------------
  // Ear twitch, whisker flick, dreaming mouth or slight head tilt.
  // One happens at a random moment between these two gaps.
  idleMinGap: 20000,            // 20 seconds
  idleMaxGap: 180000,           // 3 minutes

  // ---------- Animation timing ----------------------------------------------
  fallAsleepDuration: 4000,     // yawn, slow blink, eyes close, settle
  wakeDuration: 1500,           // eyes open slowly, small yawn, one slow blink
  awakeBlinkMinGap: 5000,       // while awake, a relaxed slow blink every...
  awakeBlinkMaxGap: 12000,      //   ...5-12 seconds

  // ---------- Burn-in protection ---------------------------------------------
  driftEvery: 240000,           // move the picture every 4 minutes
  driftMaxPx: 2,                //   by at most 2 pixels in any direction
  driftTransition: 30000,       //   slowly, over 30 seconds (so it can't be seen)

  // ---------- Colours (kept very dark on purpose) ----------------------------
  colors: {
    background:  '#000000',
    fur:         '#221e1b',
    furEdge:     '#2e2824',
    earInside:   '#2d2224',
    line:        '#4a4038',   // closed eyes, mouth, whiskers
    nose:        '#45302f',
    eye:         '#2c3628',   // open eye colour
    pupil:       '#0a0a0a',
    eyeShine:    '#4a4a42',
    mouthInside: '#140c0d',
    clock:       '#2b2b2b',   // Control mode clock
  },
  faceOpacity: 1,               // lower (e.g. 0.7) to make everything dimmer

  // ---------- Pick-up / put-back detection -----------------------------------
  // The phone counts as PICKED UP when it keeps moving or stays tilted for at
  // least liftMinDuration. Short desk bumps are ignored.
  liftTiltDegrees: 20,          // tilted more than this away from its dock position
  liftShakeAccel: 1.2,          // or shaking more than this (m/s²)
  liftRotationSpeed: 30,        // or turning faster than this (degrees per second)
  liftMinDuration: 1000,        // movement must last at least this long
  liftGapTolerance: 300,        // short dropouts in the movement still count as continuous

  // The phone counts as PUT BACK when it is near its dock position and still.
  stillAccel: 0.4,              // shaking below this (m/s²)
  stillRotationSpeed: 6,        // turning slower than this (degrees per second)
  stillDuration: 1200,          // for at least this long

  touchQuietTime: 4000,         // after a screen touch, wait this long with no touches before sleeping again
  noSensorQuietTime: 10000,     // if motion sensors are unavailable: fall asleep after this long untouched

  // ---------- Hidden way back to the setup screen -----------------------------
  cornerSize: 70,               // size of the top-left corner zone (pixels)
  cornerTaps: 3,                // number of quick taps needed
  cornerTapWindow: 1500,        // ...within this time
};
