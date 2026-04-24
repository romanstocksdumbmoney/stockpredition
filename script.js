// Neon Slugger - original arcade baseball game.
// Main systems:
// 1) Screen state + UI flow (start, playing, game over)
// 2) Keyboard input (movement + swing)
// 3) Baseball count logic (balls, strikes, strikeouts, walks)
// 4) Pseudo-3D baseline field + player layout + smooth animation

const canvas = document.getElementById("gameCanvas");
const ctx = canvas.getContext("2d");

const startScreen = document.getElementById("startScreen");
const gameOverScreen = document.getElementById("gameOverScreen");
const startButton = document.getElementById("startButton");
const restartButton = document.getElementById("restartButton");
const messageBar = document.getElementById("messageBar");

const scoreValue = document.getElementById("scoreValue");
const outsValue = document.getElementById("outsValue");
const ballsValue = document.getElementById("ballsValue");
const strikesValue = document.getElementById("strikesValue");
const inningValue = document.getElementById("inningValue");
const finalScoreText = document.getElementById("finalScoreText");

// Baseline camera layout: home plate on right, field opens to the left.
const FIELD = {
  home: { x: 790, y: 390 },
  first: { x: 640, y: 285 },
  second: { x: 500, y: 370 },
  third: { x: 640, y: 475 },
  mound: { x: 640, y: 380 },
  foulTop: { x: 218, y: 32 },
  foulBottom: { x: 218, y: 538 }
};

const GAME = {
  width: canvas.width,
  height: canvas.height,
  state: "start", // start | playing | over
  score: 0,
  outs: 0,
  inning: 1,
  balls: 0,
  strikes: 0,
  pitchTimer: 0,
  nextPitchDelay: 0.9,
  contactX: FIELD.home.x - 12,
  gravity: 1200,
  keys: new Set(),
  particles: [],
  flashTime: 0,
  hitBall: null,
  chasingFielder: -1
};

const batter = {
  x: FIELD.home.x - 56,
  y: FIELD.home.y - 44,
  width: 24,
  height: 48,
  speed: 260,
  swingTime: 0,
  swingDuration: 0.2,
  activeSwing: false
};

const pitcher = {
  x: FIELD.mound.x - 10,
  y: FIELD.mound.y - 48,
  width: 24,
  height: 50
};

const ball = {
  active: false,
  x: pitcher.x + 14,
  y: pitcher.y + 16,
  vx: 0,
  vy: 0,
  curve: 0,
  radius: 7,
  judged: false, // this pitch has been resolved
  crossedPlate: false,
  isStrikePitch: true
};

// Defensive alignment follows a real baseline layout.
const fielders = [
  {
    role: "catcher",
    x: FIELD.home.x + 26,
    y: FIELD.home.y - 24,
    homeX: FIELD.home.x + 26,
    homeY: FIELD.home.y - 24,
    speed: 175,
    jersey: "#384f85"
  },
  {
    role: "first",
    x: FIELD.first.x + 22,
    y: FIELD.first.y - 24,
    homeX: FIELD.first.x + 22,
    homeY: FIELD.first.y - 24,
    speed: 190,
    jersey: "#8f5c34"
  },
  {
    role: "second",
    x: 568,
    y: 322,
    homeX: 568,
    homeY: 322,
    speed: 198,
    jersey: "#8f5c34"
  },
  {
    role: "shortstop",
    x: 566,
    y: 426,
    homeX: 566,
    homeY: 426,
    speed: 198,
    jersey: "#8f5c34"
  },
  {
    role: "third",
    x: FIELD.third.x - 6,
    y: FIELD.third.y + 14,
    homeX: FIELD.third.x - 6,
    homeY: FIELD.third.y + 14,
    speed: 190,
    jersey: "#8f5c34"
  },
  {
    role: "right",
    x: 392,
    y: 176,
    homeX: 392,
    homeY: 176,
    speed: 220,
    jersey: "#8b3d68"
  },
  {
    role: "center",
    x: 262,
    y: 314,
    homeX: 262,
    homeY: 314,
    speed: 224,
    jersey: "#8b3d68"
  },
  {
    role: "left",
    x: 392,
    y: 466,
    homeX: 392,
    homeY: 466,
    speed: 220,
    jersey: "#8b3d68"
  }
];

function resetCount() {
  GAME.balls = 0;
  GAME.strikes = 0;
}

