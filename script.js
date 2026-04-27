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
  homeY: 0.82,
  secondY: 0.42,
  baseSpread: 0.22,
  hudHeight: 70,
  bottomBarHeight: 60
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
  minExitVelocity: 300,
  maxExitVelocity: 980,
  launchAngles: {
    grounder: { min: -8, max: 11 },
    line: { min: 10, max: 27 },
    fly: { min: 28, max: 48 },
    pop: { min: 49, max: 66 }
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

const FIELDING_AI_TUNING = {
  gravity: 920,
  grounderFriction: 0.89,
  flyFriction: 0.93,
  pickupRadius: 18,
  airCatchRadius: 22,
  throwDelay: 0.6
};

const DEBUG = false;

const DEBUG_STATE = {
  enabled: DEBUG,
  lastConsoleLog: 0,
  consoleInterval: 0.75
};

function clampValue(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

const clamp = clampValue;

function lerp(a, b, t) {
  return a + (b - a) * clampValue(t, 0, 1);
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
      y: layout.homeY - (layout.homeY - layout.secondY) * 0.45
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

  batter.x = FIELD.home.x + 30;
  batter.y = FIELD.home.y - 46;
  pitcher.x = FIELD.mound.x - 10;
  pitcher.y = FIELD.mound.y - 46;
  const zoneWidth = 70;
  const zoneHeight = 90;
  const zoneX = FIELD.home.x + 30;
  const zoneY = FIELD.home.y - 95;
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
  }
}

function getStrikeZoneBounds() {
  if (GAME.strikeZone) return GAME.strikeZone;
  return {
    x: FIELD.home.x + 30,
    y: FIELD.home.y - 95,
    w: 70,
    h: 90,
    cx: FIELD.home.x + 65,
    cy: FIELD.home.y - 50
  };
}

const BASE_KEYS = ["home", "first", "second", "third"];

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
  runners: [false, false, false], // first, second, third
  pitchReady: false,
  pitchTimer: 0,
  nextPitchDelay: 0.75,
  pitchAim: 0,
  swingAim: 0,
  controlledFielder: 1,
  cameraShake: 0,
  particles: [],
  battedBall: null,
  pendingPlay: null,
  flashTime: 0,
  swingBuffer: 0,
  lastContactOffset: 0,
  playCallout: null,
  strikeZone: null,
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
    assignedFielder: "-",
    fielderTarget: "-"
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
  elapsed: 0,
  travelTime: 0.55,
  height: 0,
  shadowY: pitcher.y + 18,
  trail: [],
  trailClock: 0
};

const input = {
  keys: new Set()
};

const defensiveFielders = [];

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
    { role: "catcher", x: home.x - 12, y: home.y + 8 },
    { role: "first", x: first.x + 16, y: first.y - 12 },
    { role: "second", x: rightInfieldX, y: (first.y + second.y) / 2 - 6 },
    { role: "shortstop", x: leftInfieldX, y: (third.y + second.y) / 2 - 2 },
    { role: "third", x: third.x - 24, y: third.y - 10 },
    { role: "left", x: third.x - 84, y: third.y - 128 },
    { role: "center", x: second.x - 16, y: second.y - 150 },
    { role: "right", x: first.x + 84, y: first.y - 128 }
  ];

  defensiveFielders.length = 0;
  spots.forEach((spot, index) => {
    defensiveFielders.push({
      ...spot,
      homeX: spot.x,
      homeY: spot.y,
      x: spot.x,
      y: spot.y,
      targetX: spot.x,
      targetY: spot.y,
      state: "idle",
      speed: 160 + teamRating(defenseTeam, "fielding") * 130,
      skin: skin[index % skin.length],
      hair: hair[index % hair.length]
    });
  });
  GAME.controlledFielder = 1;
}

function resetPitchBall() {
  pitchBall.active = false;
  pitchBall.visible = false;
  pitchBall.state = "idle";
  pitchBall.swingAttempted = false;
  pitchBall.x = pitcher.x + 16;
  pitchBall.y = pitcher.y + 18;
  pitchBall.vx = 0;
  pitchBall.vy = 0;
  pitchBall.curve = 0;
  pitchBall.judged = false;
  const zone = getStrikeZoneBounds();
  pitchBall.targetX = zone.cx;
  pitchBall.targetY = zone.cy;
  pitchBall.elapsed = 0;
  pitchBall.travelTime = 0.6;
  pitchBall.trail.length = 0;
  pitchBall.trailClock = 0;
  batter.activeSwing = false;
  batter.swingTime = 0;
  GAME.swingBuffer = 0;
  GAME.debugInfo.hitDetected = "false";
  GAME.pitchTimer = 0;
  GAME.nextPitchDelay = PITCH_DELAY_TUNING.resetMin + Math.random() * PITCH_DELAY_TUNING.resetRange;
}

