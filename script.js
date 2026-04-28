// Neon Slugger Deluxe
// Main architecture:
// 1) Configurable teams/players/attributes
// 2) Stateful inning + batting/fielding rules
// 3) Input handling for batting, pitching, and fielding controls
// 4) Isometric arcade rendering on Canvas
// Field tuning constants (edit these to quickly rebalance layout/scale):
// - FIELD_SCALE controls camera zoom and overall field size.
// - BASE_SPACING_X / BASE_SPACING_Y control base spacing.
// - MOUND_OFFSET_X / MOUND_OFFSET_Y set mound position relative to home->second line.
// - MOUND_RADIUS_X / MOUND_RADIUS_Y control mound size.

const canvas = document.getElementById("gameCanvas");
const ctx = canvas.getContext("2d");

const startScreen = document.getElementById("startScreen");
const gameOverScreen = document.getElementById("gameOverScreen");
const startButton = document.getElementById("startButton");
const restartButton = document.getElementById("restartButton");
const teamSelectA = document.getElementById("teamSelectA");
const teamSelectB = document.getElementById("teamSelectB");
const messageBar = document.getElementById("messageBar");

const inningValue = document.getElementById("inningValue");
const halfValue = document.getElementById("halfValue");
const ballsValue = document.getElementById("ballsValue");
const strikesValue = document.getElementById("strikesValue");
const outsValue = document.getElementById("outsValue");
const awayTeamName = document.getElementById("awayTeamName");
const homeTeamName = document.getElementById("homeTeamName");
const awayScoreValue = document.getElementById("awayScoreValue");
const homeScoreValue = document.getElementById("homeScoreValue");
const finalScoreText = document.getElementById("finalScoreText");

// Centralized render geometry. Every field/actor draw uses this system.
const FIELD_LAYOUT_RATIOS = {
  // Bigger, deeper isometric playfield so pitcher/fielders are not cramped.
  homeY: 0.89,
  secondY: 0.22,
  baseSpread: 0.33,
  hudHeight: 70,
  bottomBarHeight: 60
};

const FIELD_DEPTH_TUNING = {
  moundDepthRatio: 0.64
};

// Controls "time between pitches" so at-bats are not rapid fire.
const PITCH_DELAY_TUNING = {
  initial: 1.25,
  resetMin: 1.1,
  resetRange: 0.85,
  afterPlayMin: 1.3,
  afterPlayRange: 0.9,
  sideSwitch: 1.35
};

// Arcade-but-believable batted-ball physics tuning.
const HIT_PHYSICS_TUNING = {
  timingWindowPx: 78,
  contactWindowPx: 56,
  minExitVelocity: 320,
  maxExitVelocity: 1120,
  launchAngles: {
    grounder: { min: -10, max: 9 },
    line: { min: 12, max: 32 },
    fly: { min: 30, max: 52 },
    pop: { min: 52, max: 68 }
  },
  gravity: 1750,
  airDrag: 0.16,
  groundFriction: 0.86
};

const BALL_VISUAL_TUNING = {
  pitchRadius: 9,
  battedRadius: 9,
  pitchTrailMax: 10,
  battedTrailMax: 8
};

const PITCH_TUNING = {
  speedMin: 255,
  speedMax: 345,
  curveStrength: 80
};

const CAMERA_TUNING = {
  battingDamping: 0.12,
  pitchingDamping: 0.13,
  fieldingDamping: 0.14,
  homerDamping: 0.15,
  maxX: 280,
  maxYTop: -300,
  maxYBottom: 90
};

const PITCH_TYPE_CONFIG = {
  fastball: {
    key: "1",
    label: "FASTBALL",
    durationMs: 1040,
    curveScale: 0.15,
    drop: -4,
    speedBoost: 1
  },
  changeup: {
    key: "2",
    label: "CHANGEUP",
    durationMs: 1260,
    curveScale: 0.25,
    drop: 22,
    speedBoost: 0.82
  },
  curveball: {
    key: "3",
    label: "CURVEBALL",
    durationMs: 1175,
    curveScale: 1,
    drop: 16,
    speedBoost: 0.9
  },
  slider: {
    key: "4",
    label: "SLIDER",
    durationMs: 1110,
    curveScale: 1.35,
    drop: 9,
    speedBoost: 0.95
  }
};

const PITCH_TYPE_BY_KEY = Object.fromEntries(
  Object.entries(PITCH_TYPE_CONFIG).map(([name, cfg]) => [cfg.key, name])
);

const TIMING_FEEDBACK_ORDER = ["VERY EARLY", "EARLY", "GOOD", "PERFECT", "LATE", "VERY LATE", "MISS"];

const FIELDING_AI_TUNING = {
  gravity: 920,
  grounderFriction: 0.89,
  flyFriction: 0.93,
  pickupRadius: 18,
  airCatchRadius: 22,
  throwDelay: 0.6
};

const DEBUG = false;
const DEBUG_FIELDING = false;
const DEBUG_INPUT = false;
const PITCH_DURATION_MS = 1150;
const PITCH_DURATION_RANGE_MS = { min: 1000, max: 1300 };
const PITCH_MAX_VELOCITY = 980;
const SWING_BUFFER_WINDOW = 0.2;
const SWING_ASSIST_CONTACT_RADIUS = 88;

const FIELDING_SPEED_RANGES = {
  pitcher: [120, 150],
  catcher: [120, 150],
  first: [130, 170],
  second: [130, 170],
  shortstop: [130, 170],
  third: [130, 170],
  left: [180, 230],
  center: [180, 230],
  right: [180, 230]
};

const DEBUG_STATE = {
  enabled: DEBUG || DEBUG_FIELDING,
  lastConsoleLog: 0,
  consoleInterval: 0.75
};

function scaleByY(y) {
  const fieldTop = RENDER_LAYOUT.fieldRect.top;
  const fieldBottom = RENDER_LAYOUT.fieldRect.bottom;
  const minScale = 0.65;
  const maxScale = 1.25;
  const t = clampValue((y - fieldTop) / Math.max(1, fieldBottom - fieldTop), 0, 1);
  return minScale + t * (maxScale - minScale);
}

function worldToScreen(x, y, z = 0) {
  return {
    x,
    y: y - z
  };
}

function clampValue(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

const clamp = clampValue;

function lerp(a, b, t) {
  return a + (b - a) * clampValue(t, 0, 1);
}

function dampLerp(current, target, damping, dt) {
  const safeDamping = clampValue(damping, 0.001, 0.999);
  const blend = 1 - Math.pow(1 - safeDamping, dt * 60);
  return current + (target - current) * blend;
}

function normalizeInRange(value, min, max) {
  if (max <= min) return 0;
  return clampValue((value - min) / (max - min), 0, 1);
}

function degreesToRadians(deg) {
  return deg * (Math.PI / 180);
}

const degToRad = degreesToRadians;

function randomRange(min, max) {
  return min + Math.random() * (max - min);
}

function normalizeVector(x, y) {
  const len = Math.hypot(x, y) || 1;
  return { x: x / len, y: y / len };
}

const normalize2D = normalizeVector;

function buildFieldLayout(width, height) {
  const layout = {
    centerX: width / 2,
    homeY: height * FIELD_LAYOUT_RATIOS.homeY,
    secondY: height * FIELD_LAYOUT_RATIOS.secondY,
    baseSpread: width * FIELD_LAYOUT_RATIOS.baseSpread,
    hudHeight: FIELD_LAYOUT_RATIOS.hudHeight,
    bottomBarHeight: FIELD_LAYOUT_RATIOS.bottomBarHeight
  };
  const midY = (layout.homeY + layout.secondY) / 2;
  const bases = {
    home: { x: layout.centerX, y: layout.homeY },
    first: { x: layout.centerX + layout.baseSpread, y: midY },
    second: { x: layout.centerX, y: layout.secondY },
    third: { x: layout.centerX - layout.baseSpread, y: midY },
    mound: {
      x: layout.centerX,
      y: layout.homeY - (layout.homeY - layout.secondY) * FIELD_DEPTH_TUNING.moundDepthRatio
    }
  };
  const toFirst = normalizeVector(bases.first.x - bases.home.x, bases.first.y - bases.home.y);
  const toThird = normalizeVector(bases.third.x - bases.home.x, bases.third.y - bases.home.y);
  const foulLength = Math.max(width, height) * 0.92;
  return {
    layout,
    bases,
    foulRight: { x: bases.home.x + toFirst.x * foulLength, y: bases.home.y + toFirst.y * foulLength },
    foulLeft: { x: bases.home.x + toThird.x * foulLength, y: bases.home.y + toThird.y * foulLength },
    fieldRect: {
      left: 18,
      right: width - 18,
      top: layout.hudHeight + 6,
      bottom: height - layout.bottomBarHeight + 14
    }
  };
}

let RENDER_LAYOUT = buildFieldLayout(canvas.width, canvas.height);
const COORD_WARNINGS = new Set();
const BALL_WARNINGS = new Set();

function safePoint(point, key, fallback) {
  if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) {
    if (!COORD_WARNINGS.has(key)) {
      console.warn(`[layout-warning] Missing coordinate for ${key}, using fallback.`);
      COORD_WARNINGS.add(key);
    }
    return fallback;
  }
  return point;
}

const FIELD = {
  home: { ...RENDER_LAYOUT.bases.home },
  first: { ...RENDER_LAYOUT.bases.first },
  second: { ...RENDER_LAYOUT.bases.second },
  third: { ...RENDER_LAYOUT.bases.third },
  mound: { ...RENDER_LAYOUT.bases.mound },
  foulTop: { ...RENDER_LAYOUT.foulLeft },
  foulBottom: { ...RENDER_LAYOUT.foulRight }
};

function syncRenderLayout() {
  RENDER_LAYOUT = buildFieldLayout(GAME.width, GAME.height);
  FIELD.home = { ...RENDER_LAYOUT.bases.home };
  FIELD.first = { ...RENDER_LAYOUT.bases.first };
  FIELD.second = { ...RENDER_LAYOUT.bases.second };
  FIELD.third = { ...RENDER_LAYOUT.bases.third };
  FIELD.mound = { ...RENDER_LAYOUT.bases.mound };
  FIELD.foulTop = { ...RENDER_LAYOUT.foulLeft };
  FIELD.foulBottom = { ...RENDER_LAYOUT.foulRight };

  // Keep batter to the side of the strike zone/home-plate channel.
  batter.x = FIELD.home.x + 64;
  batter.y = FIELD.home.y - 58;
  pitcher.x = FIELD.mound.x - 10;
  pitcher.y = FIELD.mound.y - 54;
  const zoneWidth = 70;
  const zoneHeight = 90;
  const zoneX = FIELD.home.x - 35;
  const zoneY = FIELD.home.y - 110;
  GAME.strikeZone = {
    x: zoneX,
    y: zoneY,
    w: zoneWidth,
    h: zoneHeight,
    cx: zoneX + zoneWidth / 2,
    cy: zoneY + zoneHeight / 2
  };
  if (!pitchBall.active) {
    pitchBall.x = pitcher.x + 14;
    pitchBall.y = pitcher.y + 16;
    pitchBall.targetX = GAME.strikeZone.cx;
    pitchBall.targetY = GAME.strikeZone.cy;
    pitchBall.catcherX = FIELD.home.x - 2;
    pitchBall.catcherY = FIELD.home.y + 8;
  }
}

function getStrikeZoneBounds() {
  if (GAME.strikeZone) return GAME.strikeZone;
  return {
    x: FIELD.home.x - 35,
    y: FIELD.home.y - 110,
    w: 70,
    h: 90,
    cx: FIELD.home.x,
    cy: FIELD.home.y - 65
  };
}

const BASE_KEYS = ["home", "first", "second", "third"];

const INPUT_ACTION_MAP = {
  moveUp: ["w", "ArrowUp"],
  moveDown: ["s", "ArrowDown"],
  moveLeft: ["a", "ArrowLeft"],
  moveRight: ["d", "ArrowRight"],
  swing: ["Space"],
  powerSwing: ["Shift"],
  pitchThrow: ["Space"],
  throwFirst: ["q"],
  throwSecond: ["f"],
  throwThird: ["e"],
  throwHome: ["r"],
  catchDive: ["Space"]
};

const CONTROL_PRESETS = {
  player1: { ...INPUT_ACTION_MAP },
  player2: { ...INPUT_ACTION_MAP }
};

const ACTIVE_ROLE_ACTIONS = {
  batter: ["moveUp", "moveDown", "moveLeft", "moveRight", "swing", "powerSwing"],
  pitcher: ["moveUp", "moveDown", "moveLeft", "moveRight", "pitchThrow"],
  fielder: [
    "moveUp",
    "moveDown",
    "moveLeft",
    "moveRight",
    "catchDive",
    "throwFirst",
    "throwSecond",
    "throwThird",
    "throwHome"
  ],
  none: []
};

const TEAMS = [
  {
    id: "comets",
    name: "Comets",
    colors: { jersey: "#3d69ff", cap: "#1e3eaa", trim: "#8eb5ff" },
    players: {
      power: 74,
      contact: 76,
      speed: 70,
      fielding: 68,
      pitching: 72
    }
  },
  {
    id: "foxes",
    name: "Foxes",
    colors: { jersey: "#f26a3f", cap: "#8f2e18", trim: "#ffc3a8" },
    players: {
      power: 79,
      contact: 70,
      speed: 66,
      fielding: 74,
      pitching: 75
    }
  },
  {
    id: "orbitals",
    name: "Orbitals",
    colors: { jersey: "#8f53dd", cap: "#4f2e8f", trim: "#d2b6ff" },
    players: {
      power: 68,
      contact: 82,
      speed: 77,
      fielding: 80,
      pitching: 66
    }
  }
];

const GAME = {
  width: canvas.width,
  height: canvas.height,
  mode: "start", // start | play | over
  inning: 1,
  half: "top", // top or bottom
  balls: 0,
  strikes: 0,
  outs: 0,
  scores: { away: 0, home: 0 },
  teams: { away: TEAMS[0], home: TEAMS[1] },
  battingSide: "away",
  fieldingSide: "home",
  phase: "pitch_setup", // pitch_setup | pitch_flight | ball_in_play | throw_resolve
  runners: [false, false, false], // first, second, third
  pitchReady: false,
  pitchTimer: 0,
  nextPitchDelay: 0.75,
  pitchAim: 0,
  pitchAimY: 0,
  swingAim: 0,
  controlledFielder: 1,
  controlledRole: "batter",
  cameraShake: 0,
  cameraMode: "batting",
  particles: [],
  battedBall: null,
  pendingPlay: null,
  throwBall: null,
  flashTime: 0,
  swingBuffer: 0,
  lastContactOffset: 0,
  playCallout: null,
  swingFeedback: "",
  swingFeedbackLife: 0,
  localMultiplayer: true,
  selectedPitchType: "fastball",
  pitchCharge: {
    active: false,
    elapsed: 0,
    meter: 0,
    quality: 0,
    owner: "player1"
  },
  timingMeter: {
    active: false,
    progress: 0,
    verdict: "",
    quality: 0,
    life: 0
  },
  strikeZone: null,
  cameraX: 0,
  cameraY: 0,
  cameraTargetX: 0,
  cameraTargetY: 0,
  debugInfo: {
    pitchTarget: "-",
    strikeZone: "-",
    ball: "-",
    ballHeight: "-",
    ballState: "idle",
    pitchActive: "false",
    swingActive: "false",
    hitDetected: "false",
    hitType: "-",
    pitchType: "FASTBALL",
    pitchCharge: "0.00",
    assignedFielder: "-",
    backupFielder: "-",
    fielderTarget: "-",
    hitZone: "-",
    landingPoint: "-",
    wallLine: "-",
    pitchDuration: "-"
  }
};

const batter = {
  x: FIELD.home.x - 58,
  y: FIELD.home.y - 40,
  swingTime: 0,
  swingDuration: 0.22,
  activeSwing: false,
  batColor: "#f4e2b2"
};

const pitcher = {
  x: FIELD.mound.x - 12,
  y: FIELD.mound.y - 44,
  windup: 0
};

const pitchBall = {
  active: false,
  visible: false,
  state: "idle",
  swingAttempted: false,
  crossedZone: false,
  pendingCall: null,
  x: pitcher.x + 16,
  y: pitcher.y + 18,
  startX: pitcher.x + 16,
  startY: pitcher.y + 18,
  controlX: pitcher.x + 16,
  controlY: pitcher.y + 18,
  vx: 0,
  vy: 0,
  curve: 0,
  judged: false,
  targetX: pitcher.x + 16,
  targetY: pitcher.y + 18,
  plateX: pitcher.x + 16,
  plateY: pitcher.y + 18,
  catcherX: FIELD.home.x - 2,
  catcherY: FIELD.home.y + 8,
  elapsed: 0,
  travelTime: 0.55,
  pitchDurationMs: PITCH_DURATION_MS,
  pitchProgress: 0,
  height: 0,
  shadowY: pitcher.y + 18,
  trail: [],
  trailClock: 0
};

