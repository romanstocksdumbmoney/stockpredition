const canvas = document.getElementById("gameCanvas");
const ctx = canvas.getContext("2d");

const startScreen = document.getElementById("startScreen");
const gameOverScreen = document.getElementById("gameOverScreen");
const startButton = document.getElementById("startButton");
const restartButton = document.getElementById("restartButton");
const teamSelectA = document.getElementById("teamSelectA");
const teamSelectB = document.getElementById("teamSelectB");
const messageBar = document.getElementById("messageBar");
const modeBanner = document.getElementById("modeBanner");
const modeBannerTitle = document.getElementById("modeBannerTitle");
const modeBannerSubtitle = document.getElementById("modeBannerSubtitle");
const fieldStage = document.getElementById("fieldStage");

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

const VIRTUAL_WIDTH = 1280;
const VIRTUAL_HEIGHT = 720;
const HEADER_HEIGHT = 80;
const BOTTOM_HEIGHT = 55;

const FIELD_BOUNDS = {
  left: 80,
  right: 1200,
  top: 120,
  bottom: 650
};

const BASES = {
  home: { x: 640, y: 610 },
  mound: { x: 640, y: 430 },
  second: { x: 640, y: 285 },
  third: { x: 360, y: 500 },
  first: { x: 920, y: 500 }
};

const WALL_Y = 205;
const MIN_PLAYER_Y = WALL_Y + 25;

const PLAY_STATES = {
  READY_FOR_PITCH: "READY_FOR_PITCH",
  PITCH_IN_FLIGHT: "PITCH_IN_FLIGHT",
  SWING_WINDOW: "SWING_WINDOW",
  BALL_IN_PLAY: "BALL_IN_PLAY",
  PLAY_RESULT: "PLAY_RESULT",
  RESETTING_PLAY: "RESETTING_PLAY"
};

const TEAMS = [
  { id: "comets", name: "Comets" },
  { id: "foxes", name: "Foxes" },
  { id: "orbitals", name: "Orbitals" }
];

const input = {
  keysHeld: new Set(),
  keysPressedThisFrame: new Set()
};

const PLAYER_DEFAULTS = {
  defense: [
    { id: "p", role: "pitcher", x: 640, y: 430 },
    { id: "c", role: "catcher", x: 640, y: 650 },
    { id: "1b", role: "first", x: 900, y: 470 },
    { id: "2b", role: "second", x: 760, y: 360 },
    { id: "ss", role: "shortstop", x: 520, y: 360 },
    { id: "3b", role: "third", x: 380, y: 470 },
    { id: "lf", role: "left", x: 300, y: 270 },
    { id: "cf", role: "center", x: 640, y: 240 },
    { id: "rf", role: "right", x: 980, y: 270 }
  ],
  offense: [{ id: "b", role: "batter", x: 690, y: 600 }]
};

const GAME = {
  mode: "start",
  state: PLAY_STATES.READY_FOR_PITCH,
  lockInput: false,
  inning: 1,
  half: "top",
  balls: 0,
  strikes: 0,
  outs: 0,
  score: { away: 0, home: 0 },
  teams: { away: TEAMS[0], home: TEAMS[1] },
  statusMessage: "Select teams and press Start.",
  bannerTitle: "PITCH NOW",
  bannerSubtitle: "A/D aim • 1-4 pitch type • SPACE throw",
  selectedPitchType: "FASTBALL",
  pitchAim: 0,
  pitchThrown: false,
  swingUsed: false,
  hitDetected: false,
  throwActive: false,
  selectedFielder: null,
  lastAction: "-",
  ballInPlayElapsed: 0,
  ballStillElapsed: 0,
  debugVisible: false,
  players: [],
  ball: {
    x: BASES.mound.x,
    y: BASES.mound.y,
    vx: 0,
    vy: 0,
    visible: true,
    state: "idle",
    pitchElapsed: 0,
    pitchDuration: 0.9,
    pitchStart: { x: BASES.mound.x, y: BASES.mound.y },
    pitchTarget: { x: BASES.home.x, y: BASES.home.y - 12 },
    heldBy: null
  },
  pendingResetTimer: null
};

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function normalizeKey(e) {
  if (e.code === "Space") return "Space";
  return e.key.length === 1 ? e.key.toLowerCase() : e.key;
}

function clearInputFlags() {
  input.keysPressedThisFrame.clear();
}

function clearQueuedInputs() {
  input.keysPressedThisFrame.clear();
}

