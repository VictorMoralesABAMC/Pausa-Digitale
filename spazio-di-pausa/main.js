// -------------------------
// SPEC
// -------------------------
const CALM_ENTRY_SECONDS = 10;

const PHRASE_INTERVAL_SECONDS = 20;
const USER_STAR_DAILY_CAP = 5;
const USER_REGION = "Marche";

const BLUR_MAX = 12;
const DIM_MAX = 0.35;

const CALM_THRESHOLD = 0.25;
const AGITATED_THRESHOLD = 0.60;

const BIRTH_PULSE_SECONDS = 2.0;

// MENO stelle iniziali
const SEED_STAR_COUNT = 35;

// “Altri” più lenti e random: spesso lenti (15–24s), ogni tanto veloci (6–7s)
const OTHERS_FAST_MIN = 6;
const OTHERS_FAST_MAX = 7.5;
const OTHERS_SLOW_MIN = 15;
const OTHERS_SLOW_MAX = 24;
const OTHERS_FAST_PROB = 0.18; // ~18% veloci

const STORAGE_PREFIX = "pause_sky_";

// -------------------------
// Testi
// -------------------------
const PHRASES = [
  "Non devi trovare niente.",
  "Qui il tempo non si ottimizza.",
  "Il feed non finisce: tu sì.",
  "Lascia che la luce faccia il suo lavoro.",
  "Non rispondere. Non aggiornare.",
  "Ogni impulso è un richiamo. Puoi non seguirlo.",
  "Se corri, l’immagine si chiude.",
  "Se resti, qualcosa torna leggibile.",
  "Non è vuoto: è spazio.",
  "La rete misura tutto. Qui, no.",
  "Una pausa lascia una traccia nel cielo.",
  "Puoi uscire quando vuoi. Anche adesso va bene."
];

const REGIONS = [
  "Abruzzo","Basilicata","Calabria","Campania","Emilia-Romagna","Friuli-Venezia Giulia",
  "Lazio","Liguria","Lombardia","Marche","Molise","Piemonte","Puglia","Sardegna",
  "Sicilia","Toscana","Trentino-Alto Adige","Umbria","Valle d'Aosta","Veneto"
];

function randomRegionExcluding(exclude){
  let r = exclude;
  while (r === exclude) r = REGIONS[Math.floor(Math.random() * REGIONS.length)];
  return r;
}

// -------------------------
// DOM
// -------------------------
const root = document.documentElement;
const veil = document.getElementById("veil");
const trailEl = document.getElementById("trail");
const progressHintEl = document.getElementById("progressHint");

const phraseEl = document.getElementById("phrase");
const subnoteEl = document.getElementById("subnote");
const tooltip = document.getElementById("tooltip");

const infoModal = document.getElementById("infoModal");
const infoBtn = document.getElementById("infoBtn");
const infoBtnTop = document.getElementById("infoBtnTop");
const closeInfo = document.getElementById("closeInfo");

const soundBtn = document.getElementById("soundBtn");
const soundBtnTop = document.getElementById("soundBtnTop");
const audio = document.getElementById("audio");

const sky = document.getElementById("sky");
const ctx = sky.getContext("2d");

// -------------------------
// Stato
// -------------------------
let agitation = 0;
let calmTime = 0;
let entered = false;

let phraseIndex = -1;
let phraseTimer = 0;

let lastX = null, lastY = null, lastT = null;
let lastImpulse = 0;

let hintCooldown = 0;
let displayedProgress = 0;

let stars = []; // {id,x,y,region,createdAtMs,seenAtMs}
let hoverId = null;

// “altri” (solo in B, indipendente dal tuo movimento)
let othersTimer = 0;
let othersNext = 999999;

// frasi fade
let phraseFadeTimeout = null;
let phraseTransitioning = false;

// subnote
let subnoteTimeout = null;
let capNotified = false;

// -------------------------
// Helpers
// -------------------------
function clamp01(v){ return Math.max(0, Math.min(1, v)); }
function addAgitationImpulse(value){ lastImpulse = Math.max(lastImpulse, value); }
function randBetween(a,b){ return a + Math.random() * (b-a); }

function sampleOtherInterval(){
  if (Math.random() < OTHERS_FAST_PROB) return randBetween(OTHERS_FAST_MIN, OTHERS_FAST_MAX);
  return randBetween(OTHERS_SLOW_MIN, OTHERS_SLOW_MAX);
}

function dayKeyRome() {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Rome",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  });
  return fmt.format(new Date());
}