const input = {
  keys: new Set(),
  justPressed: new Set(),
  justReleased: new Set()
};

const defensiveFielders = [];

function normalizeInputKey(event) {
  return event.code === "Space"
    ? "Space"
    : (event.key.length === 1 ? event.key.toLowerCase() : event.key);
}

function isActionHeld(controller, action) {
  if (!actionAllowedForRole(GAME.controlledRole, action)) return false;
  const preset = CONTROL_PRESETS[controller] ?? CONTROL_PRESETS.player1;
  const keys = preset[action] ?? [];
  return keys.some((key) => input.keys.has(key));
}

function wasActionPressed(controller, action) {
  if (!actionAllowedForRole(GAME.controlledRole, action)) return false;
  const preset = CONTROL_PRESETS[controller] ?? CONTROL_PRESETS.player1;
  const keys = preset[action] ?? [];
  return keys.some((key) => input.justPressed.has(key));
}

function wasActionReleased(controller, action) {
  if (!actionAllowedForRole(GAME.controlledRole, action)) return false;
  const preset = CONTROL_PRESETS[controller] ?? CONTROL_PRESETS.player1;
  const keys = preset[action] ?? [];
  return keys.some((key) => input.justReleased.has(key));
}

function clearInputFrame() {
  input.justPressed.clear();
  input.justReleased.clear();
}

function getControllerForSide(side) {
  return "player1";
}

function getBattingController() {
  return getControllerForSide(GAME.battingSide);
}

function getFieldingController() {
  return getControllerForSide(GAME.fieldingSide);
}

function getEffectiveControllerForRole(role) {
  if (role === "batter") return getBattingController();
  if (role === "pitcher" || role === "fielder") return getFieldingController();
  return "player1";
}

function actionAllowedForRole(role, action) {
  const allow = ACTIVE_ROLE_ACTIONS[role] ?? ACTIVE_ROLE_ACTIONS.none;
  return allow.includes(action);
}

function determineActiveInputRole() {
  if (GAME.mode !== "play") return "none";
  if (GAME.battedBall) return "fielder";
  if (pitchBall.active) return "batter";
  return "pitcher";
}

function logInputEvent(action, details = "") {
  if (!DEBUG_INPUT) return;
  const state = `${GAME.mode}/${GAME.phase}`;
  if (details) {
    console.log(`[INPUT] ${action} in state: ${state} (${details})`);
  } else {
    console.log(`[INPUT] ${action} in state: ${state}`);
  }
}

function updateControlledRole() {
  GAME.controlledRole = determineActiveInputRole();
}

const GameManager = {
  setPhase(phase, cameraMode = null) {
    GAME.phase = phase;
    if (cameraMode) GAME.cameraMode = cameraMode;
  },
  syncControllerRoles() {
    updateControlledRole();
  }
};

const InputManager = {
  clearFrame() {
    clearInputFrame();
  }
};

const CameraController = {
  update(dt) {
    updateCamera(dt);
  }
};

const PitchingController = {
  update(dt) {
    updatePitchController(dt);
  }
};

const BattingController = {
  update(dt) {
    updateBattingController(dt);
  }
};

const BallPhysics = {
  update(dt) {
    updateBattedBall(dt);
    updateThrowBall(dt);
  }
};

const FieldingController = {
  update(dt) {
    updateFieldingInput(dt);
    updateFielders(dt);
  }
};

const RunnerManager = {
  primePendingRunnerTimes(hitType) {
    const speed = teamRating(GAME.teams[GAME.battingSide], "speed");
    const groundPenalty = hitType === "grounder" ? 0.16 : 0;
    const baseTime = 3.05 - speed * 0.5 + groundPenalty;
    return {
      first: clampValue(baseTime, 2.45, 3.45),
      second: clampValue(baseTime + 2.55, 4.85, 6.1),
      third: clampValue(baseTime + 5.25, 7.4, 8.9)
    };
  }
};

const ScoreboardManager = {
  refresh() {
    updateHud();
  }
};

const MultiplayerManager = {
  mode: "local",
  networkHooks: {
    // Hook these methods into WebSocket/WebRTC transport in online mode.
    sendInput: null,
    onRemoteInput: null,
    onStateSnapshot: null
  }
};

const UIManager = {
  setMessage(text) {
    setMessage(text);
  }
};

function buildSelectOptions() {
  if (!teamSelectA || !teamSelectB) return;

  teamSelectA.innerHTML = "";
  teamSelectB.innerHTML = "";

  TEAMS.forEach((team, index) => {
    const optionA = document.createElement("option");
    optionA.value = team.id;
    optionA.textContent = team.name;
    if (index === 0) optionA.selected = true;
    teamSelectA.append(optionA);

    const optionB = document.createElement("option");
    optionB.value = team.id;
    optionB.textContent = team.name;
    if (index === 1) optionB.selected = true;
    teamSelectB.append(optionB);
  });
}

function teamById(teamId) {
  return TEAMS.find((team) => team.id === teamId) ?? TEAMS[0];
}

function teamRating(team, key) {
  return team.players[key] / 100;
}

function configureTeams() {
  const away = teamById(teamSelectA.value);
  let home = teamById(teamSelectB.value);
  if (away.id === home.id) {
    home = TEAMS.find((team) => team.id !== away.id) ?? TEAMS[1];
  }
  GAME.teams.away = away;
  GAME.teams.home = home;
}

function setMessage(text) {
  messageBar.textContent = text;
}

function setSwingFeedback(text, quality = 0) {
  GAME.swingFeedback = text;
  GAME.swingFeedbackLife = 1.0;
  GAME.timingMeter.verdict = text;
  GAME.timingMeter.quality = quality;
  GAME.timingMeter.life = 1.0;
}

function getPitchAimInputs(controller) {
  const moveLeft = isActionHeld(controller, "moveLeft");
  const moveRight = isActionHeld(controller, "moveRight");
  const moveUp = isActionHeld(controller, "moveUp");
  const moveDown = isActionHeld(controller, "moveDown");
  const x = (moveRight ? 1 : 0) - (moveLeft ? 1 : 0);
  const y = (moveDown ? 1 : 0) - (moveUp ? 1 : 0);
  return { x, y };
}

function selectPitchTypeByKey(key) {
  const selected = PITCH_TYPE_BY_KEY[key];
  if (!selected) return;
  GAME.selectedPitchType = selected;
  GAME.debugInfo.pitchType = PITCH_TYPE_CONFIG[selected].label;
  logInputEvent("Pitch type selected", PITCH_TYPE_CONFIG[selected].label);
}

function nearestBaseKeyFromFielder(fielder) {
  if (!fielder) return "first";
  const bases = {
    home: FIELD.home,
    first: FIELD.first,
    second: FIELD.second,
    third: FIELD.third
  };
  let best = "first";
  let bestDist = Number.POSITIVE_INFINITY;
  BASE_KEYS.forEach((key) => {
    const base = bases[key];
    const dist = Math.hypot(fielder.x - base.x, fielder.y - base.y);
    if (dist < bestDist) {
      bestDist = dist;
      best = key;
    }
  });
  return best;
}

function computePitchChargeQuality(meter) {
  const perfectDist = Math.abs(meter - 0.52);
  if (perfectDist <= 0.05) return 1;
  if (perfectDist <= 0.12) return 0.76;
  if (perfectDist <= 0.2) return 0.52;
  return 0.3;
}

function startPitchCharge() {
  if (!GAME.pitchReady || pitchBall.active || GAME.battedBall) return;
  const pitcherController = getFieldingController();
  GAME.pitchCharge.active = true;
  GAME.pitchCharge.elapsed = 0;
  GAME.pitchCharge.owner = pitcherController;
  GameManager.setPhase("pitch_setup", "pitching");
  setMessage(`${GAME.teams[GAME.fieldingSide].name} charging ${PITCH_TYPE_CONFIG[GAME.selectedPitchType].label}...`);
}

function releasePitchCharge() {
  if (!GAME.pitchCharge.active) return;
  const quality = computePitchChargeQuality(GAME.pitchCharge.meter);
  GAME.pitchCharge.quality = quality;
  GAME.pitchCharge.active = false;
  spawnPitch();
}

function evaluateSwingTiming(ballX, zone) {
  const earlyLateNorm = clamp((ballX - zone.cx) / HIT_PHYSICS_TUNING.timingWindowPx, -1, 1);
  const absNorm = Math.abs(earlyLateNorm);
  if (absNorm <= 0.08) return { label: "PERFECT", quality: 1, timingNorm: earlyLateNorm };
  if (absNorm <= 0.22) return { label: "GOOD", quality: 0.82, timingNorm: earlyLateNorm };
  if (earlyLateNorm > 0.45) return { label: "VERY EARLY", quality: 0.36, timingNorm: earlyLateNorm };
  if (earlyLateNorm > 0.22) return { label: "EARLY", quality: 0.58, timingNorm: earlyLateNorm };
  if (earlyLateNorm < -0.45) return { label: "VERY LATE", quality: 0.34, timingNorm: earlyLateNorm };
  return { label: "LATE", quality: 0.56, timingNorm: earlyLateNorm };
}

function aimPitchTarget(zone, selectedPitch, pitchQuality) {
  const baseTargetX = zone.cx + GAME.pitchAim * (zone.w * 0.48);
  const baseTargetY = zone.cy + GAME.pitchAimY * (zone.h * 0.48);
  const accuracySpread = lerp(42, 6, clampValue(pitchQuality, 0, 1));
  const wobbleX = randomRange(-accuracySpread, accuracySpread);
  const wobbleY = randomRange(-accuracySpread, accuracySpread);
  const targetX = clampValue(baseTargetX + wobbleX, zone.x - 46, zone.x + zone.w + 46);
  const targetY = clampValue(baseTargetY + wobbleY, zone.y - 62, zone.y + zone.h + 62);
  const cfg = PITCH_TYPE_CONFIG[selectedPitch];
  return { targetX, targetY, cfg };
}

function updateCamera(dt) {
  let targetX = 0;
  let targetY = 0;
  let damping = CAMERA_TUNING.battingDamping;

  if (GAME.cameraMode === "fielding" && GAME.battedBall) {
    const trackedFielder = defensiveFielders[GAME.controlledFielder];
    const blendX = trackedFielder ? lerp(GAME.battedBall.x, trackedFielder.x, 0.36) : GAME.battedBall.x;
    const blendY = trackedFielder ? lerp(GAME.battedBall.groundY ?? GAME.battedBall.y, trackedFielder.y, 0.36) : (GAME.battedBall.groundY ?? GAME.battedBall.y);
    targetX = blendX - FIELD.home.x;
    targetY = blendY - FIELD.home.y - 58;
    damping = GAME.pendingPlay?.homeRun ? CAMERA_TUNING.homerDamping : CAMERA_TUNING.fieldingDamping;
  } else if (GAME.cameraMode === "pitching") {
    targetX = lerp(GAME.pitchAim * 42, GAME.pitchAim * 96, 0.5);
    targetY = -74 + GAME.pitchAimY * 28;
    damping = CAMERA_TUNING.pitchingDamping;
  } else {
    targetX = 0;
    targetY = -22;
    damping = CAMERA_TUNING.battingDamping;
  }

  GAME.cameraTargetX = clampValue(targetX, -CAMERA_TUNING.maxX, CAMERA_TUNING.maxX);
  GAME.cameraTargetY = clampValue(targetY, CAMERA_TUNING.maxYTop, CAMERA_TUNING.maxYBottom);
  GAME.cameraX = dampLerp(GAME.cameraX, GAME.cameraTargetX, damping, dt);
  GAME.cameraY = dampLerp(GAME.cameraY, GAME.cameraTargetY, damping, dt);
}

function queueThrowToBase(baseKey) {
  if (!GAME.pendingPlay || GAME.pendingPlay.resolved || !GAME.pendingPlay.awaitingThrow) return;
  GAME.pendingPlay.targetBase = baseKey;
  GAME.pendingPlay.throwTimer = 0;
  GameManager.setPhase("throw_resolve", "fielding");
  setMessage(`Throw queued to ${baseKey.toUpperCase()}...`);
}

function schedulePendingThrowWindow(result) {
  if (!GAME.pendingPlay) return;
  GAME.pendingPlay.awaitingThrow = true;
  GAME.pendingPlay.result = result;
  GAME.pendingPlay.throwTimer = 0;
  GAME.pendingPlay.targetBase = null;
  const hitType = GAME.battedBall?.flightType ?? "line";
  GAME.pendingPlay.runnerTimes = RunnerManager.primePendingRunnerTimes(hitType);
  GameManager.setPhase("ball_in_play", "fielding");
}

function updateThrowBall(dt) {
  if (!GAME.throwBall) return;
  const tb = GAME.throwBall;
  tb.t += dt / tb.travel;
  if (tb.t >= 1) {
    tb.t = 1;
  }
  const t = tb.t;
  const inv = 1 - t;
  tb.x = inv * inv * tb.startX + 2 * inv * t * tb.ctrlX + t * t * tb.endX;
  tb.y = inv * inv * tb.startY + 2 * inv * t * tb.ctrlY + t * t * tb.endY;
  if (tb.t >= 1) {
    GAME.throwBall = null;
  }
}

function updatePitchController(dt) {
  if (GAME.mode !== "play" || GAME.battedBall || GAME.controlledRole !== "pitcher") return;
  const pitcherController = getFieldingController();
  const aim = getPitchAimInputs(pitcherController);
  GAME.pitchAim = clampValue(GAME.pitchAim + aim.x * dt * 1.8, -1, 1);
  GAME.pitchAimY = clampValue(GAME.pitchAimY + aim.y * dt * 1.8, -1, 1);
  if (GAME.pitchCharge.active) {
    GAME.pitchCharge.elapsed += dt;
    GAME.pitchCharge.meter = 0.5 + 0.5 * Math.sin(GAME.pitchCharge.elapsed * 7.2);
    GAME.debugInfo.pitchCharge = GAME.pitchCharge.meter.toFixed(2);
  }
  if (!GAME.pitchCharge.active && GAME.pitchReady && wasActionPressed(pitcherController, "pitchThrow")) {
    logInputEvent("Pitch throw pressed");
    startPitchCharge();
  }
  if (GAME.pitchCharge.active && wasActionReleased(pitcherController, "pitchThrow")) {
    releasePitchCharge();
  }
}

function updateBattingController(dt) {
  if (GAME.mode !== "play" || GAME.controlledRole !== "batter") return;
  if (!pitchBall.active || GAME.battedBall) {
    GAME.timingMeter.active = false;
    return;
  }
  const batterController = getBattingController();
  const aim = getPitchAimInputs(batterController);
  GAME.swingAim = clampValue(GAME.swingAim + aim.x * dt * 1.85, -1, 1);
  GAME.timingMeter.active = true;
  GAME.timingMeter.progress = pitchBall.pitchProgress;
  if (wasActionPressed(batterController, "swing")) {
    logInputEvent("Swing pressed");
    handleSwingInput();
  }
}

function showPlayCallout(text, kind = "info") {
  const colors = {
    out: "#ff8d9a",
    safe: "#7fffb8",
    warn: "#ffd56a",
    info: "#9ed7ff"
  };
  GAME.playCallout = {
    text,
    color: colors[kind] ?? colors.info,
    life: 1.1
  };
}

function createBurst(x, y, color = "#ffffff", count = 8) {
  for (let i = 0; i < count; i += 1) {
    const angle = randomRange(0, Math.PI * 2);
    const speed = randomRange(80, 220);
    GAME.particles.push({
      x,
      y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - randomRange(10, 70),
      life: randomRange(0.28, 0.72),
      size: randomRange(2, 4.5),
      color
    });
  }
  if (GAME.particles.length > 260) {
    GAME.particles.splice(0, GAME.particles.length - 260);
  }
}

function updateParticles(dt) {
  for (let i = GAME.particles.length - 1; i >= 0; i -= 1) {
    const p = GAME.particles[i];
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.vy += 360 * dt;
    p.vx *= 0.98;
    p.vy *= 0.98;
    p.life -= dt;
    if (p.life <= 0) {
      GAME.particles.splice(i, 1);
    }
  }
}

function resetCount() {
  GAME.balls = 0;
  GAME.strikes = 0;
}

function clearBases() {
  GAME.runners = [false, false, false];
}