function updateHud() {
  inningValue.textContent = String(GAME.inning);
  halfValue.textContent = GAME.half;
  ballsValue.textContent = String(GAME.balls);
  strikesValue.textContent = String(GAME.strikes);
  outsValue.textContent = String(GAME.outs);

  awayTeamName.textContent = GAME.teams.away.name;
  homeTeamName.textContent = GAME.teams.home.name;
  awayScoreValue.textContent = String(GAME.scores.away);
  homeScoreValue.textContent = String(GAME.scores.home);
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
  GAME.pitchReady = true;
  GAME.pitchTimer = 0;
  GAME.nextPitchDelay = PITCH_DELAY_TUNING.initial;
  GAME.pitchAim = 0;
  GAME.swingAim = 0;
  GAME.cameraShake = 0;
  GAME.particles = [];
  GAME.battedBall = null;
  GAME.pendingPlay = null;
  GAME.flashTime = 0;
  GAME.swingBuffer = 0;
  GAME.playCallout = null;
  clearBases();
  resetCount();
  resetPitchBall();
  setupDefense();
  startScreen.classList.add("hidden");
  gameOverScreen.classList.add("hidden");
  updateHud();
  setMessage("Top 1: Auto-pitch enabled. Press SPACE to swing.");
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
  GAME.swingBuffer = 0;
  GAME.playCallout = null;
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

  setupDefense();
  updateHud();
  setMessage(`${GAME.half.toUpperCase()} ${GAME.inning}: Auto-pitch enabled. Press SPACE to swing.`);
}

function addOut(reason) {
  GAME.outs += 1;
  resetCount();
  resetPitchBall();
  GAME.battedBall = null;
  GAME.pendingPlay = null;
  GAME.swingBuffer = 0;
  GAME.playCallout = null;
  GAME.pitchReady = true;
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
  if (contactNorm <= -0.38) category = "grounder";
  else if (contactNorm >= 0.62) category = "pop";
  else if (Math.abs(contactNorm) <= 0.22 && timingQuality > 0.42) category = "line";
  else if (contactNorm > 0.22) category = "fly";
  else if (contactNorm < -0.22) category = "grounder";

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
  const pullBase = -18;
  const oppoBase = 18;
  const timingYaw = timingNorm >= 0
    ? pullBase * Math.abs(timingNorm)
    : oppoBase * Math.abs(timingNorm);
  const aimYaw = GAME.swingAim * 16;
  const sprayYaw = randomRange(-8, 8);
  const yawDeg = timingYaw + aimYaw + sprayYaw;

  // Exit velocity from timing + contact quality.
  const contactQuality = 1 - Math.min(1, Math.abs(contactNorm));
  const rawQuality = clamp(
    0.58 * timingQuality + 0.42 * contactQuality + randomRange(-0.08, 0.08),
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
    flightType: category === "pop" ? "fly" : category,
    launchAngle: launchAngleDeg,
    exitVelocity,
    directionVector
  };
}

function pitchInStrikeZone(y) {
  const zone = getStrikeZoneBounds();
  return y >= zone.y && y <= (zone.y + zone.h);
}

function spawnPitch() {
  const fieldingTeam = GAME.teams[GAME.fieldingSide];
  const pitchRating = teamRating(fieldingTeam, "pitching");
  const speed = lerp(PITCH_TUNING.speedMin, PITCH_TUNING.speedMax, pitchRating) + randomRange(-18, 30);
  const zone = getStrikeZoneBounds();
  const strikeChance = 0.47 + pitchRating * 0.28;
  const strikesPitch = Math.random() < strikeChance;

  const startX = pitcher.x + 14;
  const startY = pitcher.y + 16;
  const zoneTop = zone.y + 4;
  const zoneBottom = zone.y + zone.h - 4;
  const zoneLeft = zone.x + 8;
  const zoneRight = zone.x + zone.w - 8;
  let targetX = zone.cx;
  let targetY;
  if (strikesPitch) {
    targetX = randomRange(zoneLeft, zoneRight);
    targetY = zoneTop + Math.random() * (zoneBottom - zoneTop);
  } else if (Math.random() < 0.5) {
    targetX = randomRange(zoneLeft - 18, zoneRight + 18);
    targetY = zoneTop - (12 + Math.random() * 26);
  } else {
    targetX = randomRange(zoneLeft - 18, zoneRight + 18);
    targetY = zoneBottom + (12 + Math.random() * 26);
  }
  const dx = targetX - startX;
  const dy = targetY - startY;
  const distance = Math.hypot(dx, dy);
  const travelTime = Math.max(0.9, Math.min(1.4, distance / Math.max(165, speed)));
  const curveAmount = randomRange(-PITCH_TUNING.curveStrength, PITCH_TUNING.curveStrength) + GAME.pitchAim * 40;
  const midControlX = startX + dx * 0.52 + curveAmount;
  const midControlY = startY + dy * 0.47 + randomRange(-18, 18);

  pitchBall.active = true;
  pitchBall.visible = true;
  pitchBall.state = "pitch";
  pitchBall.swingAttempted = false;
  pitchBall.x = startX;
  pitchBall.y = startY;
  pitchBall.vx = dx / travelTime;
  pitchBall.vy = dy / travelTime;
  pitchBall.curve = curveAmount;
  pitchBall.judged = false;
  pitchBall.targetX = targetX;
  pitchBall.targetY = targetY;
  pitchBall.controlX = midControlX;
  pitchBall.controlY = midControlY;
  pitchBall.elapsed = 0;
  pitchBall.travelTime = travelTime;
  pitchBall.trail.length = 0;
  pitchBall.trailClock = 0;
  GAME.pitchReady = false;
  GAME.pitchTimer = 0;
  GAME.swingBuffer = 0;
  GAME.debugInfo.hitDetected = "false";
  GAME.debugInfo.pitchTarget = `${Math.round(targetX)}, ${Math.round(targetY)}`;
  GAME.debugInfo.strikeZone = `${Math.round(zone.x)},${Math.round(zone.y)} ${Math.round(zone.w)}x${Math.round(zone.h)}`;
  pitcher.windup = 0.18;
}

