// Neon Slugger - original arcade baseball game.
// Main systems:
// 1) Screen state + UI flow (start, playing, game over)
// 2) Keyboard input (movement + swing)
// 3) Pitching + timing-based hit resolution
// 4) Diamond field rendering + player sprites + smooth animation

const canvas = document.getElementById("gameCanvas");
const ctx = canvas.getContext("2d");

const startScreen = document.getElementById("startScreen");
const gameOverScreen = document.getElementById("gameOverScreen");
const startButton = document.getElementById("startButton");
const restartButton = document.getElementById("restartButton");
const messageBar = document.getElementById("messageBar");

const scoreValue = document.getElementById("scoreValue");
const outsValue = document.getElementById("outsValue");
const inningValue = document.getElementById("inningValue");
const finalScoreText = document.getElementById("finalScoreText");

const FIELD = {
  home: { x: 220, y: 438 },
  first: { x: 358, y: 370 },
  second: { x: 496, y: 300 },
  third: { x: 358, y: 230 },
  mound: { x: 620, y: 338 }
};

const GAME = {
  width: canvas.width,
  height: canvas.height,
  state: "start", // start | playing | over
  score: 0,
  outs: 0,
  inning: 1,
  pitchTimer: 0,
  nextPitchDelay: 0.8,
  contactX: FIELD.home.x + 8,
  gravity: 1400,
  keys: new Set(),
  particles: [],
  flashTime: 0,
  hitBall: null,
  chasingFielder: -1
};

const batter = {
  x: 164,
  y: 382,
  width: 26,
  height: 52,
  speed: 300,
  swingTime: 0,
  swingDuration: 0.2,
  activeSwing: false
};

const pitcher = {
  x: FIELD.mound.x - 12,
  y: FIELD.mound.y - 52,
  width: 28,
  height: 58,
  throwCooldown: 0
};

const ball = {
  active: false,
  x: pitcher.x - 4,
  y: pitcher.y + 14,
  vx: 0,
  vy: 0,
  radius: 7,
  judged: false // ensures one swing decision per pitch
};

const fielders = [
  {
    role: "catcher",
    x: FIELD.home.x + 34,
    y: FIELD.home.y - 30,
    homeX: FIELD.home.x + 34,
    homeY: FIELD.home.y - 30,
    speed: 160,
    jersey: "#3f4e8f"
  },
  {
    role: "first",
    x: FIELD.first.x + 24,
    y: FIELD.first.y - 26,
    homeX: FIELD.first.x + 24,
    homeY: FIELD.first.y - 26,
    speed: 190,
    jersey: "#8f5a34"
  },
  {
    role: "second",
    x: FIELD.second.x + 4,
    y: FIELD.second.y - 26,
    homeX: FIELD.second.x + 4,
    homeY: FIELD.second.y - 26,
    speed: 195,
    jersey: "#8f5a34"
  },
  {
    role: "shortstop",
    x: FIELD.second.x - 56,
    y: FIELD.second.y + 22,
    homeX: FIELD.second.x - 56,
    homeY: FIELD.second.y + 22,
    speed: 195,
    jersey: "#8f5a34"
  },
  {
    role: "third",
    x: FIELD.third.x - 10,
    y: FIELD.third.y + 18,
    homeX: FIELD.third.x - 10,
    homeY: FIELD.third.y + 18,
    speed: 190,
    jersey: "#8f5a34"
  },
  {
    role: "left",
    x: 380,
    y: 166,
    homeX: 380,
    homeY: 166,
    speed: 210,
    jersey: "#9a3a66"
  },
  {
    role: "center",
    x: 548,
    y: 132,
    homeX: 548,
    homeY: 132,
    speed: 214,
    jersey: "#9a3a66"
  },
  {
    role: "right",
    x: 708,
    y: 178,
    homeX: 708,
    homeY: 178,
    speed: 210,
    jersey: "#9a3a66"
  }
];

function resetGame() {
  GAME.state = "playing";
  GAME.score = 0;
  GAME.outs = 0;
  GAME.inning = 1;
  GAME.pitchTimer = 0;
  GAME.nextPitchDelay = 0.7;
  GAME.flashTime = 0;
  GAME.particles = [];
  GAME.hitBall = null;
  GAME.chasingFielder = -1;

  batter.x = 164;
  batter.y = 382;
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
  ball.x = pitcher.x - 4;
  ball.y = pitcher.y + 14;
  ball.vx = 0;
  ball.vy = 0;
  ball.judged = false;
}