function setupDefense() {
  const defenseTeam = GAME.teams[GAME.fieldingSide];
  const home = safePoint(FIELD.home, "home", { x: GAME.width * 0.5, y: GAME.height * 0.82 });
  const first = safePoint(FIELD.first, "first", { x: home.x + GAME.width * 0.22, y: GAME.height * 0.62 });
  const second = safePoint(FIELD.second, "second", { x: home.x, y: GAME.height * 0.42 });
  const third = safePoint(FIELD.third, "third", { x: home.x - GAME.width * 0.22, y: GAME.height * 0.62 });
  const skin = ["#f8d2ad", "#c58b62", "#8b5b3f"];
  const hair = ["#1e1e1e", "#5d3414", "#704224"];
  const rightInfieldX = (first.x + second.x) / 2 + 14;
  const leftInfieldX = (third.x + second.x) / 2 - 14;
  const spots = [
    { role: "pitcher", x: FIELD.mound.x - 10, y: FIELD.mound.y - 46 },
    { role: "catcher", x: home.x - 12, y: home.y + 8 },
    { role: "first", x: first.x + 16, y: first.y - 12 },
    { role: "second", x: rightInfieldX, y: (first.y + second.y) / 2 - 6 },
    { role: "shortstop", x: leftInfieldX, y: (third.y + second.y) / 2 - 2 },
    { role: "third", x: third.x - 24, y: third.y - 10 },
    { role: "left", x: third.x - 162, y: third.y - 318 },
    { role: "center", x: second.x - 18, y: second.y - 394 },
    { role: "right", x: first.x + 162, y: first.y - 318 }
  ];

  defensiveFielders.length = 0;
  spots.forEach((spot, index) => {
    const speedRange = FIELDING_SPEED_RANGES[spot.role] ?? [140, 180];
    const baseSpeed = lerp(speedRange[0], speedRange[1], teamRating(defenseTeam, "fielding"));
    defensiveFielders.push({
      ...spot,
      homeX: spot.x,
      homeY: spot.y,
      x: spot.x,
      y: spot.y,
      targetX: spot.x,
      targetY: spot.y,
      state: "idle",
      speed: baseSpeed,
      vx: 0,
      vy: 0,
      accel: baseSpeed * 5.2,
      skin: skin[index % skin.length],
      hair: hair[index % hair.length]
    });
  });
  GAME.controlledFielder = 1;
}

function getOutfieldWall() {
  const fieldTop = RENDER_LAYOUT.fieldRect.top;
  const centerX = FIELD.second.x;
  const xLeft = FIELD.third.x - 490;
  const xRight = FIELD.first.x + 490;
  const y = Math.max(fieldTop + 32, FIELD.second.y - 438);
  const radiusX = Math.max(340, (xRight - xLeft) * 0.5);
  const yAt = (x) => {
    const nx = clampValue((x - centerX) / radiusX, -1, 1);
    return y + Math.abs(nx) * 52;
  };
  return {
    xLeft,
    xRight,
    y,
    railColor: "#ffe06a",
    wallColor: "#2f5a96",
    yAt
  };
}

function buildHitZones() {
  return [
    { name: "leftInfield", minForward: -30, maxForward: 430, minLateral: -820, maxLateral: -120, roles: ["third", "shortstop", "pitcher"], backupRoles: ["left", "second"] },
    { name: "middleInfield", minForward: -30, maxForward: 440, minLateral: -120, maxLateral: 120, roles: ["pitcher", "shortstop", "second"], backupRoles: ["first", "center"] },
    { name: "rightInfield", minForward: -30, maxForward: 430, minLateral: 120, maxLateral: 820, roles: ["first", "second", "pitcher"], backupRoles: ["right", "shortstop"] },
    { name: "leftField", minForward: 430, maxForward: 1880, minLateral: -980, maxLateral: -260, roles: ["left", "center"], backupRoles: ["shortstop", "third"] },
    { name: "leftCenterGap", minForward: 500, maxForward: 1980, minLateral: -260, maxLateral: -80, roles: ["center", "left"], backupRoles: ["left", "shortstop"] },
    { name: "centerField", minForward: 500, maxForward: 2040, minLateral: -80, maxLateral: 80, roles: ["center", "left", "right"], backupRoles: ["left", "right"] },
    { name: "rightCenterGap", minForward: 500, maxForward: 1980, minLateral: 80, maxLateral: 260, roles: ["center", "right"], backupRoles: ["right", "second"] },
    { name: "rightField", minForward: 430, maxForward: 1880, minLateral: 260, maxLateral: 980, roles: ["right", "center"], backupRoles: ["first", "second"] },
    { name: "foulTerritory", foul: true, roles: ["catcher", "third", "first"], backupRoles: ["pitcher", "shortstop"] }
  ];
}

const HIT_ZONES = buildHitZones();

function getBallFieldVector(pointX, pointY) {
  const home = FIELD.home;
  const second = FIELD.second;
  const forward = normalize2D(second.x - home.x, second.y - home.y);
  const right = { x: -forward.y, y: forward.x };
  const dx = pointX - home.x;
  const dy = pointY - home.y;
  return {
    forwardDist: dx * forward.x + dy * forward.y,
    lateralDist: dx * right.x + dy * right.y
  };
}

function isFoulTerritory(pointX, pointY) {
  const { forwardDist, lateralDist } = getBallFieldVector(pointX, pointY);
  if (forwardDist < -30) return true;
  const fairHalfWidth = Math.max(190, forwardDist * 1.12 + 180);
  return Math.abs(lateralDist) > fairHalfWidth;
}

function getHitZoneForPoint(pointX, pointY) {
  if (isFoulTerritory(pointX, pointY)) {
    return HIT_ZONES.find((zone) => zone.name === "foulTerritory");
  }
  const { forwardDist, lateralDist } = getBallFieldVector(pointX, pointY);
  const zone = HIT_ZONES.find((candidate) => {
    if (candidate.foul) return false;
    return forwardDist >= candidate.minForward
      && forwardDist < candidate.maxForward
      && lateralDist >= candidate.minLateral
      && lateralDist < candidate.maxLateral;
  });
  return zone ?? HIT_ZONES.find((candidate) => candidate.name === "centerField");
}

function getHitZoneForBall(ballObj) {
  if (!ballObj) return HIT_ZONES.find((candidate) => candidate.name === "middleInfield");
  const targetX = ballObj.landingPoint?.x ?? ballObj.x;
  const targetY = ballObj.landingPoint?.y ?? (ballObj.groundY ?? ballObj.y);
  return getHitZoneForPoint(targetX, targetY);
}

function getFielderIndexByRole(role) {
  return defensiveFielders.findIndex((fielder) => fielder.role === role);
}

function pickClosestFromRoles(targetX, targetY, roles, exclude = new Set()) {
  let best = -1;
  let bestDist = Number.POSITIVE_INFINITY;
  roles.forEach((role) => {
    const idx = getFielderIndexByRole(role);
    if (idx < 0 || exclude.has(idx)) return;
    const f = defensiveFielders[idx];
    const d = Math.hypot(f.x - targetX, f.y - targetY);
    if (d < bestDist) {
      bestDist = d;
      best = idx;
    }
  });
  return best;
}

function pickPrimaryFielderIndexForZone(zone, ballObj) {
  const chaseX = ballObj.landingPoint?.x ?? ballObj.x;
  const chaseY = ballObj.landingPoint?.y ?? (ballObj.groundY ?? ballObj.y);
  const roles = zone?.roles ?? ["center"];
  return pickClosestFromRoles(chaseX, chaseY, roles);
}

function pickBackupFielderIndexForZone(zone, ballObj, primaryIdx) {
  const chaseX = ballObj.landingPoint?.x ?? ballObj.x;
  const chaseY = ballObj.landingPoint?.y ?? (ballObj.groundY ?? ballObj.y);
  const exclude = new Set(primaryIdx >= 0 ? [primaryIdx] : []);
  const rolePool = [...(zone?.roles ?? []), ...(zone?.backupRoles ?? [])];
  let backupIdx = pickClosestFromRoles(chaseX, chaseY, rolePool, exclude);
  if (backupIdx >= 0) return backupIdx;
  return pickClosestFromRoles(chaseX, chaseY, ["center", "shortstop", "second", "left", "right"], exclude);
}

function predictBallLanding(startX, startY, startHeight, vx, vy, vz) {
  let px = startX;
  let py = startY;
  let pz = startHeight;
  let cvx = vx;
  let cvy = vy;
  let cvz = vz;
  let t = 0;
  const step = 0.018;
  while (t < 7.5) {
    px += cvx * step;
    py += cvy * step;
    cvz -= FIELDING_AI_TUNING.gravity * step;
    pz += cvz * step;
    cvx *= 0.998;
    cvy *= 0.998;
    t += step;
    if (pz <= 0) {
      return { x: px, y: py, time: t };
    }
  }
  return { x: px, y: py, time: t };
}

function resetPitchBall(options = {}) {
  const { preservePhase = false } = options;
  pitchBall.active = false;
  pitchBall.visible = false;
  pitchBall.state = "idle";
  pitchBall.swingAttempted = false;
  pitchBall.crossedZone = false;
  pitchBall.pendingCall = null;
  pitchBall.x = pitcher.x + 16;
  pitchBall.y = pitcher.y + 18;
  pitchBall.startX = pitchBall.x;
  pitchBall.startY = pitchBall.y;
  pitchBall.vx = 0;
  pitchBall.vy = 0;
  pitchBall.curve = 0;
  pitchBall.judged = false;
  const zone = getStrikeZoneBounds();
  pitchBall.targetX = zone.cx;
  pitchBall.targetY = zone.cy;
  pitchBall.plateX = zone.cx;
  pitchBall.plateY = zone.cy;
  pitchBall.catcherX = FIELD.home.x - 2;
  pitchBall.catcherY = FIELD.home.y + 8;
  pitchBall.elapsed = 0;
  pitchBall.travelTime = PITCH_DURATION_MS / 1000;
  pitchBall.pitchDurationMs = PITCH_DURATION_MS;
  pitchBall.pitchProgress = 0;
  pitchBall.trail.length = 0;
  pitchBall.trailClock = 0;
  batter.activeSwing = false;
  batter.swingTime = 0;
  // Preserve swing buffer between pitches so queued SPACE inputs can trigger on next pitch.
  GAME.swingBuffer = Math.min(GAME.swingBuffer, SWING_BUFFER_WINDOW);
  GAME.debugInfo.hitDetected = "false";
  GAME.debugInfo.hitZone = "-";
  GAME.debugInfo.landingPoint = "-";
  GAME.debugInfo.pitchType = PITCH_TYPE_CONFIG[GAME.selectedPitchType]?.label ?? "FASTBALL";
  GAME.debugInfo.pitchCharge = "0.00";
  GAME.pitchCharge.active = false;
  GAME.pitchCharge.elapsed = 0;
  GAME.pitchCharge.meter = 0;
  GAME.pitchCharge.quality = 0;
  GAME.timingMeter.active = false;
  GAME.pitchTimer = 0;
  GAME.nextPitchDelay = PITCH_DELAY_TUNING.resetMin + Math.random() * PITCH_DELAY_TUNING.resetRange;
  if (!preservePhase) {
    GameManager.setPhase("pitch_setup", "pitching");
  }
}

function updateHud() {
  inningValue.textContent = String(GAME.inning);
  halfValue.textContent = GAME.half.toUpperCase();
  ballsValue.textContent = String(GAME.balls);
  strikesValue.textContent = String(GAME.strikes);
  outsValue.textContent = String(GAME.outs);

  awayTeamName.textContent = GAME.teams.away.name;
  homeTeamName.textContent = GAME.teams.home.name;
  awayScoreValue.textContent = String(GAME.scores.away);
  homeScoreValue.textContent = String(GAME.scores.home);

  const awayChip = awayTeamName?.closest(".score-chip");
  const homeChip = homeTeamName?.closest(".score-chip");
  awayChip?.classList.remove("batting");
  homeChip?.classList.remove("batting");
  if (GAME.battingSide === "away") awayChip?.classList.add("batting");
  else homeChip?.classList.add("batting");
}

function startGame() {
  configureTeams();
  syncRenderLayout();
  GAME.mode = "play";
  GAME.inning = 1;
  GAME.half = "top";
  GAME.outs = 0;
  GAME.scores.away = 0;
  GAME.scores.home = 0;
  GAME.battingSide = "away";
  GAME.fieldingSide = "home";
  GAME.controllerSides = {
    player1: "away",
    player2: "home"
  };
  GAME.localMultiplayer = true;
  GAME.phase = "pitch_setup";
  GAME.pitchReady = true;
  GAME.pitchTimer = 0;
  GAME.nextPitchDelay = PITCH_DELAY_TUNING.initial;
  GAME.pitchAim = 0;
  GAME.pitchAimY = 0;
  GAME.swingAim = 0;
  GAME.selectedPitchType = "fastball";
  GAME.pitchCharge.active = false;
  GAME.pitchCharge.elapsed = 0;
  GAME.pitchCharge.meter = 0;
  GAME.pitchCharge.quality = 0;
  GAME.timingMeter.active = false;
  GAME.timingMeter.progress = 0;
  GAME.timingMeter.verdict = "";
  GAME.timingMeter.quality = 0;
  GAME.timingMeter.life = 0;
  GAME.cameraMode = "pitching";
  GAME.cameraShake = 0;
  GAME.particles = [];
  GAME.battedBall = null;
  GAME.pendingPlay = null;
  GAME.throwBall = null;
  GAME.flashTime = 0;
  GAME.swingBuffer = 0;
  GAME.playCallout = null;
  GAME.swingFeedback = "";
  GAME.swingFeedbackLife = 0;
  GAME.cameraX = 0;
  GAME.cameraY = 0;
  GAME.cameraTargetX = 0;
  GAME.cameraTargetY = 0;
  clearBases();
  resetCount();
  resetPitchBall();
  setupDefense();
  startScreen.classList.add("hidden");
  gameOverScreen.classList.add("hidden");
  updateHud();
  setMessage("Top 1: Player 2 pitch hold/release, Player 1 swings. Select pitch with 1-4.");
  GameManager.syncControllerRoles();
}

function endGame() {
  GAME.mode = "over";
  gameOverScreen.classList.remove("hidden");
  finalScoreText.textContent = `${GAME.teams.away.name} ${GAME.scores.away} - ${GAME.teams.home.name} ${GAME.scores.home}`;
  const winner = GAME.scores.away === GAME.scores.home
    ? "Tie game!"
    : (GAME.scores.away > GAME.scores.home ? `${GAME.teams.away.name} win!` : `${GAME.teams.home.name} win!`);
  setMessage(winner);
}

function moveRunnerAdvance(basesToAdvance) {
  // runners + batter move in one pass from third down to first.
  let scored = 0;
  for (let i = 2; i >= 0; i -= 1) {
    if (!GAME.runners[i]) continue;
    GAME.runners[i] = false;
    const destination = i + basesToAdvance;
    if (destination >= 3) {
      scored += 1;
    } else {
      GAME.runners[destination] = true;
    }
  }

  if (basesToAdvance >= 4) {
    scored += 1;
  } else {
    GAME.runners[basesToAdvance - 1] = true;
  }

  GAME.scores[GAME.battingSide] += scored;
  return scored;
}

function applyWalk() {
  // Force runners when applicable.
  if (GAME.runners[0] && GAME.runners[1] && GAME.runners[2]) {
    GAME.scores[GAME.battingSide] += 1;
  }
  GAME.runners[2] = GAME.runners[2] || (GAME.runners[1] && GAME.runners[0]);
  GAME.runners[1] = GAME.runners[1] || GAME.runners[0];
  GAME.runners[0] = true;
}

function switchSides() {
  syncRenderLayout();
  GAME.outs = 0;
  resetCount();
  clearBases();
  resetPitchBall();
  GAME.battedBall = null;
  GAME.pendingPlay = null;
  GAME.throwBall = null;
  GAME.swingBuffer = 0;
  GAME.playCallout = null;
  GAME.swingFeedback = "";
  GAME.swingFeedbackLife = 0;
  GAME.cameraX = 0;
  GAME.cameraY = 0;
  GAME.cameraTargetX = 0;
  GAME.cameraTargetY = 0;
  GAME.pitchAim = 0;
  GAME.pitchAimY = 0;
  GAME.pitchCharge.active = false;
  GAME.timingMeter.active = false;
  GAME.pitchReady = true;
  GAME.pitchTimer = 0;
  GAME.nextPitchDelay = PITCH_DELAY_TUNING.sideSwitch;

  if (GAME.half === "top") {
    GAME.half = "bottom";
    GAME.battingSide = "home";
    GAME.fieldingSide = "away";
  } else {
    GAME.half = "top";
    GAME.inning += 1;
    GAME.battingSide = "away";
    GAME.fieldingSide = "home";
    if (GAME.inning > 2) {
      endGame();
      return;
    }
  }

  const oldControllers = {
    ...GAME.controllerSides
  };
  GAME.controllerSides.player1 = oldControllers.player1 === "away" ? "home" : "away";
  GAME.controllerSides.player2 = oldControllers.player2 === "away" ? "home" : "away";
  setupDefense();
  updateHud();
  setMessage(`${GAME.half.toUpperCase()} ${GAME.inning}: Roles switched. Pitch with hold/release, swing on timing.`);
  GameManager.setPhase("pitch_setup", "pitching");
  GameManager.syncControllerRoles();
}

function addOut(reason) {
  GAME.outs += 1;
  resetCount();
  resetPitchBall();
  GAME.battedBall = null;
  GAME.pendingPlay = null;
  GAME.throwBall = null;
  GAME.swingBuffer = 0;
  GAME.playCallout = null;
  GAME.pitchReady = true;
  GameManager.setPhase("pitch_setup", "pitching");
  updateHud();
  setMessage(reason);
  if (GAME.outs >= 3) {
    switchSides();
  }
}