function launchBattedBall(type, hitPhysics = null, flightTypeOverride) {
  const startX = FIELD.home.x - 12;
  const startY = batter.y + 20;
  let physics = hitPhysics;
  if (!physics) {
    const launchConfig = {
      grounder: { angle: randomRange(-6, 8), exit: randomRange(320, 480), flightType: "grounder" },
      single: { angle: randomRange(9, 20), exit: randomRange(420, 650), flightType: "line" },
      double: { angle: randomRange(18, 30), exit: randomRange(560, 760), flightType: "line" },
      triple: { angle: randomRange(28, 38), exit: randomRange(650, 850), flightType: "fly" },
      homer: { angle: randomRange(34, 48), exit: randomRange(760, 980), flightType: "fly" }
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
  const horizontalSpeed = lerp(260, 640, speedScale) * Math.cos(launchRad);
  const verticalSpeed = lerp(220, 700, speedScale) * Math.sin(launchRad);
  const flightType = flightTypeOverride ?? physics.flightType ?? (physics.launchAngle > 48 ? "pop" : "fly");

  const launchDefaults = {
    grounder: { vx: 6 * 60, vy: -3 * 60, vz: 0 },
    line: { vx: 7 * 60, vy: -6 * 60, vz: 2 * 60 },
    fly: { vx: 5 * 60, vy: -7 * 60, vz: 6 * 60 }
  };
  const defaultVel = launchDefaults[flightType] ?? launchDefaults.line;
  const vx = Number.isFinite(physics.directionVector.x * horizontalSpeed) ? physics.directionVector.x * horizontalSpeed : defaultVel.vx;
  const vy = Number.isFinite(physics.directionVector.y * horizontalSpeed) ? physics.directionVector.y * horizontalSpeed : defaultVel.vy;
  const vz = Number.isFinite(verticalSpeed) ? verticalSpeed : defaultVel.vz;

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
    type,
    state: "hit",
    visible: true,
    landed: false,
    fielded: false,
    fieldedBy: null,
    trail: []
  };

  GAME.pendingPlay = {
    resolved: false,
    elapsed: 0,
    result: type,
    assignedFielder: -1,
    targetBase: null,
    throwTimer: 0,
    catchAttempted: false
  };
  createBurst(startX, startY, "#ffffff", 10);
  showPlayCallout(type === "homer" ? "CRACK!" : "IN PLAY", "info");
  GAME.debugInfo.hitType = `${type}/${flightType}`;
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

  if (distance >= 55) {
    GAME.debugInfo.hitDetected = "false";
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
    launchBattedBall(hitType, hitPhysics);
    registerHit(hitType);
    createBurst(ballX, ballY, "#ffe27a", 14);
    resetPitchBall();
    return;
  }

  if (dx <= goodWindow && dy <= 42 + contact * 16) {
    const hitPhysics = calculateHitPhysics({ ballX, ballY });
    const outcomeRoll = Math.random();
    if (outcomeRoll < 0.08 + power * 0.18) {
      launchBattedBall("homer", hitPhysics);
      registerHit("homer");
    } else if (outcomeRoll < 0.22 + power * 0.3) {
      launchBattedBall("triple", hitPhysics);
      registerHit("triple");
    } else if (outcomeRoll < 0.54 + power * 0.24) {
      launchBattedBall("double", hitPhysics);
      registerHit("double");
    } else {
      launchBattedBall("single", hitPhysics);
      registerHit("single");
    }
    createBurst(ballX, ballY, "#8fffc8", 10);
    resetPitchBall();
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
    resetPitchBall();
    return;
  }
  if (weakRoll < 0.7) {
    const hitPhysics = calculateHitPhysics({ ballX, ballY });
    launchBattedBall("single", hitPhysics);
    registerHit("single");
    createBurst(ballX, ballY, "#c6ffd8", 8);
    resetPitchBall();
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
  if (pitchBall.judged || pitchBall.swingAttempted) return;
  console.log("SWING");
  batter.activeSwing = true;
  batter.swingTime = batter.swingDuration;
  pitchBall.swingAttempted = true;
  resolveSwing(pitchBall.x, pitchBall.y);
}

function handlePitchInput() {
  if (GAME.mode !== "play" || !GAME.pitchReady || GAME.battedBall) return;
  spawnPitch();
}

function resolveTakenPitch() {
  pitchBall.judged = true;
  if (pitchBall.swingAttempted) {
    addStrike("Swing and miss.");
    return;
  }
  if (pitchInStrikeZone(pitchBall.y)) {
    addStrike("Called strike.");
  } else {
    addBall("Ball.");
  }
}

function updatePitchAim(dt) {
  let aimInput = 0;
  if (input.keys.has("ArrowLeft") || input.keys.has("a")) aimInput -= 1;
  if (input.keys.has("ArrowRight") || input.keys.has("d")) aimInput += 1;
  GAME.pitchAim += aimInput * dt * 1.6;
  GAME.pitchAim = Math.max(-1, Math.min(1, GAME.pitchAim));
  GAME.swingAim += aimInput * dt * 1.6;
  GAME.swingAim = Math.max(-1, Math.min(1, GAME.swingAim));
}

function updateFieldingInput(dt) {
  if (GAME.mode !== "play") return;
  if (!GAME.battedBall) return;

  const fielder = defensiveFielders[GAME.controlledFielder];
  if (!fielder) return;

  let dx = 0;
  let dy = 0;
  if (input.keys.has("ArrowUp") || input.keys.has("w")) dy -= 1;
  if (input.keys.has("ArrowDown") || input.keys.has("s")) dy += 1;
  if (input.keys.has("ArrowLeft") || input.keys.has("a")) dx -= 1;
  if (input.keys.has("ArrowRight") || input.keys.has("d")) dx += 1;

  const len = Math.hypot(dx, dy);
  if (len > 0) {
    const speed = fielder.speed * dt;
    fielder.x += (dx / len) * speed;
    fielder.y += (dy / len) * speed;
  }
}

function getRoleHomeTarget(fielder, ballObj = null) {
  if (!ballObj) return { x: fielder.homeX, y: fielder.homeY };
  const role = fielder.role;
  if (role === "first" && ballObj.flightType === "grounder") {
    return { x: FIELD.first.x + 10, y: FIELD.first.y - 10 };
  }
  if (role === "catcher") {
    if ((ballObj.groundY ?? ballObj.y) > FIELD.home.y + 8) {
      return { x: ballObj.x, y: ballObj.groundY ?? ballObj.y };
    }
    return { x: fielder.homeX, y: fielder.homeY };
  }
  if (role === "pitcher") {
    return { x: FIELD.mound.x - 8, y: FIELD.mound.y - 12 };
  }
  if (["left", "center", "right"].includes(role)) {
    const inOutfield = (ballObj.groundY ?? ballObj.y) < FIELD.second.y - 20;
    if (inOutfield) {
      return { x: ballObj.x, y: ballObj.groundY ?? ballObj.y };
    }
  }
  return { x: fielder.homeX, y: fielder.homeY };
}

function findAssignedFielderForBall(ballObj) {
  const landingY = ballObj.groundY ?? ballObj.y;
  let winner = 0;
  let winnerDist = Number.POSITIVE_INFINITY;
  defensiveFielders.forEach((fielder, idx) => {
    const roleTarget = getRoleHomeTarget(fielder, ballObj);
    const roleBias = (idx === 0 ? 1.08 : 1);
    const d = Math.hypot(roleTarget.x - ballObj.x, roleTarget.y - landingY) * roleBias;
    if (d < winnerDist) {
      winnerDist = d;
      winner = idx;
    }
  });
  return winner;
}

function executeFieldedBallResult(fieldingRole, ballObj) {
  if (!GAME.pendingPlay || GAME.pendingPlay.resolved) return;
  const role = fieldingRole ?? "fielder";
  const isAirCatch = !ballObj.landed && ballObj.height > 8;
  if (isAirCatch) {
    GAME.pendingPlay.resolved = true;
    showPlayCallout("OUT", "out");
    addOut(`${role.toUpperCase()} made the catch.`);
    GAME.battedBall = null;
    return;
  }

  const infieldRole = ["pitcher", "catcher", "first", "second", "shortstop", "third"].includes(role);
  GAME.pendingPlay.targetBase = infieldRole ? "first" : "second";
  GAME.pendingPlay.throwTimer = FIELDING_AI_TUNING.throwDelay;
  GAME.pendingPlay.result = infieldRole ? "grounderOut" : "single";
  GAME.pendingPlay.resolved = true;
  const throwText = infieldRole ? "Throw to first..." : "Relay throw to second...";
  showPlayCallout("FIELD", "warn");
  setMessage(`${role.toUpperCase()} fielded it. ${throwText}`);
  GAME.battedBall = null;
  GAME.pitchReady = true;
  GAME.pitchTimer = 0;
  GAME.nextPitchDelay = PITCH_DELAY_TUNING.afterPlayMin + Math.random() * PITCH_DELAY_TUNING.afterPlayRange;
}

function updateDebugState(dt) {
  const strike = getStrikeZoneBounds();
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
  GAME.debugInfo.assignedFielder = assigned >= 0 ? `${assigned}:${defensiveFielders[assigned]?.role ?? "?"}` : "-";
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
        pitchTarget: GAME.debugInfo.pitchTarget,
        strikeZone: GAME.debugInfo.strikeZone,
        ball: GAME.debugInfo.ball,
        ballHeight: GAME.debugInfo.ballHeight,
        ballState: GAME.debugInfo.ballState,
        pitchActive: GAME.debugInfo.pitchActive,
        swingActive: GAME.debugInfo.swingActive,
        hitDetected: GAME.debugInfo.hitDetected,
        hitType: GAME.debugInfo.hitType,
        assignedFielder: GAME.debugInfo.assignedFielder,
        fielderTarget: GAME.debugInfo.fielderTarget
      });
    }
  } else {
    DEBUG_STATE.lastConsoleLog = 0;
  }
}