function lockAllGameplayInput() {
  GAME.lockInput = true;
}

function unlockGameplayInput() {
  GAME.lockInput = false;
}

function setStatus(text) {
  GAME.statusMessage = text;
  messageBar.textContent = text;
}

function setBanner(title, subtitle) {
  GAME.bannerTitle = title;
  GAME.bannerSubtitle = subtitle;
  modeBannerTitle.textContent = title;
  modeBannerSubtitle.textContent = subtitle;
}

function setState(nextState) {
  GAME.state = nextState;
  switch (nextState) {
    case PLAY_STATES.READY_FOR_PITCH:
      setBanner("PITCH NOW", "Player 2: Aim A/D • Select 1-4 • Press SPACE to throw");
      break;
    case PLAY_STATES.PITCH_IN_FLIGHT:
    case PLAY_STATES.SWING_WINDOW:
      setBanner("SWING NOW", "Player 1: Press SPACE");
      break;
    case PLAY_STATES.BALL_IN_PLAY:
      GAME.ballInPlayElapsed = 0;
      GAME.ballStillElapsed = 0;
      setBanner("FIELD THE BALL", "WASD move • Q first • F second • E third • R home");
      break;
    case PLAY_STATES.PLAY_RESULT:
      setBanner("PLAY RESULT", GAME.statusMessage);
      break;
    case PLAY_STATES.RESETTING_PLAY:
      setBanner("RESETTING...", "Next pitch coming");
      break;
    default:
      setBanner("PITCH NOW", "Player 2: Aim A/D • Select 1-4 • Press SPACE to throw");
  }
}

function setTeamOptions() {
  const options = TEAMS.map((t) => `<option value="${t.id}">${t.name}</option>`).join("");
  teamSelectA.innerHTML = options;
  teamSelectB.innerHTML = options;
  teamSelectA.value = TEAMS[0].id;
  teamSelectB.value = TEAMS[1].id;
}

function teamById(id) {
  return TEAMS.find((t) => t.id === id) ?? TEAMS[0];
}

function configureTeams() {
  GAME.teams.away = teamById(teamSelectA.value);
  GAME.teams.home = teamById(teamSelectB.value);
  if (GAME.teams.away.id === GAME.teams.home.id) {
    GAME.teams.home = TEAMS.find((t) => t.id !== GAME.teams.away.id) ?? TEAMS[1];
  }
}

function updateScoreboard() {
  awayTeamName.textContent = GAME.teams.away.name;
  homeTeamName.textContent = GAME.teams.home.name;
  awayScoreValue.textContent = String(GAME.score.away);
  homeScoreValue.textContent = String(GAME.score.home);
  inningValue.textContent = String(GAME.inning);
  halfValue.textContent = GAME.half.toUpperCase();
  ballsValue.textContent = String(GAME.balls);
  strikesValue.textContent = String(GAME.strikes);
  outsValue.textContent = String(GAME.outs);
}

function clampPlayerToField(player) {
  player.x = clamp(player.x, FIELD_BOUNDS.left, FIELD_BOUNDS.right);
  player.y = clamp(player.y, MIN_PLAYER_Y, FIELD_BOUNDS.bottom + 12);
}

function spawnPlayersOnce() {
  if (GAME.players.length >= 10) return;
  GAME.players = [];
  for (const p of PLAYER_DEFAULTS.defense) {
    GAME.players.push({
      id: p.id,
      team: "defense",
      role: p.role,
      x: p.x,
      y: p.y,
      defaultX: p.x,
      defaultY: p.y,
      visible: true,
      active: true
    });
  }
  for (const p of PLAYER_DEFAULTS.offense) {
    GAME.players.push({
      id: p.id,
      team: "offense",
      role: p.role,
      x: p.x,
      y: p.y,
      defaultX: p.x,
      defaultY: p.y,
      visible: true,
      active: true
    });
  }
  GAME.players.forEach(clampPlayerToField);
}

function resetPlayerPositions() {
  if (GAME.players.length < 10) spawnPlayersOnce();
  for (const p of GAME.players) {
    p.x = p.defaultX;
    p.y = p.defaultY;
    p.visible = true;
    p.active = true;
    clampPlayerToField(p);
  }
}

function getPitcher() {
  return GAME.players.find((p) => p.role === "pitcher");
}

function getBatter() {
  return GAME.players.find((p) => p.role === "batter");
}