function addStrike(reason) {
  GAME.strikes += 1;
  createBurst(FIELD.home.x - 8, FIELD.home.y - 12, "#ffd56a", 8);
  if (GAME.strikes >= 3) {
    addOut("Strike three. Batter out.");
    return;
  }
  resetPitchBall();
  GAME.pitchReady = true;
  updateHud();
  setMessage(`${reason} Count ${GAME.balls}-${GAME.strikes}`);
}

function addBall(reason) {
  GAME.balls += 1;
  createBurst(FIELD.home.x - 8, FIELD.home.y - 12, "#75d5ff", 8);
  if (GAME.balls >= 4) {
    applyWalk();
    resetCount();
    resetPitchBall();
    GAME.pitchReady = true;
    updateHud();
    setMessage(`Ball four. Walk for ${GAME.teams[GAME.battingSide].name}.`);
    return;
  }
  resetPitchBall();
  GAME.pitchReady = true;
  updateHud();
  setMessage(`${reason} Count ${GAME.balls}-${GAME.strikes}`);
}

function foulBall() {
  if (GAME.strikes < 2) {
    GAME.strikes += 1;
  }
  createBurst(FIELD.home.x - 12, FIELD.home.y - 8, "#fff6a8", 7);
  showPlayCallout("FOUL BALL", "warn");
  resetPitchBall();
  GAME.pitchReady = true;
  updateHud();
  setMessage(`Foul ball. Count ${GAME.balls}-${GAME.strikes}`);
}

function registerHit(type) {
  let advance = 1;
  if (type === "double") advance = 2;
  if (type === "triple") advance = 3;
  if (type === "homer") advance = 4;
  const scored = moveRunnerAdvance(advance);
  resetCount();
  updateHud();
  const hitText = {
    single: "Single",
    double: "Double",
    triple: "Triple",
    homer: "Home run"
  };
  setMessage(`${hitText[type]}! ${scored > 0 ? `${scored} run${scored > 1 ? "s" : ""} scored.` : ""}`);

  const calloutMap = {
    single: { text: "BASE HIT", outcome: "safe" },
    double: { text: "DOUBLE", outcome: "safe" },
    triple: { text: "TRIPLE", outcome: "safe" },
    homer: { text: "HOME RUN", outcome: "homer" }
  };
  const call = calloutMap[type];
  if (call) showPlayCallout(call.text, call.outcome);
}

function calculateHitPhysics({ ballX, ballY }) {
  const zone = getStrikeZoneBounds();
  const contactPointX = zone.cx;
  const contactPointY = zone.cy;

  // Timing quality: early > 0 (pulled/high), late < 0 (oppo/lower).
  const timingOffset = ballX - contactPointX;
  const timingNorm = clamp(timingOffset / HIT_PHYSICS_TUNING.timingWindowPx, -1, 1);
  const timingQuality = 1 - Math.min(1, Math.abs(timingNorm));

  // Contact point quality from where the bat meets the ball vertically.
  // Top half contact => grounder tendency, bottom half => pop tendency.
  const contactOffsetY = ballY - contactPointY;
  const contactNorm = clamp(contactOffsetY / HIT_PHYSICS_TUNING.contactWindowPx, -1, 1);

  let category = "line";
  if (contactNorm <= -0.46) category = "grounder";
  else if (contactNorm >= 0.7) category = "pop";
  else if (Math.abs(contactNorm) <= 0.26 && timingQuality > 0.35) category = "line";
  else if (contactNorm > 0.26) category = "fly";
  else if (contactNorm < -0.26) category = "grounder";

  // Launch angle ranges (arcade-believable by request).
  let launchRange = HIT_PHYSICS_TUNING.launchAngles.line;
  if (category === "grounder") launchRange = HIT_PHYSICS_TUNING.launchAngles.grounder;
  if (category === "fly") launchRange = HIT_PHYSICS_TUNING.launchAngles.fly;
  if (category === "pop") launchRange = HIT_PHYSICS_TUNING.launchAngles.pop;
  let launchAngleDeg = randomRange(launchRange.min, launchRange.max);

  // Timing nudges launch: early = slightly higher, late = slightly lower.
  launchAngleDeg += timingNorm * 7 + randomRange(-2.2, 2.2);
  launchAngleDeg = clamp(launchAngleDeg, -14, 72);

  // Direction yaw controls pull/opposite spread.
  const pullBase = -28;
  const oppoBase = 28;
  const timingYaw = timingNorm >= 0
    ? pullBase * Math.abs(timingNorm)
    : oppoBase * Math.abs(timingNorm);
  const aimYaw = GAME.swingAim * 24;
  const sprayYaw = randomRange(-12, 12);
  const yawDeg = timingYaw + aimYaw + sprayYaw;

  // Exit velocity from timing + contact quality.
  const contactQuality = 1 - Math.min(1, Math.abs(contactNorm));
  const squareContactBoost = (timingQuality > 0.75 && contactQuality > 0.72) ? 0.08 : 0;
  const rawQuality = clamp(
    0.62 * timingQuality + 0.38 * contactQuality + squareContactBoost + randomRange(-0.08, 0.08),
    0,
    1
  );
  const exitVelocity = lerp(
    HIT_PHYSICS_TUNING.minExitVelocity,
    HIT_PHYSICS_TUNING.maxExitVelocity,
    rawQuality
  );

  // Build final direction vector in field plane.
  const homeToSecondX = FIELD.second.x - FIELD.home.x;
  const homeToSecondY = FIELD.second.y - FIELD.home.y;
  const forward = normalize2D(homeToSecondX, homeToSecondY);
  const yawRad = degToRad(yawDeg);
  const directionVector = {
    x: forward.x * Math.cos(yawRad) - forward.y * Math.sin(yawRad),
    y: forward.x * Math.sin(yawRad) + forward.y * Math.cos(yawRad)
  };

  return {
    timingNorm,
    timingQuality,
    contactNorm,
    contactQuality,
    quality: rawQuality,
    category,
    flightType: category,
    launchAngle: launchAngleDeg,
    exitVelocity,
    directionVector
  };
}

function pitchInStrikeZone(x, y) {
  const zone = getStrikeZoneBounds();
  return x >= zone.x && x <= (zone.x + zone.w) && y >= zone.y && y <= (zone.y + zone.h);
}

function spawnPitch() {
  const fieldingTeam = GAME.teams[GAME.fieldingSide];
  const pitchRating = teamRating(fieldingTeam, "pitching");
  const zone = getStrikeZoneBounds();
  const selectedPitch = PITCH_TYPE_CONFIG[GAME.selectedPitchType] ?? PITCH_TYPE_CONFIG.fastball;
  const pitchQuality = clampValue(GAME.pitchCharge.quality || 0.62, 0.2, 1);
  const aimed = aimPitchTarget(zone, GAME.selectedPitchType, pitchQuality);
  const targetX = aimed.targetX;
  const targetY = aimed.targetY;
  const pitchDurationMs = clampValue(
    selectedPitch.durationMs + (0.5 - pitchRating) * 60 + randomRange(-26, 26),
    PITCH_DURATION_RANGE_MS.min,
    PITCH_DURATION_RANGE_MS.max
  );
  const startX = pitcher.x + 14;
  const startY = pitcher.y + 16;
  const dx = targetX - startX;
  const dy = targetY - startY;
  const travelTime = pitchDurationMs / 1000;
  const baseCurve = (GAME.pitchAim * 48) + randomRange(-18, 18);
  const curveAmount = baseCurve * selectedPitch.curveScale;
  const drop = selectedPitch.drop;
  const midControlX = startX + dx * 0.52 + curveAmount;
  const midControlY = startY + dy * 0.47 + drop + randomRange(-10, 10);

  pitchBall.active = true;
  pitchBall.visible = true;
  pitchBall.state = "pitch";
  pitchBall.swingAttempted = false;
  pitchBall.crossedZone = false;
  pitchBall.pendingCall = null;
  pitchBall.x = startX;
  pitchBall.y = startY;
  pitchBall.startX = startX;
  pitchBall.startY = startY;
  pitchBall.vx = 0;
  pitchBall.vy = 0;
  pitchBall.curve = curveAmount;
  pitchBall.judged = false;
  pitchBall.targetX = targetX;
  pitchBall.targetY = targetY;
  pitchBall.plateX = targetX;
  pitchBall.plateY = targetY;
  pitchBall.catcherX = FIELD.home.x - 2;
  pitchBall.catcherY = FIELD.home.y + 8;
  pitchBall.controlX = midControlX;
  pitchBall.controlY = midControlY;
  pitchBall.elapsed = 0;
  pitchBall.travelTime = travelTime;
  pitchBall.pitchDurationMs = pitchDurationMs;
  pitchBall.pitchProgress = 0;
  pitchBall.trail.length = 0;
  pitchBall.trailClock = 0;
  GAME.pitchReady = false;
  GAME.pitchTimer = 0;
  GAME.swingBuffer = Math.max(0, GAME.swingBuffer);
  GAME.timingMeter.active = true;
  GAME.timingMeter.progress = 0;
  GAME.timingMeter.verdict = "";
  GAME.timingMeter.life = 0;
  GAME.debugInfo.hitDetected = "false";
  GAME.debugInfo.pitchTarget = `${Math.round(targetX)}, ${Math.round(targetY)}`;
  GAME.debugInfo.strikeZone = `${Math.round(zone.x)},${Math.round(zone.y)} ${Math.round(zone.w)}x${Math.round(zone.h)}`;
  GAME.debugInfo.pitchDuration = `${Math.round(pitchDurationMs)}ms`;
  GAME.debugInfo.pitchType = selectedPitch.label;
  pitcher.windup = 0.22;
  GameManager.setPhase("pitch_flight", "batting");
}

function launchBattedBall(type, hitPhysics = null, flightTypeOverride) {
  const startX = FIELD.home.x - 12;
  const startY = batter.y + 20;
  let physics = hitPhysics;
  if (!physics) {
    const launchConfig = {
      grounder: { angle: randomRange(-7, 7), exit: randomRange(360, 560), flightType: "grounder" },
      single: { angle: randomRange(10, 22), exit: randomRange(520, 780), flightType: "line" },
      double: { angle: randomRange(18, 31), exit: randomRange(680, 920), flightType: "line" },
      triple: { angle: randomRange(28, 40), exit: randomRange(820, 1040), flightType: "fly" },
      homer: { angle: randomRange(34, 50), exit: randomRange(940, 1120), flightType: "fly" }
    };
    const cfg = launchConfig[type] ?? launchConfig.single;
    const forward = normalize2D(FIELD.second.x - FIELD.home.x, FIELD.second.y - FIELD.home.y);
    const yaw = degreesToRadians(GAME.swingAim * 18 + randomRange(-10, 10));
    physics = {
      launchAngle: cfg.angle,
      exitVelocity: cfg.exit,
      directionVector: {
        x: forward.x * Math.cos(yaw) - forward.y * Math.sin(yaw),
        y: forward.x * Math.sin(yaw) + forward.y * Math.cos(yaw)
      },
      flightType: cfg.flightType
    };
  }
  const speedScale = normalizeInRange(physics.exitVelocity, HIT_PHYSICS_TUNING.minExitVelocity, HIT_PHYSICS_TUNING.maxExitVelocity);
  const launchRad = degreesToRadians(physics.launchAngle);
  const horizontalSpeed = lerp(360, 920, speedScale) * Math.cos(launchRad);
  const verticalSpeed = lerp(240, 760, speedScale) * Math.sin(launchRad);
  const flightType = flightTypeOverride ?? physics.flightType ?? (physics.launchAngle > 48 ? "pop" : "fly");
  const normalizedType = ({
    grounder: "grounder",
    line: "lineDrive",
    fly: "flyBall",
    pop: "popFly"
  })[flightType] ?? (type === "homer" ? "homeRun" : "flyBall");

  const launchDefaults = {
    grounder: { vx: 6 * 60, vy: -3 * 60, vz: 0 },
    line: { vx: 7 * 60, vy: -6 * 60, vz: 2 * 60 },
    fly: { vx: 5 * 60, vy: -7 * 60, vz: 6 * 60 }
  };
  const defaultVel = launchDefaults[flightType] ?? launchDefaults.line;
  let vx = Number.isFinite(physics.directionVector.x * horizontalSpeed) ? physics.directionVector.x * horizontalSpeed : defaultVel.vx;
  let vy = Number.isFinite(physics.directionVector.y * horizontalSpeed) ? physics.directionVector.y * horizontalSpeed : defaultVel.vy;
  let vz = Number.isFinite(verticalSpeed) ? verticalSpeed : defaultVel.vz;

  if (normalizedType === "popFly") {
    vx *= 0.52;
    vy *= 0.52;
    vz *= 1.22;
  } else if (normalizedType === "homeRun") {
    vx *= 1.18;
    vy *= 1.18;
    vz *= 1.16;
  }

  const landing = predictBallLanding(startX, startY, 4, vx, vy, vz);
  GAME.battedBall = {
    x: startX,
    y: startY,
    startX,
    startY,
    z: 4,
    groundY: startY,
    height: 4,
    vx,
    vy,
    vz,
    velocityX: vx,
    velocityY: vy,
    velocityZ: vz,
    elapsed: 0,
    travelTime: 1.55,
    launchAngle: physics.launchAngle,
    exitVelocity: physics.exitVelocity,
    flightType,
    hitType: normalizedType,
    type,
    state: "hit",
    visible: true,
    landed: false,
    fielded: false,
    fieldedBy: null,
    wallCleared: false,
    wallReachedOnGround: false,
    landingPoint: landing,
    trail: []
  };

  const hitZone = getHitZoneForPoint(landing.x, landing.y);
  const zoneName = hitZone?.name ?? "centerField";
  const isGap = zoneName === "leftCenterGap" || zoneName === "rightCenterGap";
  const primaryFielder = pickPrimaryFielderIndexForZone(hitZone, GAME.battedBall);
  const backupFielder = pickBackupFielderIndexForZone(hitZone, GAME.battedBall, primaryFielder);

  GAME.pendingPlay = {
    resolved: false,
    elapsed: 0,
    result: "inPlay",
    assignedFielder: primaryFielder,
    backupFielder,
    zone: zoneName,
    gapHit: isGap,
    homeRun: false,
    homerTimer: 0,
    landingPoint: landing,
    landingTime: landing.time,
    wallLineY: getOutfieldWall().yAt(landing.x),
    targetBase: null,
    throwTimer: 0,
    catchAttempted: false
  };
  GAME.controlledFielder = primaryFielder >= 0 ? primaryFielder : GAME.controlledFielder;
  createBurst(startX, startY, "#ffffff", 10);
  const inPlayText = {
    grounder: "GROUND BALL",
    lineDrive: "LINE DRIVE",
    flyBall: "FLY BALL",
    popFly: "POP FLY",
    homeRun: "CRACK!"
  };
  showPlayCallout(inPlayText[normalizedType] ?? "IN PLAY", "info");
  if (isGap) {
    showPlayCallout("GAP HIT!", "info");
  }
  GAME.debugInfo.hitType = `${type}/${flightType}`;
  GAME.debugInfo.hitZone = zoneName;
  GAME.debugInfo.assignedFielder = primaryFielder >= 0 ? `${primaryFielder}:${defensiveFielders[primaryFielder]?.role ?? "-"}` : "-";
  GAME.debugInfo.backupFielder = backupFielder >= 0 ? `${backupFielder}:${defensiveFielders[backupFielder]?.role ?? "-"}` : "-";
  GAME.debugInfo.landingPoint = `${Math.round(landing.x)}, ${Math.round(landing.y)}`;
  GameManager.setPhase("ball_in_play", "fielding");
}