function resetGame() {
  GAME.state = "playing";
  GAME.score = 0;
  GAME.outs = 0;
  GAME.inning = 1;
  resetCount();
  GAME.pitchTimer = 0;
  GAME.nextPitchDelay = 0.7;
  GAME.flashTime = 0;
  GAME.particles = [];
  GAME.hitBall = null;
  GAME.chasingFielder = -1;

  batter.y = FIELD.home.y - 44;
  batter.swingTime = 0;
  batter.activeSwing = false;

  fielders.forEach((fielder) => {
    fielder.x = fielder.homeX;
    fielder.y = fielder.homeY;
  });

  resetBall();
  updateHud();
  setMessage("Pitch incoming...");
}

function resetBall() {
  ball.active = false;
  ball.x = pitcher.x + 14;
  ball.y = pitcher.y + 16;
  ball.vx = 0;
  ball.vy = 0;
  ball.curve = 0;
  ball.judged = false;
  ball.crossedPlate = false;
  ball.isStrikePitch = true;
}

function advancePitchCycle() {
  resetBall();
  GAME.pitchTimer = 0;
  GAME.nextPitchDelay = 0.55 + Math.random() * 0.9;
}

function updateHud() {
  scoreValue.textContent = String(GAME.score);
  outsValue.textContent = String(GAME.outs);
  ballsValue.textContent = String(GAME.balls);
  strikesValue.textContent = String(GAME.strikes);
  inningValue.textContent = String(GAME.inning);
}

function setMessage(text) {
  messageBar.textContent = text;
}

function startGame() {
  startScreen.classList.add("hidden");
  gameOverScreen.classList.add("hidden");
  resetGame();
}

function endGame() {
  GAME.state = "over";
  finalScoreText.textContent = `Final Score: ${GAME.score}`;
  gameOverScreen.classList.remove("hidden");
  setMessage("Inning complete. Press Enter.");
}

function isPitchInZone(y) {
  const zoneTop = batter.y - 4;
  const zoneBottom = batter.y + 62;
  return y >= zoneTop && y <= zoneBottom;
}

function spawnPitch() {
  ball.active = true;
  ball.judged = false;
  ball.crossedPlate = false;

  const speed = 410 + Math.random() * 260;
  const startX = pitcher.x + 14;
  const startY = pitcher.y + 16 + (Math.random() * 8 - 4);
  const strikePitch = Math.random() < 0.64;

  const zoneTop = batter.y + 4;
  const zoneBottom = batter.y + 56;
  let targetY;

  if (strikePitch) {
    targetY = zoneTop + Math.random() * (zoneBottom - zoneTop);
  } else if (Math.random() < 0.5) {
    targetY = zoneTop - (16 + Math.random() * 24);
  } else {
    targetY = zoneBottom + (14 + Math.random() * 26);
  }

  const travelTime = (GAME.contactX - startX) / speed;
  const vy = (targetY - startY) / travelTime;

  ball.x = startX;
  ball.y = startY;
  ball.vx = speed;
  ball.vy = vy;
  ball.curve = Math.random() * 38 - 19;
  ball.isStrikePitch = strikePitch;
}

function registerOut(text) {
  GAME.outs += 1;
  resetCount();
  resetBall();
  updateHud();
  setMessage(text);

  if (GAME.outs >= 3) {
    endGame();
  } else {
    advancePitchCycle();
  }
}

function registerStrike(text, burstColor = "#ffd56a") {
  GAME.strikes += 1;
  createBurst(GAME.contactX, ball.y, burstColor, 7);

  if (GAME.strikes >= 3) {
    registerOut("Strike three! Batter out.");
    return;
  }

  updateHud();
  setMessage(`${text} Count: ${GAME.balls}-${GAME.strikes}`);
  advancePitchCycle();
}

function registerBall(text) {
  GAME.balls += 1;
  createBurst(GAME.contactX, ball.y, "#7ad6ff", 6);

  if (GAME.balls >= 4) {
    // Arcade bonus on walk keeps the pace fun.
    GAME.score += 20;
    resetCount();
    updateHud();
    setMessage("Ball four! Walk drawn. +20");
    advancePitchCycle();
    return;
  }

  updateHud();
  setMessage(`${text} Count: ${GAME.balls}-${GAME.strikes}`);
  advancePitchCycle();
}