function updateHud() {
  scoreValue.textContent = String(GAME.score);
  outsValue.textContent = String(GAME.outs);
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

function spawnPitch() {
  ball.active = true;
  ball.judged = false;

  // Random speed keeps timing challenge dynamic.
  const speed = 330 + Math.random() * 280;
  ball.x = pitcher.x - 4;
  ball.y = pitcher.y + 14 + (Math.random() * 18 - 9);
  ball.vx = -speed;
  ball.vy = Math.random() * 62 - 31;
}

function swingBat() {
  if (GAME.state !== "playing") return;
  if (batter.activeSwing) return;

  batter.activeSwing = true;
  batter.swingTime = batter.swingDuration;

  if (!ball.active || ball.judged) return;

  const distance = Math.abs(ball.x - GAME.contactX);

  // Timing windows:
  // <= 14px: perfect (home run)
  // <= 34px: okay (single)
  // else: miss/out
  if (distance <= 14) {
    ball.judged = true;
    resolveHit("perfect");
  } else if (distance <= 34) {
    ball.judged = true;
    resolveHit("okay");
  } else {
    ball.judged = true;
    resolveHit("miss");
  }
}

function resolveHit(result) {
  if (result === "perfect") {
    GAME.score += 100;
    GAME.flashTime = 0.12;
    setMessage("HOME RUN! Crushed to deep field! +100");
    launchHitBall("perfect");
    createBurst(ball.x, ball.y, "#ffd56a", 14);
  } else if (result === "okay") {
    GAME.score += 30;
    setMessage("Solid line drive! +30");
    launchHitBall("okay");
    createBurst(ball.x, ball.y, "#77ffb0", 10);
  } else {
    GAME.outs += 1;
    setMessage("Swing and miss! OUT.");
    createBurst(ball.x, ball.y, "#ff6b7a", 8);
  }

  updateHud();
  resetBall();
  GAME.pitchTimer = 0;
  GAME.nextPitchDelay = 0.55 + Math.random() * 0.9;

  if (GAME.outs >= 3) {
    endGame();
  }
}

function launchHitBall(kind) {
  const startX = GAME.contactX + 2;
  const startY = batter.y + 18;

  const targetX = kind === "perfect"
    ? 780 + Math.random() * 140
    : 560 + Math.random() * 130;
  const targetY = kind === "perfect"
    ? 90 + Math.random() * 55
    : 210 + Math.random() * 80;

  GAME.hitBall = {
    x: startX,
    y: startY,
    startX,
    startY,
    targetX,
    targetY,
    elapsed: 0,
    travelTime: kind === "perfect" ? 1.05 : 0.85,
    arcHeight: kind === "perfect" ? 240 : 145
  };

  GAME.chasingFielder = pickClosestFielder(targetX, targetY);
}

function pickClosestFielder(targetX, targetY) {
  let bestIndex = 1; // skip catcher for chasing
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
      targetY = GAME.hitBall.targetY + 18;
    }

    const dx = targetX - fielder.x;
    const dy = targetY - fielder.y;
    const dist = Math.hypot(dx, dy);
    if (dist <= 0.2) return;

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
    const speed = 70 + Math.random() * 240;
    GAME.particles.push({
      x,
      y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      life: 0.45 + Math.random() * 0.3,
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
  batter.y = Math.max(344, Math.min(450, batter.y));

  if (!ball.active) {
    GAME.pitchTimer += dt;
    if (GAME.pitchTimer >= GAME.nextPitchDelay) {
      spawnPitch();
    }
  } else {
    ball.x += ball.vx * dt;
    ball.y += ball.vy * dt;
    ball.vy += 16 * dt;

    // If player didn't swing in time, that's an out.
    if (ball.x < GAME.contactX - 60 && !ball.judged) {
      ball.judged = true;
      resolveHit("miss");
    } else if (ball.x < -20 || ball.y > GAME.height + 20) {
      resetBall();
      GAME.pitchTimer = 0;
      GAME.nextPitchDelay = 0.5 + Math.random() * 0.8;
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
    p.vy += GAME.gravity * dt * 0.14;

    if (p.life <= 0) {
      GAME.particles.splice(i, 1);
    }
  }
}

function drawField() {
  // Sky backdrop
  ctx.fillStyle = "#70b4ff";
  ctx.fillRect(0, 0, GAME.width, 210);

  // Crowd stripe gives arcade stadium energy.
  ctx.fillStyle = "#2c355f";
  ctx.fillRect(0, 112, GAME.width, 78);
  for (let i = 0; i < GAME.width; i += 8) {
    const tone = i % 16 === 0 ? "#49d2ff" : "#f6adff";
    ctx.fillStyle = tone;
    ctx.fillRect(i, 118 + ((i / 8) % 5), 4, 6);
  }

  // Grass outfield + infield
  ctx.fillStyle = "#2f885a";
  ctx.fillRect(0, 190, GAME.width, GAME.height - 190);
  ctx.fillStyle = "#2c7d52";
  for (let i = 0; i < GAME.width; i += 34) {
    ctx.fillRect(i, 190, 17, GAME.height - 190);
  }

  // Outfield fence arc
  ctx.strokeStyle = "#255a41";
  ctx.lineWidth = 8;
  ctx.beginPath();
  ctx.arc(220, 500, 560, -1.14, -0.08);
  ctx.stroke();

  // Infield dirt ring
  ctx.fillStyle = "#b98550";
  ctx.beginPath();
  ctx.arc(FIELD.second.x - 14, FIELD.second.y + 82, 248, -2.56, -0.14);
  ctx.lineTo(185, GAME.height);
  ctx.lineTo(830, GAME.height);
  ctx.closePath();
  ctx.fill();

  // Diamond shape (base paths)
  ctx.strokeStyle = "rgba(255, 248, 224, 0.95)";
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(FIELD.home.x, FIELD.home.y);
  ctx.lineTo(FIELD.first.x, FIELD.first.y);
  ctx.lineTo(FIELD.second.x, FIELD.second.y);
  ctx.lineTo(FIELD.third.x, FIELD.third.y);
  ctx.closePath();
  ctx.stroke();

  // Foul lines
  ctx.beginPath();
  ctx.moveTo(FIELD.home.x, FIELD.home.y);
  ctx.lineTo(930, 170);
  ctx.moveTo(FIELD.home.x, FIELD.home.y);
  ctx.lineTo(290, 72);
  ctx.stroke();

  // Batter box + strike marker
  ctx.strokeStyle = "rgba(255,255,255,0.78)";
  ctx.lineWidth = 3;
  ctx.strokeRect(130, 362, 116, 96);
  ctx.strokeStyle = "rgba(54,225,255,0.65)";
  ctx.strokeRect(GAME.contactX - 8, 346, 16, 112);

  // Pitcher's mound
  ctx.fillStyle = "#c59664";
  ctx.beginPath();
  ctx.ellipse(FIELD.mound.x, FIELD.mound.y + 44, 64, 24, 0, 0, Math.PI * 2);
  ctx.fill();

  drawBase(FIELD.home.x, FIELD.home.y);
  drawBase(FIELD.first.x, FIELD.first.y);
  drawBase(FIELD.second.x, FIELD.second.y);
  drawBase(FIELD.third.x, FIELD.third.y);
}

function drawBase(x, y) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(Math.PI / 4);
  ctx.fillStyle = "#fef9e5";
  ctx.fillRect(-8, -8, 16, 16);
  ctx.strokeStyle = "#d6cea7";
  ctx.lineWidth = 2;
  ctx.strokeRect(-8, -8, 16, 16);
  ctx.restore();
}

function drawSpritePlayer(x, y, jersey, direction = 1, isBobbing = true) {
  const bob = isBobbing ? Math.sin(performance.now() * 0.007 + x * 0.03) * 1.6 : 0;
  const bodyY = y + bob;

  // head
  ctx.fillStyle = "#ffd8b0";
  ctx.fillRect(x + 4, bodyY - 8, 12, 9);

  // body
  ctx.fillStyle = jersey;
  ctx.fillRect(x + 2, bodyY, 16, 18);

  // legs
  ctx.fillStyle = "#172037";
  ctx.fillRect(x + 3, bodyY + 18, 5, 10);
  ctx.fillRect(x + 12, bodyY + 18, 5, 10);

  // tiny glove/arm for direction
  ctx.fillStyle = "#c8a083";
  if (direction > 0) {
    ctx.fillRect(x + 17, bodyY + 7, 5, 4);
  } else {
    ctx.fillRect(x - 3, bodyY + 7, 5, 4);
  }
}

function drawBatter() {
  const y = batter.y;

  drawSpritePlayer(batter.x, y, "#2c6dd8", 1, false);
  ctx.fillStyle = "#36e1ff";
  ctx.fillRect(batter.x + 1, y - 12, batter.width + 6, 10);

  // Bat swings in a quick arc when space is pressed.
  const swingProgress = batter.activeSwing
    ? 1 - batter.swingTime / batter.swingDuration
    : 0;
  const angle = batter.activeSwing
    ? (-1.2 + swingProgress * 2.2)
    : -0.75;

  ctx.save();
  ctx.translate(batter.x + 10, y + 20);
  ctx.rotate(angle);
  ctx.fillStyle = "#f3e6c8";
  ctx.fillRect(0, -3, 54, 6);
  ctx.restore();
}

function drawPitcher() {
  drawSpritePlayer(pitcher.x, pitcher.y, "#7141b8", -1);
}

function drawFielders() {
  const sorted = [...fielders].sort((a, b) => a.y - b.y);
  sorted.forEach((fielder) => {
    drawSpritePlayer(fielder.x, fielder.y, fielder.jersey, -1);
  });
}

function drawHitBall() {
  if (!GAME.hitBall) return;
  ctx.fillStyle = "#fff6cc";
  ctx.beginPath();
  ctx.arc(GAME.hitBall.x, GAME.hitBall.y, 6, 0, Math.PI * 2);
  ctx.fill();

  // Pixel-style motion trail.
  ctx.fillStyle = "rgba(255, 246, 204, 0.45)";
  ctx.fillRect(GAME.hitBall.x - 12, GAME.hitBall.y + 2, 8, 3);
  ctx.fillRect(GAME.hitBall.x - 22, GAME.hitBall.y + 5, 8, 3);
}

function drawBall() {
  if (!ball.active) return;
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

  if (key === "Enter") {
    if (GAME.state === "start" || GAME.state === "over") {
      startGame();
    }
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