function hashStringToInt(str){
  let h = 2166136261;
  for (let i = 0; i < str.length; i++){
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
function mulberry32(seed){
  return function(){
    let t = seed += 0x6D2B79F5;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function isUserStar(id){ return String(id).startsWith("user_"); }
function isSeedStar(id){ return String(id).startsWith("seed_"); }
function storeKey(){ return `${STORAGE_PREFIX}${dayKeyRome()}`; }

function cleanupOldDays(){
  const today = storeKey();
  const toRemove = [];
  for (let i = 0; i < localStorage.length; i++){
    const k = localStorage.key(i);
    if (k && k.startsWith(STORAGE_PREFIX) && k !== today) toRemove.push(k);
  }
  toRemove.forEach(k => localStorage.removeItem(k));
}

// -------------------------
// RESET “mie stelle” su F5 / Ctrl+R / Cmd+R
// -------------------------
function resetMyStarsToday(){
  stars = stars.filter(s => !isUserStar(s.id));
  saveStars();
}
window.addEventListener("keydown", (e) => {
  const isReloadCombo = (e.key === "F5") || ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "r");
  if (!isReloadCombo) return;
  e.preventDefault();
  resetMyStarsToday();
  location.reload();
});

// -------------------------
// Modal Info
// -------------------------
function openInfo(){ infoModal.setAttribute("aria-hidden","false"); }
function closeInfoFn(){ infoModal.setAttribute("aria-hidden","true"); }
infoBtn.addEventListener("click", openInfo);
infoBtnTop.addEventListener("click", openInfo);
closeInfo.addEventListener("click", closeInfoFn);
infoModal.addEventListener("click", (e) => { if (e.target === infoModal) closeInfoFn(); });

// -------------------------
// Audio: parte SOLO col tasto audio
// -------------------------
audio.volume = 0.18;
function setAudioIcons(){
  const icon = audio.paused ? "🔇" : "🔊";
  soundBtn.textContent = icon;
  soundBtnTop.textContent = icon;
}
async function toggleAudio(){
  try{
    if (audio.paused) await audio.play();
    else audio.pause();
  } catch {}
  setAudioIcons();
}
soundBtn.addEventListener("click", toggleAudio);
soundBtnTop.addEventListener("click", toggleAudio);
setAudioIcons();

// -------------------------
// Frasi (fade solo quando cambiano)
// -------------------------
function setPhrase(text){
  if (phraseFadeTimeout) clearTimeout(phraseFadeTimeout);

  // evita loop infinito: se già in transizione verso lo stesso testo, non rifare
  if (phraseTransitioning && phraseEl.textContent === text) return;

  phraseTransitioning = true;
  phraseEl.classList.remove("show"); // out

  phraseFadeTimeout = setTimeout(() => {
    phraseEl.textContent = text;
    phraseEl.classList.add("show"); // in
    phraseTransitioning = false;
  }, 380);
}

// quando devo solo “riaccenderla” (senza rifare il fade)
function ensurePhraseShown(){
  if (!phraseEl.textContent) phraseEl.textContent = PHRASES[phraseIndex];
  phraseEl.classList.add("show");
}

function hidePhrase(){
  if (phraseFadeTimeout) clearTimeout(phraseFadeTimeout);
  phraseTransitioning = false;
  phraseEl.classList.remove("show");
}

function flashSubnote(text, ms = 2600){
  if (subnoteTimeout) clearTimeout(subnoteTimeout);
  subnoteEl.textContent = text;
  subnoteEl.classList.add("show");
  subnoteTimeout = setTimeout(() => {
    subnoteEl.classList.remove("show");
  }, ms);
}

// -------------------------
// Canvas
// -------------------------
function resizeCanvas(){
  const dpr = window.devicePixelRatio || 1;
  sky.width = Math.floor(window.innerWidth * dpr);
  sky.height = Math.floor(window.innerHeight * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
window.addEventListener("resize", resizeCanvas);

// -------------------------
// Input -> agitazione
// -------------------------
window.addEventListener("mousemove", (e) => {
  const now = performance.now();
  if (lastT != null) {
    const dt = (now - lastT) / 1000;
    const dx = e.clientX - lastX;
    const dy = e.clientY - lastY;
    const dist = Math.hypot(dx, dy);
    const speed = dt > 0 ? (dist / dt) : 0;

    const speedCap = 1400;
    const mapped = clamp01(speed / speedCap);
    addAgitationImpulse(mapped * 0.9);
  }
  lastX = e.clientX; lastY = e.clientY; lastT = now;
});
window.addEventListener("wheel", () => addAgitationImpulse(0.85), { passive: true });
window.addEventListener("click", () => addAgitationImpulse(0.55));

// Tooltip hover (solo in B)
window.addEventListener("mousemove", (e) => {
  if (!entered) return;

  const mx = e.clientX, my = e.clientY;
  let found = null;
  let bestD2 = Infinity;
  const r = 10, r2 = r*r;

  for (const s of stars) {
    const x = s.x * window.innerWidth;
    const y = s.y * window.innerHeight;
    const dx = mx - x;
    const dy = my - y;
    const d2 = dx*dx + dy*dy;
    if (d2 < r2 && d2 < bestD2) {
      bestD2 = d2;
      found = s;
    }
  }

  if (found) {
    hoverId = found.id;
    const who = isUserStar(found.id) ? "La tua pausa da" : "Una pausa da";
    tooltip.textContent = `${who}: ${found.region}`;
    tooltip.style.transform = `translate(${mx + 12}px, ${my + 12}px)`;
  } else {
    hoverId = null;
    tooltip.style.transform = "translate(-9999px, -9999px)";
  }
});

// -------------------------
// Storage giornaliero
// -------------------------
function loadOrSeedStars(){
  const raw = localStorage.getItem(storeKey());
  if (raw) {
    try {
      const parsed = JSON.parse(raw);

      stars = parsed.map(s => {
        let r = (s.region ?? "").trim();
        if (!r || r === "_" || r === "-" || r === "—") {
          r = String(s.id).startsWith("user_") ? USER_REGION : randomRegionExcluding("");
        }
        return {
          id: s.id,
          x: s.x,
          y: s.y,
          region: r,
          createdAtMs: s.createdAtMs || Date.now(),
          seenAtMs: -1e9
        };
      });

      saveStars();
      return;
    } catch {}
  }

  // seed deterministico
  const day = dayKeyRome();
  const rng = mulberry32(hashStringToInt(day));

  const now = Date.now();
  const windowMs = 1000 * 60 * 60 * 12;
  const minTime = now - windowMs;

  const pad = 0.06;
  const seeded = [];

  for (let i = 0; i < SEED_STAR_COUNT; i++) {
    const x = pad + rng() * (1 - pad*2);
    const y = pad + rng() * (1 - pad*2);
    const region = REGIONS[Math.floor(rng() * REGIONS.length)];
    const createdAtMs = Math.floor(minTime + rng() * (now - minTime));
    const id = `seed_${day}_${i}`;
    seeded.push({ id, x, y, region, createdAtMs });
  }

  localStorage.setItem(storeKey(), JSON.stringify(seeded));
  stars = seeded.map(s => ({...s, seenAtMs: -1e9}));
}

function saveStars(){
  const minimal = stars.map(s => ({
    id: s.id, x: s.x, y: s.y, region: s.region, createdAtMs: s.createdAtMs
  }));
  localStorage.setItem(storeKey(), JSON.stringify(minimal));
}

function trimSeedStarsToTarget(target){
  const seed = stars.filter(s => isSeedStar(s.id));
  if (seed.length <= target) return;

  const rng = mulberry32(hashStringToInt(dayKeyRome() + "_trim"));
  const ids = seed.map(s => s.id);

  for (let i = ids.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [ids[i], ids[j]] = [ids[j], ids[i]];
  }

  const keep = new Set(ids.slice(0, target));
  stars = stars.filter(s => !isSeedStar(s.id) || keep.has(s.id));
  saveStars();
}

function userStarsCount(){
  return stars.filter(s => isUserStar(s.id)).length;
}

function addUserStarGold(){
  if (userStarsCount() >= USER_STAR_DAILY_CAP) return false;

  const pad = 0.06;
  const x = pad + Math.random() * (1 - pad*2);
  const y = pad + Math.random() * (1 - pad*2);

  const id = `user_${Date.now()}_${Math.floor(Math.random()*1e6)}`;
  stars.push({
    id, x, y,
    region: USER_REGION,
    createdAtMs: Date.now(),
    seenAtMs: performance.now()
  });
  saveStars();
  return true;
}

function addOtherLiveStar(){
  const pad = 0.06;
  const x = pad + Math.random() * (1 - pad*2);
  const y = pad + Math.random() * (1 - pad*2);
  const region = randomRegionExcluding(USER_REGION);

  const id = `other_${Date.now()}_${Math.floor(Math.random()*1e6)}`;
  stars.push({
    id, x, y,
    region,
    createdAtMs: Date.now(),
    seenAtMs: performance.now()
  });
  saveStars();
}

// -------------------------
// Disegno cielo
// -------------------------
function drawSky(){
  ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);

  const calmVisibility = 1 - clamp01(agitation);
  const visibility = 0.25 + 0.75 * calmVisibility;

  const nowPerf = performance.now();

  for (const s of stars) {
    const x = s.x * window.innerWidth;
    const y = s.y * window.innerHeight;

    const ageSec = Math.max(0, (Date.now() - s.createdAtMs) / 1000);
    const fadeIn = clamp01(ageSec / 1.2);

    const seenAge = (nowPerf - s.seenAtMs) / 1000;
    const isNew = seenAge >= 0 && seenAge < BIRTH_PULSE_SECONDS;

    const tw = 0.80 + 0.20 * Math.sin(ageSec * 1.2 + s.x * 10);
    const isHover = hoverId === s.id;
    const isUser = isUserStar(s.id);

    const gold = "rgba(255, 215, 130, 1)";
    const white = "rgba(255,255,255,1)";

    const coreColor = isUser ? gold : white;
    const haloColor = isUser ? gold : white;

    // halo
    ctx.globalAlpha = 0.10 * visibility * fadeIn * tw;
    ctx.beginPath();
    ctx.arc(x, y, isUser ? 7.0 : 6.0, 0, Math.PI * 2);
    ctx.fillStyle = haloColor;
    ctx.fill();

    // pulse nascita
    if (isNew) {
      const p = 1 - (seenAge / BIRTH_PULSE_SECONDS);
      const pulseR = 16 + (1 - p) * (isUser ? 34 : 28);
      ctx.globalAlpha = (isUser ? 0.18 : 0.14) * p;
      ctx.beginPath();
      ctx.arc(x, y, pulseR, 0, Math.PI * 2);
      ctx.fillStyle = haloColor;
      ctx.fill();
    }

    // core
    const coreAlpha = (isHover ? 0.95 : 0.60) * visibility * fadeIn * tw;
    const coreR = isHover ? 2.8 : (isUser ? 2.3 : 1.9);

    ctx.globalAlpha = coreAlpha;
    ctx.beginPath();
    ctx.arc(x, y, coreR, 0, Math.PI * 2);
    ctx.fillStyle = coreColor;
    ctx.fill();
  }

  ctx.globalAlpha = 1;
}

// -------------------------
// Loop
// -------------------------
let lastFrame = performance.now();

function loop(now){
  const dt = (now - lastFrame) / 1000;
  lastFrame = now;

  // agitazione
  lastImpulse *= 0.88;
  agitation = clamp01(agitation * 0.92 + lastImpulse * 0.25);

  // filtri
  root.style.setProperty("--blur", `${(agitation * BLUR_MAX).toFixed(2)}px`);
  root.style.setProperty("--dim", `${(agitation * DIM_MAX).toFixed(3)}`);

  // calma
  if (agitation < CALM_THRESHOLD) calmTime += dt;
  else calmTime = 0;

  // progress scia (A)
  const targetProgress = clamp01(calmTime / CALM_ENTRY_SECONDS);
  displayedProgress += (targetProgress - displayedProgress) * Math.min(1, dt * 8);

  const scale = 0.08 + displayedProgress * 0.92;
  trailEl.style.transform = `scale(${scale.toFixed(3)})`;

  if (agitation > AGITATED_THRESHOLD) {
    hintCooldown = 1.2;
    trailEl.classList.add("fade");
  } else {
    trailEl.classList.remove("fade");
  }
  hintCooldown = Math.max(0, hintCooldown - dt);
  progressHintEl.textContent = hintCooldown > 0 ? "Riprova." : "";

  // A -> B
  if (!entered) {
    if (calmTime >= CALM_ENTRY_SECONDS) {
      entered = true;
      veil.classList.add("hidden");

      phraseIndex = 0;
      setPhrase(PHRASES[phraseIndex]);
      phraseTimer = 0;

      othersTimer = 0;
      othersNext = sampleOtherInterval();
    } else {
      hidePhrase();
    }
  } else {
    // “altri” SEMPRE in B (indipendente dai movimenti)
    othersTimer += dt;
    if (othersTimer >= othersNext) {
      othersTimer = 0;
      othersNext = sampleOtherInterval();
      addOtherLiveStar();
    }

    // B: tue stelle solo se calmo
    if (agitation > AGITATED_THRESHOLD) {
      hidePhrase();
      phraseTimer = 0;
    } else if (agitation < CALM_THRESHOLD) {
      ensurePhraseShown();

      phraseTimer += dt;
      if (phraseTimer >= PHRASE_INTERVAL_SECONDS) {
        phraseTimer = 0;

        if (phraseIndex < PHRASES.length - 1) phraseIndex += 1;
        setPhrase(PHRASES[phraseIndex]);

        const ok = addUserStarGold();
        if (!ok && !capNotified) {
          capNotified = true;
          flashSubnote("Per oggi basta così.", 2600);
        }
      }
    } else {
      // zona neutra: la frase deve esserci
      ensurePhraseShown();
    }
  }

  drawSky();
  requestAnimationFrame(loop);
}

// init
function init(){
  cleanupOldDays();
  resizeCanvas();
  loadOrSeedStars();
  trimSeedStarsToTarget(SEED_STAR_COUNT);
  requestAnimationFrame(loop);
}
init();