function swingBat() {
  if (GAME.state !== "playing") return;
  if (batter.activeSwing) return;

  batter.activeSwing = true;
  batter.swingTime = batter.swingDuration;

  if (!ball.active || ball.judged) return;

  const dx = Math.abs(ball.x - GAME.contactX);
  const dy = Math.abs(ball.y - (batter.y + 28));

  // Timing/contact windows:
  // very tight = perfect (home run), medium = okay hit, else swinging strike.
  if (dx <= 15 && dy <= 18) {
    ball.judged = true;
    resolveHit("perfect");
  } else if (dx <= 34 && dy <= 30) {
    ball.judged = true;
    resolveHit("okay");
  } else {
    ball.judged = true;
    registerStrike("Swing and miss.", "#ff8c7b");
  }
}

function resolveTakenPitch() {
  ball.judged = true;
  if (isPitchInZone(ball.y)) {
    registerStrike("Called strike.");
  } else {
    registerBall("Ball.");
  }
}

function resolveHit(result) {
  if (result === "perfect") {
    GAME.score += 100;
    GAME.flashTime = 0.12;
    setMessage("HOME RUN! +100");
    launchHitBall("perfect");
    createBurst(ball.x, ball.y, "#ffd56a", 14);
  } else {
    GAME.score += 35;
    setMessage("Base hit! +35");
    launchHitBall("okay");
    createBurst(ball.x, ball.y, "#77ffb0", 10);
  }

  resetCount();
  updateHud();
  advancePitchCycle();
}

function launchHitBall(kind) {
  const startX = GAME.contactX + 4;
  const startY = batter.y + 28;

  const targetX = kind === "perfect"
    ? 140 + Math.random() * 180
    : 290 + Math.random() * 250;
  const targetY = kind === "perfect"
    ? 75 + Math.random() * 120
    : 190 + Math.random() * 220;

  GAME.hitBall = {
    x: startX,
    y: startY,
    startX,
    startY,
    targetX,
    targetY,
    elapsed: 0,
    travelTime: kind === "perfect" ? 1.08 : 0.82,
    arcHeight: kind === "perfect" ? 230 : 140
  };

  GAME.chasingFielder = pickClosestFielder(targetX, targetY);
}

function pickClosestFielder(targetX, targetY) {
  let bestIndex = 1; // keep catcher close to plate
  let bestDistance = Number.POSITIVE_INFINITY;

  for (let i = 1; i < fielders.length; i += 1) {
    const fielder = fielders[i];
    const dx = fielder.x - targetX;
    const dy = fielder.y - targetY;
    const distSq = dx * dx + dy * dy;
    if (distSq < bestDistance) {
      bestDistance = distSq;
      bestIndex = i;
    }
  }

  return bestIndex;
}

function updateHitBall(dt) {
  if (!GAME.hitBall) return;

  GAME.hitBall.elapsed += dt;
  const t = Math.min(1, GAME.hitBall.elapsed / GAME.hitBall.travelTime);

  GAME.hitBall.x = GAME.hitBall.startX + (GAME.hitBall.targetX - GAME.hitBall.startX) * t;
  const baseY = GAME.hitBall.startY + (GAME.hitBall.targetY - GAME.hitBall.startY) * t;
  GAME.hitBall.y = baseY - Math.sin(t * Math.PI) * GAME.hitBall.arcHeight;

  if (t >= 1) {
    createBurst(GAME.hitBall.targetX, GAME.hitBall.targetY, "#d8f3ff", 7);
    GAME.hitBall = null;
    GAME.chasingFielder = -1;
  }
}

function updateFielders(dt) {
  fielders.forEach((fielder, index) => {
    let targetX = fielder.homeX;
    let targetY = fielder.homeY;

    if (GAME.hitBall && index === GAME.chasingFielder) {
      targetX = GAME.hitBall.targetX - 8;
      targetY = GAME.hitBall.targetY + 16;
    }

    const dx = targetX - fielder.x;
    const dy = targetY - fielder.y;
    const dist = Math.hypot(dx, dy);
    if (dist < 0.2) return;

    const step = fielder.speed * dt;
    if (dist <= step) {
      fielder.x = targetX;
      fielder.y = targetY;
      return;
    }

    fielder.x += (dx / dist) * step;
    fielder.y += (dy / dist) * step;
  });
}