function getDefensePlayers() {
  return GAME.players.filter((p) => p.team === "defense");
}

function respawnIfNeeded() {
  if (GAME.players.length < 10) spawnPlayersOnce();
}

function resetBallToPitcher() {
  const pitcher = getPitcher();
  GAME.ball.x = pitcher ? pitcher.x : BASES.mound.x;
  GAME.ball.y = pitcher ? pitcher.y - 8 : BASES.mound.y;
  GAME.ball.vx = 0;
  GAME.ball.vy = 0;
  GAME.ball.visible = true;
  GAME.ball.state = "idle";
  GAME.ball.pitchElapsed = 0;
  GAME.ball.heldBy = null;
}

function clearPendingResetTimer() {
  if (GAME.pendingResetTimer) {
    clearTimeout(GAME.pendingResetTimer);
    GAME.pendingResetTimer = null;
  }
}

function completePlay(message) {
  if (GAME.state === PLAY_STATES.PLAY_RESULT || GAME.state === PLAY_STATES.RESETTING_PLAY) return;
  clearPendingResetTimer();
  setStatus(message);
  setState(PLAY_STATES.PLAY_RESULT);
  lockAllGameplayInput();
  GAME.pendingResetTimer = setTimeout(() => {
    GAME.pendingResetTimer = null;
    resetForNextPitch();
  }, 1200);
}

function resetForNextPitch() {
  clearPendingResetTimer();
  setState(PLAY_STATES.RESETTING_PLAY);
  resetBallToPitcher();
  resetPlayerPositions();
  GAME.pitchThrown = false;
  GAME.swingUsed = false;
  GAME.hitDetected = false;
  GAME.throwActive = false;
  GAME.selectedFielder = null;
  GAME.ball.state = "idle";
  GAME.ballInPlayElapsed = 0;
  GAME.ballStillElapsed = 0;
  clearInputFlags();
  clearQueuedInputs();
  unlockGameplayInput();
  setTimeout(() => {
    setState(PLAY_STATES.READY_FOR_PITCH);
    setStatus("PITCH NOW: A/D aim, 1-4 select pitch, SPACE throw.");
  }, 200);
}

function startGame() {
  configureTeams();
  GAME.mode = "play";
  GAME.inning = 1;
  GAME.half = "top";
  GAME.balls = 0;
  GAME.strikes = 0;
  GAME.outs = 0;
  GAME.score.away = 0;
  GAME.score.home = 0;
  GAME.pitchAim = 0;
  GAME.selectedPitchType = "FASTBALL";
  GAME.lastAction = "start";
  GAME.debugVisible = false;
  spawnPlayersOnce();
  resetForNextPitch();
  startScreen.classList.add("hidden");
  gameOverScreen.classList.add("hidden");
  updateScoreboard();
}

function addOutAndAdvance(message) {
  GAME.outs += 1;
  GAME.balls = 0;
  GAME.strikes = 0;
  if (GAME.outs >= 3) {
    GAME.outs = 0;
    GAME.half = GAME.half === "top" ? "bottom" : "top";
    if (GAME.half === "top") GAME.inning += 1;
  }
  updateScoreboard();
  completePlay(message);
}

function addStrike(message) {
  GAME.strikes += 1;
  if (GAME.strikes >= 3) {
    addOutAndAdvance("Strike three. Batter out.");
    return;
  }
  updateScoreboard();
  completePlay(message);
}

function addBall(message) {
  GAME.balls += 1;
  if (GAME.balls >= 4) {
    GAME.balls = 0;
    GAME.strikes = 0;
    updateScoreboard();
    completePlay("Ball four. Walk.");
    return;
  }
  updateScoreboard();
  completePlay(message);
}

function chooseNearestFielder(x, y) {
  const defense = getDefensePlayers();
  let best = null;
  let bestDist = Infinity;
  for (const p of defense) {
    const d = Math.hypot(p.x - x, p.y - y);
    if (d < bestDist) {
      bestDist = d;
      best = p;
    }
  }
  return best;
}

function throwToBase(baseKey) {
  if (!GAME.selectedFielder) return;
  GAME.throwActive = true;
  let resultMessage = "Runner safe.";
  if (Math.random() < 0.45) {
    resultMessage = baseKey === "first" ? "Out at first." : `Out at ${baseKey}.`;
    addOutAndAdvance(resultMessage);
  } else {
    completePlay(resultMessage);
  }
  GAME.throwActive = false;
}

