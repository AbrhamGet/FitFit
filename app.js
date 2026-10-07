/* FitFit — personal weight-loss tracker PWA */
(() => {
"use strict";

// ---------- Storage ----------
const KEY = "fitfit_v1";
const DEFAULT_SLOTS = [480, 630, 780, 930, 1110, 1260]; // 8:00 10:30 13:00 15:30 18:30 21:00
const fresh = () => ({
  profile: { name: "", sex: "m", age: 28, heightCm: 175, weightKg: 85, startKg: null, goalKg: 75, pace: 0.5, kmGoal: 5, setupDone: false },
  days: {}, customFoods: [], recent: [],
  badgesSeen: [], lastLevel: 1, freezes: 0, lastFreezeStreak: 0, frozen: {},
  notif: { workerUrl: "", id: "", slots: DEFAULT_SLOTS.slice(), enabled: false },
  usdaKey: "", lastReport: "", lastSyncHash: "",
});
let S;
try { S = Object.assign(fresh(), JSON.parse(localStorage.getItem(KEY) || "{}")); } catch (e) { S = fresh(); }
S.profile = Object.assign(fresh().profile, S.profile);
S.notif = Object.assign(fresh().notif, S.notif);
if (!S.notif.id) S.notif.id = rid();
function save() { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) {} scheduleSync(); }
function rid() { return Array.from(crypto.getRandomValues(new Uint8Array(12)), b => b.toString(16).padStart(2, "0")).join(""); }

// ---------- Dates ----------
const pad = n => String(n).padStart(2, "0");
const ymd = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parse = s => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
const addDays = (s, n) => { const d = parse(s); d.setDate(d.getDate() + n); return ymd(d); };
const today = () => ymd();
const dow = s => (parse(s).getDay() + 6) % 7; // Mon=0..Sun=6
const weekStart = s => addDays(s, -dow(s));
const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const fmtTime = m => { const h = Math.floor(m / 60), mm = m % 60; const ap = h >= 12 ? "pm" : "am"; return `${((h + 11) % 12) + 1}:${pad(mm)}${ap}`; };

// ---------- Profile math ----------
function target() {
  const p = S.profile;
  const bmr = 10 * p.weightKg + 6.25 * p.heightCm - 5 * p.age + (p.sex === "f" ? -161 : 5);
  const tdee = bmr * 1.3;
  const deficit = (p.pace * 7700) / 7;
  const floor = p.sex === "f" ? 1200 : 1500;
  return Math.round(Math.max(floor, tdee - deficit) / 10) * 10;
}
const kcalPerKm = () => Math.round(0.6 * S.profile.weightKg);

// ---------- Day data ----------
function day(d = today(), create = true) {
  if (!S.days[d] && create) S.days[d] = { foods: [], habits: [0, 0, 0, 0, 0, 0], km: 0, steps: 0, kmSrc: "", weight: null };
  return S.days[d] || { foods: [], habits: [0, 0, 0, 0, 0, 0], km: 0, steps: 0, weight: null };
}
const eaten = d => day(d, false).foods.reduce((a, f) => a + Math.round(f.k * f.q), 0);
const habitsDone = d => day(d, false).habits.filter(Boolean).length;
const isComplete = d => (day(d, false).foods.length >= 1 && habitsDone(d) >= 3) || !!S.frozen[d];

const HABITS = [
  { t: "Water + log breakfast", s: "Big glass of water, then log what you ate", e: "💧" },
  { t: "Sugar check", s: "Macchiato, shai, buna — no sugar (or half)", e: "🚫🍬" },
  { t: "Smaller injera at lunch", s: "Cut a third, more wat & salad, protein first", e: "🫓" },
  { t: "Move for 10–15 min", s: "Post-lunch walk or take a call on foot", e: "🚶" },
  { t: "Evening walk", s: "Chip away at today's km goal", e: "🌆" },
  { t: "Kitchen closed + log the day", s: "Nothing after this. Log everything you ate", e: "🔒" },
];

// ---------- Streak / XP / levels / badges ----------
function streak() {
  let d = today(), n = 0;
  if (!isComplete(d)) d = addDays(d, -1);
  while (isComplete(d) && n < 3650) { n++; d = addDays(d, -1); }
  return n;
}
function checkFreeze() {
  const y = addDays(today(), -1), y2 = addDays(today(), -2);
  if (!isComplete(y) && S.freezes > 0 && isComplete(y2) && S.days[y2]) {
    S.frozen[y] = true; S.freezes--; save();
    setTimeout(() => toast("🧊 Streak freeze used. Your streak survived yesterday!"), 600);
  }
  const s = streak();
  if (s > 0 && s % 7 === 0 && s > S.lastFreezeStreak) {
    S.lastFreezeStreak = s; S.freezes = Math.min(2, S.freezes + 1); save();
    setTimeout(() => toast(`🧊 ${s}-day streak! You earned a streak freeze`), 1200);
  }
}
function dayXP(d) {
  const x = day(d, false), t = target();
  let xp = Math.min(x.foods.length, 10) * 5 + habitsDone(d) * 10;
  if (x.km >= S.profile.kmGoal) xp += 25;
  if (d < today() && x.foods.length >= 2 && eaten(d) <= t) xp += 30;
  return xp;
}
function totalXP() {
  let xp = 0;
  for (const d in S.days) xp += dayXP(d);
  return xp + earnedBadges().length * 50;
}
const LEVEL_NAMES = ["Injera Rookie", "Shiro Soldier", "Misir Minister", "Tibs Tactician", "Gomen General", "Kitfo Commander", "Beyaynetu Boss", "Suf Fitfit Sensei", "Doro Wat Don", "FitFit Legend"];
const lvlNeed = n => 50 * n * (n - 1); // XP needed to reach level n
function level(xp) {
  let n = 1; while (xp >= lvlNeed(n + 1)) n++;
  return { n, name: LEVEL_NAMES[Math.min(n - 1, LEVEL_NAMES.length - 1)], cur: xp - lvlNeed(n), span: lvlNeed(n + 1) - lvlNeed(n) };
}
const BADGES = [
  { id: "first_log", e: "🍽️", n: "First Bite", d: "Log your first food" },
  { id: "streak3", e: "🔥", n: "Warming Up", d: "3-day streak" },
  { id: "streak7", e: "🌶️", n: "Berbere Hot", d: "7-day streak" },
  { id: "streak30", e: "🏆", n: "Unstoppable", d: "30-day streak" },
  { id: "perfect", e: "⭐", n: "Perfect Day", d: "All 6 habits in a day" },
  { id: "injera7", e: "🫓", n: "Injera Tamer", d: "Smaller injera 7 times" },
  { id: "sugar7", e: "🧂", n: "Sugar Slayer", d: "Sugar check 7 times" },
  { id: "under7", e: "💰", n: "Budget Boss", d: "7 days under target" },
  { id: "km10w", e: "👟", n: "10K Week", d: "10 km in one week" },
  { id: "km100", e: "🗺️", n: "Century Walker", d: "100 km total" },
  { id: "weigh", e: "⚖️", n: "Brave Scale", d: "First weigh-in" },
  { id: "lost1", e: "📉", n: "First Kilo Down", d: "1 kg below start" },
  { id: "lost5", e: "🎉", n: "Five Down", d: "5 kg below start" },
  { id: "report", e: "📊", n: "Report Card", d: "Open a Sunday report" },
  { id: "night", e: "🌙", n: "Night Owl Tamed", d: "Kitchen closed 7 times" },
];
function earnedBadges() {
  const ds = Object.keys(S.days).sort();
  const got = new Set();
  let injera = 0, sugar = 0, under = 0, night = 0, km = 0;
  for (const d of ds) {
    const x = S.days[d];
    if (x.foods.length) got.add("first_log");
    if (x.habits.every(Boolean)) got.add("perfect");
    if (x.habits[2]) injera++;
    if (x.habits[1]) sugar++;
    if (x.habits[5]) night++;
    if (d < today() && x.foods.length >= 2 && eaten(d) <= target()) under++;
    km += x.km || 0;
    if (x.weight) got.add("weigh");
  }
  if (injera >= 7) got.add("injera7");
  if (sugar >= 7) got.add("sugar7");
  if (night >= 7) got.add("night");
  if (under >= 7) got.add("under7");
  if (km >= 100) got.add("km100");
  // week km
  const weeks = {};
  for (const d of ds) { const w = weekStart(d); weeks[w] = (weeks[w] || 0) + (S.days[d].km || 0); }
  if (Object.values(weeks).some(v => v >= 10)) got.add("km10w");
  // best streak seen (cheap scan)
  let run = 0, best = 0;
  if (ds.length) { for (let d = ds[0]; d <= today(); d = addDays(d, 1)) { run = isComplete(d) ? run + 1 : 0; best = Math.max(best, run); } }
  if (best >= 3) got.add("streak3");
  if (best >= 7) got.add("streak7");
  if (best >= 30) got.add("streak30");
  const start = S.profile.startKg, w = latestWeight();
  if (start && w && start - w >= 1) got.add("lost1");
  if (start && w && start - w >= 5) got.add("lost5");
  if (S.lastReport) got.add("report");
  return BADGES.filter(b => got.has(b.id)).map(b => b.id);
}
function latestWeight() {
  const ds = Object.keys(S.days).filter(d => S.days[d].weight).sort();
  return ds.length ? S.days[ds[ds.length - 1]].weight : null;
}
function celebrateNew() {
  const got = earnedBadges();
  const fresh = got.filter(id => !S.badgesSeen.includes(id));
  if (fresh.length) {
    S.badgesSeen = got; save();
    const b = BADGES.find(x => x.id === fresh[0]);
    setTimeout(() => { confetti(); ding(3); toast(`${b.e} Badge unlocked: ${b.n}! +50 XP`); }, 300);
  }
  const lv = level(totalXP());
  if (lv.n > S.lastLevel) {
    S.lastLevel = lv.n; save();
    setTimeout(() => {
      confetti(); ding(4);
      openSheet(`<div class="center">${mascot("hype", 130)}<h1>Level ${lv.n}!</h1><p class="bigstat" style="font-size:22px">${lv.name}</p><p class="muted">Gobez! Keep stacking those days.</p><div class="spacer"></div><button class="btn" data-act="close">Let's gooo</button></div>`);
    }, 900);
  }
}

// ---------- Mascot (Jebi the jebena) ----------
function mascot(mood = "happy", size = 84) {
  const eyes = {
    happy: `<circle cx="42" cy="62" r="5" fill="#1E2440"/><circle cx="62" cy="62" r="5" fill="#1E2440"/><circle cx="44" cy="60" r="1.6" fill="#fff"/><circle cx="64" cy="60" r="1.6" fill="#fff"/>`,
    hype: `<path d="M36 63 q6 -8 12 0" stroke="#1E2440" stroke-width="4" fill="none" stroke-linecap="round"/><path d="M56 63 q6 -8 12 0" stroke="#1E2440" stroke-width="4" fill="none" stroke-linecap="round"/>`,
    judgy: `<circle cx="42" cy="63" r="4.5" fill="#1E2440"/><circle cx="62" cy="63" r="4.5" fill="#1E2440"/><path d="M35 54 l14 3" stroke="#1E2440" stroke-width="4" stroke-linecap="round"/><path d="M69 54 l-14 3" stroke="#1E2440" stroke-width="4" stroke-linecap="round"/>`,
    sleepy: `<path d="M36 63 h12" stroke="#1E2440" stroke-width="4" stroke-linecap="round"/><path d="M56 63 h12" stroke="#1E2440" stroke-width="4" stroke-linecap="round"/>`,
  }[mood] || "";
  const mouth = {
    happy: `<path d="M44 74 q8 8 16 0" stroke="#1E2440" stroke-width="4" fill="none" stroke-linecap="round"/>`,
    hype: `<path d="M42 72 q10 14 20 0 z" fill="#1E2440"/><path d="M47 77 q5 4 10 0" fill="#FF5A5F"/>`,
    judgy: `<path d="M45 77 h14" stroke="#1E2440" stroke-width="4" stroke-linecap="round"/>`,
    sleepy: `<ellipse cx="52" cy="77" rx="4" ry="5" fill="#1E2440"/>`,
  }[mood] || "";
  return `<svg class="mascot" style="width:${size}px;height:${size * 1.14}px" viewBox="0 0 104 118" aria-label="Jebi">
    <path d="M22 66 q-16 -4 -14 -22" stroke="#7A4527" stroke-width="7" fill="none" stroke-linecap="round"/>
    <path d="M78 62 q18 2 18 22 q0 10 -10 14" stroke="#5E3219" stroke-width="7" fill="none" stroke-linecap="round"/>
    <rect x="43" y="10" width="18" height="34" rx="8" fill="#7A4527"/>
    <ellipse cx="52" cy="11" rx="12" ry="5" fill="#5E3219"/>
    <path d="M44 4 q8 -6 16 0" stroke="#FFC233" stroke-width="3" fill="none" stroke-linecap="round"/>
    <ellipse cx="52" cy="76" rx="38" ry="36" fill="#8C5230"/>
    <path d="M18 70 q34 14 68 0" stroke="#FFC233" stroke-width="4" fill="none"/>
    <path d="M18 78 q34 14 68 0" stroke="#22B573" stroke-width="4" fill="none"/>
    <ellipse cx="30" cy="74" rx="6" ry="4" fill="#FF8A8A" opacity=".55"/>
    <ellipse cx="74" cy="74" rx="6" ry="4" fill="#FF8A8A" opacity=".55"/>
    <g transform="translate(0,-4)">${eyes}${mouth}</g>
  </svg>`;
}
function jebiLine() {
  const h = new Date().getHours(), t = target(), e = eaten(today()), d = day(), hd = habitsDone(today());
  const st = streak(), left = t - e, kmLeft = Math.max(0, S.profile.kmGoal - d.km);
  const n = S.profile.name || "boss";
  if (S.profile.setupDone && h < 11 && !d.foods.length) return [`Selam ${n}! ☀️ Water first, then tell me what breakfast was.`, "happy"];
  if (e > t) return [`${e - t} kcal over. Not the end of the world… but I saw that. 👀`, "judgy"];
  if (h >= 21 && !d.foods.length) return [`Zero logs today? Either you ate air or you're hiding something.`, "judgy"];
  if (h >= 21) return [`Kitchen's closed, ${n}. Whatever's in the fridge can wait till tomorrow. 🔒`, "sleepy"];
  if (hd === 6) return [`ALL SIX HABITS?! Betam gobez. I'm emotional. 🥹`, "hype"];
  if (kmLeft > 0 && h >= 17) return [`${kmLeft.toFixed(1)} km left today. A quick lap around the block and we're there. 🚶`, "happy"];
  if (st >= 3) return [`${st}-day streak 🔥 Don't you dare break it now.`, "hype"];
  if (left > 0 && d.foods.length) return [`${left} kcal left in the tank today. Spend wisely.`, "happy"];
  return [`Let's make today count. Log, walk, and keep that injera small. 💪`, "happy"];
}

// ---------- UI helpers ----------
const $ = s => document.querySelector(s);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
let toastT;
function toast(msg) {
  const t = $("#toast"); t.textContent = msg; t.hidden = false;
  t.style.animation = "none"; void t.offsetWidth; t.style.animation = "";
  clearTimeout(toastT); toastT = setTimeout(() => (t.hidden = true), 2800);
}
function openSheet(html) { $("#sheet").innerHTML = `<div class="grab"></div>` + html; $("#sheet").hidden = false; $("#sheet-bg").hidden = false; }
function closeSheet() { $("#sheet").hidden = true; $("#sheet-bg").hidden = true; }
let actx;
function ding(n = 1) {
  try {
    actx = actx || new (window.AudioContext || window.webkitAudioContext)();
    const notes = [880, 1108.7, 1318.5, 1760];
    for (let i = 0; i < n; i++) {
      const o = actx.createOscillator(), g = actx.createGain(), t0 = actx.currentTime + i * 0.09;
      o.type = "sine"; o.frequency.value = notes[i % notes.length];
      g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(0.25, t0 + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.35);
      o.connect(g).connect(actx.destination); o.start(t0); o.stop(t0 + 0.4);
    }
  } catch (e) {}
}
function confetti() {
  const c = $("#confetti"); if (!c.getContext) return;
  const x = c.getContext("2d"); c.width = innerWidth; c.height = innerHeight;
  const cols = ["#22B573", "#FFC233", "#FF5A5F", "#3D7BFF", "#FF9F1C"];
  const ps = Array.from({ length: 90 }, () => ({ x: innerWidth / 2, y: innerHeight / 3, vx: (Math.random() - .5) * 14, vy: Math.random() * -12 - 4, r: Math.random() * 6 + 4, c: cols[Math.floor(Math.random() * 5)], a: Math.random() * 6 }));
  let f = 0;
  (function loop() {
    x.clearRect(0, 0, c.width, c.height);
    ps.forEach(p => { p.x += p.vx; p.y += p.vy; p.vy += 0.45; p.a += 0.2; x.save(); x.translate(p.x, p.y); x.rotate(p.a); x.fillStyle = p.c; x.fillRect(-p.r / 2, -p.r / 2, p.r, p.r * 0.6); x.restore(); });
    if (++f < 110) requestAnimationFrame(loop); else x.clearRect(0, 0, c.width, c.height);
  })();
}

// ---------- Rendering ----------
let tab = "today", foodCat = "All", foodQuery = "", flashHabit = -1;
function render() {
  document.querySelectorAll(".tab").forEach(b => b.classList.toggle("on", b.dataset.tab === tab));
  $("#tabs").style.display = S.profile.setupDone ? "" : "none";
  const v = $("#view");
  if (!S.profile.setupDone) { v.innerHTML = setupView(); return; }
  v.innerHTML = { today: todayView, food: foodView, walk: walkView, progress: progressView, me: meView }[tab]();
  if (tab === "food") { const i = $("#q"); if (i && foodQuery) { i.focus(); i.setSelectionRange(foodQuery.length, foodQuery.length); } }
}

function setupView() {
  const p = S.profile;
  return `
  <div class="center">${mascot("hype", 110)}</div>
  <h1 class="center">Selam! I'm Jebi 👋</h1>
  <p class="center muted mb">Your pocket coach. Let's set your daily calorie target.</p>
  <div class="card">
    <label class="field">Your name<input type="text" id="s-name" value="${esc(p.name)}" placeholder="Abrham"></label>
    <label class="field">Sex (for the calorie formula)</label>
    <div class="seg mb" data-seg="sex"><button data-v="m" class="${p.sex === "m" ? "on" : ""}">Male</button><button data-v="f" class="${p.sex === "f" ? "on" : ""}">Female</button></div>
    <div class="row"><label class="field grow">Age<input type="number" id="s-age" inputmode="numeric" value="${p.age}"></label>
    <label class="field grow">Height (cm)<input type="number" id="s-h" inputmode="numeric" value="${p.heightCm}"></label></div>
    <div class="row"><label class="field grow">Weight now (kg)<input type="number" id="s-w" inputmode="decimal" step="0.1" value="${p.weightKg}"></label>
    <label class="field grow">Goal weight (kg)<input type="number" id="s-g" inputmode="decimal" step="0.1" value="${p.goalKg}"></label></div>
    <label class="field">How fast?</label>
    <div class="seg mb" data-seg="pace">${[[0.25, "Chill<br><small>0.25 kg/wk</small>"], [0.5, "Steady<br><small>0.5 kg/wk</small>"], [0.75, "Push<br><small>0.75 kg/wk</small>"]].map(([v, l]) => `<button data-v="${v}" class="${p.pace == v ? "on" : ""}">${l}</button>`).join("")}</div>
    <label class="field">Daily walking goal (km)<input type="number" id="s-km" inputmode="decimal" step="0.5" value="${p.kmGoal}"></label>
  </div>
  <button class="btn" data-act="finish-setup">Let's go</button>`;
}
function readSetup() {
  const p = S.profile, num = (id, d) => { const v = parseFloat($(id).value); return isFinite(v) && v > 0 ? v : d; };
  p.name = $("#s-name").value.trim(); p.age = num("#s-age", p.age); p.heightCm = num("#s-h", p.heightCm);
  p.weightKg = num("#s-w", p.weightKg); p.goalKg = num("#s-g", p.goalKg); p.kmGoal = num("#s-km", p.kmGoal);
}

function ring(eatenK, t) {
  const r = 54, C = 2 * Math.PI * r, pct = Math.min(1, eatenK / t), over = eatenK > t;
  return `<svg class="ring" viewBox="0 0 132 132"><circle cx="66" cy="66" r="${r}" stroke="#F1E8D6" stroke-width="14" fill="none"/>
  <circle cx="66" cy="66" r="${r}" stroke="${over ? "#FF5A5F" : "#22B573"}" stroke-width="14" fill="none" stroke-linecap="round" stroke-dasharray="${C}" stroke-dashoffset="${C * (1 - pct)}" transform="rotate(-90 66 66)"/>
  <text x="66" y="62" text-anchor="middle" font-size="24" font-weight="900" fill="#1E2440">${Math.abs(t - eatenK)}</text>
  <text x="66" y="82" text-anchor="middle" font-size="12" font-weight="700" fill="#7A7F99">${over ? "kcal over" : "kcal left"}</text></svg>`;
}
function todayView() {
  const d = day(), t = target(), e = eaten(today()), st = streak(), xp = totalXP(), lv = level(xp);
  const [line, mood] = jebiLine();
  const kmPct = Math.min(100, (d.km / S.profile.kmGoal) * 100);
  return `
  <div class="top">
    <span class="pill fire">🔥 ${st}</span>
    ${S.freezes ? `<span class="pill ice">🧊 ${S.freezes}</span>` : ""}
    <div class="grow"><div class="row between small" style="font-weight:800;margin-bottom:4px"><span>Lv ${lv.n} · ${lv.name}</span><span class="muted">${lv.cur}/${lv.span}</span></div><div class="xpbar"><div style="width:${(lv.cur / lv.span) * 100}%"></div></div></div>
  </div>
  <div class="mascot-wrap"><div id="jebi">${mascot(mood)}</div><div class="bubble grow">${esc(line)}</div></div>

  <div class="card"><div class="ringbox">${ring(e, t)}
    <div class="grow"><div class="muted small" style="font-weight:700">Eaten</div><div class="bigstat">${e}</div>
    <div class="muted small" style="font-weight:700">of ${t} kcal target</div><div class="spacer"></div>
    <button class="btn sm" data-act="go-food">+ Log food</button></div></div></div>

  <div class="card"><div class="row between"><h2>🚶 Walking</h2><span class="kcal">${d.km.toFixed(2)} / ${S.profile.kmGoal} km</span></div>
    <div class="bar"><div style="width:${kmPct}%;${kmPct >= 100 ? "background:var(--green)" : ""}"></div></div>
    <p class="small muted mt">${d.kmSrc === "health" ? "🍏 Synced from Apple Health" : "Tap Walk to add km"} · ≈ ${Math.round(d.km * kcalPerKm())} kcal burned</p></div>

  <div class="card"><div class="row between"><h2>✅ Today's habits</h2><span class="muted small" style="font-weight:800">${habitsDone(today())}/6</span></div>
  ${HABITS.map((h, i) => `<div class="habit ${d.habits[i] ? "done" : ""} ${flashHabit === i ? "flash" : ""}" data-act="habit" data-i="${i}">
    <div class="check">${d.habits[i] ? "✓" : ""}</div><div class="grow"><div class="t">${h.e} ${h.t}</div><div class="s">${fmtTime(S.notif.slots[i])} · ${h.s}</div></div></div>`).join("")}
  <p class="small muted">Log 1 food + check 3 habits to keep your streak alive.</p></div>

  <div class="card"><h2>🍽️ Logged today</h2>
  ${d.foods.length ? d.foods.slice().reverse().map(f => `<div class="item"><div class="emoji">${f.e || "🍴"}</div><div class="grow"><div class="name">${esc(f.n)}${f.q !== 1 ? ` ×${f.q}` : ""}</div><div class="sub">${new Date(f.ts).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</div></div><div class="kcal">${Math.round(f.k * f.q)}</div><button class="x" data-act="del-food" data-id="${f.id}">✕</button></div>`).join("") : `<p class="muted">Nothing yet. Jebi is watching. 👀</p>`}
  </div>
  ${dow(today()) === 6 ? `<button class="btn yellow" data-act="report">📊 Open this week's report</button>` : ""}`;
}

function allFoods() { return S.customFoods.map(f => Object.assign({ c: "My foods" }, f)).concat(window.FOODS); }
function foodView() {
  const q = foodQuery.trim().toLowerCase();
  let list = allFoods();
  if (foodCat === "Recent") list = S.recent.map(n => list.find(f => f.n === n)).filter(Boolean);
  else if (foodCat !== "All") list = list.filter(f => f.c === foodCat);
  if (q) list = list.filter(f => f.n.toLowerCase().includes(q)).sort((a, b) => (b.n.toLowerCase().startsWith(q) - a.n.toLowerCase().startsWith(q)));
  const cats = ["All", "Recent", ...(S.customFoods.length ? ["My foods"] : []), ...window.FOOD_CATS];
  return `<h1>Log food</h1>
  <input type="search" id="q" placeholder="Search beyaynetu, burger, macchiato…" value="${esc(foodQuery)}" autocomplete="off">
  <div class="spacer"></div>
  <div class="chips">${cats.map(c => `<button class="chip ${c === foodCat ? "on" : ""}" data-act="cat" data-c="${c}">${c}</button>`).join("")}</div>
  ${q ? `<button class="btn blue mb" data-act="online">🌐 Search the internet for “${esc(foodQuery.trim())}”</button>` : ""}
  <div class="card">${list.length ? list.slice(0, 150).map(f => `<div class="item" data-act="pick" data-n="${esc(f.n)}"><div class="emoji">${f.e || "🍴"}</div><div class="grow"><div class="name">${esc(f.n)}</div><div class="sub">${esc(f.u || "")}</div></div><div class="kcal">${f.k}</div></div>`).join("") : `<p class="muted">Not in the list. Try the internet search above or add it yourself.</p>`}</div>
  <button class="btn ghost" data-act="custom">✍️ Add a custom food</button>`;
}
function pickSheet(f) {
  let q = 1;
  const draw = () => openSheet(`<div class="row"><div class="emoji" style="font-size:40px;width:52px">${f.e || "🍴"}</div><div class="grow"><h2 style="margin:0">${esc(f.n)}</h2><div class="muted small">${esc(f.u || "")} · ${f.k} kcal</div></div></div>
    <div class="spacer"></div><h3>How much?</h3>
    <div class="seg mb" data-seg="qty">${[0.5, 1, 1.5, 2, 3].map(v => `<button data-v="${v}" class="${q == v ? "on" : ""}">${v === 0.5 ? "½" : v === 1.5 ? "1½" : v}×</button>`).join("")}</div>
    <p class="center bigstat" id="pk">${Math.round(f.k * q)} kcal</p>
    <button class="btn" data-act="log">Log it</button>`);
  draw();
  sheetCtx = { type: "pick", f, get q() { return q; }, set q(v) { q = v; $("#pk").textContent = Math.round(f.k * q) + " kcal"; } };
}
let sheetCtx = null;
function logFood(f, q) {
  const d = day();
  d.foods.push({ id: rid(), n: f.n, e: f.e || "🍴", k: Math.round(f.k), q, ts: Date.now() });
  S.recent = [f.n, ...S.recent.filter(n => n !== f.n)].slice(0, 20);
  save(); ding(1);
  const over = eaten(today()) > target();
  toast(over ? `Logged. You're over target now… Jebi saw that 👀` : `+5 XP · ${f.e || "🍴"} ${f.n} logged`);
  celebrateNew();
}

async function onlineSearch(q) {
  openSheet(`<h2>🌐 Searching “${esc(q)}”…</h2><p class="muted">Checking USDA and Open Food Facts</p>`);
  if (!navigator.onLine) { openSheet(`<h2>You're offline 📵</h2><p class="muted">Internet search needs a connection. Add it as a custom food for now.</p><button class="btn ghost" data-act="custom">✍️ Add custom food</button>`); return; }
  const results = [];
  const key = S.usdaKey || "DEMO_KEY";
  const tasks = [
    fetch(`https://api.nal.usda.gov/fdc/v1/foods/search?api_key=${encodeURIComponent(key)}&query=${encodeURIComponent(q)}&pageSize=12&dataType=Survey%20(FNDDS),SR%20Legacy,Foundation`)
      .then(r => r.json()).then(j => (j.foods || []).forEach(f => {
        const en = (f.foodNutrients || []).find(n => n.nutrientId === 1008 || n.nutrientNumber === "208" || (n.nutrientName === "Energy" && n.unitName === "KCAL"));
        if (en && en.value) results.push({ n: titleCase(f.description), k100: Math.round(en.value), src: "USDA", serv: null });
      })).catch(() => {}),
    fetch(`https://world.openfoodfacts.org/cgi/search.pl?search_terms=${encodeURIComponent(q)}&search_simple=1&action=process&json=1&page_size=12&fields=product_name,brands,nutriments,serving_size`)
      .then(r => r.json()).then(j => (j.products || []).forEach(p => {
        const n = p.nutriments || {}, k = n["energy-kcal_100g"];
        if (p.product_name && k) results.push({ n: p.product_name + (p.brands ? ` (${p.brands.split(",")[0]})` : ""), k100: Math.round(k), src: "Open Food Facts", serv: n["energy-kcal_serving"] ? { k: Math.round(n["energy-kcal_serving"]), u: p.serving_size || "1 serving" } : null });
      })).catch(() => {}),
  ];
  await Promise.all(tasks);
  if (!results.length) { openSheet(`<h2>No luck 😕</h2><p class="muted">Couldn't find “${esc(q)}” online. Add it yourself — a rough guess is fine.</p><button class="btn ghost" data-act="custom">✍️ Add custom food</button>`); return; }
  sheetCtx = { type: "online", results };
  openSheet(`<h2>Results for “${esc(q)}”</h2><p class="muted small">Values per 100 g unless a serving is shown. Tap one to set the amount.</p>
    <div class="card">${results.slice(0, 20).map((r, i) => `<div class="item" data-act="online-pick" data-i="${i}"><div class="emoji">🌐</div><div class="grow"><div class="name">${esc(r.n)}</div><div class="sub">${r.src}${r.serv ? ` · ${r.serv.k} kcal per ${esc(r.serv.u)}` : ""}</div></div><div class="kcal">${r.k100}<span class="small muted">/100g</span></div></div>`).join("")}</div>`);
}
const titleCase = s => s.toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
function onlinePickSheet(r) {
  const opts = [100, 150, 250, 350, 500];
  openSheet(`<h2>${esc(r.n)}</h2><p class="muted small">${r.src} · ${r.k100} kcal per 100 g</p>
    ${r.serv ? `<button class="btn yellow mb" data-act="online-log" data-k="${r.serv.k}" data-u="${esc(r.serv.u)}">1 serving (${esc(r.serv.u)}) · ${r.serv.k} kcal</button>` : ""}
    <h3>Or pick grams</h3><div class="seg mb">${opts.map(g => `<button data-act="online-log" data-k="${Math.round(r.k100 * g / 100)}" data-u="${g} g">${g}g</button>`).join("")}</div>
    <label class="field">Custom grams<input type="number" id="og" inputmode="numeric" placeholder="e.g. 220"></label>
    <button class="btn" data-act="online-log-custom">Log custom amount</button>
    <p class="small muted mt">It gets saved to “My foods” so you can log it offline next time.</p>`);
  sheetCtx = { type: "onlinePick", r };
}
function customSheet(name = "") {
  openSheet(`<h2>✍️ Add custom food</h2>
    <label class="field">Name<input type="text" id="cf-n" value="${esc(name)}" placeholder="Mom's special firfir"></label>
    <label class="field">Calories per portion<input type="number" id="cf-k" inputmode="numeric" placeholder="450"></label>
    <label class="field">Portion description<input type="text" id="cf-u" placeholder="1 plate"></label>
    <label class="field">Emoji (optional)<input type="text" id="cf-e" placeholder="🍲" maxlength="4"></label>
    <button class="btn" data-act="save-custom">Save & log</button>`);
}

function weekKm(start) { let s = 0; for (let i = 0; i < 7; i++) s += day(addDays(start, i), false).km || 0; return s; }
function walkView() {
  const d = day(), ws = weekStart(today());
  const vals = Array.from({ length: 7 }, (_, i) => day(addDays(ws, i), false).km || 0);
  const max = Math.max(S.profile.kmGoal, ...vals) * 1.15;
  const total = Object.values(S.days).reduce((a, x) => a + (x.km || 0), 0);
  const bars = vals.map((v, i) => { const h = (v / max) * 120, x = 14 + i * 44; return `<rect x="${x}" y="${140 - h}" width="28" height="${Math.max(h, 2)}" rx="8" fill="${v >= S.profile.kmGoal ? "#22B573" : "#3D7BFF"}"/><text x="${x + 14}" y="158" text-anchor="middle" font-size="11" font-weight="800" fill="#7A7F99">${DAYS[i]}</text>${v ? `<text x="${x + 14}" y="${134 - h}" text-anchor="middle" font-size="10" font-weight="800" fill="#1E2440">${v.toFixed(1)}</text>` : ""}`; }).join("");
  const gy = 140 - (S.profile.kmGoal / max) * 120;
  return `<h1>Walking</h1>
  <div class="card center"><div class="muted small" style="font-weight:800">TODAY</div><div class="bigstat" style="font-size:48px">${d.km.toFixed(2)} km</div>
  <p class="muted">${d.steps ? `${d.steps.toLocaleString()} steps · ` : ""}≈ ${Math.round(d.km * kcalPerKm())} kcal burned · goal ${S.profile.kmGoal} km</p>
  ${d.kmSrc === "health" ? `<p class="small">🍏 Synced from Apple Health</p>` : ""}
  <div class="row mt"><button class="btn ghost sm grow" data-act="km+" data-v="0.5">+0.5</button><button class="btn ghost sm grow" data-act="km+" data-v="1">+1</button><button class="btn ghost sm grow" data-act="km+" data-v="2">+2</button><button class="btn sm grow" data-act="km-set">Set</button></div>
  ${S.notif.workerUrl ? `<button class="btn blue mt" data-act="health-pull">🍏 Pull from Apple Health now</button>` : ""}</div>
  <div class="card"><div class="row between"><h2>This week</h2><span class="kcal">${weekKm(ws).toFixed(1)} km</span></div>
  <svg class="chart" viewBox="0 0 320 166"><line x1="8" x2="312" y1="${gy}" y2="${gy}" stroke="#FFC233" stroke-width="2" stroke-dasharray="5 5"/>${bars}</svg></div>
  <div class="stat-grid"><div class="stat"><div class="v">${total.toFixed(1)}</div><div class="l">km all-time</div></div><div class="stat"><div class="v">${Math.round(total * kcalPerKm()).toLocaleString()}</div><div class="l">kcal walked off</div></div></div>`;
}

function weightChart() {
  const pts = Object.keys(S.days).filter(d => S.days[d].weight).sort().slice(-60).map(d => ({ d, w: S.days[d].weight }));
  if (pts.length < 2) return `<p class="muted">Log at least 2 weigh-ins to see your trend.</p>`;
  const ws = pts.map(p => p.w), lo = Math.min(...ws, S.profile.goalKg) - 0.5, hi = Math.max(...ws) + 0.5;
  const t0 = parse(pts[0].d).getTime(), t1 = parse(pts[pts.length - 1].d).getTime() || t0 + 1;
  const X = d => 16 + ((parse(d).getTime() - t0) / Math.max(1, t1 - t0)) * 288, Y = w => 10 + ((hi - w) / (hi - lo)) * 130;
  const avg = pts.map((p, i) => { const win = pts.filter(q => q.d <= p.d && q.d > addDays(p.d, -7)); return { d: p.d, w: win.reduce((a, q) => a + q.w, 0) / win.length }; });
  return `<svg class="chart" viewBox="0 0 320 160">
    <line x1="10" x2="310" y1="${Y(S.profile.goalKg)}" y2="${Y(S.profile.goalKg)}" stroke="#22B573" stroke-width="2" stroke-dasharray="5 5"/>
    <text x="310" y="${Y(S.profile.goalKg) - 5}" text-anchor="end" font-size="10" font-weight="800" fill="#22B573">goal ${S.profile.goalKg}</text>
    ${pts.map(p => `<circle cx="${X(p.d)}" cy="${Y(p.w)}" r="3.5" fill="#C9BFAE"/>`).join("")}
    <polyline points="${avg.map(p => `${X(p.d)},${Y(p.w)}`).join(" ")}" fill="none" stroke="#3D7BFF" stroke-width="3.5" stroke-linejoin="round" stroke-linecap="round"/>
  </svg><p class="small muted">Grey dots = weigh-ins · blue line = 7-day average (the one that matters)</p>`;
}
function progressView() {
  const earned = earnedBadges(), w = latestWeight(), start = S.profile.startKg;
  return `<h1>Progress</h1>
  <div class="card"><div class="row between"><h2>⚖️ Weight</h2><button class="btn sm" data-act="weigh">+ Weigh in</button></div>
  <div class="stat-grid mb"><div class="stat"><div class="v">${w ? w.toFixed(1) : "–"}</div><div class="l">latest kg</div></div><div class="stat"><div class="v">${start && w ? (w - start > 0 ? "+" : "") + (w - start).toFixed(1) : "–"}</div><div class="l">since start (kg)</div></div></div>
  ${weightChart()}</div>
  <button class="btn yellow mb" data-act="report">📊 ${dow(today()) === 6 ? "This week's report" : "Week so far"}</button>
  <div class="card"><h2>🏅 Badges · ${earned.length}/${BADGES.length}</h2><div class="badges">
  ${BADGES.map(b => `<div class="badge ${earned.includes(b.id) ? "" : "locked"}"><div class="b">${b.e}</div><div class="bn">${b.n}</div><div class="bd">${b.d}</div></div>`).join("")}</div></div>`;
}

function meView() {
  const p = S.profile, n = S.notif;
  const notifOk = "Notification" in window && "serviceWorker" in navigator && "PushManager" in window;
  const standalone = matchMedia("(display-mode: standalone)").matches || navigator.standalone;
  const hurl = n.workerUrl ? `${n.workerUrl.replace(/\/$/, "")}/health?id=${n.id}&km=` : "";
  return `<h1>Me</h1>
  <div class="card"><h2>👤 Profile</h2>
  <p>${esc(p.name || "You")} · ${p.age}y · ${p.heightCm} cm · goal ${p.goalKg} kg · ${p.pace} kg/wk</p>
  <p class="muted small">Daily target: <b>${target()} kcal</b> · walking goal ${p.kmGoal} km</p>
  <button class="btn ghost sm" data-act="edit-profile">Edit profile</button></div>

  <div class="card"><h2>🔔 Notifications</h2>
  ${!standalone ? `<p class="small">⚠️ Install FitFit to your Home Screen first (Safari → Share → Add to Home Screen). iPhone only allows notifications for installed apps.</p>` : ""}
  ${!notifOk ? `<p class="small">This browser doesn't support push notifications.</p>` : ""}
  <label class="field">Notification server URL<input type="url" id="n-url" value="${esc(n.workerUrl)}" placeholder="https://fitfit.yourname.workers.dev"></label>
  <h3>Your 6 check-in times</h3>
  ${HABITS.map((h, i) => `<div class="row mb"><span class="grow small" style="font-weight:800">${h.e} ${h.t}</span><input type="time" step="900" data-slot="${i}" value="${pad(Math.floor(n.slots[i] / 60))}:${pad(n.slots[i] % 60)}" style="width:120px"></div>`).join("")}
  <p class="small muted">Times snap to 15-minute steps. Sunday report pings at 7:45pm.</p>
  <button class="btn ${n.enabled ? "ghost" : ""} mb" data-act="notif-enable">${n.enabled ? "Save times / re-subscribe" : "Turn on notifications"}</button>
  ${n.enabled ? `<button class="btn blue sm" data-act="notif-test">Send a test</button> <button class="btn ghost sm" data-act="notif-off">Turn off</button>` : ""}
  </div>

  <div class="card"><h2>🍏 Apple Health sync</h2>
  ${n.workerUrl ? `<p class="small">Your Shortcut sends today's distance to this link (add the km number at the end):</p><code class="id">${esc(hurl)}</code><button class="btn ghost sm mt" data-act="copy-health">Copy link</button>` : `<p class="small muted">Add your notification server URL above first — the Health Shortcut uses it too.</p>`}
  </div>

  <div class="card"><h2>🌐 Food search</h2>
  <label class="field">USDA API key (optional)<input type="text" id="usda" value="${esc(S.usdaKey)}" placeholder="Leave empty to use the shared demo key"></label>
  <p class="small muted">The demo key works but is rate-limited. A free personal key from api.data.gov removes the limit.</p></div>

  <div class="card"><h2>💾 Backup</h2>
  <p class="small muted">Your data lives on this phone only. Export a backup now and then.</p>
  <div class="row"><button class="btn ghost sm grow" data-act="export">Export</button><button class="btn ghost sm grow" data-act="import">Import</button></div>
  <input type="file" id="imp" accept="application/json" hidden></div>
  <button class="btn red sm" data-act="reset">Reset everything</button>
  <p class="small muted center mt">FitFit v1 · calorie numbers are estimates</p>`;
}

// ---------- Sunday report ----------
function weekStats(start) {
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i)).filter(d => d <= today());
  const logged = days.filter(d => day(d, false).foods.length);
  const t = target();
  const avgK = logged.length ? Math.round(logged.reduce((a, d) => a + eaten(d), 0) / logged.length) : 0;
  const under = logged.filter(d => eaten(d) <= t).length;
  const km = days.reduce((a, d) => a + (day(d, false).km || 0), 0);
  const habits = days.reduce((a, d) => a + habitsDone(d), 0), habitsPct = days.length ? Math.round((habits / (days.length * 6)) * 100) : 0;
  const perfect = days.filter(d => habitsDone(d) === 6).length;
  const wAvg = s => { const w = Array.from({ length: 7 }, (_, i) => day(addDays(s, i), false).weight).filter(Boolean); return w.length ? w.reduce((a, b) => a + b, 0) / w.length : null; };
  const wNow = wAvg(start), wPrev = wAvg(addDays(start, -7));
  const xp = days.reduce((a, d) => a + dayXP(d), 0);
  let best = null; days.forEach(d => { if (!best || (day(d, false).km || 0) > (day(best, false).km || 0)) best = d; });
  const score = (logged.length / 7) * 30 + (under / 7) * 25 + Math.min(1, km / (S.profile.kmGoal * 7)) * 25 + (habitsPct / 100) * 20;
  return { days: days.length, logged: logged.length, avgK, under, km, habitsPct, perfect, wNow, wPrev, xp, best, score, t };
}
function reportSheet() {
  const ws = weekStart(today()), r = weekStats(ws);
  const grade = r.score >= 85 ? "A" : r.score >= 70 ? "B" : r.score >= 55 ? "C" : r.score >= 40 ? "D" : "F";
  const verdict = { A: ["Betam gobez! This is what winning looks like. 🏆", "hype"], B: ["Solid week. A couple more walks and that's an A. 💪", "happy"], C: ["Middle of the road. Next week we go full beyaynetu energy. 🍛", "happy"], D: ["Rough week. It happens. Clean slate starts Monday. 🫡", "judgy"], F: ["We don't talk about this week. Monday. You and me. 😤", "judgy"] }[grade];
  const dw = r.wNow && r.wPrev ? r.wNow - r.wPrev : null;
  if (!S.lastReport || S.lastReport < ws) { S.lastReport = today(); save(); celebrateNew(); }
  openSheet(`<div class="center">${mascot(verdict[1], 96)}<div class="muted small" style="font-weight:800">WEEK OF ${parse(ws).toLocaleDateString([], { month: "short", day: "numeric" }).toUpperCase()}</div>
    <div class="grade" style="color:${grade <= "B" ? "#22B573" : grade === "C" ? "#D99B0B" : "#FF5A5F"}">${grade}</div><p style="font-weight:800">${verdict[0]}</p></div>
    <div class="stat-grid mt">
      <div class="stat"><div class="v">${r.avgK || "–"}</div><div class="l">avg kcal/day (target ${r.t})</div></div>
      <div class="stat"><div class="v">${r.under}/${r.logged}</div><div class="l">logged days under target</div></div>
      <div class="stat"><div class="v">${r.km.toFixed(1)} km</div><div class="l">walked${r.best && day(r.best, false).km ? ` · best ${DAYS[dow(r.best)]}` : ""}</div></div>
      <div class="stat"><div class="v">${r.habitsPct}%</div><div class="l">habits done · ${r.perfect} perfect days</div></div>
      <div class="stat"><div class="v">${dw === null ? "–" : (dw > 0 ? "+" : "") + dw.toFixed(1)}</div><div class="l">kg vs last week (avg)</div></div>
      <div class="stat"><div class="v">+${r.xp}</div><div class="l">XP earned · 🔥 ${streak()} streak</div></div>
    </div><div class="spacer"></div><button class="btn" data-act="close">Got it</button>`);
}

// ---------- Sheets for profile/weight/km ----------
function editProfileSheet() {
  const p = S.profile;
  openSheet(`<h2>Edit profile</h2>
  <label class="field">Name<input type="text" id="s-name" value="${esc(p.name)}"></label>
  <div class="seg mb" data-seg="sex"><button data-v="m" class="${p.sex === "m" ? "on" : ""}">Male</button><button data-v="f" class="${p.sex === "f" ? "on" : ""}">Female</button></div>
  <div class="row"><label class="field grow">Age<input type="number" id="s-age" value="${p.age}"></label><label class="field grow">Height (cm)<input type="number" id="s-h" value="${p.heightCm}"></label></div>
  <div class="row"><label class="field grow">Weight (kg)<input type="number" step="0.1" id="s-w" value="${p.weightKg}"></label><label class="field grow">Goal (kg)<input type="number" step="0.1" id="s-g" value="${p.goalKg}"></label></div>
  <div class="seg mb" data-seg="pace">${[0.25, 0.5, 0.75].map(v => `<button data-v="${v}" class="${p.pace == v ? "on" : ""}">${v} kg/wk</button>`).join("")}</div>
  <label class="field">Daily walking goal (km)<input type="number" step="0.5" id="s-km" value="${p.kmGoal}"></label>
  <button class="btn" data-act="save-profile">Save</button>`);
}
function weighSheet() {
  openSheet(`<h2>⚖️ Weigh in</h2><p class="muted small">Best done first thing in the morning, after the bathroom, before food.</p>
  <label class="field">Weight (kg)<input type="number" id="wkg" inputmode="decimal" step="0.1" value="${latestWeight() || S.profile.weightKg}"></label>
  <button class="btn" data-act="save-weight">Save</button>`);
}
function kmSheet() {
  openSheet(`<h2>🚶 Set today's distance</h2>
  <label class="field">Kilometers<input type="number" id="kmv" inputmode="decimal" step="0.01" value="${day().km || ""}" placeholder="4.2"></label>
  <button class="btn" data-act="save-km">Save</button>`);
}
function setKm(km, src = "manual", steps) {
  const d = day(), hadGoal = d.km >= S.profile.kmGoal;
  d.km = Math.max(0, Math.round(km * 100) / 100); d.kmSrc = src; if (steps != null) d.steps = steps;
  save();
  if (!hadGoal && d.km >= S.profile.kmGoal) { confetti(); ding(3); toast(`🎯 Walking goal smashed! +25 XP`); }
  celebrateNew();
}

// ---------- Events ----------
document.addEventListener("click", async e => {
  const tb = e.target.closest(".tab");
  if (tb) { tab = tb.dataset.tab; flashHabit = -1; render(); scrollTo(0, 0); return; }
  if (e.target.id === "sheet-bg") { closeSheet(); return; }
  const sb = e.target.closest("[data-seg] button");
  if (sb) {
    const seg = sb.parentElement.dataset.seg, v = sb.dataset.v;
    sb.parentElement.querySelectorAll("button").forEach(b => b.classList.toggle("on", b === sb));
    if (seg === "sex") S.profile.sex = v;
    if (seg === "pace") S.profile.pace = parseFloat(v);
    if (seg === "qty" && sheetCtx) sheetCtx.q = parseFloat(v);
    return;
  }
  const el = e.target.closest("[data-act]"); if (!el) return;
  const a = el.dataset.act;
  switch (a) {
    case "close": closeSheet(); render(); break;
    case "finish-setup": readSetup(); S.profile.startKg = S.profile.weightKg; S.profile.setupDone = true; day().weight = S.profile.weightKg; save(); confetti(); ding(3); render(); toast(`Your daily target: ${target()} kcal 🎯`); break;
    case "go-food": tab = "food"; render(); break;
    case "habit": {
      const i = +el.dataset.i, d = day(); d.habits[i] = d.habits[i] ? 0 : 1; save();
      if (d.habits[i]) { ding(2); if (d.habits.every(Boolean)) { confetti(); toast("⭐ PERFECT DAY! All 6 habits!"); } else toast(`+10 XP · ${HABITS[i].t}`); }
      flashHabit = -1; render(); const j = $("#jebi .mascot"); if (j && d.habits[i]) j.classList.add("bounce"); celebrateNew(); break;
    }
    case "del-food": { const d = day(); d.foods = d.foods.filter(f => f.id !== el.dataset.id); save(); render(); break; }
    case "cat": foodCat = el.dataset.c; render(); break;
    case "pick": { const f = allFoods().find(x => x.n === el.dataset.n); if (f) pickSheet(f); break; }
    case "log": logFood(sheetCtx.f, sheetCtx.q); closeSheet(); render(); break;
    case "online": onlineSearch(foodQuery.trim()); break;
    case "online-pick": onlinePickSheet(sheetCtx.results[+el.dataset.i]); break;
    case "online-log": case "online-log-custom": {
      const r = sheetCtx.r; let k, u;
      if (a === "online-log") { k = +el.dataset.k; u = el.dataset.u; }
      else { const g = parseFloat($("#og").value); if (!(g > 0)) { toast("Enter grams first"); return; } k = Math.round(r.k100 * g / 100); u = `${g} g`; }
      const f = { n: `${r.n} · ${u}`, k, u, e: "🌐" };
      if (!S.customFoods.find(x => x.n === f.n)) S.customFoods.unshift(f);
      logFood(f, 1); closeSheet(); foodQuery = ""; render(); break;
    }
    case "custom": customSheet(foodQuery.trim()); break;
    case "save-custom": {
      const n = $("#cf-n").value.trim(), k = parseFloat($("#cf-k").value);
      if (!n || !(k >= 0)) { toast("Name and calories please"); return; }
      const f = { n, k: Math.round(k), u: $("#cf-u").value.trim() || "1 portion", e: $("#cf-e").value.trim() || "🍴" };
      S.customFoods = [f, ...S.customFoods.filter(x => x.n !== n)]; logFood(f, 1); closeSheet(); foodQuery = ""; render(); break;
    }
    case "km+": setKm(day().km + parseFloat(el.dataset.v)); render(); break;
    case "km-set": kmSheet(); break;
    case "save-km": { const v = parseFloat($("#kmv").value); if (v >= 0) setKm(v); closeSheet(); render(); break; }
    case "health-pull": await pullHealth(true); render(); break;
    case "weigh": weighSheet(); break;
    case "save-weight": {
      const v = parseFloat($("#wkg").value); if (!(v > 20)) { toast("That doesn't look right"); return; }
      day().weight = v; S.profile.weightKg = v; if (!S.profile.startKg) S.profile.startKg = v; save(); closeSheet(); render(); ding(2); toast(`Logged ${v} kg. New target: ${target()} kcal`); celebrateNew(); break;
    }
    case "report": reportSheet(); break;
    case "edit-profile": editProfileSheet(); break;
    case "save-profile": readSetup(); save(); closeSheet(); render(); toast(`Saved. Target: ${target()} kcal`); break;
    case "notif-enable": await enableNotifs(); render(); break;
    case "notif-test": await workerPost("/test", { id: S.notif.id }).then(() => toast("Test sent — check your notifications 🔔")).catch(err => toast("Test failed: " + err.message)); break;
    case "notif-off": await disableNotifs(); render(); break;
    case "copy-health": { const t = `${S.notif.workerUrl.replace(/\/$/, "")}/health?id=${S.notif.id}&km=`; try { await navigator.clipboard.writeText(t); toast("Copied 📋"); } catch (er) { toast("Long-press the link to copy it"); } break; }
    case "export": exportData(); break;
    case "import": $("#imp").click(); break;
    case "reset": if (confirm("Delete ALL FitFit data on this phone? Export a backup first if you want it.")) { localStorage.removeItem(KEY); location.reload(); } break;
  }
});
document.addEventListener("input", e => {
  if (e.target.id === "q") { foodQuery = e.target.value; const pos = e.target.selectionStart; render(); const i = $("#q"); if (i) { i.focus(); i.setSelectionRange(pos, pos); } }
});
document.addEventListener("change", e => {
  if (e.target.dataset.slot != null) {
    const [h, m] = e.target.value.split(":").map(Number); if (isNaN(h)) return;
    const mins = h * 60 + Math.round(m / 15) * 15; S.notif.slots[+e.target.dataset.slot] = mins % 1440; save();
  }
  if (e.target.id === "n-url") { S.notif.workerUrl = e.target.value.trim().replace(/\/$/, ""); save(); render(); }
  if (e.target.id === "usda") { S.usdaKey = e.target.value.trim(); save(); }
  if (e.target.id === "imp" && e.target.files[0]) {
    e.target.files[0].text().then(t => { const d = JSON.parse(t); if (!d.days || !d.profile) throw new Error("bad"); localStorage.setItem(KEY, JSON.stringify(d)); location.reload(); }).catch(() => toast("That file isn't a FitFit backup"));
  }
});
function exportData() {
  const blob = new Blob([JSON.stringify(S, null, 1)], { type: "application/json" });
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `fitfit-backup-${today()}.json`; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

// ---------- Worker: push + status + health ----------
async function workerPost(path, body) {
  if (!S.notif.workerUrl) throw new Error("add your server URL first");
  const r = await fetch(S.notif.workerUrl + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error((await r.text()) || r.status);
  return r.json().catch(() => ({}));
}
const b64ToU8 = b => { const s = atob(b.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(b.length / 4) * 4, "=")); return Uint8Array.from(s, c => c.charCodeAt(0)); };
async function enableNotifs() {
  const url = ($("#n-url") && $("#n-url").value.trim().replace(/\/$/, "")) || S.notif.workerUrl;
  if (!url) { toast("Paste your notification server URL first"); return; }
  S.notif.workerUrl = url;
  try {
    if (!("PushManager" in window)) throw new Error("Install the app to your Home Screen first");
    const perm = await Notification.requestPermission();
    if (perm !== "granted") throw new Error("Notifications were blocked. Allow them in Settings → FitFit");
    const reg = await navigator.serviceWorker.ready;
    const { publicKey } = await (await fetch(url + "/vapid")).json();
    let sub = await reg.pushManager.getSubscription();
    if (sub) { const cur = sub.options && sub.options.applicationServerKey; if (cur && btoa(String.fromCharCode(...new Uint8Array(cur))) !== btoa(String.fromCharCode(...b64ToU8(publicKey)))) { await sub.unsubscribe(); sub = null; } }
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToU8(publicKey) });
    await workerPost("/subscribe", { id: S.notif.id, subscription: sub.toJSON(), slots: S.notif.slots, tz: Intl.DateTimeFormat().resolvedOptions().timeZone, name: S.profile.name, habits: HABITS.map(h => h.t) });
    S.notif.enabled = true; S.lastSyncHash = ""; save(); syncStatus(); confetti(); ding(3); toast("🔔 Notifications on! Jebi will be in touch.");
  } catch (err) { toast(err.message || "Couldn't turn on notifications"); }
}
async function disableNotifs() {
  try { const reg = await navigator.serviceWorker.ready; const sub = await reg.pushManager.getSubscription(); if (sub) await sub.unsubscribe(); await workerPost("/unsubscribe", { id: S.notif.id }); } catch (e) {}
  S.notif.enabled = false; save(); toast("Notifications off");
}
function statusPayload() {
  const d = day(today(), false), ws = weekStart(today()), w = weekStats(ws);
  return { id: S.notif.id, date: today(), cals: eaten(today()), target: target(), foods: d.foods.length, km: d.km || 0, kmGoal: S.profile.kmGoal, habits: d.habits, streak: streak(), lastLog: d.foods.length ? d.foods[d.foods.length - 1].ts : 0, name: S.profile.name, week: { km: +w.km.toFixed(1), avgK: w.avgK, under: w.under, logged: w.logged, habitsPct: w.habitsPct, xp: w.xp, score: Math.round(w.score) } };
}
let syncT;
function scheduleSync() { clearTimeout(syncT); syncT = setTimeout(syncStatus, 4000); }
async function syncStatus() {
  if (!S.notif.enabled || !S.notif.workerUrl || !navigator.onLine) return;
  const p = statusPayload(), h = JSON.stringify(p);
  if (h === S.lastSyncHash) return;
  try { await workerPost("/status", p); S.lastSyncHash = h; localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) {}
}
async function pullHealth(manual) {
  if (!S.notif.workerUrl || !navigator.onLine) { if (manual) toast("Need internet + server URL"); return; }
  try {
    const r = await fetch(`${S.notif.workerUrl}/health?id=${S.notif.id}`); const j = await r.json();
    if (j && j.date === today() && typeof j.km === "number") {
      if (Math.abs(j.km - (day().km || 0)) > 0.005 || day().kmSrc !== "health") { setKm(j.km, "health", j.steps); if (tab === "today" || tab === "walk") render(); if (manual) toast(`🍏 ${j.km.toFixed(2)} km from Apple Health`); }
      else if (manual) toast("Already up to date 👍");
    } else if (manual) toast("Nothing from Health yet today — run your Shortcut");
  } catch (e) { if (manual) toast("Couldn't reach the server"); }
}

// ---------- Boot ----------
function handleParams() {
  const u = new URL(location.href), h = u.searchParams.get("habit"), r = u.searchParams.get("report");
  if (h != null) { tab = "today"; flashHabit = +h; }
  if (r) setTimeout(reportSheet, 400);
  if (h != null || r) history.replaceState(null, "", u.pathname);
}
function maybeAutoReport() {
  const n = new Date();
  if (S.profile.setupDone && dow(today()) === 6 && n.getHours() >= 17 && S.lastReport !== today()) setTimeout(reportSheet, 800);
}
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("sw.js").catch(() => {});
  navigator.serviceWorker.addEventListener("message", e => { if (e.data && e.data.url) { history.replaceState(null, "", e.data.url); handleParams(); render(); } });
}
document.addEventListener("visibilitychange", () => { if (!document.hidden) { checkFreeze(); pullHealth(false); render(); syncStatus(); } });
window.addEventListener("online", () => { pullHealth(false); syncStatus(); });

handleParams();
checkFreeze();
S.badgesSeen = S.badgesSeen.length ? S.badgesSeen : earnedBadges();
render();
pullHealth(false);
syncStatus();
maybeAutoReport();
window.__fitfit = { S, target, streak, totalXP, level, earnedBadges, weekStats, render };
})();