function resolveSwing(ballX, ballY) {
  const battingTeam = GAME.teams[GAME.battingSide];
  const contact = teamRating(battingTeam, "contact");
  const power = teamRating(battingTeam, "power");

  const zone = getStrikeZoneBounds();
  const contactPoint = {
    x: zone.cx,
    y: zone.cy + 8
  };
  const dx = Math.abs(ballX - contactPoint.x);
  const dy = Math.abs(ballY - contactPoint.y);
  const distance = Math.hypot(ballX - contactPoint.x, ballY - contactPoint.y);
  GAME.lastContactOffset = ballX - contactPoint.x;
  const timingEval = evaluateSwingTiming(ballX, zone);
  setSwingFeedback(timingEval.label, timingEval.quality);
  if (timingEval.label === "PERFECT") {
    GAME.flashTime = 0.12;
  }

  if (distance >= SWING_ASSIST_CONTACT_RADIUS) {
    GAME.debugInfo.hitDetected = "false";
    setSwingFeedback("MISS", 0);
    return;
  }
  GAME.debugInfo.hitDetected = "true";

  // Wider windows improve responsiveness for arcade play.
  const perfectWindow = 16 + contact * 8;
  const goodWindow = 48 + contact * 22;

  // Small timing indicator near batter.
  if (dx <= perfectWindow && dy <= 20 + contact * 8) {
    const big = Math.random() < 0.68 + power * 0.25;
    const hitType = big ? "homer" : (Math.random() < 0.45 ? "triple" : "double");
    const hitPhysics = calculateHitPhysics({ ballX, ballY });
    hitPhysics.exitVelocity *= 1 + timingEval.quality * 0.2;
    launchBattedBall(hitType, hitPhysics);
    createBurst(ballX, ballY, "#ffe27a", 14);
    resetPitchBall({ preservePhase: true });
    return;
  }

  if (dx <= goodWindow && dy <= 42 + contact * 16) {
    const hitPhysics = calculateHitPhysics({ ballX, ballY });
    hitPhysics.exitVelocity *= 0.92 + timingEval.quality * 0.16;
    const outcomeRoll = Math.random();
    if (outcomeRoll < 0.08 + power * 0.18) {
      launchBattedBall("homer", hitPhysics);
    } else if (outcomeRoll < 0.22 + power * 0.3) {
      launchBattedBall("triple", hitPhysics);
    } else if (outcomeRoll < 0.54 + power * 0.24) {
      launchBattedBall("double", hitPhysics);
    } else {
      launchBattedBall("single", hitPhysics);
    }
    createBurst(ballX, ballY, "#8fffc8", 10);
    resetPitchBall({ preservePhase: true });
    return;
  }

  const weakRoll = Math.random();
  if (weakRoll < 0.4) {
    const hitPhysics = calculateHitPhysics({ ballX, ballY });
    hitPhysics.flightType = "grounder";
    hitPhysics.launchAngle = randomRange(-8, 6);
    launchBattedBall("grounder", hitPhysics, "grounder");
    GAME.pendingPlay.result = "grounder";
    setMessage("Weak grounder in play...");
    createBurst(ballX, ballY, "#eadfbe", 8);
    resetPitchBall({ preservePhase: true });
    return;
  }
  if (weakRoll < 0.7) {
    const hitPhysics = calculateHitPhysics({ ballX, ballY });
    launchBattedBall("single", hitPhysics);
    createBurst(ballX, ballY, "#c6ffd8", 8);
    resetPitchBall({ preservePhase: true });
    return;
  }
  if (weakRoll < 0.92) {
    foulBall();
    return;
  }

  addStrike("Swing and miss.");
}

function handleSwingInput() {
  if (GAME.mode !== "play" || GAME.battedBall || !pitchBall.active) return;
  // Queue a tiny swing buffer if user presses a hair early.
  if (pitchBall.judged || pitchBall.swingAttempted) {
    GAME.swingBuffer = SWING_BUFFER_WINDOW;
    return;
  }
  batter.activeSwing = true;
  batter.swingTime = batter.swingDuration;
  pitchBall.swingAttempted = true;
  GAME.timingMeter.active = true;
  resolveSwing(pitchBall.x, pitchBall.y);
}

function queueTakenPitchCall(sampleX = pitchBall.plateX, sampleY = pitchBall.plateY) {
  if (pitchBall.judged) return;
  pitchBall.judged = true;
  if (pitchBall.swingAttempted) {
    pitchBall.pendingCall = "swing-miss";
    return;
  }
  pitchBall.pendingCall = pitchInStrikeZone(sampleX, sampleY) ? "called-strike" : "ball";
}

function applyPendingPitchCall() {
  const call = pitchBall.pendingCall;
  pitchBall.pendingCall = null;
  if (call === "swing-miss") {
    addStrike("Swing and miss.");
    return;
  }
  if (call === "called-strike") {
    addStrike("Called strike.");
    return;
  }
  if (call === "ball") {
    addBall("Ball.");
  }
}

function updatePitchAim(dt) {
  // Per-role aim now updates in each controller to avoid cross-role bleed.
  void dt;
}

function updateFieldingInput(dt) {
  if (GAME.mode !== "play" || GAME.controlledRole !== "fielder") return;
  if (!GAME.battedBall) return;

  const controller = getFieldingController();
  const fielder = defensiveFielders[GAME.controlledFielder];
  if (!fielder) return;

  let dx = 0;
  let dy = 0;
  if (isActionHeld(controller, "moveUp")) dy -= 1;
  if (isActionHeld(controller, "moveDown")) dy += 1;
  if (isActionHeld(controller, "moveLeft")) dx -= 1;
  if (isActionHeld(controller, "moveRight")) dx += 1;

  const len = Math.hypot(dx, dy);
  if (len > 0) {
    logInputEvent("Fielder move input", `dx:${dx} dy:${dy}`);
    const speed = fielder.speed * dt;
    fielder.x += (dx / len) * speed;
    fielder.y += (dy / len) * speed;
  }

  if (GAME.pendingPlay?.awaitingThrow && !GAME.pendingPlay.targetBase) {
    if (wasActionPressed(controller, "throwFirst")) {
      logInputEvent("Throw button pressed", "to first");
      queueThrowToBase("first");
    }
    if (wasActionPressed(controller, "throwSecond")) {
      logInputEvent("Throw button pressed", "to second");
      queueThrowToBase("second");
    }
    if (wasActionPressed(controller, "throwThird")) {
      logInputEvent("Throw button pressed", "to third");
      queueThrowToBase("third");
    }
    if (wasActionPressed(controller, "throwHome")) {
      logInputEvent("Throw button pressed", "to home");
      queueThrowToBase("home");
    }
    if (wasActionPressed(controller, "catchDive")) {
      logInputEvent("Catch/Dive pressed", "nearest base assist");
      queueThrowToBase(nearestBaseKeyFromFielder(fielder));
    }
  }
}

function getRoleHomeTarget(fielder, ballObj = null) {
  if (!ballObj || !GAME.pendingPlay) {
    if (fielder.role === "pitcher") return { x: FIELD.mound.x - 8, y: FIELD.mound.y - 12 };
    if (fielder.role === "catcher") return { x: FIELD.home.x - 12, y: FIELD.home.y + 8 };
    return { x: fielder.homeX, y: fielder.homeY };
  }
  const role = fielder.role;
  if (role === "first") return { x: FIELD.first.x + 10, y: FIELD.first.y - 10 };
  if (role === "pitcher") return { x: FIELD.mound.x - 8, y: FIELD.mound.y - 12 };
  if (role === "catcher") return { x: FIELD.home.x - 12, y: FIELD.home.y + 8 };
  if (role === "left") return { x: FIELD.third.x - 156, y: FIELD.second.y - 236 };
  if (role === "center") return { x: FIELD.second.x - 12, y: FIELD.second.y - 304 };
  if (role === "right") return { x: FIELD.first.x + 152, y: FIELD.second.y - 236 };
  return { x: fielder.homeX, y: fielder.homeY };
}

function findAssignedFielderForBall(ballObj) {
  const zone = getHitZoneForBall(ballObj);
  return pickPrimaryFielderIndexForZone(zone, ballObj);
}

function isBallClearingWallInAir(ballObj) {
  const wall = getOutfieldWall();
  const wallY = wall.yAt(ballObj.x);
  return !ballObj.landed
    && ballObj.height > 14
    && ballObj.x >= wall.xLeft - 24
    && ballObj.x <= wall.xRight + 24
    && (ballObj.groundY ?? ballObj.y) <= wallY;
}

function finalizeBattedBallResult(result, reason = "") {
  if (!GAME.pendingPlay || GAME.pendingPlay.resolved) return;
  GAME.pendingPlay.resolved = true;
  GAME.pendingPlay.awaitingThrow = false;
  GAME.pendingPlay.result = result;

  if (result === "flyOut") {
    showPlayCallout("FLY OUT", "out");
    addOut(reason || "FLY OUT.");
    return;
  }
  if (result === "groundOut") {
    showPlayCallout("GROUND OUT", "out");
    addOut(reason || "GROUND OUT at first.");
    return;
  }
  if (result === "triple") {
    registerHit("triple");
    showPlayCallout("TRIPLE!", "safe");
    setMessage(reason || "TRIPLE! Deep gap ball.");
  } else if (result === "homeRun") {
    registerHit("homer");
    showPlayCallout("HOME RUN!", "safe");
    setMessage(reason || "HOME RUN! Clears the wall.");
  } else if (result === "double") {
    registerHit("double");
    showPlayCallout("DOUBLE!", "safe");
    setMessage(reason || "DOUBLE into the gap.");
  } else {
    registerHit("single");
    showPlayCallout("BASE HIT", "safe");
    setMessage(reason || "BASE HIT.");
  }

  GAME.battedBall = null;
  GAME.pendingPlay = null;
  GAME.throwBall = null;
  GAME.pitchReady = true;
  GAME.pitchTimer = 0;
  GAME.nextPitchDelay = PITCH_DELAY_TUNING.afterPlayMin + Math.random() * PITCH_DELAY_TUNING.afterPlayRange;
  GameManager.setPhase("pitch_setup", "pitching");
}

function executeFieldedBallResult(fieldingRole, ballObj) {
  if (!GAME.pendingPlay || GAME.pendingPlay.resolved) return;
  const role = fieldingRole ?? "fielder";
  const isAirCatch = !ballObj.landed && ballObj.height > 8;
  if (isAirCatch) {
    finalizeBattedBallResult("flyOut", `${role.toUpperCase()} made the catch. FLY OUT.`);
    return;
  }

  ballObj.vx = 0;
  ballObj.vy = 0;
  ballObj.vz = 0;
  ballObj.height = 0;
  ballObj.landed = true;
  ballObj.groundY = ballObj.groundY ?? ballObj.y;
  ballObj.y = ballObj.groundY;

  if (GAME.pendingPlay.gapHit) {
    const depth = getBallFieldVector(ballObj.x, ballObj.groundY).forwardDist;
    schedulePendingThrowWindow(depth > 470 ? "triple" : "double");
    showPlayCallout("MAKE A THROW!", "warn");
    setMessage(`${role.toUpperCase()} fields in the gap. Choose a base.`);
    return;
  }

  const infieldRole = ["pitcher", "catcher", "first", "second", "shortstop", "third"].includes(role);
  if (infieldRole && ballObj.flightType === "grounder") {
    schedulePendingThrowWindow("groundOut");
    showPlayCallout("THROW TO FIRST!", "warn");
    setMessage(`${role.toUpperCase()} fields it clean. Throw for the out.`);
    return;
  }

  const depth = getBallFieldVector(ballObj.x, ballObj.groundY).forwardDist;
  if (depth > 520 || ballObj.wallReachedOnGround) {
    schedulePendingThrowWindow("double");
    showPlayCallout("CUT IT OFF!", "warn");
    setMessage(`${role.toUpperCase()} plays the wall. Throw to limit runners.`);
  } else {
    schedulePendingThrowWindow("baseHit");
    showPlayCallout("THROW IN!", "warn");
    setMessage(`${role.toUpperCase()} fields it late. Throw to a base.`);
  }
}

function updateDebugState(dt) {
  const strike = getStrikeZoneBounds();
  const wall = getOutfieldWall();
  GAME.debugInfo.strikeZone = `${Math.round(strike.x)},${Math.round(strike.y)} ${Math.round(strike.w)}x${Math.round(strike.h)}`;
  if (pitchBall.active) {
    GAME.debugInfo.pitchTarget = `${Math.round(pitchBall.targetX)}, ${Math.round(pitchBall.targetY)}`;
    GAME.debugInfo.ball = `${Math.round(pitchBall.x)}, ${Math.round(pitchBall.y)}`;
    GAME.debugInfo.ballHeight = `${Math.round(pitchBall.height ?? 0)}`;
    GAME.debugInfo.ballState = pitchBall.state;
  } else if (GAME.battedBall) {
    GAME.debugInfo.ball = `${Math.round(GAME.battedBall.x)}, ${Math.round(GAME.battedBall.y)}`;
    GAME.debugInfo.ballHeight = `${Math.round(GAME.battedBall.height ?? GAME.battedBall.z ?? 0)}`;
    GAME.debugInfo.ballState = GAME.battedBall.state ?? "hit";
  } else {
    GAME.debugInfo.ball = "-";
    GAME.debugInfo.ballHeight = "-";
    GAME.debugInfo.ballState = "idle";
  }
  GAME.debugInfo.pitchActive = String(pitchBall.active);
  GAME.debugInfo.swingActive = String(batter.activeSwing);
  const assigned = GAME.pendingPlay?.assignedFielder ?? -1;
  const backup = GAME.pendingPlay?.backupFielder ?? -1;
  GAME.debugInfo.assignedFielder = assigned >= 0 ? `${assigned}:${defensiveFielders[assigned]?.role ?? "?"}` : "-";
  GAME.debugInfo.backupFielder = backup >= 0 ? `${backup}:${defensiveFielders[backup]?.role ?? "?"}` : "-";
  GAME.debugInfo.hitZone = GAME.pendingPlay?.zone ?? GAME.debugInfo.hitZone ?? "-";
  GAME.debugInfo.landingPoint = GAME.pendingPlay?.landingPoint
    ? `${Math.round(GAME.pendingPlay.landingPoint.x)}, ${Math.round(GAME.pendingPlay.landingPoint.y)}`
    : "-";
  GAME.debugInfo.wallLine = `${Math.round(wall.xLeft)},${Math.round(wall.y)} -> ${Math.round(wall.xRight)},${Math.round(wall.y)}`;
  GAME.debugInfo.pitchDuration = `${Math.round(pitchBall.pitchDurationMs ?? PITCH_DURATION_MS)}ms`;
  if (assigned >= 0 && defensiveFielders[assigned]) {
    const f = defensiveFielders[assigned];
    GAME.debugInfo.fielderTarget = `${Math.round(f.targetX ?? f.homeX)}, ${Math.round(f.targetY ?? f.homeY)}`;
  } else {
    GAME.debugInfo.fielderTarget = "-";
  }

  if (DEBUG_STATE.enabled) {
    DEBUG_STATE.lastConsoleLog += dt;
    if (DEBUG_STATE.lastConsoleLog >= DEBUG_STATE.consoleInterval) {
      DEBUG_STATE.lastConsoleLog = 0;
      console.log("[debug]", {
        home: `${Math.round(FIELD.home.x)}, ${Math.round(FIELD.home.y)}`,
        pitchTarget: GAME.debugInfo.pitchTarget,
        strikeZone: GAME.debugInfo.strikeZone,
        ball: GAME.debugInfo.ball,
        ballHeight: GAME.debugInfo.ballHeight,
        ballState: GAME.debugInfo.ballState,
        pitchActive: GAME.debugInfo.pitchActive,
        swingActive: GAME.debugInfo.swingActive,
        hitDetected: GAME.debugInfo.hitDetected,
        hitType: GAME.debugInfo.hitType,
        hitZone: GAME.debugInfo.hitZone,
        assignedFielder: GAME.debugInfo.assignedFielder,
        backupFielder: GAME.debugInfo.backupFielder,
        landingPoint: GAME.debugInfo.landingPoint,
        wallLine: GAME.debugInfo.wallLine,
        pitchDuration: GAME.debugInfo.pitchDuration,
        fielderTarget: GAME.debugInfo.fielderTarget
      });
    }
  } else {
    DEBUG_STATE.lastConsoleLog = 0;
  }
}

function resolveThrow(baseKey) {
  if (!GAME.pendingPlay || GAME.pendingPlay.resolved || !GAME.pendingPlay.awaitingThrow) return;
  const result = GAME.pendingPlay.result;
  if (!["groundOut", "baseHit", "double", "triple"].includes(result)) return;
  const throwTarget = {
    home: FIELD.home,
    first: FIELD.first,
    second: FIELD.second,
    third: FIELD.third
  }[baseKey] ?? FIELD.first;
  const thrower = defensiveFielders[GAME.pendingPlay.assignedFielder] ?? defensiveFielders[GAME.controlledFielder];
  if (thrower) {
    GAME.throwBall = {
      startX: thrower.x,
      startY: thrower.y - 8,
      ctrlX: lerp(thrower.x, throwTarget.x, 0.5),
      ctrlY: Math.min(thrower.y, throwTarget.y) - 55,
      endX: throwTarget.x,
      endY: throwTarget.y - 10,
      x: thrower.x,
      y: thrower.y,
      t: 0,
      travel: 0.34
    };
  }
  const defenseTeam = GAME.teams[GAME.fieldingSide];
  const fieldQuality = teamRating(defenseTeam, "fielding");
  const throwChance = 0.44 + fieldQuality * 0.3;
  const success = Math.random() < throwChance;

  if (!success) {
    GAME.pendingPlay.resolved = true;
    GAME.pendingPlay.awaitingThrow = false;
    showPlayCallout("SAFE", "safe");
    setMessage(`Throw to ${baseKey} skipped wide. Safe.`);
    finalizeBattedBallResult(result, `Throw to ${baseKey.toUpperCase()} offline. Safe.`);
    return;
  }

  if (result === "groundOut") {
    GAME.pendingPlay.resolved = true;
    GAME.pendingPlay.awaitingThrow = false;
    showPlayCallout("GROUND OUT", "out");
    addOut(`GROUND OUT at ${baseKey}!`);
    return;
  }

  GAME.pendingPlay.resolved = true;
  GAME.pendingPlay.awaitingThrow = false;
  showPlayCallout("SAFE", "safe");
  finalizeBattedBallResult(result === "groundOut" ? "baseHit" : result, `Throw to ${baseKey.toUpperCase()}. Runner beats it.`);
}