function createBurst(x, y, color, count) {
  for (let i = 0; i < count; i += 1) {
    const angle = Math.random() * Math.PI * 2;
    const speed = 70 + Math.random() * 220;
    GAME.particles.push({
      x,
      y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      life: 0.4 + Math.random() * 0.35,
      color,
      size: 2 + Math.random() * 3
    });
  }
}

function update(dt) {
  if (GAME.state !== "playing") {
    updateHitBall(dt);
    updateFielders(dt);
    updateParticles(dt);
    return;
  }

  // Batter movement with arrow keys or WASD.
  let move = 0;
  if (GAME.keys.has("ArrowUp") || GAME.keys.has("w")) move -= 1;
  if (GAME.keys.has("ArrowDown") || GAME.keys.has("s")) move += 1;
  batter.y += move * batter.speed * dt;
  batter.y = Math.max(FIELD.home.y - 58, Math.min(FIELD.home.y + 14, batter.y));

  if (!ball.active && !GAME.hitBall) {
    GAME.pitchTimer += dt;
    if (GAME.pitchTimer >= GAME.nextPitchDelay) {
      spawnPitch();
    }
  } else if (ball.active) {
    ball.x += ball.vx * dt;
    ball.y += ball.vy * dt;
    ball.vy += ball.curve * dt;

    // Once ball reaches plate, call strike/ball if no swing contact happened.
    if (!ball.crossedPlate && ball.x >= GAME.contactX) {
      ball.crossedPlate = true;
      if (!ball.judged) {
        resolveTakenPitch();
      }
    }

    // Safety reset if ball fully exits view.
    if (ball.x > GAME.width + 40 || ball.y < -30 || ball.y > GAME.height + 30) {
      advancePitchCycle();
    }
  }

  if (batter.activeSwing) {
    batter.swingTime -= dt;
    if (batter.swingTime <= 0) {
      batter.activeSwing = false;
      batter.swingTime = 0;
    }
  }

  if (GAME.flashTime > 0) {
    GAME.flashTime -= dt;
  }

  updateHitBall(dt);
  updateFielders(dt);
  updateParticles(dt);
}

function updateParticles(dt) {
  for (let i = GAME.particles.length - 1; i >= 0; i -= 1) {
    const p = GAME.particles[i];
    p.life -= dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.vy += GAME.gravity * dt * 0.16;

    if (p.life <= 0) {
      GAME.particles.splice(i, 1);
    }
  }
}

function drawFairTerritoryMask() {
  ctx.beginPath();
  ctx.moveTo(FIELD.home.x, FIELD.home.y);
  ctx.lineTo(FIELD.foulTop.x, FIELD.foulTop.y);
  ctx.arc(FIELD.home.x, FIELD.home.y, 575, -2.58, 2.58);
  ctx.lineTo(FIELD.home.x, FIELD.home.y);
  ctx.closePath();
}