function beginPitch() {
  if (GAME.state !== PLAY_STATES.READY_FOR_PITCH || GAME.pitchThrown || GAME.lockInput) return;
  const pitcher = getPitcher();
  if (!pitcher) return;
  GAME.pitchThrown = true;
  GAME.swingUsed = false;
  GAME.ball.state = "pitched";
  GAME.ball.pitchElapsed = 0;
  GAME.ball.pitchDuration = 0.9;
  GAME.ball.pitchStart = { x: pitcher.x, y: pitcher.y - 8 };
  GAME.ball.pitchTarget = { x: BASES.home.x + GAME.pitchAim * 65, y: BASES.home.y - 18 };
  GAME.ball.x = GAME.ball.pitchStart.x;
  GAME.ball.y = GAME.ball.pitchStart.y;
  setState(PLAY_STATES.PITCH_IN_FLIGHT);
  setStatus("SWING NOW");
}

function swingAtPitch() {
  if ((GAME.state !== PLAY_STATES.PITCH_IN_FLIGHT && GAME.state !== PLAY_STATES.SWING_WINDOW) || GAME.swingUsed || GAME.lockInput) {
    return;
  }
  GAME.swingUsed = true;
  const contactDist = Math.hypot(GAME.ball.x - BASES.home.x, GAME.ball.y - (BASES.home.y - 18));
  if (contactDist <= 30) {
    GAME.hitDetected = true;
    const qualityRoll = Math.random();
    let quality = "GOOD";
    if (qualityRoll < 0.2) quality = "WEAK";
    else if (qualityRoll > 0.78) quality = "PERFECT";

    const dir = Math.random() * Math.PI - Math.PI / 2;
    const speed = quality === "PERFECT" ? 380 : (quality === "GOOD" ? 290 : 220);
    GAME.ball.vx = Math.cos(dir) * speed;
    GAME.ball.vy = -(Math.abs(Math.sin(dir)) * speed * 0.85 + 120);
    GAME.ball.state = "hit";
    setState(PLAY_STATES.BALL_IN_PLAY);
    GAME.selectedFielder = chooseNearestFielder(GAME.ball.x, GAME.ball.y);
    GAME.lastAction = `hit-${quality.toLowerCase()}`;
    setStatus(`${quality} contact! Field the ball.`);
  } else if (contactDist <= 56) {
    completePlay("Foul ball.");
  } else {
    addStrike("Swing and miss. Strike.");
  }
}

function updatePitchFlight(dt) {
  if (GAME.ball.state !== "pitched") return;
  GAME.ball.pitchElapsed += dt;
  const t = clamp(GAME.ball.pitchElapsed / GAME.ball.pitchDuration, 0, 1);
  GAME.ball.x = lerp(GAME.ball.pitchStart.x, GAME.ball.pitchTarget.x, t);
  GAME.ball.y = lerp(GAME.ball.pitchStart.y, GAME.ball.pitchTarget.y, t);
  if (t >= 0.52 && GAME.state === PLAY_STATES.PITCH_IN_FLIGHT) {
    setState(PLAY_STATES.SWING_WINDOW);
  }
  if (t >= 1) {
    if (!GAME.swingUsed) addStrike("Called strike.");
    else if (!GAME.hitDetected) addStrike("Swing and miss. Strike.");
  }
}

