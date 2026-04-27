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

// Core geometry controls for field proportion/camera tuning.
const FIELD_TUNING = {
  homeX: 852,
  homeY: 408,
  baseSpacingX: 300,
  baseSpacingY: 196,
  moundForwardOffsetX: -36,
  moundForwardOffsetY: -6,
  moundRadiusX: 92,
  moundRadiusY: 40,
  wallRadius: 610,
  warningTrackWidth: 34,
  cameraZoom: 1.08
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

const FIELD = {
  home: { x: FIELD_TUNING.homeX, y: FIELD_TUNING.homeY },
  first: {
    x: FIELD_TUNING.homeX - FIELD_TUNING.baseSpacingX,
    y: FIELD_TUNING.homeY - FIELD_TUNING.baseSpacingY
  },
  second: {
    x: FIELD_TUNING.homeX - FIELD_TUNING.baseSpacingX * 2,
    y: FIELD_TUNING.homeY
  },
  third: {
    x: FIELD_TUNING.homeX - FIELD_TUNING.baseSpacingX,
    y: FIELD_TUNING.homeY + FIELD_TUNING.baseSpacingY
  },
  mound: {
    x: FIELD_TUNING.homeX - FIELD_TUNING.baseSpacingX + FIELD_TUNING.moundForwardOffsetX,
    y: FIELD_TUNING.homeY + FIELD_TUNING.moundForwardOffsetY
  },
  foulTop: { x: FIELD_TUNING.homeX - FIELD_TUNING.baseSpacingX * 2 - 88, y: 22 },
  foulBottom: { x: FIELD_TUNING.homeX - FIELD_TUNING.baseSpacingX * 2 - 88, y: canvas.height - 18 }
};

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
  playCallout: null
};