function resolveThrow(baseKey) {
  if (!GAME.pendingPlay || GAME.pendingPlay.resolved) return;
  const result = GAME.pendingPlay.result;
  if (!["grounderOut", "single", "double", "triple"].includes(result)) return;
  const defenseTeam = GAME.teams[GAME.fieldingSide];
  const fieldQuality = teamRating(defenseTeam, "fielding");
  const throwChance = 0.44 + fieldQuality * 0.3;
  const success = Math.random() < throwChance;

  if (!success) {
    GAME.pendingPlay.resolved = true;
    showPlayCallout("SAFE", "safe");
    setMessage(`Throw to ${baseKey} skipped wide. Safe.`);
    return;
  }

  if (result === "grounderOut") {
    GAME.pendingPlay.resolved = true;
    showPlayCallout("OUT", "out");
    addOut(`Out at ${baseKey}!`);
    return;
  }

  GAME.pendingPlay.resolved = true;
  showPlayCallout("SAFE", "safe");
  setMessage(`Throw to ${baseKey}. Runner beats it.`);
}

function updateBattedBall(dt) {
  if (!GAME.battedBall) return;
  const ballObj = GAME.battedBall;
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

  if (GAME.pendingPlay && !GAME.pendingPlay.resolved && GAME.pendingPlay.assignedFielder < 0) {
    GAME.pendingPlay.assignedFielder = findAssignedFielderForBall(ballObj);
    GAME.controlledFielder = GAME.pendingPlay.assignedFielder;
  }

  if (GAME.pendingPlay && GAME.pendingPlay.assignedFielder >= 0 && !ballObj.fielded) {
    const fielder = defensiveFielders[GAME.pendingPlay.assignedFielder];
    if (fielder) {
      const dist = Math.hypot(fielder.x - ballObj.x, fielder.y - ballObj.groundY);
      const catchRadius = (!ballObj.landed && ballObj.height > 10)
        ? FIELDING_AI_TUNING.airCatchRadius
        : FIELDING_AI_TUNING.pickupRadius;
      if (dist <= catchRadius) {
        ballObj.fielded = true;
        ballObj.fieldedBy = GAME.pendingPlay.assignedFielder;
        executeFieldedBallResult(fielder.role, ballObj);
      }
    }
  }

  const movingSpeed = Math.hypot(ballObj.vx, ballObj.vy) + Math.abs(ballObj.vz);
  if (!ballObj.fielded && ballObj.landed && movingSpeed < 18) {
    if (GAME.pendingPlay && !GAME.pendingPlay.resolved) {
      GAME.pendingPlay.resolved = true;
      showPlayCallout("SAFE", "safe");
      setMessage("Ball gets through for a hit.");
    }
    GAME.battedBall = null;
    GAME.pitchReady = true;
    GAME.pitchTimer = 0;
    GAME.nextPitchDelay = PITCH_DELAY_TUNING.afterPlayMin + Math.random() * PITCH_DELAY_TUNING.afterPlayRange;
  }
}