function updateBattedBall(dt) {
  if (!GAME.battedBall) return;
  const ballObj = GAME.battedBall;
  const pending = GAME.pendingPlay;
  ballObj.visible = true;
  ballObj.state = "hit";
  ballObj.elapsed += dt;

  if (ballObj.trailClock === undefined) ballObj.trailClock = 0;
  ballObj.trailClock += dt;
  if (ballObj.trailClock >= 0.04) {
    ballObj.trailClock = 0;
    if (!Array.isArray(ballObj.trail)) ballObj.trail = [];
    ballObj.trail.push({ x: ballObj.x, y: ballObj.y });
    if (ballObj.trail.length > BALL_VISUAL_TUNING.battedTrailMax) ballObj.trail.shift();
  }

  ballObj.x += ballObj.vx * dt;
  ballObj.groundY += ballObj.vy * dt;
  ballObj.velocityX = ballObj.vx;
  ballObj.velocityY = ballObj.vy;
  ballObj.velocityZ = ballObj.vz;
  ballObj.vx *= 0.996;
  ballObj.vy *= 0.996;

  if (!ballObj.landed || ballObj.vz > 0) {
    ballObj.vz -= FIELDING_AI_TUNING.gravity * dt;
    ballObj.height += ballObj.vz * dt;
    if (ballObj.height <= 0) {
      ballObj.height = 0;
      ballObj.landed = true;
      createBurst(ballObj.x, ballObj.groundY, "#cfa56f", 6);
      if (ballObj.flightType === "grounder") {
        ballObj.vx *= 0.92;
        ballObj.vy *= 0.92;
      } else {
        ballObj.vx *= 0.84;
        ballObj.vy *= 0.84;
      }
    }
  } else {
    const friction = ballObj.flightType === "grounder"
      ? FIELDING_AI_TUNING.grounderFriction
      : FIELDING_AI_TUNING.flyFriction;
    ballObj.vx *= friction;
    ballObj.vy *= friction;
  }

  ballObj.y = ballObj.groundY - ballObj.height;
  GAME.debugInfo.ball = `${Math.round(ballObj.x)}, ${Math.round(ballObj.y)}`;
  GAME.debugInfo.ballHeight = `${Math.round(ballObj.height)}`;

  if (pending && !pending.resolved && pending.assignedFielder < 0) {
    pending.assignedFielder = findAssignedFielderForBall(ballObj);
    pending.backupFielder = pickBackupFielderIndexForZone(getHitZoneForBall(ballObj), ballObj, pending.assignedFielder);
    GAME.controlledFielder = pending.assignedFielder;
  }

  if (!ballObj.wallCleared && isBallClearingWallInAir(ballObj)) {
    ballObj.wallCleared = true;
    if (pending) {
      pending.homeRun = true;
      pending.homerTimer = 0;
      showPlayCallout("HOME RUN!", "safe");
      setMessage("HOME RUN! Clears the wall.");
    }
  }

  const wall = getOutfieldWall();
  if (!ballObj.wallReachedOnGround && ballObj.landed) {
    const wallYAtBall = wall.yAt(ballObj.x);
    if (ballObj.x >= wall.xLeft - 12 && ballObj.x <= wall.xRight + 12 && ballObj.groundY <= wallYAtBall + 6) {
      ballObj.wallReachedOnGround = true;
    }
  }

  if (pending?.homeRun) {
    pending.homerTimer += dt;
    if (pending.homerTimer >= 1.2) {
      finalizeBattedBallResult("homeRun", "HOME RUN! Ball clears the wall in the air.");
    }
    return;
  }

  if (pending && pending.assignedFielder >= 0 && !ballObj.fielded) {
    const fielder = defensiveFielders[pending.assignedFielder];
    if (fielder) {
      const chaseX = (!ballObj.landed && ballObj.flightType !== "grounder" && pending.landingPoint)
        ? pending.landingPoint.x
        : ballObj.x;
      const chaseY = (!ballObj.landed && ballObj.flightType !== "grounder" && pending.landingPoint)
        ? pending.landingPoint.y
        : ballObj.groundY;
      const dist = Math.hypot(fielder.x - chaseX, fielder.y - chaseY);
      const catchRadius = (!ballObj.landed && ballObj.height > 10)
        ? FIELDING_AI_TUNING.airCatchRadius
        : FIELDING_AI_TUNING.pickupRadius;
      if (dist <= catchRadius) {
        ballObj.fielded = true;
        ballObj.fieldedBy = pending.assignedFielder;
        executeFieldedBallResult(fielder.role, ballObj);
      }
    }
  }

  if (pending?.awaitingThrow) {
    const fielder = defensiveFielders[pending.assignedFielder] ?? defensiveFielders[GAME.controlledFielder];
    if (fielder) {
      ballObj.x = fielder.x;
      ballObj.groundY = fielder.y - 6;
      ballObj.y = ballObj.groundY;
    }
  }

  const movingSpeed = Math.hypot(ballObj.vx, ballObj.vy) + Math.abs(ballObj.vz);
  if (!ballObj.fielded && ballObj.landed && movingSpeed < 18 && pending && !pending.resolved && !pending.awaitingThrow) {
    const depth = getBallFieldVector(ballObj.x, ballObj.groundY).forwardDist;
    if (pending.gapHit) {
      finalizeBattedBallResult(
        depth > 470 ? "triple" : "double",
        depth > 470 ? "TRIPLE! Splits the outfielders." : "DOUBLE! GAP HIT!"
      );
      return;
    }
    if (ballObj.wallReachedOnGround || depth > 520) {
      finalizeBattedBallResult("double", "Ball reaches the wall on the ground. DOUBLE!");
      return;
    }
    finalizeBattedBallResult("baseHit", "BASE HIT. Ball gets through.");
  }
}

function updateFielders(dt) {
  const defenseTeam = GAME.teams[GAME.fieldingSide];
  const fieldReaction = teamRating(defenseTeam, "fielding");
  const ballObj = GAME.battedBall;
  const pending = GAME.pendingPlay;
  defensiveFielders.forEach((f, idx) => {
    let target = getRoleHomeTarget(f, ballObj);
    if (ballObj && pending && !pending.homeRun && pending.assignedFielder === idx && !ballObj.fielded) {
      if (!ballObj.landed && ballObj.flightType !== "grounder" && pending.landingPoint) {
        target = { x: pending.landingPoint.x, y: pending.landingPoint.y };
      } else {
        target = { x: ballObj.x, y: ballObj.groundY ?? ballObj.y };
      }
      f.state = "chase";
    } else if (ballObj && pending && !pending.homeRun && pending.backupFielder === idx) {
      const anchor = pending.landingPoint ?? { x: ballObj.x, y: ballObj.groundY ?? ballObj.y };
      const sideOffset = f.role === "left" ? -34 : (f.role === "right" ? 34 : 0);
      target = { x: anchor.x + sideOffset, y: anchor.y + 26 };
      f.state = "backup";
    } else if (ballObj && !pending?.homeRun) {
      const dynamicBackup = getRoleHomeTarget(f, ballObj);
      target = dynamicBackup;
      f.state = "backup";
    } else {
      f.state = "idle";
    }
    f.targetX = target.x;
    f.targetY = target.y;
    const dx = target.x - f.x;
    const dy = target.y - f.y;
    const d = Math.hypot(dx, dy);
    const reactionScale = 0.78 + fieldReaction * 0.36;
    const topSpeed = f.speed * reactionScale;
    const dirX = d > 0.001 ? dx / d : 0;
    const dirY = d > 0.001 ? dy / d : 0;
    const desiredVx = dirX * topSpeed;
    const desiredVy = dirY * topSpeed;
    const accel = (f.accel ?? (f.speed * 5)) * (0.72 + fieldReaction * 0.4);

    const maxDelta = accel * dt;
    f.vx += clampValue(desiredVx - f.vx, -maxDelta, maxDelta);
    f.vy += clampValue(desiredVy - f.vy, -maxDelta, maxDelta);

    const curSpeed = Math.hypot(f.vx, f.vy);
    if (curSpeed > topSpeed) {
      const speedScale = topSpeed / curSpeed;
      f.vx *= speedScale;
      f.vy *= speedScale;
    }

    if (d < 3) {
      f.vx *= 0.72;
      f.vy *= 0.72;
    }

    f.x += f.vx * dt;
    f.y += f.vy * dt;
  });
}

function update(dt) {
  if (GAME.mode !== "play") {
    updateParticles(dt);
    InputManager.clearFrame();
    return;
  }

  GameManager.syncControllerRoles();
  updatePitchAim(dt);
  PitchingController.update(dt);
  BattingController.update(dt);
  FieldingController.update(dt);
  BallPhysics.update(dt);
  updateParticles(dt);

  if (pitcher.windup > 0) pitcher.windup -= dt;
  if (batter.activeSwing) {
    batter.swingTime -= dt;
    if (batter.swingTime <= 0) {
      batter.activeSwing = false;
      batter.swingTime = 0;
    }
  }
  if (GAME.cameraShake > 0) GAME.cameraShake -= dt;
  if (GAME.flashTime > 0) GAME.flashTime -= dt;
  if (GAME.playCallout) {
    GAME.playCallout.life -= dt;
    if (GAME.playCallout.life <= 0) GAME.playCallout = null;
  }
  if (GAME.swingFeedbackLife > 0) {
    GAME.swingFeedbackLife -= dt;
    if (GAME.swingFeedbackLife <= 0) {
      GAME.swingFeedbackLife = 0;
      GAME.swingFeedback = "";
    }
  }
  if (GAME.timingMeter.life > 0) {
    GAME.timingMeter.life -= dt;
    if (GAME.timingMeter.life <= 0) {
      GAME.timingMeter.life = 0;
      GAME.timingMeter.verdict = "";
    }
  }
  if (GAME.swingBuffer > 0) GAME.swingBuffer -= dt;

  if (GAME.pendingPlay?.awaitingThrow && !GAME.pendingPlay.resolved) {
    GAME.pendingPlay.throwTimer += dt;
    const autoFinalizeWindow = FIELDING_AI_TUNING.throwDelay + 1.25;
    if (GAME.pendingPlay.targetBase && GAME.pendingPlay.throwTimer >= FIELDING_AI_TUNING.throwDelay) {
      resolveThrow(GAME.pendingPlay.targetBase);
    } else if (!GAME.pendingPlay.targetBase && GAME.pendingPlay.throwTimer >= autoFinalizeWindow) {
      const result = GAME.pendingPlay.result === "groundOut" ? "baseHit" : GAME.pendingPlay.result;
      finalizeBattedBallResult(result, "No throw in time. Runner safe.");
    }
  }

  if (GAME.pitchReady && !GAME.battedBall && !pitchBall.active && !GAME.pitchCharge.active) {
    GAME.pitchTimer += dt;
    if (!GAME.localMultiplayer && GAME.pitchTimer >= GAME.nextPitchDelay) {
      spawnPitch();
    }
  }

  if (pitchBall.active) {
    if (!Number.isFinite(pitchBall.x) || !Number.isFinite(pitchBall.y)) {
      pitchBall.x = pitcher.x + 14;
      pitchBall.y = pitcher.y + 16;
      if (!BALL_WARNINGS.has("pitch")) {
        console.warn("[ball-warning] Invalid pitch position. Resetting to mound.");
        BALL_WARNINGS.add("pitch");
      }
    }
    const prevX = pitchBall.x;
    const prevY = pitchBall.y;
    pitchBall.elapsed += dt;
    pitchBall.pitchProgress += (dt * 1000) / Math.max(PITCH_DURATION_RANGE_MS.min, pitchBall.pitchDurationMs);
    pitchBall.pitchProgress = clampValue(pitchBall.pitchProgress, 0, 1.04);
    const rawT = pitchBall.pitchProgress;
    const t = Math.min(1, rawT);
    const zoneCrossT = 0.76;
    if (t <= zoneCrossT) {
      const localT = t / zoneCrossT;
      const inv = 1 - localT;
      pitchBall.x = inv * inv * (pitcher.x + 14)
        + 2 * inv * localT * pitchBall.controlX
        + localT * localT * pitchBall.plateX;
      pitchBall.y = inv * inv * (pitcher.y + 16)
        + 2 * inv * localT * pitchBall.controlY
        + localT * localT * pitchBall.plateY;
    } else {
      const catcherT = (t - zoneCrossT) / (1 - zoneCrossT);
      pitchBall.x = lerp(pitchBall.plateX, pitchBall.catcherX, catcherT);
      pitchBall.y = lerp(pitchBall.plateY, pitchBall.catcherY, catcherT);
    }

    if (dt > 0) {
      const rawVx = (pitchBall.x - prevX) / dt;
      const rawVy = (pitchBall.y - prevY) / dt;
      const mag = Math.hypot(rawVx, rawVy);
      if (mag > PITCH_MAX_VELOCITY) {
        const s = PITCH_MAX_VELOCITY / mag;
        pitchBall.vx = rawVx * s;
        pitchBall.vy = rawVy * s;
      } else {
        pitchBall.vx = rawVx;
        pitchBall.vy = rawVy;
      }
    }

    if (!pitchBall.swingAttempted && GAME.swingBuffer > 0) {
      // Early press assist: consume buffered input as ball enters contact lane.
      const contactZone = getStrikeZoneBounds();
      const distToContact = Math.hypot(pitchBall.x - contactZone.cx, pitchBall.y - (contactZone.cy + 8));
      if (distToContact <= SWING_ASSIST_CONTACT_RADIUS) {
        batter.activeSwing = true;
        batter.swingTime = batter.swingDuration;
        pitchBall.swingAttempted = true;
        GAME.swingBuffer = 0;
        resolveSwing(pitchBall.x, pitchBall.y);
      }
    }

    pitchBall.shadowY = pitchBall.y + 16;
    pitchBall.height = Math.sin(t * Math.PI) * 16;
    pitchBall.trailClock += dt;
    if (pitchBall.trailClock >= 0.03) {
      pitchBall.trailClock = 0;
      pitchBall.trail.push({ x: pitchBall.x, y: pitchBall.y });
      if (pitchBall.trail.length > BALL_VISUAL_TUNING.pitchTrailMax) pitchBall.trail.shift();
    }
    GAME.debugInfo.ball = `${Math.round(pitchBall.x)}, ${Math.round(pitchBall.y)}`;
    GAME.debugInfo.ballHeight = `${Math.round(pitchBall.height)}`;

    if (!pitchBall.crossedZone && rawT >= zoneCrossT) {
      pitchBall.crossedZone = true;
      if (!pitchBall.judged) queueTakenPitchCall(pitchBall.plateX, pitchBall.plateY);
    }

    if (rawT >= 1 || pitchBall.x > GAME.width + 40 || pitchBall.y < -40 || pitchBall.y > GAME.height + 40) {
      if (pitchBall.pendingCall) {
        applyPendingPitchCall();
      } else if (!pitchBall.judged) {
        queueTakenPitchCall(pitchBall.plateX, pitchBall.plateY);
        applyPendingPitchCall();
      } else {
        resetPitchBall();
        GAME.pitchReady = true;
      }
    }
  }

  CameraController.update(dt);
  updateDebugState(dt);
  InputManager.clearFrame();
}

function drawBackground() {
  const bounds = RENDER_LAYOUT.fieldRect;
  const top = Math.max(0, bounds.top - 18);
  const sky = ctx.createLinearGradient(0, 0, 0, bounds.bottom + 40);
  sky.addColorStop(0, "#5ec6ff");
  sky.addColorStop(0.35, "#2f69ae");
  sky.addColorStop(1, "#10274b");
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, GAME.width, bounds.bottom + 42);

  // Cyan horizon glow behind wall.
  const glow = ctx.createRadialGradient(
    GAME.width / 2,
    top + 20,
    10,
    GAME.width / 2,
    top + 52,
    GAME.width * 0.62
  );
  glow.addColorStop(0, "rgba(123,221,255,0.4)");
  glow.addColorStop(1, "rgba(123,221,255,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, top - 40, GAME.width, 120);

  ctx.fillStyle = "#0f2551";
  ctx.fillRect(0, top - 8, GAME.width, 22);
  ctx.fillStyle = "#153566";
  ctx.fillRect(0, top + 12, GAME.width, 20);

  // Crowd/stadium seats for a fuller 3D arcade backdrop.
  const seatRows = 6;
  for (let row = 0; row < seatRows; row += 1) {
    const y = top + 6 + row * 6;
    const shade = 16 + row * 8;
    ctx.fillStyle = `rgba(${shade},${36 + row * 6},${72 + row * 10},0.95)`;
    ctx.fillRect(0, y, GAME.width, 6);
    for (let x = row % 2 === 0 ? 5 : 11; x < GAME.width; x += 15) {
      const crowdColor = row % 2 === 0
        ? "rgba(244,135,255,0.78)"
        : (row % 3 === 0 ? "rgba(114,225,255,0.78)" : "rgba(255,203,138,0.72)");
      ctx.fillStyle = crowdColor;
      ctx.fillRect(x, y + 1, 2, 2);
    }
  }
}

