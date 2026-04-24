// Neon Slugger - a simple original 2D arcade baseball game.
// Main systems covered below:
// 1) Game state and UI flow (start, playing, game over)
// 2) Input controls (move + swing)
// 3) Pitch simulation + timing-based hit resolution
// 4) Rendering loop for smooth pixel-style animation

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

const GAME = {
  width: canvas.width,
  height: canvas.height,
  state: "start", // start | playing | over
  score: 0,
  outs: 0,
  inning: 1,
  pitchTimer: 0,
  nextPitchDelay: 0.8,
  contactX: 220,
  gravity: 1400,
  keys: new Set(),
  particles: [],
  flashTime: 0
};

const batter = {
  x: 170,
  y: 390,
  width: 26,
  height: 52,
  speed: 300,
  swingTime: 0,
  swingDuration: 0.2,
  activeSwing: false
};

const pitcher = {
  x: 800,
  y: 380,
  width: 28,
  height: 58,
  throwCooldown: 0
};

const ball = {
  active: false,
  x: pitcher.x - 8,
  y: pitcher.y - 18,
  vx: 0,
  vy: 0,
  radius: 7,
  judged: false // ensures one swing decision per pitch
};

function resetGame() {
  GAME.state = "playing";
  GAME.score = 0;
  GAME.outs = 0;
  GAME.inning = 1;
  GAME.pitchTimer = 0;
  GAME.nextPitchDelay = 0.7;
  GAME.flashTime = 0;
  GAME.particles = [];

  batter.x = 170;
  batter.swingTime = 0;
  batter.activeSwing = false;

  resetBall();
  updateHud();
  setMessage("Pitch incoming...");
}

function resetBall() {
  ball.active = false;
  ball.x = pitcher.x - 8;
  ball.y = pitcher.y - 18;
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
  const speed = 340 + Math.random() * 420;
  ball.x = pitcher.x - 8;
  ball.y = pitcher.y - 18 + (Math.random() * 16 - 8);
  ball.vx = -speed;
  ball.vy = (Math.random() * 90 - 45);
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
    setMessage("HOME RUN! +100");
    createBurst(ball.x, ball.y, "#ffd56a", 14);
  } else if (result === "okay") {
    GAME.score += 30;
    setMessage("Nice hit! +30");
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
    updateParticles(dt);
    return;
  }

  // Batter movement with arrow keys or WASD.
  let move = 0;
  if (GAME.keys.has("ArrowUp") || GAME.keys.has("w")) move -= 1;
  if (GAME.keys.has("ArrowDown") || GAME.keys.has("s")) move += 1;
  batter.y += move * batter.speed * dt;
  batter.y = Math.max(300, Math.min(450, batter.y));

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
  // Sky and outfield strips for simple arcade depth.
  ctx.fillStyle = "#77b8ff";
  ctx.fillRect(0, 0, GAME.width, 230);

  ctx.fillStyle = "#2e8b57";
  ctx.fillRect(0, 230, GAME.width, 140);

  ctx.fillStyle = "#2a6f46";
  for (let i = 0; i < GAME.width; i += 28) {
    ctx.fillRect(i, 230, 14, 140);
  }

  ctx.fillStyle = "#c48a4a";
  ctx.fillRect(0, 370, GAME.width, 170);

  // Batter's box lines and contact zone marker.
  ctx.strokeStyle = "rgba(255,255,255,0.7)";
  ctx.lineWidth = 3;
  ctx.strokeRect(125, 355, 120, 110);

  ctx.strokeStyle = "rgba(54,225,255,0.5)";
  ctx.strokeRect(GAME.contactX - 8, 332, 16, 120);

  // Pitcher's mound
  ctx.fillStyle = "#b27d46";
  ctx.beginPath();
  ctx.ellipse(pitcher.x, 430, 82, 30, 0, 0, Math.PI * 2);
  ctx.fill();
}

function drawBatter() {
  const bob = Math.sin(performance.now() * 0.01) * 2;
  const y = batter.y + bob;

  // Body
  ctx.fillStyle = "#13294b";
  ctx.fillRect(batter.x, y, batter.width, batter.height);

  // Helmet
  ctx.fillStyle = "#36e1ff";
  ctx.fillRect(batter.x - 2, y - 12, batter.width + 4, 12);

  // Legs
  ctx.fillStyle = "#0c1a34";
  ctx.fillRect(batter.x + 2, y + batter.height, 8, 12);
  ctx.fillRect(batter.x + batter.width - 10, y + batter.height, 8, 12);

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
  const throwBob = Math.sin(performance.now() * 0.006) * 1.5;
  const y = pitcher.y + throwBob;

  ctx.fillStyle = "#4f2c82";
  ctx.fillRect(pitcher.x, y, pitcher.width, pitcher.height);

  ctx.fillStyle = "#ddb5ff";
  ctx.fillRect(pitcher.x + 4, y - 10, 20, 10);
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
  drawPitcher();
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