function updateBallInPlay(dt) {
  if (GAME.state !== PLAY_STATES.BALL_IN_PLAY) return;
  GAME.ballInPlayElapsed += dt;
  if (GAME.ballInPlayElapsed > 8) {
    completePlay("Play over. Ready for next pitch.");
    return;
  }

  GAME.ball.x += GAME.ball.vx * dt;
  GAME.ball.y += GAME.ball.vy * dt;
  GAME.ball.vx *= 0.988;
  GAME.ball.vy *= 0.988;

  if (GAME.ball.y < WALL_Y && Math.abs(GAME.ball.vy) > 160) {
    if (Math.random() < 0.25) {
      completePlay("Home run!");
    } else {
      GAME.ball.y = WALL_Y;
      GAME.ball.vy = Math.abs(GAME.ball.vy) * 0.45;
      GAME.ball.vx *= 0.75;
    }
    return;
  }

  if (GAME.ball.x < FIELD_BOUNDS.left || GAME.ball.x > FIELD_BOUNDS.right) {
    GAME.ball.vx *= -0.45;
    GAME.ball.x = clamp(GAME.ball.x, FIELD_BOUNDS.left, FIELD_BOUNDS.right);
  }
  if (GAME.ball.y > FIELD_BOUNDS.bottom) {
    GAME.ball.vy *= -0.42;
    GAME.ball.y = FIELD_BOUNDS.bottom;
  }

  const speed = Math.hypot(GAME.ball.vx, GAME.ball.vy);
  if (speed < 26) GAME.ballStillElapsed += dt;
  else GAME.ballStillElapsed = 0;
  if (GAME.ballStillElapsed > 1.5) {
    completePlay("Ball dead. Ready for next pitch.");
    return;
  }

  if (!GAME.selectedFielder) {
    GAME.selectedFielder = chooseNearestFielder(GAME.ball.x, GAME.ball.y);
  }

  if (GAME.selectedFielder) {
    const d = Math.hypot(GAME.selectedFielder.x - GAME.ball.x, GAME.selectedFielder.y - GAME.ball.y);
    if (d < 20) {
      GAME.ball.heldBy = GAME.selectedFielder.id;
      GAME.ball.state = "fielded";
      GAME.ball.x = GAME.selectedFielder.x;
      GAME.ball.y = GAME.selectedFielder.y - 16;
      GAME.ball.vx = 0;
      GAME.ball.vy = 0;
      setStatus("THROW TO A BASE");
      GAME.lastAction = "fielded";
    }
  }
}

function moveSelectedFielder(dt) {
  if (GAME.state !== PLAY_STATES.BALL_IN_PLAY || !GAME.selectedFielder || GAME.lockInput) return;
  let dx = 0;
  let dy = 0;
  if (input.keysHeld.has("w")) dy -= 1;
  if (input.keysHeld.has("s")) dy += 1;
  if (input.keysHeld.has("a")) dx -= 1;
  if (input.keysHeld.has("d")) dx += 1;
  const mag = Math.hypot(dx, dy) || 1;
  const speed = 220;
  GAME.selectedFielder.x += (dx / mag) * speed * dt;
  GAME.selectedFielder.y += (dy / mag) * speed * dt;
  clampPlayerToField(GAME.selectedFielder);
  if (GAME.ball.heldBy === GAME.selectedFielder.id) {
    GAME.ball.x = GAME.selectedFielder.x;
    GAME.ball.y = GAME.selectedFielder.y - 16;
  }
}

function handleGameplayInput() {
  if (GAME.lockInput) return;

  if (GAME.state === PLAY_STATES.READY_FOR_PITCH) {
    if (input.keysHeld.has("a")) GAME.pitchAim = clamp(GAME.pitchAim - 0.07, -1, 1);
    if (input.keysHeld.has("d")) GAME.pitchAim = clamp(GAME.pitchAim + 0.07, -1, 1);
    if (input.keysPressedThisFrame.has("1")) GAME.selectedPitchType = "FASTBALL";
    if (input.keysPressedThisFrame.has("2")) GAME.selectedPitchType = "CHANGEUP";
    if (input.keysPressedThisFrame.has("3")) GAME.selectedPitchType = "CURVEBALL";
    if (input.keysPressedThisFrame.has("4")) GAME.selectedPitchType = "SLIDER";
    if (input.keysPressedThisFrame.has("Space")) beginPitch();
  } else if (GAME.state === PLAY_STATES.PITCH_IN_FLIGHT || GAME.state === PLAY_STATES.SWING_WINDOW) {
    if (input.keysPressedThisFrame.has("Space")) swingAtPitch();
  } else if (GAME.state === PLAY_STATES.BALL_IN_PLAY) {
    if (GAME.ball.heldBy && input.keysPressedThisFrame.has("q")) throwToBase("first");
    if (GAME.ball.heldBy && input.keysPressedThisFrame.has("f")) throwToBase("second");
    if (GAME.ball.heldBy && input.keysPressedThisFrame.has("e")) throwToBase("third");
    if (GAME.ball.heldBy && input.keysPressedThisFrame.has("r")) throwToBase("home");
  }
}

function drawBackgroundAndStadium() {
  ctx.fillStyle = "#07111f";
  ctx.fillRect(0, 0, VIRTUAL_WIDTH, VIRTUAL_HEIGHT);
  ctx.fillStyle = "#0d2450";
  ctx.fillRect(0, HEADER_HEIGHT, VIRTUAL_WIDTH, 88);

  for (let i = 0; i < 480; i += 1) {
    const x = (i * 53) % VIRTUAL_WIDTH;
    const y = HEADER_HEIGHT + 10 + ((i * 29) % 70);
    const c = i % 3 === 0 ? "#39d7ff" : (i % 3 === 1 ? "#ffb36a" : "#ba8dff");
    ctx.fillStyle = c;
    ctx.fillRect(x, y, 2, 2);
  }
}