function updateFielders(dt) {
  const defenseTeam = GAME.teams[GAME.fieldingSide];
  const fieldReaction = teamRating(defenseTeam, "fielding");
  const ballObj = GAME.battedBall;
  defensiveFielders.forEach((f, idx) => {
    let target = getRoleHomeTarget(f, ballObj);
    if (ballObj && GAME.pendingPlay?.assignedFielder === idx && !ballObj.fielded) {
      target = { x: ballObj.x, y: ballObj.groundY ?? ballObj.y };
      f.state = "chase";
    } else if (ballObj) {
      f.state = "backup";
    } else {
      f.state = "idle";
    }
    f.targetX = target.x;
    f.targetY = target.y;
    const dx = target.x - f.x;
    const dy = target.y - f.y;
    const d = Math.hypot(dx, dy);
    if (d < 0.2) return;
    const step = (f.speed * (0.62 + fieldReaction * 0.54)) * dt;
    if (d <= step) {
      f.x = target.x;
      f.y = target.y;
      return;
    }
    f.x += (dx / d) * step;
    f.y += (dy / d) * step;
  });
}

function update(dt) {
  if (GAME.mode !== "play") {
    updateParticles(dt);
    return;
  }

  updatePitchAim(dt);
  updateFieldingInput(dt);
  updateFielders(dt);
  updateBattedBall(dt);
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
    if (GAME.playCallout.life <= 0) {
      GAME.playCallout = null;
    }
  }
  if (GAME.swingBuffer > 0) {
    GAME.swingBuffer -= dt;
  }

  if (GAME.pitchReady && !GAME.battedBall && !pitchBall.active) {
    GAME.pitchTimer += dt;
    if (GAME.pitchTimer >= GAME.nextPitchDelay) {
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
    pitchBall.elapsed += dt;
    const t = Math.min(1, pitchBall.elapsed / Math.max(0.001, pitchBall.travelTime));
    const inv = 1 - t;
    pitchBall.x = inv * inv * (pitcher.x + 14) + 2 * inv * t * pitchBall.controlX + t * t * pitchBall.targetX;
    pitchBall.y = inv * inv * (pitcher.y + 16) + 2 * inv * t * pitchBall.controlY + t * t * pitchBall.targetY;
    pitchBall.shadowY = pitchBall.y + 16;
    pitchBall.height = Math.sin(t * Math.PI) * 16;
    pitchBall.trailClock += dt;
    if (pitchBall.trailClock >= 0.03) {
      pitchBall.trailClock = 0;
      pitchBall.trail.push({ x: pitchBall.x, y: pitchBall.y });
      if (pitchBall.trail.length > BALL_VISUAL_TUNING.pitchTrailMax) {
        pitchBall.trail.shift();
      }
    }
    GAME.debugInfo.ball = `${Math.round(pitchBall.x)}, ${Math.round(pitchBall.y)}`;
    GAME.debugInfo.ballHeight = `${Math.round(pitchBall.height)}`;

    if ((t >= 0.98 || pitchBall.x >= pitchBall.targetX - 1) && !pitchBall.judged) {
      resolveTakenPitch();
    }

    if (t >= 1.08 || pitchBall.x > GAME.width + 40 || pitchBall.y < -40 || pitchBall.y > GAME.height + 40) {
      resetPitchBall();
      GAME.pitchReady = true;
    }
  }

  updateDebugState(dt);
}