function drawField() {
  // Sky
  const sky = ctx.createLinearGradient(0, 0, 0, 220);
  sky.addColorStop(0, "#7ec2ff");
  sky.addColorStop(1, "#4a87d3");
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, GAME.width, 220);

  // Stadium wall + crowd strip
  ctx.fillStyle = "#183f7c";
  ctx.fillRect(0, 88, GAME.width, 26);
  ctx.fillStyle = "#263456";
  ctx.fillRect(0, 114, GAME.width, 62);
  for (let i = 0; i < GAME.width; i += 9) {
    const tone = i % 18 === 0 ? "#50d2ff" : "#ffb7ff";
    ctx.fillStyle = tone;
    ctx.fillRect(i, 122 + ((i / 9) % 4), 4, 6);
  }

  // Dirt base under everything
  ctx.fillStyle = "#be8a54";
  ctx.fillRect(0, 176, GAME.width, GAME.height - 176);

  // Clip and paint fair territory with striped grass.
  ctx.save();
  drawFairTerritoryMask();
  ctx.clip();

  const grass = ctx.createLinearGradient(0, 180, 0, GAME.height);
  grass.addColorStop(0, "#2f8d59");
  grass.addColorStop(1, "#1f6d45");
  ctx.fillStyle = grass;
  ctx.fillRect(0, 176, GAME.width, GAME.height - 176);

  for (let i = -220; i < GAME.width + 320; i += 34) {
    ctx.fillStyle = "rgba(255,255,255,0.08)";
    ctx.beginPath();
    ctx.moveTo(i, 166);
    ctx.lineTo(i + 24, 166);
    ctx.lineTo(i + 190, GAME.height);
    ctx.lineTo(i + 166, GAME.height);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();

  // Outfield fence in perspective.
  ctx.strokeStyle = "#0d2d55";
  ctx.lineWidth = 12;
  ctx.beginPath();
  ctx.arc(FIELD.home.x, FIELD.home.y, 575, -2.58, 2.58);
  ctx.stroke();

  // Baseline dirt paths.
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.strokeStyle = "#c89a64";
  ctx.lineWidth = 52;
  ctx.beginPath();
  ctx.moveTo(FIELD.home.x, FIELD.home.y);
  ctx.lineTo(FIELD.first.x, FIELD.first.y);
  ctx.lineTo(FIELD.second.x, FIELD.second.y);
  ctx.lineTo(FIELD.third.x, FIELD.third.y);
  ctx.lineTo(FIELD.home.x, FIELD.home.y);
  ctx.stroke();

  // Chalk baselines and foul lines.
  ctx.strokeStyle = "rgba(255, 248, 228, 0.96)";
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

  // Mound with shadow/highlight for pseudo-3D depth.
  ctx.fillStyle = "rgba(0,0,0,0.2)";
  ctx.beginPath();
  ctx.ellipse(FIELD.mound.x + 2, FIELD.mound.y + 40, 66, 28, 0, 0, Math.PI * 2);
  ctx.fill();

  const mound = ctx.createLinearGradient(FIELD.mound.x, FIELD.mound.y + 12, FIELD.mound.x, FIELD.mound.y + 60);
  mound.addColorStop(0, "#d2a36f");
  mound.addColorStop(1, "#b4814d");
  ctx.fillStyle = mound;
  ctx.beginPath();
  ctx.ellipse(FIELD.mound.x, FIELD.mound.y + 36, 64, 26, 0, 0, Math.PI * 2);
  ctx.fill();

  drawBase(FIELD.first.x, FIELD.first.y);
  drawBase(FIELD.second.x, FIELD.second.y);
  drawBase(FIELD.third.x, FIELD.third.y);
  drawHomePlate(FIELD.home.x, FIELD.home.y);

  // Batter box + strike tunnel marker.
  ctx.strokeStyle = "rgba(255,255,255,0.8)";
  ctx.lineWidth = 3;
  ctx.strokeRect(FIELD.home.x - 84, FIELD.home.y - 38, 70, 64);
  ctx.strokeStyle = "rgba(54,225,255,0.5)";
  ctx.strokeRect(GAME.contactX - 8, FIELD.home.y - 40, 16, 72);
}

function drawBase(x, y) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(Math.PI / 4);
  ctx.fillStyle = "rgba(0,0,0,0.2)";
  ctx.fillRect(-8, -6, 16, 16);
  ctx.fillStyle = "#fef9e5";
  ctx.fillRect(-8, -8, 16, 16);
  ctx.strokeStyle = "#d8cfac";
  ctx.lineWidth = 2;
  ctx.strokeRect(-8, -8, 16, 16);
  ctx.restore();
}