function drawField() {
  const grassGrad = ctx.createLinearGradient(0, FIELD_BOUNDS.top, 0, FIELD_BOUNDS.bottom);
  grassGrad.addColorStop(0, "#2fa24f");
  grassGrad.addColorStop(1, "#1f7d38");
  ctx.fillStyle = grassGrad;
  ctx.fillRect(FIELD_BOUNDS.left, FIELD_BOUNDS.top, FIELD_BOUNDS.right - FIELD_BOUNDS.left, FIELD_BOUNDS.bottom - FIELD_BOUNDS.top);

  for (let x = FIELD_BOUNDS.left - 200; x < FIELD_BOUNDS.right + 220; x += 36) {
    ctx.fillStyle = "rgba(255,255,255,0.07)";
    ctx.beginPath();
    ctx.moveTo(x, FIELD_BOUNDS.top);
    ctx.lineTo(x + 12, FIELD_BOUNDS.top);
    ctx.lineTo(x + 210, FIELD_BOUNDS.bottom + 20);
    ctx.lineTo(x + 172, FIELD_BOUNDS.bottom + 20);
    ctx.closePath();
    ctx.fill();
  }

  ctx.beginPath();
  ctx.moveTo(FIELD_BOUNDS.left + 50, WALL_Y);
  ctx.quadraticCurveTo(VIRTUAL_WIDTH / 2, WALL_Y - 55, FIELD_BOUNDS.right - 50, WALL_Y);
  ctx.lineTo(FIELD_BOUNDS.right - 50, WALL_Y + 28);
  ctx.quadraticCurveTo(VIRTUAL_WIDTH / 2, WALL_Y - 27, FIELD_BOUNDS.left + 50, WALL_Y + 28);
  ctx.closePath();
  ctx.fillStyle = "#2f66b8";
  ctx.fill();
  ctx.strokeStyle = "#95d6ff";
  ctx.lineWidth = 3;
  ctx.stroke();

  const dirtGrad = ctx.createLinearGradient(BASES.home.x, BASES.second.y, BASES.home.x, BASES.home.y + 36);
  dirtGrad.addColorStop(0, "#dba56b");
  dirtGrad.addColorStop(1, "#c99052");
  ctx.fillStyle = dirtGrad;
  ctx.beginPath();
  ctx.moveTo(BASES.home.x, BASES.home.y + 36);
  ctx.lineTo(BASES.third.x - 60, BASES.third.y);
  ctx.lineTo(BASES.second.x, BASES.second.y - 52);
  ctx.lineTo(BASES.first.x + 60, BASES.first.y);
  ctx.closePath();
  ctx.fill();

  ctx.strokeStyle = "rgba(240,220,180,0.85)";
  ctx.lineWidth = 16;
  ctx.beginPath();
  ctx.moveTo(BASES.home.x, BASES.home.y + 5);
  ctx.lineTo(BASES.first.x + 8, BASES.first.y + 2);
  ctx.lineTo(BASES.second.x, BASES.second.y - 12);
  ctx.lineTo(BASES.third.x - 8, BASES.third.y + 2);
  ctx.closePath();
  ctx.stroke();

  ctx.strokeStyle = "#f4f4f4";
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(BASES.home.x, BASES.home.y);
  ctx.lineTo(170, 260);
  ctx.moveTo(BASES.home.x, BASES.home.y);
  ctx.lineTo(1110, 260);
  ctx.stroke();

  ctx.fillStyle = "rgba(0,0,0,0.18)";
  ctx.beginPath();
  ctx.ellipse(BASES.mound.x + 2, BASES.mound.y + 28, 52, 18, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#ca9760";
  ctx.beginPath();
  ctx.ellipse(BASES.mound.x, BASES.mound.y + 24, 48, 17, 0, 0, Math.PI * 2);
  ctx.fill();

  drawBase(BASES.first.x, BASES.first.y);
  drawBase(BASES.second.x, BASES.second.y);
  drawBase(BASES.third.x, BASES.third.y);
  drawHomePlate(BASES.home.x, BASES.home.y);
}

function drawBase(x, y) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(Math.PI / 4);
  ctx.fillStyle = "rgba(0,0,0,0.2)";
  ctx.fillRect(-12, -9, 24, 24);
  ctx.fillStyle = "#f4f4f4";
  ctx.fillRect(-12, -12, 24, 24);
  ctx.restore();
}

