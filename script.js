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
const DEBUG_FIELDING = false;
const PITCH_DURATION_MS = 1150;
const PITCH_DURATION_RANGE_MS = { min: 1000, max: 1300 };
const PITCH_MAX_VELOCITY = 980;

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

  // Keep batter to the side of the strike zone/home-plate channel.
  batter.x = FIELD.home.x + 46;
  batter.y = FIELD.home.y - 46;
  pitcher.x = FIELD.mound.x - 10;
  pitcher.y = FIELD.mound.y - 46;
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
    { role: "pitcher", x: FIELD.mound.x - 10, y: FIELD.mound.y - 46 },
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
  const xLeft = FIELD.third.x - 190;
  const xRight = FIELD.first.x + 190;
  const y = Math.max(fieldTop + 78, FIELD.second.y - 168);
  const radiusX = Math.max(120, (xRight - xLeft) * 0.5);
  const yAt = (x) => {
    const nx = clampValue((x - centerX) / radiusX, -1, 1);
    return y + Math.abs(nx) * 26;
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
    { name: "leftInfield", minForward: -30, maxForward: 300, minLateral: -620, maxLateral: -88, roles: ["third", "shortstop", "pitcher"], backupRoles: ["left", "second"] },
    { name: "middleInfield", minForward: -30, maxForward: 310, minLateral: -88, maxLateral: 88, roles: ["pitcher", "shortstop", "second"], backupRoles: ["first", "center"] },
    { name: "rightInfield", minForward: -30, maxForward: 300, minLateral: 88, maxLateral: 620, roles: ["first", "second", "pitcher"], backupRoles: ["right", "shortstop"] },
    { name: "leftField", minForward: 300, maxForward: 860, minLateral: -620, maxLateral: -180, roles: ["left", "center"], backupRoles: ["shortstop", "third"] },
    { name: "leftCenterGap", minForward: 330, maxForward: 880, minLateral: -180, maxLateral: -55, roles: ["center", "left"], backupRoles: ["left", "shortstop"] },
    { name: "centerField", minForward: 330, maxForward: 900, minLateral: -55, maxLateral: 55, roles: ["center", "left", "right"], backupRoles: ["left", "right"] },
    { name: "rightCenterGap", minForward: 330, maxForward: 880, minLateral: 55, maxLateral: 180, roles: ["center", "right"], backupRoles: ["right", "second"] },
    { name: "rightField", minForward: 300, maxForward: 860, minLateral: 180, maxLateral: 620, roles: ["right", "center"], backupRoles: ["first", "second"] },
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
  const fairHalfWidth = Math.max(115, forwardDist * 1.35 + 115);
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

function resetPitchBall() {
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
  GAME.swingBuffer = 0;
  GAME.debugInfo.hitDetected = "false";
  GAME.debugInfo.hitZone = "-";
  GAME.debugInfo.landingPoint = "-";
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
  GAME.cameraX = 0;
  GAME.cameraY = 0;
  GAME.cameraTargetX = 0;
  GAME.cameraTargetY = 0;
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
  const strikeChance = 0.47 + pitchRating * 0.28;
  const strikesPitch = Math.random() < strikeChance;
  const pitchDurationMs = clampValue(
    PITCH_DURATION_MS + randomRange(-120, 120) + (0.5 - pitchRating) * 70,
    PITCH_DURATION_RANGE_MS.min,
    PITCH_DURATION_RANGE_MS.max
  );

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
  const travelTime = pitchDurationMs / 1000;
  const curveAmount = randomRange(-PITCH_TUNING.curveStrength, PITCH_TUNING.curveStrength) + GAME.pitchAim * 40;
  const midControlX = startX + dx * 0.52 + curveAmount;
  const midControlY = startY + dy * 0.47 + randomRange(-18, 18);

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
  GAME.swingBuffer = 0;
  GAME.debugInfo.hitDetected = "false";
  GAME.debugInfo.pitchTarget = `${Math.round(targetX)}, ${Math.round(targetY)}`;
  GAME.debugInfo.strikeZone = `${Math.round(zone.x)},${Math.round(zone.y)} ${Math.round(zone.w)}x${Math.round(zone.h)}`;
  GAME.debugInfo.pitchDuration = `${Math.round(pitchDurationMs)}ms`;
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
    vx *= 0.58;
    vy *= 0.58;
    vz *= 1.18;
  } else if (normalizedType === "homeRun") {
    vx *= 1.08;
    vy *= 1.08;
    vz *= 1.06;
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
    createBurst(ballX, ballY, "#ffe27a", 14);
    resetPitchBall();
    return;
  }

  if (dx <= goodWindow && dy <= 42 + contact * 16) {
    const hitPhysics = calculateHitPhysics({ ballX, ballY });
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
  if (!ballObj || !GAME.pendingPlay) {
    if (fielder.role === "pitcher") return { x: FIELD.mound.x - 8, y: FIELD.mound.y - 12 };
    if (fielder.role === "catcher") return { x: FIELD.home.x - 12, y: FIELD.home.y + 8 };
    return { x: fielder.homeX, y: fielder.homeY };
  }
  const role = fielder.role;
  if (role === "first") return { x: FIELD.first.x + 10, y: FIELD.first.y - 10 };
  if (role === "pitcher") return { x: FIELD.mound.x - 8, y: FIELD.mound.y - 12 };
  if (role === "catcher") return { x: FIELD.home.x - 12, y: FIELD.home.y + 8 };
  if (role === "left") return { x: FIELD.third.x - 98, y: FIELD.second.y - 124 };
  if (role === "center") return { x: FIELD.second.x - 12, y: FIELD.second.y - 172 };
  if (role === "right") return { x: FIELD.first.x + 94, y: FIELD.second.y - 124 };
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
  GAME.pitchReady = true;
  GAME.pitchTimer = 0;
  GAME.nextPitchDelay = PITCH_DELAY_TUNING.afterPlayMin + Math.random() * PITCH_DELAY_TUNING.afterPlayRange;
}

function executeFieldedBallResult(fieldingRole, ballObj) {
  if (!GAME.pendingPlay || GAME.pendingPlay.resolved) return;
  const role = fieldingRole ?? "fielder";
  const isAirCatch = !ballObj.landed && ballObj.height > 8;
  if (isAirCatch) {
    finalizeBattedBallResult("flyOut", `${role.toUpperCase()} made the catch. FLY OUT.`);
    return;
  }

  if (GAME.pendingPlay.gapHit) {
    const depth = getBallFieldVector(ballObj.x, ballObj.groundY).forwardDist;
    finalizeBattedBallResult(
      depth > 470 ? "triple" : "double",
      depth > 470 ? "TRIPLE! Splits the outfielders." : "DOUBLE! GAP HIT!"
    );
    return;
  }

  const infieldRole = ["pitcher", "catcher", "first", "second", "shortstop", "third"].includes(role);
  if (infieldRole && ballObj.flightType === "grounder") {
    finalizeBattedBallResult("groundOut", `${role.toUpperCase()} fields and throws to first. GROUND OUT.`);
    return;
  }

  const depth = getBallFieldVector(ballObj.x, ballObj.groundY).forwardDist;
  if (depth > 520 || ballObj.wallReachedOnGround) {
    finalizeBattedBallResult("double", "Ball rattles the wall. DOUBLE!");
  } else {
    finalizeBattedBallResult("baseHit", `${role.toUpperCase()} fields it late. BASE HIT.`);
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
  if (!GAME.pendingPlay || GAME.pendingPlay.resolved) return;
  const result = GAME.pendingPlay.result;
  if (!["groundOut", "baseHit", "double", "triple"].includes(result)) return;
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

  if (result === "groundOut") {
    GAME.pendingPlay.resolved = true;
    showPlayCallout("GROUND OUT", "out");
    addOut(`GROUND OUT at ${baseKey}!`);
    return;
  }

  GAME.pendingPlay.resolved = true;
  showPlayCallout("SAFE", "safe");
  setMessage(`Throw to ${baseKey}. Runner beats it.`);
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

  const movingSpeed = Math.hypot(ballObj.vx, ballObj.vy) + Math.abs(ballObj.vz);
  if (!ballObj.fielded && ballObj.landed && movingSpeed < 18 && pending && !pending.resolved) {
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
      const sideOffset = f.role === "left" ? -30 : (f.role === "right" ? 30 : 0);
      target = { x: anchor.x + sideOffset, y: anchor.y + 26 };
      f.state = "backup";
    } else if (ballObj && !pending?.homeRun) {
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
    return;
  }

  if (GAME.battedBall) {
    const followStrength = 0.08;
    GAME.cameraTargetX = clampValue(GAME.battedBall.x - FIELD.home.x, -90, 90);
    GAME.cameraTargetY = clampValue((GAME.battedBall.groundY ?? GAME.battedBall.y) - FIELD.home.y, -70, 60);
    GAME.cameraX += (GAME.cameraTargetX - GAME.cameraX) * followStrength;
    GAME.cameraY += (GAME.cameraTargetY - GAME.cameraY) * followStrength;
  } else {
    GAME.cameraTargetX = 0;
    GAME.cameraTargetY = 0;
    GAME.cameraX += (GAME.cameraTargetX - GAME.cameraX) * 0.14;
    GAME.cameraY += (GAME.cameraTargetY - GAME.cameraY) * 0.14;
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
    if (GAME.playCallout.life <= 0) GAME.playCallout = null;
  }
  if (GAME.swingBuffer > 0) GAME.swingBuffer -= dt;

  if (GAME.pitchReady && !GAME.battedBall && !pitchBall.active) {
    GAME.pitchTimer += dt;
    if (GAME.pitchTimer >= GAME.nextPitchDelay) spawnPitch();
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

  // Distant stadium wall for depth.
  ctx.fillStyle = "rgba(22,44,72,0.88)";
  ctx.fillRect(0, top + 22, GAME.width, 18);
  ctx.fillStyle = "rgba(95,172,212,0.3)";
  ctx.fillRect(0, top + 22, GAME.width, 2);

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
    ctx.lineTo(x + 12, bounds.top - 10);
    ctx.lineTo(x + 228, GAME.height + 14);
    ctx.lineTo(x + 196, GAME.height + 14);
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
  const s = scaleByY(y) * 0.9;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(s, s);
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
  ctx.fillStyle = "rgba(0,0,0,0.32)";
  ctx.fillRect(2, 27, 16, 5);

  ctx.fillStyle = skin;
  ctx.fillRect(3, -7, headSize, 11);
  ctx.strokeStyle = "rgba(22, 22, 32, 0.82)";
  ctx.lineWidth = 1;
  ctx.strokeRect(3, -7, headSize, 11);

  ctx.fillStyle = hair;
  ctx.fillRect(3, -9, headSize, 3);
  ctx.fillStyle = palette.cap;
  ctx.fillRect(3, -12, headSize, 4);

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
  drawParticles();
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
    if (!DEBUG_FIELDING && !DEBUG) return;
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
