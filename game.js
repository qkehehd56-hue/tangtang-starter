/* =========================================================================
   탕탕 슈터 — 뱀서라이크 스타터 (game.js)

   의존성 없는 순수 Canvas 2D 게임 루프입니다.
   - 화면 어디든 드래그 = 가상 조이스틱 / PC는 WASD · 방향키
   - 자동 조준 사격, 적 웨이브, 경험치 젬 + 자석 흡수
   - 레벨업 3택 업그레이드, 보스, 사망/클리어 결과 화면

   구조: 상수 → DOM → 입력 → 상태 초기화 → 업데이트 → 렌더 → UI → 루프
   ========================================================================= */
(() => {
  'use strict';

  /* ── 작은 유틸 ─────────────────────────────────────────────────────── */
  const TAU = Math.PI * 2;
  const rand = (a, b) => a + Math.random() * (b - a);
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const dist2 = (ax, ay, bx, by) => {
    const dx = ax - bx;
    const dy = ay - by;
    return dx * dx + dy * dy;
  };
  const fmtTime = (t) => {
    const s = Math.floor(t);
    return String(Math.floor(s / 60)).padStart(2, '0') + ':' +
           String(s % 60).padStart(2, '0');
  };

  /* ── 밸런스 상수 ───────────────────────────────────────────────────── */
  const GOAL_TIME = 180;      // 3분 생존하면 클리어
  const WAVE_SEC = 20;        // 웨이브 = 20초
  const MAX_ENEMIES = 300;    // 동시에 존재하는 적 상한 (모바일 프레임 보호)
  const MAX_PARTS = 420;
  const JOY_MAX = 62;         // 조이스틱 최대 반경(px)
  const JOY_DEAD = 7;         // 데드존

  const TYPES = {
    grunt: { hp: 11, speed: 62,  r: 13, dmg: 7,  xp: 1,  color: '#ff5d73', dark: '#7d1f33' },
    fast:  { hp: 7,  speed: 118, r: 10, dmg: 6,  xp: 1,  color: '#ffd166', dark: '#7a5c11' },
    elite: { hp: 95, speed: 50,  r: 21, dmg: 13, xp: 5,  color: '#b06cff', dark: '#43267a' },
    boss:  { hp: 520, speed: 42, r: 34, dmg: 20, xp: 14, color: '#4de2ff', dark: '#0c5468' },
  };

  /* ── DOM ──────────────────────────────────────────────────────────── */
  const $ = (id) => document.getElementById(id);
  const canvas = $('game');
  const ctx = canvas.getContext('2d', { alpha: false });

  const ui = {
    level: $('levelText'), timer: $('timer'), kills: $('killText'),
    hpFill: $('hpFill'), hpText: $('hpText'), xpFill: $('xpFill'),
    wave: $('waveText'), hint: $('hintText'), pauseBtn: $('pauseBtn'),
    title: $('titleScreen'), levelup: $('levelupScreen'), cards: $('cards'),
    pause: $('pauseScreen'), over: $('gameoverScreen'),
    overKicker: $('overKicker'), overTitle: $('overTitle'),
    overTime: $('overTime'), overKills: $('overKills'),
    overLevel: $('overLevel'), overWave: $('overWave'),
    startBtn: $('startBtn'), retryBtn: $('retryBtn'),
    resumeBtn: $('resumeBtn'), quitBtn: $('quitBtn'),
  };

  /* ── 뷰포트 ───────────────────────────────────────────────────────── */
  let VW = 390;
  let VH = 780;
  let DPR = 1;
  let S = 1;          // 화면 크기에 맞춘 게임 오브젝트 배율
  let aimRange = 320; // 자동 조준 사거리(화면 안에서만 쏘도록 계산)

  function resize() {
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    VW = canvas.clientWidth || window.innerWidth;
    VH = canvas.clientHeight || window.innerHeight;
    canvas.width = Math.max(1, Math.round(VW * DPR));
    canvas.height = Math.max(1, Math.round(VH * DPR));
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);

    // 폰(390px 안팎)을 기준으로, 큰 화면에서는 오브젝트를 함께 키웁니다.
    S = clamp(Math.min(VW, VH) / 430, 0.95, 1.45);
    // 사거리는 "화면에 보이는 범위"에 맞춰 고정: 멀리 있는 적을 화면 밖에서 저격하지 않도록.
    aimRange = clamp(Math.min(VW, VH) * 0.8, 250, 600);
  }

  /* ── 입력 (드래그 조이스틱 + 키보드) ───────────────────────────────── */
  const input = {
    keys: Object.create(null),
    active: false,
    id: null,
    ox: 0, oy: 0,     // 조이스틱 중심(화면 좌표)
    kx: 0, ky: 0,     // 손잡이 위치
    vx: 0, vy: 0,     // -1..1 이동 벡터
    alpha: 0,         // 조이스틱 표시 알파
  };

  function joyStart(e) {
    if (input.active) return;          // 첫 손가락만 조이스틱으로 사용
    input.active = true;
    input.id = e.pointerId;
    input.ox = e.clientX;
    input.oy = e.clientY;
    input.kx = e.clientX;
    input.ky = e.clientY;
    input.vx = 0;
    input.vy = 0;
    try { canvas.setPointerCapture(e.pointerId); } catch (_) { /* noop */ }
  }

  function joyMove(e) {
    if (!input.active || e.pointerId !== input.id) return;
    let dx = e.clientX - input.ox;
    let dy = e.clientY - input.oy;
    const d = Math.hypot(dx, dy);
    if (d > JOY_MAX) {
      dx = (dx / d) * JOY_MAX;
      dy = (dy / d) * JOY_MAX;
    }
    input.kx = input.ox + dx;
    input.ky = input.oy + dy;
    if (d < JOY_DEAD) {
      input.vx = 0;
      input.vy = 0;
    } else {
      input.vx = dx / JOY_MAX;
      input.vy = dy / JOY_MAX;
    }
  }

  function joyEnd() {
    input.active = false;
    input.id = null;
    input.vx = 0;
    input.vy = 0;
  }

  canvas.addEventListener('pointerdown', (e) => {
    if (state !== 'playing') return;
    e.preventDefault();
    joyStart(e);
  }, { passive: false });

  canvas.addEventListener('pointermove', (e) => {
    if (!input.active || e.pointerId !== input.id) return;
    e.preventDefault();
    joyMove(e);
  }, { passive: false });

  ['pointerup', 'pointercancel', 'pointerleave'].forEach((t) => {
    canvas.addEventListener(t, (e) => {
      if (e.pointerId === input.id) joyEnd();
    });
  });

  window.addEventListener('keydown', (e) => {
    const k = e.key.toLowerCase();
    input.keys[k] = true;
    if (k.startsWith('arrow') || k === ' ') e.preventDefault();

    if (k === 'escape') {
      if (state === 'playing') pauseGame();
      else if (state === 'paused') resumeGame();
    }
    if (state === 'levelup' && (k === '1' || k === '2' || k === '3')) {
      chooseCard(Number(k) - 1);
    }
  });

  window.addEventListener('keyup', (e) => {
    input.keys[e.key.toLowerCase()] = false;
  });

  window.addEventListener('blur', () => {
    input.keys = Object.create(null);
    joyEnd();
  });

  // iOS 사파리 확대/길게누르기 방지
  document.addEventListener('gesturestart', (e) => e.preventDefault());
  document.addEventListener('contextmenu', (e) => e.preventDefault());

  /* ── 게임 상태 ─────────────────────────────────────────────────────── */
  let state = 'title';                     // title | playing | levelup | paused | over
  let player = null;
  let enemies = [];
  let bullets = [];
  let gems = [];
  let parts = [];
  let game = null;
  let bulletSeq = 0;
  let cardChoices = [];
  const cam = { x: 0, y: 0 };

  /* ── 업그레이드 정의 ───────────────────────────────────────────────── */
  const UPGRADES = [
    { id: 'multi',  icon: '🔫', name: '탄환 수 +1',  max: 4, level: 0,
      desc: '한 번에 나가는 탄환이 1발 늘어납니다 (부채꼴 확산)' },
    { id: 'rate',   icon: '⚡', name: '연사 속도',   max: 6, level: 0,
      desc: '자동 사격 속도 +18%' },
    { id: 'dmg',    icon: '💥', name: '공격력',      max: 6, level: 0,
      desc: '탄환 피해량 +22%' },
    { id: 'orbit',  icon: '🛰️', name: '수호구',     max: 4, level: 0,
      desc: '플레이어 주위를 도는 수호구가 닿은 적을 밀어내고 피해를 줍니다' },
    { id: 'magnet', icon: '🧲', name: '자석 범위',   max: 4, level: 0,
      desc: '경험치 젬 흡수 범위 +40%' },
    { id: 'speed',  icon: '👟', name: '이동 속도',   max: 4, level: 0,
      desc: '이동 속도 +12%' },
    { id: 'hp',     icon: '❤️', name: '최대 체력',   max: 5, level: 0,
      desc: '최대 체력 +25, 즉시 25 회복' },
    { id: 'pierce', icon: '🎯', name: '관통',        max: 3, level: 0,
      desc: '탄환이 적을 1명 더 뚫고 지나갑니다' },
    { id: 'size',   icon: '⭕', name: '탄환 강화',   max: 3, level: 0,
      desc: '탄환이 커지고 피해량 +10%' },
    { id: 'regen',  icon: '🌿', name: '재생',        max: 3, level: 0,
      desc: '1초마다 체력 1 회복' },
  ];

  const HEAL_CARD = {
    id: 'heal', icon: '🍖', name: '응급 처치', max: 99, level: 0,
    desc: '최대 체력의 40%를 즉시 회복합니다',
  };

  /* ── 초기화 ───────────────────────────────────────────────────────── */
  function resetGame() {
    player = {
      x: 0, y: 0, r: 14 * S, aim: -Math.PI / 2,
      speed: 195 * S, hp: 100, maxHp: 100,
      fireRate: 2.5, fireCd: 0, damage: 9, bulletSpeed: 620 * S,
      bulletCount: 1, bulletSize: 4.2 * S, pierce: 0,
      pickup: 98 * S, regen: 0, orbCount: 0, orbAngle: 0,
      level: 1, xp: 0, xpNeed: 5, invln: 0, flash: 0,
    };
    enemies = [];
    bullets = [];
    gems = [];
    parts = [];
    bulletSeq = 0;
    game = {
      time: 0, kills: 0, wave: 1,
      spawnT: 0.7, eliteT: 15, bossT: 60, bossCount: 0,
      pendingLevels: 0, toast: null, shake: 0,
    };
    UPGRADES.forEach((u) => { u.level = 0; });
    cam.x = 0;
    cam.y = 0;
    input.alpha = 0;
    joyEnd();
    updateHud();
  }

  /* ── 업데이트 ─────────────────────────────────────────────────────── */
  function update(dt) {
    game.time += dt;
    game.wave = Math.floor(game.time / WAVE_SEC) + 1;

    // ── 이동
    let mx = 0;
    let my = 0;
    if (input.active && (input.vx !== 0 || input.vy !== 0)) {
      mx = input.vx;
      my = input.vy;
    } else {
      if (input.keys['a'] || input.keys['arrowleft']) mx -= 1;
      if (input.keys['d'] || input.keys['arrowright']) mx += 1;
      if (input.keys['w'] || input.keys['arrowup']) my -= 1;
      if (input.keys['s'] || input.keys['arrowdown']) my += 1;
      const m = Math.hypot(mx, my);
      if (m > 1) { mx /= m; my /= m; }
    }
    player.x += mx * player.speed * dt;
    player.y += my * player.speed * dt;

    if (player.invln > 0) player.invln -= dt;
    if (player.flash > 0) player.flash -= dt;
    if (player.regen > 0) player.hp = Math.min(player.maxHp, player.hp + player.regen * dt);

    // ── 자동 조준 + 사격
    const target = nearestEnemy(player.x, player.y, aimRange);
    if (target) player.aim = Math.atan2(target.y - player.y, target.x - player.x);
    player.fireCd -= dt;
    if (target && player.fireCd <= 0) {
      player.fireCd = 1 / player.fireRate;
      fire();
    }

    updateSpawn(dt);
    updateEnemies(dt);
    if (state !== 'playing') return;
    updateBullets(dt);
    updateOrbs(dt);
    updateGems(dt);
    updateParts(dt);

    // ── 카메라
    const k = Math.min(1, 12 * dt);
    cam.x += (player.x - cam.x) * k;
    cam.y += (player.y - cam.y) * k;
    if (game.shake > 0) game.shake = Math.max(0, game.shake - dt * 34);
    if (game.toast) {
      game.toast.t -= dt;
      if (game.toast.t <= 0) game.toast = null;
    }
    input.alpha += ((input.active ? 1 : 0) - input.alpha) * Math.min(1, 12 * dt);

    // ── 승리 조건
    if (game.time >= GOAL_TIME) endGame(true);

    updateHud();
  }

  function updateIdle(dt) {
    if (game) {
      if (game.shake > 0) game.shake = Math.max(0, game.shake - dt * 34);
      if (game.toast) {
        game.toast.t -= dt;
        if (game.toast.t <= 0) game.toast = null;
      }
    }
    input.alpha += ((input.active ? 1 : 0) - input.alpha) * Math.min(1, 12 * dt);
  }

  /* ── 사격 ─────────────────────────────────────────────────────────── */
  function fire() {
    const n = player.bulletCount;
    const spread = 0.115;
    for (let i = 0; i < n; i++) {
      const a = player.aim + (i - (n - 1) / 2) * spread;
      bullets.push({
        x: player.x + Math.cos(a) * 16 * S,
        y: player.y + Math.sin(a) * 16 * S,
        vx: Math.cos(a) * player.bulletSpeed,
        vy: Math.sin(a) * player.bulletSpeed,
        r: player.bulletSize, dmg: player.damage,
        pierce: player.pierce, life: 1.5, id: ++bulletSeq,
      });
    }
  }

  function updateBullets(dt) {
    for (let i = bullets.length - 1; i >= 0; i--) {
      const b = bullets[i];
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.life -= dt;
      if (b.life <= 0) { bullets.splice(i, 1); continue; }

      for (let j = 0; j < enemies.length; j++) {
        const e = enemies[j];
        if (e.dead || e.lastHit === b.id) continue;
        const rr = e.r + b.r;
        if (dist2(b.x, b.y, e.x, e.y) < rr * rr) {
          e.lastHit = b.id;
          damageEnemy(e, b.dmg);
          b.pierce -= 1;
          if (b.pierce < 0) { bullets.splice(i, 1); break; }
        }
      }
    }
  }

  /* ── 적 ──────────────────────────────────────────────────────────── */
  function nearestEnemy(x, y, maxD) {
    let best = null;
    let bd = maxD * maxD;
    for (let i = 0; i < enemies.length; i++) {
      const e = enemies[i];
      if (e.dead) continue;
      const d = dist2(x, y, e.x, e.y);
      if (d < bd) { bd = d; best = e; }
    }
    return best;
  }

  function pickType() {
    const r = Math.random();
    if (game.time > 75 && r < 0.42) return 'fast';
    if (game.time > 30 && r < 0.26) return 'fast';
    return 'grunt';
  }

  function spawnEnemy(type) {
    if (enemies.length >= MAX_ENEMIES) return;
    const c = TYPES[type];
    const t = game.time;
    const hpMul = 1 + t * 0.019 + Math.pow(t / 60, 1.6) * 0.14;
    const spMul = 1 + Math.min(0.35, t * 0.0018);
    const ang = rand(0, TAU);
    const rad = Math.max(VW, VH) * 0.5 + 60;   // 항상 화면 밖에서 등장
    const hp = c.hp * hpMul;
    enemies.push({
      type,
      x: player.x + Math.cos(ang) * rad,
      y: player.y + Math.sin(ang) * rad,
      r: c.r * S, hp, maxHp: hp,
      speed: c.speed * spMul * S, dmg: c.dmg,
      ang: 0, flash: 0, orbCd: 0, dead: false, lastHit: -1,
    });
  }

  function updateSpawn(dt) {
    if (enemies.length >= MAX_ENEMIES) return;

    game.spawnT -= dt;
    if (game.spawnT <= 0) {
      game.spawnT = Math.max(0.17, 0.82 - game.time * 0.0075);
      const n = 1 + Math.floor(game.time / 50);
      for (let i = 0; i < n; i++) spawnEnemy(pickType());
    }

    game.eliteT -= dt;
    if (game.eliteT <= 0) {
      game.eliteT = 20;
      spawnEnemy('elite');
    }

    game.bossT -= dt;
    if (game.bossT <= 0) {
      game.bossT = 80;
      game.bossCount += 1;
      spawnEnemy('boss');
      game.shake = 14;
      toast(game.bossCount === 1 ? '보스 등장!' : '보스 ' + game.bossCount + ' 등장!');
    }
  }

  function updateEnemies(dt) {
    const px = player.x;
    const py = player.y;

    for (let i = 0; i < enemies.length; i++) {
      const e = enemies[i];
      if (e.dead) continue;
      let dx = px - e.x;
      let dy = py - e.y;
      const d = Math.hypot(dx, dy) || 1;
      dx /= d;
      dy /= d;
      e.x += dx * e.speed * dt;
      e.y += dy * e.speed * dt;
      e.ang = Math.atan2(dy, dx);
      if (e.flash > 0) e.flash -= dt;
      if (e.orbCd > 0) e.orbCd -= dt;

      const rr = e.r + player.r;
      if (d < rr && player.invln <= 0) hurtPlayer(e.dmg);
    }

    // 겹침 완화 (적끼리 밀어내기)
    for (let i = 0; i < enemies.length; i++) {
      const a = enemies[i];
      if (a.dead) continue;
      for (let j = i + 1; j < enemies.length; j++) {
        const b = enemies[j];
        if (b.dead) continue;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const min = a.r + b.r;
        const d2 = dx * dx + dy * dy;
        if (d2 > 0.01 && d2 < min * min) {
          const d = Math.sqrt(d2);
          const push = ((min - d) / d) * 0.35;
          a.x -= dx * push;
          a.y -= dy * push;
          b.x += dx * push;
          b.y += dy * push;
        }
      }
    }

    // 죽은 적 정리
    let w = 0;
    for (let i = 0; i < enemies.length; i++) {
      if (!enemies[i].dead) enemies[w++] = enemies[i];
    }
    enemies.length = w;
  }

  function damageEnemy(e, dmg) {
    if (e.dead) return;
    e.hp -= dmg;
    e.flash = 0.1;
    if (e.hp > 0) return;

    e.dead = true;
    game.kills += 1;
    const c = TYPES[e.type];
    gems.push({
      x: e.x, y: e.y,
      vx: rand(-50, 50), vy: rand(-50, 50),
      val: c.xp,
      r: (e.type === 'boss' ? 9 : e.type === 'elite' ? 6 : 4.5) * S,
      spin: rand(0, TAU),
    });
    if (gems.length > 500) gems.shift();   // 젬이 무한히 쌓이지 않도록
    burst(e.x, e.y, c.color, e.type === 'boss' ? 30 : e.type === 'elite' ? 14 : 7);
    if (e.type === 'boss') {
      game.shake = 16;
      toast('보스 처치!');
    }
  }

  /* ── 수호구(오비탈) ───────────────────────────────────────────────── */
  function updateOrbs(dt) {
    if (!player.orbCount) return;
    player.orbAngle += dt * 2.4;
    const orbitR = 62 * S;

    for (let k = 0; k < player.orbCount; k++) {
      const a = player.orbAngle + (TAU * k) / player.orbCount;
      const ox = player.x + Math.cos(a) * orbitR;
      const oy = player.y + Math.sin(a) * orbitR;

      for (let i = 0; i < enemies.length; i++) {
        const e = enemies[i];
        if (e.dead || e.orbCd > 0) continue;
        const rr = e.r + 11 * S;
        if (dist2(ox, oy, e.x, e.y) < rr * rr) {
          e.orbCd = 0.35;
          damageEnemy(e, 13 + player.level * 1.6);
          const dx = e.x - player.x;
          const dy = e.y - player.y;
          const d = Math.hypot(dx, dy) || 1;
          e.x += (dx / d) * 14;
          e.y += (dy / d) * 14;
        }
      }
    }
  }

  /* ── 경험치 젬 ────────────────────────────────────────────────────── */
  function updateGems(dt) {
    const px = player.x;
    const py = player.y;
    const pr = player.pickup;

    for (let i = gems.length - 1; i >= 0; i--) {
      const g = gems[i];
      g.spin += dt * 3;

      const dx = px - g.x;
      const dy = py - g.y;
      const d = Math.hypot(dx, dy) || 0.001;

      if (d < pr) {
        // 자석 흡수: 가까울수록 강하게 끌어당김
        const pull = (1 - d / pr) * 2200 + 260;
        g.vx += (dx / d) * pull * dt;
        g.vy += (dy / d) * pull * dt;
        const sp = Math.hypot(g.vx, g.vy);
        if (sp > 1100) {
          g.vx = (g.vx / sp) * 1100;
          g.vy = (g.vy / sp) * 1100;
        }
      } else {
        g.vx *= 0.93;
        g.vy *= 0.93;
      }

      g.x += g.vx * dt;
      g.y += g.vy * dt;

      if (d < player.r + 8) {
        gems.splice(i, 1);
        addXp(g.val);
      }
    }
  }

  function addXp(v) {
    player.xp += v;
    while (player.xp >= player.xpNeed) {
      player.xp -= player.xpNeed;
      player.level += 1;
      player.xpNeed = Math.round(5 + (player.level - 1) * 4.2);
      game.pendingLevels += 1;
    }
    updateHud();
    if (game.pendingLevels > 0 && state === 'playing') openLevelUp();
  }

  /* ── 파티클 ───────────────────────────────────────────────────────── */
  function burst(x, y, color, n) {
    for (let i = 0; i < n; i++) {
      if (parts.length >= MAX_PARTS) break;
      const a = rand(0, TAU);
      const sp = rand(40, 270);
      const life = rand(0.22, 0.6);
      parts.push({
        x, y,
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
        life, max: life, color,
        size: rand(1.4, 3.4),
      });
    }
  }

  function updateParts(dt) {
    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i];
      p.life -= dt;
      if (p.life <= 0) { parts.splice(i, 1); continue; }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= 0.94;
      p.vy *= 0.94;
    }
  }

  /* ── 플레이어 피해 ────────────────────────────────────────────────── */
  function hurtPlayer(dmg) {
    player.hp -= dmg;
    player.invln = 0.55;
    player.flash = 0.22;
    game.shake = Math.min(14, 6 + dmg * 0.3);
    if (player.hp <= 0) {
      player.hp = 0;
      updateHud();
      endGame(false);
      return;
    }
    updateHud();
  }

  function toast(text) {
    game.toast = { text, t: 2 };
  }

  /* ── 렌더 ────────────────────────────────────────────────────────── */
  function render() {
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.fillStyle = '#07070f';
    ctx.fillRect(0, 0, VW, VH);

    const sh = game ? game.shake : 0;
    const shx = sh ? rand(-sh, sh) : 0;
    const shy = sh ? rand(-sh, sh) : 0;

    ctx.save();
    ctx.translate(VW / 2 - cam.x + shx, VH / 2 - cam.y + shy);
    drawGrid();
    drawGems();
    drawEnemies();
    drawBullets();
    drawOrbs();
    drawPlayer();
    drawParts();
    ctx.restore();

    drawLowHp();
    drawJoystick();
    drawToast();
  }

  function drawGrid() {
    const G = 90;
    const left = cam.x - VW / 2 - 60;
    const right = cam.x + VW / 2 + 60;
    const top = cam.y - VH / 2 - 60;
    const bottom = cam.y + VH / 2 + 60;

    ctx.strokeStyle = 'rgba(130, 150, 255, 0.07)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = Math.floor(left / G) * G; x <= right; x += G) {
      ctx.moveTo(x, top);
      ctx.lineTo(x, bottom);
    }
    for (let y = Math.floor(top / G) * G; y <= bottom; y += G) {
      ctx.moveTo(left, y);
      ctx.lineTo(right, y);
    }
    ctx.stroke();
  }

  function drawGems() {
    for (let i = 0; i < gems.length; i++) {
      const g = gems[i];
      const s = g.r;
      ctx.save();
      ctx.translate(g.x, g.y);
      ctx.rotate(g.spin);
      ctx.fillStyle = g.val >= 5 ? '#7cf0c6' : '#4de2ff';
      ctx.globalAlpha = 0.95;
      ctx.beginPath();
      ctx.moveTo(0, -s * 1.35);
      ctx.lineTo(s, 0);
      ctx.lineTo(0, s * 1.35);
      ctx.lineTo(-s, 0);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
    ctx.globalAlpha = 1;
  }

  function drawEnemies() {
    for (let i = 0; i < enemies.length; i++) {
      const e = enemies[i];
      if (e.dead) continue;
      const c = TYPES[e.type];

      ctx.save();
      ctx.translate(e.x, e.y);

      if (e.type === 'fast') {
        ctx.rotate(e.ang);
        ctx.fillStyle = c.color;
        ctx.beginPath();
        ctx.moveTo(e.r * 1.25, 0);
        ctx.lineTo(-e.r * 0.8, e.r * 0.85);
        ctx.lineTo(-e.r * 0.8, -e.r * 0.85);
        ctx.closePath();
        ctx.fill();
      } else if (e.type === 'elite') {
        ctx.fillStyle = c.dark;
        ctx.beginPath();
        ctx.arc(0, 0, e.r, 0, TAU);
        ctx.fill();
        ctx.strokeStyle = c.color;
        ctx.lineWidth = 3;
        ctx.stroke();
        ctx.fillStyle = c.color;
        ctx.beginPath();
        ctx.arc(0, 0, e.r * 0.42, 0, TAU);
        ctx.fill();
      } else if (e.type === 'boss') {
        ctx.strokeStyle = 'rgba(77, 226, 255, 0.28)';
        ctx.lineWidth = 6;
        ctx.beginPath();
        ctx.arc(0, 0, e.r + 9, 0, TAU);
        ctx.stroke();
        ctx.fillStyle = c.dark;
        ctx.beginPath();
        ctx.arc(0, 0, e.r, 0, TAU);
        ctx.fill();
        ctx.fillStyle = c.color;
        ctx.beginPath();
        ctx.arc(0, 0, e.r * 0.55, 0, TAU);
        ctx.fill();
        ctx.fillStyle = '#06121a';
        ctx.beginPath();
        ctx.arc(0, 0, e.r * 0.24, 0, TAU);
        ctx.fill();
      } else {
        ctx.fillStyle = c.dark;
        ctx.beginPath();
        ctx.arc(0, 0, e.r, 0, TAU);
        ctx.fill();
        ctx.fillStyle = c.color;
        ctx.beginPath();
        ctx.arc(0, 0, e.r * 0.72, 0, TAU);
        ctx.fill();
        ctx.fillStyle = 'rgba(10, 8, 20, 0.75)';
        ctx.beginPath();
        ctx.arc(-e.r * 0.26, -e.r * 0.2, e.r * 0.19, 0, TAU);
        ctx.arc(e.r * 0.26, -e.r * 0.2, e.r * 0.19, 0, TAU);
        ctx.fill();
      }

      if (e.flash > 0) {
        ctx.globalAlpha = Math.min(1, e.flash * 7);
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(0, 0, e.r * 0.95, 0, TAU);
        ctx.fill();
        ctx.globalAlpha = 1;
      }

      ctx.restore();

      // 엘리트·보스 체력 바
      if (e.type === 'elite' || e.type === 'boss') {
        const w = e.r * 2;
        const h = e.type === 'boss' ? 5 : 3.5;
        const y = e.y - e.r - (e.type === 'boss' ? 16 : 10);
        ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
        ctx.fillRect(e.x - w / 2, y, w, h);
        ctx.fillStyle = e.type === 'boss' ? '#4de2ff' : '#b06cff';
        ctx.fillRect(e.x - w / 2, y, w * Math.max(0, e.hp / e.maxHp), h);
      }
    }
  }

  function drawBullets() {
    ctx.lineCap = 'round';
    for (let i = 0; i < bullets.length; i++) {
      const b = bullets[i];
      ctx.strokeStyle = 'rgba(124, 240, 198, 0.42)';
      ctx.lineWidth = b.r * 1.5;
      ctx.beginPath();
      ctx.moveTo(b.x, b.y);
      ctx.lineTo(b.x - b.vx * 0.022, b.y - b.vy * 0.022);
      ctx.stroke();
      ctx.fillStyle = '#eafff6';
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r * 0.85, 0, TAU);
      ctx.fill();
    }
    ctx.lineCap = 'butt';
  }

  function drawOrbs() {
    if (!player.orbCount) return;
    const orbitR = 62 * S;
    for (let k = 0; k < player.orbCount; k++) {
      const a = player.orbAngle + (TAU * k) / player.orbCount;
      const ox = player.x + Math.cos(a) * orbitR;
      const oy = player.y + Math.sin(a) * orbitR;
      ctx.beginPath();
      ctx.arc(ox, oy, 13 * S, 0, TAU);
      ctx.fillStyle = 'rgba(124, 240, 198, 0.18)';
      ctx.fill();
      ctx.beginPath();
      ctx.arc(ox, oy, 6.5 * S, 0, TAU);
      ctx.fillStyle = '#7cf0c6';
      ctx.fill();
    }
  }

  function drawPlayer() {
    const r = player.r;

    // 오라
    ctx.beginPath();
    ctx.arc(player.x, player.y, r + 9, 0, TAU);
    ctx.fillStyle = 'rgba(77, 226, 255, 0.12)';
    ctx.fill();

    // 몸통
    ctx.beginPath();
    ctx.arc(player.x, player.y, r, 0, TAU);
    ctx.fillStyle = player.invln > 0 && Math.floor(player.invln * 20) % 2 === 0
      ? '#ff9db3'
      : '#eef6ff';
    ctx.fill();

    ctx.beginPath();
    ctx.arc(player.x, player.y, r * 0.55, 0, TAU);
    ctx.fillStyle = '#0b1224';
    ctx.fill();

    // 조준 방향 포신
    const a = player.aim;
    ctx.strokeStyle = '#4de2ff';
    ctx.lineWidth = 5;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(player.x + Math.cos(a) * (r * 0.4), player.y + Math.sin(a) * (r * 0.4));
    ctx.lineTo(player.x + Math.cos(a) * (r + 10), player.y + Math.sin(a) * (r + 10));
    ctx.stroke();
    ctx.lineCap = 'butt';
  }

  function drawParts() {
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i];
      ctx.globalAlpha = Math.max(0, p.life / p.max);
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
    }
    ctx.globalAlpha = 1;
  }

  function drawJoystick() {
    if (input.alpha < 0.02) return;
    ctx.globalAlpha = input.alpha * 0.9;
    ctx.beginPath();
    ctx.arc(input.ox, input.oy, JOY_MAX, 0, TAU);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.05)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.16)';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(input.kx, input.ky, 24, 0, TAU);
    ctx.fillStyle = 'rgba(77, 226, 255, 0.42)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(200, 245, 255, 0.7)';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  function drawLowHp() {
    const pct = player.hp / player.maxHp;
    if (pct > 0.3) return;
    const a = (0.3 - pct) / 0.3;
    const g = ctx.createRadialGradient(
      VW / 2, VH / 2, Math.min(VW, VH) * 0.32,
      VW / 2, VH / 2, Math.max(VW, VH) * 0.72
    );
    g.addColorStop(0, 'rgba(255, 40, 80, 0)');
    g.addColorStop(1, 'rgba(255, 30, 70, ' + (0.42 * a).toFixed(3) + ')');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, VW, VH);
  }

  function drawToast() {
    if (!game || !game.toast) return;
    const t = game.toast;
    const p = t.t > 1.6 ? (2 - t.t) / 0.4 : Math.min(1, t.t / 0.5);
    ctx.globalAlpha = Math.max(0, Math.min(1, p));
    ctx.font = '800 22px -apple-system, "Apple SD Gothic Neo", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = '#ffd166';
    ctx.fillText(t.text, VW / 2, VH * 0.22);
    ctx.textAlign = 'left';
    ctx.globalAlpha = 1;
  }

  /* ── HUD ─────────────────────────────────────────────────────────── */
  let hudSec = -1;

  function updateHud() {
    if (!player || !game) return;
    const pct = clamp(player.hp / player.maxHp, 0, 1);
    ui.hpFill.style.width = (pct * 100).toFixed(1) + '%';
    ui.hpText.textContent = Math.ceil(player.hp) + ' / ' + player.maxHp;
    ui.xpFill.style.width = clamp((player.xp / player.xpNeed) * 100, 0, 100).toFixed(1) + '%';
    ui.level.textContent = String(player.level);
    ui.kills.textContent = String(game.kills);
    ui.wave.textContent = '웨이브 ' + game.wave;

    const s = Math.floor(game.time);
    if (s !== hudSec) {
      hudSec = s;
      ui.timer.textContent = fmtTime(game.time);
    }
  }

  /* ── 레벨업 카드 ─────────────────────────────────────────────────── */
  function rollCards(n) {
    const avail = UPGRADES.filter((u) => u.level < u.max);
    const pool = avail.slice();
    const out = [];
    while (out.length < n && pool.length > 0) {
      out.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
    }
    while (out.length < n) out.push(HEAL_CARD);
    return out;
  }

  function renderCards() {
    cardChoices = rollCards(3);
    ui.cards.innerHTML = '';
    cardChoices.forEach((u, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'card';
      const lv = u.id === 'heal'
        ? ''
        : '<span class="card-lv">Lv.' + (u.level + 1) + '/' + u.max + '</span>';
      b.innerHTML =
        '<div class="card-icon">' + u.icon + '</div>' +
        '<div class="card-body">' +
          '<div class="card-name">' + u.name + ' ' + lv + '</div>' +
          '<div class="card-desc">' + u.desc + '</div>' +
        '</div>' +
        '<div class="card-key">' + (i + 1) + '</div>';
      b.addEventListener('click', () => chooseCard(i));
      ui.cards.appendChild(b);
    });
  }

  function openLevelUp() {
    state = 'levelup';
    joyEnd();
    renderCards();
    ui.levelup.classList.remove('hidden');
  }

  function applyUpgrade(u) {
    if (u.id !== 'heal') u.level = Math.min(u.max, u.level + 1);
    switch (u.id) {
      case 'multi': player.bulletCount += 1; break;
      case 'rate': player.fireRate *= 1.18; break;
      case 'dmg': player.damage *= 1.22; break;
      case 'orbit': player.orbCount += 1; break;
      case 'magnet': player.pickup *= 1.4; break;
      case 'speed': player.speed *= 1.12; break;
      case 'hp':
        player.maxHp += 25;
        player.hp = Math.min(player.maxHp, player.hp + 25);
        break;
      case 'pierce': player.pierce += 1; break;
      case 'size':
        player.bulletSize += 1.2 * S;
        player.damage *= 1.1;
        break;
      case 'regen': player.regen += 1; break;
      case 'heal':
        player.hp = Math.min(player.maxHp, player.hp + player.maxHp * 0.4);
        break;
      default: break;
    }
    updateHud();
  }

  function chooseCard(i) {
    if (state !== 'levelup') return;
    const u = cardChoices[i];
    if (!u || game.pendingLevels <= 0) return;
    applyUpgrade(u);
    game.pendingLevels -= 1;
    if (game.pendingLevels > 0) {
      renderCards();
      return;
    }
    ui.levelup.classList.add('hidden');
    state = 'playing';
  }

  /* ── 화면 전환 ───────────────────────────────────────────────────── */
  function startGame() {
    resetGame();
    // 시작 직후 빈 화면이 길지 않도록 첫 적 3마리를 미리 불러 둡니다.
    for (let i = 0; i < 3; i++) spawnEnemy('grunt');
    ui.title.classList.add('hidden');
    ui.over.classList.add('hidden');
    ui.levelup.classList.add('hidden');
    ui.pause.classList.add('hidden');
    ui.hint.classList.remove('off');
    state = 'playing';
    window.setTimeout(() => ui.hint.classList.add('off'), 6000);
  }

  function pauseGame() {
    if (state !== 'playing') return;
    state = 'paused';
    joyEnd();
    ui.pause.classList.remove('hidden');
  }

  function resumeGame() {
    if (state !== 'paused') return;
    state = 'playing';
    ui.pause.classList.add('hidden');
  }

  function toTitle() {
    state = 'title';
    resetGame();
    ui.pause.classList.add('hidden');
    ui.levelup.classList.add('hidden');
    ui.over.classList.add('hidden');
    ui.title.classList.remove('hidden');
  }

  function endGame(win) {
    if (state === 'over') return;
    state = 'over';
    joyEnd();
    ui.overKicker.textContent = win ? 'STAGE CLEAR' : 'GAME OVER';
    ui.overKicker.classList.toggle('lose', !win);
    ui.overTitle.textContent = win ? '생존 성공!' : '쓰러졌습니다';
    ui.overTime.textContent = fmtTime(game.time);
    ui.overKills.textContent = String(game.kills);
    ui.overLevel.textContent = String(player.level);
    ui.overWave.textContent = String(game.wave);
    ui.levelup.classList.add('hidden');
    ui.over.classList.remove('hidden');
  }

  /* ── 버튼 ────────────────────────────────────────────────────────── */
  ui.startBtn.addEventListener('click', startGame);
  ui.retryBtn.addEventListener('click', startGame);
  ui.resumeBtn.addEventListener('click', resumeGame);
  ui.quitBtn.addEventListener('click', toTitle);
  ui.pauseBtn.addEventListener('click', pauseGame);

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) pauseGame();
  });

  /* ── 루프 ────────────────────────────────────────────────────────── */
  let last = 0;

  function frame(ts) {
    requestAnimationFrame(frame);
    if (!last) last = ts;
    let dt = (ts - last) / 1000;
    last = ts;
    if (dt > 0.05) dt = 0.05;
    if (dt < 0) dt = 0;

    if (state === 'playing') update(dt);
    else updateIdle(dt);

    render();
  }

  /* ── 시작 ────────────────────────────────────────────────────────── */
  window.addEventListener('resize', resize);
  window.addEventListener('orientationchange', () => setTimeout(resize, 120));
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', resize);
  }

  resize();
  resetGame();
  requestAnimationFrame(frame);

  /* ── 디버그 훅 ────────────────────────────────────────────────────
     브라우저 콘솔에서 상태를 확인하거나 빠르게 테스트할 때 사용합니다.
     예) TT.god() / TT.levelUp(3) / TT.spawn('boss')                       */
  window.TT = {
    get state() { return state; },
    get player() { return player; },
    get game() { return game; },
    get enemies() { return enemies; },
    get gems() { return gems; },
    god() { player.maxHp = 9999; player.hp = 9999; updateHud(); },
    levelUp(n) {
      const times = n || 1;
      for (let i = 0; i < times; i++) {
        player.level += 1;
        game.pendingLevels += 1;
      }
      if (state === 'playing') openLevelUp();
    },
    spawn(type) { spawnEnemy(type || 'grunt'); },
    killAll() { enemies.forEach((e) => damageEnemy(e, e.hp + 1)); },
  };
})();