function drawBackground() {
  const bounds = RENDER_LAYOUT.fieldRect;
  const top = Math.max(0, bounds.top - 34);
  const sky = ctx.createLinearGradient(0, 0, 0, bounds.bottom);
  sky.addColorStop(0, "#8ac9ff");
  sky.addColorStop(0.42, "#4f84c9");
  sky.addColorStop(1, "#245a96");
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, GAME.width, bounds.bottom + 30);

  ctx.fillStyle = "#1d3255";
  ctx.fillRect(0, top - 20, GAME.width, 24);
  ctx.fillStyle = "#263f68";
  ctx.fillRect(0, top + 4, GAME.width, 20);

  for (let x = 0; x < GAME.width; x += 10) {
    ctx.fillStyle = x % 20 === 0 ? "#53d0ff" : "#f2b0ff";
    ctx.fillRect(x, top + 8 + ((x / 10) % 2), 4, 5);
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
  grass.addColorStop(0, "#2f965f");
  grass.addColorStop(1, "#206d47");
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
  for (let x = -160; x < GAME.width + 220; x += 42) {
    ctx.fillStyle = "rgba(255,255,255,0.065)";
    ctx.beginPath();
    ctx.moveTo(x, bounds.top - 10);
    ctx.lineTo(x + 16, bounds.top - 10);
    ctx.lineTo(x + 200, GAME.height + 10);
    ctx.lineTo(x + 184, GAME.height + 10);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();

  // Infield dirt diamond
  ctx.fillStyle = "#c99660";
  ctx.beginPath();
  ctx.moveTo(home.x, home.y + 30);
  ctx.lineTo(third.x - 70, third.y + 6);
  ctx.lineTo(second.x, second.y - 66);
  ctx.lineTo(first.x + 70, first.y + 6);
  ctx.closePath();
  ctx.fill();
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
  ctx.strokeStyle = "#e3c68c";
  ctx.lineWidth = 6;
  ctx.lineJoin = "round";
  ctx.beginPath();
  ctx.moveTo(home.x, home.y);
  ctx.lineTo(first.x, first.y);
  ctx.lineTo(second.x, second.y);
  ctx.lineTo(third.x, third.y);
  ctx.closePath();
  ctx.stroke();

  // Foul lines
  ctx.strokeStyle = "rgba(255,255,255,0.9)";
  ctx.lineWidth = 2;
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
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(Math.PI / 4);
  ctx.fillStyle = "rgba(0,0,0,0.18)";
  ctx.fillRect(-9, -7, 18, 18);
  ctx.fillStyle = "#fff8e8";
  ctx.fillRect(-9, -9, 18, 18);
  ctx.strokeStyle = "#d5cbaf";
  ctx.lineWidth = 2;
  ctx.strokeRect(-9, -9, 18, 18);
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
  ctx.strokeRect(homeX - 90, homeY - 40, 70, 66);
}

function drawStrikeZone() {
  const zone = getStrikeZoneBounds();
  ctx.save();
  ctx.strokeStyle = "rgba(255,255,255,0.9)";
  ctx.fillStyle = "rgba(255,255,255,0.08)";
  ctx.lineWidth = 2;
  ctx.fillRect(zone.x, zone.y, zone.w, zone.h);
  ctx.strokeRect(zone.x, zone.y, zone.w, zone.h);
  ctx.restore();
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

  ctx.fillStyle = "rgba(0,0,0,0.24)";
  ctx.fillRect(x + 2, y + 27, 16, 5);

  ctx.fillStyle = skin;
  ctx.fillRect(x + 3, y - 7, headSize, 11);
  ctx.strokeStyle = "rgba(22, 22, 32, 0.82)";
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 3, y - 7, headSize, 11);

  ctx.fillStyle = hair;
  ctx.fillRect(x + 3, y - 9, headSize, 3);
  ctx.fillStyle = palette.cap;
  ctx.fillRect(x + 3, y - 12, headSize, 4);

  ctx.fillStyle = "#1a1a1a";
  ctx.fillRect(x + 6, y - 2, 2, 2);
  ctx.fillRect(x + 11, y - 2, 2, 2);
  ctx.fillRect(x + 8, y + 1, 3, 1);

  ctx.fillStyle = palette.jersey;
  ctx.fillRect(x + 2, y + 2, 16, 17);
  ctx.fillStyle = palette.trim;
  ctx.fillRect(x + 2, y + 2, 16, 3);
  ctx.strokeStyle = "rgba(20, 24, 34, 0.9)";
  ctx.strokeRect(x + 2, y + 2, 16, 17);

  ctx.fillStyle = "#18203a";
  ctx.fillRect(x + 3, y + 19, 5, 9);
  ctx.fillRect(x + 12, y + 19, 5, 9);

  ctx.fillStyle = skin;
  if (direction > 0) {
    ctx.fillRect(x + 17, y + 9, 5, 4);
  } else {
    ctx.fillRect(x - 2, y + 9, 5, 4);
  }

  if (selected) {
    ctx.strokeStyle = "#ffe46f";
    ctx.lineWidth = 2;
    ctx.strokeRect(x - 2, y - 14, 24, 44);
  }
}

function drawPitcher() {
  const team = GAME.teams[GAME.fieldingSide];
  const wobble = Math.sin(performance.now() * 0.015) * (pitcher.windup > 0 ? 4 : 1.5);
  drawPlayer(
    pitcher.x + wobble,
    pitcher.y,
    team,
    { skin: "#dca37f", hair: "#3d2414" },
    1,
    true,
    false
  );
}

function drawBatter() {
  const team = GAME.teams[GAME.battingSide];
  drawPlayer(
    batter.x,
    batter.y,
    team,
    { skin: "#f2c7a3", hair: "#2f1c13" },
    -1,
    true,
    false
  );
}