function drawHomePlate(x, y) {
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = "rgba(0,0,0,0.25)";
  ctx.beginPath();
  ctx.moveTo(2, 2);
  ctx.lineTo(12, -6);
  ctx.lineTo(12, 8);
  ctx.lineTo(2, 16);
  ctx.lineTo(-8, 8);
  ctx.lineTo(-8, -6);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = "#fdf7e3";
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(10, -8);
  ctx.lineTo(10, 6);
  ctx.lineTo(0, 14);
  ctx.lineTo(-10, 6);
  ctx.lineTo(-10, -8);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function drawSpritePlayer(x, y, jersey, direction = -1, isBobbing = true) {
  const bob = isBobbing ? Math.sin(performance.now() * 0.007 + x * 0.03) * 1.5 : 0;
  const bodyY = y + bob;

  // Ground shadow
  ctx.fillStyle = "rgba(0,0,0,0.25)";
  ctx.fillRect(x + 2, bodyY + 26, 16, 5);

  // head
  ctx.fillStyle = "#ffd8b0";
  ctx.fillRect(x + 4, bodyY - 7, 12, 9);

  // body
  ctx.fillStyle = jersey;
  ctx.fillRect(x + 2, bodyY + 1, 16, 18);

  // legs
  ctx.fillStyle = "#172037";
  ctx.fillRect(x + 3, bodyY + 19, 5, 9);
  ctx.fillRect(x + 12, bodyY + 19, 5, 9);

  // glove/arm indicates facing direction.
  ctx.fillStyle = "#c8a083";
  if (direction > 0) {
    ctx.fillRect(x + 17, bodyY + 8, 5, 4);
  } else {
    ctx.fillRect(x - 3, bodyY + 8, 5, 4);
  }
}

function drawBatter() {
  drawSpritePlayer(batter.x, batter.y, "#2c6dd8", -1, false);
  ctx.fillStyle = "#36e1ff";
  ctx.fillRect(batter.x + 1, batter.y - 10, batter.width + 4, 10);

  // Bat swings in a quick arc when space is pressed.
  const swingProgress = batter.activeSwing
    ? 1 - batter.swingTime / batter.swingDuration
    : 0;
  const angle = batter.activeSwing
    ? (-2.3 + swingProgress * 2.1)
    : -2;

  ctx.save();
  ctx.translate(batter.x + 6, batter.y + 16);
  ctx.rotate(angle);
  ctx.fillStyle = "#f3e6c8";
  ctx.fillRect(-46, -3, 48, 6);
  ctx.restore();
}

function drawPitcher() {
  drawSpritePlayer(pitcher.x, pitcher.y, "#7141b8", 1);
}

function drawFielders() {
  const sorted = [...fielders].sort((a, b) => a.y - b.y);
  sorted.forEach((fielder) => {
    drawSpritePlayer(fielder.x, fielder.y, fielder.jersey, 1);
  });
}

function drawHitBall() {
  if (!GAME.hitBall) return;
  ctx.fillStyle = "rgba(0,0,0,0.22)";
  ctx.fillRect(GAME.hitBall.x - 4, GAME.hitBall.y + 8, 9, 4);

  ctx.fillStyle = "#fff6cc";
  ctx.beginPath();
  ctx.arc(GAME.hitBall.x, GAME.hitBall.y, 6, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "rgba(255, 246, 204, 0.45)";
  ctx.fillRect(GAME.hitBall.x + 10, GAME.hitBall.y + 1, 8, 3);
  ctx.fillRect(GAME.hitBall.x + 20, GAME.hitBall.y + 4, 8, 3);
}

function drawBall() {
  if (!ball.active) return;

  ctx.fillStyle = "rgba(0,0,0,0.22)";
  ctx.fillRect(ball.x - 4, ball.y + 8, 9, 4);

  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.arc(ball.x, ball.y, ball.radius, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = "#ff5f5f";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(ball.x, ball.y, ball.radius - 2, 0.4, 2.6);
  ctx.stroke();
}

function drawParticles() {
  GAME.particles.forEach((p) => {
    ctx.globalAlpha = Math.max(0, p.life / 0.75);
    ctx.fillStyle = p.color;
    ctx.fillRect(p.x, p.y, p.size, p.size);
    ctx.globalAlpha = 1;
  });
}

function render() {
  ctx.clearRect(0, 0, GAME.width, GAME.height);
  drawField();
  drawFielders();
  drawPitcher();
  drawHitBall();
  drawBatter();
  drawBall();
  drawParticles();

  if (GAME.flashTime > 0) {
    ctx.fillStyle = "rgba(255, 230, 120, 0.28)";
    ctx.fillRect(0, 0, GAME.width, GAME.height);
  }
}

let lastTime = 0;
function gameLoop(timestamp) {
  const dt = Math.min((timestamp - lastTime) / 1000, 0.033);
  lastTime = timestamp;

  update(dt);
  render();
  requestAnimationFrame(gameLoop);
}

function handleKeyDown(event) {
  const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
  GAME.keys.add(key);

  if (key === " ") {
    event.preventDefault();
    swingBat();
  }

  if (key === "Enter" && (GAME.state === "start" || GAME.state === "over")) {
    startGame();
  }
}

function handleKeyUp(event) {
  const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
  GAME.keys.delete(key);
}

startButton.addEventListener("click", startGame);
restartButton.addEventListener("click", startGame);
window.addEventListener("keydown", handleKeyDown);
window.addEventListener("keyup", handleKeyUp);

updateHud();
render();
requestAnimationFrame(gameLoop);