const batter = {
  x: FIELD.home.x - 58,
  y: FIELD.home.y - 40,
  swingTime: 0,
  swingDuration: 0.18,
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
  x: pitcher.x + 16,
  y: pitcher.y + 18,
  vx: 0,
  vy: 0,
  curve: 0,
  judged: false
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

function resetCount() {
  GAME.balls = 0;
  GAME.strikes = 0;
}

function clearBases() {
  GAME.runners = [false, false, false];
}

function setupDefense() {
  const defenseTeam = GAME.teams[GAME.fieldingSide];
  const skin = ["#f8d2ad", "#c58b62", "#8b5b3f"];
  const hair = ["#1e1e1e", "#5d3414", "#704224"];
  const rightInfieldX = (FIELD.first.x + FIELD.second.x) / 2 + 24;
  const leftInfieldX = (FIELD.third.x + FIELD.second.x) / 2 + 24;
  const spots = [
    { role: "catcher", x: FIELD.home.x + 28, y: FIELD.home.y - 22 },
    { role: "first", x: FIELD.first.x + 18, y: FIELD.first.y - 20 },
    { role: "second", x: rightInfieldX, y: (FIELD.first.y + FIELD.second.y) / 2 - 18 },
    { role: "shortstop", x: leftInfieldX, y: (FIELD.third.y + FIELD.second.y) / 2 + 18 },
    { role: "third", x: FIELD.third.x - 8, y: FIELD.third.y + 12 },
    { role: "left", x: FIELD.second.x - 124, y: FIELD.third.y - 44 },
    { role: "center", x: FIELD.second.x - 188, y: FIELD.second.y + 4 },
    { role: "right", x: FIELD.second.x - 124, y: FIELD.first.y + 44 }
  ];

  defensiveFielders.length = 0;
  spots.forEach((spot, index) => {
    defensiveFielders.push({
      ...spot,
      homeX: spot.x,
      homeY: spot.y,
      x: spot.x,
      y: spot.y,
      speed: 160 + teamRating(defenseTeam, "fielding") * 130,
      skin: skin[index % skin.length],
      hair: hair[index % hair.length]
    });
  });
  GAME.controlledFielder = 1;
}

function resetPitchBall() {
  pitchBall.active = false;
  pitchBall.x = pitcher.x + 16;
  pitchBall.y = pitcher.y + 18;
  pitchBall.vx = 0;
  pitchBall.vy = 0;
  pitchBall.curve = 0;
  pitchBall.judged = false;
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

function pitchInStrikeZone(y) {
  const top = batter.y - 4;
  const bottom = batter.y + 52;
  return y >= top && y <= bottom;
}

function spawnPitch() {
  const fieldingTeam = GAME.teams[GAME.fieldingSide];
  const pitchRating = teamRating(fieldingTeam, "pitching");
  // Slightly slower pitch speeds make batting feel fairer.
  const speed = 335 + pitchRating * 135 + Math.random() * 85;
  const strikeChance = 0.47 + pitchRating * 0.28;
  const strikesPitch = Math.random() < strikeChance;

  const startX = pitcher.x + 14;
  const startY = pitcher.y + 16;
  const zoneTop = batter.y + 4;
  const zoneBottom = batter.y + 46;
  let targetY;
  if (strikesPitch) {
    targetY = zoneTop + Math.random() * (zoneBottom - zoneTop);
  } else if (Math.random() < 0.5) {
    targetY = zoneTop - (12 + Math.random() * 26);
  } else {
    targetY = zoneBottom + (12 + Math.random() * 26);
  }

  const travelTime = Math.abs((FIELD.home.x - 16 - startX) / speed);
  pitchBall.active = true;
  pitchBall.x = startX;
  pitchBall.y = startY;
  pitchBall.vx = speed;
  pitchBall.vy = (targetY - startY) / travelTime;
  pitchBall.curve = (Math.random() * 30 - 15) + GAME.pitchAim * 60;
  pitchBall.judged = false;
  GAME.pitchReady = false;
  GAME.pitchTimer = 0;
  pitcher.windup = 0.18;
}

function launchBattedBall(type, flightTypeOverride) {
  const startX = FIELD.home.x - 14;
  const startY = batter.y + 22;
  let targetX = 500;
  let targetY = 290;
  let arc = 110;
  let time = 0.9;

  // Spray angle makes batted balls land in varied field zones.
  const sprayLanes = [110, 185, 270, 355, 445, 525];
  const laneCenter = sprayLanes[Math.floor(Math.random() * sprayLanes.length)];
  const timingBias = Math.max(-1, Math.min(1, GAME.lastContactOffset / 34)) * 130;
  const aimBias = GAME.swingAim * 170;
  const laneBias = laneCenter + timingBias + aimBias + (Math.random() * 64 - 32);

  let flightType = flightTypeOverride ?? "fly";

  if (type === "homer") {
    targetX = 120 + Math.random() * 180;
    targetY = laneBias;
    arc = 220 + Math.random() * 28;
    time = 1.18 + Math.random() * 0.12;
    flightType = "homer";
    GAME.cameraShake = 0.35;
    GAME.flashTime = 0.1;
  } else if (type === "triple") {
    targetX = 190 + Math.random() * 220;
    targetY = laneBias;
    arc = 170 + Math.random() * 22;
    time = 1 + Math.random() * 0.12;
    flightType = "fly";
  } else if (type === "double") {
    targetX = 270 + Math.random() * 250;
    targetY = laneBias;
    arc = 54 + Math.random() * 12;
    time = 0.78 + Math.random() * 0.1;
    flightType = "line";
  } else if (type === "single") {
    targetX = 350 + Math.random() * 250;
    targetY = laneBias;
    arc = 28 + Math.random() * 10;
    time = 0.68 + Math.random() * 0.08;
    flightType = "line";
  } else if (type === "grounder") {
    targetX = 450 + Math.random() * 210;
    targetY = laneBias;
    arc = 0;
    time = 0.56 + Math.random() * 0.09;
    flightType = "grounder";
  }

  // Batter aim can push trajectory up/down the foul lines.
  targetY = Math.max(56, Math.min(GAME.height - 20, targetY));

  GAME.battedBall = {
    x: startX,
    y: startY,
    startX,
    startY,
    targetX,
    targetY,
    elapsed: 0,
    travelTime: time,
    arcHeight: arc,
    type,
    flightType
  };

  GAME.pendingPlay = { resolved: false, deadline: time + 0.45, elapsed: 0, result: type };
}

function resolveSwing(ballX, ballY) {
  const battingTeam = GAME.teams[GAME.battingSide];
  const contact = teamRating(battingTeam, "contact");
  const power = teamRating(battingTeam, "power");

  const contactPoint = FIELD.home.x - 18;
  const dx = Math.abs(ballX - contactPoint);
  const dy = Math.abs(ballY - (batter.y + 24));
  GAME.lastContactOffset = ballX - contactPoint;

  // Wider windows improve responsiveness for arcade play.
  const perfectWindow = 16 + contact * 8;
  const goodWindow = 48 + contact * 22;

  // Small timing indicator near batter.
  if (dx <= perfectWindow && dy <= 20 + contact * 8) {
    const big = Math.random() < 0.68 + power * 0.25;
    const hitType = big ? "homer" : (Math.random() < 0.45 ? "triple" : "double");
    launchBattedBall(hitType);
    registerHit(hitType);
    createBurst(ballX, ballY, "#ffe27a", 14);
    resetPitchBall();
    return;
  }

  if (dx <= goodWindow && dy <= 42 + contact * 16) {
    const outcomeRoll = Math.random();
    if (outcomeRoll < 0.08 + power * 0.18) {
      launchBattedBall("homer");
      registerHit("homer");
    } else if (outcomeRoll < 0.22 + power * 0.3) {
      launchBattedBall("triple");
      registerHit("triple");
    } else if (outcomeRoll < 0.54 + power * 0.24) {
      launchBattedBall("double");
      registerHit("double");
    } else {
      launchBattedBall("single");
      registerHit("single");
    }
    createBurst(ballX, ballY, "#8fffc8", 10);
    resetPitchBall();
    return;
  }

  const weakRoll = Math.random();
  if (weakRoll < 0.4) {
    launchBattedBall("grounder");
    GAME.pendingPlay.result = Math.random() < (0.45 + contact * 0.25) ? "grounderSafe" : "grounderOut";
    setMessage("Weak grounder in play...");
    createBurst(ballX, ballY, "#eadfbe", 8);
    resetPitchBall();
    return;
  }
  if (weakRoll < 0.7) {
    launchBattedBall("single");
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
  if (GAME.mode !== "play" || GAME.pitchReady || GAME.battedBall) return;
  batter.activeSwing = true;
  batter.swingTime = batter.swingDuration;
  if (!pitchBall.active || pitchBall.judged) return;
  const dx = Math.abs(pitchBall.x - (FIELD.home.x - 18));
  if (dx <= 64) {
    pitchBall.judged = true;
    resolveSwing(pitchBall.x, pitchBall.y);
    return;
  }

  // Buffered swing: early presses can still connect as ball arrives.
  GAME.swingBuffer = 0.22;
}

function handlePitchInput() {
  if (GAME.mode !== "play" || !GAME.pitchReady || GAME.battedBall) return;
  spawnPitch();
}

function resolveTakenPitch() {
  pitchBall.judged = true;
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

function chooseNearestFielder(x, y) {
  let best = 1;
  let dist = Number.POSITIVE_INFINITY;
  for (let i = 1; i < defensiveFielders.length; i += 1) {
    const f = defensiveFielders[i];
    const d = (f.x - x) ** 2 + (f.y - y) ** 2;
    if (d < dist) {
      dist = d;
      best = i;
    }
  }
  return best;
}

function nearestBaseKeyFromFielder(fielder) {
  const keys = ["home", "first", "second", "third"];
  let winner = "first";
  let dist = Number.POSITIVE_INFINITY;
  keys.forEach((key) => {
    const b = FIELD[key];
    const d = (b.x - fielder.x) ** 2 + (b.y - fielder.y) ** 2;
    if (d < dist) {
      dist = d;
      winner = key;
    }
  });
  return winner;
}

function resolveThrow(baseKey) {
  if (!GAME.pendingPlay || GAME.pendingPlay.resolved) return;
  const defenseTeam = GAME.teams[GAME.fieldingSide];
  const fieldQuality = teamRating(defenseTeam, "fielding");

  // Most non-grounder hits should stay hits. Throws are only decisive on true
  // infield grounder-out plays, which improves perceived hit fairness.
  const isGrounderPlay = GAME.pendingPlay.result === "grounderOut" || GAME.pendingPlay.result === "grounderSafe";
  if (!isGrounderPlay) {
    GAME.pendingPlay.resolved = true;
    showPlayCallout("SAFE", "safe");
    setMessage(`Throw to ${baseKey}. Too late, runner is safe.`);
    return;
  }

  const throwChance = 0.46 + fieldQuality * 0.26;
  const success = Math.random() < throwChance;
  if (!success) {
    GAME.pendingPlay.resolved = true;
    showPlayCallout("SAFE", "safe");
    setMessage("Throw missed! Safe on the play.");
    return;
  }

  if (GAME.pendingPlay.result === "grounderOut") {
    GAME.pendingPlay.resolved = true;
    showPlayCallout("OUT", "out");
    addOut(`Out at ${baseKey}!`);
    return;
  }

  if (GAME.pendingPlay.result === "grounderSafe") {
    GAME.pendingPlay.resolved = true;
    showPlayCallout("SAFE", "safe");
    setMessage(`Infield single. Throw to ${baseKey} is late.`);
    return;
  }

  GAME.pendingPlay.resolved = true;
  showPlayCallout("SAFE", "safe");
  setMessage(`Throw to ${baseKey}. Play continues safe.`);
}

function updateBattedBall(dt) {
  if (!GAME.battedBall) return;
  const ballObj = GAME.battedBall;
  ballObj.elapsed += dt;
  const t = Math.min(1, ballObj.elapsed / ballObj.travelTime);
  ballObj.x = ballObj.startX + (ballObj.targetX - ballObj.startX) * t;
  const baseY = ballObj.startY + (ballObj.targetY - ballObj.startY) * t;
  if (ballObj.flightType === "grounder") {
    // Keep grounders visibly low with a tiny bounce.
    const bounce = Math.sin(t * Math.PI * 4) * Math.max(0, 3 * (1 - t));
    ballObj.y = baseY - bounce;
  } else if (ballObj.flightType === "line") {
    // Line drives stay flatter than fly balls.
    ballObj.y = baseY - Math.sin(t * Math.PI) * (ballObj.arcHeight * 0.55);
  } else {
    ballObj.y = baseY - Math.sin(t * Math.PI) * ballObj.arcHeight;
  }

  if (GAME.pendingPlay && !GAME.pendingPlay.resolved) {
    GAME.pendingPlay.elapsed += dt;
    if (GAME.pendingPlay.elapsed >= GAME.pendingPlay.deadline) {
      GAME.pendingPlay.resolved = true;
      if (GAME.pendingPlay.result === "grounderOut") {
        showPlayCallout("SAFE", "safe");
        setMessage("No throw made. Infield single!");
      }
    }
  }

  if (t >= 1) {
    const nearest = chooseNearestFielder(ballObj.targetX, ballObj.targetY);
    GAME.controlledFielder = nearest;
    createBurst(ballObj.targetX, ballObj.targetY, "#d8f3ff", 7);
    GAME.battedBall = null;
    GAME.pitchReady = true;
    GAME.pitchTimer = 0;
    GAME.nextPitchDelay = PITCH_DELAY_TUNING.afterPlayMin + Math.random() * PITCH_DELAY_TUNING.afterPlayRange;
  }
}

function updateFielders(dt) {
  const defenseTeam = GAME.teams[GAME.fieldingSide];
  const fieldReaction = teamRating(defenseTeam, "fielding");
  defensiveFielders.forEach((f, idx) => {
    let tx = f.homeX;
    let ty = f.homeY;
    if (GAME.battedBall && idx !== GAME.controlledFielder) {
      const progress = Math.min(1, GAME.battedBall.elapsed / GAME.battedBall.travelTime);
      const isAirBall = GAME.battedBall.flightType === "fly" || GAME.battedBall.flightType === "homer";
      // Delay convergence on deep air balls so every play doesn't look auto-caught.
      if (!isAirBall || progress > 0.82) {
        tx = GAME.battedBall.targetX - 8 + (isAirBall ? 14 : 0);
        ty = GAME.battedBall.targetY + 16 + (isAirBall ? 8 : 0);
      }
    }
    const dx = tx - f.x;
    const dy = ty - f.y;
    const d = Math.hypot(dx, dy);
    if (d < 0.2) return;
    const step = (f.speed * (0.62 + fieldReaction * 0.54)) * dt;
    if (d <= step) {
      f.x = tx;
      f.y = ty;
      return;
    }
    f.x += (dx / d) * step;
    f.y += (dy / d) * step;
  });
}

function createBurst(x, y, color, count) {
  for (let i = 0; i < count; i += 1) {
    const angle = Math.random() * Math.PI * 2;
    const speed = 60 + Math.random() * 230;
    GAME.particles.push({
      x,
      y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      life: 0.35 + Math.random() * 0.35,
      color,
      size: 2 + Math.random() * 3
    });
  }
}

function updateParticles(dt) {
  for (let i = GAME.particles.length - 1; i >= 0; i -= 1) {
    const p = GAME.particles[i];
    p.life -= dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.vy += 900 * dt * 0.2;
    if (p.life <= 0) GAME.particles.splice(i, 1);
  }
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
    pitchBall.x += pitchBall.vx * dt;
    pitchBall.y += pitchBall.vy * dt;
    pitchBall.vy += pitchBall.curve * dt;

    if (GAME.swingBuffer > 0 && !pitchBall.judged) {
      const dx = Math.abs(pitchBall.x - (FIELD.home.x - 18));
      if (dx <= 18) {
        pitchBall.judged = true;
        GAME.swingBuffer = 0;
        resolveSwing(pitchBall.x, pitchBall.y);
      }
    }

    // Ball reaches plate.
    if (pitchBall.x >= FIELD.home.x + 8 && !pitchBall.judged) {
      resolveTakenPitch();
    }

    if (pitchBall.x > GAME.width + 40 || pitchBall.y < -40 || pitchBall.y > GAME.height + 40) {
      resetPitchBall();
      GAME.pitchReady = true;
    }
  }
}

function drawFairTerritoryMask() {
  ctx.beginPath();
  ctx.moveTo(FIELD.home.x, FIELD.home.y);
  ctx.lineTo(FIELD.foulTop.x, FIELD.foulTop.y);
  ctx.arc(FIELD.home.x, FIELD.home.y, 520, -2.6, 2.6);
  ctx.closePath();
}

function drawField() {
  const sky = ctx.createLinearGradient(0, 0, 0, 220);
  sky.addColorStop(0, "#86caff");
  sky.addColorStop(1, "#5b92dc");
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, GAME.width, 220);

  ctx.fillStyle = "#1a4280";
  ctx.fillRect(0, 84, GAME.width, 24);
  ctx.fillStyle = "#25345b";
  ctx.fillRect(0, 108, GAME.width, 68);
  for (let i = 0; i < GAME.width; i += 8) {
    ctx.fillStyle = i % 16 === 0 ? "#51d4ff" : "#ffb9f9";
    ctx.fillRect(i, 116 + ((i / 8) % 4), 4, 6);
  }

  ctx.fillStyle = "#c18c57";
  ctx.fillRect(0, 176, GAME.width, GAME.height - 176);

  ctx.save();
  drawFairTerritoryMask();
  ctx.clip();

  const grass = ctx.createLinearGradient(0, 176, 0, GAME.height);
  grass.addColorStop(0, "#35a66a");
  grass.addColorStop(1, "#1f7a4a");
  ctx.fillStyle = grass;
  ctx.fillRect(0, 176, GAME.width, GAME.height - 176);

  for (let i = -240; i < GAME.width + 330; i += 34) {
    ctx.fillStyle = "rgba(255,255,255,0.09)";
    ctx.beginPath();
    ctx.moveTo(i, 164);
    ctx.lineTo(i + 26, 164);
    ctx.lineTo(i + 194, GAME.height);
    ctx.lineTo(i + 168, GAME.height);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();

  ctx.strokeStyle = "#0f2f56";
  ctx.lineWidth = 13;
  ctx.beginPath();
  ctx.arc(FIELD.home.x, FIELD.home.y, 520, -2.6, 2.6);
  ctx.stroke();

  // Larger infield dirt cutout to emphasize arcade infield action.
  ctx.fillStyle = "#cd9a67";
  ctx.beginPath();
  ctx.moveTo(FIELD.home.x + 6, FIELD.home.y + 28);
  ctx.lineTo(FIELD.third.x - 94, FIELD.third.y + 16);
  ctx.lineTo(FIELD.second.x - 54, FIELD.second.y - 118);
  ctx.lineTo(FIELD.first.x + 98, FIELD.first.y - 12);
  ctx.closePath();
  ctx.fill();

  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.strokeStyle = "#d3a16e";
  ctx.lineWidth = 66;
  ctx.beginPath();
  ctx.moveTo(FIELD.home.x, FIELD.home.y);
  ctx.lineTo(FIELD.first.x, FIELD.first.y);
  ctx.lineTo(FIELD.second.x, FIELD.second.y);
  ctx.lineTo(FIELD.third.x, FIELD.third.y);
  ctx.lineTo(FIELD.home.x, FIELD.home.y);
  ctx.stroke();

  ctx.strokeStyle = "rgba(255,249,232,0.98)";
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(FIELD.home.x, FIELD.home.y);
  ctx.lineTo(FIELD.first.x, FIELD.first.y);
  ctx.lineTo(FIELD.second.x, FIELD.second.y);
  ctx.lineTo(FIELD.third.x, FIELD.third.y);
  ctx.closePath();
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(FIELD.home.x, FIELD.home.y);
  ctx.lineTo(FIELD.foulTop.x, FIELD.foulTop.y);
  ctx.moveTo(FIELD.home.x, FIELD.home.y);
  ctx.lineTo(FIELD.foulBottom.x, FIELD.foulBottom.y);
  ctx.stroke();

  ctx.fillStyle = "rgba(0,0,0,0.2)";
  ctx.beginPath();
  ctx.ellipse(FIELD.mound.x + 3, FIELD.mound.y + 38, 64, 27, 0, 0, Math.PI * 2);
  ctx.fill();
  const mound = ctx.createLinearGradient(FIELD.mound.x, FIELD.mound.y + 8, FIELD.mound.x, FIELD.mound.y + 60);
  mound.addColorStop(0, "#d7a672");
  mound.addColorStop(1, "#b7814c");
  ctx.fillStyle = mound;
  ctx.beginPath();
  ctx.ellipse(FIELD.mound.x, FIELD.mound.y + 34, 64, 26, 0, 0, Math.PI * 2);
  ctx.fill();

  drawBase(FIELD.first.x, FIELD.first.y);
  drawBase(FIELD.second.x, FIELD.second.y);
  drawBase(FIELD.third.x, FIELD.third.y);
  drawHomePlate(FIELD.home.x, FIELD.home.y);
  drawBatterBox();
}

function drawBase(x, y) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(Math.PI / 4);
  ctx.fillStyle = "rgba(0,0,0,0.2)";
  ctx.fillRect(-8, -6, 16, 16);
  ctx.fillStyle = "#fef9e5";
  ctx.fillRect(-8, -8, 16, 16);
  ctx.strokeStyle = "#d7cdad";
  ctx.lineWidth = 2;
  ctx.strokeRect(-8, -8, 16, 16);
  ctx.restore();
}

function drawHomePlate(x, y) {
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = "rgba(0,0,0,0.22)";
  ctx.beginPath();
  ctx.moveTo(2, 2);
  ctx.lineTo(11, -7);
  ctx.lineTo(11, 6);
  ctx.lineTo(2, 15);
  ctx.lineTo(-8, 7);
  ctx.lineTo(-8, -7);
  ctx.closePath();
  ctx.fill();

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

function drawBatterBox() {
  ctx.strokeStyle = "rgba(255,255,255,0.84)";
  ctx.lineWidth = 3;
  ctx.strokeRect(FIELD.home.x - 86, FIELD.home.y - 38, 72, 66);
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
  const headSize = bigHead ? 13 : 11;
  ctx.fillStyle = "rgba(0,0,0,0.24)";
  ctx.fillRect(x + 2, y + 27, 16, 5);

  // head
  ctx.fillStyle = look.skin;
  ctx.fillRect(x + 3, y - 7, headSize, 11);
  ctx.strokeStyle = "rgba(22, 22, 32, 0.82)";
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 3, y - 7, headSize, 11);

  // hair + cap
  ctx.fillStyle = look.hair;
  ctx.fillRect(x + 3, y - 9, headSize, 3);
  ctx.fillStyle = team.colors.cap;
  ctx.fillRect(x + 3, y - 12, headSize, 4);

  // face
  ctx.fillStyle = "#1a1a1a";
  ctx.fillRect(x + 6, y - 2, 2, 2);
  ctx.fillRect(x + 11, y - 2, 2, 2);
  ctx.fillRect(x + 8, y + 1, 3, 1);

  // body
  ctx.fillStyle = team.colors.jersey;
  ctx.fillRect(x + 2, y + 2, 16, 17);
  ctx.fillStyle = team.colors.trim;
  ctx.fillRect(x + 2, y + 2, 16, 3);
  ctx.strokeStyle = "rgba(20, 24, 34, 0.9)";
  ctx.strokeRect(x + 2, y + 2, 16, 17);

  // legs
  ctx.fillStyle = "#18203a";
  ctx.fillRect(x + 3, y + 19, 5, 9);
  ctx.fillRect(x + 12, y + 19, 5, 9);

  // arm/glove
  ctx.fillStyle = look.skin;
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

  const swingProgress = batter.activeSwing
    ? 1 - batter.swingTime / batter.swingDuration
    : 0;
  const angle = batter.activeSwing
    ? (-2.3 + swingProgress * 1.95)
    : -2.05;

  ctx.save();
  ctx.translate(batter.x + 6, batter.y + 17);
  ctx.rotate(angle);
  ctx.fillStyle = batter.batColor;
  ctx.fillRect(-44, -3, 46, 6);
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

function drawBallTrail(ballObj) {
  ctx.fillStyle = "rgba(255,255,255,0.45)";
  for (let i = 1; i <= 3; i += 1) {
    ctx.fillRect(ballObj.x + i * 10, ballObj.y + i * 3, 7, 3);
  }
}

function drawBattedBall() {
  if (!GAME.battedBall) return;
  const ballObj = GAME.battedBall;
  const shape = ballObj.shape ?? "fly";

  if (shape === "grounder") {
    ctx.fillStyle = "rgba(0,0,0,0.3)";
    ctx.fillRect(ballObj.x - 6, ballObj.y + 4, 12, 4);
    ctx.fillStyle = "#fff8d9";
    ctx.beginPath();
    ctx.arc(ballObj.x, ballObj.y, 6, 0, Math.PI * 2);
    ctx.fill();
    return;
  }

  if (shape === "line") {
    ctx.fillStyle = "rgba(0,0,0,0.24)";
    ctx.fillRect(ballObj.x - 5, ballObj.y + 7, 10, 4);
    ctx.fillStyle = "#fff8d9";
    ctx.beginPath();
    ctx.arc(ballObj.x, ballObj.y, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.4)";
    ctx.fillRect(ballObj.x + 8, ballObj.y + 1, 10, 3);
    ctx.fillRect(ballObj.x + 18, ballObj.y + 4, 8, 3);
    return;
  }

  ctx.fillStyle = "rgba(0,0,0,0.22)";
  ctx.fillRect(ballObj.x - 4, ballObj.y + 8, 8, 4);
  ctx.fillStyle = "#fff9db";
  ctx.beginPath();
  ctx.arc(ballObj.x, ballObj.y, 6, 0, Math.PI * 2);
  ctx.fill();
  drawBallTrail(ballObj);
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

function drawPitchBall() {
  if (!pitchBall.active) return;
  ctx.fillStyle = "rgba(0,0,0,0.2)";
  ctx.fillRect(pitchBall.x - 3, pitchBall.y + 8, 8, 4);
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.arc(pitchBall.x, pitchBall.y, 6, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "#ff6868";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(pitchBall.x, pitchBall.y, 4, 0.4, 2.6);
  ctx.stroke();
}

function drawParticles() {
  GAME.particles.forEach((p) => {
    ctx.globalAlpha = Math.max(0, p.life / 0.7);
    ctx.fillStyle = p.color;
    ctx.fillRect(p.x, p.y, p.size, p.size);
    ctx.globalAlpha = 1;
  });
}

function drawAimMeters() {
  // Pitch meter (when fielding)
  const meterX = 16;
  const meterY = 488;
  ctx.fillStyle = "rgba(10,20,40,0.7)";
  ctx.fillRect(meterX, meterY, 190, 36);
  ctx.strokeStyle = "#67d7ff";
  ctx.strokeRect(meterX, meterY, 190, 36);
  ctx.fillStyle = "#dff7ff";
  ctx.font = "12px 'Trebuchet MS', sans-serif";
  ctx.fillText("Aim (A/D):", meterX + 8, meterY + 15);
  ctx.fillText(`Pitch ${Math.round(GAME.pitchAim * 100)}`, meterX + 8, meterY + 30);
  ctx.fillStyle = "#7de1ff";
  ctx.fillRect(meterX + 98, meterY + 20, (GAME.pitchAim + 1) * 42, 8);

  // Contact timing zone near batter.
  const bx = FIELD.home.x - 132;
  const by = FIELD.home.y - 62;
  ctx.fillStyle = "rgba(0,0,0,0.35)";
  ctx.fillRect(bx, by, 76, 16);
  ctx.fillStyle = "#ffa85e";
  ctx.fillRect(bx + 2, by + 2, 72, 12);
  ctx.fillStyle = "#7bffb4";
  ctx.fillRect(bx + 26, by + 2, 22, 12);
  ctx.fillStyle = "#111";
  ctx.fillRect(bx + 38 + GAME.swingAim * 22, by + 1, 2, 14);
}

function render() {
  const shake = GAME.cameraShake > 0 ? Math.sin(performance.now() * 0.1) * 6 : 0;
  ctx.save();
  ctx.clearRect(0, 0, GAME.width, GAME.height);
  ctx.translate(shake, 0);
  drawField();
  drawRunnerDots();
  drawFielders();
  drawPitcher();
  drawBattedBall();
  drawBatter();
  drawPitchBall();
  drawParticles();
  drawAimMeters();
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
  const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
  input.keys.add(key);

  if (key === "Enter" && (GAME.mode === "start" || GAME.mode === "over")) {
    startGame();
    return;
  }

  if (key === " ") {
    event.preventDefault();
    if (GAME.battedBall) {
      throwToNearestBase();
    } else {
      handleSwingInput();
    }
  }

  if (["1", "2", "3", "4"].includes(key)) {
    throwToNumber(key);
  }
}

function handleKeyUp(event) {
  const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
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