function drawField() {
  const home = safePoint(FIELD.home, "home", { x: GAME.width * 0.5, y: GAME.height * 0.82 });
  const second = safePoint(FIELD.second, "second", { x: home.x, y: GAME.height * 0.42 });
  const first = safePoint(FIELD.first, "first", { x: home.x + GAME.width * 0.22, y: (home.y + second.y) / 2 });
  const third = safePoint(FIELD.third, "third", { x: home.x - GAME.width * 0.22, y: (home.y + second.y) / 2 });
  const bounds = RENDER_LAYOUT.fieldRect;

  // Outfield grass
  const grass = ctx.createLinearGradient(0, bounds.top, 0, GAME.height);
  grass.addColorStop(0, "#2d975c");
  grass.addColorStop(0.55, "#2a8f54");
  grass.addColorStop(1, "#1f6b40");
  ctx.fillStyle = grass;
  ctx.fillRect(0, bounds.top, GAME.width, GAME.height - bounds.top);

  // Grass stripes
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(third.x - 220, third.y - 88);
  ctx.lineTo(second.x, second.y - 220);
  ctx.lineTo(first.x + 220, first.y - 88);
  ctx.lineTo(first.x + 330, GAME.height);
  ctx.lineTo(third.x - 330, GAME.height);
  ctx.closePath();
  ctx.clip();
  for (let x = -170; x < GAME.width + 260; x += 38) {
    ctx.fillStyle = "rgba(255,255,255,0.065)";
    ctx.beginPath();
    ctx.moveTo(x, bounds.top - 10);
    ctx.lineTo(x + 12, bounds.top - 10);
    ctx.lineTo(x + 232, GAME.height + 14);
    ctx.lineTo(x + 194, GAME.height + 14);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();

  // Infield dirt diamond
  const infieldDirt = ctx.createLinearGradient(home.x, second.y, home.x, home.y + 34);
  infieldDirt.addColorStop(0, "#d7a66f");
  infieldDirt.addColorStop(1, "#c38b54");
  ctx.fillStyle = infieldDirt;
  ctx.beginPath();
  ctx.moveTo(home.x, home.y + 30);
  ctx.lineTo(third.x - 70, third.y + 6);
  ctx.lineTo(second.x, second.y - 66);
  ctx.lineTo(first.x + 70, first.y + 6);
  ctx.closePath();
  ctx.fill();

  // Outer base path ring.
  ctx.strokeStyle = "rgba(226, 194, 147, 0.9)";
  ctx.lineWidth = 22;
  ctx.lineJoin = "round";
  ctx.beginPath();
  ctx.moveTo(home.x, home.y + 4);
  ctx.lineTo(first.x + 10, first.y + 1);
  ctx.lineTo(second.x, second.y - 20);
  ctx.lineTo(third.x - 10, third.y + 1);
  ctx.closePath();
  ctx.stroke();

  // Visible outfield wall + bright top rail for HR reference.
  const wall = getOutfieldWall();
  ctx.beginPath();
  for (let x = wall.xLeft; x <= wall.xRight; x += 10) {
    const y = wall.yAt(x);
    if (x === wall.xLeft) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  for (let x = wall.xRight; x >= wall.xLeft; x -= 10) {
    const y = wall.yAt(x) + 28;
    ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fillStyle = "rgba(47,90,150,0.9)";
  ctx.fill();

  ctx.beginPath();
  for (let x = wall.xLeft; x <= wall.xRight; x += 8) {
    const y = wall.yAt(x);
    if (x === wall.xLeft) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.strokeStyle = wall.railColor;
  ctx.lineWidth = 3;
  ctx.stroke();

  // Fence posts enhance depth and make HR boundary obvious.
  ctx.strokeStyle = "rgba(170,210,255,0.65)";
  ctx.lineWidth = 1.25;
  for (let x = wall.xLeft; x <= wall.xRight; x += 44) {
    const y = wall.yAt(x);
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x, y + 25);
    ctx.stroke();
  }
}

function drawBasesAndLines() {
  const home = safePoint(FIELD.home, "home", { x: GAME.width * 0.5, y: GAME.height * 0.82 });
  const first = safePoint(FIELD.first, "first", { x: home.x + GAME.width * 0.22, y: GAME.height * 0.62 });
  const second = safePoint(FIELD.second, "second", { x: home.x, y: GAME.height * 0.42 });
  const third = safePoint(FIELD.third, "third", { x: home.x - GAME.width * 0.22, y: GAME.height * 0.62 });
  const mound = safePoint(FIELD.mound, "mound", { x: home.x, y: home.y - (home.y - second.y) * 0.45 });
  const foulLeft = safePoint(FIELD.foulTop, "foul-left", { x: third.x - 320, y: third.y - 360 });
  const foulRight = safePoint(FIELD.foulBottom, "foul-right", { x: first.x + 320, y: first.y - 360 });

  // Base paths
  ctx.strokeStyle = "rgba(232, 202, 158, 0.88)";
  ctx.lineWidth = 8;
  ctx.lineJoin = "round";
  ctx.beginPath();
  ctx.moveTo(home.x, home.y);
  ctx.lineTo(first.x, first.y);
  ctx.lineTo(second.x, second.y);
  ctx.lineTo(third.x, third.y);
  ctx.closePath();
  ctx.stroke();

  // Foul lines
  ctx.strokeStyle = "rgba(255,255,255,0.95)";
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(home.x, home.y);
  ctx.lineTo(foulLeft.x, foulLeft.y);
  ctx.moveTo(home.x, home.y);
  ctx.lineTo(foulRight.x, foulRight.y);
  ctx.stroke();

  // Mound
  ctx.fillStyle = "rgba(0,0,0,0.18)";
  ctx.beginPath();
  ctx.ellipse(mound.x + 2, mound.y + 32, 50, 18, 0, 0, Math.PI * 2);
  ctx.fill();
  const moundGrad = ctx.createLinearGradient(mound.x, mound.y + 6, mound.x, mound.y + 40);
  moundGrad.addColorStop(0, "#ddb785");
  moundGrad.addColorStop(1, "#ba8754");
  ctx.fillStyle = moundGrad;
  ctx.beginPath();
  ctx.ellipse(mound.x, mound.y + 30, 48, 17, 0, 0, Math.PI * 2);
  ctx.fill();

  drawBase(first.x, first.y);
  drawBase(second.x, second.y);
  drawBase(third.x, third.y);
  drawHomePlate(home.x, home.y);
  drawBatterBox(home.x, home.y);
}

function drawBase(x, y) {
  const s = scaleByY(y);
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(s, s);
  ctx.rotate(Math.PI / 4);
  ctx.fillStyle = "rgba(0,0,0,0.2)";
  ctx.fillRect(-11, -8, 22, 22);
  ctx.fillStyle = "#fffef4";
  ctx.fillRect(-11, -11, 22, 22);
  ctx.strokeStyle = "#d4d0bf";
  ctx.lineWidth = 2;
  ctx.strokeRect(-11, -11, 22, 22);
  ctx.restore();
}

function drawHomePlate(x, y) {
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = "#fff8e6";
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(10, -8);
  ctx.lineTo(10, 5);
  ctx.lineTo(0, 14);
  ctx.lineTo(-10, 5);
  ctx.lineTo(-10, -8);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function drawBatterBox(homeX, homeY) {
  ctx.strokeStyle = "rgba(255,255,255,0.82)";
  ctx.lineWidth = 2;
  ctx.strokeRect(homeX - 76, homeY - 34, 32, 46);
  ctx.strokeRect(homeX + 14, homeY - 34, 32, 46);
}

function drawStrikeZone() {
  // Intentionally hidden in normal gameplay.
}

function drawRunnerDots() {
  const basePoints = [FIELD.first, FIELD.second, FIELD.third];
  basePoints.forEach((point, idx) => {
    if (!GAME.runners[idx]) return;
    ctx.fillStyle = "#fffad2";
    ctx.beginPath();
    ctx.arc(point.x, point.y - 22, 4, 0, Math.PI * 2);
    ctx.fill();
  });
}

function drawPlayer(x, y, team, look, direction = 1, bigHead = true, selected = false) {
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return;
  }
  const palette = team?.colors ?? { jersey: "#4f6ca8", cap: "#2e4678", trim: "#9ec3ff" };
  const skin = look?.skin ?? "#d8b08c";
  const hair = look?.hair ?? "#2d1e16";
  const headSize = bigHead ? 13 : 11;
  const scale = scaleByY(y);
  const screen = worldToScreen(x, y, 0);

  ctx.save();
  ctx.translate(screen.x, screen.y);
  ctx.scale(scale, scale);

  // Short shadow to keep players readable without visual clutter.
  ctx.fillStyle = "rgba(0,0,0,0.26)";
  ctx.beginPath();
  ctx.ellipse(10, 27, 11, 4, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = skin;
  ctx.fillRect(3, -7, headSize, 11);
  ctx.strokeStyle = "rgba(22, 22, 32, 0.82)";
  ctx.lineWidth = 1;
  ctx.strokeRect(3, -7, headSize, 11);

  ctx.fillStyle = hair;
  ctx.fillRect(3, -9, headSize, 3);
  ctx.fillStyle = palette.cap;
  ctx.fillRect(3, -12, headSize, 4);
  ctx.fillStyle = "#9dd7ff";
  ctx.fillRect(5, -11, headSize - 4, 1);

  ctx.fillStyle = "#1a1a1a";
  ctx.fillRect(6, -2, 2, 2);
  ctx.fillRect(11, -2, 2, 2);
  ctx.fillRect(8, 1, 3, 1);

  ctx.fillStyle = palette.jersey;
  ctx.fillRect(2, 2, 16, 17);
  ctx.fillStyle = palette.trim;
  ctx.fillRect(2, 2, 16, 3);
  ctx.strokeStyle = "rgba(20, 24, 34, 0.9)";
  ctx.strokeRect(2, 2, 16, 17);

  ctx.fillStyle = "#18203a";
  ctx.fillRect(3, 19, 5, 9);
  ctx.fillRect(12, 19, 5, 9);

  ctx.fillStyle = skin;
  if (direction > 0) {
    ctx.fillRect(17, 9, 5, 4);
  } else {
    ctx.fillRect(-2, 9, 5, 4);
  }

  if (selected) {
    ctx.strokeStyle = "#ffe46f";
    ctx.lineWidth = 2;
    ctx.strokeRect(-2, -14, 24, 44);
  }
  ctx.restore();
}

function drawPitcher() {
  const team = GAME.teams[GAME.fieldingSide];
  const pitcherFielder = defensiveFielders.find((f) => f.role === "pitcher");
  const baseX = pitcherFielder ? pitcherFielder.x : pitcher.x;
  const baseY = pitcherFielder ? pitcherFielder.y : pitcher.y;
  const wobble = Math.sin(performance.now() * 0.015) * (pitcher.windup > 0 ? 4 : 1.5);
  const isControlled = GAME.mode === "play"
    && GAME.controlledRole === "pitcher"
    && getFieldingController() === "player1";
  drawPlayer(
    baseX + wobble,
    baseY,
    team,
    { skin: pitcherFielder?.skin ?? "#dca37f", hair: pitcherFielder?.hair ?? "#3d2414" },
    1,
    true,
    isControlled
  );
}

function drawCatcher() {
  const catcher = defensiveFielders.find((f) => f.role === "catcher");
  if (!catcher) return;
  const team = GAME.teams[GAME.fieldingSide];
  drawPlayer(
    catcher.x,
    catcher.y,
    team,
    { skin: catcher.skin, hair: catcher.hair },
    1,
    true,
    GAME.pendingPlay?.awaitingThrow && defensiveFielders.indexOf(catcher) === GAME.controlledFielder
  );
}

function drawBatter() {
  const team = GAME.teams[GAME.battingSide];
  const isControlled = GAME.mode === "play"
    && GAME.controlledRole === "batter"
    && getBattingController() === "player1";
  drawPlayer(
    batter.x,
    batter.y,
    team,
    { skin: "#f2c7a3", hair: "#2f1c13" },
    -1,
    true,
    isControlled
  );
}

function drawBat() {
  const swingProgress = batter.activeSwing
    ? 1 - batter.swingTime / batter.swingDuration
    : 0;
  const angle = batter.activeSwing
    ? degreesToRadians(-40 + swingProgress * 110)
    : degreesToRadians(-40);
  const handX = batter.x + 14 - (GAME.cameraX ?? 0);
  const handY = batter.y + 13 - (GAME.cameraY ?? 0);
  const batScale = scaleByY(batter.y);

  ctx.save();
  ctx.translate(handX, handY);
  ctx.scale(batScale, batScale);
  ctx.rotate(angle);
  ctx.fillStyle = batter.batColor;
  // Small local bat: 40x6, never leaves batter zone.
  ctx.fillRect(-34, -3, 40, 6);
  ctx.restore();
}

function drawFielders() {
  const team = GAME.teams[GAME.fieldingSide];
  const sorted = defensiveFielders
    .filter((fielder) => fielder.role !== "catcher")
    .sort((a, b) => a.y - b.y);
  sorted.forEach((fielder) => {
    const index = defensiveFielders.indexOf(fielder);
    drawPlayer(
      fielder.x,
      fielder.y,
      team,
      { skin: fielder.skin, hair: fielder.hair },
      1,
      true,
      GAME.pendingPlay?.awaitingThrow && index === GAME.controlledFielder
    );
  });
}

function drawPlayers() {
  drawPitcher();
  drawCatcher();
  drawFielders();
  drawBatter();
  drawRunnerDots();
}

function drawBattedBall() {
  if (!GAME.battedBall) return;
  const ballObj = GAME.battedBall;
  if (!Number.isFinite(ballObj.x) || !Number.isFinite(ballObj.y)) {
    ballObj.x = pitcher.x + 14;
    ballObj.y = pitcher.y + 16;
    ballObj.groundY = pitcher.y + 16;
    if (!BALL_WARNINGS.has("hit")) {
      console.warn("[ball-warning] Invalid hit-ball position. Resetting to mound.");
      BALL_WARNINGS.add("hit");
    }
  }
  const flight = ballObj.flightType ?? "fly";
  const depthScale = scaleByY(ballObj.groundY ?? ballObj.y);
  const radius = BALL_VISUAL_TUNING.battedRadius * clampValue(depthScale * 0.95, 0.7, 1.28);
  const shadowAlpha = clampValue(0.36 - (ballObj.height / 280), 0.07, 0.36);
  const screen = worldToScreen(ballObj.x, ballObj.groundY ?? ballObj.y, ballObj.height);
  const shadow = worldToScreen(ballObj.x, ballObj.groundY ?? ballObj.y, 0);

  ctx.fillStyle = `rgba(0,0,0,${shadowAlpha})`;
  ctx.beginPath();
  ctx.ellipse(
    shadow.x,
    shadow.y + 5,
    Math.max(3, (radius + 1 - ballObj.height * 0.012) * depthScale),
    Math.max(2, (radius - 2 - ballObj.height * 0.016) * depthScale * 0.8),
    0,
    0,
    Math.PI * 2
  );
  ctx.fill();

  if (Array.isArray(ballObj.trail) && ballObj.trail.length > 0) {
    ballObj.trail.forEach((tp, index) => {
      const fade = (index + 1) / ballObj.trail.length;
      const tpScreen = worldToScreen(tp.x, tp.y, 0);
      ctx.fillStyle = `rgba(255,255,255,${0.16 * fade})`;
      ctx.beginPath();
      ctx.arc(tpScreen.x, tpScreen.y, radius * (0.6 * fade), 0, Math.PI * 2);
      ctx.fill();
    });
  }

  if (flight === "grounder") {
    ctx.strokeStyle = "#25334f";
    ctx.lineWidth = 2;
    ctx.fillStyle = "#fffef2";
    ctx.beginPath();
    ctx.arc(screen.x, screen.y, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    return;
  }

  if (flight === "line") {
    ctx.strokeStyle = "#25334f";
    ctx.lineWidth = 2;
    ctx.fillStyle = "#fffef2";
    ctx.beginPath();
    ctx.arc(screen.x, screen.y, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    return;
  }

  ctx.strokeStyle = "#25334f";
  ctx.lineWidth = 2;
  ctx.fillStyle = "#fffef2";
  ctx.beginPath();
  ctx.arc(screen.x, screen.y, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
}

function drawPitchBall() {
  if (!pitchBall.active || !pitchBall.visible) return;
  if (!Number.isFinite(pitchBall.x) || !Number.isFinite(pitchBall.y)) {
    pitchBall.x = pitcher.x + 14;
    pitchBall.y = pitcher.y + 16;
    if (!BALL_WARNINGS.has("pitch-draw")) {
      console.warn("[ball-warning] Invalid pitch render position. Resetting to mound.");
      BALL_WARNINGS.add("pitch-draw");
    }
  }
  const depthScale = scaleByY(pitchBall.y);
  const r = BALL_VISUAL_TUNING.pitchRadius * clampValue(depthScale * 0.9, 0.72, 1.2);
  const screen = worldToScreen(pitchBall.x, pitchBall.y, pitchBall.height * 0.35);
  const shadow = worldToScreen(pitchBall.x, pitchBall.shadowY, 0);

  const shadowAlpha = clampValue(0.32 - (pitchBall.height / 180), 0.09, 0.32);
  ctx.fillStyle = `rgba(0,0,0,${shadowAlpha})`;
  ctx.beginPath();
  ctx.ellipse(
    shadow.x,
    shadow.y + 4,
    Math.max(4, r + 1 - pitchBall.height * 0.014),
    Math.max(2, r - 2 - pitchBall.height * 0.018),
    0,
    0,
    Math.PI * 2
  );
  ctx.fill();

  ctx.fillStyle = "rgba(167, 232, 255, 0.32)";
  ctx.beginPath();
  ctx.arc(screen.x, screen.y, r + 5, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "#ffffff";
  ctx.strokeStyle = "#23304a";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(screen.x, screen.y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
}

function drawDebugOverlay() {
  const zone = getStrikeZoneBounds();
  const lines = [
    `Home: ${Math.round(FIELD.home.x)}, ${Math.round(FIELD.home.y)}`,
    `Pitch active: ${GAME.debugInfo.pitchActive}`,
    `Swing active: ${GAME.debugInfo.swingActive}`,
    `Hit detected: ${GAME.debugInfo.hitDetected}`,
    `Ball state: ${GAME.debugInfo.ballState}`,
    `Pitch target: ${GAME.debugInfo.pitchTarget}`,
    `Strike zone: ${GAME.debugInfo.strikeZone} (cx ${Math.round(zone.cx)}, cy ${Math.round(zone.cy)})`,
    `Ball: ${GAME.debugInfo.ball}`,
    `Ball h: ${GAME.debugInfo.ballHeight}`,
    `Hit type: ${GAME.debugInfo.hitType}`
  ];
  if (DEBUG_FIELDING) {
    lines.push(
      `Assigned fielder: ${GAME.debugInfo.assignedFielder}`,
      `Backup fielder: ${GAME.debugInfo.backupFielder}`,
      `Hit zone: ${GAME.debugInfo.hitZone}`,
      `Landing: ${GAME.debugInfo.landingPoint}`,
      `Wall: ${GAME.debugInfo.wallLine}`,
      `Pitch dur: ${GAME.debugInfo.pitchDuration}`,
      `Fielder target: ${GAME.debugInfo.fielderTarget}`
    );
  }
  const pad = 10;
  const x = 12;
  const y = 84;
  const w = 274;
  const h = lines.length * 15 + 16;
  ctx.save();
  ctx.fillStyle = "rgba(6, 14, 30, 0.78)";
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = "rgba(83, 210, 255, 0.65)";
  ctx.lineWidth = 1.5;
  ctx.strokeRect(x, y, w, h);
  ctx.fillStyle = "#d7f4ff";
  ctx.font = "12px 'Trebuchet MS', sans-serif";
  lines.forEach((line, i) => {
    ctx.fillText(line, x + pad, y + 16 + i * 15);
  });
  ctx.restore();
}

function drawPitchTargetDebug() {
  if (!DEBUG_STATE.enabled) return;
  const zone = getStrikeZoneBounds();
  const wall = getOutfieldWall();
  ctx.save();
  ctx.strokeStyle = "rgba(240, 240, 255, 0.62)";
  ctx.lineWidth = 1.5;
  const zoneScreen = worldToScreen(zone.x, zone.y, 0);
  ctx.strokeRect(zoneScreen.x, zoneScreen.y, zone.w, zone.h);
  ctx.fillStyle = "rgba(255, 214, 120, 0.95)";
  ctx.beginPath();
  const homeScreen = worldToScreen(FIELD.home.x, FIELD.home.y, 0);
  ctx.arc(homeScreen.x, homeScreen.y, 3.5, 0, Math.PI * 2);
  ctx.fill();
  if (pitchBall.active) {
    ctx.strokeStyle = "rgba(173, 227, 255, 0.68)";
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    const pitchStart = worldToScreen(pitcher.x + 14, pitcher.y + 16, 0);
    const plate = worldToScreen(pitchBall.plateX, pitchBall.plateY, 0);
    const ballNow = worldToScreen(pitchBall.x, pitchBall.y, 0);
    ctx.moveTo(pitchStart.x, pitchStart.y);
    ctx.lineTo(plate.x, plate.y);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.strokeStyle = "rgba(173, 227, 255, 0.88)";
    ctx.beginPath();
    ctx.arc(plate.x, plate.y, 4, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = "rgba(131, 255, 187, 0.95)";
    ctx.beginPath();
    ctx.arc(ballNow.x, ballNow.y, 3, 0, Math.PI * 2);
    ctx.fill();
  }

  if (DEBUG_FIELDING) {
    ctx.setLineDash([6, 4]);
    ctx.strokeStyle = "rgba(255, 224, 106, 0.92)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let x = wall.xLeft; x <= wall.xRight; x += 8) {
      const p = worldToScreen(x, wall.yAt(x), 0);
      if (x === wall.xLeft) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    }
    ctx.stroke();
    ctx.setLineDash([]);

    if (GAME.pendingPlay?.landingPoint) {
      const lp = worldToScreen(GAME.pendingPlay.landingPoint.x, GAME.pendingPlay.landingPoint.y, 0);
      ctx.strokeStyle = "rgba(255, 255, 255, 0.9)";
      ctx.beginPath();
      ctx.arc(lp.x, lp.y, 6, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(lp.x - 7, lp.y);
      ctx.lineTo(lp.x + 7, lp.y);
      ctx.moveTo(lp.x, lp.y - 7);
      ctx.lineTo(lp.x, lp.y + 7);
      ctx.stroke();
    }
  }
  ctx.restore();
}

function drawParticles() {
  GAME.particles.forEach((p) => {
    ctx.globalAlpha = Math.max(0, p.life / 0.7);
    ctx.fillStyle = p.color;
    ctx.fillRect(p.x, p.y, p.size, p.size);
    ctx.globalAlpha = 1;
  });
}

function drawBall() {
  drawBattedBall();
  drawPitchBall();
  drawThrowBall();
  drawParticles();
}

function drawThrowBall() {
  if (!GAME.throwBall) return;
  const tb = GAME.throwBall;
  ctx.save();
  ctx.fillStyle = "rgba(157, 235, 255, 0.28)";
  ctx.beginPath();
  ctx.arc(tb.x, tb.y, 8, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#ffffff";
  ctx.strokeStyle = "#1c2c46";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(tb.x, tb.y, 4.8, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

function drawHitTrajectory() {
  if (!GAME.battedBall) return;
  // Remove visible debug trajectory lines in clean gameplay mode.
}

function drawPlayCallout() {
  if (!GAME.playCallout) return;
  const life = GAME.playCallout.life;
  const alpha = Math.min(1, Math.max(0, life / 1.1));
  const yFloat = (1 - alpha) * 20;

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.font = "bold 32px 'Trebuchet MS', sans-serif";
  ctx.textAlign = "center";
  ctx.lineWidth = 5;
  ctx.strokeStyle = "rgba(16, 24, 40, 0.8)";
  ctx.strokeText(GAME.playCallout.text, GAME.width / 2, 86 - yFloat);
  ctx.fillStyle = GAME.playCallout.color;
  ctx.fillText(GAME.playCallout.text, GAME.width / 2, 86 - yFloat);
  ctx.restore();
}

function drawSwingFeedback() {
  if (!GAME.swingFeedback || GAME.swingFeedbackLife <= 0) return;
  const alpha = clampValue(GAME.swingFeedbackLife, 0, 1);
  const popY = 120 - (1 - alpha) * 16;
  const colorMap = {
    "VERY EARLY": "#ffb07a",
    "EARLY": "#ffd17a",
    "GOOD": "#9ae6ff",
    "PERFECT": "#9dff9a",
    "LATE": "#ffd17a",
    "VERY LATE": "#ffb07a",
    "MISS": "#ff9ca8"
  };
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.font = "bold 24px 'Trebuchet MS', sans-serif";
  ctx.textAlign = "center";
  ctx.lineWidth = 4;
  ctx.strokeStyle = "rgba(14, 20, 35, 0.82)";
  ctx.strokeText(GAME.swingFeedback, GAME.width / 2, popY);
  ctx.fillStyle = colorMap[GAME.swingFeedback] ?? "#dff7ff";
  ctx.fillText(GAME.swingFeedback, GAME.width / 2, popY);
  ctx.restore();
}

function drawAimMeters() {
  const leftPad = 18;
  const bottomPad = 20;
  const panelH = 102;
  const panelW = 250;
  const panelY = GAME.height - panelH - bottomPad;

  const selectedPitch = PITCH_TYPE_CONFIG[GAME.selectedPitchType] ?? PITCH_TYPE_CONFIG.fastball;

  ctx.fillStyle = "rgba(8, 18, 38, 0.9)";
  ctx.fillRect(leftPad, panelY, panelW, panelH);
  ctx.strokeStyle = "rgba(85, 214, 255, 0.8)";
  ctx.lineWidth = 2;
  ctx.strokeRect(leftPad, panelY, panelW, panelH);
  ctx.fillStyle = "#5ad8ff";
  ctx.font = "bold 24px 'Trebuchet MS', sans-serif";
  ctx.fillText("PITCH CONTROL", leftPad + 10, panelY + 26);

  ctx.fillStyle = "#f0f8ff";
  ctx.font = "22px 'Trebuchet MS', sans-serif";
  ctx.fillText("Aim (A/D):", leftPad + 16, panelY + 58);
  const meterX = leftPad + 96;
  const meterY = panelY + 46;
  const meterW = 144;
  const meterH = 16;
  ctx.fillStyle = "rgba(14, 40, 72, 0.95)";
  ctx.fillRect(meterX, meterY, meterW, meterH);
  ctx.fillStyle = "#66d9ff";
  const pitchAimNorm = clampValue((GAME.pitchAim + 1) / 2, 0, 1);
  ctx.fillRect(meterX + 1, meterY + 1, (meterW - 2) * pitchAimNorm, meterH - 2);
  ctx.strokeStyle = "rgba(130, 196, 245, 0.7)";
  ctx.strokeRect(meterX, meterY, meterW, meterH);

  ctx.fillStyle = "#f0f8ff";
  ctx.font = "30px 'Trebuchet MS', sans-serif";
  ctx.fillText(`Pitch: ${selectedPitch.key}`, leftPad + 16, panelY + 90);

  if (GAME.pitchCharge.active) {
    const chargeX = leftPad + 14;
    const chargeY = panelY - 14;
    const chargeW = panelW - 28;
    ctx.fillStyle = "rgba(8, 18, 38, 0.88)";
    ctx.fillRect(chargeX, chargeY, chargeW, 10);
    ctx.fillStyle = "#ffd86a";
    ctx.fillRect(chargeX + 1, chargeY + 1, (chargeW - 2) * GAME.pitchCharge.meter, 8);
    const perfectX = chargeX + chargeW * 0.52;
    ctx.fillStyle = "#7dffb4";
    ctx.fillRect(perfectX - 7, chargeY, 14, 10);
    ctx.strokeStyle = "rgba(255,255,255,0.3)";
    ctx.strokeRect(chargeX, chargeY, chargeW, 10);
  }

  const rightW = 230;
  const rightH = 102;
  const rightX = GAME.width - rightW - leftPad;
  const rightY = GAME.height - rightH - bottomPad;
  ctx.fillStyle = "rgba(8, 18, 38, 0.9)";
  ctx.fillRect(rightX, rightY, rightW, rightH);
  ctx.strokeStyle = "rgba(85, 214, 255, 0.8)";
  ctx.strokeRect(rightX, rightY, rightW, rightH);
  ctx.fillStyle = "#5ad8ff";
  ctx.font = "bold 24px 'Trebuchet MS', sans-serif";
  ctx.fillText("CONTACT", rightX + 62, rightY + 26);

  const meterLeft = rightX + 14;
  const meterTop = rightY + 44;
  const meterWidth = rightW - 28;
  const meterHeight = 22;
  ctx.fillStyle = "#df6e2f";
  ctx.fillRect(meterLeft, meterTop, meterWidth * 0.32, meterHeight);
  ctx.fillStyle = "#49e398";
  ctx.fillRect(meterLeft + meterWidth * 0.32, meterTop, meterWidth * 0.36, meterHeight);
  ctx.fillStyle = "#4ab8ff";
  ctx.fillRect(meterLeft + meterWidth * 0.68, meterTop, meterWidth * 0.32, meterHeight);
  ctx.strokeStyle = "rgba(255,255,255,0.22)";
  ctx.strokeRect(meterLeft, meterTop, meterWidth, meterHeight);

  const timingPos = GAME.timingMeter.active
    ? clampValue(GAME.timingMeter.progress, 0, 1)
    : clampValue((GAME.swingAim + 1) / 2, 0, 1);
  ctx.fillStyle = "#09111f";
  ctx.fillRect(meterLeft + timingPos * meterWidth - 2, meterTop - 2, 4, meterHeight + 4);
  ctx.fillStyle = "#f0f8ff";
  ctx.font = "18px 'Trebuchet MS', sans-serif";
  ctx.fillText("WEAK", meterLeft + 6, rightY + 90);
  ctx.fillText("GOOD", meterLeft + meterWidth * 0.4, rightY + 90);
  ctx.fillText("PERFECT", meterLeft + meterWidth * 0.76, rightY + 90);
}

function drawUI() {
  drawPlayCallout();
  drawSwingFeedback();
  drawAimMeters();
  if (DEBUG_STATE.enabled) {
    drawDebugOverlay();
  }
}

function clearCanvas() {
  ctx.clearRect(0, 0, GAME.width, GAME.height);
}

function render() {
  syncRenderLayout();
  const shake = GAME.cameraShake > 0 ? Math.sin(performance.now() * 0.1) * 6 : 0;
  ctx.save();
  clearCanvas();
  ctx.translate(shake - (GAME.cameraX ?? 0), -(GAME.cameraY ?? 0));

  drawBackground();
  drawField();
  drawBasesAndLines();
  // Hidden during gameplay by request (logic is still active).
  drawPitchTargetDebug();
  drawPlayers();
  drawBat();
  drawHitTrajectory();
  drawBall();
  ctx.restore();
  drawUI();

  if (GAME.flashTime > 0) {
    ctx.fillStyle = "rgba(255,232,120,0.28)";
    ctx.fillRect(0, 0, GAME.width, GAME.height);
  }
}

function throwToNearestBase() {
  const fielder = defensiveFielders[GAME.controlledFielder];
  if (!fielder) return;
  queueThrowToBase(nearestBaseKeyFromFielder(fielder));
}

function throwToNumber(key) {
  const map = { "1": "first", "2": "second", "3": "third", "4": "home" };
  const base = map[key];
  if (base) queueThrowToBase(base);
}

function handleKeyDown(event) {
  if (document.activeElement && ["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement.tagName)) {
    return;
  }
  const key = normalizeInputKey(event);
  if (!input.keys.has(key)) {
    input.justPressed.add(key);
  }
  input.keys.add(key);

  if (key === "`") {
    if (!DEBUG_FIELDING && !DEBUG) return;
    DEBUG_STATE.enabled = !DEBUG_STATE.enabled;
    setMessage(DEBUG_STATE.enabled ? "Debug overlay ON" : "Debug overlay OFF");
    return;
  }

  if (key === "Enter" && (GAME.mode === "start" || GAME.mode === "over")) {
    startGame();
    return;
  }

  if (PITCH_TYPE_BY_KEY[key]) {
    selectPitchTypeByKey(key);
  }

  if (key === "Space" || key === "/") {
    event.preventDefault();
  }

  if (GAME.mode === "play" && !GAME.battedBall && !pitchBall.active) {
    const batterController = getBattingController();
    const batterSwingKeys = (CONTROL_PRESETS[batterController] ?? CONTROL_PRESETS.player1).swing ?? [];
    if (batterSwingKeys.includes(key)) {
      GAME.swingBuffer = SWING_BUFFER_WINDOW;
      logInputEvent("Swing buffered");
    }
  }
}

function handleKeyUp(event) {
  const key = normalizeInputKey(event);
  if (input.keys.has(key)) {
    input.justReleased.add(key);
  }
  input.keys.delete(key);
}

let lastTime = 0;
function gameLoop(timestamp) {
  const dt = Math.min((timestamp - lastTime) / 1000, 0.033);
  lastTime = timestamp;
  update(dt);
  render();
  requestAnimationFrame(gameLoop);
}

buildSelectOptions();
startButton.addEventListener("click", startGame);
restartButton.addEventListener("click", startGame);
window.addEventListener("keydown", handleKeyDown);
window.addEventListener("keyup", handleKeyUp);
window.addEventListener("click", () => {
  if (document.activeElement !== document.body) {
    document.body.focus();
  }
});

updateHud();
render();
requestAnimationFrame(gameLoop);