function drawHomePlate(x, y) {
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = "#f4f4f4";
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(12, -8);
  ctx.lineTo(12, -24);
  ctx.lineTo(-12, -24);
  ctx.lineTo(-12, -8);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function drawPlayerShadow(player) {
  ctx.fillStyle = "rgba(0,0,0,0.28)";
  ctx.beginPath();
  ctx.ellipse(player.x, player.y + 20, 13, 5, 0, 0, Math.PI * 2);
  ctx.fill();
}

function drawPlayer(player) {
  const isDefense = player.team === "defense";
  const jersey = isDefense ? "#1e7cff" : "#ff7a1a";
  const cap = isDefense ? "#124fb5" : "#8a3b11";
  const selected = GAME.selectedFielder?.id === player.id && GAME.state === PLAY_STATES.BALL_IN_PLAY;
  ctx.save();
  ctx.translate(player.x - 10, player.y - 18);

  ctx.fillStyle = "#e2b890";
  ctx.fillRect(5, -5, 12, 11);
  ctx.fillStyle = cap;
  ctx.fillRect(5, -9, 12, 4);

  ctx.fillStyle = jersey;
  ctx.fillRect(3, 6, 16, 17);
  ctx.fillStyle = "#1c2340";
  ctx.fillRect(4, 23, 5, 10);
  ctx.fillRect(13, 23, 5, 10);

  if (selected) {
    ctx.strokeStyle = "#ffee7a";
    ctx.lineWidth = 2;
    ctx.strokeRect(0, -12, 22, 48);
  }
  ctx.restore();
}

function drawPlayers() {
  const sorted = [...GAME.players].sort((a, b) => a.y - b.y);
  for (const p of sorted) {
    if (!p.visible) continue;
    drawPlayerShadow(p);
  }
  for (const p of sorted) {
    if (!p.visible) continue;
    drawPlayer(p);
  }
}

function drawBall() {
  if (!GAME.ball.visible) return;
  ctx.fillStyle = "rgba(180,230,255,0.35)";
  ctx.beginPath();
  ctx.arc(GAME.ball.x, GAME.ball.y, 8, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.arc(GAME.ball.x, GAME.ball.y, 4.8, 0, Math.PI * 2);
  ctx.fill();
}

function drawPanels() {
  const pitchActive = GAME.state === PLAY_STATES.READY_FOR_PITCH;
  const contactActive = GAME.state === PLAY_STATES.PITCH_IN_FLIGHT || GAME.state === PLAY_STATES.SWING_WINDOW;

  ctx.globalAlpha = pitchActive ? 1 : 0.45;
  ctx.fillStyle = "rgba(5,15,30,0.92)";
  ctx.fillRect(96, 548, 320, 90);
  ctx.strokeStyle = "#22dfff";
  ctx.lineWidth = 2;
  ctx.strokeRect(96, 548, 320, 90);
  ctx.fillStyle = "#8de7ff";
  ctx.font = "bold 22px Trebuchet MS";
  ctx.fillText(pitchActive ? "PITCH CONTROL - ACTIVE" : "PITCH CONTROL - LOCKED", 110, 576);
  ctx.font = "18px Trebuchet MS";
  ctx.fillStyle = "#f0f8ff";
  ctx.fillText(`Aim: A/D | Pitch: ${GAME.selectedPitchType}`, 112, 605);

  ctx.globalAlpha = contactActive ? 1 : 0.45;
  ctx.fillStyle = "rgba(5,15,30,0.92)";
  ctx.fillRect(866, 548, 320, 90);
  ctx.strokeStyle = "#22dfff";
  ctx.strokeRect(866, 548, 320, 90);
  ctx.fillStyle = "#8de7ff";
  ctx.font = "bold 22px Trebuchet MS";
  ctx.fillText(contactActive ? "CONTACT - SWING NOW" : "CONTACT - WAITING", 884, 576);
  ctx.fillStyle = "#ffbb6d";
  ctx.fillRect(884, 597, 90, 14);
  ctx.fillStyle = "#7bffa8";
  ctx.fillRect(974, 597, 110, 14);
  ctx.fillStyle = "#7cc7ff";
  ctx.fillRect(1084, 597, 84, 14);
  ctx.globalAlpha = 1;
}

function drawDebug() {
  if (!GAME.debugVisible || GAME.mode !== "play") return;
  ctx.fillStyle = "rgba(8, 14, 28, 0.84)";
  ctx.fillRect(14, 96, 310, 112);
  ctx.strokeStyle = "#22dfff";
  ctx.strokeRect(14, 96, 310, 112);
  ctx.fillStyle = "#d9f2ff";
  ctx.font = "13px Trebuchet MS";
  ctx.fillText(`STATE: ${GAME.state}`, 24, 118);
  ctx.fillText(`PLAYERS: ${GAME.players.length}`, 24, 136);
  ctx.fillText(`BALL: ${Math.round(GAME.ball.x)}, ${Math.round(GAME.ball.y)} (${GAME.ball.state})`, 24, 154);
  ctx.fillText(`SELECTED: ${GAME.selectedFielder ? GAME.selectedFielder.role : "-"}`, 24, 172);
  ctx.fillText(`LAST ACTION: ${GAME.lastAction}`, 24, 190);
}

function drawGame() {
  ctx.clearRect(0, 0, VIRTUAL_WIDTH, VIRTUAL_HEIGHT);
  drawBackgroundAndStadium();
  drawField();
  drawPlayers();
  drawBall();
  drawPanels();
  drawDebug();
}

function updateCanvasSize() {
  const rect = fieldStage.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return;
  const scale = Math.min(rect.width / VIRTUAL_WIDTH, rect.height / VIRTUAL_HEIGHT);
  const cssW = Math.floor(VIRTUAL_WIDTH * scale);
  const cssH = Math.floor(VIRTUAL_HEIGHT * scale);
  canvas.style.width = `${cssW}px`;
  canvas.style.height = `${cssH}px`;
  canvas.width = VIRTUAL_WIDTH;
  canvas.height = VIRTUAL_HEIGHT;
}

function update(dt) {
  respawnIfNeeded();
  if (!Number.isFinite(GAME.ball.x) || !Number.isFinite(GAME.ball.y)) {
    resetForNextPitch();
    return;
  }
  if (!Object.values(PLAY_STATES).includes(GAME.state)) {
    setState(PLAY_STATES.READY_FOR_PITCH);
  }

  handleGameplayInput();
  moveSelectedFielder(dt);
  updatePitchFlight(dt);
  updateBallInPlay(dt);
  updateScoreboard();
}

function render() {
  updateCanvasSize();
  drawGame();
  modeBanner.style.setProperty("--banner-accent", "#22dfff");
  modeBannerTitle.textContent = GAME.bannerTitle;
  modeBannerSubtitle.textContent = GAME.bannerSubtitle;
  messageBar.textContent = GAME.statusMessage;
}

function gameLoop(ts) {
  const dt = Math.min((ts - gameLoop.lastTs) / 1000 || 0, 0.033);
  gameLoop.lastTs = ts;
  if (GAME.mode === "play") update(dt);
  render();
  clearInputFlags();
  requestAnimationFrame(gameLoop);
}
gameLoop.lastTs = 0;

function handleKeyDown(e) {
  const key = normalizeKey(e);
  if (!input.keysHeld.has(key)) {
    input.keysPressedThisFrame.add(key);
  }
  input.keysHeld.add(key);
  GAME.lastAction = `${key} down`;

  if (key === "`" || key === "~") {
    GAME.debugVisible = !GAME.debugVisible;
    return;
  }
  if (key === "Enter" && (GAME.mode === "start" || GAME.mode === "over")) {
    startGame();
    return;
  }
  if (key === "Space") e.preventDefault();
}

function handleKeyUp(e) {
  const key = normalizeKey(e);
  input.keysHeld.delete(key);
}

function boot() {
  setTeamOptions();
  updateCanvasSize();
  spawnPlayersOnce();
  updateScoreboard();
  setState(PLAY_STATES.READY_FOR_PITCH);
  setStatus("Select teams and press Start.");
  startButton.addEventListener("click", startGame);
  restartButton.addEventListener("click", startGame);
  window.addEventListener("keydown", handleKeyDown);
  window.addEventListener("keyup", handleKeyUp);
  window.addEventListener("resize", updateCanvasSize);
  requestAnimationFrame(gameLoop);
}

boot();