function drawBat() {
  const swingProgress = batter.activeSwing
    ? 1 - batter.swingTime / batter.swingDuration
    : 0;
  const angle = batter.activeSwing
    ? degreesToRadians(-40 + swingProgress * 110)
    : degreesToRadians(-40);
  const handX = batter.x + 14;
  const handY = batter.y + 13;

  ctx.save();
  ctx.translate(handX, handY);
  ctx.rotate(angle);
  ctx.fillStyle = batter.batColor;
  // Small local bat: 40x6, never leaves batter zone.
  ctx.fillRect(-34, -3, 40, 6);
  ctx.restore();
}

function drawFielders() {
  const team = GAME.teams[GAME.fieldingSide];
  const sorted = [...defensiveFielders].sort((a, b) => a.y - b.y);
  sorted.forEach((fielder) => {
    const index = defensiveFielders.indexOf(fielder);
    drawPlayer(
      fielder.x,
      fielder.y,
      team,
      { skin: fielder.skin, hair: fielder.hair },
      1,
      true,
      GAME.battedBall && index === GAME.controlledFielder
    );
  });
}

function drawPlayers() {
  drawPitcher();
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
  const radius = BALL_VISUAL_TUNING.battedRadius;
  const shadowAlpha = clampValue(0.34 - (ballObj.height / 260), 0.08, 0.34);

  ctx.fillStyle = `rgba(0,0,0,${shadowAlpha})`;
  ctx.beginPath();
  ctx.ellipse(
    ballObj.x,
    ballObj.groundY + 5,
    Math.max(4, radius + 1 - ballObj.height * 0.012),
    Math.max(2, radius - 2 - ballObj.height * 0.016),
    0,
    0,
    Math.PI * 2
  );
  ctx.fill();

  if (Array.isArray(ballObj.trail) && ballObj.trail.length > 0) {
    ballObj.trail.forEach((tp, index) => {
      const fade = (index + 1) / ballObj.trail.length;
      ctx.fillStyle = `rgba(255,255,255,${0.16 * fade})`;
      ctx.beginPath();
      ctx.arc(tp.x, tp.y, radius * (0.6 * fade), 0, Math.PI * 2);
      ctx.fill();
    });
  }

  if (flight === "grounder") {
    ctx.strokeStyle = "#25334f";
    ctx.lineWidth = 2;
    ctx.fillStyle = "#fffef2";
    ctx.beginPath();
    ctx.arc(ballObj.x, ballObj.y, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    return;
  }

  if (flight === "line") {
    ctx.strokeStyle = "#25334f";
    ctx.lineWidth = 2;
    ctx.fillStyle = "#fffef2";
    ctx.beginPath();
    ctx.arc(ballObj.x, ballObj.y, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    return;
  }

  ctx.strokeStyle = "#25334f";
  ctx.lineWidth = 2;
  ctx.fillStyle = "#fffef2";
  ctx.beginPath();
  ctx.arc(ballObj.x, ballObj.y, radius, 0, Math.PI * 2);
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
  const r = BALL_VISUAL_TUNING.pitchRadius;

  if (Array.isArray(pitchBall.trail) && pitchBall.trail.length > 0) {
    pitchBall.trail.forEach((tp, index) => {
      const fade = (index + 1) / pitchBall.trail.length;
      ctx.fillStyle = `rgba(180,230,255,${0.22 * fade})`;
      ctx.beginPath();
      ctx.arc(tp.x, tp.y, Math.max(2, r * 0.58 * fade), 0, Math.PI * 2);
      ctx.fill();
    });
  }

  const shadowAlpha = clampValue(0.32 - (pitchBall.height / 180), 0.09, 0.32);
  ctx.fillStyle = `rgba(0,0,0,${shadowAlpha})`;
  ctx.beginPath();
  ctx.ellipse(
    pitchBall.x,
    pitchBall.shadowY + 4,
    Math.max(4, r + 1 - pitchBall.height * 0.014),
    Math.max(2, r - 2 - pitchBall.height * 0.018),
    0,
    0,
    Math.PI * 2
  );
  ctx.fill();

  ctx.fillStyle = "rgba(167, 232, 255, 0.32)";
  ctx.beginPath();
  ctx.arc(pitchBall.x, pitchBall.y, r + 5, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "#ffffff";
  ctx.strokeStyle = "#23304a";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(pitchBall.x, pitchBall.y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
}

function drawDebugOverlay() {
  const lines = [
    `Pitch active: ${GAME.debugInfo.pitchActive}`,
    `Swing active: ${GAME.debugInfo.swingActive}`,
    `Hit detected: ${GAME.debugInfo.hitDetected}`,
    `Ball state: ${GAME.debugInfo.ballState}`,
    `Pitch target: ${GAME.debugInfo.pitchTarget}`,
    `Strike zone: ${GAME.debugInfo.strikeZone}`,
    `Ball: ${GAME.debugInfo.ball}`,
    `Ball h: ${GAME.debugInfo.ballHeight}`,
    `Hit type: ${GAME.debugInfo.hitType}`,
    `Assigned fielder: ${GAME.debugInfo.assignedFielder}`,
    `Fielder target: ${GAME.debugInfo.fielderTarget}`
  ];
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
  if (!DEBUG_STATE.enabled || !pitchBall.active) return;
  ctx.save();
  ctx.strokeStyle = "rgba(173, 227, 255, 0.68)";
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.moveTo(pitcher.x + 14, pitcher.y + 16);
  ctx.lineTo(pitchBall.targetX, pitchBall.targetY);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.strokeStyle = "rgba(173, 227, 255, 0.88)";
  ctx.beginPath();
  ctx.arc(pitchBall.targetX, pitchBall.targetY, 4, 0, Math.PI * 2);
  ctx.stroke();
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
  drawParticles();
}

function drawHitTrajectory() {
  if (!GAME.battedBall) return;
  const ballObj = GAME.battedBall;
  const life = Math.max(0, 1 - (ballObj.elapsed / 1.2));
  const alpha = 0.32 * life;
  ctx.save();
  ctx.strokeStyle = `rgba(255, 255, 255, ${alpha})`;
  ctx.lineWidth = 1.25;
  ctx.beginPath();
  const startX = ballObj.startX ?? ballObj.x;
  const startY = ballObj.startY ?? ballObj.groundY ?? ballObj.y;
  ctx.moveTo(startX, startY);
  const shortX = startX + (ballObj.x - startX) * 0.3;
  const shortY = startY + ((ballObj.groundY ?? ballObj.y) - startY) * 0.3;
  ctx.lineTo(shortX, shortY);
  ctx.stroke();
  ctx.restore();
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

function drawAimMeters() {
  const leftPad = 14;
  const bottomPad = 14;
  const panelH = 44;
  const panelW = 292;
  const panelY = GAME.height - panelH - bottomPad;

  ctx.fillStyle = "rgba(9, 18, 34, 0.86)";
  ctx.fillRect(leftPad, panelY, panelW, panelH);
  ctx.strokeStyle = "rgba(83, 210, 255, 0.58)";
  ctx.lineWidth = 2;
  ctx.strokeRect(leftPad, panelY, panelW, panelH);

  ctx.fillStyle = "#dff7ff";
  ctx.font = "12px 'Trebuchet MS', sans-serif";
  ctx.fillText("Aim (A/D):", leftPad + 10, panelY + 16);
  ctx.fillText(`Pitch ${Math.round(GAME.pitchAim * 100)}`, leftPad + 10, panelY + 31);

  const meterTrackX = leftPad + 104;
  const meterTrackY = panelY + 24;
  const meterTrackW = 172;
  ctx.fillStyle = "rgba(26, 46, 74, 0.9)";
  ctx.fillRect(meterTrackX, meterTrackY, meterTrackW, 9);
  ctx.fillStyle = "#7de1ff";
  ctx.fillRect(meterTrackX + 2, meterTrackY + 1, (GAME.pitchAim + 1) * ((meterTrackW - 4) / 2), 7);

  const rightW = 164;
  const rightH = 36;
  const rightX = GAME.width - rightW - leftPad;
  const rightY = GAME.height - rightH - bottomPad;
  ctx.fillStyle = "rgba(9, 18, 34, 0.86)";
  ctx.fillRect(rightX, rightY, rightW, rightH);
  ctx.strokeStyle = "rgba(83, 210, 255, 0.58)";
  ctx.strokeRect(rightX, rightY, rightW, rightH);
  ctx.fillStyle = "#dff7ff";
  ctx.fillText("Contact", rightX + 10, rightY + 14);
  ctx.fillStyle = "#ffa85e";
  ctx.fillRect(rightX + 10, rightY + 18, 132, 10);
  ctx.fillStyle = "#7bffb4";
  ctx.fillRect(rightX + 56, rightY + 18, 34, 10);
  ctx.fillStyle = "#111";
  ctx.fillRect(rightX + 74 + GAME.swingAim * 34, rightY + 17, 3, 12);
}

function drawUI() {
  drawPlayCallout();
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
  ctx.translate(shake, 0);

  drawBackground();
  drawField();
  drawBasesAndLines();
  drawStrikeZone();
  drawPitchTargetDebug();
  drawPlayers();
  drawBat();
  drawHitTrajectory();
  drawBall();
  drawUI();
  ctx.restore();

  if (GAME.flashTime > 0) {
    ctx.fillStyle = "rgba(255,232,120,0.28)";
    ctx.fillRect(0, 0, GAME.width, GAME.height);
  }
}

function throwToNearestBase() {
  const fielder = defensiveFielders[GAME.controlledFielder];
  if (!fielder) return;
  const nearest = nearestBaseKeyFromFielder(fielder);
  resolveThrow(nearest);
}

function throwToNumber(key) {
  const map = { "1": "home", "2": "first", "3": "second", "4": "third" };
  const base = map[key];
  if (base) resolveThrow(base);
}

function handleKeyDown(event) {
  const key = event.code === "Space"
    ? "Space"
    : (event.key.length === 1 ? event.key.toLowerCase() : event.key);
  input.keys.add(key);

  if (key === "`") {
    DEBUG_STATE.enabled = !DEBUG_STATE.enabled;
    setMessage(DEBUG_STATE.enabled ? "Debug overlay ON" : "Debug overlay OFF");
  }

  if (key === "Enter" && (GAME.mode === "start" || GAME.mode === "over")) {
    startGame();
    return;
  }

  if (key === "Space") {
    event.preventDefault();
    if (event.repeat) return;
    if (pitchBall.active && !GAME.battedBall) {
      handleSwingInput();
    } else if (GAME.battedBall) {
      throwToNearestBase();
    }
  }

  if (["1", "2", "3", "4"].includes(key)) {
    throwToNumber(key);
  }
}

function handleKeyUp(event) {
  const key = event.code === "Space"
    ? "Space"
    : (event.key.length === 1 ? event.key.toLowerCase() : event.key);
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

updateHud();
render();
requestAnimationFrame(gameLoop);
