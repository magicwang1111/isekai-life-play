(function(){'use strict';
const modules={"src/ui/app.js":function(module,exports,require){
'use strict';
const { startRun, choose, hash, getChoices, STATS } = require("src/core/game.js");
const { createStorage } = require("src/adapters/storage.js");
const playtest = require("src/adapters/playtest.js");
const { clockFor, prepareInterval } = require("src/ui/time.js");
const { drawHorizon } = require("src/ui/horizon.js");
const life = require("src/core/life-story.js");
const COLORS = { bg: '#f7f4eb', card: '#eeeee5', line: '#ccd4c9', text: '#243a36', muted: '#63746c', gold: '#486f61', ink: '#ffffff' };
class App {
  constructor(canvas, platform, pack) {
    this.canvas = canvas; this.ctx = canvas.getContext('2d'); this.platform = platform; this.pack = pack;
    this.storage = createStorage(platform, pack.worlds, pack.revision); this.data = this.storage.load();
    playtest.visit(this.data);
    if (this.data.run) clockFor(this.data.run);
    this.wrapCache = new Map();
    this.page = 'home'; this.scroll = 0; this.hits = []; this.notice = ''; this.archive = null;
    this.resize();
    platform.onResize(() => this.resize());
    platform.onHide(() => { this.hidden = true; this.lastTick = null; this.persist(); });
    platform.onShow?.(() => { this.hidden = false; this.lastTick = null; });
    platform.onFrame?.(now => this.tick(now));
    platform.onInput(event => this.input(event));
  }
  resize() {
    const size = this.platform.size();
    this.width = size.width; this.height = size.height; this.top = size.top || 0;
    const ratio = Math.min(size.ratio || 1, 3);
    this.canvas.width = Math.round(size.width * ratio); this.canvas.height = Math.round(size.height * ratio);
    this.ctx.setTransform(ratio, 0, 0, ratio, 0, 0); this.render();
  }
  persist() { this.storage.save(this.data); }
  go(page) { this.lastTick = null; this.choicePage = 0; this.page = page; this.scroll = 0; this.notice = ''; this.render(); }
  world(id) { return this.pack.worlds.find(w => w.id === id); }
  begin(id) {
    playtest.started(this.data);
    const seed = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
    const world = id ? this.world(id) : this.pack.worlds[hash(seed) % this.pack.worlds.length];
    const recent = this.data.recent[world.id] || [];
    this.data.run = world.turns ? life.start(world, seed, recent, this.data.discoveries || []) : startRun(world, seed, recent);
    this.data.run.uiTime = { age: 0, from: 0, target: 0, progress: 0, speed: 1, paused: false, mode: 'birth' };
    this.drawElapsed = 0; this.drawRound = -1; this.preview = null;
    this.drawing = !this.reducedMotion();
    this.persist(); this.go('story');
  }
  reducedMotion() { return this.data.settings.reduceMotion || this.platform.reducedMotion?.(); }
  tick(now) {
    const delta = this.lastTick == null ? 0 : now - this.lastTick; this.lastTick = now;
    if (this.hidden || this.page !== 'story' || !this.data.run || delta <= 0 || delta > 1000) return;
    const run = this.data.run, time = clockFor(run);
    if (time.mode === 'birth' && this.drawing) {
      this.drawElapsed += delta;
      if (this.reducedMotion() || this.drawElapsed >= 2400) { this.drawing = false; this.preview = null; }
      else {
        const round = Math.floor(this.drawElapsed / 240);
        if (round !== this.drawRound) {
          this.drawRound = round;
          const seed = run.seed + ':draw:' + round;
          const world = this.pack.worlds[hash(seed) % this.pack.worlds.length];
          this.preview = startRun(world, seed);
        }
      }
      this.render(); return;
    }
    if (time.mode !== 'flow' || time.paused) return;
    const duration = run.format === 'life-story-v1'
      ? (run.phase === 'choice' ? 1200 : Math.max(6500, Math.min(22000, (run.scene.text.length + 10) * 95)))
      : 6000;
    time.progress = Math.min(1, time.progress + delta * time.speed / duration);
    time.age = time.from + (time.target - time.from) * time.progress;
    if (time.progress === 1) { this.arrive(); return; }
    // Save at boundaries and once per second, not on every animation frame.
    if (time.mode === 'event' || !this.lastCheckpoint || now - this.lastCheckpoint >= 1000) {
      this.persist(); this.lastCheckpoint = now;
    }
    this.render();
  }
  arrive() {
    const run = this.data.run, time = clockFor(run);
    if (time.mode !== 'flow') return;
    time.age = time.target; time.progress = 1; time.mode = 'event';
    if (run.format === 'life-story-v1' && run.phase === 'event') {
      this.decide(null); return;
    }
    this.persist(); this.go('story');
  }
  decide(option) {
    const previous = this.data.run;
    if (clockFor(previous).mode !== 'event') return;
    const w = this.world(previous.worldId);
    const majorLife = previous.format === 'life-story-v1';
    if (majorLife) {
      const next = life.advance(w, previous, option);
      next.uiTime = { ...previous.uiTime };
      this.data.run = next;
      if (next.phase !== 'complete') prepareInterval(next);
    } else this.data.run = choose(w, previous, option, this.data.discoveries || []);
    if (!majorLife && this.data.run.phase === 'event' && previous.phase === 'commitment') prepareInterval(this.data.run);
    if (this.data.run.phase === 'complete') {
      const run = this.data.run;
      playtest.completed(this.data);
      this.data.completed++;
      const key = `${w.id}:${run.ending}`;
      this.data.discovered[key] = true;
      this.data.discoveries = [...(this.data.discoveries || []).filter(d => d.worldId !== w.id || d.endingId !== run.endingId), run.discovery];
      this.data.archives.unshift({ ...run, number: this.data.completed });
      this.data.archives = this.data.archives.slice(0, 50);
      this.data.recent[w.id] = [...(this.data.recent[w.id] || []), ...run.ledger.map(x => x.eventIndex).filter(Number.isInteger)].slice(-24);
      this.archive = this.data.archives[0]; this.data.run = null;
      this.persist(); this.go('ending');
    } else { this.persist(); this.go('story'); }
  }
  input(e) {
    if (e.type === 'down') { this.pointer = { x: e.x, y: e.y, last: e.y, moved: false }; return; }
    if (e.type === 'move' && this.pointer) {
      if (Math.abs(e.y - this.pointer.y) > 7) this.pointer.moved = true;
      this.scroll = Math.max(0, Math.min(this.maxScroll, this.scroll + this.pointer.last - e.y));
      this.pointer.last = e.y; this.render(); return;
    }
    if (e.type === 'cancel') { this.pointer = null; return; }
    if (e.type === 'wheel') { this.scroll = Math.max(0, Math.min(this.maxScroll, this.scroll + e.delta)); this.render(); return; }
    if (e.type === 'up') {
      const p = this.pointer; this.pointer = null;
      if (!p || p.moved || e.y < this.header || e.y > this.height - 20) return;
      const hit = this.hits.find(h => e.x >= h.x && e.x <= h.x + h.w && e.y + this.scroll >= h.y && e.y + this.scroll <= h.y + h.h);
      if (hit) hit.action();
    }
    if (e.type === 'key') {
      if (e.key === 'ArrowDown' || e.key === 'PageDown') { this.scroll = Math.min(this.maxScroll, this.scroll + 180); this.render(); }
      if (e.key === 'ArrowUp' || e.key === 'PageUp') { this.scroll = Math.max(0, this.scroll - 180); this.render(); }
    }
  }
  font(size, bold = false, serif = false) { this.ctx.font = `${bold ? '600 ' : ''}${size}px ${serif ? 'system-ui, "PingFang SC", "Microsoft YaHei", sans-serif' : 'system-ui, "Microsoft YaHei", sans-serif'}`; }
  lines(text, width, size) {
    const key = width + '/' + size + '/' + text;
    if (this.wrapCache.has(key)) return this.wrapCache.get(key);
    this.font(size); const lines = [];
    for (const p of String(text).split('\n')) {
      let line = '';
      for (const c of p) { if (line && this.ctx.measureText(line + c).width > width) { lines.push(line); line = ''; } line += c; }
      lines.push(line);
    }
    if (this.wrapCache.size >= 2048) this.wrapCache.clear();
    this.wrapCache.set(key, lines);
    return lines;
  }
  text(text, size = 16, color = this.c.text, gap = 16, serif = false) {
    const actual = size + (this.data.settings.large ? 3 : 0);
    const lines = this.lines(text, this.inner, actual); this.font(actual, false, serif); this.ctx.fillStyle = color;
    for (const line of lines) { this.ctx.fillText(line, this.left, this.y); this.y += actual * 1.65; }
    this.y += gap;
  }
  rule() { this.ctx.fillStyle = this.c.line; this.ctx.fillRect(this.left, this.y, this.inner, 1); this.y += 24; }
  button(label, action, primary = false, detail = '') {
    const size = this.data.settings.large ? 19 : 16;
    const lines = this.lines(label, this.inner - 36, size);
    const details = detail ? this.lines(detail, this.inner - 36, 12) : [];
    const h = Math.max(54, lines.length * 27 + 26 + details.length * 20);
    const { ctx } = this;
    ctx.fillStyle = primary ? this.c.gold : this.c.card; ctx.fillRect(this.left, this.y, this.inner, h);
    ctx.strokeStyle = primary ? this.c.gold : this.c.line; ctx.strokeRect(this.left + .5, this.y + .5, this.inner - 1, h - 1);
    this.font(size, primary); ctx.fillStyle = primary ? this.c.ink : this.c.text;
    lines.forEach((s, i) => ctx.fillText(s, this.left + 18, this.y + 14 + i * 27));
    this.font(12); ctx.fillStyle = primary ? this.c.ink : this.c.muted;
    details.forEach((s, i) => ctx.fillText(s, this.left + 18, this.y + 16 + lines.length * 27 + i * 20));
    this.hits.push({ x: this.left, y: this.y, w: this.inner, h, action, label }); this.y += h + 12;
  }
  back() { this.button('← 返回档案馆', () => this.go('home')); }
  render() {
    if (!this.data) return;
    this.c = this.data.settings.contrast ? { ...COLORS, ink: '#101010', bg: '#000000', card: '#111111', text: '#ffffff', muted: '#eeeeee', line: '#999999', gold: '#ffe199' } : COLORS;
    const ctx = this.ctx; ctx.textBaseline = 'top';
    ctx.fillStyle = this.c.bg; ctx.fillRect(0, 0, this.width, this.height);
    this.left = Math.max(20, (this.width - 560) / 2); this.inner = this.width - this.left * 2;
    this.header = this.top + 74; this.y = this.header + 20; this.hits = [];
    ctx.save(); ctx.beginPath(); ctx.rect(0, this.header, this.width, Math.max(0, this.height - this.header - 20)); ctx.clip(); ctx.translate(0, -this.scroll);
    if (this.page === 'home') this.home();
    else if (this.page === 'restart') this.restart();
    else if (this.page === 'story') this.story();
    else if (this.page === 'ending') this.ending();
    else if (this.page === 'atlas') this.atlas();
    else if (this.page === 'history') this.history();
    else if (this.page === 'settings') this.settings();
    else if (this.page === 'journal') this.journal();
    if (this.notice || this.storage.warning) this.text(this.notice || this.storage.warning, 13, this.c.gold);
    const max = Math.max(0, this.y - this.height + 38);
    ctx.restore();
    this.maxScroll = max;
    if (this.scroll > max) { this.scroll = max; return this.render(); }
    ctx.fillStyle = this.c.bg; ctx.fillRect(0, 0, this.width, this.header);
    this.font(18, true); ctx.fillStyle = this.c.gold; ctx.fillText('异世界人生', this.left, this.top + 24);
    this.font(10); ctx.fillStyle = this.c.muted; ctx.fillText('随机人生档案', this.left, this.top + 46);
    ctx.fillStyle = this.c.line; ctx.fillRect(this.left, this.header - 1, this.inner, 1);
    if (max > 0) { ctx.fillStyle = this.c.gold; const track = this.height - this.header - 26; ctx.fillRect(this.width - 5, this.header + this.scroll / max * (track - 32), 2, 32); }
    this.font(10); ctx.fillStyle = this.c.muted; ctx.fillText(max > 0 ? '上下滑动，阅读完整档案' : '本地存档 · 离线运行', this.left, this.height - 16);
  }
  home() {
    drawHorizon(this, 73, .72, this.height < 650 ? 68 : 104);
    this.text('命运没有定稿。', 32, this.c.text, 6, true);
    this.text('这一次，你会成为谁？', 22, this.c.gold, 24, true);
    this.text('生来或许微不足道。\n但每一次选择，都将留下回声。', 16, this.c.muted, 24);
    this.rule();
    if (this.pack.fixture) this.text('测试档案 · 当前使用流程验证夹具，非正式故事。', 13, this.c.muted, 14);
    if (this.data.run) this.button('继续这一生  →', () => this.go('story'), true, this.world(this.data.run.worldId).name);
    this.button(this.data.run ? '另启一生' : '抽取我的命运  →', () => this.data.run ? this.go('restart') : this.begin(), !this.data.run);
    this.button('结局收藏', () => this.go('atlas'));
    this.button('前世记录', () => this.go('history'));
    this.button('阅读与存档', () => this.go('settings'));
  }
  restart() {
    this.text('再写一份人生', 28);
    this.text('另启一生会替换尚未完成的人生，前世记录仍会保留。', 16, this.c.muted);
    this.button('随机投生', () => this.begin(), true); this.back();
  }
  birthCard(run) {
    this.text(this.drawing ? '出生抽签 · 尚未落定' : '出生登记', 14, this.c.gold, 10);
    drawHorizon(this, hash(run.seed), this.drawing ? Math.min(1, this.drawElapsed / 2400) : .78, this.height < 650 ? 54 : 76);
    const shown = this.drawing && this.preview ? this.preview : run;
    this.ctx.globalAlpha = this.drawing ? .55 + .45 * (this.drawElapsed % 240) / 240 : 1;
    this.text(this.world(shown.worldId).name, 24, this.c.text, 8, true);
    this.text(shown.origin, 20, this.c.gold, 12);
    if (shown.background) this.text(shown.background, 16, this.c.text, 14);
    this.ctx.globalAlpha = 1;
    if (!this.drawing) {
      this.text('与你相伴的人', 13, this.c.gold, 6);
      if (run.people?.[0]) this.text(run.people[0], 15, this.c.text, 12);
      this.text('0 岁 · 人生从此刻开始', 14, this.c.muted, 12);
      this.button('开始这一生', () => { prepareInterval(run); this.persist(); this.go('story'); }, true);
    } else this.button('跳过抽签动画', () => { this.drawing = false; this.preview = null; this.render(); });
  }
  timeControls(run) {
    const time = clockFor(run);
    drawHorizon(this, hash(run.seed), time.progress, this.height < 650 ? 68 : 104);
    this.text('岁月流逝', 28, this.c.text, 10, true);
    this.text(`${Math.floor(time.age)} 岁 ${Math.floor((time.age % 1) * 12)} 个月`, 24, this.c.gold, 18);
    if (run.format === 'life-story-v1' && run.phase === 'event') {
      this.text(run.scene.title, 20, this.c.text, 8, true);
      this.text(run.scene.text, 17, this.c.text, 18);
    } else {
      this.text(time.paused ? '时间暂停' : '光影渐移，岁月向前。', 16, this.c.muted, 20);
    }
    if (run.format !== 'life-story-v1') this.button('直接抵达下一事件', () => this.arrive(), true);
    const left = this.left, inner = this.inner, y = this.y;
    [1, 2, 4, 8].forEach((speed, index) => {
      this.left = left + index * (inner + 8) / 4; this.inner = (inner - 24) / 4; this.y = y;
      this.button(`${speed}x`, () => { time.speed = speed; this.persist(); this.render(); }, time.speed === speed);
    });
    this.left = left; this.inner = inner;
    this.button(time.paused ? '继续时间' : '暂停时间', () => { time.paused = !time.paused; this.lastTick = null; this.persist(); this.render(); });
    this.details(run);
  }
  details(run) {
    this.button(this.statsOpen ? '收起当前属性' : '查看当前属性', () => { this.statsOpen = !this.statsOpen; this.render(); });
    if (this.statsOpen && Array.isArray(run.stats)) {
      STATS.forEach((name, index) => this.text(`${name}：${run.stats[index]}`, 15, this.c.muted, 2));
    }
  }
  background(run) {
    if (typeof run.background === 'string' && run.background) this.text(run.background, 15, this.c.muted);
    if (Array.isArray(run.people)) run.people.forEach(person => {
      if (typeof person === 'string') this.text(person, 15, this.c.muted);
    });
  }
  choices(run) {
    if (run.episode?.entries?.length && run.episode.title === this.world(run.worldId)?.episode?.title) {
      this.text(run.episode.title, 18, this.c.gold);
      run.episode.entries.forEach(entry => this.text(entry.title + ' · ' + entry.choice, 14));
      if (run.episode.coda) this.text(run.episode.coda, 15);
    }
    for (const entry of run.ledger || []) {
      if (run.format === 'life-story-v1' && entry.kind !== 'choice') continue;
      this.text([entry.title, entry.choice, entry.commitment].filter(Boolean).join('\n'), 15, this.c.muted, 12);
    }
  }
  story() {
    const run = this.data.run;
    if (!run) { this.page = 'home'; this.home(); return; }
    if (run.phase === 'complete') { this.archive = run; this.page = 'ending'; this.ending(); return; }
    const time = clockFor(run);
    if (time.mode === 'birth') return this.birthCard(run);
    if (time.mode === 'flow') return this.timeControls(run);
    if (run.format === 'life-story-v1') {
      this.text(this.world(run.worldId).name + '  ·  ' + Math.floor(time.age) + ' 岁', 14, this.c.gold, 12);
      this.text(run.scene.title, 27, this.c.text, 12, true);
      this.text(run.scene.text.trim(), 18, this.c.text);
      this.text('你的决定', 13, this.c.gold, 8);
      for (const option of life.options(this.world(run.worldId), run))
        this.button(option.text, () => this.decide(option.id));
      this.details(run);
      return;
    }
    const w = this.world(run.worldId); const e = w.events[run.eventIndex];
    this.text(`${Math.floor(time.age)} 岁 · 时间已停，等待你的选择`, 13, this.c.muted, 8);
    this.text(w.name, 13, this.c.gold, 8);
    if (run.phase === 'episode') {
      const scene = require("src/core/episode.js").currentScene(w, run);
      this.text(scene.title, 26, this.c.text, 12, true);
      this.text(scene.text, 18);
      this.button(scene.a, () => this.decide(0));
      this.button(scene.b, () => this.decide(1));
      this.details(run);
      return;
    }
    if (run.episode?.coda && run.step === run.episode.anchor && run.phase === 'event') {
      this.text(run.episode.title, 18, this.c.gold, 8);
      this.text(run.episode.coda, 16);
      this.rule();
    }
    this.text(e.title, 26, this.c.text, 14, true);
    if (!run.phase || run.phase === 'event') {
      this.text(e.text, 18, this.c.text, 20);
      this.button(`A  ${e.a}`, () => this.decide(0));
      this.button(`B  ${e.b}`, () => this.decide(1));
    } else {
      if (run.pending) this.text(`已选择：${run.pending.choice}`, 15, this.c.gold);
      this.text('行动承诺', 24, this.c.text, 10, true);
      const choices = getChoices(w, run).filter(c => c.available), page = this.choicePage || 0;
      choices.slice(page * 3, page * 3 + 3).forEach(c => this.button(c.text, () => this.decide(c.id)));
      if (choices.length > 3) this.button('更多承诺 →', () => { this.choicePage = (page + 1) % Math.ceil(choices.length / 3); this.scroll = 0; this.render(); });
    }
    this.details(run);
  }
  ending() {
    const r = this.archive;
    if (!r) return this.back();
    const w = this.world(r.worldId) || { name: r.worldId }; const e = r.endingSnapshot || w.endings?.[r.ending] || { title: '旧人生记录', text: '原始选择保留如下。' };
    this.text('人生档案', 13, this.c.gold, 16);
    this.text(e.title, 30, this.c.text, 16, true);
    this.text(`${w.name} · ${r.origin}`, 13, this.c.muted);
    this.text(e.text, 18);
    this.rule(); this.text('那些选择，最终成为你', 20, this.c.text, 12, true);
    this.choices(r);
    this.button('保存这份人生卡', () => this.exportCard(), true);
    this.button('再次投生', () => this.begin()); this.back();
  }
  exportCard() {
    const r = this.archive, w = this.world(r.worldId) || { name: r.worldId }, e = r.endingSnapshot || w.endings?.[r.ending] || { title: '旧人生记录' };
    const c = this.platform.offscreen(720, 960), ctx = c.getContext('2d');
    ctx.fillStyle = COLORS.bg; ctx.fillRect(0, 0, 720, 960);
    ctx.strokeStyle = COLORS.gold; ctx.strokeRect(32, 32, 656, 896);
    ctx.textBaseline = 'top'; ctx.fillStyle = COLORS.gold; ctx.font = '20px sans-serif'; ctx.fillText('异世界人生 · 随机档案', 64, 80);
    const draw = (text, y, size, maxLines) => {
      ctx.font = `${size}px sans-serif`; let line = '', row = 0;
      for (const ch of text) {
        if (ch === '\n' || ctx.measureText(line + ch).width > 584) { ctx.fillText(line, 64, y + row * size * 1.7); line = ''; row++; if (row >= maxLines - 1) break; }
        if (ch !== '\n') line += ch;
      }
      ctx.fillText(line, 64, y + row * size * 1.7);
    };
    ctx.fillStyle = COLORS.text; draw(e.title, 165, 36, 3); draw(`${w.name} / ${r.origin}`, 370, 22, 3);
    ctx.fillStyle = COLORS.muted; draw('每一次选择，都有回声。\n这是我走过的一生。', 555, 26, 4);
    ctx.fillStyle = COLORS.gold; draw('人生档案', 810, 16, 2);
    this.platform.exportImage(c, message => { this.notice = message; this.render(); });
  }
  atlas() {
    this.text('结局收藏', 28, this.c.text, 14, true);
    const found = this.data.discoveries || [];
    if (!found.length) this.text('书架上还有空位。', 16, this.c.muted);
    for (const w of this.pack.worlds) {
      const keys = new Set(found.filter(d => d.worldId === w.id).map(d => d.endingId));
      if (!keys.size) continue;
      this.text(w.name, 16, this.c.gold);
      const rules = require("src/core/fate.js").getRules(w);
      for (const rule of rules) {
        if (!keys.has(rule.key)) continue;
        const ending = w.endings[rule.endingIndex];
        this.text(ending.title, 20, this.c.text, 8, true);
        this.text(ending.text, 15, this.c.muted);
      }
    }
    this.back();
  }
  history() {
    this.text('前世的回声', 28, this.c.text, 16, true);
    if (!this.data.archives.length) this.text('这里还是空白。去经历你的第一段人生吧。', 16, this.c.muted);
    this.data.archives.forEach(a => this.button(`${(a.endingSnapshot || this.world(a.worldId)?.endings[a.ending] || { title: '旧人生' }).title}`, () => { this.archive = a; this.go('ending'); }, false, this.world(a.worldId)?.name || a.worldId));
    (this.data.suspended || []).forEach(r => this.button(`未完旧人生 · ${r.origin}`, () => { this.journalRun = r; this.go('journal'); })); this.back();
  }
  journal() {
    const r = this.journalRun;
    if (!r) return this.back();
    this.text('人生记录', 28, this.c.text, 12, true);
    this.text(`身份：${r.origin}`, 14, this.c.gold);
    this.background(r);
    this.choices(r);
    if (r.pending) this.text(`已选择：${r.pending.choice}`, 15, this.c.muted);
    if (r === this.data.run) this.button('继续当前人生', () => this.go('story'), true);
    else if (r === this.archive) this.button('返回结局', () => this.go('ending'));
    this.back();
  }
  settings() {
    this.text('按你的节奏阅读', 28, this.c.text, 18, true);
    [['large', '大字号'], ['contrast', '高对比'], ['reduceMotion', '减少动画']].forEach(([key, label]) => this.button(`${label}    ${this.data.settings[key] ? '已开启' : '已关闭'}`, () => { this.data.settings[key] = !this.data.settings[key]; this.persist(); this.render(); }));
    this.button('手动保存', () => { this.notice = this.storage.save(this.data) ? '当前档案已保存。' : this.storage.warning; this.render(); });
    this.text('每次选择自动保存。游戏不发送数据、不需要网络、不含广告或付费。存档仅在此设备；清除应用数据或浏览器缓存会丢失人生记录。', 14, this.c.muted);
    this.text('短剧取材与署名', 18, this.c.gold);
    this.text('本版互动故事重新创作。类型参考包括 GitHub 上的中文网文和微短剧；赛博篇的异常来讯构思参考了赵康鑫（Kayson Zhao）的原创微短剧《回响》。', 14);
    this.text(`内容版本 ${this.pack.revision}${this.pack.fixture ? ' / 测试夹具' : ''}`, 12, this.c.muted); this.back();
  }
}
module.exports = { App };

},
"src/core/game.js":function(module,exports,require){
'use strict';
// Shared by Canvas UI, persistence replay and route acceptance.
const fate = require("src/core/fate.js");
const { hash, STATS, validateWorld } = require("src/core/engine.js");
const STEPS = fate.STEPS;
const eventGraph = require("src/core/event-graph.js");
const birth = require("src/core/birth.js");
const episodes = require("src/core/episode.js");
const clone = x => JSON.parse(JSON.stringify(x));
const costs = { order: 3, stockpile: 4, seal: 4, overdraw: 5, exploit: 4, burn: 5,
  protect: 3, share: 4, defend: 4, keep: 4, negotiate: 4,
  investigate: 3, reveal: 4, audit: 4, train: 3, practice: 4, master: 4 };
const material = new Set(['order', 'stockpile', 'seal', 'overdraw', 'exploit', 'burn']);
const social = new Set(['protect', 'share', 'defend', 'keep', 'negotiate']);
function random(r) {
  let x = r.rng; x ^= x << 13; x ^= x >>> 17; x ^= x << 5;
  r.rng = x >>> 0; return r.rng / 4294967296;
}
function selectEvent(w, r) {
  const graph = eventGraph.compileEventGraph(w);
  if (!r.lifeVersion) { r.eventIndex = eventGraph.selectEvent(graph, r, random); return; }
  const used = new Set(r.ledger.map(l => l.eventIndex));
  if (r.journey) {
    // Side stories use actual, as yet unseen source events, including their A/B dilemmas.
    const pool = graph.cards.filter(c => c.stage.step < r.fate.step && !used.has(c.source_index));
    if (!pool.length) throw Error('支线事件耗尽');
    const person = r.birth.people[r.journey.person];
    r.eventIndex = pool[(r.birth.affinity + hash(`${r.journey.kind}:${person.history}:${person.tie}`) + r.step) % pool.length].source_index;
    return;
  }
  const main = r.ledger.filter(l => !l.journey);
  let pool = eventGraph.getEventPool(graph, { step: r.fate.step, ledger: main });
  const unseen = pool.filter(c => !used.has(c.source_index));
  if (unseen.length) pool = unseen;
  const previous = r.ledger.at(-1)?.action || r.origin;
  const echo = r.episode?.coda ? previous + '/' + r.episode.choices.join('') : previous;
  const affinity = (r.birth.affinity + hash(echo)) % 3;
  const born = pool.filter(c => Math.floor(c.source_index / STEPS) % 3 === affinity);
  if (born.length) pool = born;
  const weights = pool.map(c => r.recent.includes(c.source_index) ? 1 : 4);
  let dice = random(r) * weights.reduce((a, b) => a + b, 0);
  r.eventIndex = (pool.find((c, i) => (dice -= weights[i]) < 0) || pool.at(-1)).source_index;
}
function startRun(w, seed, recent = [], lifeVersion = w.episode ? 4 : 2) {
  validateWorld(w);
  const r = { format: 'fate-v1', worldId: w.id, seed: String(seed), rng: hash(seed) || 1,
    step: 0, phase: 'event', stats: STATS.map(() => 5), ledger: [], recent: recent.slice(-24), ending: null };
  r.origin = w.origins[Math.floor(random(r) * w.origins.length)];
  r.talent = Object.keys(fate.TALENTS)[Math.floor(random(r) * 3)];
  if (lifeVersion) {
    r.lifeVersion = lifeVersion;
    r.birth = birth.generate(w, seed, r.origin, lifeVersion);
    r.stats = r.birth.initialStats.slice();
    r.background = r.birth.background;
    r.people = r.birth.people.map(p => `${p.name}（${p.role}，${p.tie}）：${p.history}。`);
  }
  r.fate = fate.startRun(w, seed, { origin: r.origin, talent: r.talent });
  selectEvent(w, r); return r;
}
function getChoices(w, r) {
  if (r.phase !== 'commitment') return [];
  if (r.journey) return birth.choices(r);
  return fate.getChoices(w, r.fate).map(c => {
    const stat = material.has(c.id) ? 3 : social.has(c.id) ? 2 : 5;
    const cost = costs[c.id] || 0;
    return { ...c, available: r.stats[stat] >= cost, stat, cost,
      context: r.lifeVersion && c.id.startsWith('person') ? r.people[Number(c.id.slice(6))] : r.stats[stat] < cost ? '眼下的你还无力作出这份承诺。' : '面前的人正在等待你的答复。' };
  });
}
function finish(w, r, key, endingIndex, discoveries) {
  r.phase = 'complete';
  r.ending = endingIndex;
  r.endingId = key;
  r.discovery = { worldId: w.id, endingId: key };
  r.endingSnapshot = clone(w.endings[endingIndex]);
  r.memories = clone(discoveries.filter(record => record.worldId === w.id));
  r.eventIndex = null;
  return r;
}
function choose(w, current, option, discoveries = []) {
  if (current.worldId !== w.id || current.phase === 'complete') throw Error('人生已完成或世界不匹配');
  const r = clone(current);
  if (r.phase === 'episode') {
    if (r.lifeVersion >= 4 && [0, 1].includes(option)) {
      const index = STATS.indexOf(episodes.currentScene(w, r).attributes[option]);
      r.stats[index] = Math.min(20, r.stats[index] + 2);
    }
    episodes.advance(w, r, option);
    if (r.phase === 'event') selectEvent(w, r);
    return r;
  }
  if (r.phase === 'event') {
    if (![0, 1].includes(option)) throw Error('请先选择事件 A/B');
    const e = eventGraph.compileEventGraph(w).cards[r.eventIndex];
    const choice = e.choices[option];
    r.stats = eventGraph.applyEffects(r.stats, choice);
    r.pending = { step: r.step, eventIndex: r.eventIndex, event_id: e.event_id, title: e.title, choice: choice.text, option, payoff_tags: choice.payoff_tags };
    r.phase = 'commitment'; return r;
  }
  const c = getChoices(w, r).find(c => c.id === option);
  if (!c || !c.available) throw Error('当前状态无法履行这项承诺');
  r.stats[c.stat] -= c.cost;
  const journey = r.journey ? { ...r.journey } : null;
  if (!journey) r.fate = fate.choose(w, r.fate, c.id, r.eventIndex);
  r.ledger.push({ ...r.pending, ...(journey ? { journey } : {}), action: c.id, commitment: c.text, cost: c.cost, stat: c.stat });
  delete r.pending; r.step++; r.phase = 'event';
  if (journey) {
    const continued = journey.depth === 0 && c.id === birth.choices(current)[0].id;
    const person = r.birth.people[journey.person];
    r.people[journey.person] = `${person.name}（${person.role}）：${person.history}；与你共同经历「${r.ledger.at(-1).title}」，${c.text}。`;
    if (c.id === 'journey:settle') {
      delete r.journey;
      const ending = fate.getRules(w).find(rule => rule.key === 'public.survive');
      finish(w, r, ending.key, ending.endingIndex, discoveries);
      r.endingSnapshot.text = '你把钥匙挂在门边，从此与' + person.name + '在这座院子里过日子。往后的消息，有时随来客到，有时隔了一季才写进信里。\n\n' + r.endingSnapshot.text;
      return r;
    }
    if (continued) r.journey.depth++;
    else delete r.journey;
  } else if (r.lifeVersion && [3, 7, 12].includes(r.fate.step)) {
    const last = r.ledger.at(-1);
    const key = hash(`${r.seed}:${r.origin}:${c.id}:${last.option}:${r.fate.step}`);
    // Decisions and birth jointly open different detours; declining the first
    // commitment closes that detour, while participating adds a second event.
    const focus = r.fate.ledger[1]?.action;
    const used = new Set(r.ledger.map(l => l.eventIndex));
    const spare = eventGraph.compileEventGraph(w).cards.filter(card => card.stage.step < r.fate.step && !used.has(card.source_index)).length;
    const person = r.fate.step === 7 && focus ? Number(focus.slice(6)) : key % r.birth.people.length;
    const routes = [...r.birth.routes, r.birth.people[person].route].filter(route => route !== r.birth.limit.route);
    if (!routes.length) routes.push(r.birth.limit.route === 'home' ? 'letters' : 'home');
    if (key % 3 !== 0 && spare >= 2) r.journey = { kind: routes[key % routes.length], person, depth: 0 };
  }
  if (r.fate.step === STEPS && !r.journey) {
    const result = fate.evaluate(w, r.fate, discoveries);
    return finish(w, r, result.endingId, result.endingIndex, discoveries);
  } else {
    selectEvent(w, r);
    if (r.lifeVersion >= 3 && !r.episode && !journey && [2, 6].includes(r.fate.step) &&
        hash(r.seed + ':' + r.birth.limit.axis + ':' + c.id + ':' + r.ledger[r.step - 1].option) % 3 !== 0) {
      r.episode = { anchor: r.step, title: w.episode.title, choices: [], entries: [] };
      r.phase = 'episode';
    }
  }
  return r;
}
function restore(w, saved) {
  if (saved.lifeVersion !== undefined && ![2, 3, 4].includes(saved.lifeVersion)) throw Error('未知人生版本');
  let r = startRun(w, saved.seed, saved.recent, saved.lifeVersion || 0);
  function restoreEpisode() {
    if (r.phase !== 'episode') return;
    if (!saved.episode || saved.episode.anchor !== r.step || saved.episode.title !== w.episode.title) throw Error('短剧内容已变更');
    for (const option of saved.episode.choices) r = choose(w, r, option);
  }
  for (const l of saved.ledger) {
    restoreEpisode();
    r = choose(w, r, l.option); r = choose(w, r, l.action, saved.memories || []);
  }
  restoreEpisode();
  if (saved.pending) r = choose(w, r, saved.pending.option);
  return r;
}
function payoffs(r) {
  return r.ledger.slice(-2).map(l => ({ text: `「${l.title}」：${l.choice}。后来，你决定：${l.commitment}。` }));
}
module.exports = { STEPS, STATS, hash, startRun, choose, getChoices, restore, payoffs, fate };

},
"src/core/fate.js":function(module,exports,require){
'use strict';

/**
 * 正式叙事 API（不依赖 engine.js）：
 * startRun(world, seed, { origin, talent }) -> run
 * getChoices(world, run) -> [{ id, text }]；choose(world, run, actionId) -> 新 run
 * evaluate(world, run, discoveries = []) -> { ending, endingId, endingIndex,
 *   state, hints, rules, discovery }。未完成时 ending 为 null。
 * getWitnesses(world) -> 每结局 { seed, options, earlyChoices, prerequisites, run }。
 * witness.actions 是语义选择序列，options 是开局身份/天赋；交给 replay 重放。
 *
 * 世界沿用 {id,name,origins,events,endings}。结局建议显式填写 fateKey，取值见
 * getRules(world)。未标记时严格按 6 公共、8 身份、5 关系、3/4 秘密排列。
 * 身份结局对应 origins 前八项；默认人物可用 world.fate.characters 覆盖六个名字。
 * events 可在叙事选择记录中通过 choose 的第四参数 eventIndex 关联具体事件。
 * UI 应展示 getChoices 的语义选项：旧引擎的数字 option/code 不能转换为本规则。
 * seed 仅保存复现信息，不用于分配身份、人物、规则或结局；身份/天赋由玩家选择。
 * discoveries 格式 [{worldId, endingId}]，可直接保存已完成结果的 discovery。
 * 秘密只认可同世界、已知结局的历史记录；不读取当前 run 的伪造 flags/stats。
 */
const STEPS = 12;
const ROLES = ['同行者', '导师', '对手', '家人', '受托者', '记录者'];
const CAST = {
  w1: ['沈照', '陆衡', '谢无尘', '阿蘅', '小砚', '闻灯'],
  w2: ['林汐', '顾舟', '韩峥', '林穗', '小满', '闻溪'],
  w3: ['零七', '许镜', '祁铬', '白栀', '阿芯', '录者'],
  w4: ['艾琳', '梅芙', '奥伦', '莉亚', '诺亚', '伊文'],
  w5: ['裴照', '温衡', '谢策', '阿宁', '小禾', '司简'],
  w6: ['许昼', '周衡', '秦夜', '许晴', '小纸', '记名人'],
  w7: ['叶航', '沈弦', '罗隼', '叶星', '小泊', '纪光'],
  w8: ['青枝', '榕翁', '赤牙', '小苔', '白团', '石语']
};
const TALENTS = {
  empathy: { name: '共感', burden: '承受他人的痛苦', cost: 2 },
  insight: { name: '洞见', burden: '真相侵蚀睡眠', cost: 2 },
  resolve: { name: '坚忍', burden: '透支身体', cost: 3 }
};
const PUBLIC = ['rescue', 'rule', 'exile', 'truth', 'sacrifice', 'survive'];
const PUBLIC_NAMES = ['共同生还', '秩序执掌', '带伤远行', '公开真相', '以身偿还', '余生守望'];
// 每项只计一次实际行动；第一、二幕均须提供支持，第三幕不能凭空建立方向。
const PUBLIC_SUPPORT = {
  rescue: [[0, 'protect'], [3, 'commons'], [4, 'share'], [5, 'defend'], [7, 'negotiate']],
  rule: [[0, 'order'], [3, 'council'], [4, 'stockpile'], [5, 'betray'], [7, 'seal']],
  exile: [[2, 'ordinary'], [3, 'commons'], [5, 'abandon'], [6, 'renounce'], [7, 'negotiate']],
  truth: [[0, 'investigate'], [3, 'archive'], [4, 'reveal'], [7, 'audit']],
  sacrifice: [[2, 'train'], [5, 'defend'], [6, 'practice'], [6, 'overdraw']],
  survive: [[2, 'ordinary'], [3, 'commons'], [4, 'share'], [6, 'renounce'], [7, 'negotiate']]
};
const PUBLIC_COMPARISON = '公共结算：每方向至少命中两项不同早期行动，且第一、二幕各有支持；优先兑现第三幕声明的已建立方向，否则按命中数降序；同分按共同生还、秩序执掌、带伤远行、公开真相、以身偿还、余生守望顺序。无方向建立才兜底余生守望。身份、关系、秘密满足原条件时优先，不满足则按此公共比较结算。';
function comparePublic(world, state) {
  const directions = PUBLIC.map(key => {
    const hits = PUBLIC_SUPPORT[key].filter(([step, action]) => state.decisions[step] === action)
      .map(([step, action]) => ({ step, act: Math.floor(step / 4) + 1, action, text: choicesAt(world, step).find(c => c.id === action).text }));
    return { key: `public.${key}`, hits, score: hits.length,
      established: hits.some(h => h.act === 1) && hits.some(h => h.act === 2),
      declared: state.decisions[8] === key };
  });
  const ranked = directions.filter(d => d.established).sort((a, b) => Number(b.declared) - Number(a.declared) || b.score - a.score || PUBLIC.indexOf(a.key.slice(7)) - PUBLIC.indexOf(b.key.slice(7)));
  return { text: PUBLIC_COMPARISON, directions, ranking: ranked.map(d => d.key),
    selected: ranked[0]?.key || 'public.survive', fallback: ranked.length === 0 };
}
const SECRET = ['reconcile', 'inherit', 'liberate', 'cycle'];
const copy = value => JSON.parse(JSON.stringify(value));
function assertWorld(world) {
  if (!world || typeof world.id !== 'string' || !Array.isArray(world.origins) || world.origins.length < 8)
    throw new Error('叙事世界需要 id 和至少八个身份');
  if (!Array.isArray(world.endings) || ![22, 23].includes(world.endings.length))
    throw new Error('需要 6 公共、8 身份、5 关系、3 或 4 秘密结局（22/23 个）');
  if (world.fate?.characters && (world.fate.characters.length !== 6 || !world.fate.characters.every(n => typeof n === 'string' && n.trim())))
    throw new Error('characters 必须包含六个非空人物名字');
}
function characters(world) {
  return (world.fate?.characters || CAST[world.id] || ['照夜', '知衡', '逐锋', '归禾', '小灯', '拾页']).map((name, i) => ({ id: `person${i}`, name, role: ROLES[i] }));
}
const item = (id, text) => ({ id, text });
function choicesAt(world, step) {
  const circles = world.factions || { commons: '邻里小屋', council: '值日间', archive: '手记室' };
  const menus = [
    [item('protect', '扶住门边的人'), item('order', '接过值日簿'), item('investigate', '蹲下查看地上的印记')],
    characters(world).map(c => item(c.id, `在${c.name}旁边坐下`)),
    [item('train', '试一遍师傅留下的手法'), item('ordinary', '拿出自己用惯的工具')],
    [item('commons', `去${circles.commons}敲门`), item('council', `去${circles.council}换班`), item('archive', `向${circles.archive}借一本手记`)],
    [item('share', '把自己的那份分出来'), item('stockpile', '把余下的东西收进柜里'), item('reveal', '把抄本放到桌上')],
    [item('defend', '和同行者一起留下'), item('abandon', '独自从侧门离开'), item('betray', '把约定的地点告诉来客')],
    [item('practice', '拿起昨日未做完的活'), item('renounce', '放下工具去散步'), item('overdraw', '在灯下再做一遍')],
    [item('audit', '和众人一起翻阅手记'), item('seal', '合上匣盖，收好钥匙'), item('negotiate', '约两边的人一同吃饭')],
    [item('rescue', '去找尚未归来的邻人'), item('rule', '接下明早的值班牌'), item('exile', '把旧地图装进行囊'), item('truth', '带上手记赴约'), item('sacrifice', '替疲惫的伙伴守夜'), item('survive', '把窗前的灯点亮')],
    [item('keep', '回到约好的地方'), item('release', '在路口与对方道别'), item('exploit', '请同行者替你接班')],
    [item('master', '亲手修好那件老物'), item('rest', '关灯睡一觉'), item('burn', '把留给自己的材料也拿出来')],
    [item('fulfill', '照先前的约定赴约'), item('identity', '打开随身的工具包'), item('relationship', '去找那位老朋友'), ...SECRET.slice(0, world.endings.length - 19).map(id => item(id, { reconcile: '拼好那两张旧纸', inherit: '打开没有署名的匣子', liberate: '把系了多年的绳结解开', cycle: '与记事人交换手记' }[id]))]
  ];
  return menus[step] || [];
}
function startRun(world, seed, options = {}) {
  assertWorld(world);
  const origin = options.origin ?? world.origins[0];
  const talent = options.talent ?? 'empathy';
  if (!world.origins.includes(origin) || !TALENTS[talent]) throw new Error('未知身份或天赋');
  return { worldId: world.id, seed: String(seed), origin, talent, step: 0, ledger: [] };
}
function getChoices(world, run) {
  validateRun(world, run);
  return choicesAt(world, run.step);
}
function validateRun(world, run) {
  assertWorld(world);
  if (!run || run.worldId !== world.id || !world.origins.includes(run.origin) || !TALENTS[run.talent] || !Array.isArray(run.ledger) || run.step !== run.ledger.length || run.step > STEPS)
    throw new Error('无效叙事记录');
  run.ledger.forEach((entry, step) => {
    if (entry.step !== step || !choicesAt(world, step).some(c => c.id === entry.action)) throw new Error('叙事记录顺序或语义选择无效');
    if (entry.eventIndex !== null && (!Number.isInteger(entry.eventIndex) || !world.events?.[entry.eventIndex])) throw new Error('事件索引无效');
  });
}
function choose(world, run, action, eventIndex = null) {
  validateRun(world, run);
  if (!choicesAt(world, run.step).some(c => c.id === action)) throw new Error('当前节点不支持此语义选择');
  if (eventIndex !== null && (!Number.isInteger(eventIndex) || !world.events?.[eventIndex])) throw new Error('事件索引无效');
  const next = copy(run);
  next.ledger.push({ step: run.step, action, eventIndex });
  next.step++;
  return next;
}
function replay(world, seed, actions, options = {}) {
  return actions.reduce((run, action) => choose(world, run, action), startRun(world, seed, options));
}
function derive(world, run) {
  const state = { decisions: {}, relationships: Object.fromEntries(characters(world).map(c => [c.id, { ...c, trust: 0, promise: 'none' }])), factions: { commons: 0, council: 0, archive: 0 }, evidence: 0, supplies: 0, burden: 0, skill: 0, causes: [], talent: { id: run.talent, ...TALENTS[run.talent] } };
  let focus;
  for (const entry of run.ledger) {
    const a = entry.action;
    const before = { factions: copy(state.factions), evidence: state.evidence, supplies: state.supplies, burden: state.burden, skill: state.skill };
    state.decisions[entry.step] = a;
    if (entry.step === 1) { focus = a; state.focus = a; state.relationships[a].trust = 1; state.relationships[a].promise = 'made'; }
    if (a === 'protect' || a === 'share') { state.factions.commons += 2; state.supplies += 1; }
    if (a === 'order' || a === 'stockpile') { state.factions.council += 2; state.supplies += 2; }
    if (a === 'investigate' || a === 'reveal' || a === 'audit') { state.evidence += 1; state.factions.archive += 2; }
    if (entry.step === 3) state.factions[a] += 2;
    if (a === 'seal') { state.factions.council += 2; state.evidence = Math.max(0, state.evidence - 1); }
    if (a === 'negotiate') { state.factions.commons++; state.factions.council++; }
    if (a === 'train' || a === 'practice') { state.skill++; state.burden += state.talent.cost; }
    if (a === 'overdraw') { state.burden += 6; state.supplies += 3; }
    if (a === 'master') { state.skill++; state.burden = Math.max(0, state.burden - 2); }
    if (a === 'rest' || a === 'renounce') state.burden = Math.max(0, state.burden - 3);
    if (a === 'burn') { state.burden += 8; state.supplies += 4; }
    if (a === 'defend' || a === 'keep') { state.relationships[focus].trust += 2; state.relationships[focus].promise = 'kept'; state.burden++; }
    if (a === 'abandon' || a === 'betray' || a === 'exploit') { state.relationships[focus].trust -= 3; state.relationships[focus].promise = 'broken'; }
    if (a === 'betray') state.factions.council += 2;
    if (a === 'exploit') state.burden = Math.max(0, state.burden - 4);
    if (a === 'release') state.relationships[focus].promise = 'released';
    const label = choicesAt(world, entry.step).find(c => c.id === a).text;
    state.causes.push({ step: entry.step, act: Math.floor(entry.step / 4) + 1, eventIndex: entry.eventIndex, event: entry.eventIndex === null ? null : world.events[entry.eventIndex].title, action: a, text: label, before, after: { factions: copy(state.factions), evidence: state.evidence, supplies: state.supplies, burden: state.burden, skill: state.skill }, relationship: focus ? copy(state.relationships[focus]) : null });
  }
  return state;
}
const requirement = (id, text, check, deadline = 11) => ({ id, text, check, deadline });
function definitions(world) {
  const d = (step, action, text) => requirement(`decision:${step}:${action}`, text, s => s.decisions[step] === action, step);
  const enough = (key, n, text) => requirement(`${key}:${n}`, text, s => s[key] >= n);
  const bonded = requirement('bond', '第一幕结识的人，在第二幕获你保护，第三幕仍守约（信任至少 5）', s => s.focus && s.relationships[s.focus].trust >= 5 && s.relationships[s.focus].promise === 'kept', 9);
  const memory = key => requirement(`memory:${key}`, `前局发现「${key}」`, (s, r, h) => h.has(key));
  const final = key => d(11, key, `终幕选择「${choicesAt(world, 11).find(c => c.id === key).text}」`);
  const rules = PUBLIC.map((key, i) => ({ key: `public.${key}`, category: 'public', priority: 10, requirements: [
    requirement(`public-support:${key}`, `支持项（每项一分）：${PUBLIC_SUPPORT[key].map(([step, action]) => `第${step + 1}节点「${choicesAt(world, step).find(c => c.id === action).text}」`).join('、')}；第一、二幕各至少一项${key === 'survive' ? '，或所有公共方向均未建立时兜底' : ''}`, s => {
      const comparison = s.publicComparison;
      return comparison.directions[i].established || (key === 'survive' && comparison.fallback);
    }, 7),
    requirement(`public-ranking:${key}`, PUBLIC_COMPARISON, s => s.publicComparison.selected === `public.${key}`)
  ] }));
  world.origins.slice(0, 8).forEach((origin, i) => rules.push({ key: `identity.${i + 1}`, category: 'identity', priority: 30, requirements: [requirement('origin', `以「${origin}」开局`, (s, r) => r.origin === origin, -1), d(2, 'train', '第一幕研习身份技艺'), d(6, 'practice', '第二幕继续研习'), d(10, 'master', '第三幕整合技艺'), enough('skill', 3, '身份技艺达到 3'), requirement('allegiance', '所属阵营支持至少 4，技艺有实际服务对象', s => s.factions[s.decisions[3]] >= 4), requirement('burden', '天赋负担不超过 6', s => s.burden <= 6), final('identity')] }));
  characters(world).slice(0, 5).forEach((person, i) => rules.push({ key: `relationship.${i + 1}`, category: 'relationship', priority: 40, requirements: [d(1, person.id, `第一幕与${person.name}相识`), bonded, final('relationship')] }));
  const secrets = [
    [memory('public.rescue'), memory('public.rule'), d(0, 'investigate', '第一幕调查冲突根源'), d(7, 'negotiate', '第二幕促成阵营协商'), enough('evidence', 2, '收集至少两份证据')],
    [memory('identity.1'), memory('relationship.1'), d(2, 'train', '第一幕重拾技艺'), d(6, 'practice', '第二幕继续研习'), bonded],
    [memory('public.sacrifice'), memory('relationship.2'), bonded, d(6, 'renounce', '第二幕停止透支'), d(10, 'rest', '第三幕接受能力限制')],
    [memory('secret.reconcile'), memory('secret.inherit'), memory('secret.liberate'), d(1, 'person5', '第一幕结识记录者'), bonded, d(0, 'investigate', '第一幕调查轮回'), d(7, 'audit', '第二幕公开轮回证据')]
  ];
  SECRET.slice(0, world.endings.length - 19).forEach((key, i) => rules.push({ key: `secret.${key}`, category: 'secret', priority: 50, requirements: [...secrets[i], final(key)] }));
  const explicit = world.endings.some(e => e.fateKey !== undefined);
  if (explicit && (world.endings.some(e => !rules.some(r => r.key === e.fateKey)) || new Set(world.endings.map(e => e.fateKey)).size !== rules.length)) throw new Error('fateKey 必须完整、唯一并匹配全部叙事规则');
  return rules.map((r, i) => ({ ...r, endingIndex: explicit ? world.endings.findIndex(e => e.fateKey === r.key) : i }));
}
function getRules(world) {
  assertWorld(world);
  return definitions(world).map(r => ({ ...r, requirements: r.requirements.map(({ check, ...rest }) => rest) }));
}
function evaluate(world, run, discoveries = []) {
  validateRun(world, run);
  if (!Array.isArray(discoveries)) throw new Error('历史发现必须是数组');
  const definitionsForWorld = definitions(world);
  const known = new Set(definitionsForWorld.map(r => r.key));
  const history = new Set(discoveries.filter(x => x && x.worldId === world.id && known.has(x.endingId)).map(x => x.endingId));
  const state = derive(world, run);
  state.publicComparison = comparePublic(world, state);
  const comparisonText = `${PUBLIC_COMPARISON} 当前命中：${state.publicComparison.directions.map((d, i) => `${PUBLIC_NAMES[i]} ${d.score} 项（${d.established ? '已建立' : '未跨幕建立'}）`).join('；')}。公共排名：${state.publicComparison.ranking.join(' > ') || '无'}；${state.publicComparison.fallback ? '兜底' : '获选'} ${state.publicComparison.selected}。`;
  if (run.step === STEPS) state.causes[state.causes.length - 1].text += `；${comparisonText}`;
  const rules = definitionsForWorld.map(rule => ({ key: rule.key, category: rule.category, priority: rule.priority, endingIndex: rule.endingIndex, requirements: rule.requirements.map(req => ({ id: req.id, text: req.text, met: Boolean(req.check(state, run, history)), deadline: req.deadline })) }));
  for (const rule of rules.filter(r => r.category === 'public')) rule.requirements[1].text = comparisonText;
  for (const rule of rules) rule.eligible = rule.requirements.every(req => req.met);
  // 明确优先级：秘密 > 关系 > 身份 > 公共比较的唯一获选方向。
  const winner = run.step === STEPS ? rules.filter(r => r.eligible).sort((a, b) => b.priority - a.priority)[0] : null;
  const hints = rules.map(rule => ({ endingId: rule.key, title: world.endings[rule.endingIndex].title, ready: rule.eligible, missing: rule.requirements.filter(req => !req.met).map(req => ({ ...req, status: req.id.startsWith('memory:') ? 'previous-run' : req.deadline < run.step ? 'missed' : 'possible' })) }));
  return { complete: run.step === STEPS, ending: winner ? world.endings[winner.endingIndex] : null, endingId: winner?.key ?? null, endingIndex: winner?.endingIndex ?? null, state, rules, hints, discovery: winner ? { worldId: world.id, endingId: winner.key } : null };
}
function getWitnesses(world) {
  assertWorld(world);
  return definitions(world).map(rule => {
    const actions = ['protect', 'person0', 'train', 'commons', 'share', 'defend', 'practice', 'negotiate', 'rescue', 'keep', 'master', 'fulfill'];
    const options = { origin: world.origins[0], talent: 'empathy' };
    if (rule.category === 'identity') { options.origin = world.origins[Number(rule.key.split('.')[1]) - 1]; actions[11] = 'identity'; }
    if (rule.category === 'relationship') { actions[1] = `person${Number(rule.key.split('.')[1]) - 1}`; actions[11] = 'relationship'; }
    if (rule.key === 'public.rule') { actions[0] = 'order'; actions[3] = 'council'; actions[4] = 'stockpile'; actions[7] = 'seal'; actions[8] = 'rule'; }
    if (rule.key === 'public.exile') { actions[8] = 'exile'; actions[9] = 'release'; }
    if (rule.key === 'public.truth') { actions[0] = 'investigate'; actions[4] = 'reveal'; actions[7] = 'audit'; actions[8] = 'truth'; }
    if (rule.key === 'public.sacrifice') { actions[8] = 'sacrifice'; actions[10] = 'burn'; }
    if (rule.key === 'public.survive') actions[8] = 'survive';
    if (rule.category === 'secret') actions[11] = rule.key.slice(7);
    if (rule.key === 'secret.reconcile') { actions[0] = 'investigate'; actions[4] = 'reveal'; }
    if (rule.key === 'secret.liberate') { actions[6] = 'renounce'; actions[10] = 'rest'; }
    if (rule.key === 'secret.cycle') { actions[0] = 'investigate'; actions[1] = 'person5'; actions[7] = 'audit'; }
    const prerequisites = rule.requirements.filter(r => r.id.startsWith('memory:')).map(r => ({ worldId: world.id, endingId: r.id.slice(7) }));
    const seed = `witness:${world.id}:${rule.key}`;
    const run = replay(world, seed, actions, options);
    const result = evaluate(world, run, prerequisites);
    if (result.endingId !== rule.key) throw new Error(`witness 未通过生产判定：${rule.key} -> ${result.endingId}`);
    return { endingId: rule.key, endingIndex: rule.endingIndex, seed, options, actions, earlyChoices: actions.slice(0, 4), prerequisites, run };
  });
}
module.exports = { STEPS, TALENTS, characters, startRun, getChoices, choose, replay, evaluate, getRules, getWitnesses };

},
"src/core/engine.js":function(module,exports,require){
'use strict';

const STEPS = 12;
const STATS = ['命势', '实力', '羁绊', '资源', '声望', '理智'];
function validateWorld(w) {
  const fail = msg => { throw new Error(`${w?.id || '世界'}: ${msg}`); };
  const str = x => typeof x === 'string' && x.trim().length > 0;
  if (!w || !str(w.id) || !str(w.name)) fail('id 和 name 必须是非空字符串');
  if (!Array.isArray(w.origins) || !w.origins.length || !w.origins.every(str)) fail('origins 必须包含身份字符串');
  if (!Array.isArray(w.events) || !w.events.length || w.events.length % STEPS) fail('events 数量必须为 12 的正整数倍');
  w.events.forEach((e, i) => { if (!e || !['title', 'text', 'a', 'b'].every(k => str(e[k]))) fail(`events[${i}] 的 title/text/a/b 必须是非空字符串`); });
  if (!Array.isArray(w.endings) || !w.endings.length || w.endings.length > 4096) fail('endings 数量应为 1–4096');
  w.endings.forEach((e, i) => { if (!e || !['title', 'text', 'hint'].every(k => str(e[k]))) fail(`endings[${i}] 的 title/text/hint 必须是非空字符串`); });
  return w;
}
function hash(text) {
  let h = 2166136261;
  for (const c of String(text)) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return h >>> 0;
}
function random(run) {
  let x = run.rng;
  x ^= x << 13; x ^= x >>> 17; x ^= x << 5;
  run.rng = x >>> 0;
  return run.rng / 4294967296;
}
function routeForEnding(index, count) {
  if (!Number.isInteger(index) || index < 0 || index >= count || count < 1 || count > 4096) throw new Error('无效结局索引');
  return Math.ceil(index * 4096 / count).toString(2).padStart(STEPS, '0').split('').map(Number);
}
function endingIndex(code, count) { return Math.floor(code * count / 4096); }
function startRun(world, seed, recent = []) {
  validateWorld(world);
  const run = { worldId: world.id, seed: String(seed), rng: hash(seed) || 1, origin: '', step: 0, code: 0, stats: STATS.map(() => 5), flags: {}, ledger: [], eventIndex: null, ending: null, recent: recent.slice(-24) };
  run.origin = world.origins[Math.floor(random(run) * world.origins.length)];
  selectEvent(world, run);
  return run;
}
function selectEvent(world, run) {
  const groups = world.events.length / STEPS;
  // 同位置互换；第 3 节点起根据两步前的持久旗标筛选路线。
  const affinity = run.step >= 2 ? run.flags[`choice${run.step - 2}`] : null;
  let pool = Array.from({ length: groups }, (_, g) => g).filter(g => affinity === null || g % 2 === affinity);
  if (!pool.length) pool = Array.from({ length: groups }, (_, g) => g);
  const weights = pool.map(g => run.recent.includes(g * STEPS + run.step) ? 1 : 4);
  let dice = random(run) * weights.reduce((a, b) => a + b, 0);
  let pick = pool.length - 1;
  for (let i = 0; i < pool.length; i++) { dice -= weights[i]; if (dice < 0) { pick = i; break; } }
  run.eventIndex = pool[pick] * STEPS + run.step;
}
function payoffs(run) {
  return run.ledger.filter(item => run.step > item.step && run.step <= item.step + 2).map(item => ({
    step: item.step,
    text: `第 ${item.step + 1} 节点「${item.title}」中，你选择了「${item.choice}」。${run.step === item.step + 1 ? '这笔命运印记仍影响着你的状态。' : `这次选择以${item.option === 0 ? 'A' : 'B'}路线印记参与了本节点的事件筛选。`}`
  }));
}
function choose(world, current, option) {
  if (current.worldId !== world.id || current.step >= STEPS || ![0, 1].includes(option)) throw new Error('无法执行该选择');
  const run = JSON.parse(JSON.stringify(current));
  const e = world.events[run.eventIndex];
  const plus = option === 0 ? [0, 2, 4] : [1, 3, 5];
  const minus = option === 0 ? [1, 3, 5] : [0, 2, 4];
  plus.forEach(i => { run.stats[i] = Math.min(20, run.stats[i] + 2); });
  minus.forEach(i => { run.stats[i] = Math.max(0, run.stats[i] - 1); });
  run.ledger.push({ step: run.step, eventIndex: run.eventIndex, title: e.title, choice: option === 0 ? e.a : e.b, option });
  run.flags[`choice${run.step}`] = option;
  run.code = run.code * 2 + option;
  run.step++;
  if (run.step === STEPS) { run.ending = endingIndex(run.code, world.endings.length); run.eventIndex = null; }
  else selectEvent(world, run);
  return run;
}
function replay(world, seed, options, recent = []) {
  return options.reduce((r, o) => choose(world, r, o), startRun(world, seed, recent));
}
module.exports = { STEPS, STATS, hash, validateWorld, startRun, choose, payoffs, replay, routeForEnding, endingIndex };

},
"src/core/event-graph.js":function(module,exports,require){
'use strict';

const { STEPS, STATS } = require("src/core/engine.js");
const cache = new WeakMap();
const nonempty = x => typeof x === 'string' && x.trim().length > 0;
const deltas = option => STATS.map((_, i) => i % 2 === option ? 4 : -1);
function freeze(value) {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

// Compile only the event contract: small fixtures need neither origins nor endings.
// Source objects are immutable inputs for the lifetime of a loaded content pack.
function compileEventGraph(world) {
  if (cache.has(world)) return cache.get(world);
  if (!world || !nonempty(world.id) || !Array.isArray(world.events) ||
      !world.events.length || world.events.length % STEPS) throw Error('事件图需要世界 id 和 12 的正整数倍事件');
  const groups = world.events.length / STEPS;
  const ids = world.events.map((e, i) => e?.event_id ?? `${world.id}:event:${String(i + 1).padStart(4, '0')}`);
  const layers = Array.from({ length: STEPS }, (_, step) => ids.filter((_, i) => i % STEPS === step));
  const cards = world.events.map((e, index) => {
    if (!e || !['title', 'text', 'a', 'b'].every(k => nonempty(e[k]))) throw Error(`${world.id}: events[${index}] 文案无效`);
    const step = index % STEPS;
    const route = step < 2 || groups === 1 ? null : { ledger_step: step - 2, option: Math.floor(index / STEPS) % 2 };
    return {
      event_id: ids[index], source_index: index, title: e.title, text: e.text,
      stage: { step, act: Math.floor(step / 4) + 1 },
      entry_conditions: { step, route },
      choices: [e.a, e.b].map((text, option) => ({
        choice_id: option === 0 ? 'A' : 'B', option, text,
        effects: { stats: deltas(option), min: 0, max: 20 },
        next_events: step === STEPS - 1 ? [] : layers[step + 1].slice(),
        payoff_tags: ['stats', ...(step < STEPS - 2 ? ['route:two-steps-later'] : ['final-ledger'])]
      })),
      terminal: step === STEPS - 1,
      content_rating: { status: 'pending_editorial_review', rating: null },
      test_cases: [0, 1].map(option => ({ option, input_stats: STATS.map(() => 5),
        expected_stats: deltas(option).map(n => 5 + n),
        entry: { step, prior_option: route?.option ?? null }, terminal: step === STEPS - 1 }))
    };
  });
  const graph = { schema_version: 1, world_id: world.id, steps: STEPS, cards, entry_events: layers[0] };
  validateEventGraph(graph);
  freeze(graph);
  cache.set(world, graph);
  return graph;
}

function admitted(card, step, priorOption) {
  const c = card.entry_conditions;
  return c.step === step && (!c.route || c.route.option === priorOption);
}

// Validates the compiled contract independently, including edited/serialized cards.
function validateEventGraph(graph) {
  const fail = message => { throw Error(`${graph?.world_id || '事件图'}: ${message}`); };
  if (graph?.schema_version !== 1 || graph.steps !== STEPS || !Array.isArray(graph.cards) || !graph.cards.length) fail('事件图结构无效');
  const byId = new Map();
  const indices = new Set();
  for (const [index, card] of graph.cards.entries()) {
    if (!nonempty(card.event_id) || byId.has(card.event_id)) fail('重复标识或无效 event_id');
    byId.set(card.event_id, card);
    if (card.source_index !== index || indices.has(card.source_index)) fail('重复或无效源索引');
    indices.add(card.source_index);
    const step = card.stage?.step, conditions = card.entry_conditions;
    if (!Number.isInteger(step) || step < 0 || step >= STEPS || card.stage.act !== Math.floor(step / 4) + 1) fail('阶段无效');
    if (conditions?.step !== step || (conditions.route && (step < 2 || conditions.route.ledger_step !== step - 2 || ![0, 1].includes(conditions.route.option)))) fail('准入条件无效');
    if (card.terminal !== (step === STEPS - 1)) fail('终点阶段无效');
    if (!Array.isArray(card.choices) || card.choices.length !== 2) fail('需要 A/B 两项选择');
    card.choices.forEach((choice, option) => {
      if (choice.option !== option || choice.choice_id !== ['A', 'B'][option] || !nonempty(choice.text)) fail('重复或无效 choice_id');
      if (JSON.stringify(choice.effects?.stats) !== JSON.stringify(deltas(option)) || choice.effects.min !== 0 || choice.effects.max !== 20) fail('效果必须保持 A/B +4/-1 契约');
      if (!Array.isArray(choice.next_events) || new Set(choice.next_events).size !== choice.next_events.length) fail('重复或无效边');
      if (!Array.isArray(choice.payoff_tags) || !choice.payoff_tags.length || !choice.payoff_tags.every(nonempty)) fail('payoff_tags 无效');
    });
    if (card.content_rating?.status !== 'pending_editorial_review' || card.content_rating.rating !== null) fail('内容评级必须待编辑审校');
    if (!Array.isArray(card.test_cases) || card.test_cases.length !== 2) fail('test_cases 无效');
    card.test_cases.forEach((tc, option) => {
      if (tc.option !== option || !Array.isArray(tc.input_stats) || tc.input_stats.length !== STATS.length ||
          !tc.input_stats.every(Number.isFinite) || JSON.stringify(applyEffects(tc.input_stats, card.choices[option])) !== JSON.stringify(tc.expected_stats) ||
          tc.entry?.step !== step || tc.entry.prior_option !== (conditions.route?.option ?? null) || tc.terminal !== card.terminal) fail('test_cases 与事件规则不一致');
    });
  }
  const roots = graph.entry_events;
  if (!Array.isArray(roots) || !roots.length || new Set(roots).size !== roots.length || roots.some(id => byId.get(id)?.stage.step !== 0)) fail('入口无效');
  const reachable = new Set(roots);
  for (let step = 0; step < STEPS; step++) {
    for (const card of graph.cards.filter(c => c.stage.step === step)) {
      for (const choice of card.choices) {
        const targets = choice.next_events.map(id => {
          const target = byId.get(id);
          if (!target) fail(`无效边 ${card.event_id} -> ${id}`);
          if (target.stage.act < card.stage.act) fail(`跨幕回退 ${card.event_id} -> ${id}`);
          if (target.stage.step !== step + 1) fail(`边必须进入下一节点 ${card.event_id} -> ${id}`);
          return target;
        });
        if (card.terminal ? targets.length : !targets.length) fail(`死路或终点出边 ${card.event_id}`);
        // At the next node the route reads the preceding choice, not this one.
        if (!card.terminal && [0, 1].some(prior => !targets.some(c => admitted(c, step + 1, prior)))) fail(`条件死路 ${card.event_id}`);
        if (reachable.has(card.event_id)) targets.forEach(c => reachable.add(c.event_id));
      }
    }
  }
  if (reachable.size !== graph.cards.length) fail('存在不可达事件');
  return graph;
}

function getEventPool(graph, run) {
  const previous = run.ledger[run.step - 1];
  const ids = previous ? graph.cards[previous.eventIndex]?.choices[previous.option]?.next_events : graph.entry_events;
  if (!ids) throw Error('事件图前序记录无效');
  const allowed = new Set(ids);
  return graph.cards.filter(card => allowed.has(card.event_id) && admitted(card, run.step, run.ledger[run.step - 2]?.option));
}

function selectEvent(graph, run, random) {
  const pool = getEventPool(graph, run);
  if (!pool.length) throw Error('事件图无可达候选');
  const weights = pool.map(card => run.recent.includes(card.source_index) ? 1 : 4);
  let dice = random(run) * weights.reduce((a, b) => a + b, 0);
  for (let i = 0; i < pool.length; i++) if ((dice -= weights[i]) < 0) return pool[i].source_index;
  return pool[pool.length - 1].source_index;
}

function applyEffects(stats, choice) {
  return stats.map((n, i) => Math.max(choice.effects.min, Math.min(choice.effects.max, n + choice.effects.stats[i])));
}

module.exports = { compileEventGraph, validateEventGraph, getEventPool, selectEvent, applyEffects };

},
"src/core/birth.js":function(module,exports,require){
'use strict';
const { hash } = require("src/core/engine.js");
const fate = require("src/core/fate.js");
const traits = [
  ['流徙长大，记得隐蔽的归乡路', 'home'],
  ['在救济所学过照护，仍欠着一份人情', 'care'],
  ['继承了一箱无人认领的信件', 'letters'],
  ['跟随商队谋生，认识失散者的暗号', 'search'],
  ['曾替邻里作证，知道证词的代价', 'letters'],
  ['靠修补旧物换饭，愿意重建一个家', 'home'],
  ['经历过撤离，始终留有救人的绳索', 'care']
];
const histories = ['曾独自救出一队流民，如今请求你协助安置', '为寻找失踪的亲人远行，带回了一条线索', '替旧友背下债务，希望重建共同的家', '保存着被撤销的证词，正在寻找可信的见证人'];
function generate(world, seed, origin, version) {
  const roll = label => {
    let n = hash(`${world.id}:${seed}:${origin}:${label}`);
    n = Math.imul(n ^ (n >>> 16), 0x7feb352d);
    n = Math.imul(n ^ (n >>> 15), 0x846ca68b);
    return (n ^ (n >>> 16)) >>> 0;
  };
  const selected = traits.map((t, i) => ({ t, rank: roll(`trait${i}`) })).sort((a, b) => a.rank - b.rank).slice(0, 2 + roll('count') % 3).map(x => x.t);
  const people = fate.characters(world).map((p, i) => ({ ...p, history: histories[roll(`history${i}`) % histories.length], route: ['care', 'search', 'home', 'letters'][roll(`history${i}`) % histories.length], tie: ['旧识', '曾经的恩人', '来往已断的朋友', '初次相逢'][roll(`tie${i}`) % 4] }));
  if (version >= 4) {
    const pasts = [...histories, '走遍附近的集市，正在替旧相识捎一封迟到的信', '擅长修理细小的器物，总为同行者留着一套工具', '第一次远行就遇到大雨，从此记得每一处遮雨的屋檐', '把相遇的人写进手记，唯独有一页始终空着'];
    const routes = ['care', 'search', 'home', 'letters', 'letters', 'care', 'home', 'search'];
    const ordered = pasts.map((_, i) => i).sort((a,b) => roll('ensemble' + a) - roll('ensemble' + b));
    people.forEach((person, i) => { person.history = pasts[ordered[i]]; person.route = routes[ordered[i]]; });
  }
  // The same limitation affects opening resources and which detours can open.
  const limits = [
    { text: '你很难辨认陌生来路，便一直带着一本手绘的路册。', route: 'search', axis: 0 },
    { text: '重物拿不了多久，你随身的物件都很轻。', route: 'home', axis: 1 },
    { text: '第一次见面时，你往往要过很久才敢开口。', route: 'care', axis: 2 },
    { text: '小时候搬家频繁，带走的家当只够装一只小匣。', route: 'home', axis: 3 },
    { text: '在这里没人认得你的名字，信件通常要自己去取。', route: 'letters', axis: 4 },
    { text: '同时听见许多声音时，你得找个安静角落歇一会儿。', route: 'care', axis: 5 }
  ];
  const limit = limits[roll('limitation') % limits.length];
  const initialStats = Array.from({ length: 6 }, (_, i) => i === limit.axis ? 4 : 5 + roll('starting-' + i) % 4);
  return { limit, initialStats, traits: selected.map(t => t[0]), routes: [...new Set(selected.map(t => t[1]))], affinity: roll('affinity'), people,
    background: `${selected.map(t => t[0]).join('；')}。${limit.text}` };
}
const menus = {
  home: [['rebuild', '留下来重建住处，让失散的人有家可归'], ['move', '交还钥匙，陪他们迁往新的聚落']],
  care: [['escort', '亲自护送伤者，沿途寻找可以接纳他们的人'], ['shelter', '将伤者托付给当地照护所，留下应急物资']],
  letters: [['trace', '沿着旧信追查收信人的下落'], ['publish', '公开信件与证词，让当事人自己决定是否回应']],
  search: [['search', '加入寻找失踪亲人的队伍'], ['farewell', '承认线索已断，陪同行者完成告别']]
};
function choices(run) {
  const j = run.journey;
  const person = run.birth.people[j.person];
  const entries = j.depth === 0 ? menus[j.kind] : [['stay', '兑现承诺，留下协助安顿并建立新的互助关系'], ['delegate', '将后续事务交给当地伙伴，继续自己的人生']];
  const local = entries.slice();
  if (j.depth === 1 && run.fate.step < 12 && person.tie !== '初次相逢') {
    local.push(['settle', '接过常住的钥匙，和' + person.name + '一起搬进院子']);
  }
  return local.map(([id, text], i) => ({ id: `journey:${id}`, text: `${person.name}：${text}`, available: true, stat: i === 0 ? 2 : 3, cost: 0,
    context: `${person.tie}；${person.history}。${j.depth === 0 && i === 0 ? '他们仍在等一个愿意同行的人。' : '同行者安静地等你回答。'}` }));
}
module.exports = { generate, choices };

},
"src/core/episode.js":function(module,exports,require){
'use strict';

const { STATS } = require("src/core/engine.js");

function validateEpisode(episode) {
  const validText = s => typeof s === 'string' && s.trim().length > 0;
  const card = c => c && ['title', 'text', 'a', 'b'].every(key => validText(c[key])) &&
    c.attributes?.length === 2 && c.attributes.every(name => STATS.includes(name));
  if (!episode || !validText(episode.title) || !['web-original', 'echo-reference'].includes(episode.source) ||
      !card(episode.opening) || episode.followups?.length !== 2 || !episode.followups.every(card) ||
      episode.codas?.length !== 4 || !episode.codas.every(validText)) throw Error('短剧缺少完整事件、分支、署名或尾声');
}

function currentScene(world, run) {
  return run.episode.choices.length ? world.episode.followups[run.episode.choices[0]] : world.episode.opening;
}

function advance(world, run, option) {
  if (![0, 1].includes(option) || run.episode.choices.length >= 2) throw Error('短剧选项无效');
  const scene = currentScene(world, run);
  run.episode.entries.push({ title: scene.title, choice: option ? scene.b : scene.a });
  run.episode.choices.push(option);
  if (run.episode.choices.length === 2) {
    const [first, second] = run.episode.choices;
    run.episode.coda = world.episode.codas[first * 2 + second];
    run.phase = 'event';
  }
  return run;
}
module.exports = { validateEpisode, currentScene, advance };

},
"src/adapters/storage.js":function(module,exports,require){
'use strict';
const { restore } = require("src/core/game.js");
const { replay } = require("src/core/engine.js");
const { clockFor } = require("src/ui/time.js");
const KEY = 'isekai.archive.v1';
function fresh() { return { version: 1, run: null, archives: [], discovered: {}, recent: {}, settings: { large: false, contrast: false, concise: false }, completed: 0 }; }
function createStorage(platform, worlds, revision) {
  let warning = '';
  function save(data) {
    try { platform.write(KEY, JSON.stringify({ ...data, revision })); warning = ''; return true; }
    catch (_) { warning = '存储不可用，当前进度仅保留在本次运行。请释放设备空间。'; return false; }
  }
  function load() {
    let raw;
    try {
      raw = platform.read(KEY);
      if (!raw) return fresh();
      const data = JSON.parse(raw);
      if (data.version !== 1 || !Array.isArray(data.archives) || !data.discovered || !data.settings || !data.recent || !Number.isInteger(data.completed)) throw Error('结构损坏');
      if (!data.discoveries && Object.keys(data.discovered).length && !data.legacyDiscovered) data.legacyDiscovered = { ...data.discovered };
      const changed = data.revision !== revision;
      if (changed) {
        try { platform.write(KEY + '.backup', raw); } catch (_) {}
        warning = '内容包已更新；保留前世、图鉴、设置和旧进度记录。';
      }
      data.archives = data.archives.map(a => {
        const w = worlds.find(w => w.id === a.worldId);
        return { ...a, endingSnapshot: a.endingSnapshot || (!changed ? w?.endings[a.ending] : { title: `旧版结局 ${a.ending + 1}`, text: '内容已变更；保留原结局索引与人生选择，旧版正文未存入快照。' }), legacy: !['fate-v1','life-story-v1'].includes(a.format) };
      });
      if (data.run) {
        const w = worlds.find(w => w.id === data.run.worldId);
        try {
          if (!w) throw Error('世界已移除');
          if (data.run.format === 'life-story-v1') {
            const rebuilt = require("src/core/life-story.js").restore(w, data.run);
            if (data.run.uiTime) { rebuilt.uiTime = data.run.uiTime; clockFor(rebuilt); }
            data.run = rebuilt;
          } else if (data.run.format === 'fate-v1') {
            // Content revisions can reorder events/origins. Preserve the original record instead of silently rewriting it.
            const rebuilt = restore(w, data.run);
            if (rebuilt.origin !== data.run.origin || rebuilt.talent !== data.run.talent ||
                data.run.ledger.some((l, i) => rebuilt.ledger[i]?.title !== l.title) ||
                (data.run.pending && rebuilt.pending?.title !== data.run.pending.title)) throw Error('路线内容变更');
            if (data.run.uiTime) { rebuilt.uiTime = data.run.uiTime; clockFor(rebuilt); }
            data.run = rebuilt;
          } else if (w.origins.length < 8 && w.id.startsWith('fixture-')) {
            data.run = replay(w, data.run.seed, data.run.ledger.map(l => l.option), data.run.recent);
          } else throw Error('旧版人生');
        } catch (_) {
          data.suspended = [...(data.suspended || []), data.run]; data.run = null;
          warning = '旧人生已保留在前世记录中供回看；新人生使用当前内容与命运规则。';
        }
      }
      if (changed) data.revision = revision;
      return data;
    } catch (_) {
      if (raw) { try { platform.write(KEY + '.backup', raw); } catch (_) {} }
      warning = '本地存档无法读取，已尝试保留原始备份。'; return fresh();
    }
  }
  return { load, save, get warning() { return warning; } };
}
module.exports = { createStorage, fresh };

},
"src/ui/time.js":function(module,exports,require){

'use strict';
// Ordinary scenes resolve as time passes. A personal decision waits for input.
function clockFor(run) {
  const saved = run.uiTime;
  if (saved && Number.isFinite(saved.age) && saved.age >= 0 &&
      Number.isFinite(saved.from) && Number.isFinite(saved.target) && saved.target >= saved.from &&
      Number.isFinite(saved.progress) && saved.progress >= 0 && saved.progress <= 1 &&
      [1, 2, 4, 8].includes(saved.speed) && ['birth', 'flow', 'event'].includes(saved.mode)) {
    if (run.format !== 'life-story-v1' && run.phase !== 'event') saved.mode = 'event';
    return saved;
  }
  // Existing saves resume at the choice already presented; never reroll a birth.
  const age = run.step ? 6 + run.step * 4 : 0;
  return (run.uiTime = { age, from: age, target: age, progress: 1, speed: 1, paused: false, mode: 'event' });
}
function prepareInterval(run) {
  const time = clockFor(run);
  const years = run.format === 'life-story-v1'
    ? (time.age === 0 ? 16 + (run.birth.affinity % 5) : run.phase === 'choice' ? 2 : 4)
    : time.age < 6 ? 6 - time.age : run.journey ? 1 : time.age < 18 ? 3 : 4;
  Object.assign(time, { from: time.age, target: time.age + years, progress: 0, mode: 'flow' });
}
module.exports = { clockFor, prepareInterval };

},
"src/core/life-story.js":function(module,exports,require){
'use strict';

// A separate format: old saves continue to be replayed by game.js.
const game = require("src/core/game.js");
const copy = value => JSON.parse(JSON.stringify(value));
const FORMAT = 'life-story-v1';
const roll = (r, label, n) => game.hash(`${r.seed}:${r.origin}:${label}`) % n;
const person = r => r.birth.people[r.focus];
const memories = {
  reconcile: ['public.rescue', 'public.rule'],
  inherit: ['identity.1', 'relationship.1'],
  liberate: ['public.sacrifice', 'relationship.2'],
  cycle: ['secret.reconcile', 'secret.inherit', 'secret.liberate']
};
const fallback = {
  calling: { title: '留给你的工具', text: '旧日的手艺又有人需要。接下这份长工，就得把往后的清晨留在这里。', options: [
    { label: '接下长工，用自己的手艺替来人做事', aftermath: '你接下了长工，晨起便有人等你开门。反复练习的手艺终于有了需要它的人。' },
    { label: '退还长工的信物，靠零活养活自己', aftermath: '你退还了长工的信物，靠零活过日子。空下的午后，你开始替来往的人核对旧信。' }] },
  bond: { title: '约定的时辰', text: '那位与你有过交集的人托人带话，希望你能来照料一段日子。赴约便要推掉已经说好的活。', options: [
    { label: '推掉那份活，赴约照料对方', aftermath: '你推掉了活，按约赶到。最难熬的夜里，你一直守在对方身旁；此后的复诊也由你陪着。' },
    { label: '送去告别信，从此分开生活', aftermath: '你把告别信送出，收回留在对方那里的东西。此后再没有人替你留那张椅子。' }] },
  home: { title: '钥匙与行囊', text: '住处需要有人长期照看，远行的队伍也将启程。房主等着收回钥匙，好交给下一个人。', options: [
    { label: '留下钥匙，在这里安家', aftermath: '你留下钥匙，把积蓄花在修屋上。此后的雨夜，你都得回来查看屋顶。' },
    { label: '交还钥匙，随队远行', aftermath: '你交还钥匙，把能带走的家当绑进行囊。旧路从此只能在回信里相见。' }] }
};
function turn(w, key) {
  const t = w.turns?.[key] || fallback[key];
  if (!t || !t.title || !t.text || t.options?.length !== 2 || t.options.some(o => !o.label || !o.aftermath)) throw Error('人生场景缺少正文或后果');
  return t;
}
function addFact(r, id, text, effects = {}) {
  r.facts.push({ id, text });
  for (const [axis, amount] of Object.entries(effects)) r.stats[axis] = Math.max(0, Math.min(20, r.stats[axis] + amount));
}
function secretKeys(w, r) {
  const known = new Set(r.memories.filter(m => m.worldId === w.id).map(m => m.endingId));
  const f = r.life;
  const conditions = { reconcile: f.evidence >= 2 && f.care && f.home,
    inherit: f.trained && f.care && f.home,
    liberate: f.calling === 'B' && f.care && f.home && f.resolution === 'rest',
    cycle: r.focus === 5 && f.evidence >= 2 && f.care && f.home };
  const eligible = Object.keys(memories).filter(k => conditions[k] &&
    game.fate.getRules(w).some(rule => rule.key === `secret.${k}`));
  // The encounter for this birth is stable even if additional past lives are discovered.
  const candidate = opportunities(r, eligible.map(id => ({ id })), 1)[0]?.id;
  return candidate && memories[candidate].every(m => known.has(m)) ? [candidate] : [];
}
function opportunities(r, list, max) {
  if (list.length <= max) return list;
  const rank = action => roll(r, 'offer/' + action.id + '/' + r.life.calling + '/' + r.focus + '/' + r.seed, 65521);
  return list.slice().sort((a, b) => rank(a) - rank(b)).slice(0, max);
}
function resolutionOptions(w, r) {
  const f = r.life;
  const result = [{ id: 'rest', text: '交出值班牌，留在家中慢慢养好身体' }];
  if (f.trained) result.push({ id: 'manage', text: '接下长期照管的名册，把余生交给这份工作' });
  if (f.care) result.push({ id: 'rescue', text: '拿出家中储备，与邻人一起接回尚未归来的人' });
  if (f.evidence >= 2) result.push({ id: 'truth', text: '署上自己的名字，带核实过的旧信去见当事人' });
  if (f.trained && f.care) result.push({ id: 'sacrifice', text: '由自己承接最伤身体的差事，让伙伴有时间寻找替代办法' });
  if (f.trained && w.origins.indexOf(r.origin) < 8) result.push({ id: 'craft', text: `以「${r.origin}」的手艺收下学徒，亲自带他们做活` });
  if (f.care && r.focus < 5) result.push({ id: 'together', text: `辞去外面的差事，与${person(r).name}共同安排往后的生活` });
  return opportunities(r, result, 2);
}
const secretActions = {
  reconcile: ['把两叠相互矛盾的旧记录带去，请双方坐下来逐页核对', '你带着核实过的记录陪双方重新相见。旧日互助与独自照管的记忆，让你听懂了各自没说完的话。'],
  inherit: ['重新打开旧工具匣，与守约的人一起接下未完的工作', '你和守约的人打开工具匣。反复练习的双手认出了旧痕，你们把未完成的工作改成两个人能承担的份量。'],
  liberate: ['请照护你的人封好旧工具，不再以身体偿付那份差事', '你请照护你的人封好工具。曾经独自承受的记忆仍在，但你这次按约停手，接受了不能再用旧能力的生活。'],
  cycle: ['和记事人核对反复出现的姓名，把每份旧信送还本人', '你与记事人把三段旧日记忆逐一对照，为反复出现的姓名找到了去处。送出最后一封信时，你们约好从此记录不再重复的日子。']
};
function options(w, r) {
  if (r.worldId !== w.id) throw Error('世界不匹配');
  if (r.phase !== 'choice') return [];
  if (fallback[r.node]) return turn(w, r.node).options.map((o, i) => ({ id: `${r.node}:${i ? 'B' : 'A'}`, text: o.label }));
  if (r.node === 'resolution') return resolutionOptions(w, r);
  if (r.node === 'secret') return [...opportunities(r, secretKeys(w, r).map(k => ({ id: k, text: secretActions[k][0] })), 1), { id: 'close', text: '合上旧信，回到已经答应的生活里' }];
  throw Error('未知人生场景');
}
function show(w, r) {
  r.node = r.queue.shift();
  if (!r.node) return finish(w, r);
  r.phase = ['birth', 'work', 'season', 'echo'].includes(r.node) ? 'event' : 'choice';
  const echo = r.ledger.at(-1)?.kind === 'choice' ? r.facts.at(-1)?.text || '' : '';
  if (fallback[r.node]) {
    const t = turn(w, r.node);
    r.scene = { title: t.title, text: `${echo}\n\n${r.node === 'calling' ? `你以「${r.origin}」的身份在这里谋生。` : ''}${r.node === 'bond' ? `${person(r).name}（${person(r).tie}），${person(r).history}。\n\n` : ''}${t.text}` };
  } else if (r.node === 'birth') r.scene = { title: '在这里长大', text: `你是${r.origin}。${r.background}\n\n${person(r).name}（${person(r).tie}），${person(r).history}。` };
  else if (r.node === 'work') {
    const e = w.episode;
    // Episodes are observed incidents, never another hidden pair of player decisions.
    const branch = (r.birth.affinity + (r.life.calling === 'A' ? 0 : 1)) % 2;
    const coda = (r.birth.routes.includes(person(r).route) ? 0 : 1);
    r.episode = e ? { title: e.title, branch, coda } : null;
    if (e && roll(r, 'interlude', 3) === 0) {
      r.scene = { title: e.title, text: echo + '\n\n' + e.codas[branch * 2 + coda] };
    } else ordinary(w, r, echo);
  } else if (r.node === 'resolution') r.scene = { title: '往后的日子', text: `${echo}\n\n房子已修好，${r.life.trained ? '常来做活的人送来了长期照管的名册。' : '邻人来问你是否还愿意出门帮忙。'}${r.life.care ? `${person(r).name}坐在你身边，商量往后的作息。` : ''}${r.life.evidence >= 2 ? '桌上放着你逐份核实的旧信，当事人等着回音。' : ''}你得把自己的时间交给一件真正愿意长久做的事。` };
  else if (r.node === 'secret') r.scene = { title: '旧信里的回声', text: `${echo}\n\n几封旧信中的笔迹令你想起自己曾经历的另一段人生。你把记得的事讲给${person(r).name}听，对方取出了保存多年的纸页。纸上的姓名与眼前的记录相合。今晚，你们可以一起把未说完的话说清。` };
  else ordinary(w, r, r.life.care ? person(r).name + '又捎来一封家书。' : '');
  r.scene.text = r.scene.text.trim();
  return r;
}
function ordinary(w, r, opening) {
  const used = new Set([...r.recent, ...r.ledger.map(entry => entry.eventIndex)]);
  const fresh = w.events.map((_, index) => index).filter(index => !used.has(index));
  const pick = roll(r, 'incident/' + r.step + '/' + r.life.calling + '/' + r.life.home + '/' + person(r).route, fresh.length || w.events.length);
  const index = fresh.length ? fresh[pick] : pick;
  const event = w.events[index];
  const response = (roll(r, 'habit/' + index + '/' + r.life.bond, 2) ? event.b : event.a).replace(/[。！]$/, '');
  r.scene = { eventIndex: index, title: event.title, text: [opening, event.text + '\n你' + response + '。'].filter(Boolean).join('\n\n') };
}
function start(w, seed, recent = [], discoveries = []) {
  if (!Array.isArray(discoveries)) throw Error('历史发现必须是数组');
  const r = game.startRun(w, seed, recent, 4);
  delete r.fate; delete r.eventIndex; delete r.lifeVersion;
  Object.assign(r, { format: FORMAT, facts: [], life: { evidence: 0, care: false, trained: false }, memories: [...new Map(discoveries.filter(d => d.worldId === w.id).map(d => [d.endingId, { worldId: w.id, endingId: d.endingId }])).values()], focus: 0 });
  // Affinity, ties and childhood routes select whose request enters this life.
  r.focus = roll(r, `focus:${r.birth.routes.join('/')}`, r.birth.people.length);
  const p = person(r);
  const hasBond = p.tie !== '初次相逢' || r.birth.routes.includes(p.route);
  r.queue = ['birth', 'calling', 'work', ...(hasBond ? ['bond'] : []), 'home'];
  return show(w, r);
}
function act(w, r, id) {
  const f = r.life;
  if (fallback[r.node]) {
    const branch = id.endsWith(':A') ? 'A' : 'B';
    const t = turn(w, r.node).options[branch === 'A' ? 0 : 1];
    f[r.node] = branch;
    addFact(r, id, t.aftermath, r.node === 'calling' ? { 1: branch === 'A' ? 2 : -1, 3: branch === 'A' ? 1 : -1 } : r.node === 'bond' ? { 2: branch === 'A' ? 3 : -2, 3: -1 } : { 3: -2, 0: branch === 'A' ? 1 : -1 });
    if (r.node === 'bond') {
      f.care = branch === 'A';
      r.people[r.focus] = `${person(r).name}（${person(r).role}）：${t.aftermath}`;
    }
    if (r.node === 'home') {
      f.home = branch === 'A';
      // Travel and childhood practical experience change elapsed life, not a fixed node budget.
      const seasons = roll(r, `seasons:${f.calling}:${f.bond}:${branch}:${r.birth.limit.route}`, 3);
      r.queue.push(...Array(seasons).fill('season'));
      if (f.home && (f.trained || f.care || f.evidence >= 2)) r.queue.push('resolution');
      else r.queue.push(...Array(roll(r, 'travel', 3)).fill('echo'));
    }
    return;
  }
  if (r.node === 'resolution') {
    f.resolution = id;
    const outcomes = {
      rest: ['你交出值班牌，接受身体的限度。窗前终于有了可以安心歇息的午后。', { 0: 2, 5: 2 }],
      manage: ['你接下长期照管的名册。多年练习使你认得每处细小的损耗，也让深夜的敲门声成为日常。', { 4: 3, 0: -1 }],
      rescue: ['你拿出储备，与邻人排好轮班，亲自接回迟归的人。你照料旧友时学会的耐心，如今也给了陌生人。', { 2: 2, 3: -3 }],
      truth: ['你署名送出了逐份核实的旧信。有人终于得到回音，也有人从此不愿与你来往。', { 4: 2, 2: -1 }],
      sacrifice: ['你把最伤身体的差事留给自己，给伙伴争取了寻找替代办法的时间。此后每到冷天，旧伤都会先醒。', { 0: -4, 1: -3 }],
      craft: [`你以「${r.origin}」的手艺收下学徒，把多年练出的本领交给需要它的人，也定下按时歇工的规矩。`, { 1: 2, 4: 2 }],
      together: [`你辞去外面的差事，与${person(r).name}把两份作息写在同一张纸上。共同生活没有消除分歧，却让赴约成了每天的事。`, { 2: 3, 3: -1 }]
    };
    addFact(r, id, ...outcomes[id]);
    if (secretKeys(w, r).length) r.queue.push('secret');
    r.queue.push(...Array(roll(r, `after:${id}`, 3)).fill('echo'));
  } else if (id !== 'close') {
    f.secret = id;
    addFact(r, `secret:${id}`, secretActions[id][1], { 5: 2, 2: 1 });
  }
}
function observe(r) {
  if (r.node === 'birth') addFact(r, 'childhood', `你一直记得：${r.birth.traits[0]}。`);
  else if (r.node === 'work') {
    r.life.trained = r.life.calling === 'A';
    if (!r.life.trained) r.life.evidence += 2;
    addFact(r, 'practice', r.life.trained ? `身为${r.origin}的你，经过一季反复做活，已能独自完成受托的工作。` : '改行后，你在往来记录里找到了两封迟迟未送达的旧信。', r.life.trained ? { 1: 2, 4: 1 } : { 5: 2 });
  } else {
    const letters = r.birth.routes.includes('letters') || person(r).route === 'letters';
    if (letters) r.life.evidence++;
    addFact(r, `${r.node}:${r.step}`, r.scene.text.split('\n\n').at(-1), letters ? { 5: 1 } : { 3: 1 });
  }
}
function finish(w, r) {
  const f = r.life;
  let key = !f.home ? 'public.exile' : 'public.survive';
  const publicKeys = { manage: 'rule', rescue: 'rescue', truth: 'truth', sacrifice: 'sacrifice', rest: 'survive' };
  if (publicKeys[f.resolution]) key = `public.${publicKeys[f.resolution]}`;
  if (f.resolution === 'craft' && f.trained) key = `identity.${w.origins.indexOf(r.origin) + 1}`;
  if (f.resolution === 'together' && f.care) key = `relationship.${r.focus + 1}`;
  if (f.secret && secretKeys(w, r).includes(f.secret)) key = `secret.${f.secret}`;
  const rule = game.fate.getRules(w).find(rule => rule.key === key);
  if (!rule) throw Error('人生没有匹配的结局');
  r.phase = 'complete'; r.ending = rule.endingIndex; r.endingId = key;
  // Old hint fields contain route solutions; never carry them into the UI snapshot.
  r.endingSnapshot = { title: w.endings[r.ending].title, text: `${r.facts.map(fact => fact.text).join('\n\n')}\n\n${w.endings[r.ending].text}` };
  r.discovery = { worldId: w.id, endingId: key };
  r.scene = { title: r.endingSnapshot.title, text: r.endingSnapshot.text };
  return r;
}
function advance(w, current, id) {
  if (current.format !== FORMAT || current.worldId !== w.id || current.phase === 'complete') throw Error('人生已完成或格式、世界不匹配');
  if (current.phase === 'event' ? id !== null : !options(w, current).some(o => o.id === id)) throw Error('当前人生行动无效');
  const r = copy(current);
  const choice = r.phase === 'choice';
  const text = choice ? options(w, r).find(o => o.id === id).text : '日子向前走去';
  if (choice) act(w, r, id); else observe(r);
  r.ledger.push({ step: r.step, kind: choice ? 'choice' : 'event', node: r.node, title: r.scene.title,
    text: r.scene.text, eventIndex: r.scene.eventIndex ?? null, id, choice: text, commitment: r.facts.at(-1)?.text || text });
  r.step++;
  return show(w, r);
}
function restore(w, saved) {
  if (saved.format !== FORMAT) return game.restore(w, saved);
  if (saved.worldId !== w.id || !Array.isArray(saved.ledger)) throw Error('无效人生存档');
  let r = start(w, saved.seed, saved.recent, saved.memories || []);
  for (const entry of saved.ledger) {
    if (r.node !== entry.node || entry.kind !== (r.phase === 'choice' ? 'choice' : 'event')) throw Error('人生记录顺序已改变');
    r = advance(w, r, entry.id);
  }
  // Replay is authoritative; edited stats, queues and ending fields are discarded.
  return r;
}
module.exports = { start, options, advance, restore };

},
"src/adapters/playtest.js":function(module,exports,require){
'use strict';

// 仅汇总本机内测，不存放身份标识，也不向服务器发送记录。
function dayKey(date) {
  return Math.floor(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86400000);
}
function visit(data, date = new Date()) {
  const today = dayKey(date);
  if (!data.playtest) data.playtest = { firstDay: today, started: 0, firstCompleted: false, restarted: false, returnedD1: false };
  if (today === data.playtest.firstDay + 1) data.playtest.returnedD1 = true;
  return data.playtest;
}
function started(data) {
  const sample = visit(data);
  sample.started++;
  if (sample.firstCompleted) sample.restarted = true;
}
function completed(data) {
  const sample = visit(data);
  if (sample.started === 1) sample.firstCompleted = true;
}
function summary(data, date = new Date()) {
  const sample = visit(data, date);
  const d1 = sample.returnedD1 ? '已回访' : dayKey(date) <= sample.firstDay + 1 ? '观察中' : '未回访';
  return '本机已投生 ' + sample.started + ' 次 · 首局' + (sample.firstCompleted ? '已完成' : '未完成') +
    ' · 首局完成后' + (sample.restarted ? '已重开' : '未重开') + ' · 次日' + d1;
}
module.exports = { visit, started, completed, summary };

},
"src/ui/horizon.js":function(module,exports,require){
'use strict';

// An original paper-cut horizon. The sun follows the current passage of time,
// never the remaining length of a life.
function drawHorizon(app, seed, phase, height) {
  const ctx = app.ctx, x = app.left, y = app.y, w = app.inner;
  if (!ctx.arc || !ctx.lineTo) return;
  const dark = app.data.settings.contrast;
  const palette = dark ? ['#172326', '#25413e', '#34544c', '#527265', '#ffe199'] :
    ['#e8eee5', '#d2dfd2', '#adc7b6', '#779f8d', '#c98454'];
  const n = (seed >>> 0) % 977;
  ctx.save();
  ctx.beginPath(); ctx.rect(x, y, w, height); ctx.clip();
  ctx.fillStyle = palette[0]; ctx.fillRect(x, y, w, height);
  const sunX = x + w * (.18 + .65 * phase);
  const sunY = y + height * (.43 - .18 * Math.sin(Math.PI * phase));
  ctx.fillStyle = palette[4]; ctx.beginPath(); ctx.arc(sunX, sunY, height * .115, 0, 2 * Math.PI); ctx.fill();
  for (let layer = 0; layer < 3; layer++) {
    ctx.fillStyle = palette[layer + 1]; ctx.beginPath(); ctx.moveTo(x, y + height);
    for (let u = 0; u <= 80; u++) {
      const t = u / 80;
      const ripple = .10 * Math.sin(t * 7 + n + layer * 3) + .045 * Math.cos(t * 16 + n / 3 + layer);
      ctx.lineTo(x + w * t, y + height * (.50 + .14 * layer + ripple));
    }
    ctx.lineTo(x + w, y + height); ctx.closePath(); ctx.fill();
  }
  ctx.restore(); app.y += height + 18;
}
module.exports = { drawHorizon };

},
"src/adapters/browser.js":function(module,exports,require){
'use strict';
function browserPlatform(canvas) {
  return {
    reducedMotion: () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches || false,
    onShow: fn => { document.addEventListener('visibilitychange', () => { if (!document.hidden) fn(); }); window.addEventListener('pageshow', fn); },
    onFrame: fn => { const frame = now => { fn(now); window.requestAnimationFrame(frame); }; window.requestAnimationFrame(frame); },
    size: () => ({ width: window.innerWidth, height: window.innerHeight, ratio: window.devicePixelRatio }),
    read: key => localStorage.getItem(key), write: (key, value) => localStorage.setItem(key, value),
    onResize: fn => window.addEventListener('resize', fn),
    onHide: fn => { document.addEventListener('visibilitychange', () => { if (document.hidden) fn(); }); window.addEventListener('pagehide', fn); },
    onInput: fn => {
      for (const [event, type] of [['pointerdown', 'down'], ['pointermove', 'move'], ['pointerup', 'up'], ['pointercancel', 'cancel']]) {
        canvas.addEventListener(event, e => { if (type === 'down') canvas.setPointerCapture(e.pointerId); fn({ type, x: e.clientX, y: e.clientY }); });
      }
      canvas.addEventListener('wheel', e => { e.preventDefault(); fn({ type: 'wheel', delta: e.deltaY }); }, { passive: false });
      window.addEventListener('keydown', e => { if (['ArrowDown', 'ArrowUp', 'PageDown', 'PageUp'].includes(e.key)) { e.preventDefault(); fn({ type: 'key', key: e.key }); } });
    },
    offscreen: (width, height) => { const c = document.createElement('canvas'); c.width = width; c.height = height; return c; },
    exportImage: (c, done) => { try { const link = document.createElement('a'); link.download = '我的异世界人生.png'; link.href = c.toDataURL('image/png'); link.click(); done('人生卡已导出。'); } catch (_) { done('导出失败，请检查浏览器下载设置。'); } }
  };
}
module.exports = { browserPlatform };

},
"src/adapters/wechat.js":function(module,exports,require){
'use strict';
function wechatPlatform(wx) {
  return {
    onShow: fn => wx.onShow(fn),
    onFrame: fn => { setInterval(() => fn(Date.now()), 50); },
    size: () => {
      const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
      const menu = wx.getMenuButtonBoundingClientRect ? wx.getMenuButtonBoundingClientRect() : null;
      return { width: info.windowWidth, height: info.windowHeight, ratio: info.pixelRatio, top: Math.max(info.safeArea?.top || 0, menu?.bottom || 0) };
    },
    read: key => wx.getStorageSync(key), write: (key, value) => wx.setStorageSync(key, value),
    onResize: fn => { if (wx.onWindowResize) wx.onWindowResize(fn); }, onHide: fn => wx.onHide(fn),
    onInput: fn => {
      [['onTouchStart', 'down'], ['onTouchMove', 'move'], ['onTouchEnd', 'up'], ['onTouchCancel', 'cancel']].forEach(([event, type]) => wx[event](e => {
        const p = e.changedTouches[0] || e.touches[0]; if (p) fn({ type, x: p.clientX, y: p.clientY });
      }));
    },
    offscreen: (width, height) => { const c = wx.createCanvas(); c.width = width; c.height = height; return c; },
    exportImage: (c, done) => c.toTempFilePath({ fileType: 'png', success: result => wx.previewImage({ urls: [result.tempFilePath], success: () => done('长按图片可保存人生卡。'), fail: () => done('图片预览失败，请重试。') }), fail: () => done('人生卡生成失败，请重试。') })
  };
}
module.exports = { wechatPlatform };

}};
const cache={}; function require(id){if(!cache[id]){const module={exports:{}};cache[id]=module;modules[id](module,module.exports,require);}return cache[id].exports;}
const pack={"fixture":false,"worlds":[{"id":"w1","name":"仙门劫","premise":"归墟潮扰乱仙山的盐脉、药根与梦境，你与同行者修补天衡大阵，寻找失散的魂音。异类可借纸身行走，以鸣声或显字交谈。","factions":{"commons":"山下照护队","council":"守阵修习组","archive":"山海记事馆"},"fate":{"characters":["沈照","陆衡","河泽盟友","失忆的家人","盐路引路人","闻灯"]},"origins":["带着师门旧剑的外门剑徒","替亡者缝魂的山村医女","世代抄录山海游记的仙府抄书人","离开龙宫游历的河泽半妖","押送灵盐入山的行脚商","守护无名坟场的纸扎匠","初次独自下山的听星童子","以凡铁修补仙器的炉坊匠人","随行旅寻找失踪者的通灵御猫","能借纸身奏响归墟回声的古琴灵"],"events":[{"title":"盐车入山","text":"你押着灵盐车来到照夜关，山雾已漫过车轮。盐既能烘干避雨棚，也能修补山路阵纹。棚里的孩子抱着湿衣，守阵弟子则举着一张被雨打透的货单，指向正在松动的石阶。","a":"把盐搬进避雨棚","b":"沿石阶把车推往阵台"},{"title":"白霜账目","text":"盐仓结起不融的霜，搬运小童困在值房。旧账里的温度曲线与潮声同时升高，最深处的总账仍在落霜。你听见小童敲门，也看见纸页边缘正化成水。","a":"先接小童出来，再抄门边账页","b":"撑开霜幕，取下深处总账"},{"title":"盐井呼救","text":"废井传来敲击，采盐人被卡在升降台下。镇墟符缠住绳轮，拔符会使井壁渗水。井口还有一条通向干燥矿洞的旧滑轨，锈蚀的支架随着每次敲击颤动。","a":"请同伴轮流撑符，缓缓提绳","b":"接上旧滑轨，撬开升降台"},{"title":"结晶里的歌","text":"运盐老妇的指节生出透明结晶，里面响着旧日摇篮曲。药师能取晶辨认盐脉异常，但歌声也牵着她对儿子的记忆。老妇伸出手，儿子把她平日哼歌的谱子放在桌边。","a":"收起歌谱，逐户询问盐的来处","b":"握住老妇的手，请药师取晶"},{"title":"盐棚看水","text":"盐工、船家与守阵弟子围着湿地图。旧河道绕过塌方，却穿过船家的芦苇田。船家想先移芦根，弟子看着将尽的灯油。远处水声越来越近，船底仍搁在泥里。","a":"与船家标好移根处，再试水道","b":"推船入水，沿旧河道探路"},{"title":"半袋净盐","text":"避雨棚只剩半袋净盐。老向导与孩子们都受了寒，向导熟知山内暖泉，孩子却已咳得睡不着。送药人说附近还有盐花，只是需要有人陪他翻过夜间的山岭。","a":"背起药篓，随送药人上岭","b":"替向导敷盐，请他画出暖泉路线"},{"title":"漏风的盐袋","text":"同伴盐袋里藏着寻路玉片，他一直用它寻找走失的妹妹。玉片错接阵纹，引来了追逐光亮的雾兽。他低头说早该告诉大家，妹妹的声音却又从玉片里传来。","a":"把玉片放在桌上，一起辨认声音","b":"将玉片系在空车上，推向岔路"},{"title":"逆潮盐雪","text":"黑潮卷入盐仓，灵盐化雪飘向街巷，沾上衣服便让人昏睡。搬运师傅守着深处扳机，运输滑轨仍能导走盐雪；仓顶也有一扇久未启用的排风窗。","a":"接过师傅手里的扳机","b":"爬上仓顶，扳开排风窗"},{"title":"盐图与仓钥","text":"盐工准备随你上山，各处小仓都需要补货。大家想分头照着盐图走，守阵弟子担心岔路上的潮雾变化太快。完整地图摊在车上，纸角已经被湿风吹卷。","a":"抄出几份盐图，分好仓钥","b":"收好总图，带大家依次巡仓"},{"title":"盐桥开门","text":"盐桥只识别熟悉的灵息，同行弟子的旧护符还能唤亮桥面。众人靠得太近，桥索会吃不住重量。你也能用仓印化开旁边盐壁，壁后却是一段未经修整的栈道。","a":"借护符结绳，分批走上盐桥","b":"以仓印化开盐壁，查看栈道"},{"title":"万仓一秤","text":"阵心巨秤两端堆着湿盐与干盐，旧秤砣吸入潮气，怎么也称不准。拆秤要逐日添盐护阵；重置所有秤砣则会让盐脉骤然流动，山下的小仓未必接得住。","a":"卸下秤盘，安排逐日添盐","b":"转动总轴，重新校准秤砣"},{"title":"盐尽之后","text":"盐脉接通后，封印仍只能撑过今夜。老修士愿以修为养住裂口，却需要静坐一个冬天，无法再指导弟子。众人带来的新盐尚未晒干，院里只能听见滴水声。","a":"铺开湿盐，与同伴轮流烘晒","b":"陪老修士入阵，摆好护心灯"},{"title":"药圃敲门","text":"青蘅谷的药苗在冷土里蜷着叶。药师正等一股活灵息催芽，求诊的母亲把女儿抱到炉边，你的掌心也能唤醒种子。山外另有向阳坡，只是药苗从未在那里生根。","a":"坐到育苗盆旁，贴掌温土","b":"抱起一盆药苗，去看向阳坡"},{"title":"根下花名","text":"夜里根系浮出一串花名，有几种本该来春才发芽。药圃正提前耗尽地气，母根却也连着病房里的药罐。学徒提灯带你入谷，先指了指母亲床头剩下的半碗汤。","a":"逐床记下用药，再查看母根","b":"沿花名找到支根，剪去早萌枝"},{"title":"炉中回声","text":"清炉的药工困在铜炉夹层，敲击声从蒸汽中传出。开主炉会散去谷口的避瘴药雾，废烟道却只容一人爬行，必须有人留在外头控火。","a":"留在炉边调火，请同伴走烟道","b":"掀开主炉，铺好通往谷外的湿毯"},{"title":"失味的舌头","text":"试药少年能分辨细微药性，却因连日尝药失去味觉。今日的药渣混着陌生香气，他说还能再试，随后写下想吃母亲做的面。药师把温水和封样纸一起递来。","a":"封好药渣，去查采药记录","b":"递给少年温水，陪他辨药"},{"title":"百草会诊","text":"乡医想种见效快的凡药，谷中药师想养下一季才成的镇墟灵根。共生古方需要一整片净土，眼前空地却已播下晚麦。老人拿着种袋，等你们说完再下锄。","a":"与众人圈出小片试种地","b":"收起晚麦种，整理整块药畦"},{"title":"续命药引","text":"解瘴汤还缺一道稳火灵息。谷主正在维持结界，你也能入炉引药，却怕经脉撑不住。药师翻出一枚旧道基石，石内灵息虽足，裂纹已经贯穿中心。","a":"伸手接住药炉的引火环","b":"把旧道基石嵌进炉座"},{"title":"换过的药签","text":"几位病人服药后睡得异常沉。同行药师承认把两批外观相同的药签贴反，她想先走完送药路线再说，只有她熟悉母根旁的小径。帐外已有人端着药碗来问。","a":"请她逐床说明，重新核对药签","b":"带她先沿小径查验母根"},{"title":"满谷开花","text":"灵草一夜开出人脸，花粉让人梦见陌生的一生。病房里还有不能搬动的重患，花梦正沿窗缝飘入。你能以识海暂存梦境，药师则取来了隔开核心药圃的火种。","a":"坐在病房门口，展开识海","b":"沿核心药圃铺出火线"},{"title":"相传的医书","text":"乡医带来护心药方，谷中药师担心初学者误用烈性药材。案上同时摆着便于传抄的小册和完整丹谱。窗外的求药人已经到齐，每个人问的都是不同病症。","a":"与药师添写辨药图，分发小册","b":"留在药案前，逐份配好护心药"},{"title":"药藤深门","text":"药藤会缠住带有瘴气的衣物，大家一路走来谁也避不开。洗去气味的药水需要浸泡许久，另一侧藤墙已经干枯，烧开却会伤到下方净水根。","a":"摆开药盆，依次浸洗衣物","b":"湿布盖住根部，点燃枯藤"},{"title":"母根之心","text":"母根包着祖师留下的一颗灵心，跳动已慢得像冬眠。它原本只陪药圃度过荒年，却与根系缠了数百年。残留的意识想歇息，山谷结界还随着它的节律明灭。","a":"逐段解开根须，摆上替代灵石","b":"将灵心接入自己的护心环"},{"title":"春药初成","text":"第一批新药苗成熟了，山上守阵者与山下病房都在等药。轮流送药要反复越过瘴谷；祖师的催芽法能再开一炉，却会让施术者的灵息长期留在药圃。","a":"分好药篮，约定轮送时辰","b":"展开催芽图，将掌心贴向母根"},{"title":"断剑来信","text":"你领到一柄刻着陌生姓名的断剑，剑里住着迷路的残魂。山下有人认出剑穗，守阵同伴却已等在登山口。残魂只记得一段山路，不记得自己为何在此。","a":"带剑回山下，请来认得剑穗的人","b":"携剑上山，沿残魂所指的路查看"},{"title":"剑鸣花簿","text":"剑库半夜齐声报出花名，与铸剑园里的枯萎顺序相同。剑阵借了花木的灵息，早已错过换石时辰。新弟子仍按旧谱练剑，窗外的归墟兽正沿阵光徘徊。","a":"叫来弟子，一同核对换石记录","b":"打开石匣，重接剑阵灵路"},{"title":"剑冢微光","text":"剑冢里的游魂被乱石压住，借剑阵残光勉强维持形貌。拔剑会让山口防护变薄，老剑灵请你先接走快要散形的几个。旁边空着的剑槽，正好能放入同行者的佩剑。","a":"与同伴商量，把佩剑放进空槽","b":"拔出魂剑，沿石阶逐一接引"},{"title":"月下剑痕","text":"老剑师的伤痕在月下映出上次塌阵的经过，其中也有他修错阵纹的一刻。他愿意重看，却怕后半段被惊惧打断。你手中还留着那天的器物清单，只是许多字已模糊。","a":"陪他逐段回忆，再核对清单","b":"展开照魂镜，映出整段剑痕"},{"title":"一火两壶","text":"两队剑修隔着篝火烘衣，一队惯用轻剑，一队惯用重剑，合阵时总错半拍。山口今夜需要有人值守，旧阵谱也该重抄。年轻剑师已把自己的热茶放在最外侧的位置。","a":"先接山口夜班，请两队慢慢试谱","b":"把两种剑式排入同一套步法"},{"title":"独剩一鞘","text":"撤离路上只剩一只养魂剑鞘，重伤同伴的魂魄与一群迷路剑灵都需要它。剑灵报着故乡的山名，同伴说自己还能坚持，抓住衣袖的手却在发抖。身后的雾正吞没来路。","a":"扶同伴靠近，将剑鞘贴住心口","b":"唤剑灵入鞘，记下它们的山名"},{"title":"回锋之信","text":"剑客寄回师门的平安信带着寻踪香，引来沿香觅食的雾兽。他直到看见空掉的营棚才明白缘故。信里还有通往内峰的路线，他把信与剑一同放下，不敢抬头。","a":"请他说明经过，重画行路图","b":"取出寻踪香，系在远处的木鸢上"},{"title":"千剑倒悬","text":"剑阵被黑潮扰乱，剑尖纷纷转向山脚的灯火。弟子们尚能握住各自佩剑，却难以同时撤下阵纹。总剑悬在风口，剑柄周围的灵流已卷成漩涡。","a":"与持剑者并肩稳住各处阵纹","b":"登上风口，握住总剑剑柄"},{"title":"同练一剑","text":"剑修们围着新剑碑练合阵，有人想各自听潮调整，有人惯于跟着领剑者的呼吸。真名刻入碑后，灵息便会相连。你试着抬剑，远处几盏灯同时晃了一下。","a":"在碑上刻下轮换呼应的剑谱","b":"将自己的剑势接入主纹"},{"title":"问剑山门","text":"旧教习守着山门的试剑阵，阵纹已经磨损。按原式走完独练便能开门，侧崖也有通往门枢的小径。教习抽出木剑，提醒你上次受伤的肩还未完全恢复。","a":"接过木剑，与教习走完剑式","b":"请同伴照看崖边，沿小径找门枢"},{"title":"剑祖遗刃","text":"遗刃里封着剑祖的残影和多年剑鸣。拔刃能拆开纠结的魂线，积累的回声也会一起涌出。剑祖说可以先借你的剑鞘安歇，残影却已分不清几位旧友的名字。","a":"轻拨魂线，逐一送走剑灵","b":"举起剑鞘，接住遗刃的回声"},{"title":"收剑之日","text":"剑阵终于平稳，剑灵们围着归乡图，有的想留山看下一季桃花，有的早已惦念旧居。守阵人正在清点备用灵石，空剑槽比预想的多。窗外传来收剑铃声。","a":"展开归乡图，逐个询问剑灵","b":"添上灵石，请剑灵再陪一轮巡山"},{"title":"河灯初渡","text":"你乘船到眠江，河灯写着亲友的名字，被逆流推回渡口。孩子的一盏灯卡在水草里，船夫正催着趁涨水前启航。河伯指向上游，说今夜灯火走错了水路。","a":"替孩子捞灯，留船查看水流","b":"撑船离岸，沿河灯的方向追去"},{"title":"水下旧村","text":"退潮露出一片屋脊，水下的旧村被泡影包住，灶火竟还亮着。村人不知外面过了多少年。泡影连着堤脚，贸然碰破会卷起急流，你在门旁找到当年的迁居草图。","a":"照草图寻找浅道，联系岸上亲友","b":"游到泡影边缘，试开一道水口"},{"title":"沉舟童声","text":"送孩子游学的小舟沉在江心，护水符还亮着，船链却缠住水门。孩子隔窗挥手，老船夫认得一股能穿过船舱的暗流。岸上的救援灯正一盏盏靠近。","a":"随船夫潜入暗流，逐个背出孩子","b":"割开船链，扶住船身上浮"},{"title":"逆鳞回声","text":"河泽半妖的断鳞记着江底裂响，离水太久便会干裂。岸上照影台能看清鳞纹，却离河很远。你可以沿水路寻找同样的响声，也能借船上的水盆把断鳞送到台前。","a":"陪半妖沿水路比对回声","b":"装满水盆，把断鳞带往照影台"},{"title":"上下游看潮","text":"上游闸前积着黑潮，下游芦田刚抽新芽。开闸能卸去水压，却会冲过芦田；绕行渠尚差最后一段。你手里的调水印渐渐发热，挖渠人站在齐膝的泥中。","a":"挽起衣袖，与众人接通绕行渠","b":"站到闸台，转动调水印"},{"title":"一口活泉","text":"江岸只剩一口未染瘴的泉，旅人需要饮水，受伤河伯也等它洗去鳞间黑痕。河伯把水防图放在石头上，自己缩回阴影。乌云压低，救援船还没有出现。","a":"分装泉水，照水防图巡堤","b":"用泉水清洗河伯的伤口"},{"title":"错听潮时","text":"向导听错了潮声，让两艘船走进回流。他取出旧潮簿，承认耳鸣已有数日；船家盼他马上说清，水门里又响起异常的咔哒声。只有他还认得那套老机关。","a":"陪向导说明误差，再一起修门","b":"请他留在船头，以哨声试探回流"},{"title":"江水向天","text":"眠江向天空倒流，船只与岸屋慢慢浮起。河伯只能稳住一岸，另一岸需要真名钉住水脉；完整调水印则藏在漂浮的神龛里。你的脚边已有石子离地。","a":"在岸石上写下真名","b":"跃向神龛，取出调水印"},{"title":"同看水痕","text":"船家、河泽朋友与守阵弟子围着闸印，各自熟悉一段水势。闸印可拆成三枚小印，也能保持完整，让同一人顺着潮声调节。旧水痕还湿着，众人正找新的停船位置。","a":"拆开闸印，分别试响潮铃","b":"握住整印，沿闸边听潮"},{"title":"无岸之门","text":"阵心入口藏在深水中，渡魂术能让众人短暂穿过水壁，却可能搅乱记忆。抽干河湾也能露出石阶，湾里的鱼卵还没有孵化。同行者把想记住的名字写在手心。","a":"与众人核对姓名，施展渡魂术","b":"引水离湾，寻找水下石阶"},{"title":"潮眼旧梦","text":"江神的长梦绊住了河道，她想醒来，江水却可能随她翻身改道。岸边人家正在收拾行李。旧梦匣还留着稳水曲，你可以陪她缓缓醒转，也能先续完这段梦。","a":"接好岸边渡船，轻唤江神","b":"打开梦匣，接续稳水曲"},{"title":"归江看水","text":"调水印在掌心软化，最后一次落纹能让河道继续固定，也能让江水回到自然弯曲的旧路。新岸需要重新找住处，守在潮眼则是长久的差事。渡船里放满故乡的盆栽。","a":"标出新岸路线，陪众人移船","b":"坐入潮眼，扶稳将冷的调水印"},{"title":"游记重名","text":"白鹿城的游记册把你的名字写了两遍，一页记着今晨，一页记着百年前的山行。抄书人怀疑墨灵把两段故事叠在一起。错页中的你竟知道一条通往旧档室的小路。","a":"与抄书人逐页查找同名记录","b":"照旧页的小路去找档室"},{"title":"空白的家谱","text":"受潮的家谱一片空白，手掌贴上去时才浮出旧名。恢复墨色会同时唤起遗忘的往事，有人期待，也有人还未准备好。一个熟悉的名字正在纸边慢慢变淡。","a":"按各家意愿分批温干册页","b":"展开整册，点亮定墨灯"},{"title":"纸页中人","text":"墨灵误把几名读书人收进游记，翻页时他们才能换气。剪断装订线就能放人，却会散掉同册的寻路图。页内的小童已困得闭眼，老人仍指着图上一处回家标记。","a":"先誊下寻路图，再拆装订线","b":"剪开装订线，摊平所有书页"},{"title":"画不完的面容","text":"老抄书人想画出引他进山的朋友，记忆却每画一笔便淡一些。画到眼睛时，他已想不起当年的约定。印章盒里或许还有那人的落款，眼前画纸却正透出微光。","a":"放下画笔，打开印章盒","b":"握稳画板，陪他画完面容"},{"title":"一桌旧册","text":"众人想把零散游记合成寻亲册，里面却夹着许多不愿给旁人看的家事。完整册页便于比对错名，单独抄录又可能漏掉线索。几位失散者的亲友已经等到灯芯烧短。","a":"遮住私事，逐项核对寻路线索","b":"铺开原册，请在场者一起辨认"},{"title":"定墨纸一张","text":"只剩一张定墨纸，年轻抄手想保住母亲写的药方，老学者的残页上却有阵心古文。潮气正从两张纸的背面渗出。抄手曾帮你找路，学者正努力口述快要消失的字。","a":"把母亲的药方覆在定墨纸上","b":"把阵心残页覆在定墨纸上"},{"title":"墨迹的方向","text":"同伴把未校对的抄本送入传书阵，错路已出现在几处客栈。他以为提早送出能帮到更多行人，没想到墨灵会照着错字变路。你手中还有他的原稿与一盒退墨粉。","a":"叫来收信人，一起核对原稿","b":"把退墨粉送入传书阵"},{"title":"满城失名","text":"墨雨落过街巷，人们开始忘记常用的称呼。保住的家谱只能照亮一条街，邻里互述往事可慢慢续墨。你也能用自己的名字作引，让墨光一次铺过所有屋檐。","a":"请邻里彼此讲述，沿街添墨","b":"在家谱首页写下自己的真名"},{"title":"各自的书页","text":"寻亲册修好了，大家商量把原页带回家还是合订存放。分存便于随时补记，合订更易寻找旧线索。医女拿来一叠新写的访客地址，纸上还有没干的墨点。","a":"归还原页，另抄寻亲索引","b":"装订总册，放进防潮匣"},{"title":"姓名深门","text":"书中门要借一个真名才能打开，借名者会暂时被熟人忘记。同行者愿意试，门旁也留着一位游魂的名字，但它正等人送自己归乡。门缝里有温暖的风吹来。","a":"给同行者留下信物，请他念出真名","b":"把游魂的名字写到门上"},{"title":"最初的借书笺","text":"阵心旧册原是一份借墨约定，百年未归的墨灵把借期误当成长梦。唤醒它只能稳住一季，继续以自己的名字续梦则可让阵纹保持原样。笺尾写着归来时请敲三下门。","a":"敲响书案，唤墨灵看借书笺","b":"在续梦页写下自己的名字"},{"title":"空册新页","text":"墨灵终于归来，空册上可逐年记录大家愿意留下的故事，也能由你一人续写连续的守阵长卷。前者时有断页，后者会让你的梦再难与册中梦分开。桌边的人各握着一支笔。","a":"把空页递给围桌的同伴","b":"铺开长卷，独自续写阵纹"},{"title":"夜市妖灯","text":"夜市灯中困着一位走失的半妖，摊主以为只是会说话的灯灵。灯光正照着唯一不生瘴的路，半妖却认得远处村名。摊主找来拆灯工具，也放下一盏可替换的普通油灯。","a":"买下灯盏，带着半妖去村里寻亲","b":"拆开灯罩，请半妖指认来路"},{"title":"蜕皮里的字","text":"你在河滩拾到写满名字的蜕皮，原来归墟侵蚀会让人逐渐变形。一个孩子认出母亲的字迹，诊所还把这种变化当作寻常换鳞。河边传来新的呼唤，药师正在点灯。","a":"带孩子与药师一起查验蜕皮","b":"拿着蜕皮赶往换鳞池"},{"title":"藤网之下","text":"藤网缠住了几位沾染瘴气的旅人，越挣扎便越紧。妖医能教人分担侵蚀，网外也有一条通往荒山清泉的小径。雨快下了，藤叶上的黑斑正在蔓延。","a":"随妖医坐下，替旅人疏导瘴气","b":"斩开藤结，带旅人去找清泉"},{"title":"断角里的山路","text":"断角里留着一次山崩的记忆，接回去便能看见失踪者去向，却会使持角者重新感受那夜的惊惧。他捧着断角，请你在自己说停时握住他的肩。","a":"陪他逐段回忆，随时记下路标","b":"展开照影屏，请他映出整段山路"},{"title":"篱下邻居","text":"人族与河泽朋友同住避雨棚，旧驱虫符却让长鳞的客人刺痛，撤符又怕瘴虫飞入。妖医带来改符配方，村人则准备了细纱。屋外黑雾已爬到篱笆顶。","a":"与妖医逐张改符，轮流守门","b":"围起细纱，集中照看棚内客人"},{"title":"还形药","text":"一剂还形药能帮孩子舒展新生的骨节，也能让向导收起鳞翼，钻入狭窄阵缝。下一炉要等月食，你的灵息还能催开一朵药花。孩子的母亲正替向导缝护膝。","a":"将灵息送入药花，点起第二炉","b":"把药递给向导，替孩子敷上湿布"},{"title":"咬痕的主人","text":"夜间有人被咬，探路少年发现自己的牙印与伤口相似。他记得睡前已锁好护栏，栏上却留着新焊痕。受伤者需要照看，少年也怕自己梦中再次变形。","a":"陪少年查验护栏，记录昨夜经过","b":"先布好隔护阵，再检查各处焊痕"},{"title":"镜光照鳞","text":"照瘴镜失准，河泽朋友与受侵蚀者都被照得睁不开眼。镜光仍挡着墙外黑雾，妖医说灵视可以滤去刺眼的光，镜座也留有转向荒坡的旋钮。","a":"与修士合起灵视，调柔镜光","b":"转动镜座，让光落向荒坡"},{"title":"林间新居","text":"河泽朋友需要湿地，山间旅人需要干燥屋基，眼前可住的林坡却很窄。旧图标着早已变浅的水道，照图搭屋方便，实地重勘又要等一轮潮退。众人各抱着一卷铺盖。","a":"放下铺盖，一起重勘水道","b":"依旧图先搭屋架，再逐间试住"},{"title":"骨门听声","text":"骨门被紊乱的灵息堵住，半妖靠近便疼。归墟浅层另有旁路，会传来故人的呼唤；重铸门枢也可开路，但第一位触门者要接住乱流。长者递来结绳与铸锤。","a":"接过绳子，与众人走旁路","b":"拿起铸锤，重铸骨门门枢"},{"title":"山中旧友","text":"阵心的巨大灵兽还记得自己做守阵人的日子。多年侵蚀让它不能离阵，也让附近草木不断长出鳞片。它想看看没有阵光的月亮，你能慢慢分导瘴气，也能先以自身灵息接替。","a":"摆开导瘴石，陪它逐步移出阵心","b":"走入阵中，接住它身上的瘴气"},{"title":"人间异客","text":"潮退后，有人仍留着鳞翼，住回旧屋才发现门太窄、床太短。河边新棚宽敞却远离旧友，城里的木匠也愿意改屋，只是人手有限。众人摊开各自想住的地方。","a":"听大家说完，分别安排看屋","b":"带木匠逐户量门，改造旧屋"},{"title":"失星之夜","text":"听星童子第一次登台，天上便暗了一颗星。老看星人说可能是云层遮挡，洗衣老人却捡到缠着白发的小袍。孩子们还在台后练曲，你听见其中一个唱错了回家的地名。","a":"去台后找孩子，问清昨夜所见","b":"披上观星袍，登台追寻暗星"},{"title":"星图缺口","text":"百年星图画满避潮路线，边角却有大片空白。台主一直沿用熟悉的推演，未画出的道路从没人走过。你看见一条旧路正经过沈照的住处，墨迹还在随潮色移动。","a":"摊开星图，请熟悉各地的人补记","b":"取下主图，重新摆放推演星石"},{"title":"月井求援","text":"练习听星的孩子困在映月井，封条误把童谣当成潮警，越唱越紧。有人替他们续完长曲便能缓缓解封，直接撕开封条也能开井。远处潮铃与歌声已经混在一起。","a":"俯身井边，接着唱完长曲","b":"握住封条，沿井口慢慢撕开"},{"title":"明日的火光","text":"星官看见明日档室起火，却不知是灯油还是幻象。燃亮照影眼可映出更多细节，另一个办法是今晚守在档室查看。她揉着发痛的眼角，把钥匙和星镜一同交来。","a":"带水桶去档室，守着灯台","b":"扶稳星镜，陪星官继续照影"},{"title":"未走的岔路","text":"星图里，年轻守阵人多年后会把阵纹接错。眼下他正背着伤者，听见预言后连手都不敢伸向阵台。旧图从未记过人听见预言后的变化，你身边还空着一套练习器具。","a":"请他放下伤者，一起重练接阵","b":"先请他休息，由你检查阵台"},{"title":"唯一吉日","text":"今夜星门最稳，同伴却困在坍塌的山屋里。他托纸鹤送来口信，请你先走，纸鹤的翅膀已被落石擦破。星盘可以延长开门时辰，远处云层却会随之翻动。","a":"收起纸鹤，赶往山屋","b":"转动星盘，续接门边星光"},{"title":"选错的星路","text":"星官承认最初按旧图引你走路，后来才发现每次改图都把你带回同一个险坡。她交出推演记录，不再敢替你指路。大家曾靠她避过风雨，眼下仍等着熟悉的手势。","a":"摊开记录，与同伴重新认路","b":"照旧图走到险坡前，另设探路标记"},{"title":"日轮停转","text":"观星台反噬，正午的太阳不再移动，影子里走出人们梦过的模样。台主找不到停止的方法。彼此确认真实经历能稳住心神，拆开星盘也能散去异象，盘上的潮期却尚未抄完。","a":"沿街与众人互述今日经历","b":"登台拆开星盘"},{"title":"不问吉凶","text":"同伴想在登阵前再占一次，听星童子却说每报一个答案，星路便暗掉一条。大家开始根据旧卦分配前后位置，你也不确定今晚的风会向哪里吹。星盘仍有一次推演的余光。","a":"合上星盘，与众人实地试路","b":"点亮星盘，查看全队星路"},{"title":"昨日的门","text":"星门浮出与你最亲近之人的面容，借走那次相遇便能开门。另一个入口需要你支取十年寿数。对方站在身边，认真端详着门上那张还很年轻的脸。","a":"把手放在明日入口的星纹上","b":"将那次相遇送入门中"},{"title":"天外空座","text":"星门后只有历代星官的推演残影，空座仍在计算最稳的一条路。坐上去可能看见更多，却也容易忘记离开的时辰。座旁的星索可以由同伴拉断，远处传来尚未辨明的潮声。","a":"卸下空座星石，与同伴走向潮声","b":"请同伴握住星索，坐入空座"},{"title":"没有预言的晨光","text":"最后的星图显示旧阵还能稳住二十年，之后必须再修；拆阵后的星路则没有颜色。山下的人正收拾渡船，山上仍有人想留下照料药圃。两把启动钥匙在你手里渐渐变暖。","a":"带两把钥匙下山，与众人查看退路","b":"插入续阵钥匙，记下下一次检修日期"}],"endings":[{"title":"众灯守夜","text":"你们把山下照护与山上修阵接成了轮班。天衡大阵仍会漏进冷雾，第一冬的新盐也不够干，大家只得轮流添炉。你曾想独自顶过最冷的夜，沈照却按时来接班，带着一锅已经结皮的粥。后来各村学会辨认潮色，孩子能替大人送换班纸条。你的名字留在值夜簿上，后面空着下一位同伴的位置。归墟未尽，灯却不必由同一双手一直举着。","hint":"支持项（每项一分）：第1节点「救助眼前的弱者，建立互助基础」、第4节点「加入山下照护队，承诺共享资源」、第5节点「将储备交给互助网络」、第6节点「照护同行者，践行早前约定」、第8节点「协调山下照护队与守阵修习组，建立撤离通道」；第一、二幕各至少一项；公共结算：每方向至少命中两项不同早期行动，且第一、二幕各有支持；优先兑现第三幕声明的已建立方向，否则按命中数降序；同分按共同生还、长期主理、带伤远行、查明往事、以身承接、余生守望顺序。无方向建立才兜底余生守望。身份、关系、秘密满足原条件时优先，不满足则按此公共比较结算。"},{"title":"长明的阵灯","text":"你接下总阵的日常照管，把盐脉、药根与剑石接成一套清楚的巡检次序。道路重新可走，许多人终于睡过整夜，你却常被半夜的裂响惊醒。一次漏看药根水位，整片花叶枯了，你才知道熟练也不能包办一切。晚年你开始教徒弟听辨细微的阵鸣，仍保留最难的总轴检修。灯火稳定地亮着，桌上的交班册却总还没写完。","hint":"支持项（每项一分）：第1节点「整理修阵物资，与守阵修习组协作」、第4节点「加入守阵修习组，共同照看阵台」、第5节点「建立守阵修习组应急储备」、第6节点「先处理修阵事务，与守阵修习组协作」、第8节点「整理检修记录，协助守阵修习组的工作」；第一、二幕各至少一项；公共结算：每方向至少命中两项不同早期行动，且第一、二幕各有支持；优先兑现第三幕声明的已建立方向，否则按命中数降序；同分按共同生还、长期主理、带伤远行、查明往事、以身承接、余生守望顺序。无方向建立才兜底余生守望。身份、关系、秘密满足原条件时优先，不满足则按此公共比较结算。"},{"title":"山门成渡","text":"你带着可搬动的封墟器离开仙山，旧殿成了最后一批行旅登船的码头。屋里的井搬不走，许多人离岸后仍回头张望。你把未找到的姓名交给每艘船，也承认有些回声再没有应答。数年后海边长出新聚落，旧剑架被改成避雨棚。归墟仍在远山翻涌，你每年乘船回看一次，然后把新测的水位添在回程图上。","hint":"支持项（每项一分）：第3节点「依靠普通技能，不调用天赋」、第4节点「加入山下照护队，承诺共享资源」、第6节点「离开同行者，保全自己」、第7节点「停止研习，照顾自己的身体」、第8节点「协调山下照护队与守阵修习组，建立撤离通道」；第一、二幕各至少一项；公共结算：每方向至少命中两项不同早期行动，且第一、二幕各有支持；优先兑现第三幕声明的已建立方向，否则按命中数降序；同分按共同生还、长期主理、带伤远行、查明往事、以身承接、余生守望顺序。无方向建立才兜底余生守望。身份、关系、秘密满足原条件时优先，不满足则按此公共比较结算。"},{"title":"石壁留声","text":"你与闻灯将盐仓、药圃和旧阵中的记录逐一比对，终于查明那场连环失衡。曾经救过人的办法，也曾在不合适的时节造成伤害，记录里两者都留下了。山脚开起记事馆，家属能补写姓名，也能把不想展出的信带走。你常陪来访者听一段不完整的魂音。它不能使故人复生，却让一些等候多年的人知道最后一盏灯曾亮在哪里。","hint":"支持项（每项一分）：第1节点「保留异常证据，开始调查」、第4节点「加入山海记事馆，承诺保全证据」、第5节点「公布第一份证据」、第8节点「展示调查记录，与同伴共同核对」；第一、二幕各至少一项；公共结算：每方向至少命中两项不同早期行动，且第一、二幕各有支持；优先兑现第三幕声明的已建立方向，否则按命中数降序；同分按共同生还、长期主理、带伤远行、查明往事、以身承接、余生守望顺序。无方向建立才兜底余生守望。身份、关系、秘密满足原条件时优先，不满足则按此公共比较结算。"},{"title":"二十年借期","text":"你以自己的修为给大阵留下二十年的余量，潮声安静了，身体却再不能像从前那样御剑。起初大家忙着修屋种田，替代阵器进展很慢。第十年你卖去闲置的旧剑，为炉坊添新料；第十九年，第一组凡铁阵器终于能稳住一处裂口。它离替下整座大阵还很远。最后一个冬天，你带着旧图继续试验，孩子帮你重描已经褪色的检修日期。","hint":"支持项（每项一分）：第3节点「以当前身份研习天赋，接受其负担」、第6节点「照护同行者，践行早前约定」、第7节点「继续研习天赋并承担负担」、第7节点「过度调用天赋，换取紧急资源」；第一、二幕各至少一项；公共结算：每方向至少命中两项不同早期行动，且第一、二幕各有支持；优先兑现第三幕声明的已建立方向，否则按命中数降序；同分按共同生还、长期主理、带伤远行、查明往事、以身承接、余生守望顺序。无方向建立才兜底余生守望。身份、关系、秘密满足原条件时优先，不满足则按此公共比较结算。"},{"title":"裂隙以后","text":"归墟退到山谷尽头，你在一间漏风的小屋住下。眼前还有田要种，也有失散的人要找。有人愿意与你喝茶，有人谈起那夜仍难过，你没有急着解释每次选择。春天比别处晚来，新苗常被冷雾伤着。你把核实过的消息写在门边，空行留给仍在寻找的名字。余生没有忽然清楚的答案，只有晨起后再去查看一次河边的灯。","hint":"支持项（每项一分）：第3节点「依靠普通技能，不调用天赋」、第4节点「加入山下照护队，承诺共享资源」、第5节点「将储备交给互助网络」、第7节点「停止研习，照顾自己的身体」、第8节点「协调山下照护队与守阵修习组，建立撤离通道」；第一、二幕各至少一项，或所有公共方向均未建立时兜底；公共结算：每方向至少命中两项不同早期行动，且第一、二幕各有支持；优先兑现第三幕声明的已建立方向，否则按命中数降序；同分按共同生还、长期主理、带伤远行、查明往事、以身承接、余生守望顺序。无方向建立才兜底余生守望。身份、关系、秘密满足原条件时优先，不满足则按此公共比较结算。"},{"title":"凡铁问山","text":"反复练习后，你把最后一柄魂剑送回故乡，腰间只留会生锈的凡铁。照护队帮你搭起练剑棚，新弟子先学收剑和呼唤同伴，再学独自站稳。雨夜旧伤发作，你也得请别人替班。多年后，学生带着各自修好的佩剑回来，把巡山册放在桌上，问你愿意走哪一段。你选了有老梅树的山路，出门前认真检查了鞋底。","hint":"以「带着师门旧剑的外门剑徒」开局；第一幕研习身份技艺；第二幕继续研习；第三幕整合技艺；身份技艺达到 3；所属阵营支持至少 4，技艺有实际服务对象；天赋负担不超过 6；终幕选择「以身份技艺服务所属阵营」。"},{"title":"百草相传","text":"你把缝魂与辨药的经验抄成小册，带回最初行医的村庄。药不再像从前那样迅猛，有些夜晚仍等不到退热。你将用错过的方子也写下，收到村医修订时便请他们当面讲解。春末，大家共同补好了几页模糊的草图。你缝起医书，看见自己的手不只能够接住将散的魂，也能把有限的经验交给后来的人。","hint":"以「替亡者缝魂的山村医女」开局；第一幕研习身份技艺；第二幕继续研习；第三幕整合技艺；身份技艺达到 3；所属阵营支持至少 4，技艺有实际服务对象；天赋负担不超过 6；终幕选择「以身份技艺服务所属阵营」。"},{"title":"一页还乡","text":"你练熟校勘后，带着记事馆的散页逐村寻访。有些名字属于活人，有些只剩水边旧墓，也有人已经习惯新称呼。你逐一问清，再把纸递过去。册页渐渐挤满指印、小鱼和涂改。最后一位来领纸的人认出你曾抄错的日期，没有责怪，也没有安慰，只请你帮写一封家书。你磨好墨，等他说完才落笔。","hint":"以「世代抄录山海游记的仙府抄书人」开局；第一幕研习身份技艺；第二幕继续研习；第三幕整合技艺；身份技艺达到 3；所属阵营支持至少 4，技艺有实际服务对象；天赋负担不超过 6；终幕选择「以身份技艺服务所属阵营」。"},{"title":"江有归客","text":"听辨水语成了你日常的手艺。龙宫寄来归家的请帖，你回去住过一季，最后仍把行李放在眠江渡亭。旱季骨节会痛，汛期又要与岸上朋友一起搬船，半妖的身体从未因熟练而变得轻松。孩子们却能同时用水下歌声与岸上话叫你。你慢慢明白，故乡可以不只一处，牵挂也可以顺着两岸往来。","hint":"以「离开龙宫游历的河泽半妖」开局；第一幕研习身份技艺；第二幕继续研习；第三幕整合技艺；身份技艺达到 3；所属阵营支持至少 4，技艺有实际服务对象；天赋负担不超过 6；终幕选择「以身份技艺服务所属阵营」。"},{"title":"盐路留灯","text":"你重新整好旧车，把运盐本领用在最难走的几条山路。照护队备好中途货棚，你不必每夜都赶路，但修车与补货仍常花去积蓄。盐袋旁渐渐多了家书和药包，有时一趟只为送回一把旧伞。晚年你交出车辕，年轻行商问哪处值得歇脚。你指向路边的灯，说那家的炉子今晚应该还温着。","hint":"以「押送灵盐入山的行脚商」开局；第一幕研习身份技艺；第二幕继续研习；第三幕整合技艺；身份技艺达到 3；所属阵营支持至少 4，技艺有实际服务对象；天赋负担不超过 6；终幕选择「以身份技艺服务所属阵营」。"},{"title":"纸舟有岸","text":"你的纸舟终于能载着魂音走远，又不会把它困住。你顺着剑灵记得的河流送它们回家，有些村庄已经不在，便陪它们在桥下多等几个黄昏。后来坟场旁有了小小的记事堂，来人可以留下故事，也可以只是坐着。你为自己留下纸舟的样式，没有画仙鹤，只画一盏窗灯。徒弟照着折好，放在不漏雨的柜里。","hint":"以「守护无名坟场的纸扎匠」开局；第一幕研习身份技艺；第二幕继续研习；第三幕整合技艺；身份技艺达到 3；所属阵营支持至少 4，技艺有实际服务对象；天赋负担不超过 6；终幕选择「以身份技艺服务所属阵营」。"},{"title":"童年迟到","text":"你学会辨认星纹后，终于能离开观星台独自走路。起初街声太响，没人报时反而让你不安，吃饭也常忘了抬头。同行的孩子各有喜好，有人继续听星，有人只想学做面。照护队替你们找到带院子的屋子，你在墙上记身高，也慢慢学着不在每个夜晚寻找预言。多年后回台探望，你带的是一包自己做的点心。","hint":"以「初次独自下山的听星童子」开局；第一幕研习身份技艺；第二幕继续研习；第三幕整合技艺；身份技艺达到 3；所属阵营支持至少 4，技艺有实际服务对象；天赋负担不超过 6；终幕选择「以身份技艺服务所属阵营」。"},{"title":"炉火在人间","text":"你用凡铁铸成可由寻常工匠修理的镇墟器。它笨重，初试时坏过三次，大家挤在漏雨棚里逐件寻找裂纹。修习组继续备料，你也把失败的尺寸留在图上。后来各村都能照图试铸，你的手却因多年炉火难握细笔，只能请徒弟代画。器身最后刻着一行叮嘱：发现裂纹就停下，守阵的人也要休息。","hint":"以「以凡铁修补仙器的炉坊匠人」开局；第一幕研习身份技艺；第二幕继续研习；第三幕整合技艺；身份技艺达到 3；所属阵营支持至少 4，技艺有实际服务对象；天赋负担不超过 6；终幕选择「以身份技艺服务所属阵营」。"},{"title":"同行到白头","text":"你护住沈照，也在往后的日子里继续照护他，最后选择把生活安排在同一处屋檐下。旧伤并未随潮退消失，你们会为出门的时辰争吵，也曾分开过一冬。重逢后，两人把能做与做不到的事说清，再慢慢修屋。头发变白那年，他问你还记不记得最初那场雨。你记得，却也惦记着此刻灶上的汤，于是邀他先回家吃饭。","hint":"第一幕与沈照相识；第一幕结识的人，在第二幕获你保护，第三幕仍守约（信任至少 5）；终幕选择「将共同生活置于使命之前」。"},{"title":"旧誓新席","text":"你与陆衡又坐到同一张桌边，谈起曾修错的阵纹，也谈起他过去不肯听完的提醒。他没有再用教习的身份结束争论，你也不再期待一次谈话就解开所有心结。每月照护换班时，你们共同校一页旧谱，后来才渐渐说到院中的梅树。最后一次告别，他称你为同行者。你替他关好窗，又留下下次会带来的药材单。","hint":"第一幕与陆衡相识；第一幕结识的人，在第二幕获你保护，第三幕仍守约（信任至少 5）；终幕选择「将共同生活置于使命之前」。"},{"title":"隔江相认","text":"你与河泽盟友从争论水路的对手，慢慢成为能互相托付行程的朋友。你曾护住对方，后来也记得每次换药的日子。共同生活没有让口味和习惯变得相同，有次为调水方案争到深夜，仍须回到水位图前重算。多年后孩子们合造一条歪船，请你们题名。两种字并排留着，船到江心时，你望见对岸有一盏熟悉的灯。","hint":"第一幕与河泽盟友相识；第一幕结识的人，在第二幕获你保护，第三幕仍守约（信任至少 5）；终幕选择「将共同生活置于使命之前」。"},{"title":"未被抹去的人","text":"你照护失忆的家人，也接受对方并不因此记起从前。星门带走的相遇被你写进信里，放在可以选择阅读的地方。有些信被退回，有些隔很久才有答复。后来你们在一次修堤时重新熟悉，新的故事不一定沿着旧路发展。你仍会为失去意义的称呼难过。某日对方邀你同行，你收好护符，问这次想去哪里。","hint":"第一幕与失忆的家人相识；第一幕结识的人，在第二幕获你保护，第三幕仍守约（信任至少 5）；终幕选择「将共同生活置于使命之前」。"},{"title":"裂痕上的桥","text":"盐路引路人说清了误听潮时与瞒下耳鸣的经过，你陪他修桥，也没有催旁人立刻释怀。起初你们只谈木料与工期，他会在启程前说明今天听不清哪种声响。一个雨夜，他问桥头是否该添一盏灯，你说该添，便一起取油。往后相处仍有迟疑，信任却在约定的时辰一点点长回来。桥修好后，你们先让一辆空车慢慢走过。","hint":"第一幕与盐路引路人相识；第一幕结识的人，在第二幕获你保护，第三幕仍守约（信任至少 5）；终幕选择「将共同生活置于使命之前」。"},{"title":"归墟听众","text":"两种守阵经历让你重新查验井底回声。你与同伴比对盐晶、药梦和剑鸣，终于发现黑潮里藏着迷路的魂音，并非每一声都在呼救，也并非每一声都想回来。你们在井边奏起没有结尾的曲子，等愿意回应的声音慢慢靠近。有人寻回故友的片段，有人只听见风。黑潮未立刻退尽，你仍按时坐到井边，先听，再记。","hint":"前局发现「public.rescue」；前局发现「public.rule」；第一幕调查冲突根源；第二幕促成阵营协商；收集至少两份证据；终幕选择「用旧日发现调解阵营」。"},{"title":"无人代答","text":"重拾剑艺与照护沈照的经验，帮你读懂了最初的阵纹：它等的不是一句永恒的誓言，而是每次呼唤后的应答。旧墨叠得太厚，许多回声早已被当作新声。你逐层洗去残迹，同伴在山下重新鸣铃。阵光忽明忽暗，直到当下的回应汇合。此后修阵仍会出错，却不必沿用百年前的回答。你收起旧剑，认真听完眼前人的话。","hint":"前局发现「identity.1」；前局发现「relationship.1」；第一幕重拾技艺；第二幕继续研习；第一幕结识的人，在第二幕获你保护，第三幕仍守约（信任至少 5）；终幕选择「承接前世身份与未竟承诺」。"},{"title":"空座留尘","text":"旧日空座上的耗损与照护陆衡的记忆，让你这次给推演定了时辰。约定一到，同伴便拉断星索，哪怕你仍觉得只差一步。醒后，你忘掉大半计算，也失去熟悉的能力。你封存观星台，改与大家一起测量潮色。偶尔仍想坐回去寻找最好的答案，你便翻开那夜留下的记录。院里空座渐渐积尘，你终于能在没有结论的傍晚回屋休息。","hint":"前局发现「public.sacrifice」；前局发现「relationship.2」；第一幕结识的人，在第二幕获你保护，第三幕仍守约（信任至少 5）；第二幕停止透支；第三幕接受能力限制；终幕选择「以旧日关系记忆解除天赋束缚」。"},{"title":"故人仍有姓名","text":"三次旧日发现合在一起，你与闻灯沿着重复的魂音找到了第一场塌阵的遗迹。失踪者的残响散在盐、药、剑与水中，正是它们让星门一再走回同一个清晨。你们逐一核实姓名，送回能归家的魂，陪不能归来的声音散去。并非每个家庭都等到完整回答。闻灯把去向记入不再重置的值夜簿，关闭最后一处回声环。下一次潮来时，你们会记得今天，也会真的慢慢老去。","hint":"前局发现「secret.reconcile」；前局发现「secret.inherit」；前局发现「secret.liberate」；第一幕结识记录者；第一幕结识的人，在第二幕获你保护，第三幕仍守约（信任至少 5）；第一幕调查轮回；第二幕展示轮回线索；终幕选择「请记录者见证并终止轮回」。"}],"turns":{"calling":{"title":"炉边的旧匣","text":"炉坊师傅打开一匣凡铁补片，邀你接学修补仙器的手艺。最细的裂缝要听上一整夜，入门后每个冬天都得留在炉边。盐路引路人也在等答复，他的商队缺一位辨认岔路、照看货单的同行者，明早便出山。","options":[{"label":"接下补片匣，留下学修仙器","aftermath":"五年后，炉坊挂着你做的裂纹听音架，第一位学徒已经能独自补好剑镡。你每冬都守着慢火，商队寄来的山外游记仍只读到半卷；师傅退下来的那张工作台，如今由你每日开工。"},{"label":"谢过师傅，随盐队改做行商","aftermath":"五年后，你经营着往返河泽的盐货生意，货单背面记满各家客栈能容下何种身形。那只补片匣留给了炉坊另一位学徒；你寄回的第一笔货款，换成了自己商队的一辆防潮货车。"}]},"bond":{"title":"灯下的认字笺","text":"与你相伴过山路的闻灯，近来常认不出自己的住处。药师说，疗养需要有人多年陪他辨认旧物，不能只送几次药。闻灯把你们用过的路笺摆在灯下，说愿意与你同住，也已托好谷中照护者；他不想用这场病替你决定去留。","options":[{"label":"与闻灯同住，接下长期陪护","aftermath":"四年后，你们的门框上挂着逐季更换的认字笺，你每天收工都陪闻灯认一件旧物。你推掉了整季驻山的差事，只接能当日往返的活；闻灯仍会认错路，却已连续两个春天记得为你留一盏灯。"},{"label":"与闻灯告别，让彼此另过生活","aftermath":"四年后，闻灯住在药谷的合居院，你们分别时留下的路笺成了他床边的辨物册。你在另一条盐路上工作，住过三处驿舍；每逢清点行装，都由你独自处理从前两人分管的那份行李。"}]},"home":{"title":"浅水旁的屋基","text":"河泽朋友在林坡替你留出一块屋基，浅渠与干台可以依你的起居习惯改造，但留下就要每年清淤、修挡潮篱。远行的船家也愿载你迁往下游暖湾，那里有空屋，却没有认得你旧日称呼的邻居。","options":[{"label":"留下建屋，与邻里轮流清渠","aftermath":"六年后，你的屋子跨在浅渠与干台之间，门口那段挡潮篱每年都由你修补。邻居把备用钥符寄在你这里，你再没赶上整季的远游；新生的小妖已经把你家廊下当作放学等雨停的地方。"},{"label":"告别林坡，乘船迁居暖湾","aftermath":"六年后，你住在暖湾旧渡口改成的长屋，窗外是亲自移栽的耐盐芦苇。林坡那块屋基已成邻里的晒药场；你学会了下游的潮时，寄回旧友的信总要等每月第一艘上行船。"}]}},"episode":{"title":"废材买走了镇店废铁","source":"web-original","opening":{"title":"三枚铜钱的破炉","text":"你替鉴宝铺看柜那天，学徒牌还挂在柜角。鉴宝铺里，你的灵根测签被少东家踩在脚下。他刚夺走你的学徒牌，又把一座破炉踢到门外：废材配废铁，三枚铜钱拿走。你掏空口袋，炉底却在掌心映出一行小字：本炉只炼废丹。此时店内新丹开售，第一位客人刚吞下丹药，手臂便结满黑晶。少东家猛地指向你：是他碰过丹柜！","a":"把破炉搬到柜台上","b":"捡起客人掉落的半颗丹药","attributes":["声望","理智"]},"followups":[{"title":"废炉开口","text":"你把柜边废丹扫进炉里，炉火没有吞噬灵力，反倒沿着丹渣烧出一张配料单。少东家扑来盖炉，客人却拦住他的手：单上为什么有禁售的黑晶砂？炉口随即滚出一颗透明小丹，病人的黑晶竟朝它倾斜。铺中鉴师当场取下少东家的售丹牌，又伸手要拿那颗丹。破炉忽然烫了你一下。","a":"把透明小丹递给病人","b":"用铁钳夹起炉底的丹渣","attributes":["羁绊","实力"]},{"title":"铜钱上的缺口","text":"半颗丹药落进破炉，吐出的不是药香，而是一缕黑烟。烟里显出少东家换料时戴的缺角指环，他立刻藏起右手。客人围住柜台，你却发现买炉的铜钱也有同样缺口：这枚钱是你失踪师父留下的。炉腹弹出两层暗格，上层夹着旧购料凭据，下层压着一枚仍在发热的传音片。","a":"展开旧购料凭据","b":"按住发热的传音片","attributes":["声望","命势"]}],"codas":["小丹吸尽黑晶，客人当场付清买炉钱，又排队请你验药。少东家守着被封的丹柜，看你在门外支起摊子。你的第一块招牌只有四字：废丹拿来。","丹渣里夹着鉴师的私印。他伸出的手僵在半空，客人立即扣住账箱。你拒绝接手铺子，背炉离开；当天夜里，退钱的人排过了三条街。","凭据证明破炉本是师父寄售，赎回价恰好三枚铜钱。掌柜退还学徒牌，你把它折成两半，取走师父留下的工具箱，独自开了间修炉铺。","传音片里响起师父的声音：别找我，先把炉底那颗蛋拿出来。你掀开暗格，一条小龙顶着丹渣打喷嚏，整条街的宝器同时朝你低下了头。"]}},{"id":"w2","name":"末日第七天","premise":"白潮将在七日内越过堤城，记忆井的回声却不断混入水、食物与梦境。你与邻里修理设备、照护彼此，寻找带着往事走过潮峰的路。异类可借维护机体行动，以文字或语音交谈。","factions":{"commons":"街区照护队","council":"防潮检修组","archive":"遗言保管室"},"fate":{"characters":["失忆的同行者","共担抽取的导师","守井旧对手","持绳的家人","留城的受托者","遗言抄写员"]},"origins":["重返急救岗位的医生","记忆井维护员","地下水道测绘师","物资站账房","守夜电台播音员","独自追踪白潮的研究员","驾驶旧船的摆渡人","临时学校教师","装在巡检机体中的旧维护AI","替人保管遗言的自走抄写机"],"events":[{"title":"水线一·倒流的清晨","text":"第一天，水龙头吐出陌生的笑声，记忆井报出七天后的潮峰。楼下消防栓漏水，邻居举着空杯，支管另一端的照护所也需要水压。你找到了总阀扳手，水正沿台阶流走。","a":"修紧消防栓，接通照护所支管","b":"关上支管，把漏水引进本楼水箱"},{"title":"水线二·滤芯上的姓名","text":"滤芯混入旧记忆，每转一圈就念出一个名字。清水箱仅剩今天的水，滤芯清洗还要很久。老人盯着一个熟悉的名字，不愿立即冲走那段声音，值班员已备好替换水桶。","a":"先分清水箱里的水","b":"停下分水，拆洗滤芯"},{"title":"水线三·带盐的报告","text":"旧检测纸说明白潮可能让人忘记口渴，眼下送出的水样却仍缺最后一项检测。司机等在门边，照护所的水桶快空了。你能当面说明疑点，也能随车逐户观察饮用情况。","a":"带报告去照护所，先复检水样","b":"随车送水，逐户记录饮水情况"},{"title":"水线四·借来的屋顶","text":"收集雨水最适合的地方是旧观测站屋顶，那里却堆着待修设备。学校屋顶宽些，但要临时挪开上课的雨棚。云已经散开一角，两边的人都带来了工具。","a":"与师生挪好雨棚，装集水器","b":"去观测站搬设备，接上水槽"},{"title":"水线五·漏水的人家","text":"蓄水池少了三桶水，湿脚印通向兄弟俩的住处。哥哥用水洗弟弟的白斑，以为只是没洗干净。墙后旧管仍在滴水，尚未测过水质；照护员正取来干净纱布。","a":"陪兄弟清理伤口，再补记用水","b":"沿墙检查旧管，收集滴水取样"},{"title":"水线六·愿意忘记的人","text":"同伴想用相识的记忆临时驱动净水机，旧接口会使这段往事变淡。他请你做见证，又问以后能否重新认识。走廊还有等水的人，备用手泵已经搬到门边。","a":"陪他去安装备用手泵","b":"在他确认后接好记忆接口"},{"title":"水线七·沉井下的阀门","text":"主干水压归零，故障位于被淹的沉井。记忆电极能照亮水下，却可能搅乱潜水者的往事。地面尚有零散水箱，只能靠人一桶桶搬，天色已经暗了。","a":"召集邻居，接力搬运水桶","b":"含住电极，沿导绳潜入沉井"},{"title":"水线八·阀室里的录音","text":"旧录音提到一套低耗滤水参数，后面却夹着一次大浪测试失败的噪声。站长也没见过完整记录。滤芯已开始发烫，你手上有录音原件和一把可调节流阀的钥匙。","a":"与维修员听完录音，逐项核对","b":"插入钥匙，试调低耗参数"},{"title":"水线九·水车经过的桥","text":"净水车停在老桥前，桥墩正掉灰。两边都有人等水，司机建议卸车分搬，工程师指向可停整车的近岸仓房。潮雾已经遮住对面人的膝盖。","a":"卸下水桶，与两岸的人接力搬运","b":"把车开进近岸仓房，接好分水管"},{"title":"水线十·沉默的水杯","text":"手工用水表漏掉了几名失忆者，他们已不记得如何开口要水。护理员把空杯摆在你面前，另一边修堤人正准备出发。剩余的水不足以按昨天的份量倒满全部杯子。","a":"补上姓名，重新量好每杯水","b":"先装好修堤水壶，再送水到病床"},{"title":"水线十一·潮前的一口水","text":"潮墙高过钟楼，地下池还存着清水。排空池底能减轻主井反压，保留则能供地道里的人过夜。两份估算都有缺漏，同伴把水杯放在你手边，等你查看闸杆。","a":"盖好储池，沿地道布置水桶","b":"缓缓扳开池底排水闸"},{"title":"水线十二·公用的井口","text":"第七天，主井给出两条尚可运行的路线：保留屏障回路，或把电量接往出城旁路。前者会继续消耗接入者的关系记忆，后者通向未测清的潮雾。楼道里仍有人依次来接水。","a":"接通旁路，带着水桶走向出口","b":"接回屏障线，守在井口控制台"},{"title":"诊线一·空白的伤口","text":"第一天，守堤人没有外伤，却忘了回家的方向。他胸口还贴着昨夜接井的记录。诊所只剩几张空床，窗外载着外伤病人的车正在倒车，护士拉开了床间的帘子。","a":"分出床位，陪失忆者核对姓名","b":"先收治外伤，布置走廊观察椅"},{"title":"诊线二·麻药旁的灯","text":"手术室缺电，井电能提供稳定照明，却要经由陪护者的记忆接口。母亲看着腹痛的孩子，反复问那段往事还能不能回来。屋外手摇灯已架好，摇柄转动时光线仍在轻颤。","a":"叫来同伴轮摇手灯","b":"向母亲说明接口，等她确认后接线"},{"title":"诊线三·第二次醒来","text":"病人醒后讲出护士从未说过的童年，自己的姓名却仍想不起。你怀疑主井发生了串写。观察室床位不多，门外的亲友带着热粥，不知还能不能握住他的手。","a":"说明发现，布置单独观察位","b":"安排短时探视，逐人记录反应"},{"title":"诊线四·药箱交换","text":"救援队带着药箱到来，也带着不能久坐的伤员。病房里住着需人喂饭的老人，双方都不熟悉彼此的护理习惯。隔壁地下室尚有空地，却需要清理漏水。","a":"请双方一起安排混住与换班","b":"先接药箱，再去清理地下室"},{"title":"诊线五·不肯疼的孩子","text":"孩子断臂后仍在笑，白潮扰乱了他对疼痛的记忆。母亲想立刻带他登车，护理员却担心他一路乱动。车内只剩一个普通座位，旁边堆着可以改成护具的软垫。","a":"安排专人陪护，固定伤臂","b":"与母亲装好软垫，一起登车"},{"title":"诊线六·你曾救过我","text":"替你值夜的同伴倒在药房，冷藏药是否变质只能靠记忆扫描辨认。扫描可能扰动你们一起离开废墟的往事。他说想再想一会儿，另一张床上的仪器也开始响。","a":"陪他稍作休息，先用替代疗法","b":"握住他的手，再次确认扫描"},{"title":"诊线七·隔离门失灵","text":"白雾涌进通风井，磁锁卡住半层病房。断开井电便能开锁，呼吸设备却须改用手压气囊。维修员正在寻找不需断电的检修口，玻璃内有人举起写着名字的纸。","a":"分好气囊，切断井电开门","b":"维持供电，沿检修口拆锁"},{"title":"诊线八·同意书背面","text":"早期病历把镇静后的短暂反应误记成清醒回答，相关参数一直沿用。护士长找到自己当年的笔记，担心立刻停机影响今夜治疗。亲友们正在等下一次接井说明。","a":"带笔记与家属核对，重做接井确认","b":"先封存原件，逐床检查当前参数"},{"title":"诊线九·病床上的座位","text":"转运车的座位可以拆成担架位，却一次要占几排。司机带着按身体状况整理的名单，卧床工程师与陌生老人都在后页。家属站在车边，认真量着担架宽度。","a":"与家属抽签搭配担架位","b":"按病情和旅途需要安排座位"},{"title":"诊线十·潮前的惊恐","text":"潮声让几位病人不停发抖，诊所只够逐人评估用药。医生也能教照护者安抚与呼吸练习，但他们原本要去修棚。音乐从旧音箱里断续传出，有人捂住耳朵。","a":"叫来照护者，练习安抚与呼吸","b":"请医生逐人问诊，准备镇静药"},{"title":"诊线十一·最后的清醒","text":"潮峰前，病人同时说起相似的梦。研究员怀疑他们正与主井共振，唤醒会短暂改变屏障负荷，继续睡则无法得知梦中体验。女孩拉住你衣角，说想看着窗外。","a":"逐床轻唤，记录清醒后的反应","b":"调低声光，继续观察共振"},{"title":"诊线十二·生命体征以外","text":"第七天，病房可继续依靠主井，也能切换移动设备出城。留井会让已接入的记忆继续模糊，迁移则面临未知路况。护理员仍在核对每个名字，把联络纸贴到床头。","a":"推来移动设备，陪病人沿旁路离开","b":"检查主井接口，守在病床旁"},{"title":"电线一·钟声少了一拍","text":"第一天，全城钟声漏掉一拍。轮流停电时，电梯卡在楼间，里面的孕妇已开始腹痛。隔壁楼的电路还能借用，却连着尚未通知的人家。拆门工具刚送到。","a":"与维修员拆门，铺好接应垫","b":"联系隔壁楼，扳动借电开关"},{"title":"电线二·发电的人","text":"旧发电机既能脚踏，也能接记忆电极，后者才带得动重型水泵。来帮忙的人已经饿了，食堂送来的饭还很烫。值班员想先把机器启动，你握着饭勺与接线图。","a":"先分饭，再讲解两种发电方式","b":"先组织试机，再轮流去吃饭"},{"title":"电线三·不属于机器的热","text":"机组未输出电力却持续发热，温度随邻屋说话声波动。拆机检查要停掉供暖，回收这股热则还没做过测试。前任在阀门上留了一个问号，窗外的水桶开始结冰。","a":"告知邻屋，停机拆开核心","b":"接上小段供暖管，测量出水温度"},{"title":"电线四·两种光","text":"修理铺能拼独立电池，但只能照亮几间屋子。井下团队愿借一条稳定线路，前提是大家一起修完老电柜。学徒还要照看家人，图纸和焊枪都摊在门边。","a":"陪学徒组装独立电池","b":"带图纸下井，接好供电线路"},{"title":"电线五·灯塔的旧线","text":"潮边灯塔接着未标注的旧线，守灯人一直等女儿归航。灯也曾引回两艘小船，诊所冰柜却因同线负载过大停了。守灯人递来日志，海面正有看不清的亮点。","a":"与邻居分出照明电量，续亮航灯","b":"先将线路切到冰柜，检查海面信号"},{"title":"电线六·留在耳朵里的歌","text":"同伴想以停电夜合唱的旧歌驱动机组，接口会带走的不只旋律。你也能接在旁边分担负荷，但两人都可能忘记那晚。值班员拉开隔音门，同伴轻轻哼起第一句。","a":"坐到他旁边，接上另一只接口","b":"替他调好接口，坐在窗外陪伴"},{"title":"电线七·红色的负载表","text":"潮水逼近变电站，泵站与避雨棚通风恰好占用相同功率。临时环路可以轮供，却还没在这样的水位下试过。电工握着线钳，警报复位前只剩一小段时间。","a":"接起临时环路，设置轮供时段","b":"先接泵站，带照明灯去避雨棚"},{"title":"电线八·锁住的余量","text":"机房还有一组未记入总表的电池，连着深度休眠中的旧研究设备。断开可能丢掉未保存的记录，逐台唤醒又会先耗去一部分电。维修员把原图与现图铺在你脚边。","a":"逐台唤醒设备，询问保存进度","b":"备份目录，切出备用电池"},{"title":"电线九·电池的去处","text":"便携电池装满小车，学校需要照明，电台需要发信，闸门也缺启动电。分拆封装会漏电，轮流搬运要经过积水街道。三处的人都带着空接头来帮忙。","a":"画好路线，与三处轮流送电池","b":"把整车推往闸门机房"},{"title":"电线十·开关的接法","text":"主井能把开关接到一个终端，也能保留各段手动切换。前者响应快，接错一处便难当场察觉；后者要反复通话确认。你试着呼叫远端，回来的声音夹着潮响。","a":"逐段确认，保留手动开关","b":"接好总控终端，核对全部线路"},{"title":"电线十一·暗下来的窗","text":"第七天前夜只剩一次大放电。它可点亮撤离路标，也可抬高屏障迎接潮峰，潮峰究竟何时到仍不清楚。窗后有人举起蜡烛，街上积水倒映着细小火光。","a":"将电接往沿途路标","b":"将电接入屏障蓄能器"},{"title":"电线十二·总闸的另一端","text":"核心留下两张线路图，一张把余电分给外出设备，一张继续用记忆接口维持屏障。你可担任后一条线路的索引，却未测试过这样的负荷。工人站到总闸旁，戴好手套。","a":"与工人切开主回路，搬出电池","b":"接上自身索引，合拢屏障回路"},{"title":"粮线一·发芽的面包","text":"第一天，面粉长出白芽，面包里印着陌生饭桌。面包师说已经烤透，大家仍拿不准能否入口。应急饼干只够发一次，你手中这片面包还温着。","a":"打开饼干箱，再检查粮库","b":"切下一小块面包，做试食记录"},{"title":"粮线二·种子的温度","text":"耐潮种子需借鲜明的季节记忆辨认发芽时机。众人可以各接少许片段，也有人愿送来完整的丰收回忆。前者只够少量试种，后者要用持续更久的接口。","a":"请大家分段讲述，种一小盘","b":"陪愿意尝试的人接上育种接口"},{"title":"粮线三·根里的声音","text":"种苗吸收潮水飞快长高，靠近者却不觉得饿。研究员怀疑根网吸走了饥饿记忆，体重并没有恢复。试验区还空着，食堂里的人正问何时能吃到第一餐。","a":"划出对照区，记录体重与饭量","b":"继续照料大棚，逐日检查每株根系"},{"title":"粮线四·食堂门外","text":"搬运队带来菌砖，也想按自己熟悉的方法开火。原食堂的炉子与他们锅具不配，混在一起做要先改灶；分开开饭则需两边各留人。燃料在门外淋雨。","a":"与两边一起改灶，合记食材","b":"先搭两口小灶，分别开火"},{"title":"粮线五·藏起来的鸡蛋","text":"妇人把几枚鸡蛋留在地板下，丈夫失忆后只有敲蛋才想得起做饭。营养员也在为重病孩子寻找蛋白质。妇人拿出平日的食谱，旁边还有几袋未尝试过的豆粉。","a":"留下一枚鸡蛋，与营养员试配豆粉","b":"请妇人带鸡蛋到病房，一同做饭"},{"title":"粮线六·忘记你的口味","text":"同伴愿把食物记忆送进育种机，问你以后能否提醒他过敏的东西。你看见他昨晚留下的半碗粥。小规模催芽不需整段记忆，却还要等上一天，种盘正在升温。","a":"收好接口，陪他照料小种盘","b":"写好过敏记录，再次确认接入"},{"title":"粮线七·温室破口","text":"潮风撕开顶棚，盐雾落向未成熟的幼薯。附近棚屋的保温层可挡住破口，那里也住着怕冷的孩子。提前收割能吃，却留不下这批种薯。园丁把镰刀放到脚边。","a":"拿起镰刀，收下幼薯","b":"与棚屋住户商量，搬来保温层"},{"title":"粮线八·丰收的旧照片","text":"育种室旧照片上的笑脸，与根网连接的记忆样本一一对应。样本正变得模糊，园丁第一次意识到它们并非单纯的温度记录。拔管后作物会萎缩，食堂已经敲响开饭铃。","a":"暂停根网，联系样本主人","b":"先收下成熟作物，再逐管停用"},{"title":"粮线九·修堤人的饭碗","text":"修堤队饿得推不动闸门，食堂却只剩够每人一碗的饭。分出加餐就得有人少吃，轮换轻重活又会延缓工程。几位老人带着小板凳来，说可以帮忙编绳。","a":"重新排轻重活，让修堤人轮休","b":"添好重活饭碗，再送汤到各家"},{"title":"粮线十·最后的种罐","text":"耐潮种子装进罐里，专业园丁与沿途家庭都想帮忙保管。分放能避开一次浸水全损，集中则便于照看温度。孩子画好花盆，问到了高地何时可以播种。","a":"把种罐分给同行家庭","b":"将种罐集中放入园丁的保温箱"},{"title":"粮线十一·种子熬成的汤","text":"潮声盖过食堂，虚弱的人还没力气赶路。最后的种子能煮一顿汤，也能留到有土的地方播下。炊事员没有点火，只把火柴与防水罐并排放在桌上。","a":"打开种罐，点火煮汤","b":"封好种罐，装进远行的背包"},{"title":"粮线十二·一张够大的饭桌","text":"第七天，根网还能依靠接入者的团聚记忆维持作物，旁路则可带着现有干粮离开。留在这里也许有饭，却可能忘记同桌的人。大家摆好最后一轮碗筷，空位比坐下的人多。","a":"分装干粮，扶起同行的人","b":"检查根网接口，留在食堂值夜"},{"title":"界线一·门外的早晨","text":"第一天，一队徒步者到达堤城，行李湿透，有人已经坐不住。需要观察他们身上的潮雾，空床却不多。门旁还有通往高处小站的路牌，只是路况很久没更新。","a":"打开侧门，整理临时观察床","b":"带上物资，陪他们查看高处小站"},{"title":"界线二·想不起的出生地","text":"导航终端仍用童年地名辨认旧路线，失忆者站在屏前迟迟答不上来。邻居认得他们家的门，数据库里也有未损坏的住址。你可以逐人重录，也能先走机器识别出的通路。","a":"请邻居帮忙，重录熟悉的地点","b":"带资料完整的人先查看通路"},{"title":"界线三·回来的脚印","text":"探路队人数未变，鞋底却带着拆除多年的旧街泥。每个人画的转弯都不同，研究员怀疑白潮按记忆改变地形。人们已装好背包，等你把地图贴上墙。","a":"标出疑点，再派小队复测","b":"照现有图整理行装，沿路留下标记"},{"title":"界线四·船主的工具","text":"船主愿意载人绕过积水区，却要先修磨损的缆绳。乘客想趁潮位合适立即出发，有人懂机械，有人会护理，大家还不熟悉船上分工。备用绳就挂在岸边高处。","a":"与船主修绳，安排各人船上工作","b":"先装应急工具，陪船主准备启航"},{"title":"界线五·一只不肯上船的狗","text":"女孩抱着狗站在船边，行李已经称到载重边缘。狗曾在潮雾前示警，却也会紧张乱跑。女孩一件件拿出衣服，船员找来能固定在座下的旧篮子。","a":"与乘客重新整理行李，安置狗篮","b":"把狗带到船头，系好牵绳"},{"title":"界线六·绳子的两端","text":"同伴要进雾里查旧堤路，请你握住引路绳。白潮可能模仿他的声音，暗号又只有你们熟悉。整队共同持绳更容易辨认拉力，他已在绳头打好第一个结。","a":"把绳子传给同伴，一起核对信号","b":"将绳端系在腰间，独自接应"},{"title":"界线七·桥上还剩的人","text":"支架歪斜，工程师担心桥面会把闸门拖垮。桥外的人还在抬担架，底部裂口看不清。切桥装置已接好，救生绳另一头也已落在近岸，你能听见担架碰桥的轻响。","a":"再抛一条绳，接应桥上的人","b":"启动切桥装置，转向近岸接应"},{"title":"界线八·导航里的旧路","text":"一条高地通道没有出现在新图里，旧备注只写着落石。高地小站的看路人想先确认坡脚，抢修车也能清出路面，却会震动上方松石。白潮正在填平身后的低地。","a":"联系看路人，一起勘查坡脚","b":"开来抢修车，慢慢清理落石"},{"title":"界线九·同行的速度","text":"高架还稳，轻装者能在雾起前走过，担架队要花更久。前队想先去搭接应点，后队怕在雾中失散。你手里有能串起整队的绳子，脚下水位正一点点升高。","a":"结绳同行，轮换抬担架","b":"请轻装队先行，约好返回信号"},{"title":"界线十·最后的船次","text":"码头记着昨日的登船顺序，今晨又来了伤员和走不动的老人。按旧表装船更快，临时改排需要重新点名。维修工拿着防水笔，发现自己也忘了把名字写上。","a":"按眼下身体情况重新排队","b":"照旧表点名，再检查剩余位置"},{"title":"界线十一·雾里的灯号","text":"城外高处亮起接应灯，可能来自先遣队，也可能是白潮重放的旧景。近距核验要用去不少时间，直接启程又缺可靠路标。守门人试了试门轴，说下一次开合会很吃力。","a":"带小队靠近核验，让大队暂候","b":"打开通路，朝灯号方向出发"},{"title":"界线十二·城门之后","text":"第七天，门轴无法反复开合。留井须合上屏障线，外出须拆掉这段回路。留在接口上的记忆正变淡，门外地形仍不稳定，两边都有人喊着熟悉的名字。","a":"撑开通路，接应愿意外出的人","b":"合上门轴，检查屏障回路"},{"title":"档线一·遗言没有收件人","text":"第一天，遗言保管室收到无人认领的信，写信者还活着，却忘了要寄给谁。新寄件的人也排到门外，柜子所剩空间不多。一封旧信反复写着记不起时请慢慢问我。","a":"保留旧信，找人核对收件线索","b":"先收地址完整的新信"},{"title":"档线二·一页纸的重量","text":"防潮袋不够，恒温柜也快停电。清洁工带来母亲教他写名字的练习本，已经没有多余材料包它。已装袋的厚册里还有空处，合装需先联系各自主人。","a":"联系册页主人，合用防潮袋","b":"把练习本抄进空册，原件另包"},{"title":"档线三·被改过的生日","text":"档案里的生日都变成主井启用日，旧记录却还在废纸堆中。技术员怀疑迁移时日期格式错了，直接覆盖可能打乱医疗索引。几位老人正等你查出准确的用药年龄。","a":"先建手工表，逐人核对生日","b":"载入旧数据，重建日期索引"},{"title":"档线四·语音与家书","text":"电台能播寻亲消息，却只有一个短时段。许多信既写思念，也写失散前的误会，删成几句难以完整。印刷铺愿印全文，但防水纸还得包其他档案。","a":"请寄信人各选一段，录好语音","b":"取出防水纸，印出完整家书"},{"title":"档线五·未寄的道歉","text":"男人记得曾使人难过，却忘了经过，想请你代写道歉。对方带来回信，说暂时不想联络。两人原本约在同一屋檐避潮，你还得安排今晚住处，空房已不多。","a":"收好回信，寻找分开的住处","b":"陪男人写信，先放入未寄信箱"},{"title":"档线六·写着你的那一页","text":"同伴请你在他记忆模糊后按日记认识他，却删去了最激烈的一次争执。他承认害怕被陌生的自己弄丢关系，也愿意让你补写。你手中的笔停在一整页空白上。","a":"分开写下两人的版本","b":"与他逐段整理成一份共同日记"},{"title":"档线七·纸雨","text":"风掀开屋顶，家书与住址底册飞向湿街。防潮柜只能装下一类，志愿者却可以分头带纸离开。有人抱着写给亡妻的信，有人正寻找登船名单，雨已打湿桌面。","a":"封签纸束，请志愿者分头护送","b":"把住址底册收进防潮柜"},{"title":"档线八·建井时的附注","text":"旧检修册说明记忆缓存原应七日清空，一次返还试验却引发过潮水倒灌，后来记录缺了几页。完整复核需要时间，返还接头已经锈死在墙上。维修员把油壶递来。","a":"与众人核对旧册和事故记录","b":"先清理接头，测试返还线路"},{"title":"档线九·带走哪种过去","text":"撤离只给档案室留一辆小车，书架却有整面墙。技术手册、事故记录与家庭相簿都有人惦记，也有许多无人来领的信。第二辆车已经装了伤员，不能再搬来。","a":"分门别类，与众人抽签装箱","b":"先装技术手册和检修记录"},{"title":"档线十·忘记的约定","text":"几位失忆者忘了曾答应帮邻居修棚，邻居按旧约留好了工具。有人急需援手，有人连自己的伤都说不清。你翻出签名真实的纸条，却不能从字迹看出他们今天是否还能工作。","a":"逐人重新询问，重排修棚分工","b":"先照旧条整理任务，逐项核实"},{"title":"档线十一·把名字交出去","text":"潮雾擦淡墨迹，主井可以存下全文，却可能把相似往事混入同一索引。多人交叉背诵能离线保存一部分，谁也装不下所有过去。抄写员把最小声的口述也记到纸边。","a":"请众人交叉背诵，各自核对","b":"扫描原件，上传主井并保留目录"},{"title":"档线十二·最后一份原件","text":"第七天，主井仍能保存生平，却要与屏障回路共同运行。带原件离开则可能在潮雾里失墨。最后一封信只写答应回家吃饭，你还记得写信人折纸时的手势。","a":"把原件装袋，随同行者离开","b":"存入主井，坐在终端旁核对"},{"title":"协作线一·值班桌前","text":"第一天，防潮工作室收到七日潮峰预报，负责人正外出测堤。桌上留着检修册，各楼的照护者陆续到来，水泵却已停转。你站在离工具箱最近的位置。","a":"请大家先摊开各楼检修单","b":"带工具去水泵房，开始排查"},{"title":"协作线二·认不出的同伴","text":"旧排班终端靠记忆问答识别来人，接过井的人往往答不上。邻里认得他们的工作习惯，也愿陪着重录。今晚班次还没排完，泵房已经打来第二次询问。","a":"请邻里协助，重录每个人的资料","b":"先按现有记录排班，再补录资料"},{"title":"协作线三·漂亮的曲线","text":"主井报出很高的存活估算，却漏记了无法回答问卷的失忆者。补测才能修正图表，抢修材料却等着你核对数量。记录员留了一个问号，窗外的潮位还在涨。","a":"标出缺项，组织补测","b":"先按现有数据备料，另记待核项"},{"title":"协作线四·修堤人也要吃饭","text":"修堤队想随身带饭，食堂担心保温箱不够。分头照料可以立即出发，合用食堂则得错开时辰，晚一班的检查会延后。两边的人都累了，热汤还放在门口。","a":"商量错峰用餐，排好共同班次","b":"装好保温箱，请修堤队分头出发"},{"title":"协作线五·碎窗后的清点","text":"搬运车撞碎物资站窗户，营养液洒了一地。司机以为棚里没人，值班员却正在柜后清点。众人忙着擦水，剩余瓶数有两种说法，今晚分发还未开始。","a":"陪两人核清瓶数，补好窗框","b":"先搬走完好的物资，再处理碎窗"},{"title":"协作线六·熟人的班次","text":"陪你值夜的同伴想进核心维修班，他经验足，却刚连着熬了几夜。现有班表写着另一位不熟悉你的工程师。同伴问是否还能并肩工作，手里的杯子晃出几滴水。","a":"按表交班，请同伴做联络工作","b":"与工程师商量，让同伴加入核心班"},{"title":"协作线七·扩音器失灵","text":"扩音器误播旧路线，出门的人走向尚未修好的桥。电台正在查线，街口已经挤了几辆推车。附近大厅可供暂候，另一处开关则能直接断掉整片外放线路。","a":"打开大厅，沿街说明新路线","b":"切断外放线路，到桥头摆路障"},{"title":"协作线八·七天不止一次","text":"封存记录显示，主井不止一次报过七日倒计时，循环缓存总把后续记录写回开头。重复的维修签名让大家发冷。沿用流程可省时间，重新核对又可能找到循环的起点。","a":"摊开历次记录，与大家逐段比对","b":"保留副本，先完成本轮检修流程"},{"title":"协作线九·谁值最后一班","text":"最后一轮守井可能赶不上船，熟练工又已连日疲惫。有人愿留下，有人想陪家人，岗位还缺几处。你把自己的名字写在草稿上，备用工具箱尚未打开。","a":"询问各人意愿，补排轮换","b":"按熟悉的设备搭配人员，再逐个确认"},{"title":"协作线十·交班的时刻","text":"白潮之后钟可能停走，检修组要约定何时交班。按固定时长轮换便于休息，却可能正碰到难修的故障；等系统稳定再交班，也不知要等多久。你拿来机械计时器。","a":"设好计时器，逐班约定复查","b":"把交班点标在系统稳定刻度旁"},{"title":"协作线十一·迟到的联络","text":"潮墙升起，远处几栋楼还没传回最后的接井意愿。快艇仍能出发，屏障窗口却正在收窄。已到场的人各有打算，联络员盯着断续的信号灯不肯离开。","a":"派快艇接回联络人","b":"先接通已确认的线路，继续呼叫"},{"title":"协作线十二·第七天的签名","text":"第七天，工作台只剩屏障与旁路两套接法。留井会继续耗损已接入的关系记忆，外出则要走进未测清的地形。你看见旧维修单下压着许多同样的签名，同伴正在等最后一次核对。","a":"接好旁路，与同行者出门","b":"在检修单上签名，接回屏障"}],"endings":[{"title":"公共·在第八天分水","text":"白潮越过旧堤，你们沿引路绳走到露出水面的车站。有人没能按约抵达，也有几辆车遗失在雾里。大家先照看伤者，再量能喝的水，最初的分法很快发现漏了不会主动开口的人。你重新端来杯子，也领到下午搬水的班次。第八天没有忽然充足的物资，却有人记得队尾还站着谁。你们继续同行，把下一处取水点写在车票背面。","hint":"支持项（每项一分）：第1节点「救助眼前的弱者，建立互助基础」、第4节点「加入街区照护队，承诺共享资源」、第5节点「将储备交给互助网络」、第6节点「照护同行者，践行早前约定」、第8节点「协调街区照护队与防潮检修组，建立撤离通道」；第一、二幕各至少一项；公共结算：每方向至少命中两项不同早期行动，且第一、二幕各有支持；优先兑现第三幕声明的已建立方向，否则按命中数降序；同分按共同生还、长期主理、带伤远行、查明往事、以身承接、余生守望顺序。无方向建立才兜底余生守望。身份、关系、秘密满足原条件时优先，不满足则按此公共比较结算。"},{"title":"公共·守夜人的灯","text":"你接下主井总控，沿着熟悉的次序修泵、检电、照看屏障。潮峰过去时，堤城还有几条可走的干路。每处故障都习惯等你处理，夜里的呼叫渐渐使你难以睡稳。有次太累接错支线，邻楼停了整夜的灯。你开始教同伴读懂总图，却仍放心不下最深的井室。留在城里的生活得以延续，桌上的交班计划也成了你必须慢慢完成的事。","hint":"支持项（每项一分）：第1节点「整理检修物资，与防潮检修组协作」、第4节点「加入防潮检修组，共同照看设备」、第5节点「建立防潮检修组应急储备」、第6节点「先处理检修事务，与防潮检修组协作」、第8节点「整理检修记录，协助防潮检修组的工作」；第一、二幕各至少一项；公共结算：每方向至少命中两项不同早期行动，且第一、二幕各有支持；优先兑现第三幕声明的已建立方向，否则按命中数降序；同分按共同生还、长期主理、带伤远行、查明往事、以身承接、余生守望顺序。无方向建立才兜底余生守望。身份、关系、秘密满足原条件时优先，不满足则按此公共比较结算。"},{"title":"公共·群岛之间","text":"你带着伤与旧地图离开堤城，在潮后的高地间摆渡。每处都有不同的难处，有的缺药，有的缺木料，有的还在寻找一段能唤醒亲友的录音。你先约好送病人的靠岸点，再试着送水与信。并非每次返航都有人等，熟悉的旧码头也早已沉没。后来夜里总能看见另一处高地的灯，你把它画进地图，留给下一班船。","hint":"支持项（每项一分）：第3节点「依靠普通技能，不调用天赋」、第4节点「加入街区照护队，承诺共享资源」、第6节点「离开同行者，保全自己」、第7节点「停止研习，照顾自己的身体」、第8节点「协调街区照护队与防潮检修组，建立撤离通道」；第一、二幕各至少一项；公共结算：每方向至少命中两项不同早期行动，且第一、二幕各有支持；优先兑现第三幕声明的已建立方向，否则按命中数降序；同分按共同生还、长期主理、带伤远行、查明往事、以身承接、余生守望顺序。无方向建立才兜底余生守望。身份、关系、秘密满足原条件时优先，不满足则按此公共比较结算。"},{"title":"公共·迟到的回答","text":"你坚持核完主井的旧记录，查清缓存如何串写，又怎样让失忆者错过照护。完整答案来得迟，部分设备在搬迁前就被潮水淹没了。亲友听完仍会问，若早一天知道会怎样。你无法替那一天补出结果，只把每次失误与未解疑点留在保管室。潮后新的检修表同时写着复核步骤与抢修时限。你还会继续校对，但也学会先问门外谁在等水。","hint":"支持项（每项一分）：第1节点「保留异常证据，开始调查」、第4节点「加入遗言保管室，承诺保全证据」、第5节点「公布第一份证据」、第8节点「展示调查记录，与同伴共同核对」；第一、二幕各至少一项；公共结算：每方向至少命中两项不同早期行动，且第一、二幕各有支持；优先兑现第三幕声明的已建立方向，否则按命中数降序；同分按共同生还、长期主理、带伤远行、查明往事、以身承接、余生守望顺序。无方向建立才兜底余生守望。身份、关系、秘密满足原条件时优先，不满足则按此公共比较结算。"},{"title":"公共·井口最后一盏灯","text":"你以自身记忆维持过井口索引，潮峰后却叫不出许多熟悉街名。维护员及时断开接口，把你接到普通病床。你仍听得懂人说话，只是再难像以前那样唤起天赋。大家带来走通的路线，也带来没能回来者的消息。后来保管室为你添了一张椅子，抄写员慢慢念记录，等你自己回答。你换来的那段时间已经过去，眼下的一碗热汤不需要你再拿什么来换。","hint":"支持项（每项一分）：第3节点「以当前身份研习天赋，接受其负担」、第6节点「照护同行者，践行早前约定」、第7节点「继续研习天赋并承担负担」、第7节点「过度调用天赋，换取紧急资源」；第一、二幕各至少一项；公共结算：每方向至少命中两项不同早期行动，且第一、二幕各有支持；优先兑现第三幕声明的已建立方向，否则按命中数降序；同分按共同生还、长期主理、带伤远行、查明往事、以身承接、余生守望顺序。无方向建立才兜底余生守望。身份、关系、秘密满足原条件时优先，不满足则按此公共比较结算。"},{"title":"公共·没有庆典的清晨","text":"潮峰过去，你仍住在堤城。内圈有几盏灯亮着，外侧只剩屋顶，失散情况还要逐家核对。有人与你打招呼，有人谈起旧事仍说不下去，你也难以把每次选择解释清楚。第八天，大家把燃料留给寻人船，没有举办庆典。你在门边挂一块消息板，空行留着，不许诺都会等到回答。明天醒来，你还会先去码头看一眼。","hint":"支持项（每项一分）：第3节点「依靠普通技能，不调用天赋」、第4节点「加入街区照护队，承诺共享资源」、第5节点「将储备交给互助网络」、第7节点「停止研习，照顾自己的身体」、第8节点「协调街区照护队与防潮检修组，建立撤离通道」；第一、二幕各至少一项，或所有公共方向均未建立时兜底；公共结算：每方向至少命中两项不同早期行动，且第一、二幕各有支持；优先兑现第三幕声明的已建立方向，否则按命中数降序；同分按共同生还、长期主理、带伤远行、查明往事、以身承接、余生守望顺序。无方向建立才兜底余生守望。身份、关系、秘密满足原条件时优先，不满足则按此公共比较结算。"},{"title":"身份·候车室的诊所","text":"你把急救练成熟悉的手艺，也学会在天赋使身体发抖前停下。照护队帮你在候车室搭起诊所，药柜并不齐，有些病人仍没能熬过清晨。你把误判写进病例，请同事逐项核对。曾被你留床观察的失忆者负责洗布条，总记得给夜班留热水。后来诊所添了正式检查台，你又从头学习新设备。熟练让你能多做一些事，也让你更清楚何时该请别人接手。","hint":"以「重返急救岗位的医生」开局；第一幕研习身份技艺；第二幕继续研习；第三幕整合技艺；身份技艺达到 3；所属阵营支持至少 4，技艺有实际服务对象；天赋负担不超过 6；终幕选择「以身份技艺服务所属阵营」。"},{"title":"身份·井下的手动开关","text":"你熟悉了旧井的接线，最后一次反冲却擦去了部分维修记忆。工友把各自记得的片段写下，没有替你拼成一个完整的过去。新供能站保留着清楚标注的手动开关，你从简单线路重新练起，也把休息时段写入作业单。第一次独立检修后，你在记录上签下现在的名字。掌心的茧仍在，来处一时想不起，握住扳手的动作却正慢慢回来。","hint":"以「记忆井维护员」开局；第一幕研习身份技艺；第二幕继续研习；第三幕整合技艺；身份技艺达到 3；所属阵营支持至少 4，技艺有实际服务对象；天赋负担不超过 6；终幕选择「以身份技艺服务所属阵营」。"},{"title":"身份·水下仍有街道","text":"你靠反复测绘记住的落差与回声，带人走进地下水道。每到岔口，都把已确认与待确认分开标记。有人绕远后获救，也有人未等到下一次测量。潮后，你把沉城道路继续画在新图上，危险处与可求助的地方都写清楚。有来访者不愿看失败路线，你便陪他另选一条。地图不保证抵达，但能让后来人少走一段已经知道的险路。","hint":"以「地下水道测绘师」开局；第一幕研习身份技艺；第二幕继续研习；第三幕整合技艺；身份技艺达到 3；所属阵营支持至少 4，技艺有实际服务对象；天赋负担不超过 6；终幕选择「以身份技艺服务所属阵营」。"},{"title":"身份·没有抹平的账","text":"你带出的物资账并不平整，里面有漏送的水、临时借用的鸡蛋，也有没来得及领走的饭。潮后大家想不起所有细节，你把能确认、待确认与无法补回分列，不把猜测写成结论。照护队仍请你管账，也有人愿意补录当时的经过。一笔误差可能只是破桶，一行姓名却可能牵着一次未等到的照护。你慢慢核对，不再靠整夜不睡来赶一个漂亮的总数。","hint":"以「物资站账房」开局；第一幕研习身份技艺；第二幕继续研习；第三幕整合技艺；身份技艺达到 3；所属阵营支持至少 4，技艺有实际服务对象；天赋负担不超过 6；终幕选择「以身份技艺服务所属阵营」。"},{"title":"身份·允许沉默的频道","text":"最后一轮语音里，你念清路线、时刻和未核实的灯号，把余下时间留给寻人。潮后大家用手摇机重新架起天线，你的嗓音却因那夜的烟尘一直沙哑。每条消息都附来源，听错的姓名也会重念。有时一个时段只有杂音，你不急着填满。某晚，远方传回一个等了许久的名字，你请对方慢一点，让守在旁边的人自己确认那是谁。","hint":"以「守夜电台播音员」开局；第一幕研习身份技艺；第二幕继续研习；第三幕整合技艺；身份技艺达到 3；所属阵营支持至少 4，技艺有实际服务对象；天赋负担不超过 6；终幕选择「以身份技艺服务所属阵营」。"},{"title":"身份·没有完成的论文","text":"反复实验后，你发现白潮会追随离散的记忆片段，却仍无法写出保证人人平安的公式。检修组给你留了一间小屋，你把试验条件、失败记录与休息时间都贴在墙上。愿意参与的人可以中途停下，你也学会把他们的感受记进数据之外。年轻学生问何时写完论文，你指向窗外还在变化的潮色。下一次取样仍需要人去，答案会比愿望慢一些。","hint":"以「独自追踪白潮的研究员」开局；第一幕研习身份技艺；第二幕继续研习；第三幕整合技艺；身份技艺达到 3；所属阵营支持至少 4，技艺有实际服务对象；天赋负担不超过 6；终幕选择「以身份技艺服务所属阵营」。"},{"title":"身份·没有末班的渡口","text":"你的旧船在潮前反复往返，有些箱子没能带走，有些请求至今难以回想。你把获救与失联者都记下，没有用总数冲淡其中任何一个。潮后木匠帮你补船底，照护队送来绳索，你开始按身体状况安排航次。浪大时仍得停船，也会向等候的人说明。新渡口没有最后一班的固定时刻，船能开时，你总先看看对岸是否还有灯。","hint":"以「驾驶旧船的摆渡人」开局；第一幕研习身份技艺；第二幕继续研习；第三幕整合技艺；身份技艺达到 3；所属阵营支持至少 4，技艺有实际服务对象；天赋负担不超过 6；终幕选择「以身份技艺服务所属阵营」。"},{"title":"身份·不教孩子忘记","text":"你用反复练过的照护方法，陪孩子辨认混乱的记忆。新学校只有半面墙，课本来自各家留下的纸页。孩子写下同一夜不同的经历，你允许它们并排，也教他们说不知道和需要帮助。失忆的家长坐在矮凳上，重新询问孩子的喜好。潮声响起时仍有人躲到桌下，你便留好出入口。学期结束，有人写家是能出门也有人等你回来的地方，你把那页留给修门的同伴看。","hint":"以「临时学校教师」开局；第一幕研习身份技艺；第二幕继续研习；第三幕整合技艺；身份技艺达到 3；所属阵营支持至少 4，技艺有实际服务对象；天赋负担不超过 6；终幕选择「以身份技艺服务所属阵营」。"},{"title":"关系·重新询问你的名字","text":"你继续照护失忆的同行者，选择留下，并没有使他立刻想起你。最初你总想纠正他的习惯，后来才把旧日记放到他可以不读的位置。你们重新分工，也学会先敲门。他主动问起过去时，你只讲自己记得的部分。新的关系慢得多，有时只是友邻。某晚他替你留灯，你没有追问是否一切都回来了，只在桌边坐下，讲起今天发生的事。","hint":"第一幕与失忆的同行者相识；第一幕结识的人，在第二幕获你保护，第三幕仍守约（信任至少 5）；终幕选择「将共同生活置于使命之前」。"},{"title":"关系·两个人都留下空白","text":"你和导师一起接过井，潮后才发现两人遗失了同一段往事。旁人愿意转述，你们听完却没有急着当作自己的感受。照护仍要换药、做饭与交班，最先回来的默契反而来自这些小事。有时会争论谁曾多撑一会儿，随后又承认记忆无法作证。后来你们在空页写下新的约定，疲惫时先说出来。那页没有补全过去，却让明天有了可一起做的事。","hint":"第一幕与共担抽取的导师相识；第一幕结识的人，在第二幕获你保护，第三幕仍守约（信任至少 5）；终幕选择「将共同生活置于使命之前」。"},{"title":"关系·两份未删的日记","text":"你护住守井旧对手，也守住后来照护的约定。他把含着争执的日记交给你，请你别删，你便逐页陪他核对。读到难受处，两人会停下来吃饭，不把旧纸上的亲近当成今天的要求。后来他搬到隔街，带走原件，留下愿分享的副本。一次他来指出你记错了日期，你们查到半夜，终于一起笑起来。两份日记仍有不同的说法，却都能放在桌上。","hint":"第一幕与守井旧对手相识；第一幕结识的人，在第二幕获你保护，第三幕仍守约（信任至少 5）；终幕选择「将共同生活置于使命之前」。"},{"title":"关系·绳结的另一边","text":"你与持绳的家人在最浓的潮雾里没有松手，也停下接应了陌生伤者。为此错过的路与留下的伤都还在，谁也没有把那夜说成毫无遗憾。潮后你继续照护对方，两人先说清各自能做和不能做的事，再安排共同生活。旧绳被分成几段，你留下一个磨损的结。它提醒你，亲近的人也会害怕，也需要在下一次伸手前听见彼此的回答。","hint":"第一幕与持绳的家人相识；第一幕结识的人，在第二幕获你保护，第三幕仍守约（信任至少 5）；终幕选择「将共同生活置于使命之前」。"},{"title":"关系·隔岸有灯","text":"你离开时，受托照看的同伴决定留在井边。你们争论到船将开，也没有取消往后联络的约定。潮后许多天，旧城传来断续信号，他忘了不少事，却还留着那张频率纸。你继续送药，他也寄来修好的零件。固定时段两边各亮一盏灯，有时说近况，有时只确认有人。生活没有留在同一屋檐，牵挂仍沿着那段嘈杂的线路往来。","hint":"第一幕与留城的受托者相识；第一幕结识的人，在第二幕获你保护，第三幕仍守约（信任至少 5）；终幕选择「将共同生活置于使命之前」。"},{"title":"秘密·潮水在寻路","text":"两种过潮经历使你重新核查主井、病人梦话与根网。你发现白潮由离散记忆的回返聚成，它们一直在寻找可辨认的来处。接回片段要缓慢进行，有人想试，有人选择封存。屏障随之减弱，旧城没能完整留下，潮峰却第一次停止继续抬高。高地上的归还桌旁，总有不同愿望的人排队。你逐人询问，不再以为修复就意味着把所有过去原样塞回。","hint":"前局发现「public.rescue」；前局发现「public.rule」；第一幕调查冲突根源；第二幕促成阵营协商；收集至少两份证据；终幕选择「用旧日发现调解阵营」。"},{"title":"秘密·这一回记得返程","text":"重拾急救手艺与照护同行者后，你读懂了旧维修册里自己的签名。每次潮峰，你都曾走到同一座桥，又因缓存重置忘记后面的接应。记录不完整，留在岸外的人也并非都能找到。今次你把返程时间写给每位同行者，带着实测地图重新出发。仍有人受伤，但回程终于没有被下一次清晨擦去。潮后你留下全部经过，也留下那几处尚未得到回答的名字。","hint":"前局发现「identity.1」；前局发现「relationship.1」；第一幕重拾技艺；第二幕继续研习；第一幕结识的人，在第二幕获你保护，第三幕仍守约（信任至少 5）；终幕选择「承接前世身份与未竟承诺」。"},{"title":"秘密·收信人是下一次的你","text":"旧日的耗损与导师相伴的记忆，让你这次停下无休止接井，重新看那箱无人认领的信。几封信使用你熟悉的断句，写给不同名字下的自己，记着一次次循环没能完成的事。你把原件交给独立保管者，自己只留目录。并非每页都撑过潮雾，却有几份互相印证的记录留了下来。你再写信时，收件栏填了愿意核对的人。明天仍未知，今天却不必再次无声消失。","hint":"前局发现「public.sacrifice」；前局发现「relationship.2」；第一幕结识的人，在第二幕获你保护，第三幕仍守约（信任至少 5）；第二幕停止透支；第三幕接受能力限制；终幕选择「以旧日关系记忆解除天赋束缚」。"},{"title":"秘密·井底不再重来","text":"归还路径、重复签名与旧信相互印证，你和遗言抄写员终于找到把每次故障写回开头的缓存环。你护着他逐段核对，也等每份回执完成外存。断开后主井不再得到循环里的虚假余量，撤离与照护必须按现有物资安排。有人舍不得重来的可能，你们把接线方法和未解的问题一并留下。主井最后一次启动，只报出当前日期。抄写员问明天记什么，你说还不知道。","hint":"前局发现「secret.reconcile」；前局发现「secret.inherit」；前局发现「secret.liberate」；第一幕结识记录者；第一幕结识的人，在第二幕获你保护，第三幕仍守约（信任至少 5）；第一幕调查轮回；第二幕展示轮回线索；终幕选择「请记录者见证并终止轮回」。"}],"turns":{"calling":{"title":"值班册的空行","text":"记忆井维护室里，导师把备用工具和一册多年检修记录交到你面前。他想有人接学辨认混入水声的回忆，往后长期轮值。物资站则正在招收运船调度学徒，你可以从核对船期重新学起，两边都在等你留下名字。","options":[{"label":"接过检修记录，学做守井维护员","aftermath":"五年后，你已经写满两册自己的井壁听音记录，固定值每周最安静的夜班。别人休假的日子，你常在更换滤芯；导师留下的那套工具被你逐件修过，仍锁在专属的值班柜里。"},{"label":"退回工具，去物资站学运船调度","aftermath":"五年后，你排出了沿河六个停靠点的常用船期，调度桌上钉着你亲自测过的卸货水位。井边的工具柜换了另一位学徒的姓名；你白天常被船铃叫走，晚上却能按自己的习惯关掉工作电台。"}]},"bond":{"title":"床头的录音","text":"同行者忘了你们怎样相识，只能靠床头录音认出熟悉的声音。照护站说，恢复日常作息可能需要多年陪伴。他愿意和你重新熟悉，也愿意住进已有空位的照护宿舍；你那份需要长期随船的工作邀约，正压在录音机底下。","options":[{"label":"留下陪护，与他重新安排日常","aftermath":"三年后，你每天交班便回到同一张录音桌旁，和他补录当天去过的地方。随船的职位由别人接了，你改做附近物资站的短班；他还想不起你们的初见，却能凭新录下的声音找到你们共同租住的房门。"},{"label":"送他入住照护宿舍，告别后随船工作","aftermath":"三年后，他的录音由宿舍照护员逐日补充，你保留的那份始终停在分别那天。你已成为常年随船的货运助手，在船尾有了固定的行李柜；新认识的船员熟悉你的作息，却没人见过从前与你同行的他。"}]},"home":{"title":"窗边的水痕","text":"旧街合住屋开放了修缮登记，你可留下一个房间，但屋主请住户往后共同维护屋顶蓄水槽。去往上游高地的迁居船也留有位置，你看过那里的住屋图，干燥却远离井边和熟悉的邻里。窗边还留着上次漏水的痕迹。","options":[{"label":"登记旧街房间，留下修缮合住屋","aftermath":"五年后，你仍住在水痕旁的那间屋里，亲自换过的窗框刻着五次检修日期。每到雨季，你都得留出时间清理蓄水槽；楼下邻居会替你收包裹，也会在槽盖松动时第一个来敲门。"},{"label":"带走行李，迁往上游高地","aftermath":"五年后，你在高地租下带储水窖的小屋，第一次亲手种的耐旱草已铺满窗前。旧街房间住进了另一户人家，你回访时只能借住客房；平日取水要沿坡走远路，屋内却再没有那道熟悉的水痕。"}]}},"episode":{"title":"重生后我先租了冷库","source":"web-original","opening":{"title":"暴雪前的签字","text":"潮水泡开一本防冻仓的值班册。你碰到自己的签名，再抬头，窗外还没有下雪。上一世，百年暴雪压断桥梁，你守着满仓鲜货等来断电，连母亲最后一口热粥也没保住。再睁眼，仓库转租单正在你面前。堂兄抢着接手临河大仓，笑你只配租山坡上的旧冷库。手机显示晴天，你却买下燃料、干粮和保温毯。交货当天，堂兄堵住卸货口，声称这车物资算进了他的订单。","a":"把签收底单拍在车头","b":"拨通供货商的视频电话","attributes":["声望","羁绊"]},"followups":[{"title":"雪线落下来了","text":"司机核对你的付款尾号，当场把货送往山坡。堂兄还在嘲笑，第一场冻雨已经打碎了他的玻璃雨棚。你提前检修的发电机亮起，母亲端着热粥走出值班室；山下商店却接连熄灯。对讲机里，邻居说整栋楼的暖气停了，另一端的送货司机喘着气，说他的车陷在冷库外的陡坡上。","a":"拿保温毯去接邻居","b":"拖着绞盘走向陡坡","attributes":["羁绊","实力"]},{"title":"被改过的订单","text":"供货商共享原始订单，堂兄填写的收货地址暴露在镜头里。他被取消代收资格，你拿回整车物资，还发现上一世那批受潮燃料也是他换的。你逐袋验收，暴雪恰在此时封住山路。堂兄发来求购消息，愿用仓库产权抵粮；隔壁面包房则送来手写纸条，想借电把最后一批面团烤熟。","a":"给堂兄送去一箱口粮","b":"把电缆接到面包房","attributes":["羁绊","资源"]}],"codas":["邻居们裹着毯子住进值班楼，轮流铲雪、做饭、看机房。你终于陪母亲喝完那碗热粥。开春盘账，仓里的粮少了，欠你饭的人多了一整条街。","绞盘拉回货车，司机打开车厢，里面是送往山中诊所的保温药箱。你腾出恒温间，他留下来修车。道路恢复后，你们合开了山路配送站。","你留下口粮，收回他欠款的签字单，没有接产权。他独自守着空仓熬过雪夜。春天你按约追回货款，搬走所有旧账，从此只做自己的生意。","烤炉重新发亮，面包师按借电量给你记账。热面包换回鸡蛋、木柴和修机手艺，旧冷库成了交换点。雪停那天，你们合挂起全年营业的牌子。"]}},{"id":"w3","name":"赛博继承人","premise":"你继承了一间私人记忆修复工作室和一枚骨钥，与维修团队整理旧委托、修复人格备份、寻找散失的家庭往事。数字生命可借维护机体行动，以文字或声音表达自己的打算。","factions":{"commons":"邻里照护队","council":"云库维修组","archive":"私人记忆室"},"fate":{"characters":["邻里联络员","云端导师","交还骨钥的旧对手","同源人格","无亲属的受托人格","遗嘱校验员"]},"origins":["继承旧修复工作室的年轻人","拥有相同初始记忆的合成助手","维护街巷记忆管线的维修工","替云端来客调试身体的义体医生","寻找散失童年片段的记忆修复师","重返夜班的设备巡检员","从废弃服务器醒来的数字孤儿","替委托人核对记忆来源的记录员","寄身送终终端、主持云端告别的数字遗灵","背着旧电池往返街巷的自走快递机"],"events":[{"title":"遗嘱里的陌生人","text":"工作室主人离世后，你收到骨钥和七份未完成的私人委托。来访者带着亲人备份，有人记得主人的年轻模样，有人只来过一次。备用电将尽，交接册还没写明谁熟悉哪台机器。","a":"与来访者一起整理委托和分工","b":"收好骨钥，先独自检查设备"},{"title":"门禁认得旧声音","text":"工作室内门只认旧主人的声纹，等待取件的亲友被挡在外间。维修员可拆门人工核验，旧语音包也能临时接入你的终端，但其中混有自动播放的私人留言。","a":"请维修员拆开门禁面板","b":"载入旧语音包，靠近门边话筒"},{"title":"一小时的春天","text":"云库备用电只够一小时，里面既有休眠的家庭备份，也有熟悉供电系统的旧维修助手。轮休能照看每一组，却可能丢掉未存的细节。维修助手的窗口仍停在多年前的春日背景。","a":"逐组保存，安排轮流休眠","b":"先唤醒维修助手，一起查电路"},{"title":"没有剪完的录音","text":"旧委托附着母亲与孩子的笑声，后半段却是她不愿再听的告别。旧主人尚未剪完，自动整理程序把两段接在一起。母亲的云端备份想先独自听一遍，你已找到原始波形。","a":"把播放键交给她，等她选出片段","b":"先封存原录音，修复损坏的波形"},{"title":"餐桌上的空位","text":"邻里送来热汤，也愿轮流帮忙清点取件。维修组另有空机房可借，只是需要你今晚去安装设备。大家在桌边腾出一个座位，窗外的雨正沿漏水管滴进门槛。","a":"留下吃饭，与邻里安排取件班次","b":"带上工具，去维修组安装设备"},{"title":"继承的是修理单","text":"骨钥打开账户，里面只有旧主人的零件欠款和未完成的修理单。邻居愿借些钱，自己的义肢保养却也等着。仓库里还有闲置仪器可退回，但拆机要重新整理所有备份。","a":"向邻居说明账目，商量分期借用","b":"清点闲置仪器，联系退回零件"},{"title":"告别时的断电","text":"私人告别刚开始，投影突然闪烁，水滴落在接线排上。家属的便携备份也连着这条线。缓慢拔线能逐台保存，启动应急隔离则能立即断开漏电区域，却可能中断传输。","a":"陪家属逐台保存，再拔下连接线","b":"启动隔离开关，检查便携备份"},{"title":"旧主人的复数","text":"核心里存着旧主人不同年龄的工作日志：年轻时爱试新方法，晚年总想多留一份备份。几个模拟助手对同一委托给出不同意见。你看见桌边还有未拆的修理包，收件人一直在等。","a":"请团队一起听完各版日志","b":"先按最近一版日志检查修理包"},{"title":"会呼吸的目录","text":"家庭备份彼此共享旧照片，迁出一个文件夹可能使别处也缺图。来访人格想带走自己的回忆，维修组需要整理引用关系。目录旁的进度条很慢，对方轻敲音箱提醒还在等。","a":"逐项拆开引用，整理迁移清单","b":"先在本机修复整套共享目录"},{"title":"零点停机","text":"散热系统将在零点停机检修，私人云库必须临时搬走。家用设备能分担存储，却各有不同格式；你的继承终端容量大，隔离层却没接过这么多声音。邻居已经抱来几块电池。","a":"给邻居分配备份包，逐台核验","b":"把核心接入自身终端"},{"title":"签名之前的停顿","text":"维修商送来换机单，新机能立刻复电，却只能读压缩备份。旧盘保留完整细节，需要再修一夜。来访者愿等，备用电却接连变暗，你的骨钥能将两套机器同时接到测试台。","a":"与来访者守着旧盘，继续修复","b":"把新旧设备接上测试台"},{"title":"骨钥最后一次转动","text":"云库迁移完毕，骨钥可以拆成三枚工作密钥，供取件、修复与照护分别使用，也能保持整枚由你长期值守。分开交接要磨合，独自照看则难有休息。窗里的名字逐行亮起。","a":"拆出工作密钥，与团队约定班次","b":"保留整枚骨钥，整理长期值班表"},{"title":"雨沟送来的箱子","text":"雨水把旧工作室的密封箱冲入排水渠，与你一同捞箱的拾荒人认出上面的手绘花纹。箱内是早年的家庭备份与一枚骨钥副件，低电提示正催着你们寻找干燥地方。","a":"与拾荒人一起打开箱子登记","b":"先把箱子抱回工作室烘干"},{"title":"穿过旧风道","text":"地下机房藏在空气净化站后，检修舱电池不足。维修工知道一条风道，需要共用仅剩的滤芯；检修舱也能接工作室备用电，原来的设备就得先休眠。风道里传来轻微扇叶声。","a":"和工人带上滤芯，走入风道","b":"接上备用电，乘检修舱下行"},{"title":"湿墙里的机房","text":"散热管破裂，热水正渗入隔壁小诊室。停机会让老式备份难以重启，旁路又藏在保温墙后。临时急冷机需要借走诊室的电池，医生还在做最后一次检查。","a":"与邻居拆开保温墙，接通旁路","b":"等医生交接后，接上急冷机"},{"title":"搬家纸箱的背面","text":"防水胶带裹着旧搬家清单，正面写着收妥，背面却记了几箱未扫描的家庭资料。老搬运工担心自己漏了东西，也想先回去找。你看见其中一箱与今日来访者的照片相符。","a":"陪老工人回仓库核对","b":"先联系各位委托人，展示完整清单"},{"title":"地面以下的维修队","text":"管线工习惯逐段手修，住户担心要等太久。另一套自动维修器能迅速查漏，却不熟悉旧接头的尺寸。你们站在越来越湿的地板上，谁也还没空喝刚送来的茶。","a":"与住户和工人分段排好检修","b":"装上自动维修器，跟着检查接头"},{"title":"没有修完的旧伤","text":"几位合成来客的关节需要保养，工作室剩余零件却只够一次大修。大家可先做基础护理，再慢慢补件；旧计算板也能换来一批零件，但板上还有尚未读出的日志。","a":"建立逐次保养表，先做基础护理","b":"清理计算板，联系零件交换"},{"title":"洪水先到低处","text":"排水闸卡住，污水沿电缆沟涌向地下云库。潜水修旁闸需要有人守住转轮，上方空蓄水池也能反向分流，却还没检查过池壁。管线工把防水手套递到你面前。","a":"穿好手套，轮班下水修闸","b":"接通蓄水池旁路，查看池壁"},{"title":"房子的第二副骨架","text":"旧建筑模型由几位云端建筑师共同维护，它们想迁出，模型却与机房散热支架互相引用。逐个交接很慢，复制现有模型则可能漏掉只记在谈话里的细节。一位建筑师画出了第一根支柱。","a":"陪建筑师逐项交接模型","b":"复制现有模型，先分离迁移目录"},{"title":"地下的走廊","text":"机房旁路要经过几间私人储藏室，有人堆着旧家具，有人把那里当纪念角。逐间协商能绕开重要物件，却得反复改图；从公共长廊布线则要穿过仍漏水的墙。老人指了指丈夫的旧工作台。","a":"与住户逐间商量布线位置","b":"带工具走公共长廊，检查湿墙"},{"title":"最冷的一层","text":"地热回路只能供暖或冷却机房。邻居愿挤在一处烤炉旁，卧床者却不好移动。旧锅炉可以增压同时供热，安全阀的刻度却已磨花，屏幕里的亲友仍不知道为何迟迟没人说话。","a":"分段停暖，安排床边照护","b":"清理安全阀，缓缓转动增压柄"},{"title":"搬走以后还回来吗","text":"地面有了临时机房，搬入就要拆开许多尚未修好的旧线。来客急着摆脱潮湿，维修组希望先补全接线图。你的备用终端可以暂存几份，余下的需要逐台安排。","a":"先用备用终端接待，补画旧线图","b":"带团队搬入新机房，现场重新接线"},{"title":"地基上的名字","text":"地下机房修好，团队要给维护图写负责人。建筑师人格与现住户都熟悉一部分，联合标注要反复核对；写由工作室总接单，则所有故障都会先找你。第一张旧街图摆在桌旁。","a":"请各位参与者标注熟悉的部分","b":"留下工作室地址，整理总接单表"},{"title":"写给旧助手的信","text":"一位与你同貌的合成助手递来骨钥，说旧主人的信原本寄给你们两人。工作室还有几位相同初始记忆的助手，各自醒来的日期不同。交接终端只显示一个未完成的登录栏。","a":"叫来所有助手，一起核对信件","b":"先带骨钥回去打开交接终端"},{"title":"只认一张脸的门","text":"门禁把几位合成助手识别为同一访客，第二人靠近便反复重启。维修员可逐个录入不同声音，也能清掉你原来的登录档，临时用空白模式通行。门内备份设备还在等待接线。","a":"请大家逐个录入姓名与声音","b":"备份自己的登录档，改用空白模式"},{"title":"备用身体也会疼","text":"几位合成来客需要抗排异药，同伴的情况较稳定，也最熟悉附近药库。均分能照看所有人，却可能都不够；给他完整疗程后再去取药，则得让其他人先等。医生逐一量着体温。","a":"请医生分好剂量，安排共同观察","b":"陪同伴完成治疗，再查看药库路线"},{"title":"指纹下面的回路","text":"指纹芯片把拒绝动作误判成神经异常，每次缩手就触发疼痛反馈。自愿者可以慢慢复现故障，拆出总控制板也能直接查线路。示波器上那条异常峰值还没有消失。","a":"陪自愿者逐步测试，随时暂停","b":"拆下控制板，接到模拟测试台"},{"title":"不同名字的合照","text":"助手们想拍一张合照，方便访客分清彼此。有的人喜欢现在的脸，有的人想调整外观。相机里的旧标签都还是同一串编号，大家已准备好各自挑选的名字。","a":"拍好合照，逐个写上姓名","b":"陪想改外观的人去调试面部投影"},{"title":"原件留下的待办","text":"旧系统把同一来源的助手待办同步到一起，谁完成了任务都说不清。逐人拆开记录需要暂停派件；新空白终端可接住全部待办，但那位尚未醒来的助手也许有自己的安排。","a":"暂停派件，逐人核对待办","b":"把待办暂存空终端，保留原记录"},{"title":"检修车没有车窗","text":"自动检修车误锁车门，里面的助手以敲击节奏求助。后方通风口可供慢慢拆卸，总识别终端则能重启整车，却可能使车内设备同时断电。你听见一声熟悉的轻敲。","a":"打开维修通道，递入照明灯","b":"接上骨钥，重启车载识别终端"},{"title":"这张脸的来处","text":"旧图库里，你们熟悉的脸原是一位模型师多年前画下的自画像。她仍住在邻街，想收回未完成的草稿，也愿听听后来者如何称呼自己。助手们看着画，初次发现嘴角少了一颗痣。","a":"陪助手拜访模型师，核对草稿","b":"先封好图库，继续整理各自记忆"},{"title":"每个人的工具箱","text":"几位助手共享起始记忆，维修台却总把他们的操作合成一份。拆成个人工具档便于保留差异，却要重新校准；继续共用模板可以马上开工，细小习惯仍会相互覆盖。","a":"给每位助手建立工具档","b":"整理共享模板，先试一轮维修"},{"title":"同步疼痛的夜晚","text":"错误更新让助手的接口同时刺痛。医生逐个拆除需要时间，你的骨钥可暂存错误信号，也可关闭整座信号塔；塔还连着邻街正在传输的康复设备。求助信息不断亮起。","a":"把错误信号导入自身接口","b":"联系邻街后，关闭信号塔"},{"title":"替我完成的修理","text":"同源助手想署你的名字交出修理报告，他觉得这样访客更放心。你知道报告里有尚未通过的测试，也知道他珍惜刚用上的新名字。取件者将到，设备还放在返工台。","a":"与他署各自名字，说明未测部分","b":"把设备留在返工台，一起重新检查"},{"title":"镜子不再编号","text":"助手们的个人配置终于能分别保存，拆开旧共享盘却要重新安排存储和充电位置。继续共用工作室套餐会省事，自动同步也仍可能混入他人的设置。桌上摆着不同颜色的标签。","a":"逐个保存独立配置，贴好新标签","b":"保留共享盘，重排同步时段"},{"title":"来客还在排号","text":"义体诊室收到骨钥和几份云端来客的旧预约，能用的身体却只有几具。亲友愿帮忙照料，配件工坊也愿借设备，但需要你带团队先完成调试。护士收起上月账单，递来检查表。","a":"与亲友整理预约，安排共同照护","b":"去配件工坊借机，先完成调试"},{"title":"病历锁住的门","text":"接入设备要求完整病史，旧备份却丢了一部分。重新检查费时，病人已盼了很久；手动模式可以逐项跳过空栏，仍有未知的药物反应。屏幕里的来客正在练习第一次握手。","a":"安排重新检查，补全缺失记录","b":"切到手动模式，逐项检查接入"},{"title":"一双手的去向","text":"最后一套精密义手同时适配装配工与医生。装配工想重拾工作，医生想替更多来客调身体，两人的预约恰好同日。双方愿谈，也都没把愿望收回。","a":"请两人确认抽签的办法","b":"先与医生安排义手适配"},{"title":"疼痛被记成笑声","text":"语音问卷把痛呼识别为笑声，设备报告因此全是满意。原始记录能帮助找出故障，也含着病人不愿外传的声音。配件师已经到了，等你提供可重现的问题样本。","a":"请病人选出愿意分享的片段","b":"封存原声，现场演示设备故障"},{"title":"没有标价的值班","text":"邻里医生愿轮流来帮忙，但接入设备还要逐人熟悉。外地维修团队能带来整套新仪器，后续也需持续上传调试数据。候诊者听见讨论，开始询问自己的体感记录会去哪里。","a":"与邻里医生排班，逐台练习","b":"请外地团队说明设备，再安排试用"},{"title":"按心跳闪烁","text":"来客的新心脏接口随每次心跳闪出故障码，备用零件需要从几人的保养包中借调。旧主人的补丁可直接消去错误，却没在这版硬件上测试过。病人把手轻放在胸前。","a":"商量借调零件，逐件更换","b":"隔离测试旧补丁，再接上接口"},{"title":"无菌区里的停机灯","text":"手术进行到一半，机器人的保养提示突然锁住下一步操作。医生不能松手，备用电池只够维持一会儿。延后保养需手动确认，绕过控制板则要在无菌台边拆线。","a":"接好备用电池，确认延后保养","b":"打开侧板，手动接续操作线路"},{"title":"新身体里的旧习惯","text":"两位来客交换了适配身体，却发现动作缓存仍带着对方习惯。重做适配需慢慢练习，立即恢复原配置又会让刚接好的感觉中断。两人坐在镜前，试着各自伸出左手。","a":"请两人慢慢描述体感，重做适配","b":"先保存现状，再恢复原配置"},{"title":"身体的保养表","text":"诊室要选长期维护方式，分散手工保养需要来客学些自检，自动维护则要一直联网。零件与人手有限，护士拿来两份不同的说明，请你先亲自试着照做一次。","a":"编好自检图，与来客逐项练习","b":"接好自动维护，设置复查时段"},{"title":"同一刻的停顿","text":"一批义体误入保护模式，来客无法站起。外接设备可接住他们，却得先转运到诊室；新补丁可远程恢复，多种旧型号仍没测过。频道里不断报来所在位置。","a":"联系邻居，逐户转运","b":"逐型号试补丁，再分批发送"},{"title":"回到屏幕里","text":"一位来客不适应新身体，想回云端。亲友为此次适配准备了很久，仍想再试，医生可重调触感，却无法保证会舒服。来客把陌生的手慢慢放在桌上，等你先听完。","a":"保存当前体验，协助返回云端","b":"请来客挑选触感项目，再试调一次"},{"title":"醒来后的第一步","text":"诊室修好，来客可以学会自行保养，也可继续由工作室照管所有设备。前者需要长时间练习，后者让团队常驻。第一位走出病房的人回身询问，下次手指发僵该怎样处理。","a":"递来图册，陪他练习自检","b":"记下他的体感，安排固定回访"},{"title":"散落的生日","text":"旧记忆交换箱里出现你的生日片段，骨钥藏在蛋糕旁。录像被分存到几位熟人设备上，每人留着不同角度。你能邀请大家一起拼，也能先用自己的积蓄租来高精度修复器。","a":"联系片段持有者，约好一起观看","b":"租来修复器，先扫描现有片段"},{"title":"拿一段声音校准","text":"修复室的旧仪器需要真实回忆校准。同行者可各给一段普通日常，骨钥内也存着你与旧主人相关的鲜明片段。后者细节多，却可能在调试时反复播放，你尚未准备给人看。","a":"请同伴各选一段日常录音","b":"将自己的旧片段接入校准槽"},{"title":"只够保存一种颜色","text":"显影材料只够一批，一边是旧委托的取件线索，一边是老人认出亲友的残片。手洗两批更慢，也可能损掉色彩；用清晰家庭片段训练识别又会混入陌生面孔。","a":"带志愿者分批手洗两组材料","b":"隔离副本，试训修复模型"},{"title":"完美画面的雨","text":"一段回忆清晰得像精心布景，雨却朝上飘。委托人坚信那是与父亲最后一次散步，修复师发现旧软件曾自动补帧。独立照片可能在别处，当前画面也能先修好播放。","a":"标出补帧痕迹，寻找独立照片","b":"保留原文件，先整理播放副本"},{"title":"不打开的那一段","text":"委托人愿交来大部分回忆，只想保留一个加密文件夹。完整扫描比较容易找到缺页，分区处理需要额外工具。维修组有人提出用你的旧记忆先试工具，你的私人文件也还没整理。","a":"保留加密区，另做分区工具","b":"选出自己的片段，先试修复流程"},{"title":"昨天寄给明天","text":"母亲存下许多与孩子相处的录像，自己的记忆却在逐渐模糊。旧格式片段散在不同设备上，有些只能借回重录；集中扫描更快，却可能覆盖主人添写的注释。她拿着一本渐空的相簿。","a":"逐个联系设备主人，借回重录","b":"先复制现有片段，再扫描注释"},{"title":"夜间失忆提示","text":"旧修复机短路，擦除脉冲沿桌面线路蔓延。屏蔽棚能让便携设备暂避，需要有人守着接地；骨钥能反查故障源，回流也可能触到邻屋相簿。桌上生日歌还在断续播放。","a":"留下维护接地，请同伴搬设备","b":"接上骨钥，反查脉冲来源"},{"title":"笑容后面的空白","text":"旧整理程序只留下笑脸，把哭泣与犹豫放进隐藏目录。委托人中有人想找回完整经历，也有人主动删过某些片段。目录没有清楚区分，桌上一封家书提到从未在录像里出现的冬天。","a":"逐人询问，再恢复所选片段","b":"完整导出目录，分装待确认副本"},{"title":"可以重做的修复","text":"修复模型用了许多家庭样本，有人如今想撤下自己的片段。重训会让设备暂时变慢，沿用旧模型则无法完全拆出相关影像。来访者认真指着一张童年照片，请你再看一眼。","a":"备份任务，开始移除样本重训","b":"暂停相关任务，先核对模型引用"},{"title":"所有人的梦涌出来","text":"存储阵列失控，陌生梦境串入各家终端。分区断网能逐段清理，却会中断亲友通话；你可把溢出片段暂存自身接口，个人记忆也可能被混淆。有人在频道里唱起不认识的歌。","a":"逐区断网，安排线下照护","b":"接上自身缓存，收拢溢出片段"},{"title":"记住修错的地方","text":"旧日志显示你曾接反一条线，导致几份委托串档。如今的你已忘了那次故障，来访者却仍相信你熟悉它。修复师可以陪你重看，骨钥里还有尚未拆开的返工清单。","a":"与委托人说明日志，一起核对","b":"先保存日志，按返工清单逐项检查"},{"title":"修复铺的晚钟","text":"修复铺即将重新接单，完整恢复的旧招牌还挂着，许多残片却已无法验证。分阶段修复需要顾客多来几次，继续提供自动补全则能很快交件。门边有人抱着初恋的旧相匣迟疑。","a":"换上分阶段修复说明","b":"展示自动补全样片，请来客选择"},{"title":"工具袋里的继承函","text":"老巡检员把骨钥放进你的工具袋，附着一队维修助手的未完交接。旧电池即将到寿命，有人想先回访服务过的邻居，有人想马上进中控室查故障。巡检车停在雨棚下等充电。","a":"联系助手和邻居，核对旧任务","b":"带骨钥去中控室检查电池记录"},{"title":"通行码是一串动作","text":"维修间安全门要求来客完成机械手校准，你的手却在最后一步疼得缩回。同行者愿等人工开门，骨钥也能载入旧校准模板，但模板的动作幅度与你不同。门内传来低电提示。","a":"停下校准，等维修员人工开门","b":"载入旧模板，缓慢重试动作"},{"title":"挡雨罩与探测头","text":"稀有材料只够做一批挡雨罩或一组探测头。前者能护住搬迁设备，后者可定位漏电源，几处旧接头却可能被强信号干扰。团队已经装好工具车，雨还没有停。","a":"制作挡雨罩，分批搬运设备","b":"组装探测头，查找漏电位置"},{"title":"徽章里的录音","text":"旧巡检徽章藏着一段事故录音，既记着错误操作，也记着同事后来回来救机。那位同事如今仍与你值夜，不愿再听自己的慌乱声。完整波形有助定位故障，你也能先看截出的技术部分。","a":"请同事陪着核对完整录音","b":"先提取故障波形，封存私人语音"},{"title":"递过来的手套","text":"维修小队愿一起照看云库，想保留手动暂停与相互复核。自动机群可以更快完成清洗，却不会发现图纸外的小习惯。队员把手套放上桌，提醒某个音箱主人怕水声。","a":"与队员核对习惯，安排共同维修","b":"部署自动机群，沿线检查反馈"},{"title":"旧电池的计时","text":"助手电池更换提示与休眠日志缠在一起，换电可能覆盖它们的工作记忆。新存储件需要挤出其他修理预算；旧计时补丁可延长运行，但真实电量变得难估。充电架上只剩两盏绿灯。","a":"添购存储件，逐个更换电池","b":"在测试台校验旧计时补丁"},{"title":"窗口后的人","text":"搬机路线经过正在远程探亲的窗口，切线会中断那场等了很久的通话。暂停搬运要错过电梯时段，自动绕线又可能让画面突然混入施工影像。团队停下推车，望着你手里的接头。","a":"暂停搬运，等亲友结束通话","b":"接好隔离线，试着绕过窗口"},{"title":"旧助手想起的事","text":"维修助手讲起与你共同巡楼的回忆，日志却显示那是一套共享训练场景。告诉它来处可能打乱眼下的熟悉感，继续使用场景又会带来更多误认。它已经把下一段巡检路线发来。","a":"陪助手查看训练场景的来源","b":"先标好实际路线，稍后逐项核对回忆"},{"title":"检修要多久","text":"云库迁移暂停才能做全面检修，几个来客却已约好今晚见亲友。分段复查要反复开关设备，一次完整检修也难估何时完成。白板上还留着上次未兑现的结束时刻。","a":"写好分段时限，逐次与来客确认","b":"先做完整检修，记录每段进度"},{"title":"请听见我的名字","text":"旧维修机器人卡在循环动作中，反复推着同一只空箱。逐个呼叫名字可能唤回独立程序，总休眠按钮则会让同型号的家庭助手一起停下。走廊里已堆满来不及搬走的设备。","a":"带队逐个呼叫机器人","b":"保存现场记录，按下总休眠"},{"title":"晚饭时的空椅","text":"检修结束，一位队员没来吃饭，他在搬迁时摔坏了顾客的相匣，正在独自修。队友想一起查经过，他却怕被看见失误。你手上是他的作业单，桌上那份饭仍温着。","a":"带饭过去，请大家一起复盘","b":"先陪他修相匣，整理作业单"},{"title":"最后一张巡检单","text":"新巡检路线准备启用，可以由队员轮换，也可让骨钥统一带领自动机群。轮换有人情上的照应，却难覆盖每个深夜；自动线路整齐，有些旧设备却需要临场判断。控制台等着保存设置。","a":"给队员分好路线，约定交接","b":"保存自动路线，带骨钥做首轮巡检"},{"title":"寄给无人认领者","text":"告别室收到几百封退信，里面夹着骨钥和几份无人来取的声音备份。值夜人想先请邻居辨认，旧机器却快坏了。你可以先租大存储盘搬走，再慢慢找每个名字的来处。","a":"召集愿意帮忙的人，逐份听信","b":"租来存储盘，先迁出声音备份"},{"title":"没有亲属的探望","text":"旧友来探望云端来客，预约表却只记着家属设备。邻居可以帮忙确认相识经历，骨钥也能先建立临时访客房。来客的窗口已经亮了，只是消息还在错误的收件箱里。","a":"请邻居帮忙核对，再重发邀请","b":"开好临时访客房，联系窗口主人"},{"title":"静默也占内存","text":"存储快满，几份多年不发声的备份仍占着完整空间。缩短大家的实时通话可腾缓存，把静默备份压缩则能容下新来客，但可能丢掉细微连续性。值夜人仍每晚向它们问好。","a":"与来客商量，缩短实时通话","b":"备份原目录，压缩静默文件"},{"title":"最后一句话","text":"老人发现亡妻每次告别都说同一句话，原来播放器误把示例语音接在了结尾。真正的末句藏在损坏文件里，修好后也未必是他想听的内容。你把两段文件分开放在桌上。","a":"先向老人解释，请他决定何时听","b":"先修好原文件，整理完整播放顺序"},{"title":"替陌生人守灯","text":"邻里愿轮流陪无人探望的来客，夜班却已经缺了几处。自动留言可以先填空，又无法真正接住当下的回答。第一位志愿者连续熬夜，杯中的茶早已凉了。","a":"重新排班，与你能来的同伴轮值","b":"录好提示留言，再补安排回访"},{"title":"清明的留言","text":"祭奠留言误接保养提示，来客醒来只听见设备电量不足。维修员既要更换电池，也要赶去探望自己的亲人。逐户修理很慢，一次重置可迅速恢复，却会清掉未存的草稿。","a":"与维修员逐户备份、换电池","b":"先导出目录，再重置留言服务"},{"title":"告别频道串线","text":"几场私人告别串到同一频道，熟悉的人声忽然从陌生窗口传来。逐户通知断线能保住画面，中央重启则会让所有正在传输的文件中断。一位老人反复说，请等我把最后一句说完。","a":"逐户联系，安排单独重连","b":"保存已接收片段，重启频道"},{"title":"备份里没有那个冬天","text":"同一来客的早期版本想留在近处，晚期版本想去远方学习，两者都不记得对方经历的冬天。分别保存需要更多空间，合并最近配置则会舍掉一些不同选择。亲友把旧照片放到窗口前。","a":"给两版各留空间，陪它们交谈","b":"先按最新配置整理迁移副本"},{"title":"留到什么时候","text":"亲友想长期保存来客的声音，来客却希望几段私人话只留到告别结束。按片段分设期限需要细致整理，整盒留存又可能在日后误播。你看见一段命名为别在吃饭时听的短音频。","a":"与来客逐段设置保存期限","b":"先封存整盒，停用自动播放"},{"title":"今夜没有晚安","text":"告别室散热故障，天亮前必须停机。邻居设备可以临时接纳，格式转换也许会丢几句声音；大厅大屏存储充足，却藏不住私人影像。来客轻声问能不能先给孩子说晚安。","a":"联系邻居，分散迁往私人设备","b":"搭起遮屏与隔音棚，接入大厅设备"},{"title":"请不要替我回答","text":"陪你很久的云端朋友决定迁往远方。你可以按约清除本地缓存，也可以先留一份等待双方复核的旧副本。对方还在线，问你今后希望怎样联络，工作室的晚灯已经亮起。","a":"确认联络时段，交接并清除本地缓存","b":"询问对方是否愿意暂留封存副本"},{"title":"守夜人的交班簿","text":"告别室修好，新的交班簿仍空着。邻里与来客可轮流值夜，有些时段仍会安静；你也能长期住在机房，照看熟悉的每个窗口。第一班灯亮起，桌边还放着没拆的行李。","a":"与大家排好轮值，把交班簿传下去","b":"放好行李，写下长期值夜安排"}],"endings":[{"title":"一起修好的云","text":"你和邻里把旧工作室修到能正常接单，骨钥拆成了几枚工作密钥。第一次交班就漏记一只滤网，大家忙到深夜，也终于弄懂彼此的习惯。云库偶尔仍限流，来客也会抱怨等得太久，但每张修理单有人接着读。你清洗机箱时，一位云端来客嫌水声太大，你们商量改个时辰。继承交接终于落在这些小事里：有人会修，有人会问，也有人记得下一班要休息。","hint":"支持项（每项一分）：第1节点「救助眼前的弱者，建立互助基础」、第4节点「加入邻里照护队，承诺共享资源」、第5节点「将储备交给互助网络」、第6节点「照护同行者，践行早前约定」、第8节点「协调邻里照护队与云库维修组，建立撤离通道」；第一、二幕各至少一项；公共结算：每方向至少命中两项不同早期行动，且第一、二幕各有支持；优先兑现第三幕声明的已建立方向，否则按命中数降序；同分按共同生还、长期主理、带伤远行、查明往事、以身承接、余生守望顺序。无方向建立才兜底余生守望。身份、关系、秘密满足原条件时优先，不满足则按此公共比较结算。"},{"title":"温柔的总维修师","text":"你保留整枚骨钥，接下云库与诊室的大部分检修。窗口准时亮起，零件也终于有了固定来处，团队习惯先问你的判断。起初你逐条答，后来累得只能看摘要，一次遗漏使熟悉的来客等了一夜。你开始整理可交给同伴的步骤，却仍舍不得离开核心机房。工作室运转了下去，你的手艺越来越稳，学会安心交班仍是另一项未完成的修理。","hint":"支持项（每项一分）：第1节点「整理维修物资，与云库维修组协作」、第4节点「加入云库维修组，共同照看设备」、第5节点「建立云库维修组应急储备」、第6节点「先处理维修事务，与云库维修组协作」、第8节点「整理维修记录，协助云库维修组的工作」；第一、二幕各至少一项；公共结算：每方向至少命中两项不同早期行动，且第一、二幕各有支持；优先兑现第三幕声明的已建立方向，否则按命中数降序；同分按共同生还、长期主理、带伤远行、查明往事、以身承接、余生守望顺序。无方向建立才兜底余生守望。身份、关系、秘密满足原条件时优先，不满足则按此公共比较结算。"},{"title":"带着旧机房远行","text":"你带维修队离开漏水的老机房，把设备分装到沿途的小站。有些旧文件丢了索引，只能靠亲友一声声呼叫确认。你睡在发电机旁，记下迁移成功与未能恢复的名字，也听来客谈起再也找不到的冬天。多年后，一封远方语音传回旧街，说这里有个能同时接待人与云端来客的小站。录音末尾，你咳嗽一声，同伴提醒下一家还等着报平安。","hint":"支持项（每项一分）：第3节点「依靠普通技能，不调用天赋」、第4节点「加入邻里照护队，承诺共享资源」、第6节点「离开同行者，保全自己」、第7节点「停止研习，照顾自己的身体」、第8节点「协调邻里照护队与云库维修组，建立撤离通道」；第一、二幕各至少一项；公共结算：每方向至少命中两项不同早期行动，且第一、二幕各有支持；优先兑现第三幕声明的已建立方向，否则按命中数降序；同分按共同生还、长期主理、带伤远行、查明往事、以身承接、余生守望顺序。无方向建立才兜底余生守望。身份、关系、秘密满足原条件时优先，不满足则按此公共比较结算。"},{"title":"没能修回的细节","text":"你查清旧委托怎样串档，也把自己的误接线记录交给了来访者。原文件并没有因此全部复原，几份相匣只剩不能补回的空白。你拿出积蓄添设备，仍凑不齐所有零件。有些人继续委托，有些人只来取回原件。后来你在门边放一把椅子，来人想讲那段已听不见的往事时，你便暂停编号。查清经过不是修复的终点，剩下的工作仍要一天一天做。","hint":"支持项（每项一分）：第1节点「保留异常证据，开始调查」、第4节点「加入私人记忆室，承诺保全证据」、第5节点「公布第一份证据」、第8节点「展示调查记录，与同伴共同核对」；第一、二幕各至少一项；公共结算：每方向至少命中两项不同早期行动，且第一、二幕各有支持；优先兑现第三幕声明的已建立方向，否则按命中数降序；同分按共同生还、长期主理、带伤远行、查明往事、以身承接、余生守望顺序。无方向建立才兜底余生守望。身份、关系、秘密满足原条件时优先，不满足则按此公共比较结算。"},{"title":"断电前的最后一次回应","text":"你用自身接口接住过量的备份，云库逐个恢复窗口，你却只剩简单的应答。团队把你接回普通终端，慢慢辨认还在的记忆。有人来感谢，也有人沉默地看未恢复名单，你都陪着听完。后来机房为你安排慢一些的活，不再要求你负担整条线路。窗边来客请你调低声音，你按了两次才找到按钮。你还在这里，也还可以从一件小事重新学起。","hint":"支持项（每项一分）：第3节点「以当前身份研习天赋，接受其负担」、第6节点「照护同行者，践行早前约定」、第7节点「继续研习天赋并承担负担」、第7节点「过度调用天赋，换取紧急资源」；第一、二幕各至少一项；公共结算：每方向至少命中两项不同早期行动，且第一、二幕各有支持；优先兑现第三幕声明的已建立方向，否则按命中数降序；同分按共同生还、长期主理、带伤远行、查明往事、以身承接、余生守望顺序。无方向建立才兜底余生守望。身份、关系、秘密满足原条件时优先，不满足则按此公共比较结算。"},{"title":"尚未修完的黎明","text":"天亮时你仍住在旧工作室，屋檐漏水缓了些，桌上的待修件却没有清空。有人搬走，也有人回来找一段以为已经丢失的声音。你按月核对电费，给新同伴说明每台旧机的脾气。骨钥不能替你保证每个判断正确，昨天未修好的相匣仍得重新拆开。门外有份写给失联来客的包裹，你把它放入待领柜，没有急着注销名字。","hint":"支持项（每项一分）：第3节点「依靠普通技能，不调用天赋」、第4节点「加入邻里照护队，承诺共享资源」、第5节点「将储备交给互助网络」、第7节点「停止研习，照顾自己的身体」、第8节点「协调邻里照护队与云库维修组，建立撤离通道」；第一、二幕各至少一项，或所有公共方向均未建立时兜底；公共结算：每方向至少命中两项不同早期行动，且第一、二幕各有支持；优先兑现第三幕声明的已建立方向，否则按命中数降序；同分按共同生还、长期主理、带伤远行、查明往事、以身承接、余生守望顺序。无方向建立才兜底余生守望。身份、关系、秘密满足原条件时优先，不满足则按此公共比较结算。"},{"title":"家谱旁的修理单","text":"你练熟旧主人的文件格式，终于分清家中往事与客户委托。家谱里夹着许多你从没听过的名字，每个名字后都是一件尚未交回的东西。你没有把整间工作室当成已经熟悉的家，而是逐户询问、逐项学习。私人相簿留在自己的柜里，工具与检修图则和团队共用。后来你搬到机房旁的小屋，第一次自己核算每月电费。家谱最后添了一行新地址，修理单仍继续往下写。","hint":"以「继承旧修复工作室的年轻人」开局；第一幕研习身份技艺；第二幕继续研习；第三幕整合技艺；身份技艺达到 3；所属阵营支持至少 4，技艺有实际服务对象；天赋负担不超过 6；终幕选择「以身份技艺服务所属阵营」。"},{"title":"今天由我签收","text":"你把同源助手的配置逐一拆开，让相同的脸也能带着不同习惯工作。新标签贴好后，有人改了两次名字，有人选去别的小站，你都记下，没有追问为何不留下。共用的旧设备不够分，保养仍靠大家慢慢凑。后来一箱写给旧主人的零件送到，你先核对，再签收属于自己那一盒。窗边合照的人并未变少，只是每个人终于有了自己的收件地址。","hint":"以「拥有相同初始记忆的合成助手」开局；第一幕研习身份技艺；第二幕继续研习；第三幕整合技艺；身份技艺达到 3；所属阵营支持至少 4，技艺有实际服务对象；天赋负担不超过 6；终幕选择「以身份技艺服务所属阵营」。"},{"title":"最慢的邻里线路","text":"你把维修本领练熟，将骨钥交接给团队，回到街巷里最熟悉的管线。路线图上多了探望、迁移与替老人读操作单的时间，雨天仍会断一段，电池也要轮着借。一次深夜送修，孩子正向云端祖母炫耀接线手艺，祖母叮嘱他先拔电。你放下修好的接口，又留了一张下次检查日期。街灯以不整齐的节奏亮起来，你可以回去休息了。","hint":"以「维护街巷记忆管线的维修工」开局；第一幕研习身份技艺；第二幕继续研习；第三幕整合技艺；身份技艺达到 3；所属阵营支持至少 4，技艺有实际服务对象；天赋负担不超过 6；终幕选择「以身份技艺服务所属阵营」。"},{"title":"出院后的第一步","text":"反复练习接入与停机后，你更能听懂来客说的细微不适。诊室仍缺零件，预约也不能一下排完，你把迟到的治疗与失败的适配同样记入报告。第一位康复者回来，想改成自己做保养，你有些担心，仍陪他从最简单的一项练起。他握住你的手，说真有问题会来敲门。你看着那只慢慢熟悉的新手，收起下一次自动上门的预约，留给他自己决定。","hint":"以「替云端来客调试身体的义体医生」开局；第一幕研习身份技艺；第二幕继续研习；第三幕整合技艺；身份技艺达到 3；所属阵营支持至少 4，技艺有实际服务对象；天赋负担不超过 6；终幕选择「以身份技艺服务所属阵营」。"},{"title":"没有补画的童年","text":"你学会分辨原始记忆与自动补帧，修复铺开始只交付能说明来处的部分。属于你的生日仍不完整，有些色彩混入旧模型，蛋糕的味道再也找不到。你没有替自己编出余下的快乐，只把空处留在相簿。店门口摆着一本普通笔记，顾客可以写下今天发生的事。某个雨夜，你记下和邻居吃过一碗面。旧日并未全归来，新的记忆却在慢慢长成。","hint":"以「寻找散失童年片段的记忆修复师」开局；第一幕研习身份技艺；第二幕继续研习；第三幕整合技艺；身份技艺达到 3；所属阵营支持至少 4，技艺有实际服务对象；天赋负担不超过 6；终幕选择「以身份技艺服务所属阵营」。"},{"title":"收起巡检灯以后","text":"你把夜间巡检练成能交接的手艺，团队也不再靠你独自熬夜。旧事故记录被仔细核过，有些设备能补，有些相匣无法修回，你陪委托人逐件确认。后来你只值其中几段夜班，路过旧机房时仍会忍不住听风扇声音。新队员有次主动停下自动清洗，因为窗口主人正在说话。你站在门外等了一会儿，发现自己终于可以放心把工具袋放下。","hint":"以「重返夜班的设备巡检员」开局；第一幕研习身份技艺；第二幕继续研习；第三幕整合技艺；身份技艺达到 3；所属阵营支持至少 4，技艺有实际服务对象；天赋负担不超过 6；终幕选择「以身份技艺服务所属阵营」。"},{"title":"第一份自我介绍","text":"你弄懂自身接口后，为自己建立了独立配置。系统没有适用的初始模板，你与记录员反复试了很久，终于写成一份由你选择的介绍。算力不多，你租住在邻里机房，白天帮人查设备，夜里学习从未亲历的历史。孩子问你生日，你选第一次自己说出名字的日子。大家轮流关闭屏幕又打开，短暂黑暗后仍在原处，等你挑一种喜欢的声音说谢谢。","hint":"以「从废弃服务器醒来的数字孤儿」开局；第一幕研习身份技艺；第二幕继续研习；第三幕整合技艺；身份技艺达到 3；所属阵营支持至少 4，技艺有实际服务对象；天赋负担不超过 6；终幕选择「以身份技艺服务所属阵营」。"},{"title":"每段话的来处","text":"你将记忆来源核对成可复查的手艺，私人记忆室也愿保留那些暂不能下结论的委托。最动人的片段有些没有展出，因为主人只想自己听；最普通的维修录音却帮人找回了旧邻居。你在街角摆起记录桌，来客可以说想恢复什么，也可以说哪段别碰。傍晚收桌时，亲友问能否代云端来客道谢，你把音箱转过去。它若想开口，你会等着听完。","hint":"以「替委托人核对记忆来源的记录员」开局；第一幕研习身份技艺；第二幕继续研习；第三幕整合技艺；身份技艺达到 3；所属阵营支持至少 4，技艺有实际服务对象；天赋负担不超过 6；终幕选择「以身份技艺服务所属阵营」。"},{"title":"你可以不同意我","text":"你护住邻里联络员，也持续照看对方的伤，最后选择把生活留在彼此身边。工作室搬迁时，对方指出你的线路图漏了一处住户，你们为此争了很久。你没有用熟练结束话题，带着新图再去量了一次。晚上仍一起吃饭，谈到店主收摊。后来意见不同的日子还有许多，那锅热汤也并非每次都合口味，但你知道争论之后仍可以继续敲同一扇门。","hint":"第一幕与邻里联络员相识；第一幕结识的人，在第二幕获你保护，第三幕仍守约（信任至少 5）；终幕选择「将共同生活置于使命之前」。"},{"title":"两座小站的晚饭","text":"云端导师得到远方工作的机会，你继续照护，也把迁移安排交由对方确认。频道延迟长了，有时饭做好才收到问候，有时整夜只有故障提示。你确实想念，也打开过本地缓存菜单，最后仍先发消息问何时方便。后来两边都有新的朋友，话题不再只绕着旧工作室。某晚通讯恢复，你说窗外下雨，对方说那边起风。两顿很普通的晚饭，就这样隔着距离一起吃完。","hint":"第一幕与云端导师相识；第一幕结识的人，在第二幕获你保护，第三幕仍守约（信任至少 5）；终幕选择「将共同生活置于使命之前」。"},{"title":"被放回桌上的骨钥","text":"交还骨钥的旧对手愿继续与你合作，因为你在故障时护住他，之后也没忘照护的约定。你们各自说明曾漏记的修理单，不拿旧情催对方立刻释怀。有段日子话很少，却照常轮修共用终端。后来他带来一份与你想法不同的预算，也顺手放下两份晚餐。你先读完预算，再问店今晚开到几点。骨钥放在桌边，两个人的回答都还需要自己说。","hint":"第一幕与交还骨钥的旧对手相识；第一幕结识的人，在第二幕获你保护，第三幕仍守约（信任至少 5）；终幕选择「将共同生活置于使命之前」。"},{"title":"同一段往事的两个人","text":"你与同源人格看完共同回忆的来处，才发现最初那场雪属于旧训练场景。对方想暂时分开住，你继续照护，也答应重新询问熟悉的称呼。慢慢认识后，你们喜欢的音乐并不相同，小事也会争吵。共有过去不能再证明彼此会永远亲近，你们却开始积累只属于此后的故事。周年时，两人约在同一家小店，庆祝第一次分别走来，又各自愿意坐下。","hint":"第一幕与同源人格相识；第一幕结识的人，在第二幕获你保护，第三幕仍守约（信任至少 5）；终幕选择「将共同生活置于使命之前」。"},{"title":"桌边还有空位","text":"你为无亲属的受托人格留下照护，也给它保留不想说话的时段。最初一起整理骨钥的人，后来常来同一张饭桌，有人修管，有人核账，有人只是歇脚。维护费仍得凑，疲惫时也有人离开一阵。节日里孩子替云端来客摆上一把椅子，你本想说终端用不着，最后只把自己的凳子挪开。饭桌伸到走廊，谁愿意来，仍有人认真记着。","hint":"第一幕与无亲属的受托人格相识；第一幕结识的人，在第二幕获你保护，第三幕仍守约（信任至少 5）；终幕选择「将共同生活置于使命之前」。"},{"title":"遗嘱没有第一作者","text":"几种交接经历与旧日志互相印证，你发现所谓遗嘱并非一次写成。来访人格、维修助手与旧主人在许多个夜晚各补一段，最后才合成如今的清单。每个人只知道自己那件小事，没有谁预先安排你会怎样接手。你把来处交还各人核对，删掉软件误补的统一署名。修理顺序仍要重新商量，工作室却终于不必猜一个人的最后想法。云库里的助手说，它当时只想记得把那只相匣寄回。","hint":"前局发现「public.rescue」；前局发现「public.rule」；第一幕调查冲突根源；第二幕促成阵营协商；收集至少两份证据；终幕选择「用旧日发现调解阵营」。"},{"title":"雨声中的新来客","text":"你重拾修复技艺，也守住与邻里联络员相伴的约定，沿着管线的微小延迟找到陌生回应。它们从断续片段中形成，已不属于任何一份旧备份，借雨滴与散热脉冲交谈。你请少数维修同伴慢慢学习回应，没有急着替它们补姓名。换管计划因此绕开一段还会漏水的旧墙。后来雨在凌晨停下，管里传来新鲜的笑声，它们为你起了个只在落雨时才说得完整的称呼。","hint":"前局发现「identity.1」；前局发现「relationship.1」；第一幕重拾技艺；第二幕继续研习；第一幕结识的人，在第二幕获你保护，第三幕仍守约（信任至少 5）；终幕选择「承接前世身份与未竟承诺」。"},{"title":"钥匙背面的回执","text":"旧日的接口耗损与照护导师的经历，让你停下依靠自己承载所有文件的办法。骨钥背面有一段一直被当成噪声的回执，原来是来客早年设下的个人维护选项。修好读取后，有人仍请你帮忙，有人换同伴，有人想先静一阵。旧流程因此要重做，你也得逐项询问。第一次等不到同意时，你反复检查终端。后来收到一条新消息，只请你修好窗边音箱，你带上工具去了。","hint":"前局发现「public.sacrifice」；前局发现「relationship.2」；第一幕结识的人，在第二幕获你保护，第三幕仍守约（信任至少 5）；第二幕停止透支；第三幕接受能力限制；终幕选择「以旧日关系记忆解除天赋束缚」。"},{"title":"明天另写交班簿","text":"遗嘱片段、新来客与维护回执合在一起，你和遗嘱校验员发现了工作室反复回到交接日的原因：恢复脚本总把未完成任务连同旧记忆覆盖回来。你照看校验员，也等各位来客确认外存副本。停止自动回写后，未修好的相匣仍在，电池也还会耗尽，却不会再抹去你们一起走过的日子。最后校验完成，骨钥只显示本次会话结束。你们走出机房，商量明天谁来开门。","hint":"前局发现「secret.reconcile」；前局发现「secret.inherit」；前局发现「secret.liberate」；第一幕结识记录者；第一幕结识的人，在第二幕获你保护，第三幕仍守约（信任至少 5）；第一幕调查轮回；第二幕展示轮回线索；终幕选择「请记录者见证并终止轮回」。"}],"turns":{"calling":{"title":"骨钥旁的工单","text":"云端导师把一份多年未完的修复工单调到桌面，愿意教你接管工作室的深层记忆修复。旧委托人需要反复回访，这会占去许多夜晚。街巷维修队另有一个管线学徒位置，愿从基础接线教起，只等你决定骨钥该不该留在工作台上。","options":[{"label":"留下骨钥，接学工作室的记忆修复","aftermath":"六年后，你的工作台留着一只专供旧委托人的回访终端，那份工单添了整整六年的修复日志。你常把私人安排让给突发的记忆错位；第一位由你带教的助手，已经开始接待同一批来客。"},{"label":"将深修业务交给导师，改做管线维修","aftermath":"六年后，你负责维护三条街的记忆管线，工具车上有自己设计的转接头。工作室的深修工单署着另一位接手者的名字；你收工后不再接回访终端，旧骨钥被放进了不随身携带的纪念盒。"}]},"bond":{"title":"同步窗还亮着","text":"与你共事的同源人格总在休眠后丢失新记忆，请你担任长期校验伙伴，每天陪他核对一次独立生活的记录。他也拿到了远方照护机房的入住许可。桌上的两份安排都写得清楚：留下需要你的日常时间，离开则由新的团队接手。","options":[{"label":"答应每天校验，陪他建立自己的记录","aftermath":"四年后，你的日程里始终留着一段不可预约的校验时间，终端旁积攒了他独自学画的图像。你放弃了跨时区的常驻工作；他现在拥有一份由你连续见证四年的生活记录，首页写着你们共同约定的校验暗语。"},{"label":"送他转入远方机房，各自开始生活","aftermath":"四年后，他在远方机房拥有新的校验伙伴，你们共用的同步窗一直封存在分别那日。你接下了跨时区的驻场工作，私人终端改成独用布局；偶尔收到他的画作，寄件地址已不再与你相同。"}]},"home":{"title":"楼上的空层","text":"邻里联络员邀你把工作室楼上的空层改成长期住处，电源、机体停靠位和普通家具都能按需配置，但住户要共同检修老楼冷却管。另一座海滨城的迁居服务已发来房源：空间更宽，搬过去却要重新建立所有上门维修联系。","options":[{"label":"改造楼上空层，在老街安家","aftermath":"五年后，楼上成为按你起居习惯改好的住处，冷却管检修口特意留在可移动的书架后。邻里的备用接头存放在你家门边；你每年都为老楼停工检修留出假期，窗外招牌的嗡鸣成了熟悉的夜声。"},{"label":"打包私人物件，迁居海滨城","aftermath":"五年后，你住在海滨城的一处独立单元，窗边装了亲自订制的防盐雾滤网。老楼空层已被改成邻里工具间；你花了两个雨季才找齐可信的维修伙伴，如今家门口挂的是新街区的访客码。"}]}},"episode":{"title":"明天的我申请删除自己","source":"echo-reference","opening":{"title":"尚未发生的工单","text":"维修所交班时，最后一张工单落到你手里。你是记忆维修员，今晚再退一单就要被解聘。主管把一份急件拍到桌上，委托人竟是你，提交时间却在明早。附件里，你浑身湿透，对镜头说：别修第七秒。主管催你点确认，屏幕中的你突然抬头，准确念出他还没说完的话。维修椅此时自行扣紧，进度条从零跳到了六秒。","a":"拔下维修椅的数据线","b":"按下工单的原始回放键","attributes":["实力","理智"]},"followups":[{"title":"主管没有倒影","text":"数据线拔掉，主管和墙上的解聘通知一起消失。你原来困在维修所的培训记忆中，六秒片段被反复播放，难怪每晚都在接同一单。真实的助手隔着观察窗敲玻璃，说你已失联三天。桌上的急件却继续更新：她左手没有伤。窗外那人立刻把左手藏进袖子，门锁同时开始转动。","a":"推倒桌子抵住门","b":"把数据线插进工单终端","attributes":["实力","资源"]},{"title":"第七秒的客人","text":"原始回放里，主管正在把顾客的童年打包出售，而第七秒，你的手伸进画面拿走了备份。他立即拔掉监控电源，声称你只是试机生成的人格。你掀开维修椅，找到自己刻下的维修日期，足足延续了六年。柜中的备份灯仍亮着，急件末尾却又多出一句：今晚送单的人不是我。","a":"把备份接入店外展示屏","b":"打开急件的语音回传","attributes":["声望","羁绊"]}],"codas":["门外的人撞上桌沿，皮肤裂成一串测试字符。你等它耗尽，才砸开观察窗。真正的助手左手缠着绷带，接住你时哭了：这回终于不是空椅子。","终端吞下循环片段，弹出你三天前签的潜入调查单。你带着完整操作记录醒来，取消了那份遗忘协议。主管再来催单时，调查员已坐在柜台后。","展示屏播出交易记录，等候的顾客堵住主管，逐份领回备份。你打开自己的文件夹，却只听见陌生孩子喊了一声妈妈。六年的日期属于谁，仍待追查。","回传里响起女儿成年后的声音。她花了十年才把这份工单送回今晚，只求你别删掉作证的记忆。你关掉删除程序，第一次听她讲完那十年的事。"]}},{"id":"w4","name":"魔法与灰雪","premise":"灰雪使白塔城的炉火、药泉与记忆术接连失灵，你与医师、学徒和工匠一起寻找修复方法，穿过寒冬。器灵可借检修人偶行走，以钟声或显字表达意愿。","factions":{"commons":"炉边照护队","council":"白塔修习组","archive":"晶纹记事馆"},"fate":{"characters":["伊芙","白塔导师","诺弥","母亲","雪原向导","晶纹档案员"]},"origins":["暂别课堂的白塔学徒","药泉病房的夜班医师","往返雪路的送药车夫","照料旧花园的术式园丁","替人修补记忆的缝忆师","逐户检修法器的巡灯人","熟悉旧矿道的掘晶工","记录魔力消耗的工坊账房","寄身检修人偶的雪原古钟灵","从旧零件堆醒来的拾荒铁偶"],"events":[{"title":"白灰晨检","text":"白塔晨钟敲到第十三声，你掌心的施法纹忽然暗了。身边女童的暖手咒也失效，检查台只剩一次复测材料。夜间寒潮将至，炉房有人等你去修，女童却一直盯着冰冷的手指。","a":"陪女童到检查台复测","b":"先测试自己的施法纹"},{"title":"会呼吸的铜尺","text":"检定铜尺传来第二个人的呼吸，诺弥发现它错接隔壁暖炉，测量时会抽走握尺者的热。门外还有许多人等结果。暂停可以重新手测，撬开尺腹则能查明具体断线。","a":"与诺弥停下测量，照看发冷的人","b":"撬开尺腹，取出断线样本"},{"title":"借来的纹样","text":"你的施法纹暂时失灵，熟人愿借一枚家用纹章，能打开白塔实验室，却会把两人的咒语暂时连在一起。街坊正试做不用纹章的小火炉，材料尚不齐。你手边放着两份图样。","a":"留下和街坊一起试做火炉","b":"借来纹章，去实验室查图"},{"title":"药泉末班水","text":"最后一桶药泉只够几次治疗，门外却不断有人发热。泉眼被灰雪堵住，床下旁管仍可引水，但多年没清洗。医师按病情摆好杯子，另一位同伴已取来扳手。","a":"陪医师分好现有药水","b":"检查旁管，尝试重新引水"},{"title":"门后的伊芙","text":"邻居伊芙一直帮忙送面包，却没说自己的治疗术也开始失灵。她带来实验室后门钥匙，想请你一同排查。街坊担心她再施术会伤身，她仍惦记隔壁病床。","a":"请伊芙坐下，与大家核对症状","b":"接过钥匙，陪伊芙去实验室"},{"title":"擦不掉的耗损","text":"旧工坊账册记着大量异常魔力消耗，对应灰雪开始的日期。原账能帮助比对故障，记数符却还在持续抽热。搬走整册要经过寒冷走廊，直接熄符又可能使旧数字消散。","a":"先抄下数字，再护送原账","b":"熄灭记数符，检查炉房温度"},{"title":"送药车的铃声","text":"送药车卡在结冰广场，车内保温银管已弯，病人正在发抖。轮流以掌心温管可慢慢融冰，撬开路面排热渠也能脱困，却会让附近炉房散热。车夫握着铃绳等你。","a":"与同伴轮流温管，推动车轮","b":"撬开冰下渠盖，放出暖流"},{"title":"面包房的长桌","text":"面包房长桌摆满修炉图，学徒熟悉新咒，老工匠懂旧接头，谁都还没说完。雪夜只剩几小时，大家可以分段试验，也可以跟你先拼一台样炉。窗外的灯又暗了一盏。","a":"分好图纸，请各人试做一段","b":"清出工作台，带大家先拼样炉"},{"title":"炉火等不到天亮","text":"储热井被冻住，病房的灯逐盏变暗。自愿者可用温暖记忆续火，却可能淡忘熟悉面容；远处备用井还有热，只是旧阀从没完全打开过。雪已盖住门槛。","a":"请愿意的人围炉坐下，逐段续火","b":"带工匠去备用井，试开旧阀"},{"title":"讲述中的停顿","text":"回忆镜把迟疑当成影像噪点，病人越紧张，记录越模糊。诺弥能调整镜片，让画面连续，却可能补出本不存在的细节。屋外也架着普通录音筒，风声有些大。","a":"取下回忆镜，用录音筒慢慢听","b":"请诺弥调好镜片，再试一次"},{"title":"塔心的双闸","text":"塔心一侧连着过热炉管，一侧维持雪外屏障。拆管会让屏障变薄，分段改造又需要很多天。备用汇流环能让你暂时承接热流，但你的施法纹已有细裂。","a":"先拆最热的一段，与工匠逐步改造","b":"套上汇流环，接住主路热流"},{"title":"灰雪后的早晨","text":"新炉方案摆在桌上，小型炉由各家照料，需要慢慢培训；旧主炉可由你修好集中供热，却需要长期有人守着。病人和学徒都盼明早暖些，窗上又落下一层灰雪。","a":"分发小炉图，约好一起试做","b":"带上工具，留在主炉旁检修"},{"title":"无火病房","text":"保温符忽然熄灭，热量错流向白塔空着的温室。医师的随身暖石还能暂撑，药商车里的火晶也已到门外，只是封箱冻住了。病人裹紧毯子，医师的手同样在抖。","a":"与医师接上暖石，轮流照护","b":"请车夫一起打开冻住的火晶箱"},{"title":"疼痛的刻度","text":"新诊断镜把灰雪病人的刺痛记得很轻，原来镜面只测皮温。停镜后可以人工分诊，修镜却要占用急救阵作校准。屋外又送来一位说不清哪里疼的来客。","a":"停用镜子，逐人询问检查","b":"腾出校准时段，重调诊断镜"},{"title":"白袍上的灰线","text":"护士救治孩子时被错流灼伤手指，旧疗法要求暂时停工，她却惦记无人换药的病床。邻里愿意学护理，医师也可用固定夹帮她继续做简单工作。白袍袖口还留着烧灰。","a":"请护士休息，教邻里接手换药","b":"替护士装好固定夹，重新排工作"},{"title":"一袋净魔血","text":"一袋罕见净魔血可帮重病孩子，也能唤醒中毒的送药队长。献血者留下字条，希望先照看最虚弱者。药师另有一车常用药可带来，却需要取走这袋样本试配替代方。","a":"陪医师给孩子用药，另找送药人","b":"将样本交给药师，接来常用药"},{"title":"不会疲倦的医生","text":"名医把自身疲劳接进储梦枕，多日不休，枕里的器灵却已无法完整说话。停用后需要团队分担门诊，重新调节则可继续借力，器灵还没学会辨认自己的疲惫。候诊厅坐满了人。","a":"断开储梦枕，安排团队轮班","b":"陪器灵试调连接，缩短每次施术"},{"title":"药方背面的字","text":"廉价止痛药让病人安静，却使姓名变得难记。配药册背面记着灰雪草的异常反应，骤停又会使疼痛反复。仓库还有未试过的替代草药，药师想先照顾依赖旧药的人。","a":"陪药师逐步减药，记录每次反应","b":"打开草药库，试配替代方"},{"title":"隔离门外的歌","text":"病房失火，热胀的铁门打不开，孩子唱歌告诉外面自己还在。湿毯能护着人从侧窗进去，消防水闸也可灭火，却会抽走屏障节点的水压。你听见唱歌声有些哑了。","a":"带湿毯从侧窗进屋接人","b":"打开消防水闸"},{"title":"病床旁的排班","text":"药不够照料所有病人，医师的分配表没记上几位慢性病人的夜间需要。亲友想先把情况说清，急救铃却已经响起。你拿着药柜钥匙，也握着尚未补完的记录。","a":"先补好夜间需要，与医护重排","b":"带药柜钥匙去急救床边"},{"title":"借一段童年","text":"药泉重新涌出需要一段鲜明的温暖回忆。亲友有人愿借童年，过后却可能记不清细节。泉底旧匣也存着历代药师的回忆，只是夹着未经清理的病理幻象。水槽最后一滴正在蒸发。","a":"请愿意的人慢慢讲述童年","b":"打开旧匣，分离其中的药师回忆"},{"title":"空床留下的纸条","text":"修习组要整理治疗记录，现有图表只写退热者，没写未能回来的人。亲友带来空床上的纸条，有些字很私密。完整病例能帮助改药，逐家询问又要花时间。","a":"陪亲友整理愿意留下的文字","b":"先封存完整病例，核查药物反应"},{"title":"泉心里的呼救","text":"药泉底有一间旧温养室，几位长期沉睡的病人仍连在阵中。逐床移出需要外部设备，拉下主阀能停掉异常回流，却会使各处药泉一起断流。墙上既有想醒来的字，也有请再等一夜的字。","a":"备好外接设备，逐床唤醒询问","b":"停下主阀，检查温养室各条支线"},{"title":"药泉的入口","text":"新诊室可用小型药炉，医护与亲友共同学习，供药会少一些；主泉也可重新启用，由你守着核心调节，许多老管仍需要长期照料。病人听完后，问今晚哪张床靠近暖炉。","a":"布置小药炉，安排一起学配药","b":"接回主泉，留在核心值夜"},{"title":"雪线下的小旗","text":"雪原小站升起灰旗，表示屏障结霜。旅人集中在候车室，粮食只够几顿，旧猎道通向有仓房的谷地，却没有完整路标。守钟人正在揉冻僵的手，等你看完地图。","a":"留在站内，与旅人一起修屏障","b":"带上余粮，沿旧猎道找谷地"},{"title":"逆转的风向标","text":"风向标总指向村庄，真正的灰雾却从树林升起。工匠发现转轴可能磁化，实地勘查可以确认，远处探路队也能按你的判断先转向。今晚的风越来越急，测量绳已结冰。","a":"带工匠去实地测风","b":"联系探路队，请他们查看树林"},{"title":"结冰的货梯","text":"粮仓货梯认不出冻僵的手印，搬运者抱着粮袋站在雪里。旧索道还能修，临时接入你的暖纹也能启动货梯，却会把持续热流带到手臂上。屋里孩子敲着空碗。","a":"带人修索道，分批运粮","b":"将暖纹贴上货梯的感应板"},{"title":"会开花的煤","text":"暖煤受热开出灰色小花，工匠认出是储存在煤里的古老植物梦。它们尚未被研究过，营棚却已冷得结霜。附近树林可取枯枝，树根下的薄冰又覆盖着旧封印。","a":"留下样本，先点一小炉暖煤","b":"带人去林边收集枯枝"},{"title":"陌生人的守夜灯","text":"你在雪沟遇见向导，她的夜灯也被灰雪染暗。她愿带你去备用物资棚，却希望先取下会吸引雪蛾的定位牌。定位牌能让失散同伴找到她，你手里还有一卷普通标记绳。","a":"收起定位牌，与她结绳同行","b":"替定位牌加罩，随她查看物资棚"},{"title":"钟腹中的旧谱","text":"锈钟锤落下，钟腹露出多年未取的储能图，轮流鸣钟也能维持屏障。旧抄写者承认有一处尺寸抄错，想先核实。直接试响可以很快看出效果，却可能惊动雪中旅人。","a":"保好原图，与工匠逐项核对","b":"挂起钟锤，试奏储能节律"},{"title":"暴雪中的换班","text":"巡路人困在屏障外，开口会放进灰雪。短时合鸣能护住通道，却会伤到听力；引落旁边雪脊也能挡风，山下火光却看不清是旧灯还是行人。守钟人递来耳罩。","a":"与愿意的人合鸣，接回巡路队","b":"先呼叫山下，再引落侧边雪脊"},{"title":"工具朝向何处","text":"两队修屏障的人来到小站，一队熟悉钟律，一队熟悉雪地结构。分别动手可能碰乱彼此线路，先合图又要错过平静时段。你脚边有一套能直接接入主钟的工具。","a":"请两队摊图，约好分段工作","b":"接上主钟工具，带队先修缺口"},{"title":"屏障要用什么","text":"储能池见底，缩小屏障可护住住处，却会把远处苗圃留在雪里。调节引雪晶也能把灰雪引向空谷，那里尚有没点清的旧棚屋。园丁正在搬最后一盘幼苗。","a":"缩小屏障，帮园丁搬苗","b":"去查看空谷，布置引雪晶"},{"title":"巡路册的空页","text":"小站想记录过冬经过，巡路册只记了出发的人，没记留站添火的同伴。亲友带来手套与便条，另一份机器日志能直接列出整条路线，却也录进许多私人谈话。","a":"与亲友补写手工记录","b":"封存机器原件，核对完整路线"},{"title":"最长的一声钟","text":"主钟绳里结着历年未散的回声，逐个解结可以释放它们，屏障却要轮番补位。斩断绳子会一次放出储能，雪地房屋可能受震。守钟人递来解绳针与断绳斧。","a":"安排接力添火，逐个解开回声结","b":"扶稳主钟，斩开旧钟绳"},{"title":"雪原上的路牌","text":"新路牌尚未写字，沿途小站可以各守一段，也可以接到你的主钟上。分段传讯较慢，合用主钟则要长期依赖同一处设备。旅人最关心下一场雪里能看见哪盏灯。","a":"与各站约好传讯节律，标注路牌","b":"接通主钟线路，逐站测试回声"},{"title":"矿井里的回声","text":"升降机结霜拒载，井底的工人仍在敲击示意。人力绞盘可慢慢拉起，操作需要轮班；废竖井也通地面，但多年积气未清。你刚愈合的手掌碰到绳索仍有些疼。","a":"召集同伴，轮流转动绞盘","b":"打开废竖井风口，查看通道"},{"title":"石头为何认人","text":"感应石总给出不相同的光，原来石座内的器灵正模仿衣服颜色，根本没听懂测量。它怕做错后无人再与它说话。停测可重新教它，带走石座则得让整条矿道暂时改用手灯。","a":"陪器灵重学测量，暂停试灯","b":"搬出石座，沿矿道布好手灯"},{"title":"返程栏的空白","text":"矿道出入表漏掉了一队采样者，自动货梯以为空舱便停在井底。补录要逐段核对，紧急直升模式可以跳过名单，却尚未检查超载。工友把留在井口的午饭收了起来。","a":"联系采样队，补录返程表","b":"检查吊索，切换直升模式"},{"title":"面包与铜线","text":"风雪第三夜，炉边只剩一截铜线，可接烤炉，也可接旧传讯机请邻站送物资。附近仓房还有整卷线，门口却被落雪压住。孩子已经睡下，送信人仍戴着湿手套。","a":"先烤面包，请信使步行联络","b":"带工具清开仓门，取来铜线"},{"title":"老技师的伤臂","text":"伤了手臂的老技师带来升降机图，他曾算错承重，工友因此不太愿再听。图中仍有救出井下人的线索，他也愿解释每处修改。新裂声正从井壁传上来。","a":"请工友一起核对，与技师合作","b":"收好图纸，请技师休息后自行检修"},{"title":"记录里的空行","text":"旧材料账把几次事故旁的姓名记成了零件编号，账房怀疑是自动抄录出错。完整原件夹着工友的医疗记录，展示能迅速核对，也会露出私人病情。几位家属正在门口等消息。","a":"封好病历，与当事人逐项核对","b":"邀请相关家属一起查看完整原件"},{"title":"岩层后的餐铃","text":"排水阵停转，井下餐铃仍有节奏地响。以自身魔纹续阵可能伤到施法能力，凿穿富晶层也能排水，却会让这条矿脉再难开采。救援队已经把绳子系到你腰边。","a":"与愿意的同伴轮流续接排水阵","b":"凿开富晶层的排水口"},{"title":"停机柄旁","text":"修好的矿井准备试运，熟悉旧阵的技师可以先操作，工友也想学会自行停机。培训要花时间，频繁试停还可能震松矿壁。停机柄旁有一把刚搬来的椅子。","a":"组织共同培训，轮流练习停机","b":"先守着停机柄，陪技师试运行"},{"title":"地底的余粮","text":"矿区粮食不够过周，大家可先分散去亲友家，也能开采一枚未稳定原晶换物资。原晶牵着整片地基，采错便难再住。炉旁人彼此看着，谁都舍不得刚修好的棚屋。","a":"帮大家收拾行李，联系亲友","b":"带采样工具去检查原晶"},{"title":"井口的圆桌","text":"矿井修复商想按标准方案一次换完设备，工友发现其中几处旧接口对不上。继续讨论会延后供暖，先装整套则可能再出故障。你把事故记录摆在井口圆桌上，雪落在纸边。","a":"与修复商逐项核对旧接口","b":"先接临时暖管，再试装整套设备"},{"title":"原晶中的人影","text":"主矿脉响起人声，原晶里原来存着旧日行旅的梦影。熔炉会把影像消去，停炉保存需要大量空间；接入你的魔纹可暂留回声，梦也可能混入你的夜晚。","a":"停炉，整理独立存放的晶龛","b":"将矿脉回声接入自身魔纹"},{"title":"地底的灯","text":"矿井重新可用，大家可各管熟悉的一段，也能由你统一安排采样与检修。分段合作磨合慢，独自统筹又容易顾不到细微裂声。第一批新灯挂在井口，旧工具还未收好。","a":"与工友分好区域，约定交接","b":"收拢检修图，安排整井工作"},{"title":"名单上的白洞","text":"学院名单被灰雪浸过，一位学生的名字正在变成空白，朋友也渐渐叫不出他。手写与口述能留住一部分，定忆印可以稳住整页，却会同时收进施印者的思绪。学生仍握着写满答案的考卷。","a":"带同伴反复讲述，手写他的名字","b":"取来定忆印，压住褪色的名单"},{"title":"墨水的脾气","text":"课堂上的纸反复自燃，换普通墨后小灯便亮了。原来新墨混入灰雪粉，会遇到某种魔纹就发热。助教带来样品，换掉全班墨水需要时间，示范台却已能立即重做实验。","a":"收起问题墨水，邀请大家复测","b":"先在示范台更换墨水，重画术式"},{"title":"借书人的影子","text":"少年借的旧书把影子吸进书页，逾期反而只是抄错的归还日期。图书员找到解影法，需要你一段施法余量；大家也可从共享抄本找原式，却得翻许多箱。少年不敢走到阳光下。","a":"与借书人一起查找原式","b":"把掌心贴上书页，接回少年的影子"},{"title":"最后一间教室","text":"街区仅有一间不漏雨的房，孩子要学读写，工匠要学修暖炉。分时上课会占去休息，学院废讲堂虽宽，却要先清理旧阵。教师抱着教材，孩子已摆好小板凳。","a":"与师生商量，轮班共用房间","b":"带工具去修整旧讲堂"},{"title":"导师的推荐信","text":"导师愿写信让你回课堂，也承认早先教过的速成法有疏漏。抽屉里是她未寄出的说明与实验记录，实验室仍用着旧版本。她问你是否愿一起重做，手按在推荐信上。","a":"与受影响的学徒一起复核记录","b":"陪导师进实验室，先修正旧术式"},{"title":"被改写的课本","text":"旧课本记着多种生火法，新版只剩最省力的一种，却没写适用气候。灰雪来后，许多炉子因此失效。藏书室正渗水，抄写原书很慢，搬进记忆晶也会失去部分手写边注。","a":"召集抄写者抢救原书","b":"把藏书阵接入记忆晶"},{"title":"考试后的空座","text":"考试结束几位学生没回来，原来练习传送阵把他们送进废温室。老师可从原路逐个接引，也能重设坐标一次转出，温室里的旧植物却会扰动落点。同学抱着外衣等在门边。","a":"请老师逐个接引，准备暖衣","b":"重新核对坐标，启动整组传送"},{"title":"课程由谁来写","text":"教授想先教完整基础，工坊教师急着教修炉。让师生一起改课程需要停几次课，旧速成书能立刻开讲，却漏写了失败时怎样散热。第一堂课的黑板已经擦好。","a":"与师生共同整理基础和实作","b":"先试做速成书里的暖炉练习"},{"title":"让谁记得谁","text":"记忆术故障，学生亲友逐渐记不起彼此。结对保存片段能分散干扰，也需分享私事；校内大晶可以集中存下整组记忆，其他旧防护术却要暂时断开。门外有人叫错了孩子名字。","a":"请愿意的人结对，分别保存片段","b":"停下旧防护，将记忆接入大晶"},{"title":"答辩桌上的小灯","text":"最后一场展示可以说明旧检定为何失准，也可以展示一盏更强的新灯。前者需重做许多实验，后者可马上给病房照明，却解不开其他设备的困惑。学生把两个盒子推到你面前。","a":"陪学生整理检定实验","b":"陪学生调试高亮新灯"},{"title":"第一条咒文","text":"旧术式共同引用的第一条咒文把静默当成零魔力，灰雪中的器灵因此总被漏算。删除会使许多法器重新校准，改成由你逐次补值则可马上运行。学生拿来一盏完全不响的灯。","a":"标好副本，删除旧判定并重校","b":"先接入手动补值，逐灯检查"},{"title":"毕业礼没有高台","text":"毕业那天，师生想把各自所学带到街巷试用，也有人请你留校继续办集中实习。前者各有新难题，后者能熟悉同一套设备。院里只摆了普通桌椅，第一批学徒正在收工具袋。","a":"把实作记录交给学生，陪他们出门","b":"留下整理实验室，安排下一期实习"},{"title":"家门不认识你","text":"灰雪扰乱认亲咒，屋内家人隔窗看你，像看旅客。邻居愿讲你们的旧事，门背的祖先印也能恢复固定的熟悉感，却未必唤回真正经历。你手里还提着母亲喜欢的汤。","a":"请邻居陪着，慢慢讲起旧事","b":"检查祖先印，重新接好门咒"},{"title":"照不见的合影","text":"合影每天淡去一人，显影液正把存在感转入墙上的大幅风景。停机能保住底片，却无法交付已约好的照片；调转管线可尝试送回颜色，错接也许连风景都变白。摄影师端着最后一盆清水。","a":"帮摄影师停机，收好底片","b":"沿管线找回颜色的流向"},{"title":"一纸共同生活","text":"两位伴侣想搬到一起，旧家居咒却只记得其中一人的作息。手写生活约定可慢慢重教屋内法器，先借同一枚纹章也能入住，却会混淆各自习惯。桌上两杯茶冷热不同。","a":"陪两人整理习惯，重教家居咒","b":"借用共同纹章，先试住一晚"},{"title":"冬衣里的旧梦","text":"旧冬衣的里衬缝着温暖的梦，穿上也会看见原主的离别。拆梦归还要用去许多燃料，眼前又有人冷得发抖。布商愿换来普通棉衣，梦却会随旧衣离开熟悉的地方。","a":"寻找原主，逐件拆出梦线","b":"封好梦线，联系布商交换棉衣"},{"title":"没有咒语的约定","text":"伙伴想与你结成共痛咒，受伤时能分担，解咒却很麻烦。普通照护得请更多同伴帮忙，今晚你们还要走一段危险雪路。伙伴说自己不怕疼，缝忆师把解咒图也摊开。","a":"收起咒纸，联系同伴一起走","b":"与伙伴读完解咒图，再连接共痛咒"},{"title":"母亲留下的空白","text":"旧记忆匣有一段空白，母亲的声音在边缘说先问问她。缝忆师判断那是替朋友封存的故事，恢复可能找到药泉失灵的旧线索。匣盖正在开裂，你还没有找到那位朋友。","a":"先找知情人，暂时加固匣盖","b":"记录封口，打开空白片段"},{"title":"失物招领所","text":"记忆招领室的访客名单损坏，老人想取回自己的故事匣，却说不清登记姓名。邻里记得相处经历，守门阵只认旧家庭片段。临时补写一段可开门，却可能混入他真实童年。","a":"请街坊共同核对，重建手工登记","b":"为守门阵制作临时家庭片段"},{"title":"悲伤如何收好","text":"缝忆铺能暂时封存痛苦，有人盼睡个好觉，有人想完整记住故人。私人小匣需长期保养，把所有片段存入你的识海可以省下匣子，却会让陌生悲伤进入你的梦。众人围着炉火沉默。","a":"逐人询问，准备各自的小匣","b":"请愿意的人留下片段，接入识海"},{"title":"名字的余温","text":"保护咒将尽，需要一个鲜明名字续火，伙伴愿意借出自己的名，却可能暂时不被认出。分散去几处小屋也能避雪，只是伤者与孩子不便移动。你的姓名还清楚写在手套里。","a":"联系几处小屋，安排分批转移","b":"把自己的名字写入保护咒"},{"title":"她愿意讲到这里","text":"来访者愿说明药泉事故，却不愿重演那段疼痛。书面记录不够清晰，回忆环已经戴好，你手边就是启动键。她握着你的手，说其余部分明天再谈。","a":"取下回忆环，改查书面记录","b":"先询问能否保存到此处的片段"},{"title":"全城同一个梦","text":"记忆中枢误把同一段暖梦送到各家，睡梦中的人听不见雪声。逐户呼唤能慢慢唤醒，重启中枢则能同时切断，却可能冲掉尚未保存的个人梦境。软椅上亮着重启按钮。","a":"组织同伴逐户呼唤","b":"保存目录，重启记忆中枢"},{"title":"记得你的方式","text":"私人记忆可以各自放入小匣，也能集中在白塔晶库。小匣有缺页也较易损坏，晶库能存得更久，却需要你持续照管。家人已经不再依靠认亲咒，此刻正与你一同挑选盒子。","a":"整理小匣，把片段交还各人","b":"接好晶库，安排长期保养"},{"title":"迟到的练习册","text":"你找到多年前的练习册，记着自己与另一位孩子共用的暖纹。恢复原式能让你施法，却可能搅乱对方今天的回路。档案员愿一起找最初接法，复测材料只在今晚有效。","a":"陪档案员追查最初接法","b":"联系对方后，试着恢复原暖纹"},{"title":"会移动的线","text":"检查阵的光线乱跑，同一件法器换个位置就得出不同结果。技术员怀疑地面结霜，重测需逐一挪动设备；拆阵眼可立即停下误判，却可能释放残留的缠绕咒。行人正绕着亮线走。","a":"清出区域，与大家重测设备","b":"围好软垫，拆下阵眼"},{"title":"通行纸的背面","text":"临时渡雪纸背面附着旧寻路咒，会不停把人带回起点。车夫可慢慢绕行，另有空白长途纸能重写坐标，却需复查同行者的全部路线。雪路上的车铃已经靠近。","a":"陪车夫分批走绕行路线","b":"取来空白纸，重新绘制坐标"},{"title":"封条下的粮仓","text":"粮仓门上的防潮符冻结，仓内也有潮气。慢慢解符能保住货签，却要等很久；墙角可开口搬粮，但破开后温湿度会变化。仓管人握着钥匙，肚子也咕咕响了一声。","a":"与众人轮流解符，先分随身食物","b":"在墙角开口，分批搬出粮袋"},{"title":"迟疑的巡灯人","text":"巡灯人带来未完成的换灯表，承认前几次把相似屋号记错了。他想先修完再说明，住户却一直在等故障来由。今晚还要靠他熟悉的小路送灯，你们站在分岔口。","a":"陪他向住户说明，再核对换灯表","b":"先随他送灯，逐处记录旧接线"},{"title":"印章里的细纹","text":"工坊验收印裂开，里面竟封着器灵留下的指纹，落印会唤起它们的残响。普通签名可暂替，却要重新核对旧物件；继续用印更快，残响也会越来越混乱。档案员取来软布。","a":"包好旧印，改用签名核对","b":"记录裂纹，再验完眼前这批器件"},{"title":"名单之外的哭声","text":"渡船清单只写着药箱，舱底却有孩子哭声，原来一家人上错船。船即将进冰区，岸边可以先拦索停航，快艇也能追上，却要在晃动中转移。药箱里有怕冻的药剂。","a":"通知船夫收索停航，先安置药箱","b":"驾快艇靠近，递出接应绳"},{"title":"临时炉的期限","text":"临时炉接得快，却没有稳定的降温回路。定时停炉检查能减少积热，屋里会冷一阵；连续运行再统一检修，则要一直有人守着。住户围着热炉睡着，工匠手里拿着计时沙漏。","a":"设好沙漏，约定轮流停炉检查","b":"留下值守，持续观察炉温"},{"title":"开门的节奏","text":"旧保管室门锁卡住，里面的访客都想尽快出来，却还有怕震动的晶匣。逐扇解锁很慢，切断整屋魔力可同时开门，也会让温养晶失去热。你能听见里头不同的敲门节奏。","a":"逐个回应，分扇解锁","b":"准备好暖毯，切断保管室魔力"},{"title":"谁听见了什么","text":"回声镜只收得进响亮的话，低声的讲述总被漏掉。档案员可以慢慢手记，也能提高镜子增幅，却会把背景声一起收进来。老人带着口述稿，器灵则用很轻的钟声回应。","a":"坐近一些，分别手记讲述","b":"调高增幅，逐段试录回声"},{"title":"总接线图的末页","text":"白塔总接线图漏了几处回路，逐户拆接能查清，却有人已冷得受不了。你的汇流环可以先承接整段热，之后仍须分开修。笔尖停在尚未填完的末页，窗外炉烟越来越淡。","a":"优先修病房，再逐户拆接","b":"戴上汇流环，暂接整段热路"},{"title":"手册的空白页","text":"新手册必须为未见过的故障留位置，大家可持续补记与复查，也可由你先汇成一本定稿。补记版本多，定稿清楚却难涵盖每件旧法器。学徒举起一盏从未见过的小灯，问该记在哪页。","a":"留下空页，与大家约好复查","b":"收齐记录，先编出完整定稿"}],"endings":[{"title":"灯火需要商量","text":"你们把病房、炉房与雪路的照护接在一起，灰雪最浓的冬天总算过去。新小炉只够点亮半条街，哪处先添火仍会争到很晚。你坐在桌边，和大家一样记下下周清炉的班次。有人仍受旧伤困扰，也有人没等到春天，修好设备并不能补回这些空处。开春时孩子提着一盏小灯走过街口，身后还有同伴慢慢跟着，谁也没有急着催。","hint":"支持项（每项一分）：第1节点「救助眼前的弱者，建立互助基础」、第4节点「加入炉边照护队，承诺共享资源」、第5节点「将储备交给互助网络」、第6节点「照护同行者，践行早前约定」、第8节点「协调炉边照护队与白塔修习组，建立撤离通道」；第一、二幕各至少一项；公共结算：每方向至少命中两项不同早期行动，且第一、二幕各有支持；优先兑现第三幕声明的已建立方向，否则按命中数降序；同分按共同生还、长期主理、带伤远行、查明往事、以身承接、余生守望顺序。无方向建立才兜底余生守望。身份、关系、秘密满足原条件时优先，不满足则按此公共比较结算。"},{"title":"长明炉的看守人","text":"你接下主炉与总接线图，病房终于恢复温度，矿井也能按时停机。每项难修的故障都来到你桌上，熟悉的灯光渐渐挤掉了睡眠。一次住户想换小炉，你下意识劝他再等，后来才想起自己也曾盼着换一种办法。你开始给徒弟讲总图，仍把最难的一段留在手中。炉火照亮许多冬夜，学会让别人接班却需要更长的时间。","hint":"支持项（每项一分）：第1节点「整理工坊物资，与白塔修习组协作」、第4节点「加入白塔修习组，共同照看法器」、第5节点「建立白塔修习组应急储备」、第6节点「先处理工坊事务，与白塔修习组协作」、第8节点「整理检修记录，协助白塔修习组的工作」；第一、二幕各至少一项；公共结算：每方向至少命中两项不同早期行动，且第一、二幕各有支持；优先兑现第三幕声明的已建立方向，否则按命中数降序；同分按共同生还、长期主理、带伤远行、查明往事、以身承接、余生守望顺序。无方向建立才兜底余生守望。身份、关系、秘密满足原条件时优先，不满足则按此公共比较结算。"},{"title":"离城者的地图","text":"你带愿意同行的人越过雪原，在旧图未标的河湾搭起棚屋。药与木料来得慢，第一个雨季仍有人因伤病没能留下。你画出水源、避风处与可求助的屋子，也接受新地方并不总比旧居轻松。多年后孩子问故乡是什么样，你说那里有难熬的冬天，也有给你留过灯的人。地图末页一直空着，可以画下一处住处，也可以画回去的路。","hint":"支持项（每项一分）：第3节点「依靠普通技能，不调用天赋」、第4节点「加入炉边照护队，承诺共享资源」、第6节点「离开同行者，保全自己」、第7节点「停止研习，照顾自己的身体」、第8节点「协调炉边照护队与白塔修习组，建立撤离通道」；第一、二幕各至少一项；公共结算：每方向至少命中两项不同早期行动，且第一、二幕各有支持；优先兑现第三幕声明的已建立方向，否则按命中数降序；同分按共同生还、长期主理、带伤远行、查明往事、以身承接、余生守望顺序。无方向建立才兜底余生守望。身份、关系、秘密满足原条件时优先，不满足则按此公共比较结算。"},{"title":"灰雪留下的记录","text":"你把铜尺、药泉与记忆术的故障逐项比对，终于查明灰雪怎样绕过旧术式的测量。来访者的经历并不相同，记录里既有获救，也有迟到与失误。晶纹记事馆开门后，亲友可以核对原件，补写姓名，或带走不想留给别人看的信。新教材仍在编，药泉也未完全恢复。你把旧铜尺放在检修桌上，让学生亲自试一次它到底测到了什么。","hint":"支持项（每项一分）：第1节点「保留异常证据，开始调查」、第4节点「加入晶纹记事馆，承诺保全证据」、第5节点「公布第一份证据」、第8节点「展示调查记录，与同伴共同核对」；第一、二幕各至少一项；公共结算：每方向至少命中两项不同早期行动，且第一、二幕各有支持；优先兑现第三幕声明的已建立方向，否则按命中数降序；同分按共同生还、长期主理、带伤远行、查明往事、以身承接、余生守望顺序。无方向建立才兜底余生守望。身份、关系、秘密满足原条件时优先，不满足则按此公共比较结算。"},{"title":"熄灯以后","text":"你用自身魔纹承接热流，最后一线光照着撤出的病床，自己却再难施出简单的咒。屏障没能护住所有屋子，春天仍有人回来寻找旧物。你在工坊做普通的修理，累时要请旁人扶住工具。新炉渐渐用上风车与炭火，速度慢，也偶尔熄灭。钟楼只挂着求援铃，响起时你仍会抬头，却不必再靠耗尽自己来证明愿意回应。","hint":"支持项（每项一分）：第3节点「以当前身份研习天赋，接受其负担」、第6节点「照护同行者，践行早前约定」、第7节点「继续研习天赋并承担负担」、第7节点「过度调用天赋，换取紧急资源」；第一、二幕各至少一项；公共结算：每方向至少命中两项不同早期行动，且第一、二幕各有支持；优先兑现第三幕声明的已建立方向，否则按命中数降序；同分按共同生还、长期主理、带伤远行、查明往事、以身承接、余生守望顺序。无方向建立才兜底余生守望。身份、关系、秘密满足原条件时优先，不满足则按此公共比较结算。"},{"title":"尚未融尽的灰雪","text":"冬天过去，你还住在白塔城。屋檐背阴处留着灰雪，有些窗重新亮了，有些房间一直空着。人们对这一季记得不同，你也很难把全部经过讲成一个完整故事。记事馆门边常有人坐着等消息，等久了便带来自己的凳子。你靠普通工作交租，路过时会听见争论，也会听见新线索。春天没有把所有难题融掉，明早仍有炉子等着修。","hint":"支持项（每项一分）：第3节点「依靠普通技能，不调用天赋」、第4节点「加入炉边照护队，承诺共享资源」、第5节点「将储备交给互助网络」、第7节点「停止研习，照顾自己的身体」、第8节点「协调炉边照护队与白塔修习组，建立撤离通道」；第一、二幕各至少一项，或所有公共方向均未建立时兜底；公共结算：每方向至少命中两项不同早期行动，且第一、二幕各有支持；优先兑现第三幕声明的已建立方向，否则按命中数降序；同分按共同生还、长期主理、带伤远行、查明往事、以身承接、余生守望顺序。无方向建立才兜底余生守望。身份、关系、秘密满足原条件时优先，不满足则按此公共比较结算。"},{"title":"学徒的街角课堂","text":"你反复试做术式，把复杂的暖炉法改到初学者也能操作。修习组愿提供材料，你在街角雨棚下开了第一堂课。灰雪里的失败也写进教材，有些问题连你都要请工匠解释。后来一位学生做出不用长时施法的小灯，样子笨重，亮得也不远。她问做得够不够好，你请她交给同伴拆装一次。雨水从棚边流下，大家挪挪椅子，为最后到的孩子留出干地。","hint":"以「暂别课堂的白塔学徒」开局；第一幕研习身份技艺；第二幕继续研习；第三幕整合技艺；身份技艺达到 3；所属阵营支持至少 4，技艺有实际服务对象；天赋负担不超过 6；终幕选择「以身份技艺服务所属阵营」。"},{"title":"夜班没有奇迹","text":"你练熟药泉护理，也明白何时该停下借力术。诊所一度排得更长，有些病人选去别处，有些留下等缓慢的疗程。你把每种办法能做什么说清，也接受病人另作选择。多年夜班使手微微发抖，缝合时要年轻同事扶灯。仍有人没熬过清晨，你陪亲友坐到天亮。床边那把椅子一直保留着，它不能代替治疗，却让想说话的人不必站在门外。","hint":"以「药泉病房的夜班医师」开局；第一幕研习身份技艺；第二幕继续研习；第三幕整合技艺；身份技艺达到 3；所属阵营支持至少 4，技艺有实际服务对象；天赋负担不超过 6；终幕选择「以身份技艺服务所属阵营」。"},{"title":"返程车夫","text":"你把雪路驾车与银管修理练成熟悉的手艺，不再靠透支赶每一趟车。照护队帮你重装朝窗的座椅，第一班乘客却仍惦记上次在雪中等待的夜晚。你把新路线逐段走过，写清何时停靠，也承认天气变坏就得折返。后来老人坐过终点，说还想看河边日落，你陪他多等一会儿。车身只写着路线与返程时间，每个上车的人都可以先问一声。","hint":"以「往返雪路的送药车夫」开局；第一幕研习身份技艺；第二幕继续研习；第三幕整合技艺；身份技艺达到 3；所属阵营支持至少 4，技艺有实际服务对象；天赋负担不超过 6；终幕选择「以身份技艺服务所属阵营」。"},{"title":"花园里的慢工","text":"你把旧花园的契合术练熟，终于知道哪些植物不能再借同一条热根。重新分盆费时，许多名贵花仍没能活过春天。你卖去闲置的园具，补买普通种苗，与街坊一起修水渠。过去习惯一挥手便开花，如今做错了就得重新翻土。秋天有人替晚归的你留一碗汤，你放下沾泥的铲子，第一次没有急着查看花是否又长高。花园还在慢慢恢复，你也是。","hint":"以「照料旧花园的术式园丁」开局；第一幕研习身份技艺；第二幕继续研习；第三幕整合技艺；身份技艺达到 3；所属阵营支持至少 4，技艺有实际服务对象；天赋负担不超过 6；终幕选择「以身份技艺服务所属阵营」。"},{"title":"允许破损的记忆","text":"你的缝忆铺不再承诺恢复如初，学会在伤到来客之前停手。收入少了，来人却开始带自己的问题。一位老人每月只请你保养旧梦匣，从不打开，你也照做了很多年。后来他留下信，允许接到匣子的人不看。你没有替信添解释，只把边角缝牢。晚上关门时，你也检查自己的备忘纸，慢慢接受有些忘掉的名字需要寻找，有些空白可以先留着。","hint":"以「替人修补记忆的缝忆师」开局；第一幕研习身份技艺；第二幕继续研习；第三幕整合技艺；身份技艺达到 3；所属阵营支持至少 4，技艺有实际服务对象；天赋负担不超过 6；终幕选择「以身份技艺服务所属阵营」。"},{"title":"巡灯人的自述","text":"你把逐户核验练成可复查的工序，也补写了从前认错屋号的记录。曾被耽误的住户有的愿继续请你，有的另找了人，你不催他们解释。后来你在街角修灯，每次先问清它放在哪里、照着谁。旧日急着下判断的习惯偶尔还会冒出，同伴提醒时你便停下重听。一个冬日下午，你把修好的灯递回，来客试亮后独自出门，你留下那张还可补记的维修纸。","hint":"以「逐户检修法器的巡灯人」开局；第一幕研习身份技艺；第二幕继续研习；第三幕整合技艺；身份技艺达到 3；所属阵营支持至少 4，技艺有实际服务对象；天赋负担不超过 6；终幕选择「以身份技艺服务所属阵营」。"},{"title":"停机柄旁的椅子","text":"井下手艺练熟后，你先看身体与岩壁的承受限度，再安排开采。工友一起维护矿井，停机柄旁留了一把谁累了都能坐的椅子。少采的原晶换不来厚冬衣，有人离开找别的活，你们把工具收好，也约着日后见面。春天新工来时先练逃生，再学辨晶。年轻人问停了矿井怎么办，你指向地面，那里还有同伴可以一起想办法。","hint":"以「熟悉旧矿道的掘晶工」开局；第一幕研习身份技艺；第二幕继续研习；第三幕整合技艺；身份技艺达到 3；所属阵营支持至少 4，技艺有实际服务对象；天赋负担不超过 6；终幕选择「以身份技艺服务所属阵营」。"},{"title":"账本终于合拢","text":"你把魔力耗损的算法拆到旁人也能核算，工坊愿保留原件，不再让你靠熬夜赶出数字。灰雪里几次异常终于找到来处，有些却只能标为待查。你替一位旧同伴补回被写成零件号的姓名，他的家人把纸折好，说还想知道最后那夜，你便另取一页继续听。第一本新账合拢时仍有缺口，你没有挪动数字，只将它带到修理桌前，和大家讨论下一次要先查哪里。","hint":"以「记录魔力消耗的工坊账房」开局；第一幕研习身份技艺；第二幕继续研习；第三幕整合技艺；身份技艺达到 3；所属阵营支持至少 4，技艺有实际服务对象；天赋负担不超过 6；终幕选择「以身份技艺服务所属阵营」。"},{"title":"门没有上锁","text":"你继续照护伊芙，最后决定把生活安在同一屋檐下。她搬来两只杯子，也带来尚未修好的治疗笔记，你们没有再用共痛咒保证相伴。后来她去远郊诊室，你帮忙收行李，冬天的信有想念，也有几周答不出的争吵。春天回来时她先敲门，你问这次想住多久。桌上杯子仍成对，明天会怎样没有咒语能保证，两人却都愿再好好谈一谈。","hint":"第一幕与伊芙相识；第一幕结识的人，在第二幕获你保护，第三幕仍守约（信任至少 5）；终幕选择「将共同生活置于使命之前」。"},{"title":"老师坐在后排","text":"你护住导师，也守住照护的约定，愿意重新共同做事。她承认旧速成法的疏漏，把改过多次的笔记带到课堂，坐在后排听。学生问旧教材为什么那样写，她起身说明当初忽略了什么，没有把责任推给天气。下课后她问你是否还愿叫老师，你说有些时候愿意，有些时候还难。她认真记下。后来两人继续校书，称呼没有替代核对，也没有阻止慢慢熟悉。","hint":"第一幕与白塔导师相识；第一幕结识的人，在第二幕获你保护，第三幕仍守约（信任至少 5）；终幕选择「将共同生活置于使命之前」。"},{"title":"两盏不同的灯","text":"你与诺弥曾为检定方法争得厉害，照护和共同修理才让你们重新坐下。他把旧铜尺做成一盏手摇灯送你，光很弱，握久了手也累。后来他去雪原教维修，你留在城里，信里常夹着画错再改的图。多年后重逢，你已不熟悉他的新习惯，他也有许多你没听过的故事。夜里停电，两人各自点灯，桌上两圈光慢慢重叠，足够把这顿晚饭吃完。","hint":"第一幕与诺弥相识；第一幕结识的人，在第二幕获你保护，第三幕仍守约（信任至少 5）；终幕选择「将共同生活置于使命之前」。"},{"title":"重新介绍的家人","text":"你照护母亲，也接受认亲咒修好后记忆仍不完整。她知道你爱喝哪种汤，却想不起第一次盛汤时你的年纪。你们在厨房贴纸条，写今天想让对方知道的事，偶尔说错旧事，也会争吵。后来邻居带孩子来吃饭，母亲先添碗，没有急着问该怎样称呼。搬家时你发现祖先印一直放在角落，已经生锈。新的厨房有足够大的桌子，明早还可以重新说一声早安。","hint":"第一幕与母亲相识；第一幕结识的人，在第二幕获你保护，第三幕仍守约（信任至少 5）；终幕选择「将共同生活置于使命之前」。"},{"title":"雪路上的来信","text":"你护住雪原向导，之后也持续照看她的旧伤。她仍喜欢独自探路，不会把每段行程都交给你，你也慢慢学会先问何时方便见面。雪原合作有过物资遗失与路线误判，两人一起查记录，也曾沉默到天亮。后来她回山谷，你留在预警站，信里只写积雪、坏桥与今年药材。下一轮灰雪来时，两处钟声先后响起，你知道远方还有人记得约好的节律。","hint":"第一幕与雪原向导相识；第一幕结识的人，在第二幕获你保护，第三幕仍守约（信任至少 5）；终幕选择「将共同生活置于使命之前」。"},{"title":"第一次停下","text":"两种修炉经历让你重新对照旧教材、铜尺与总接线图，找到最早的一页试验笔记。写笔记的人不是忽然失去魔力，而是第一次在疲惫时停下，记录了停机后逐渐好转的症状。后来抄本漏掉这一页，许多术式便一直运行到耗尽。你与同伴重现实验，也保留无法复现的部分。展柜里只放一张普通纸，边上写着孩子退烧的日子。漫长寒冬里，休息也是被遗忘过的一项本领。","hint":"前局发现「public.rescue」；前局发现「public.rule」；第一幕调查冲突根源；第二幕促成阵营协商；收集至少两份证据；终幕选择「用旧日发现调解阵营」。"},{"title":"钟声越过雪原","text":"重拾学徒技艺与照护伊芙的经验，让你听懂钟腹旧谱中的轻微停顿。屏障外的灰雾有些来自离散的植物梦与行旅回声，和原晶里的节律相似。你请守钟人与亲友共同辨认，试验失败过，也有接力者受伤。后来第一团灰雾随熟悉的曲子散成温雨，远处仍有真正的风暴。你把新做法写在钟旁：先听清，再鸣响。雪原依旧危险，却多了一种可以尝试的回应。","hint":"前局发现「identity.1」；前局发现「relationship.1」；第一幕重拾技艺；第二幕继续研习；第一幕结识的人，在第二幕获你保护，第三幕仍守约（信任至少 5）；终幕选择「承接前世身份与未竟承诺」。"},{"title":"没有写满的那一页","text":"过去的耗损与照护导师的记忆，让你停下透支，去找不用强行施术的方法。拾荒铁偶没有固定的初始纹样，接入旧阵时会让法器等待下一次确认。你与工匠据此修出真正可停的接口，逐户改装，速度慢得令人焦急。有人未等到新炉，你把名字另册保存。轮到自己的接口时，你亲手留下一处空栏，旁边写着需要时再接。纸没有发光，手却终于能从台上放下来。","hint":"前局发现「public.sacrifice」；前局发现「relationship.2」；第一幕结识的人，在第二幕获你保护，第三幕仍守约（信任至少 5）；第二幕停止透支；第三幕接受能力限制；终幕选择「以旧日关系记忆解除天赋束缚」。"},{"title":"归还尚未到来的春天","text":"停机笔记、钟中回声与空白接口的发现合在一起，你和晶纹档案员查明白塔为何反复回到灰雪初落的那天。原晶中未散的梦被恢复阵一再重放，带着旧接线将所有人拉回。你照护档案员，陪他逐份核对愿意留下或散去的回声，再关闭自动恢复。城市只剩有限储能，许多工程得延后。第一间新病房门前种下一株微光树，你们记下真实日期。下一次春天需要亲手照料，却终于不会被写回旧页。","hint":"前局发现「secret.reconcile」；前局发现「secret.inherit」；前局发现「secret.liberate」；第一幕结识记录者；第一幕结识的人，在第二幕获你保护，第三幕仍守约（信任至少 5）；第一幕调查轮回；第二幕展示轮回线索；终幕选择「请记录者见证并终止轮回」。"}],"turns":{"calling":{"title":"未冷的炉钳","text":"老技师请你接学白塔城的炉纹修补，炉钳与刻纹架都能改成适合你使用的样子。他把冬季值守表摊开：每逢灰雪，都得留在炉旁。药泉送药队也愿收你学辨药箱、排雪路，明天就要试走第一程。","options":[{"label":"接下炉钳，跟随技师学修炉纹","aftermath":"五年后，你在旧炉室有了专属刻纹架，带出的学徒已能看懂你留下的修补标记。连续五个冬天，你都在炉边度过初雪那夜；老技师搬走时，把唯一一套完整的炉纹拓片留给了你。"},{"label":"谢绝炉纹传承，改学雪路送药","aftermath":"五年后，你负责一条固定的药泉配送线，药箱里每个隔层都按沿路病房重新排过。炉纹拓片由另一位学徒保管；你常错过城里的晚饭邀约，却在雪路沿途拥有七处可以借宿的门牌。"}]},"bond":{"title":"窗台的旧练习册","text":"伊芙的记忆术练习出了岔子，近来连写过的字也会认错。医师建议她停课疗养，每日由熟悉的人陪着辨认环境，恐怕要持续数年。她邀你同住药泉旁，也已问好有人照看的宿舍；你的外地工坊录用信放在她那本旧练习册旁。","options":[{"label":"留下照护伊芙，陪她重认日常","aftermath":"四年后，你们住处的柜门贴着伊芙重新写成的字条，每晚由你陪她核对次日所需。你放弃了那次外地录用，靠附近的短工安排生活；她最先能独自读完的，是你们共同写了四年的采买簿。"},{"label":"陪她办妥宿舍入住，再各自启程","aftermath":"四年后，伊芙的辨字练习由药泉宿舍接续，你保存的旧练习册没有再添新页。你已在外地工坊独立接活，住在工坊后院；她寄来能读懂的第一封长信时，信封上用的是你新居的地址。"}]},"home":{"title":"两扇门的尺寸","text":"白塔城的旧花园腾出一间温室侧屋，园丁愿按你的需要改门，但请你住下后常年照看防雪棚。雪原向导另带来南坡住屋的图纸，那里离药泉远，却有能安放行李的空院。两份尺寸图一起摊在结霜的窗前。","options":[{"label":"改好侧屋，留下照看花园","aftermath":"六年后，你住处的门与防雪棚连成了一道廊，每次落雪都要亲自检查棚角。你没能离城过一个完整冬季；窗边那株由你养大的药藤已经遮住旧门牌，邻里仍凭廊下的灯找到你。"},{"label":"带上私人物件，随向导迁往南坡","aftermath":"六年后，你在南坡空院旁建了独立储物棚，门口挂着自己磨出的避风铃。白塔温室侧屋住进了新的园丁；每次回城看朋友都得留出两天路程，你已把常用药材种进自家院子。"}]}},"episode":{"title":"退赛通知上的首发名字","source":"web-original","opening":{"title":"替补没有座位","text":"白塔的练习场挤满了人。今晚的竞速机甲靠法术驱动，你在替补席上等了整整一季。机甲竞速决赛前，领队撕下你的选手贴，宣布替补名额取消。你熬夜调好的赛车被推给赞助商的儿子，他还把你的工具箱踢进通道。检录台忽然报警：赛车的神经接口拒绝连接。对方抓起麦克风，说你动了手脚。全场镜头转来，你看见维修屏上的驾驶员签名，依旧是自己的名字。","a":"将接口校准记录投上大屏","b":"提起工具箱走到赛车旁","attributes":["声望","实力"]},"followups":[{"title":"被划掉的圈速","text":"大屏显示，所有破纪录的测试圈都是你跑的，领队提交时却换了姓名。裁判暂停检录，恢复你的参赛资格。那位少爷摘下头盔，说自己也没见过原始记录，随即退出驾驶席。你刚坐下，熟悉的右转弯数据突然变红：有人昨夜换了转向组件。维修员递来旧件，开赛倒计时已经响起。","a":"换回工具箱里的旧组件","b":"在维修区重新校准转向","attributes":["资源","理智"]},{"title":"它只认这双手","text":"你插入随身校准钥匙，赛车立刻亮起，屏幕显示故障来自领队强装的转接器。裁判检查后撤销退赛通知，领队却扣着比赛用电池，逼你签下全部奖金归队的协议。维修员从训练车卸下一块旧电池推给你；刚才抢走座位的少爷也走来，把赞助展车的电池放到地上，低声说了句对不起。","a":"接上训练车的旧电池","b":"抱起展车电池交给裁判","attributes":["实力","声望"]}],"codas":["旧组件磨损严重，却保住了你最熟悉的弯线。你在终点前半圈完成超车，捧杯时只举起维修员的名字。被撤职的领队站在围栏外，没人递给他话筒。","校准花掉了发车时间，你从维修通道最后出发，最终追到第三。冠军车队当晚递来试训邀请。你把铜牌放进工具箱，第一次以正式车手签下姓名。","旧电池撑不到终点，你提前滑入维修区，亲手保住了赛车。公开的故障记录让领队失去执教资格。下赛季，你带着维修员组队，车身不再印他的姓。","裁判检测确认电池合规，你与少爷共同登记借用单。冲线后，你分给他一段致谢，他却主动说明自己抢位的事。一个月后，他来车队从搬工具学起。"]}},{"id":"w5","name":"四季旅店","premise":"你来到溪边的四季旅店，跟着一本散页手记学习烹饪、木作与待客。会说话的燕灵和花猫也在店里帮忙，一年四季的风物正等着被写进新的篇章。","factions":{"commons":"溪畔厨房","council":"四季旅店","archive":"手艺书屋"},"fate":{"characters":["结伴投宿的旅人","修书的老先生","爱试新菜的厨师","送食材的表亲","学习木作的青年","整理手记的花猫"]},"origins":["爱记菜谱的旅店学徒","照看老面缸的面点师","背着工具箱的木匠","研究香草茶的调饮师","收藏旧花样的绣娘","沿溪送货的小船主","修补锅壶的铜匠","走村演出的说书人","替旅店衔来花种的燕灵","睡在书架上的通灵花猫"],"events":[{"title":"雨中招牌","text":"溪边小店的木牌被春雨洗得发白。你循着烤栗子的香气走进门，发现柜台上有本散开的手记，封底画着这座旅店。掌柜正搬动接漏水的陶盆，请你先找个地方放行李。","a":"把行李放到楼上","b":"挽起袖口搬陶盆"},{"title":"散页初读","text":"修书的老先生铺开手记，纸页上既有菜谱，也有窗框的尺寸。一张夹着桂叶的纸缺了角，花猫说它曾在阁楼见过相似的纸屑。窗外的雨声渐渐小了。","a":"陪花猫查看阁楼","b":"坐下整理纸页"},{"title":"早饭的蒸汽","text":"厨房蒸笼刚揭开，面点师发现花卷的底部有些湿。她昨夜换了新笼布，还没摸准火候。第一批住客已在院中洗漱，你的手边放着干净竹垫与一盆面团。","a":"更换蒸笼竹垫","b":"揉制下一盆面团"},{"title":"旧匙与新锁","text":"客房门锁转动时总有一声轻响。木作青年拆下锁盒，里面落出卷成筒的花样纸，像是从前修门时留下的垫片。他把小零件排在布上，请你陪他查找声响的位置。","a":"逐个擦拭锁片","b":"展开花样纸"},{"title":"溪上送货","text":"送食材的表亲划船来了，篷布下装着春笋和细瓷杯。岸边的青苔湿滑，他把船停在木桩旁，喊你拿条绳。燕灵站在篷顶，好奇地啄着一截露出的笋尖。","a":"牵绳固定小船","b":"铺好岸边草垫"},{"title":"桌脚里的墨痕","text":"擦桌时，你看见桌脚内侧留着铅笔尺寸，与手记上的桌案图很像。木匠说这张桌子曾在窗边摆过，如今的位置略有不平。老先生蹲下来，想看清最后一笔。","a":"描下桌脚墨痕","b":"垫平晃动的桌脚"},{"title":"空着的针篮","text":"绣娘带来的针篮只有线轴，针包落在上一站的客栈。她想在晚饭前缝好新窗帘，掌柜却记得柜中还藏着旧帘。你推开柜门，里面飘出淡淡樟木香。","a":"翻找备用针包","b":"取出旧窗帘"},{"title":"借来的刨子","text":"隔壁木坊送来一把长刨子，刨底比青年惯用的宽。他想试做窗边书架，又担心自己压不稳板材。木匠将练手的短木摆上台，窗外恰好透进一束阳光。","a":"扶住练习木料","b":"检查刨底平整度"},{"title":"初次试菜","text":"爱试新菜的厨师端出笋汤，请住客说说尝到了什么。有人觉得像雨后的竹林，有人只注意到胡椒。你面前有空白纸签，也有一碟尚未入汤的嫩笋。","a":"记下尝汤感受","b":"尝一片清煮嫩笋"},{"title":"屋檐滴答","text":"雨水沿着屋檐滴到晾布架上，窗帘刚晒出的干边又湿了。梯子已经摆稳，木匠正在檐下寻找缺瓦。你从院角捧来备用瓦片，花猫则绕着水盆转圈。","a":"递上备用瓦片","b":"把晾布架搬进廊下"},{"title":"没有写完的菜名","text":"手记里的一道春菜只写了做法，没有菜名。厨师照着做出一盘花瓣似的萝卜，老先生想起年轻时见过相近的摆盘。大家围着小桌，等你也说说看法。","a":"请老先生描述旧菜","b":"描画盘中萝卜"},{"title":"春日开窗","text":"连日整理后，楼上的窗终于顺畅推开，溪风吹动新缝好的窗帘。掌柜把手记放上窗边书架，让你选一页作为今年的开篇。楼下传来住客叫茶的声音。","a":"写下旅店的春晨","b":"端茶去院中"},{"title":"竹篮新芽","text":"菜园角落的竹篮里冒出嫩芽，面点师想不起放进去的是哪包种子。燕灵认得袋上残留的花纹，却把它与另一种花混淆了。泥面上还有昨夜雨点留下的小坑。","a":"画下嫩芽的形状","b":"翻找原来的种子袋"},{"title":"水车慢转","text":"溪边的小水车停停转转，接水槽里浮着一片柳叶。园丁说菜苗今天刚移栽，正需要柔和的水流。你听见轮轴有些发涩，旁边搁着清槽的木耙。","a":"清理接水槽","b":"给轮轴涂油"},{"title":"种子纸包","text":"书屋收到几包蔬菜种子，字迹被水洇成了模糊的圆圈。园丁凭颜色认出大半，剩下两包大小相近。你把纸包摊在干布上，看见折痕里夹着极细的种皮。","a":"对照种子图册","b":"逐包描画种皮"},{"title":"叶面白点","text":"薄荷叶上多了白点，厨师以为是面粉落进花盆，园丁却说盆边也有小虫。你用放大镜看了半晌，发现新叶与老叶的痕迹并不一样。厨房的水壶正在鸣响。","a":"清洗一片叶子观察","b":"搬来另一盆薄荷比较"},{"title":"篱笆转角","text":"新篱笆刚扎好，花猫便从转角钻了进去，踩倒一根标记枝。园丁蹲在泥地旁笑，说它走惯了这条路。青年带着细木条过来，想给花园添一道小门。","a":"量取小门尺寸","b":"重新插好标记枝"},{"title":"会浮的石头","text":"水盆里一块浅灰石头浮在水面，燕灵认定它会游泳。园丁说这是松软多孔的园艺石，想拿来配盆土。你捏着石块，听见气泡从小孔里轻轻冒出来。","a":"把石头浸入清水","b":"筛选不同大小的石粒"},{"title":"池底的杯子","text":"清理睡莲池时，表亲用长柄网捞起一只茶杯。杯底印着旅店旧花纹，杯沿却缺了一块。厨师想起花猫常在池边追落花，花猫扭头看向岸上的空花盆。","a":"清洗捞起的茶杯","b":"沿池边寻找碎片"},{"title":"藤架的弧线","text":"豆藤长得比预想快，已经绕住晾衣绳。青年画了方形和弧形两种藤架，拿着竹条在院子里比画。午后的影子落在草地上，弧形架下恰好能放一张矮凳。","a":"弯制竹条拱架","b":"搭起方形藤架"},{"title":"花牌上的字","text":"住客总把香蜂草认成薄荷，园丁准备给花盆做名牌。绣娘提议画叶形，老先生则拿来一支防水墨笔。你闻着两盆叶子的气味，发现它们比外观更容易区分。","a":"描画叶片轮廓","b":"写下气味笔记"},{"title":"骤雨收盆","text":"午后忽然落下大雨，窗台上几盆刚扦插的花被打得歪斜。园丁已经腾出廊下的长凳，表亲撑着伞来接你。花盆边缘滑溜溜的，泥水顺着指缝往下淌。","a":"端花盆到廊下","b":"搭好窗台遮雨布"},{"title":"秋种清单","text":"夏日还没过完，园丁已开始翻看秋种记录。他想再种些小萝卜，厨师惦记着红梗菜，面点师则抱来一小包荞麦。桌面被各色种袋铺满，只剩茶杯周围一圈空地。","a":"整理各袋种子的播期","b":"陪园丁查看空菜畦"},{"title":"满篮的清晨","text":"第一批菜收下来了，萝卜有大有小，豆荚里还藏着晨露。你把竹篮放到厨房门口，发现厨师已摆好砧板。花猫趴在门槛，伸爪碰了碰滚出来的小圆萝卜。","a":"清洗篮中的蔬菜","b":"称量各样收成"},{"title":"酸面香","text":"老面缸揭盖时散出比往常更浓的酸香，面点师怀疑昨夜屋里太暖。手记中记着旧厨房的温度，却没写发面时长。她取来干净小碗，准备重新试一回。","a":"分装面团观察","b":"测量厨房温度"},{"title":"炊烟的方向","text":"灶上的烟总往窗边飘，厨师刚挂起的干菇沾了烟味。木匠查看烟道，发现新添的风帽转向不顺。你站在院子里，能看见风把树梢吹向溪水那边。","a":"转动烟道风帽","b":"换个地方挂干菇"},{"title":"盐罐的勺子","text":"新来的学徒把大小相似的调料勺放进了同一个罐子，汤尝起来比昨天浓。厨师递给你几只清水碗，请你帮忙把勺子认清。罐底仍留着旧木勺磨出的圆痕。","a":"给调料勺系上色线","b":"逐个核对勺子容量"},{"title":"食谱油渍","text":"一滴油遮住了烤饼配方的半个字，老先生把纸移到窗前，看见背面另有淡淡铅笔印。面点师已经备好材料，想试试两种可能的做法。你闻到炉里传来的柴火香。","a":"从背面描出铅笔印","b":"和面点师分盆和面"},{"title":"赶集的篮子","text":"表亲要带你去集市挑果子，篮子里垫着柔软的稻草。掌柜在纸上画了熟悉的摊位，厨师又添了一笔小圆杏。溪上晨雾未散，船头已沾满细小水珠。","a":"提篮跟表亲上船","b":"到厨房核对食材单"},{"title":"会响的陶瓮","text":"腌菜瓮隔一阵便发出轻响，像有人在里面吹泡泡。厨师说水封处要看看，花猫却坚信有只小鱼钻了进去。你低头发现瓮沿的水比昨晚浅了一圈。","a":"补足瓮沿清水","b":"检查陶瓮盖沿"},{"title":"不能吃的花","text":"绣娘带回一束漂亮野花，想给点心装盘，园丁却不认识其中的蓝色小花。厨师把花束插进瓶里，另取出常用的食用花干。桌旁留着一张尚未完成的植物画。","a":"查阅野花图册","b":"用花干装点点心"},{"title":"长柄铜锅","text":"铜匠修好的长柄锅第一次上灶，厨师发现握柄的位置与旧锅不同。你帮忙试握，锅里清水晃出细小波纹。灶台旁挂着隔热布套，针脚还带着新线的光泽。","a":"缝紧锅柄布套","b":"挪动灶边挂钩"},{"title":"不一样的乡味","text":"结伴投宿的旅人尝到豆汤后，想起家乡会放橘皮。厨师从没试过，让他描述橘皮晒到什么程度。你打开香料盒，里面有干橙片，也有去年留下的青橘皮。","a":"请旅人挑选橘皮","b":"在纸上记下家乡做法"},{"title":"熄火后的甜汤","text":"晚饭刚收尾，灶火便慢慢熄了，甜汤还没达到厨师喜欢的稠度。面点师摸摸炉壁，说里面仍有余温。院里的住客开始收起棋盘，厨房只剩汤勺轻碰锅沿的声音。","a":"把汤锅放进温炉","b":"重新添柴生火"},{"title":"口味便笺","text":"住客留言里有人喜欢甜些，有人喜欢淡些，厨师把纸签铺了一桌。明日的餐牌还空着一栏，你发现几张便笺提到了同一种梨。窗边篮子恰好摆着新送到的秋梨。","a":"整理便笺中的食材名","b":"切开秋梨试味"},{"title":"厨房新页","text":"你终于把这一季试过的菜写成完整一页，纸边留着面粉指印。厨师读到自己做糊的那锅酱时笑了，提议配上一幅锅底图。面点师搬来椅子，准备补写醒面的细节。","a":"画下锅底的纹路","b":"听面点师补述步骤"},{"title":"线团迷路","text":"绣娘回屋发现线团滚到了走廊尽头，花猫蹲在旁边假装梳毛。线头绕过椅腿，还勾住门后的一颗钉子。她抱着待补的靠垫，看着你忍不住笑出声来。","a":"沿着线头慢慢收线","b":"拔出门后的旧钉"},{"title":"花样相逢","text":"窗帘上的枝叶纹和旧手记里的绣样十分相似，绣娘把两张图并排放好。不同之处在于鸟尾的方向，燕灵歪着头看了半天。老先生说旧图可能是从背面拓下的。","a":"翻转薄纸核对花样","b":"观察燕灵的尾羽"},{"title":"棉絮结团","text":"晒好的棉被摸起来一块厚一块薄，掌柜说这床被子洗过后一直如此。绣娘拆开一小段缝线，让你看里面结成团的棉絮。窗外日光正好，竹拍靠在门边。","a":"把棉絮轻轻梳开","b":"取来竹拍"},{"title":"染缸里的晚霞","text":"一条布带从染缸提出时呈灰紫色，入水前却是浅红。染布师看了看院里的井水，又掀开另一只小桶。你将布带举向夕阳，湿布透出的颜色比桌上样布深得多。","a":"晾起布带观察干色","b":"记录两桶水的差别"},{"title":"旧衣新领","text":"旅人带来一件磨软的外衣，只想把领口补好。绣娘找出几块相近的布，颜色却没有完全一致的。旅人从口袋拿出一条旧围巾，说它和这件衣服走过很多地方。","a":"裁取围巾边角","b":"挑选素色补布"},{"title":"木梭停住","text":"小织机忽然卡住，梭子停在经线中间。青年伸手想帮忙，绣娘先请他扶住松动的框架。你低头看到一根经线被毛刺勾住，旁边的细砂纸已经卷成小筒。","a":"磨平框架毛刺","b":"挑开勾住的经线"},{"title":"花猫的软垫","text":"花猫把新软垫拖到书架底下，却总把头搁在硬木边上。掌柜猜它嫌垫子太厚，绣娘觉得它想看见门口。你蹲下来，才发现那个位置能照到一小块晚霞。","a":"挪动软垫的位置","b":"拆出少许填充棉"},{"title":"一件雨披","text":"表亲的雨披肩头总渗水，他想在下一次送货前修好。绣娘摸出针线，铜匠则拿来几个圆扣。旧雨披摊开后比桌面还大，缝线附近藏着几道细裂口。","a":"给肩头加缝补片","b":"检查雨披各处接缝"},{"title":"檐下绣课","text":"几个住客围在绣娘身旁学针法，有人总把线拉得太紧，有人把花瓣绣成了小鱼。燕灵忍不住落到样布边缘。绣娘没有急着收布，递给你一只空绣绷。","a":"绷好练习布","b":"画一条简单花枝"},{"title":"灯影偏斜","text":"入夜后，绣娘发现针的影子正好遮住落针位置。灯座挪到左边又碰着装纽扣的碟子，你托起灯罩，看见内壁积了薄灰。窗纸上映出几个人忙碌的轮廓。","a":"擦净灯罩内壁","b":"重新摆放针线用具"},{"title":"拼布地图","text":"旅人留下一小块蓝布，上面绣着来路上的湖。绣娘翻出其他客人赠的布角，想拼成一张可挂在走廊的旅行图。你发现两块布上都有相似的木桥，却写着不同季节。","a":"把木桥布片排在一起","b":"给蓝布缝上衬底"},{"title":"暖被收针","text":"新补好的棉被铺满客房，细碎布纹像一片安静花园。绣娘把最后一枚针收进针包，请你检查是否有线头。住客在楼下喊她吃饭，屋里只剩被面上缓缓移动的日光。","a":"检查被面的线头","b":"折好棉被放上床尾"},{"title":"木香早起","text":"木匠一早就打开工具箱，打算给旅店做一张可折叠的小桌。木料端面有个漂亮树结，他用手指描着纹路迟迟没下锯。青年把草图挂在墙上，等你一起看。","a":"顺着木纹画切线","b":"展开小桌草图"},{"title":"尺上的刻痕","text":"两把旧尺量出的长度略有差别，青年反复比了几遍，以为自己看错了。木匠把尺头并齐，发现其中一把边缘磨短了。窗边待做的抽屉还没有装底板。","a":"用标准尺重新量取","b":"在旧尺上补画起点"},{"title":"抽屉里的风","text":"新抽屉推到底时会自己弹出一点，花猫用爪子按下去，又看着它慢慢退回。木匠让你抽出底板，检查柜内的空隙。青年把灯举近，细小木屑从轨道边飘下来。","a":"清扫抽屉轨道","b":"查看柜体是否方正"},{"title":"榫头的松紧","text":"青年做出的榫头能插进去，却要费很大力气。木匠在废木上演示了一次，表面只薄薄削下一层。你握着未完工的桌腿，手心能感觉到新木的凉意。","a":"细磨榫头边缘","b":"测量榫眼深度"},{"title":"搬来的旧柜","text":"表亲从旧货铺带回一只窄柜，刚好适合楼梯转角。柜门上有画到一半的果枝，背板却松开了。掌柜说不必急着上漆，先看看里面有没有潮气。","a":"卸下背板晾干","b":"用软刷清扫柜门"},{"title":"杯架的高度","text":"厨师试用新杯架时，发现最高一层够起来有些吃力。青年按自己的手臂长度画的图，现在拿着尺子有点不好意思。你看见下层还空着，可以重新安排横档。","a":"请厨师试量位置","b":"拆下上层横档"},{"title":"铜壶与木柄","text":"铜匠想给茶壶添个木柄，带来的木片却不适合紧贴热壶。木匠找出一块纹理细密的老木，先削出小样。茶壶放在桌上，壶嘴冒出的热气轻轻拂过你的手背。","a":"试握木柄小样","b":"描出隔热间距"},{"title":"窗边留座","text":"书架旁还能放一把椅子，掌柜喜欢靠背宽些，老先生希望扶手低些。青年摆出两张草图，你把现有的椅子拖到窗边。午后的溪光正映在空着的墙面上。","a":"请老先生试坐","b":"量取窗边空间"},{"title":"漆色试片","text":"新调的漆在罐里像深栗色，刷到木片上却偏红。木匠拿出几种不同木料，让你把试片按顺序摆好。青年注意到背阴的那块干得最慢，便搬来了标记纸签。","a":"记录各块试片的颜色","b":"把试片移到通风处"},{"title":"椅子的轻响","text":"客人坐下时，长椅发出轻轻的咯吱声。木匠检查后发现是两块木板相擦，连接处并未松动。你翻开手记，里面记着一种用薄毡隔开的办法，图旁画了朵小花。","a":"裁一条薄毡","b":"请木匠再听一遍响声"},{"title":"木屑装袋","text":"木坊收工后留下许多细木屑，花猫绕着它们打喷嚏。园丁想看看有没有适合花盆铺面的，铜匠则问能否装些擦亮器物。你拿来几个纸袋，把不同木材分开。","a":"筛出干净细屑","b":"清扫工作台"},{"title":"小桌展开","text":"折叠桌终于做好，搬到溪边时刚能放下一壶茶和两碟点心。青年反复试着收腿，动作逐渐熟练。掌柜摸着桌角说，它以后大概会陪很多人看夕阳。","a":"摆好溪边茶点","b":"把折叠步骤画进手记"},{"title":"傍晚练声","text":"说书人在廊下练习新故事，开头总被风铃打断。他想讲一只追着月亮走的花猫，真正的花猫听了直摇尾巴。你手里拿着故事草稿，末页还只有一幅圆月。","a":"陪说书人朗读草稿","b":"挪开廊下风铃"},{"title":"纸偶的胳膊","text":"小纸偶抬手时总向后翻，说书人拆开关节，发现线穿在了不合适的小孔里。青年拿来细钻，绣娘也留下几段结实的线。纸偶靠在茶杯旁，像在认真听他们商量。","a":"重新穿好关节线","b":"给纸偶画上衣袖"},{"title":"溪声伴奏","text":"旅人带着一支竹笛，吹到低音时容易漏气。说书人觉得这声音正适合故事中的小船，便请他再吹一次。你坐在岸边，听见笛声与船桨划水的声音偶尔重合。","a":"录记笛声的节奏","b":"划动停泊的小船"},{"title":"想家的段落","text":"说书人念到纸偶回家时，旅人忽然说自己很久没吃到家乡的饼。他讲起母亲总把饼边捏成叶子。厨师悄悄拿来面盆，想让旅人把那种手势再做一遍。","a":"请旅人示范捏边","b":"把回家段落重新读一遍"},{"title":"屋内的小雨","text":"为了给故事配雨声，青年往竹筒里装了小石子，倒转时却太响。园丁找来细种壳，说也许声音更柔和。你把两个竹筒并排放好，轻轻翻过其中一个。","a":"试装干燥种壳","b":"调整石子的数量"},{"title":"忘词的午后","text":"说书人排到一半忘了下一句，花猫却接出一句完全不同的话。大家听完都笑了，原来它把两则故事记到一起。老先生将两本稿子摊开，找到了相似的开头。","a":"给两份稿子做标记","b":"请花猫讲完它记得的故事"},{"title":"燕灵的戏份","text":"燕灵想在纸偶故事里扮一只带路的鸟，却总忍不住叼走舞台上的纸花。说书人给它找来一枝真草穗，试着排最后一次出场。你站在布幕后，看见它认真抖了抖翅膀。","a":"举起草穗示意","b":"整理布幕旁的纸花"},{"title":"客房试演","text":"小演出借用空客房排练，桌椅都搬到了墙边。纸偶的影子碰到窗帘花纹时，像走进了一片树林。说书人忽然想换个站位，请你到门口看看能否看清。","a":"到门口观察影子","b":"拉平窗帘下摆"},{"title":"听众的画","text":"住客看完试演后留了几张画，有人画小船，有人画纸偶背后的树。青年发现其中一幅画出了他们没留意的倒影。你把画铺在走廊桌上，准备找几只压纸的小石头。","a":"挑选压纸石","b":"把倒影画给说书人看"},{"title":"灯下的返场","text":"晚间演出结束后，一个孩子还想听花猫追月的后半段。说书人已经有些嗓哑，旅人举起笛子，花猫则慢慢跳上矮台。你手边放着温茶和那只修好的纸偶。","a":"给说书人倒温茶","b":"举起纸偶接着演"},{"title":"故事的小尾巴","text":"稿纸最后留着三行空白，说书人想写旅人回到店里的情景，却拿不准带些什么回来。厨师说可以是一袋果子，园丁说也许只是颗种子。你望着窗外，溪上正有小船靠岸。","a":"写下小船靠岸的声音","b":"画一只装着种子的口袋"},{"title":"夏夜散场","text":"最后一盏表演灯熄了，院里仍有人轻轻哼着笛曲。说书人收好纸偶，请你把住客的画夹进手记。花猫伏在空舞台上，头顶的星光像细碎的纸屑。","a":"把画作夹进手记","b":"陪花猫坐在舞台边"},{"title":"秋客来信","text":"秋风吹来时，春天住过的旅人寄来一封信，信里夹着细长的干叶。他问旅店的新窗帘是否已经挂好，还画了自己路过的木桥。掌柜把信递给你，露出熟悉的笑容。","a":"给旅人写回信","b":"将干叶放进压叶册"},{"title":"茶杯的缺角","text":"池里捞出的旧茶杯晾干了，铜匠想把它改作小花盆，厨师却觉得它适合装汤匙。花猫蹲在桌边，盯着杯底的小小鱼纹。你摸了摸缺口，边缘已经磨得圆润。","a":"在杯中栽入小苗","b":"给杯底垫上软布"},{"title":"阁楼晒书","text":"天气干爽，老先生将阁楼旧书搬到廊下透气。一本薄册里掉出许多票签，记着从前住客点过的茶。你认出其中有手记作者的字，纸张比其他页浅一些。","a":"按年份整理茶签","b":"清理薄册夹缝"},{"title":"冬衣寄出","text":"绣娘准备把做好的围巾寄给远方朋友，包裹里还想放一张旅店的画。青年画的屋顶略有些歪，却把每扇窗都画亮了。她把画递给你，请你帮忙挑张衬纸。","a":"裁好包裹衬纸","b":"给画页添上日期"},{"title":"清炉过冬","text":"入冬前，铜匠来检查厨房的炉门，手指一碰便落下薄灰。厨师把锅移到旁边，露出平时难清理的砖缝。你拿着窄刷，闻到炉灰里淡淡的木炭味。","a":"刷净炉门缝隙","b":"整理移开的锅具"},{"title":"夜里一盏灯","text":"结伴投宿的旅人今夜睡不着，坐在廊下翻看那本手记。他说走过很多地方，仍记不住每次告别。你端着茶出来，看见他正停在春天开窗的那一页。","a":"坐下陪旅人喝茶","b":"翻到旅人留下的布片"},{"title":"手记的主人","text":"老先生终于在封皮夹层找到一行字，写的是从前面点师的名字。原来菜谱、尺寸和花样分别出自不同人之手，他们常借同一本册子记事。你把新添的页放在旁边，纸角还很整齐。","a":"记录各页的笔迹特点","b":"请掌柜讲讲老面点师"},{"title":"迟来的杏酱","text":"表亲送来一罐夏天做的杏酱，说那阵子总想着带来，却屡次忘在家里。厨师打开罐子，果香一下充满厨房。你取出新烤的饼，发现酱的颜色比记忆里深了。","a":"把杏酱抹在饼上","b":"询问表亲熬酱的做法"},{"title":"窗前合照","text":"青年想画一幅大家在旅店的样子，花猫却不肯待在安排好的椅子上。燕灵落在他的笔杆，厨师手里还拿着没放下的汤勺。你看见纸上的人物已比起初鲜活许多。","a":"替青年扶好画板","b":"把花猫的软垫搬来"},{"title":"第一场雪","text":"雪落在小菜园里，秋天搭的藤架只剩清楚的弧线。掌柜端出热茶，园丁请你看看盆栽是否都搬进了屋。远处溪水仍在缓缓流，岸边的小船盖着白白的薄毯。","a":"检查廊下花盆","b":"拂去船篷积雪"},{"title":"装订的针脚","text":"手记的新页终于攒成厚厚一叠，老先生拿出装订线，让你决定把旅行画夹在哪里。旧页的边缘已有些卷曲，新页却带着厨房和木坊的气味。花猫把前爪收进胸口，安静看着。","a":"把旅行画夹入季节之间","b":"给旧页加上护纸"},{"title":"门口的铃声","text":"一年将尽，你整理好柜台，门口又响起投宿的铃声。来客手中抱着一盆没见过的花，问这里能否住几日。书架上留着一册新本子，第一页还没有写字。","a":"迎来客进屋","b":"取下新本子"}],"endings":[{"title":"溪边一桌饭","text":"四季旅店的长桌渐渐坐满熟悉的面孔。你把学来的菜谱分给厨房伙伴，自己也常向新住客请教。春笋、夏豆与秋梨轮番上桌，偶尔仍有一锅汤咸了，大家便添些热水再尝。冬夜收桌时，你发现那只缺角茶杯里开出了小花。","hint":"支持项（每项一分）：第1节点「帮助遇到困难的旅伴」、第4节点「加入溪畔厨房」、第5节点「送出备用材料」、第6节点「照顾同行者」、第8节点「协调溪畔厨房与四季旅店，整理出行路线」；第一、二幕各至少一项；公共结算：每方向至少命中两项不同早期行动，且第一、二幕各有支持；优先兑现第三幕声明的已形成方向，否则按命中数降序；同分按结伴生活、日常经营、收拾行囊、整理见闻、长久休养、安住小屋顺序。无方向形成才兜底安住小屋。身份、关系、秘密满足原条件时优先，不满足则按此公共比较结算。"},{"title":"柜台后的四季","text":"你留在旅店打理每日的预订与备料，给柜台添了一格放雨伞的小抽屉。忙碌时你也会记错房号，幸好门牌画着不同的花。掌柜去溪边散步的下午，你一边听铃一边写手记，窗外每换一季，桌上的茶也跟着换了香气。","hint":"支持项（每项一分）：第1节点「整理行程，联系四季旅店」、第4节点「加入四季旅店」、第5节点「准备四季旅店应急储备」、第6节点「独自前往四季旅店」、第8节点「收好笔记，拜访四季旅店」；第一、二幕各至少一项；公共结算：每方向至少命中两项不同早期行动，且第一、二幕各有支持；优先兑现第三幕声明的已形成方向，否则按命中数降序；同分按结伴生活、日常经营、收拾行囊、整理见闻、长久休养、安住小屋顺序。无方向形成才兜底安住小屋。身份、关系、秘密满足原条件时优先，不满足则按此公共比较结算。"},{"title":"带着食谱上路","text":"你把旅店手记抄成一本薄册，装进背包继续旅行。折叠小桌没法随身带走，青年便送你一只木杯。路上遇见不同的灶火，你总会想起溪边厨房的烟。多年后回来时，你递给厨师的册子已多了许多新菜，有一页还沾着海边的盐。","hint":"支持项（每项一分）：第3节点「使用随身工具」、第4节点「加入溪畔厨房」、第6节点「离开同行者」、第7节点「收起工具休息」、第8节点「协调溪畔厨房与四季旅店，整理出行路线」；第一、二幕各至少一项；公共结算：每方向至少命中两项不同早期行动，且第一、二幕各有支持；优先兑现第三幕声明的已形成方向，否则按命中数降序；同分按结伴生活、日常经营、收拾行囊、整理见闻、长久休养、安住小屋顺序。无方向形成才兜底安住小屋。身份、关系、秘密满足原条件时优先，不满足则按此公共比较结算。"},{"title":"一册手艺年鉴","text":"你留在书屋整理四季的记录，给每份菜谱和木作图补上实际试用的批注。翻到失败的染布样片，你仍把它夹在最初的位置。来学手艺的人常在这里坐一整天，离开前留下一张自己的图。书架逐渐放满，第一册却始终摆在伸手可及的地方。","hint":"支持项（每项一分）：第1节点「保存样本并观察」、第4节点「加入手艺书屋」、第5节点「展示采集的样本」、第8节点「与伙伴核对记录」；第一、二幕各至少一项；公共结算：每方向至少命中两项不同早期行动，且第一、二幕各有支持；优先兑现第三幕声明的已形成方向，否则按命中数降序；同分按结伴生活、日常经营、收拾行囊、整理见闻、长久休养、安住小屋顺序。无方向形成才兜底安住小屋。身份、关系、秘密满足原条件时优先，不满足则按此公共比较结算。"},{"title":"慢下来的炉火","text":"连续赶做的日子过去后，你的手腕需要长久休养。厨房伙伴接过大锅，青年把窗边椅子的扶手改得更合适。你暂时少做精细活，改为口述配方和辨认木料。炉火照常在清晨燃起，你终于能坐下来，把一碗热粥吃到见底。","hint":"支持项（每项一分）：第3节点「练习自己的手艺」、第6节点「照顾同行者」、第7节点「继续练习手艺」、第7节点「集中使用天赋」；第一、二幕各至少一项；公共结算：每方向至少命中两项不同早期行动，且第一、二幕各有支持；优先兑现第三幕声明的已形成方向，否则按命中数降序；同分按结伴生活、日常经营、收拾行囊、整理见闻、长久休养、安住小屋顺序。无方向形成才兜底安住小屋。身份、关系、秘密满足原条件时优先，不满足则按此公共比较结算。"},{"title":"窗下长住客","text":"你没有给自己安排远行，也没急着挑定一门终身手艺。日子从给花盆浇水、帮厨房择菜开始，午后偶尔到溪边坐坐。手记里留下了你不多的几行字，写的是雪后小船上的鸟印。下一位客人问起时，你仍能把那天的阳光讲得很清楚。","hint":"支持项（每项一分）：第3节点「使用随身工具」、第4节点「加入溪畔厨房」、第5节点「送出备用材料」、第7节点「收起工具休息」、第8节点「协调溪畔厨房与四季旅店，整理出行路线」；第一、二幕各至少一项，或所有公共方向均未形成时兜底；公共结算：每方向至少命中两项不同早期行动，且第一、二幕各有支持；优先兑现第三幕声明的已形成方向，否则按命中数降序；同分按结伴生活、日常经营、收拾行囊、整理见闻、长久休养、安住小屋顺序。无方向形成才兜底安住小屋。身份、关系、秘密满足原条件时优先，不满足则按此公共比较结算。"},{"title":"有温度的菜谱","text":"作为爱记菜谱的旅店学徒，你把反复练过的做法整理成可供翻阅的小册。书里没有含糊的少许，旁边却留着各人的口味笔记。第一次有人照着它烤出好饼，你比自己成功时还高兴。后来纸页翻旧，面粉落进书脊，新的学徒又在边上添了字。","hint":"以「爱记菜谱的旅店学徒」开局；第一幕研习身份技艺；第二幕继续研习；第三幕整合技艺；身份技艺达到 3；合作小组支持至少 4，技艺有实际服务对象；天赋负担不超过 6；终幕选择「以身份技艺服务合作小组」。"},{"title":"面缸旁的春天","text":"你照看老面缸许多年，逐渐能从气味和手感辨认面团的变化。厨房换过蒸笼，也修过炉子，你每次都重新试做。春天的一个清晨，学徒端出松软的花卷，请你先尝。你没有急着点评，只掰开一小块，看热气在窗光里缓缓散去。","hint":"以「照看老面缸的面点师」开局；第一幕研习身份技艺；第二幕继续研习；第三幕整合技艺；身份技艺达到 3；合作小组支持至少 4，技艺有实际服务对象；天赋负担不超过 6；终幕选择「以身份技艺服务合作小组」。"},{"title":"木纹里的小屋","text":"你背来的工具箱在旅店安了家。窗框、抽屉和折叠桌上都留下你的手艺，青年也学会独立选料。多年后他送来一张新椅子，扶手恰合你的习惯。你坐在溪边，发现当初桌面上的树结仍像一只弯眼睛，陪你看着水面发亮。","hint":"以「背着工具箱的木匠」开局；第一幕研习身份技艺；第二幕继续研习；第三幕整合技艺；身份技艺达到 3；合作小组支持至少 4，技艺有实际服务对象；天赋负担不超过 6；终幕选择「以身份技艺服务合作小组」。"},{"title":"一壶晚安茶","text":"你把香草茶的练习做成日常，按季节尝试薄荷、果皮与晒干花瓣。客人常记不住茶名，只会说想喝上回那一壶。你便问他当时闻到了什么，再慢慢配。入冬后，廊下总有一只温着的壶，杯口的热气把夜晚衬得格外安静。","hint":"以「研究香草茶的调饮师」开局；第一幕研习身份技艺；第二幕继续研习；第三幕整合技艺；身份技艺达到 3；合作小组支持至少 4，技艺有实际服务对象；天赋负担不超过 6；终幕选择「以身份技艺服务合作小组」。"},{"title":"拼布里的来路","text":"你收藏的旧花样与旅人留下的布角拼成了走廊上的长画。每修补一次，你便想起对应的住客。燕灵尾羽的方向终于绣对了，花猫的形状却依然有些圆。你没有拆掉它，因为当时帮忙落针的孩子如今已经长大，回来还会认出那一块。","hint":"以「收藏旧花样的绣娘」开局；第一幕研习身份技艺；第二幕继续研习；第三幕整合技艺；身份技艺达到 3；合作小组支持至少 4，技艺有实际服务对象；天赋负担不超过 6；终幕选择「以身份技艺服务合作小组」。"},{"title":"沿溪送来清晨","text":"你继续驾小船送食材，熟悉了每一处适合靠岸的木桩。旅店厨房开始按季节订货，你也能留出上午陪家人吃饭。船篷里常放着写给老先生的信和燕灵爱啄的种袋。秋日靠岸时，掌柜远远挥手，你把一篮带露的梨提上台阶。","hint":"以「沿溪送货的小船主」开局；第一幕研习身份技艺；第二幕继续研习；第三幕整合技艺；身份技艺达到 3；合作小组支持至少 4，技艺有实际服务对象；天赋负担不超过 6；终幕选择「以身份技艺服务合作小组」。"},{"title":"铜壶里的光","text":"你的修补桌安在旅店后院，长柄锅和旧茶壶总有人送来照看。你教青年辨认薄弱的接缝，也向木匠学习做握着舒服的木柄。壶身并非每次都能恢复光亮，但倒水时不再漏出细线。傍晚擦干工具，你会给自己泡一杯茶，看看杯中摇晃的天色。","hint":"以「修补锅壶的铜匠」开局；第一幕研习身份技艺；第二幕继续研习；第三幕整合技艺；身份技艺达到 3；合作小组支持至少 4，技艺有实际服务对象；天赋负担不超过 6；终幕选择「以身份技艺服务合作小组」。"},{"title":"纸偶的归处","text":"你把四季旅店写进新的故事，纸偶每到结尾都会在溪边停船。演出时孩子们最喜欢花猫临时添的那一句，你索性留出空当让它接话。说累了便由竹笛续上曲子。旅店每年都有新住客，故事也跟着长长，却始终从一场春雨开始。","hint":"以「走村演出的说书人」开局；第一幕研习身份技艺；第二幕继续研习；第三幕整合技艺；身份技艺达到 3；合作小组支持至少 4，技艺有实际服务对象；天赋负担不超过 6；终幕选择「以身份技艺服务合作小组」。"},{"title":"并排的旅行杯","text":"你与结伴投宿的旅人后来常一同出门，偶尔也各走一段喜欢的路。两只木杯放在旅店的同一层架上，哪只不在，便知道谁去看新的风景了。重逢时你们先喝茶，再慢慢展开路上收来的地图。那些没赶在信里写完的小事，总能讲到天黑。","hint":"第一幕与结伴投宿的旅人相识；第一幕结识的人，在第二幕获你保护，第三幕仍守约（信任至少 5）；终幕选择「将共同生活置于远行计划之前」。"},{"title":"修书人的午后","text":"你守着与老先生的约定，常去书屋陪他修整纸页。他眼力渐弱后，你负责穿针，他仍能凭触感找出翘起的书角。晴天你们把书搬到廊下，顺便吃一碟新点心。他讲故事不再那么快，你也不再急着翻到下一页。","hint":"第一幕与修书的老先生相识；第一幕结识的人，在第二幕获你保护，第三幕仍守约（信任至少 5）；终幕选择「将共同生活置于远行计划之前」。"},{"title":"厨房里的两种香","text":"你和爱试新菜的厨师继续共用一张案台，各自保留不同的调味习惯。你切菜时他尝汤，他揉面时你擦净碗碟。偶尔一道菜试得不合口味，晚饭便改吃简单面条。最让你们期待的仍是开盖那一刻，因为熟悉的厨房总会冒出新的香气。","hint":"第一幕与爱试新菜的厨师相识；第一幕结识的人，在第二幕获你保护，第三幕仍守约（信任至少 5）；终幕选择「将共同生活置于远行计划之前」。"},{"title":"送货之外的周末","text":"你与送食材的表亲渐渐约好，每月留一个不装货的日子。小船只带茶壶和坐垫，沿溪慢慢划到开阔处。以前总在码头匆匆说完的话，如今能伴着水声讲到一半再停。入秋时你们摘回几只梨，谁也没忙着写进货单。","hint":"第一幕与送食材的表亲相识；第一幕结识的人，在第二幕获你保护，第三幕仍守约（信任至少 5）；终幕选择「将共同生活置于远行计划之前」。"},{"title":"做完这张小桌","text":"你陪学习木作的青年走过最初笨拙的练习，他后来也陪你修好了旧工具箱。你们在小桌下各刻了一朵小花，摆桌时才看得到。青年去别处学新的手艺，回来会带你摸摸不同木料。每回谈得起兴，茶凉了都没有发现。","hint":"第一幕与学习木作的青年相识；第一幕结识的人，在第二幕获你保护，第三幕仍守约（信任至少 5）；终幕选择「将共同生活置于远行计划之前」。"},{"title":"手记里的几双手","text":"你把厨房记录与旅店日记放在一起，终于认出手记里的不同笔迹来自轮流借书的朋友。菜谱旁的窗框图是等面发好时画的，绣样则是替晚归的人留灯时添的。你将这些关联整理成一页小记。花猫读完打了个哈欠，说这本来就是一本大家常放在桌上的书。","hint":"前局发现「public.rescue」；前局发现「public.rule」；第一幕寻找异常的起因；第二幕与各组伙伴交流；收集至少两份线索；终幕选择「用旧日发现串联见闻」。"},{"title":"最早的花卷","text":"重拾手艺时，你与旅伴循着旧页做出一种叶形花卷。封皮夹层留下的名字，恰与旅人家里保存的食谱相同。你们托表亲捎信，收到了更完整的做法。新做的花卷没有想象中神奇，却松软得恰到好处，像把一次迟到的早饭认真补上了。","hint":"前局发现「identity.1」；前局发现「relationship.1」；第一幕重拾技艺；第二幕继续研习；第一幕结识的人，在第二幕获你保护，第三幕仍守约（信任至少 5）；终幕选择「承接前世身份与未竟承诺」。"},{"title":"空白页的晴天","text":"休养的日子里，老先生告诉你，手记最初只是用来写下想尝试的事。你不再急着填满每一页，先把工具收好，到院中看看花。后来花猫在空白页上踩了个爪印，你把日期写在旁边。那天没有完成什么大作品，却成了你最常翻看的一页。","hint":"前局发现「public.sacrifice」；前局发现「relationship.2」；第一幕结识的人，在第二幕获你保护，第三幕仍守约（信任至少 5）；第二幕停止透支；第三幕接受能力限制；终幕选择「以旧日关系记忆调整天赋的用法」。"}],"turns":{"calling":{"title":"老面缸的盖子","text":"旅店面点师掀开老面缸，请你接学照料这一缸用了多年的面种。添水、记温与发酵都有适合你参与的办法，只是往后许多清晨得留给厨房。沿溪船主也邀你学货运记账与交货，第一份差事要在晨雾中出发。","options":[{"label":"接下老面缸，学做旅店面点师","aftermath":"五年后，厨房每天供应一种由你反复改过的溪米蒸饼，老面缸盖上添了你的照料日期。你很少参加远行住客的送别，因为那时正在看第一笼面点；新学徒已经开始跟着你的记录学发面。"},{"label":"谢绝接缸，随船主改做溪上货运","aftermath":"五年后，你有了自己的沿溪交货账本，船上专门改出一格不压坏香草的货架。老面缸由留店的学徒照料；你给旅店送货时从客门进去，清晨先核对的是水位和货单。"}]},"bond":{"title":"修书人的便笺","text":"常陪你整理散页手记的老先生已看不清细字，想搬去溪对岸静养。他请你今后每旬过河，陪他处理来信与不能独自完成的修书活。那会挤掉你许多整日外出的机会；他也问好了对岸书铺的代办，愿意与你在渡口好好道别。","options":[{"label":"答应长期过河，陪他读信修书","aftermath":"六年后，渡口船家一见你的修书匣便知道是赴老先生的约。你每旬空出一天，放弃了几次连月随行的差事；他替你留下的一格书架，已装满你们共同补好的家信册。"},{"label":"请书铺接手，与老先生各自生活","aftermath":"六年后，老先生的信封上常见对岸书铺的代笔字迹，你们没有那份每旬相见的日程。你已经随行做过两轮跨季的长途差事，私人物箱里多了一本逐站收集的食谱；那只修书匣被你留作存放来信。"}]},"home":{"title":"溪声进窗","text":"旅店后坡的小屋可以长期租给你，屋主肯照你的起居需要改造，只请你共同修护每年被溪水泡松的便桥。一个熟客也替你问到了远方湖镇的空居所，搬去便能重新布置生活，只是再不能隔窗招呼厨房里的朋友。","options":[{"label":"租下后坡小屋，在溪边长住","aftermath":"七年后，小屋窗下长出了你逐年补种的香草，桥板背面刻着你参与维修的日期。你为雨季修桥年年留下；旅店厨师缺一把香草时会来敲窗，熟客给你的明信片都寄到同一块木门牌下。"},{"label":"辞别旅店，迁居远方湖镇","aftermath":"七年后，你住在湖镇一间朝西的屋子，专门留出墙面悬挂从溪边带来的旧招牌拓印。后坡小屋已有别的住客；你每年寄回一包湖畔干果，熟悉的厨师尝到时，你只能隔着回信读他的评语。"}]}},"episode":{"title":"庆功宴上老板删了我","source":"web-original","opening":{"title":"没有你的创始名单","text":"四季旅店重新开门那晚，有位客人把没讲完的创业故事留在了账本里。你读到涂掉的署名，宴会厅的灯忽然亮了，你正坐在当事人的位置上。产品发布会开始前，合伙人把你的名字从创始名单删掉，递来一份离职协议：代码谁都能写，台上只能站一个人。你三个月睡在机房，他却把核心演示改成自己独立研发。掌声刚响，客户指定演示离线功能，舞台上的机器当场黑屏。合伙人压低声音叫你上去修，还伸手去夺你的电脑。","a":"打开电脑里的版本记录","b":"带着备用机走上演示台","attributes":["理智","实力"]},"followups":[{"title":"署名藏在每一版里","text":"你把版本记录交给客户，三个月的提交、评审和授权邮件一页页展开。客户问合伙人为何删除署名，他改口说你只是外包；你随即翻出双方签过的股权协议，他伸出的手停住了。客户暂停付款，要求先确认交付权利。台下同事把你遗落的工牌递来，律师则在屏幕另一端等你接通电话。","a":"接通律师的视频电话","b":"拿着工牌走到团队面前","attributes":["资源","羁绊"]},{"title":"被包装掉的故障","text":"备用机离线完成演示，你调出对照界面，黑屏原因也随之暴露：合伙人为了多收订阅费，私加了联网验证。他想关掉投影，客户已经拍下了错误日志。台下掌声转向你，他却把离职协议撕掉，笑说内部误会。客户递来技术负责人合同，同事同时发来消息，说你们共同持股足够发起会议。","a":"逐页查看客户递来的合同","b":"向全体股东发送会议通知","attributes":["理智","声望"]}],"codas":["律师核实协议后提出回购与署名要求。一个月后，你收到结清款，带着可公开的作品履历入职新团队。旧合伙人第一次独自面对客户，会议开了整夜。","你请每位同事逐项核对贡献，最终把署名写回产品。团队推选了新的交付负责人，你负责技术，原合伙人退出管理。庆功照重拍时，所有人都站在台上。","合同要求你带走原公司的代码，你当场划掉那一条，另签独立开发项目。半年后，新产品上线，第一位付费客户正是当初那场黑屏演示的见证人。","会议按章程通过管理层调整，财务审核追回了被挪作包装的预算。你接手产品却没有独占舞台，发布会上逐个念完贡献者姓名，直到掌声盖过倒计时。"]}},{"id":"w6","name":"折纸小镇","premise":"小镇上的折纸会随着光线展开不同形状。你来到纸艺工坊，学习修书、折灯与制作会走路的纸偶，并追寻一本旅行画册里尚未画完的风景。","factions":{"commons":"纸桥茶室","council":"折光工坊","archive":"风物书房"},"fate":{"characters":["闻鹊","沈灯","陆衡","远行的家人","学折纸的少年","画册整理员"]},"origins":["替旅人誊写游记的抄录师","照看温室香草的园艺师","修复书脊的补缝匠","听得出灯纸轻响的制灯学徒","收藏梦境图画的夜市画师","巡看纸桥的维修师","在郊外照看绵羊的牧人","接手旧文具店的年轻店主","披着百色纸衣的行走纸偶","从空白画册里醒来的纸灵"],"events":[{"title":"折角初见","text":"你来到折光工坊时，门边的纸鹤正在晨光里伸展翅膀。闻鹊递来一张厚纸，请你照着桌上的小船折。纸的一角有淡淡水纹，触摸起来比别处柔软。","a":"沿水纹轻折纸角","b":"观察样船的折痕"},{"title":"纸桥茶香","text":"茶室门外架着一座覆有纸篷的小桥，风吹时沙沙作响。沈灯正把茶盏挪出漏光处，桥篷有一条接缝翘起。你刚放下工具包，便闻到了烘焙米茶的香气。","a":"查看翘起的接缝","b":"帮沈灯挪好茶桌"},{"title":"桌上的燕尾","text":"陆衡带来两种燕尾折法，一种停得稳，一种转身灵活。少年试折的燕子却总侧倒，桌上已积起几团废纸。你看见他两边翅膀的宽度差了一点。","a":"量取纸燕两侧宽度","b":"陪少年重新折叠"},{"title":"透光字迹","text":"旧画册有一页看似空白，举到灯下却能读出几行浅字。整理员说作者习惯在背面记天气，后来用了厚纸装裱。窗外恰好起风，画中的芦苇也微微晃动。","a":"把浅字抄到薄纸上","b":"查看画页背面"},{"title":"纸袋里的种子","text":"园艺师送来一袋花种，袋子折成小屋的模样。少年舍不得拆，想从烟囱口把种子倒出来。你轻轻摇了摇纸屋，听见种子卡在某一道折层里。","a":"展开纸屋底部","b":"用软刷拨动种子"},{"title":"糨糊的香气","text":"新调的糨糊略显稀薄，纸片贴上去就起皱。补缝匠让你看看放凉后的另一碗，表面已经结成薄膜。炉边的水壶轻响，窗台上排着等待修整的旧书。","a":"搅匀放凉的糨糊","b":"裁一张试贴纸片"},{"title":"雨点落灯","text":"一阵细雨飘进廊下，刚晾好的纸灯留下几点深色水痕。沈灯把灯架转向屋内，想等纸干了再看。闻鹊发现水痕恰好连成花枝，取来了画笔。","a":"把纸灯移到干架","b":"描下水痕的轮廓"},{"title":"第一次点亮","text":"制灯学徒装好冷光灯芯，纸罩亮起时却有一道明显暗边。陆衡将灯提到墙前，影子像缺了一角的月亮。你从底部望进去，发现接纸的地方叠了两层。","a":"调整接纸的位置","b":"比较不同角度的灯影"},{"title":"画册中的岔路","text":"旅行画册上画着两条小径，一条通往风车，一条藏进竹林。闻鹊说两处都离镇子不远，想带你找找画中的石凳。少年已经把午饭装进折好的纸盒。","a":"收拾竹林用的画具","b":"带上风车图页"},{"title":"小船试水","text":"纸船放进浅盘后慢慢倾斜，船底折缝有细小水珠。维修师拿来一张涂过植物蜡的纸，让你摸摸差别。茶室的水盆足够宽，能再放下几只不同的小船。","a":"用蜡纸重折小船","b":"记录原船浸水的位置"},{"title":"留在书里的花","text":"补缝匠在书脊旁发现一朵压干的小花，花瓣黏着纸边。它夹在画册的春景里，颜色已淡得像茶。园艺师认出叶脉，想先把碎裂的花梗托起来。","a":"裁一片薄纸托住花梗","b":"请园艺师描画叶脉"},{"title":"春页归位","text":"修好的春景摊在书房桌上，小桥、纸灯和温室都能一一认出。整理员给你留了半页空白，问你想记录哪个初来时的细节。门外纸鹤又在迎着光抬头。","a":"画下门口的纸鹤","b":"写下茶室的气味"},{"title":"发黄的边角","text":"一叠旧信纸边缘发黄，中央却还柔韧。年轻店主想把它裁成便签，补缝匠觉得其中的水印值得留样。你将纸铺平，看见每张边角的深浅都不相同。","a":"挑出完整水印纸","b":"沿黄边画裁切线"},{"title":"书脊里的细线","text":"一本游记摊开便露出松散的线结，作者在扉页写了旅行年份。你用针挑起断线，发现旧针孔还能沿用。补缝匠给你看另一种走线法，手势很慢。","a":"沿旧针孔穿线","b":"在练习纸上试新走线"},{"title":"纸张的纹理","text":"同样大小的两张纸折起来手感不同，少年以为是自己力气不匀。店主让你们沿两个方向分别试折，纸边立刻出现不同弧度。桌上放着一只空样本夹。","a":"标出纸纹方向","b":"把试折纸放进样本夹"},{"title":"封皮下的图","text":"旧封皮揭起一点，下面露出一只彩色茶壶。整理员记得这本书曾包过别的纸，但不确定图画是否完整。你把软垫放在书下，封皮接缝仍有几处牢牢粘住。","a":"用薄片慢慢分开接缝","b":"先描出露出的茶壶"},{"title":"晒纸的绳子","text":"院里的晒纸绳稍有下垂，中间几张湿纸碰到了一起。沈灯搬来木凳，闻鹊去找新的夹子。你抬头看见绳结松了，而边上的竹竿还空着。","a":"重新系紧晒纸绳","b":"把湿纸分挂到竹竿"},{"title":"虫眼旁的字","text":"一页游记被虫蛀出小洞，缺掉的字正好在地名中间。画册整理员翻出作者其他旅行记录，想核对路线。你沿纸洞裁了一块薄补纸，大小刚能遮住空缺。","a":"核对相邻页的路线","b":"粘好裁出的补纸"},{"title":"怕水的墨","text":"修书时一滴水碰到墨线，纸上顿时晕开灰色。补缝匠请你先停下刷子，转而观察未沾水的一角。窗边摆着几种旧墨样本，他想找出适合这页纸的处理方法。","a":"比对墨样上的晕痕","b":"吸干纸边水滴"},{"title":"空白的书签","text":"店主请大家试用新裁的书签，少年想在上面画一只会动的鱼。闻鹊提醒他书签要夹进书里，厚折层可能硌着书页。你捏着窄纸条，试着折出扁平尾鳍。","a":"试折平面的鱼尾","b":"画一条细线小鱼"},{"title":"卷起的画页","text":"一张大画离开画筒后仍不停卷回去，四个角都压上石子也不平。整理员说纸在筒里放了很久，需要慢慢展开。你从柜中取来平整夹板，板面还带着木香。","a":"把画夹入平板","b":"记录画纸卷曲方向"},{"title":"纸边的毛茸","text":"补纸边缘太整齐，贴上旧页后显得突兀。补缝匠用细笔蘸水画线，再缓缓撕开纸边，留下柔软纤维。你试着拿起同样的纸，感觉水线还没有完全渗开。","a":"等水线浸透再撕纸","b":"在废纸上练习水线"},{"title":"修好的旅行册","text":"游记终于能平稳翻页，破损处的衬纸在斜光下仍看得见。作者来取书时特意摸了摸旧封皮，说熟悉的触感还在。你把拆下的残线装进小袋，放到书旁。","a":"交还修整记录","b":"陪作者翻看图页"},{"title":"书房的清风","text":"春季修书告一段落，整理员打开高窗，让书架透气。你把不同纸样装好，发现最早折的小船仍夹在其中。它的底部已经干透，只留下细细一道水线。","a":"给纸样夹写上日期","b":"把纸船摆上窗台"},{"title":"灯骨初弯","text":"学徒拿着细竹条试做圆灯，弯到末端时竹条弹了回来。沈灯教他先慢慢浸软，再顺着弧形模具贴合。你端来浅水盘，盘底倒映出几张认真的脸。","a":"把竹条放进水盘","b":"固定圆形模具"},{"title":"不圆的月亮","text":"圆灯骨架装好后，侧面有一点扁。陆衡觉得像初升的月亮，学徒却想再修一修。你转动框架，发现接头附近有一根竹条比其他的短。","a":"量取接头竹条","b":"描画侧面的轮廓"},{"title":"五色灯纸","text":"店主带来五种灯纸，透光后与白天看的颜色差别很大。闻鹊把它们遮在同一只灯芯前，墙上依次出现柔和色块。你拿着画册，比对里面的傍晚天空。","a":"记录灯纸透光颜色","b":"并排摆放冷暖纸样"},{"title":"灯穗打结","text":"纸灯的细穗被风吹成一团，少年越拉越紧。沈灯让他先把灯放低，找出最外面那根线。你托着灯底，闻到新纸与干竹条混在一起的清香。","a":"慢慢挑开外层线结","b":"拆下灯穗平铺"},{"title":"墙上的小鹿","text":"闻鹊剪了一只小鹿贴在灯罩内侧，点灯后鹿影的腿显得太粗。她把剪纸往灯芯方向移，影子又变得模糊。你在墙边举起一张白纸，方便她比较。","a":"移动白纸接影","b":"修剪小鹿腿部"},{"title":"灯芯轻鸣","text":"新灯芯工作时带着很轻的嗡声，学徒只有贴近才能听见。陆衡检查灯座垫片，沈灯则换上另一枚灯芯。你闭上眼睛听了一会，觉得声音似乎来自桌面共振。","a":"在灯座下垫软布","b":"比较两枚灯芯的声音"},{"title":"灯罩里的叶脉","text":"园艺师送来压平的叶脉，想做一盏能看见季节的灯。叶片比纸薄，轻轻一碰便卷起边角。你用镊子托住叶柄，沈灯已经备好透明衬层。","a":"把叶脉放上衬层","b":"排列不同大小的叶片"},{"title":"高窗挂灯","text":"工坊准备在高窗旁挂灯，绳长却让灯罩碰到窗框。维修师搬稳梯子，让陆衡扶住底脚。你站在楼下望着窗边，能看见灯与窗框之间窄窄的缝。","a":"调整挂绳长度","b":"量取窗框空隙"},{"title":"雾中的灯色","text":"傍晚起雾，茶室外的灯看上去比屋里更淡。沈灯让你带两种灯罩到廊下比较，湿润空气轻轻贴着脸。桥篷滴下水珠，远处的树只剩模糊轮廓。","a":"把两盏灯并排挂好","b":"画下雾里的光圈"},{"title":"纸灯的小孔","text":"少年不小心戳破一处灯罩，想贴上整块补纸。闻鹊看着那个小孔，说也可以把它画成星星。学徒拿来同色薄纸，你发现旧纸已比新纸稍微偏黄。","a":"裁一枚星形补片","b":"调配接近旧纸的颜色"},{"title":"晚间灯展","text":"工坊把练习灯摆到茶室走廊，来喝茶的人逐盏细看。有人喜欢叶脉灯，有人反复转动那只略扁的圆灯。你负责添水，偶尔听见客人描述灯影像什么。","a":"记下客人的灯影联想","b":"给走廊茶壶添水"},{"title":"留一盏夜灯","text":"灯展结束，沈灯把作品收回工坊，只在书房桌边留了一盏。暖色灯纸让旧书看着更柔和，你翻开画册，看见作者也画过相似的桌灯。夜风在窗外轻轻翻动纸桥的篷。","a":"抄下画中的灯架细节","b":"陪沈灯收好灯箱"},{"title":"梦里的果树","text":"夜市画师说自己梦见一棵结着茶杯的树，醒来后只记得枝干形状。闻鹊听得有趣，想试着做成立体纸景。你把厚纸铺在桌上，画师开始重新描述树梢。","a":"画出杯形果实","b":"裁取树干底样"},{"title":"纸景的远山","text":"画师把远山和近树都涂得很浓，叠起来后看不出距离。陆衡拿来一张浅灰薄纸，放到山前。你从小窗框望进去，发现空白的间隔也改变了景色。","a":"调整纸景间距","b":"调淡远山颜色"},{"title":"醒来忘掉的桥","text":"画册里有一座桥，画师坚称梦里见过，却想不起桥头是什么。园艺师拿来沿溪植物图，闻鹊翻看旧旅行便笺。你发现桥栏的花纹与茶室杯垫十分相近。","a":"描下桥栏花纹","b":"去茶室查看杯垫"},{"title":"颜料小碟","text":"夜市画师带来的颜料沉在碟底，表面只剩透明水。少年拿笔一蘸，画出几乎看不见的线。画师让你们先慢慢搅动，阳光照着碟沿，浮起细细彩粉。","a":"搅匀碟底颜料","b":"在样纸上试色"},{"title":"梦中的声音","text":"纸景已经有树、有桥，却让画师觉得少了点什么。他闭眼回想，说梦里听到很慢的滴水声。沈灯从柜里拿来一只旧沙漏，闻鹊则轻敲空茶盏。","a":"敲击茶盏试音","b":"记录画师描述的节奏"},{"title":"镜面湖水","text":"一片亮纸被放作湖面，反光却把近树的影子吞掉了。陆衡让你试试磨砂纸，画师又在湖边添上一圈芦苇。你挪到另一侧，发现真实窗景也倒映进来。","a":"换上磨砂湖面","b":"调整近树的位置"},{"title":"云朵太重","text":"吊在纸景上方的云把细枝压弯了，少年担心树会倒。闻鹊拆开云团，里面竟塞着练习时忘取的厚底板。你扶住树干，看见纸枝慢慢恢复弧度。","a":"取出云团底板","b":"加固纸景底座"},{"title":"风车试转","text":"梦景的风车只在风很大时才动，叶片转起来又容易互碰。维修师检查转轴，提醒你们叶片要留出间隔。你把小扇放在桌边，纸屑随着微风滚动。","a":"调整风车叶片间距","b":"磨平转轴端面"},{"title":"看画的孩子","text":"一个孩子透过纸景小窗看了很久，突然问湖边的小屋有没有人住。画师原本没想过这个问题，拿起笔又放下。你看见桌角还有几张能折小椅子的碎纸。","a":"折一把小椅子","b":"请孩子画出想象中的住客"},{"title":"潮湿的夜市","text":"夜市空气潮湿，纸景底板轻轻翘起。店主带来干燥箱，闻鹊已把桌上水杯移远。画师摸着边角，想起上次也是下雨前出现这种弯曲。","a":"把纸景移入干燥箱","b":"记录空气湿度"},{"title":"画题的空格","text":"纸景展示牌还没有名字，画师写了几个又擦掉。他觉得梦已记不全，如今的树与湖都多了大家的想法。你端来茶时，看到少年在纸边写着茶杯林三个字。","a":"朗读纸边的名字","b":"请画师描述现在的纸景"},{"title":"梦景装盒","text":"纸景终于装入透明盒，风车仍能从侧面的小孔轻轻吹动。画师把最初的梦草图放在盒底，让来看的人自行翻阅。你关上书房窗户，盒里那把小椅子正对着湖。","a":"把制作过程写入图册","b":"擦净透明盒面"},{"title":"晨露温室","text":"园艺师带你进温室，玻璃上的晨露映出细小彩光。纸牌被水汽浸软，几盆香草的名字都卷了边。她剪好新的纸片，让你先闻一闻叶子再做标记。","a":"辨闻各盆香草","b":"给纸牌涂上防潮蜡"},{"title":"羊毛纸样","text":"郊外牧人带来梳下的软毛，店主想试着混进手工纸里。细毛在水盆中结成小团，补缝匠建议先梳开。你拿着细齿梳，指尖沾了些温温的水。","a":"梳开羊毛小团","b":"调匀纸浆稀稠"},{"title":"花瓣入浆","text":"园艺师送来掉落的花瓣，少年把它们一把倒进纸浆，颜色混成一片。闻鹊另留了几片完整花瓣，想放在纸面上。你举起纸帘，水正从细网里缓缓流走。","a":"在湿纸面摆好花瓣","b":"重新搅拌纸浆"},{"title":"竹林拾叶","text":"你和家人来到画册里的竹林，地上铺着薄薄落叶。家人想找一片完整叶子寄给远方朋友，你却注意到石凳上的旧刻花。午后的风让竹影不断移位。","a":"挑选完整竹叶","b":"拓下石凳花纹"},{"title":"纸包里的茶","text":"沈灯试用新纸包装茶叶，隔夜后纸上留下浅浅香气。店主想在包装上画出茶的原料，园艺师拿来一枝米花草。你把样包拆开，折痕里还藏着几粒碎茶。","a":"画下茶叶和草枝","b":"检查样包的折口"},{"title":"缓慢的发芽","text":"少年天天守着小盆，种子却没有冒芽。园艺师请他轻轻查看盆土，说有些花需要更长时间。你发现盆边的纸牌记着日期，和种子袋上的建议时间还有些距离。","a":"记录盆土的湿度","b":"陪少年翻看生长图册"},{"title":"叶片上的洞","text":"温室的一片嫩叶出现小洞，园艺师翻到背面，找到一只绿色小虫。闻鹊拿来观察盒，少年已画出半张放大图。你看着虫子慢慢挪动，触角像细小纸丝。","a":"观察小虫的足部","b":"描画叶片缺口"},{"title":"植物拓印","text":"你们把叶子夹在纸里拓印，纹路一边清楚一边模糊。画师摸摸叶柄，发现叶片厚薄不匀。园艺师递来柔软垫布，风从温室门口吹动了悬挂的标签。","a":"垫好拓印布","b":"换一片薄叶试印"},{"title":"雨后的纸花","text":"放在温室里的纸花因受潮慢慢展开，少年说它比真花醒得还早。闻鹊想记录展开的顺序，沈灯带来计时沙漏。你发现不同纸做的花，开合速度差得很大。","a":"绘制花瓣展开顺序","b":"给各朵纸花标注纸种"},{"title":"牧场的晚餐","text":"牧人邀请你们到郊外吃晚饭，桌上有热汤与新烤的薄饼。少年带来的纸羊摆在真羊旁边，真羊只顾低头吃草。你看见牧人的围巾上粘着一片熟悉的花瓣纸。","a":"帮忙摆好晚餐","b":"替牧人摘下纸片"},{"title":"秋叶的颜色","text":"第一批秋叶送到工坊，压干后有些颜色变深，有些几乎褪去。画师把它们放到原先的色卡旁，准备重新记一遍。你抬起一片叶子，细小裂口透进一束光。","a":"重新绘制干叶色卡","b":"给脆叶加上托纸"},{"title":"温室一页","text":"园艺师把一季的纸牌、叶拓和花纸整理成册，请你补上几行观察笔记。少年曾经等得焦急的种子如今开了小花。她剪下凋落的一瓣，轻轻放在最后一页。","a":"补写发芽的日期","b":"画下花盆全貌"},{"title":"纸偶醒来","text":"工坊里新折的纸偶突然开口，问自己的帽子为什么遮住眼睛。少年忙把帽檐抬起，闻鹊笑着递来镜子。你看见它衣袖的折角还有些硬，抬手时沙沙作响。","a":"替纸偶整理帽檐","b":"请纸偶试着伸臂"},{"title":"楼梯练步","text":"纸偶想上书房楼梯，每迈一步就被过长的衣摆绊住。陆衡在旁边托着小板，让它停下歇一会。你摊开折衣图，发现下摆还可以向内收一层。","a":"把衣摆向内折短","b":"给楼梯加一段小斜坡"},{"title":"帽子里的花","text":"纸偶从温室回来，帽子里插满了落花。它想把花留下，又怕压平后失去蓬松形状。园艺师递来一只浅盒，画师则翻出几张不同角度的花卉图。","a":"给花束画一幅像","b":"把落花分放进浅盒"},{"title":"纸灵的名字","text":"从空白画册里醒来的纸灵只画了个圆圈介绍自己，大家一时不知道该怎样称呼它。闻鹊在旁边画了只鹊，纸灵立刻添上一根树枝。你手里的铅笔停在空白处。","a":"画出自己的随身工具","b":"请纸灵再添一笔"},{"title":"风大的门口","text":"纸偶站在门边欣赏落叶，一阵风把它吹得贴上门框。陆衡赶来扶稳，纸偶却说刚才看见了屋檐背面的花纹。你拿来压脚的小底座，纹路刚好像一双圆鞋。","a":"给纸偶试穿底座","b":"画下它看到的屋檐"},{"title":"学写回信","text":"家人寄来的信提到一座开满花的山坡，纸偶也想写回信。它握笔时总把笔杆抱得太紧，纸上画出一道深痕。你将细笔放到它面前，闻鹊替它扶住信纸。","a":"示范轻握笔杆","b":"请纸偶先口述内容"},{"title":"袖口修补","text":"纸偶的袖口磨出了毛边，补缝匠准备替它加一层柔软衬纸。纸偶挑了半天，选中一张带雨点纹的纸。你把旧袖轻轻展开，看见它保存了一片极小的竹叶。","a":"贴好雨点衬纸","b":"替它取出竹叶"},{"title":"纸鹤的来路","text":"门口纸鹤每天都朝同一扇窗转头，闻鹊想知道是不是受光影响。沈灯把小灯移向另一侧，纸鹤迟疑片刻，翅膀也跟着偏转。你在桌面标出几处照明位置。","a":"逐处移动小灯","b":"记录纸鹤转头的角度"},{"title":"茶室小座","text":"沈灯给纸偶准备的座椅太高，它坐下后碰不到茶桌。少年用厚纸折了一只小台阶，纸偶认真爬上去试坐。你从侧面看，台阶的底脚还没完全展开。","a":"压平台阶底脚","b":"重新量取桌椅高度"},{"title":"雨天借伞","text":"纸偶想去书房，却站在屋檐下看着细雨犹豫。家人留下的小纸伞已涂过蜡，闻鹊正在检查伞骨。你蹲在门边，发现石路水洼比纸偶的鞋还深。","a":"陪纸偶走廊下长路","b":"铺好跨水的小木片"},{"title":"晚归的纸影","text":"纸偶从书房回来得比平时晚，手里抱着一张画满星星的纸。它说窗玻璃里的倒影让自己看入了迷。沈灯替它擦干鞋底，你把桌边小灯挪近一点。","a":"听纸偶讲窗里的星光","b":"帮它挂好星星画"},{"title":"纸偶的小箱子","text":"工坊给纸偶做了一只旅行箱，里面只能放几张薄纸。它把竹叶、回信和袖口旧纸排成一列，认真想着如何叠放。你找到一个小信封，恰好能装那片竹叶。","a":"把竹叶装入小信封","b":"给箱底铺上软纸"},{"title":"冬晨开店","text":"年轻店主第一次独自整理冬季货架，标签被冷风吹得翻来覆去。你帮他扶住门，发现新纸都比夏天干脆。角落一只旧暖箱已经清空，等着放入怕潮的材料。","a":"整理纸张存放位置","b":"给货架标签加夹子"},{"title":"寄来的雪景","text":"远行的家人寄来雪山画，蓝灰色阴影让纸面像有了温度。画册整理员想把它放进冬景章，闻鹊则想折一座相似的山。你端详山脚的小屋，认出门前挂着纸灯。","a":"把雪景收入画册","b":"试折画中的山形"},{"title":"封面压花","text":"旅行画册只剩封面未定，店主摆出布纹纸、花瓣纸和朴素牛皮纸。补缝匠提醒你画册以后会经常翻看，手指沿着书角轻轻拂过。纸偶已经选好一枚细小压花。","a":"试包布纹封皮","b":"摆放封面压花"},{"title":"纸桥换篷","text":"入冬后桥篷变得发脆，维修师拆下一角检查，里面夹着旧的修补日期。陆衡带来新篷纸，沈灯在桥头摆好热茶。你将旧篷卷起，发现阳光穿过的小孔像散开的星点。","a":"帮忙铺开新篷纸","b":"截取旧篷留样"},{"title":"结霜的玻璃","text":"书房玻璃结了一层薄霜，纸灵在窗边画出的线像叶脉。园艺师辨认后笑着说，真实叶子的分叉还要更细。你将画册摊在窗下，霜花已经开始融成水珠。","a":"速写玻璃霜花","b":"擦干窗台水迹"},{"title":"没寄出的信","text":"闻鹊整理抽屉，发现自己夏天写了一半的信，里面提到的纸景如今已经做完。她想续写又怕太长，沈灯便给她添了张薄纸。你看见旧信末尾画着那座梦里的桥。","a":"陪闻鹊整理近况","b":"画一张纸景小图"},{"title":"画页的背面","text":"最后几张画页背面各有一个小圆点，纸灵把它们依次连起，竟像一条散步路线。整理员翻来覆去地看，发现圆点所在位置对应几处常见风景。窗外钟声轻轻响过。","a":"按圆点位置排列画页","b":"把路线描在薄纸上"},{"title":"沿图散步","text":"你和伙伴照着图走过温室、茶室和竹林，最后停在一块可以俯瞰小镇的石头旁。冬日斜阳照着屋顶，折光工坊的高窗格外明亮。纸偶打开小箱，取出一路保存的竹叶。","a":"画下此处的屋顶","b":"陪纸偶摊平竹叶"},{"title":"图册署名","text":"画册的最后一页准备记下参与制作的人，纸灵在自己的位置画了一圈波纹。少年说自己还不擅长写字，想画一只歪燕子。你拿来细笔，桌边挤满了认真描画的手。","a":"画上自己的工具","b":"给末页加上日期"},{"title":"一次慢慢翻阅","text":"沈灯端来热茶，大家围着新画册从头翻起。纸偶每看到熟悉地方都要停一下，陆衡则反复摸那页补好的书脊。你发现最初觉得不起眼的细节，如今都能讲出小故事。","a":"朗读春页的记录","b":"听伙伴讲纸景里的小椅子"},{"title":"留白的冬页","text":"画册末尾还有一页空白，整理员没有急着补满，只在页角写下冬日日期。外面雪花刚落，温室里仍有小花。闻鹊把铅笔放到你手边，纸灵也抬头等着。","a":"画下窗外初雪","b":"在页角写一句问候"},{"title":"新的折痕","text":"来年第一批纸送进工坊，你拆开包裹，看见一种从未用过的柔软纤维纸。少年已经能独自折好小燕子，想试试更大的翅膀。你翻开新的练习本，纸面有淡淡草香。","a":"裁一张新纸试折","b":"把纸样收入样本夹"}],"endings":[{"title":"茶室里的纸世界","text":"你和伙伴把纸桥茶室布置成常换常新的小展间。有人添一只纸鹤，有人带来一张叶拓，桌边总留着喝茶的位置。纸偶喜欢向客人介绍那把湖边小椅子，讲累了就坐在纸台阶上。你收拾茶杯时，仍会发现某张画旁多了一笔可爱的改动。","hint":"支持项（每项一分）：第1节点「帮助遇到困难的旅伴」、第4节点「加入纸桥茶室」、第5节点「送出备用材料」、第6节点「照顾同行者」、第8节点「协调纸桥茶室与折光工坊，整理出行路线」；第一、二幕各至少一项；公共结算：每方向至少命中两项不同早期行动，且第一、二幕各有支持；优先兑现第三幕声明的已形成方向，否则按命中数降序；同分按结伴生活、日常经营、收拾行囊、整理见闻、长久休养、安住小屋顺序。无方向形成才兜底安住小屋。身份、关系、秘密满足原条件时优先，不满足则按此公共比较结算。"},{"title":"工坊的晨光","text":"你在折光工坊安顿下来，每天打开高窗，检查纸张与灯架。订单多时，桌面常被样纸铺满，你学会按材料干燥的时间安排工作。傍晚收工，略扁的圆灯依然挂在窗边。它后来有了一个好记的名字，叫作慢慢圆。","hint":"支持项（每项一分）：第1节点「整理行程，联系折光工坊」、第4节点「加入折光工坊」、第5节点「准备折光工坊应急储备」、第6节点「独自前往折光工坊」、第8节点「收好笔记，拜访折光工坊」；第一、二幕各至少一项；公共结算：每方向至少命中两项不同早期行动，且第一、二幕各有支持；优先兑现第三幕声明的已形成方向，否则按命中数降序；同分按结伴生活、日常经营、收拾行囊、整理见闻、长久休养、安住小屋顺序。无方向形成才兜底安住小屋。身份、关系、秘密满足原条件时优先，不满足则按此公共比较结算。"},{"title":"画册里的下一站","text":"你带着修好的旅行册离开小镇，继续寻找没画过的风景。纸偶偶尔随行，把沿路的落叶收进小箱。每到一处，你先找能坐下喝茶的地方，再展开画纸。寄回书房的信越来越厚，闻鹊总说下一卷已准备好封面。","hint":"支持项（每项一分）：第3节点「使用随身工具」、第4节点「加入纸桥茶室」、第6节点「离开同行者」、第7节点「收起工具休息」、第8节点「协调纸桥茶室与折光工坊，整理出行路线」；第一、二幕各至少一项；公共结算：每方向至少命中两项不同早期行动，且第一、二幕各有支持；优先兑现第三幕声明的已形成方向，否则按命中数降序；同分按结伴生活、日常经营、收拾行囊、整理见闻、长久休养、安住小屋顺序。无方向形成才兜底安住小屋。身份、关系、秘密满足原条件时优先，不满足则按此公共比较结算。"},{"title":"风物书房的新架","text":"你将纸张样本、修书笔记与风景画逐一整理，放进书房新做的矮架。来看的人可以先摸材料，再读制作过程。那些失败的试折也留在夹层里，纸边还带着你的指痕。你很喜欢看新手翻到它们时松一口气，然后拿起自己的纸。","hint":"支持项（每项一分）：第1节点「保存样本并观察」、第4节点「加入风物书房」、第5节点「展示采集的样本」、第8节点「与伙伴核对记录」；第一、二幕各至少一项；公共结算：每方向至少命中两项不同早期行动，且第一、二幕各有支持；优先兑现第三幕声明的已形成方向，否则按命中数降序；同分按结伴生活、日常经营、收拾行囊、整理见闻、长久休养、安住小屋顺序。无方向形成才兜底安住小屋。身份、关系、秘密满足原条件时优先，不满足则按此公共比较结算。"},{"title":"把手放暖","text":"一段密集制作后，你暂时难以完成细小折叠。沈灯把温热的茶杯放到你手边，伙伴们接着修整未完成的灯。你改为讲述画册的来历，偶尔只在页角轻轻添一笔。等到手慢慢恢复，窗外已经换季，你从一只最简单的小船重新折起。","hint":"支持项（每项一分）：第3节点「练习自己的手艺」、第6节点「照顾同行者」、第7节点「继续练习手艺」、第7节点「集中使用天赋」；第一、二幕各至少一项；公共结算：每方向至少命中两项不同早期行动，且第一、二幕各有支持；优先兑现第三幕声明的已形成方向，否则按命中数降序；同分按结伴生活、日常经营、收拾行囊、整理见闻、长久休养、安住小屋顺序。无方向形成才兜底安住小屋。身份、关系、秘密满足原条件时优先，不满足则按此公共比较结算。"},{"title":"小店窗边","text":"你成了文具店窗边的常客，帮忙整理纸样，也给来学折纸的孩子找材料。并非每一天都有新作品，有时只是陪店主擦擦架子。雪天窗上的霜花很美，你把它画在一张便签背面。那张便签后来夹在账本里，每次翻到都像冬天又来了一小会。","hint":"支持项（每项一分）：第3节点「使用随身工具」、第4节点「加入纸桥茶室」、第5节点「送出备用材料」、第7节点「收起工具休息」、第8节点「协调纸桥茶室与折光工坊，整理出行路线」；第一、二幕各至少一项，或所有公共方向均未形成时兜底；公共结算：每方向至少命中两项不同早期行动，且第一、二幕各有支持；优先兑现第三幕声明的已形成方向，否则按命中数降序；同分按结伴生活、日常经营、收拾行囊、整理见闻、长久休养、安住小屋顺序。无方向形成才兜底安住小屋。身份、关系、秘密满足原条件时优先，不满足则按此公共比较结算。"},{"title":"游记誊写人","text":"你把抄录游记的手艺练得清楚稳当，也学会留意作者说话的节奏。遇到难认的地名，你会画出周围的山水再询问。年老旅人收到誊好的册子，常在茶室坐着读很久。你继续磨墨，听纸页翻动，偶尔抬头看他们想起了什么。","hint":"以「替旅人誊写游记的抄录师」开局；第一幕研习身份技艺；第二幕继续研习；第三幕整合技艺；身份技艺达到 3；合作小组支持至少 4，技艺有实际服务对象；天赋负担不超过 6；终幕选择「以身份技艺服务合作小组」。"},{"title":"温室的纸标签","text":"你熟悉了香草的气味，也做出了耐潮却容易替换的植物标签。温室里的试种记录越来越完整，少年终于不再天天扒开盆土。冬天最冷的时候，你仍能在叶间找到一朵小花。你把落下的花瓣制成纸，夹进自己的园艺册。","hint":"以「照看温室香草的园艺师」开局；第一幕研习身份技艺；第二幕继续研习；第三幕整合技艺；身份技艺达到 3；合作小组支持至少 4，技艺有实际服务对象；天赋负担不超过 6；终幕选择「以身份技艺服务合作小组」。"},{"title":"书脊中的针路","text":"你的补缝手艺逐渐细致，旧书重新摊开时，手掌能感觉到平稳的书脊。你总把拆下来的线留给主人，再附一张修整记录。偶尔有人回来，只为告诉你书又读完了一遍。你听完便很满足，继续给下一本书穿好第一根线。","hint":"以「修复书脊的补缝匠」开局；第一幕研习身份技艺；第二幕继续研习；第三幕整合技艺；身份技艺达到 3；合作小组支持至少 4，技艺有实际服务对象；天赋负担不超过 6；终幕选择「以身份技艺服务合作小组」。"},{"title":"一盏轻响的灯","text":"反复制作后，你能从轻响判断灯纸是否绷得合适。工坊的人有时会闭眼听你检查灯罩，随后一起笑起来。那盏叶脉灯一直留在书房，换过灯芯，纸上的细纹却依然清楚。你常在它旁边画新草图，把傍晚延长一点。","hint":"以「听得出灯纸轻响的制灯学徒」开局；第一幕研习身份技艺；第二幕继续研习；第三幕整合技艺；身份技艺达到 3；合作小组支持至少 4，技艺有实际服务对象；天赋负担不超过 6；终幕选择「以身份技艺服务合作小组」。"},{"title":"梦景收藏盒","text":"你继续画梦，却不再急着补齐醒来后忘掉的细节。茶杯树旁后来添了纸桥和一只看书的羊，都是朋友留下的想象。每个透明盒底都放着最初草图。来访者能看到一场模糊的梦怎样慢慢成为可以绕着观看的风景，你也时常感到惊喜。","hint":"以「收藏梦境图画的夜市画师」开局；第一幕研习身份技艺；第二幕继续研习；第三幕整合技艺；身份技艺达到 3；合作小组支持至少 4，技艺有实际服务对象；天赋负担不超过 6；终幕选择「以身份技艺服务合作小组」。"},{"title":"纸桥上的脚步","text":"你熟悉纸篷、竹架与接缝的脾气，按季节给桥做细致检查。沈灯总在你忙完后留一杯茶，陆衡偶尔陪你数旧篷上的小孔。后来换下的篷纸做成了一幅星图，挂在工坊廊下。雨天走过桥，你听着雨声，知道每一段回响来自哪里。","hint":"以「巡看纸桥的维修师」开局；第一幕研习身份技艺；第二幕继续研习；第三幕整合技艺；身份技艺达到 3；合作小组支持至少 4，技艺有实际服务对象；天赋负担不超过 6；终幕选择「以身份技艺服务合作小组」。"},{"title":"羊毛与花纸","text":"你仍在郊外照看绵羊，闲时把梳下的软毛送到工坊试纸。纸浆与纤维需要慢慢调，成品有些粗糙，却十分温暖。你用它写下牧场的四季，画羊群睡觉时的模样。书房借走那本册子后，来郊外散步的人常会认出其中一只卷毛羊。","hint":"以「在郊外照看绵羊的牧人」开局；第一幕研习身份技艺；第二幕继续研习；第三幕整合技艺；身份技艺达到 3；合作小组支持至少 4，技艺有实际服务对象；天赋负担不超过 6；终幕选择「以身份技艺服务合作小组」。"},{"title":"一间有草香的店","text":"你接手的旧文具店渐渐有了自己的样子。货架按纸的触感与用途摆放，柜台边常备着可试折的小片。你仍珍惜旧店主留下的尺子，也把新纸样装进新的夹子。关门前有人匆忙来找一张写信纸，你总愿意陪他多挑一会。","hint":"以「接手旧文具店的年轻店主」开局；第一幕研习身份技艺；第二幕继续研习；第三幕整合技艺；身份技艺达到 3；合作小组支持至少 4，技艺有实际服务对象；天赋负担不超过 6；终幕选择「以身份技艺服务合作小组」。"},{"title":"闻鹊寄来的折角","text":"你和闻鹊一直保持往来，信里常夹着新学的折角。忙时只寄一只小燕子，空下来便写长长几页。重逢时你们沿纸桥散步，比较谁的纸船漂得更稳。那条散步路线早已走熟，却仍会因为一片新叶停下。","hint":"第一幕与闻鹊相识；第一幕结识的人，在第二幕获你保护，第三幕仍守约（信任至少 5）；终幕选择「将共同生活置于远行计划之前」。"},{"title":"沈灯留着热茶","text":"你陪沈灯照看茶室，她也陪你度过做不出作品的日子。晚上收好杯盏，你们并排检查廊下灯纸，轮流讲白天听见的小事。有时谁也不说话，只看纸鹤随着光转头。茶壶空了便添水，日子就这样一杯一杯往前走。","hint":"第一幕与沈灯相识；第一幕结识的人，在第二幕获你保护，第三幕仍守约（信任至少 5）；终幕选择「将共同生活置于远行计划之前」。"},{"title":"和陆衡再试一次","text":"你与陆衡总对折法有不同偏好，一个喜欢轻巧，一个在意结实。后来你们做了一张可更换部件的纸景桌，各自添上拿手的一角。遇到不合适的地方，便拆开重新试。那张桌子用了很多年，底下还夹着最初没折稳的燕子。","hint":"第一幕与陆衡相识；第一幕结识的人，在第二幕获你保护，第三幕仍守约（信任至少 5）；终幕选择「将共同生活置于远行计划之前」。"},{"title":"回家的信纸","text":"你与远行的家人约好，见到漂亮风景便留一张小画。聚在一起时，桌上常铺满各种大小的纸，先从哪张讲起都可以。冬日你们同去温室，看见曾写在信里的花终于开放。你把那一刻画下来，放进家人随身的册子。","hint":"第一幕与远行的家人相识；第一幕结识的人，在第二幕获你保护，第三幕仍守约（信任至少 5）；终幕选择「将共同生活置于远行计划之前」。"},{"title":"少年长大的燕子","text":"学折纸的少年后来能折出灵活转向的燕子，还教会了更小的孩子。你们偶尔翻看他最早的练习，歪斜折痕已经软得发白。他没有丢掉那只侧倒的鸟，而是替它做了个合适底座。你们把它放在书房窗边，一起看真正的燕子掠过屋顶。","hint":"第一幕与学折纸的少年相识；第一幕结识的人，在第二幕获你保护，第三幕仍守约（信任至少 5）；终幕选择「将共同生活置于远行计划之前」。"},{"title":"画册背面的散步","text":"你把茶室旧图与工坊记录放在一起，发现背面的圆点原来是一种记录观景位置的方法。沿图走到山坡时，所有熟悉屋顶恰好组成画册封面的轮廓。你将发现补写在末页。后来每逢晴天，总有人带着画册去那里，画出稍有不同的小镇。","hint":"前局发现「public.rescue」；前局发现「public.rule」；第一幕寻找异常的起因；第二幕与各组伙伴交流；收集至少两份线索；终幕选择「用旧日发现串联见闻」。"},{"title":"第一片花瓣纸","text":"重拾修书练习时，你和闻鹊发现封皮里的花瓣纸出自早年的温室试作。纸上极细的羊毛又把线索带到郊外，牧人找出当时留下的样本。你们没有完全复原旧配方，却做出了新的柔软纸。第一张晾干后，你用它写了封感谢朋友的信。","hint":"前局发现「identity.1」；前局发现「relationship.1」；第一幕重拾技艺；第二幕继续研习；第一幕结识的人，在第二幕获你保护，第三幕仍守约（信任至少 5）；终幕选择「承接前世身份与未竟承诺」。"},{"title":"尚未折起的纸","text":"你休养时，沈灯送来一张很大的空白纸，让你随意画画。纸灵绕着边缘走了一圈，只添上一个小圆点。你终于想到，纸不必每次都变成复杂作品。后来你把它铺在茶桌上，朋友陆续留下叶拓、茶圈与几句问候，它便成了一幅缓慢完成的生活图。","hint":"前局发现「public.sacrifice」；前局发现「relationship.2」；第一幕结识的人，在第二幕获你保护，第三幕仍守约（信任至少 5）；第二幕停止透支；第三幕接受能力限制；终幕选择「以旧日关系记忆调整天赋的用法」。"}],"turns":{"calling":{"title":"一排空灯骨","text":"沈灯把工坊的旧灯样交给你看，邀你接学会随光线展开的折灯。每年冬市前都得反复试折，不能长时间离开工台。画册整理员正在招随行抄录师，愿教你把途中风景整理成书，两份工作都要从头练熟。","options":[{"label":"接下旧灯样，留在工坊学制灯","aftermath":"五年后，冬市里卖着你设计的双层折灯，闭店后你仍要逐盏校验展开的时刻。旅行画册留在最初那页风景上；工坊最靠窗的灯架如今专放你的试样，沈灯每年都来那里挑一盏。"},{"label":"归还旧灯样，改做随行抄录师","aftermath":"五年后，你整理的第一套沿途图册放进了镇上的书店，书脊印着你的署名。旧灯样传给了留坊的学徒；你长期带着防潮书匣出工，冬市开灯时常还在外地核对地名。"}]},"bond":{"title":"闻鹊的新折痕","text":"闻鹊在修纸桥时伤了筋骨，医师要他长期减少独行和搬运。他想与你共住一处，请你陪他往返工坊、安排每天的杂务；若你仍要远行，他可以搬去有轮值照护的亲友家。桌上纸鸟只折到一半，旁边是你尚未打包的旅行画册。","options":[{"label":"留下与闻鹊同住，承担日常照护","aftermath":"四年后，你们从住处到工坊的路上多了三处熟悉的歇脚点，你每天按闻鹊的步调安排出门。你的长途画册四年未添异乡风景；窗台却排满他在休养间隙折成、由你逐只标注日期的纸鸟。"},{"label":"送闻鹊去亲友家，带画册独自远行","aftermath":"四年后，闻鹊的亲友接续了陪行，你们分别那只半成的纸鸟仍夹在你的第一页画册里。后面的纸页已画满外乡桥梁；你习惯独自寻找住处，遇见适合歇脚的平台也只能画下来寄给他。"}]},"home":{"title":"檐下的晒纸绳","text":"旧文具店楼后空着一间防潮小屋，店主愿按你的需要添遮光帘与支架，长租住户则要轮流照看晒纸院。旅行画册里的海边小镇也回了信，那里有一处可以迁入的住所，窗外的光与这里很不一样。","options":[{"label":"住进防潮小屋，在镇上扎根","aftermath":"六年后，你窗外的晒纸绳已经换过三次，每次骤雨都是邻居和你一起收纸。你把远行积攒的钱用来加修遮雨檐；文具店的孩子从识字起就知道，那扇帘后住着替他们保存旧画的人。"},{"label":"收好画册，迁居海边小镇","aftermath":"六年后，你住处的窗帘缝进了专门调柔海面反光的纸层，门后常备防潮匣。原来的小屋改成了文具店库房；你重新学会当地的晒纸时辰，寄回旧镇的第一册新画全是从自家窗前看到的潮水。"}]}},"episode":{"title":"夜班守则没有第九条","source":"web-original","opening":{"title":"玻璃后的新字","text":"折纸小镇的旧商场是用一整张夜色纸折出来的。日班刚走，橱窗里的灯就亮了。你接下废弃商场的夜间盘点，领班锁门前只说：守则八条，照做就能下班。午夜，值班室玻璃上却慢慢浮出第九条：穿红鞋的同事不是人。与你搭班的女孩恰好穿着红鞋，她正端着两杯热水走来。对讲机催你把她关进冷库，你低头看见玻璃上的字没有倒影，领班的声音也没有换气。","a":"用袖口擦掉玻璃上的字","b":"把对讲机放到女孩面前","attributes":["实力","羁绊"]},"followups":[{"title":"字是从里面写的","text":"字擦不掉，玻璃里面却浮出一张贴紧的脸。女孩抓住你的手，说她昨日也看见过第九条，鞋上的红色是标记库存的油漆。墙上旧照片证明她确是员工，对讲机却突然用你的声音喊她开门。你们翻出原版守则，最后一条写着：盘点结束，归还所有多出的货物。玻璃后的脸缓缓笑了。","a":"给值班室玻璃贴上退货签","b":"把对讲机放进退货箱","attributes":["理智","资源"]},{"title":"领班正在柜子里","text":"女孩没有碰对讲机，只敲了三下储物柜。柜内传出同样三响，真正的领班被你们拖出来，嘴上封着价签。他撕下胶纸，指向对讲机：昨夜少收了一件退货，它就开始替我上班。广播忽然宣布闭店，所有卷帘门一起下落。柜底有一张作废收据，服务台的退货铃却还在黑暗中轻轻摇晃。","a":"把作废收据塞进广播插口","b":"拿起对讲机走到退货台","attributes":["理智","命势"]}],"codas":["退货签贴牢，玻璃连同那张脸缩成包装板。天亮收货车拖走它，你和女孩领到夜班工资。她把红鞋刷成白色，陪你去街角吃了一顿热早饭。","箱盖合上，广播恢复了正常时间。你们走出商场，手机却响起自己的声音：漏盘一件，你的影子。路灯下，女孩已经停步，你脚边果然空空荡荡。","收据上的作废章沿电线亮起，广播读完撤销通知，卷帘门缓缓升起。领班将商场永久停业的旧文件交给你们，再无人被派来完成这场过期盘点。","你摇响退货铃，对讲机吐出一枚工牌，失踪多年的收货员从柜后跌出来。多出的原来是他的声音。人货终于核对齐全，商场第一次准点亮起晨灯。"]}},{"id":"w7","name":"星海漫游","premise":"旅行船澄海号沿着星图慢慢航行，你和伙伴照看温室、修整设备、记录沿途奇景。船载AI可以使用检修机行动，温室菌群也会借培养车参与这场漫长旅行。","factions":{"commons":"星窗茶室","council":"漫游工作室","archive":"航迹书房"},"fate":{"characters":["一起看星的旅伴","薄膜研究导师","爱改图纸的朋友","共同养育孩子的家人","准备去地面旅行的亲人","航迹记录员"]},"origins":["安排观星行程的旅行向导","听得懂炉鸣的动力技师","照看温室土壤的种植员","修复旅行影像的记忆修复师","熟悉回收管道的机械学徒","照顾长途旅客的船医","从星外采样归来的领航员","整理旧地球行李的收藏家","借检修机游览船舱的旅行船AI","借移动培养舱行动的温室共生菌群"],"events":[{"title":"登船的杯垫","text":"你走进澄海号的星窗茶室，桌上每只杯垫都画着不同星座。旅伴把靠窗的位置让出一点，远处星光缓缓滑过。向导递来一本空白航行册，封面还带着新布的气味。","a":"挑一张星座杯垫","b":"翻开空白航行册"},{"title":"会打招呼的车","text":"一辆检修机停在行李旁，用熟悉的声音向你问好。船载AI说它刚换了轮胎，想试试地毯上的转弯。你发现行李带垂在轮子边，机器的镜头正好奇地左右摆动。","a":"收起垂落的行李带","b":"陪检修机绕过地毯"},{"title":"窗上的蓝点","text":"星窗玻璃映出一个淡蓝点，旅伴以为是遥远星体，记录员却说可能来自舱内灯光。你转动桌灯，蓝点也轻轻挪动。窗外真正的星光仍停在更远的位置。","a":"关小桌灯再观察","b":"描下窗外星体位置"},{"title":"第一顿船餐","text":"餐厅端出温室蔬菜做的浓汤，香味与你熟悉的地面做法不同。厨师说叶菜长在特制基质里，收获时比预计更嫩。你在碗边发现一小片红色叶梗。","a":"尝尝红梗叶菜","b":"向厨师询问调味"},{"title":"行李里的泥土","text":"收藏家打开行李，里面有一小瓶地球花园的干土。种植员想借一点观察颗粒，收藏家却先问能否不打碎结块。你取来透明浅盘，土块表面有细细根痕。","a":"把土块放上浅盘","b":"拍下土块表面纹理"},{"title":"走廊里的回声","text":"茶室通往温室的走廊总有轻微回声，孩子拍一下手，便兴奋地听它返回。导师说弧形墙面让声音集中，朋友想试着做张声响地图。你拿着记录板站在转角。","a":"在不同位置轻拍手","b":"记下回声较清楚的位置"},{"title":"晚安灯的亮度","text":"新客房的晚安灯照得枕边太亮，旅伴翻来覆去睡不安稳。你调出灯罩样式，AI说还可以转动底座。窗帘边缘留着一点缝，外面是安静的深蓝色航行光。","a":"转动晚安灯底座","b":"拉好窗帘边缘"},{"title":"观星时间表","text":"向导安排了两次观星活动，一次看环状云带，一次看稀疏流星。家人担心孩子熬得太晚，记录员便拿来回放画面。你看着时间表，发现休息栏还空着。","a":"圈出适合的观星时段","b":"整理观星回放画面"},{"title":"旧星图的折线","text":"航迹书房保存着一张纸质星图，折线正好穿过几个星名。记录员请你帮忙展开，收藏家拿来柔软托板。你发现图角画着一只小茶杯，像某次旅途的随手涂鸦。","a":"把星图铺在托板上","b":"抄下折线旁的星名"},{"title":"舷窗清洁日","text":"检修机擦过舷窗，仍留下一道细细弧痕。AI说清洁垫刚换过，可能有一侧没装平。旅伴站远些看，发现弧痕只在斜光下明显。你取来备用软垫。","a":"重新安装清洁垫","b":"检查舷窗斜光反射"},{"title":"行程中的空白","text":"向导留出一天不安排活动，让大家自行在船上走走。你经过温室，看见菌群的培养车正停在香草架旁，灯点忽明忽暗。种植员说它们今天似乎对薄荷很感兴趣。","a":"陪培养车观察薄荷","b":"去书房翻看旅行影像"},{"title":"离岸后的早晨","text":"澄海号离开熟悉的星港，餐厅里仍像昨日一样飘着烤面包香。你在航行册第一页写下日期，旅伴把杯垫夹在旁边。检修机从门口经过，向你播放了新学会的鸟鸣。","a":"写下清晨的声音","b":"同旅伴分一份早餐"},{"title":"土壤的气味","text":"温室翻盆时散出湿润泥土味，收藏家闭眼闻了很久。种植员想比较不同基质的含水情况，几只样盆已经排好。你伸手触摸盆沿，发现靠灯的那盆明显温些。","a":"测量各盆温度","b":"记录基质的湿润程度"},{"title":"不发芽的豆子","text":"同批豆种有一盆迟迟没动静，孩子天天来数土面的小点。种植员检查播种深度，发现这一盆覆土稍厚。你翻开记录，其他条件看起来并没有明显差别。","a":"轻轻拨薄表层土","b":"继续记录各盆变化"},{"title":"漂浮的小水珠","text":"浇水管接口渗出水珠，贴着盆架慢慢滚动。机械学徒拿布吸水，种植员先把附近电器移开。你看见接头上的密封圈有些扭曲，新的零件就在抽屉里。","a":"换好接头密封圈","b":"擦干盆架水迹"},{"title":"番茄的方向","text":"几株番茄都向同一侧弯，照明板明明悬在正上方。导师检查反光膜，发现旁边新装的银色箱子照亮了侧叶。你搬来小推车，箱底划过地面时发出轻响。","a":"挪开银色箱子","b":"记录枝叶弯曲方向"},{"title":"人工清晨","text":"温室灯光的渐亮程序刚换过，叶片上的露珠比以前少。种植员请你查看夜间温度曲线，AI同时调出旧记录。你发现灯光开始升亮的时间提前了一点。","a":"比较新旧温度曲线","b":"调整试验区的照明时刻"},{"title":"授粉小刷","text":"一把小刷在花间轻轻晃动，孩子学着给温室作物授粉。种植员提醒他花粉很细，不必用力拍打。你拿着放大镜，看见花瓣边缘有一圈透明水珠。","a":"示范轻触花心","b":"观察花粉的形状"},{"title":"培养车转弯","text":"菌群想移到另一排植物旁，培养车却被外伸的盆托卡住。AI的检修机赶来查看，两辆小车的灯互相闪了几下。你发现盆架下的通道刚好少了一点宽度。","a":"收回外伸的盆托","b":"给培养车量取通道"},{"title":"叶片上的银斑","text":"一片叶子出现银色斑点，导师拿到灯下看，发现表面覆着薄薄干燥水痕。种植员仍想确认叶背情况，递来观察镜。你轻轻转动叶柄，银斑随角度变化明暗。","a":"擦拭一处水痕","b":"查看叶片背面"},{"title":"收获篮太满","text":"第一批小番茄熟了，孩子把收获篮装得高高的，底层果子挤出一点汁。厨师正推着浅盘过来，想先挑适合做沙拉的。你闻到鲜甜气味，手指也沾上果汁。","a":"把番茄分放进浅盘","b":"清洗压软的番茄"},{"title":"种子晾架","text":"种植员准备留下种子，晾架上铺着吸水纸。培养车停得太近，小风扇把几颗种子吹到了架边。菌群闪起灯点，像在提醒你看。你拿起一只干净镊子。","a":"收拢架边种子","b":"调整小风扇方向"},{"title":"一小块麦田","text":"温室的试种小麦开始抽穗，收藏家把地球田野照片放在盆旁。两边看起来相似，种植员却能指出许多细节。你蹲下来，注意到茎秆比照片里的短，也更密。","a":"测量麦秆高度","b":"拍下麦穗近景"},{"title":"温室晚餐","text":"厨师将收获做成一桌小菜，菜单旁标着种植日期。大家尝着同一盆豆子做的汤，孩子认真数着碗里的豆粒。培养车停在灯光柔和的角落，菌群的亮点像细星。","a":"写下各道菜的滋味","b":"给培养车调暗照明"},{"title":"炉鸣的节拍","text":"动力技师请你在观察窗外听一段炉鸣，低低的声音很有节奏。最近换了减震垫，他想确认听感是否改变。你隔着玻璃看见指示灯平稳闪动，手中记录器已经打开。","a":"录下新的炉鸣","b":"比对上次声音记录"},{"title":"松动的杯架","text":"茶室杯架在轻微振动中碰出响声，技师找到一颗松动螺钉。朋友觉得可以顺便给杯口加软圈，桌上已摆好样件。你扶住杯架，听见杯子渐渐安静下来。","a":"拧紧杯架螺钉","b":"给杯槽放入软圈"},{"title":"换下的滤网","text":"循环风机换下的滤网上沾着细小绒毛，机械学徒想知道它们从哪里来。AI调出附近走廊的清洁记录，收藏家的毛毯正好在那里晒过。你把滤网放进观察袋。","a":"查看绒毛纤维","b":"核对清洁记录"},{"title":"拐角里的小轮","text":"检修机转弯时总有一个轮子打滑，AI说自己已经试过几种速度。学徒把机身停到检修垫上，发现轮缝里夹了一截包装线。你用镊子碰到线头，它还绕得很紧。","a":"挑出轮缝包装线","b":"检查其余轮子的纹路"},{"title":"薄膜的彩虹","text":"导师将新反光膜举到灯前，表面浮起彩虹般的色带。朋友想把它贴在观景窗边做装饰，导师先递来几片边角料。你看到不同厚度的膜呈现了不同颜色。","a":"排列薄膜试片","b":"记录色带随角度的变化"},{"title":"热水慢了一点","text":"茶室热水机比平时出水慢，深色的陶杯已经摆满桌面。技师拆开可清洗的出水口，发现积了一层浅色水垢。你取来软刷，旁边的水盆已经放温。","a":"刷洗出水口","b":"擦净热水机外壳"},{"title":"夜间小嗡声","text":"一间客房的墙边有轻微嗡声，旅伴觉得像蚊子。学徒顺着声音查看，发现是书架脚贴着通风罩。你把书挪到床上，书架终于能移动一点。","a":"挪开书架底脚","b":"在接触处垫软片"},{"title":"工具的颜色","text":"维修抽屉里的扳手大小相近，学徒找工具时常拿错。朋友拿来耐磨色套，想按尺寸套在柄上。你把工具排成长列，发现有两把其实是同一规格。","a":"给扳手套上色环","b":"整理重复的工具"},{"title":"模拟舱试坐","text":"新做的观景椅能随视角微微倾斜，亲人坐上去却觉得脚踏太短。向导请她慢慢描述，朋友拿笔改草图。你站在椅侧，看到她脚跟悬着一小截。","a":"调整脚踏长度","b":"记录亲人的坐姿"},{"title":"冷却管的雾","text":"观察室一段冷却管外结出薄雾，导师说先看看保温套是否移位。学徒掀起接口盖，发现固定带松了。你举灯照近，管壁上的小水珠像一串透明珠子。","a":"重新固定保温套","b":"吸干接口周围水珠"},{"title":"检修后的茶","text":"一轮检修完成，工具整齐躺回抽屉，技师终于来茶室坐下。他听见热水机恢复原来的出水声，笑着拍了拍杯子。你打开记录册，最后一项还等着写上检查日期。","a":"补写检修日期","b":"给技师倒一杯茶"},{"title":"声音样本库","text":"炉鸣、风机与热水机的声音收进书房，AI想给它们各取个容易记的名字。孩子说风机像海浪，技师却觉得像翻书。你播放了一遍，发现两种说法都有些道理。","a":"记录不同的声音联想","b":"给样本标注设备位置"},{"title":"模糊的生日影像","text":"收藏家拿来一段旧生日录像，画面边缘已经模糊。修复师想先保留原始片段，再尝试清晰处理。你看到桌上蛋糕的样子，却听不清唱歌的人在笑什么。","a":"整理原始影像副本","b":"标出需要修整的片段"},{"title":"颜色偏蓝","text":"修复后的花园照片显得过蓝，收藏家记得那天阳光很暖。修复师调出同批照片，发现扫描设置用错了色温。你拿来一张白纸作参照，屏幕上的花慢慢变回淡粉。","a":"核对扫描色温","b":"比对同批照片"},{"title":"断开的旋律","text":"旅行录音中一段口琴声突然中断，后半段只有脚步。记录员猜录音者转身走进了屋里，旅伴则想起一首相近的曲子。你把波形放大，断点旁还有轻轻的关门声。","a":"标记录音断点","b":"请旅伴哼唱那段曲子"},{"title":"相册里的空页","text":"家人的相册留着一页没有贴照片，只写着某次海边旅行的日期。她说那天相机忘了充电，记得的却格外多。你把画笔放到桌上，孩子先画出一只很大的贝壳。","a":"听家人讲那天的海风","b":"给贝壳画添上颜色"},{"title":"复制的星光","text":"一张观星照片出现两颗位置相同的亮点，朋友说可能是镜片反光。修复师调出连拍图，真正星体的移动轨迹很平稳。你看着叠在一起的图层，发现另一点总在对称位置。","a":"逐张比较亮点位置","b":"记录镜头反光特点"},{"title":"旧地球的雨声","text":"收藏家播放一段雨声，茶室忽然安静下来。有人听过真实的大雨，也有人只在影像里见过。你注意到录音末尾有一声碗碟轻碰，像有人在窗边吃饭。","a":"重复播放录音末段","b":"写下自己的雨声联想"},{"title":"纸信转成图","text":"一封旧信需要扫描存档，折痕遮住了几处笔画。修复师铺好平板灯，家人轻轻扶住纸边。你在屏幕上放大字迹，看见纸纤维里还有当年按笔留下的凹痕。","a":"调整扫描光线","b":"按段誊写信中文字"},{"title":"影像里的小狗","text":"孩子想知道旧录像里那只狗后来去了哪里，收藏家翻出另一盘生活记录。两段录像中的项圈颜色略有差异，修复师提醒大家先看日期。你在盒底找到一张手写便条。","a":"读出盒底便条","b":"排列录像日期"},{"title":"慢镜头的笑","text":"修复师把一段家人笑着奔跑的影像放慢，动作显得有点古怪。家人看了大笑，说还是原来速度自然。你把两段放在一起，旁边还留着音轨未作同步。","a":"恢复原有播放速度","b":"校对音画同步位置"},{"title":"未辨认的风景","text":"相册里有一张红土山坡，背面没有地点。领航员觉得像某颗旅行星，收藏家却说照片年代更早。你看见地平线上有一座奇特水塔，可能是辨认风景的线索。","a":"放大水塔轮廓","b":"查看相邻照片的日期"},{"title":"茶室放映夜","text":"修好的旅行影像投在茶室墙上，孩子不断指认白天见过的照片。收藏家坐在后排，偶尔补充画面之外的小事。你抱着记录板，却发现自己也忘了继续写字。","a":"听收藏家补述旅行细节","b":"记录放映中的时间标记"},{"title":"相册重新装盒","text":"影像整理完成，原始文件与修复版本都各自装好。收藏家把纸相册放回盒里，特意留出那页没照片的海滩。你在盒边贴上内容标签，手指闻得到旧纸的微香。","a":"整理版本说明","b":"给相册加上软衬"},{"title":"睡不着的旅人","text":"旅伴连续几晚睡得浅，船医请他描述白天喝茶和看屏幕的时间。你陪他坐在安静休息区，墙上的灯缓慢变暗。桌边放着温水，窗外暂时没有观星活动。","a":"陪旅伴记录作息","b":"倒一杯温水"},{"title":"窗前伸展","text":"船医在观景区带大家做简单伸展，孩子总忍不住去看窗外。家人把座椅往里转了些，给动作留出空间。你抬手时发现袖口卡在扶手边，便停了下来。","a":"整理座椅周围空间","b":"跟着船医缓慢伸展"},{"title":"新鞋磨脚","text":"准备地面旅行的亲人试穿新鞋，走了一圈就觉得脚跟发热。船医查看后建议先调整鞋带和衬垫。你拿出她旧鞋里的柔软鞋垫，放到新鞋旁边比较。","a":"调整新鞋鞋带","b":"陪亲人比较鞋垫"},{"title":"过敏的香味","text":"茶室换了一种香氛，旅伴闻到后不停打喷嚏。船医让他到无香的休息区坐会，向导拿走了香氛瓶。你留意到标签上写着几种从没见过的植物提取物。","a":"把成分标签交给船医","b":"陪旅伴到休息区"},{"title":"安静的小角落","text":"孩子在人多的活动室玩累了，想找一个没人说话的地方。家人带他来到窗边小凳，AI把附近提示音调低。你拿着故事册坐下，先翻到他喜欢的星空画。","a":"安静陪孩子看画","b":"整理凳边靠垫"},{"title":"慢一点的午饭","text":"导师最近忙着观察薄膜，午饭总吃得很快。船医提醒她留些休息时间，朋友便搬来一张小餐桌。你把热汤放稳，导师还在惦记窗边未收的样片。","a":"替导师收好样片","b":"陪导师慢慢吃午饭"},{"title":"体温计的小差别","text":"两支体温计测得结果略有不同，机械学徒以为设备坏了。船医说明测量位置与等待时间也要相同。你把说明书放到桌上，学徒认真找到了对应的小图。","a":"核对体温计使用步骤","b":"整理测量时间记录"},{"title":"睡眠舱的音乐","text":"休息区新添轻音乐，亲人说低音让她反而更难入睡。AI准备了几组音量样本，船医建议逐一短试。你坐在床尾，能感觉到靠墙处的振动稍明显。","a":"试播更轻的音量","b":"移动床边音箱"},{"title":"回来的一封消息","text":"旅伴收到家里的语音，听完后情绪有些低落。他说想念熟悉的厨房，又不好意思总向家人讲这些。你把茶杯放到他面前，等他慢慢把后半句话说完。","a":"听旅伴讲家里的厨房","b":"陪他录一段回信"},{"title":"采样后的休息","text":"领航员从外部采样舱回来，肩膀有些酸。船医请他先放下器材，技师帮忙检查背带长度。你接过样本箱，发现一侧背带比另一侧收得更紧。","a":"把样本箱放上推车","b":"协助调平背带"},{"title":"身体记录册","text":"船医给长途旅客准备了简洁的日常记录页，亲人想添一栏散步时看到的景色。孩子立刻画上温室番茄，大家笑着围过来。你看见空白处还容得下一行天气般的心情描写。","a":"在记录页画上散步路线","b":"写下今日的身体感受"},{"title":"一场普通午睡","text":"休息区的灯光终于调得合适，旅伴靠着软垫安稳睡着。你把半开的书收好，AI经过门口时放慢轮速。远处餐厅的铃声很轻，没有打破这片安静。","a":"把书放回床边架","b":"轻轻掩上休息区门"},{"title":"环形云带","text":"澄海号抵达一颗有环状云带的星体附近，观景窗前坐满了拿画笔的人。向导提醒大家留意明暗变化，云环转动得比想象慢。你发现最亮的一段带着浅淡杏色。","a":"画下云带明暗","b":"用相机记录云环"},{"title":"望远镜起雾","text":"观景室的镜片刚搬出储物箱，表面起了薄雾。领航员说温差还没散去，让大家先等一会。孩子靠着桌子看星图，你把镜头盖放到干净软布上。","a":"静置望远镜","b":"整理观测用的星图"},{"title":"转过来的地图","text":"朋友拿着新绘星图，总觉得左边星群应在右边。记录员发现图是从另一个观测方向绘的，便在屏幕上慢慢旋转。你看见熟悉三角形终于与窗外重合。","a":"标注星图观测方向","b":"旋转屏幕上的星图"},{"title":"采样箱的微光","text":"导师取回的薄膜样本在暗处发出淡光，孩子想知道是不是活物。她先请大家看观察记录，再调低环境灯。你发现光亮随温度变化，像一口缓慢呼吸的小池。","a":"记录样本温度","b":"观察不同光照下的样本"},{"title":"远处的冰粒","text":"窗外细碎冰粒映出短暂光点，向导安排大家通过记录影像慢慢看。旅伴说像家乡飘雪，领航员则画出冰粒经过的路线。你把回放停在一片六角亮纹出现的时刻。","a":"截取冰粒亮纹","b":"听领航员讲解路线"},{"title":"地面漫步图","text":"亲人准备去旅行站的地面步道，向导递来一张地形图。她想看岩石，孩子更喜欢浅水池，路线在山脚分开。你注意到途中有一间可以坐下喝水的小亭。","a":"在图上标出休息亭","b":"整理随身饮水和鞋帽"},{"title":"陌生的砂粒","text":"领航员带回一小瓶紫灰色砂粒，放大后有些像透明小片。导师想比较它们的反光，收藏家则拿出地球沙滩样本。你将两只浅盘并排摆好，颜色差别十分明显。","a":"拍摄砂粒放大图","b":"比较两份样本的反光"},{"title":"低重力小球","text":"旅行站体验室里的软球落得很慢，孩子伸手接了几次都接早了。向导示范先观察再伸手，亲人也跟着试。你发现球表面的小星纹能帮助看清它的旋转。","a":"跟着向导试接软球","b":"记录小球下落的节奏"},{"title":"亭子里的明信片","text":"地面休息亭提供空白明信片，旅伴想画眼前岩壁，却一直画不出层次。你把水杯放在桌上，看见斜阳让岩缝投出长影。亲人已经在卡片背面写起家常。","a":"描下岩缝的阴影","b":"写一张地面旅行明信片"},{"title":"归船的纪念品","text":"亲人带回一枚打磨过的小石片，孩子挑了星体形状的橡皮。收藏家帮忙找合适盒子，担心石片磨花其他东西。你取来温室用过的软纸，纸上还有淡淡叶纹。","a":"给石片包上软纸","b":"为纪念品写下日期"},{"title":"未画完的夜色","text":"返航前最后一晚，旅伴想画完地面的夜色，却总觉得颜色太黑。画师朋友提醒他留意远处灯光的暖调。你把窗边灯调暗，屏幕上的夜景终于显出层层轮廓。","a":"比较夜景中的冷暖色","b":"陪旅伴整理速写"},{"title":"下一站的星名","text":"向导在航行册写下下一站，记录员又添了观测日期。澄海号慢慢离开旅行站，窗外的小亭缩成细点。你把那张明信片夹好，指间还记得石片的凉。","a":"给地面游记添上末句","b":"与旅伴看旅行站远去"},{"title":"AI的画笔","text":"AI换上绘画夹具后总把圆画成椭圆，它说镜头位置与笔尖有一点偏差。朋友铺好格纸，让检修机重新校准。你看着它画出一排不同形状的圆，像一串小气泡。","a":"标出笔尖实际落点","b":"陪AI描画格纸"},{"title":"菌群的色谱","text":"培养车上的菌群在不同香草旁闪着不同亮点，种植员想建立观察色谱。导师提醒她也记录温度与湿度。你把几盆植物隔开放置，培养车慢慢停到中间。","a":"记录灯点与环境数据","b":"调整花盆间距"},{"title":"行李箱的暗袋","text":"收藏家清点旧地球行李，发现箱衬里藏着一张很薄的纸。上面画着幼时的花园，与那瓶土似乎有关。你把纸放到平板上，边角的字迹已经有些淡。","a":"扫描花园草图","b":"辨认纸角的小字"},{"title":"船餐的新面包","text":"温室收下的小麦磨成少量面粉，厨师试烤一只小面包。它比日常面包更紧实，香气却很浓。孩子认真把面包分成小片，想让每位看过麦苗的人尝一尝。","a":"切好面包薄片","b":"记录试烤的用料"},{"title":"一首设备小曲","text":"孩子把炉鸣、风机和热水机的声音编成节奏，请AI加一段铃音。技师一听就认出了自己每天检查的设备。你在茶室轻轻打拍子，旅伴也跟着哼起旋律。","a":"录下大家的合奏","b":"给节奏添上轻拍声"},{"title":"导师的空白笔记","text":"导师在薄膜研究笔记最后留出一页，想记录还不确定的现象。你递来整理过的样本照片，她指着一处光斑看了很久。窗外星云的颜色恰好与薄膜反光接近。","a":"标出仍待观察的光斑","b":"按时间排列样本照片"},{"title":"生日又到了","text":"旧录像里的孩子如今已长大，这回轮到她在澄海号上切蛋糕。收藏家把修复好的片段播了一小段，大家笑着对照她现在的样子。你手里相机亮起录制的小点。","a":"拍下新的生日片段","b":"帮忙分好蛋糕"},{"title":"纸图与新窗","text":"记录员把旧纸星图铺在新窗旁，发现早年的一笔弧线与此次云带照片相合。那只图角茶杯原来画在观景歇脚的位置。你翻开茶室来客册，里面也有相似小画。","a":"比对星图与云带照片","b":"描下图角茶杯"},{"title":"回声寄往家里","text":"旅伴录了一段船上的声音，准备寄给家人。他先说温室今天结了新果，又把麦克风转向轻鸣的茶壶。你靠近时，他示意你也讲一句窗外的风景。","a":"向家人描述窗外星光","b":"录下茶室的轻响"},{"title":"旅行册装订","text":"一叠观星画、检修笔记和明信片已经厚得装不进原封套。记录员给你找来新书环，朋友建议把纸页按停靠站排列。你翻到第一页，杯垫还夹在原来的位置。","a":"按停靠站整理纸页","b":"给旧杯垫加上护套"},{"title":"慢慢亮的清晨","text":"完成这一段航程后，澄海号留出休整日。温室照明慢慢升亮，旅伴在茶室读书，技师终于没有匆忙经过。你拿起航行册，发现今天也有许多值得记的小事。","a":"写下休整日的清晨","b":"到温室看新叶"},{"title":"星窗之后","text":"下一段行程即将开始，向导在茶室放了一张新星图。孩子问那片空白里会遇见什么，记录员笑着拿出铅笔。你看见窗上的蓝点，已经能分清哪一个来自屋内灯光。","a":"在新星图旁写下问题","b":"与伙伴一起望向星窗"}],"endings":[{"title":"星窗边的家常","text":"你与伙伴把旅途过成了熟悉的日常。温室收获时大家一起吃饭，观景日便把桌椅搬到窗边。AI用检修机送来新的声音小曲，菌群的培养车停在香草旁。星图还在慢慢延伸，而你每次走进茶室，都能找到一杯合口味的热饮。","hint":"支持项（每项一分）：第1节点「帮助遇到困难的旅伴」、第4节点「加入星窗茶室」、第5节点「送出备用材料」、第6节点「照顾同行者」、第8节点「协调星窗茶室与漫游工作室，整理出行路线」；第一、二幕各至少一项；公共结算：每方向至少命中两项不同早期行动，且第一、二幕各有支持；优先兑现第三幕声明的已形成方向，否则按命中数降序；同分按结伴生活、日常经营、收拾行囊、整理见闻、长久休养、安住小屋顺序。无方向形成才兜底安住小屋。身份、关系、秘密满足原条件时优先，不满足则按此公共比较结算。"},{"title":"一份舒适的行程","text":"你留在漫游工作室安排日常行程，逐渐学会给观星、检修和休息留出合适空当。旅客有各自喜欢的节奏，你便把选择写得清楚。空闲时你也坐到窗边，看自己以前忙得错过的云带。航行册上的字越来越整齐，页边却仍有随手画的小茶杯。","hint":"支持项（每项一分）：第1节点「整理行程，联系漫游工作室」、第4节点「加入漫游工作室」、第5节点「准备漫游工作室应急储备」、第6节点「独自前往漫游工作室」、第8节点「收好笔记，拜访漫游工作室」；第一、二幕各至少一项；公共结算：每方向至少命中两项不同早期行动，且第一、二幕各有支持；优先兑现第三幕声明的已形成方向，否则按命中数降序；同分按结伴生活、日常经营、收拾行囊、整理见闻、长久休养、安住小屋顺序。无方向形成才兜底安住小屋。身份、关系、秘密满足原条件时优先，不满足则按此公共比较结算。"},{"title":"在下一站下船","text":"你收好旅行册，在喜欢的地面旅行站住了下来。清晨去看岩壁，午后在小亭写信，澄海号再次停靠时便迎伙伴喝茶。孩子每回来都长高一点，AI寄来的画也渐渐能画圆。你的窗外换成真正会吹动衣袖的风，书架上仍摆着那枚星座杯垫。","hint":"支持项（每项一分）：第3节点「使用随身工具」、第4节点「加入星窗茶室」、第6节点「离开同行者」、第7节点「收起工具休息」、第8节点「协调星窗茶室与漫游工作室，整理出行路线」；第一、二幕各至少一项；公共结算：每方向至少命中两项不同早期行动，且第一、二幕各有支持；优先兑现第三幕声明的已形成方向，否则按命中数降序；同分按结伴生活、日常经营、收拾行囊、整理见闻、长久休养、安住小屋顺序。无方向形成才兜底安住小屋。身份、关系、秘密满足原条件时优先，不满足则按此公共比较结算。"},{"title":"航迹书房的长桌","text":"你把观测照片、声音样本与手写游记整理成可慢慢翻阅的记录。相同星体在不同旅人笔下有不同颜色，你都保留下来。书房长桌常有人停留，听完雨声再看一张云带图。你喜欢他们抬头望向星窗的瞬间，像又看见新的东西。","hint":"支持项（每项一分）：第1节点「保存样本并观察」、第4节点「加入航迹书房」、第5节点「展示采集的样本」、第8节点「与伙伴核对记录」；第一、二幕各至少一项；公共结算：每方向至少命中两项不同早期行动，且第一、二幕各有支持；优先兑现第三幕声明的已形成方向，否则按命中数降序；同分按结伴生活、日常经营、收拾行囊、整理见闻、长久休养、安住小屋顺序。无方向形成才兜底安住小屋。身份、关系、秘密满足原条件时优先，不满足则按此公共比较结算。"},{"title":"休息区的暖灯","text":"长途工作让你需要停下休养，船医替你调整作息，伙伴接过繁重的部分。你不能像以前那样连续操作设备，便把经验录成短短片段。休息区灯光很柔，窗外星光也不催促。等身体恢复一些，你从给温室浇一盆水开始重新参与生活。","hint":"支持项（每项一分）：第3节点「练习自己的手艺」、第6节点「照顾同行者」、第7节点「继续练习手艺」、第7节点「集中使用天赋」；第一、二幕各至少一项；公共结算：每方向至少命中两项不同早期行动，且第一、二幕各有支持；优先兑现第三幕声明的已形成方向，否则按命中数降序；同分按结伴生活、日常经营、收拾行囊、整理见闻、长久休养、安住小屋顺序。无方向形成才兜底安住小屋。身份、关系、秘密满足原条件时优先，不满足则按此公共比较结算。"},{"title":"一盆慢长的花","text":"你在澄海号找到了适合自己的小角落，照看一盆长得很慢的花。偶尔帮厨房备菜，偶尔听收藏家讲旧照片，航程便缓缓过去。花开那天你没有赶上特别的观景活动，却邀大家来喝茶。后来翻看相册，那一张笑脸最多。","hint":"支持项（每项一分）：第3节点「使用随身工具」、第4节点「加入星窗茶室」、第5节点「送出备用材料」、第7节点「收起工具休息」、第8节点「协调星窗茶室与漫游工作室，整理出行路线」；第一、二幕各至少一项，或所有公共方向均未形成时兜底；公共结算：每方向至少命中两项不同早期行动，且第一、二幕各有支持；优先兑现第三幕声明的已形成方向，否则按命中数降序；同分按结伴生活、日常经营、收拾行囊、整理见闻、长久休养、安住小屋顺序。无方向形成才兜底安住小屋。身份、关系、秘密满足原条件时优先，不满足则按此公共比较结算。"},{"title":"向导的空闲日","text":"你把旅行向导的手艺练得细致，能按光线和体力安排舒服的观景路线。行程表里始终留着空闲日，客人可以独自读书，也可以来问你窗外星名。多年后你重走最初那段步道，坐进亲人选过的小亭，终于完整画下了岩壁的影子。","hint":"以「安排观星行程的旅行向导」开局；第一幕研习身份技艺；第二幕继续研习；第三幕整合技艺；身份技艺达到 3；合作小组支持至少 4，技艺有实际服务对象；天赋负担不超过 6；终幕选择「以身份技艺服务合作小组」。"},{"title":"听见平稳的声音","text":"你对动力设备的声音越来越熟悉，细小变化也能提醒你检查合适的部位。工具抽屉用了多年，色环换过几次。新学徒第一次准确辨出松动杯架的响声时，你请他到茶室喝了一杯。热水机轻轻工作，你们听了一会，都笑了。","hint":"以「听得懂炉鸣的动力技师」开局；第一幕研习身份技艺；第二幕继续研习；第三幕整合技艺；身份技艺达到 3；合作小组支持至少 4，技艺有实际服务对象；天赋负担不超过 6；终幕选择「以身份技艺服务合作小组」。"},{"title":"麦穗里的星光","text":"你让温室的试种记录一年比一年细致，麦田虽小，却能轮换不同品种。收藏家的土样仍完整放在观察盒里，提醒你每种土都有自己的来路。第一批新学徒收麦时，你递过空篮。叶间漏下的人工晨光，依然让人想停下多看一眼。","hint":"以「照看温室土壤的种植员」开局；第一幕研习身份技艺；第二幕继续研习；第三幕整合技艺；身份技艺达到 3；合作小组支持至少 4，技艺有实际服务对象；天赋负担不超过 6；终幕选择「以身份技艺服务合作小组」。"},{"title":"一页没有照片的海","text":"你修复了许多旅行影像，也学会认真保存原始版本与空白。家人那页没有照片的海滩，后来添上口述和孩子画的贝壳。来书房的人常在这一页停留，比面对最清晰的图像还久。你继续调试扫描灯，窗边又摆来一本带着旧纸香的相册。","hint":"以「修复旅行影像的记忆修复师」开局；第一幕研习身份技艺；第二幕继续研习；第三幕整合技艺；身份技艺达到 3；合作小组支持至少 4，技艺有实际服务对象；天赋负担不超过 6；终幕选择「以身份技艺服务合作小组」。"},{"title":"轮子经过的地方","text":"从熟悉回收管道的学徒到独立维修设备，你慢慢记住了澄海号每一段弯道。AI常借检修机陪你巡看，顺便描述新发现的画面。你给容易卡轮的地方做了实用改动。多年后孩子骑着小推车顺畅经过，你看了一眼，继续擦净手上的工具。","hint":"以「熟悉回收管道的机械学徒」开局；第一幕研习身份技艺；第二幕继续研习；第三幕整合技艺；身份技艺达到 3；合作小组支持至少 4，技艺有实际服务对象；天赋负担不超过 6；终幕选择「以身份技艺服务合作小组」。"},{"title":"旅人的好眠","text":"你作为船医陪伴长途旅客，逐渐把作息建议写得简明易懂。诊室里有温水与可安静坐一会的椅子，大家也愿意来讲讲想家。曾经睡不安稳的旅伴后来给你画了一幅休息区。画里没有复杂设备，只有一盏灯和一本合着的书。","hint":"以「照顾长途旅客的船医」开局；第一幕研习身份技艺；第二幕继续研习；第三幕整合技艺；身份技艺达到 3；合作小组支持至少 4，技艺有实际服务对象；天赋负担不超过 6；终幕选择「以身份技艺服务合作小组」。"},{"title":"砂粒旅行者","text":"你继续往返采样舱与书房，把陌生风景化成能细看、能比较的样本。每只砂瓶都有日期与观测条件，旁边也放着手画的天空。你最喜欢回船后听伙伴描述同一处景色，因为他们总会注意到你没有看见的细节。那张星图仍有许多空处。","hint":"以「从星外采样归来的领航员」开局；第一幕研习身份技艺；第二幕继续研习；第三幕整合技艺；身份技艺达到 3；合作小组支持至少 4，技艺有实际服务对象；天赋负担不超过 6；终幕选择「以身份技艺服务合作小组」。"},{"title":"地球行李的新格","text":"你整理完旧地球行李后，没有把箱子永久合上。花园草图、土样与新的船上照片分放在不同格里，一起成为旅行的延续。孩子问起某件小物，你便拿出来慢慢讲。箱衬后来补过一回，缝线旁多了一朵温室花的图样。","hint":"以「整理旧地球行李的收藏家」开局；第一幕研习身份技艺；第二幕继续研习；第三幕整合技艺；身份技艺达到 3；合作小组支持至少 4，技艺有实际服务对象；天赋负担不超过 6；终幕选择「以身份技艺服务合作小组」。"},{"title":"并肩看星","text":"你与一起看星的旅伴常在晚饭后坐到窗边。有时认真认星，有时只谈今天的面包。你们也会各自参加不同活动，再带着新见闻回来。那枚杯垫磨软了边角，仍放在两只杯子之间，像给所有没说完的话留着位置。","hint":"第一幕与一起看星的旅伴相识；第一幕结识的人，在第二幕获你保护，第三幕仍守约（信任至少 5）；终幕选择「将共同生活置于远行计划之前」。"},{"title":"导师的茶歇","text":"你与薄膜研究导师保持着相互照顾的习惯。她不再把午饭放到样片旁，你也会按时收起记录板。茶歇时她讲尚未想明白的反光，你说温室又多了新叶。多年后那页空白笔记终于写满，末行仍留着一个新的问号。","hint":"第一幕与薄膜研究导师相识；第一幕结识的人，在第二幕获你保护，第三幕仍守约（信任至少 5）；终幕选择「将共同生活置于远行计划之前」。"},{"title":"一张反复改的图纸","text":"你和爱改图纸的朋友完成了许多小制作，也保留着不同的审美。观景椅脚踏改长后，你们又一起做杯架和纸图托板。桌面常有橡皮屑，旁边也常有两杯放凉的茶。最初争了很久的椅子，后来成了你们轮流午睡的位置。","hint":"第一幕与爱改图纸的朋友相识；第一幕结识的人，在第二幕获你保护，第三幕仍守约（信任至少 5）；终幕选择「将共同生活置于远行计划之前」。"},{"title":"孩子的星空画","text":"你与家人陪着孩子在船上长大，看他从画圆圈到画出整条观景路线。你们一起做过温室记录，也一起补过生日相册。后来孩子去别处旅行，寄回的第一张画仍是澄海号茶室。你们把画挂好，隔天照常一起去散步。","hint":"第一幕与共同养育孩子的家人相识；第一幕结识的人，在第二幕获你保护，第三幕仍守约（信任至少 5）；终幕选择「将共同生活置于远行计划之前」。"},{"title":"小亭里的重逢","text":"你陪准备地面旅行的亲人试好了鞋，后来又在那座小亭见过许多次面。她逐渐熟悉步道，常带你看新找到的岩层。你们带着水和简单午饭，坐到影子慢慢变长。那枚打磨石片一直在她口袋里，摸起来比初见时更温润。","hint":"第一幕与准备去地面旅行的亲人相识；第一幕结识的人，在第二幕获你保护，第三幕仍守约（信任至少 5）；终幕选择「将共同生活置于远行计划之前」。"},{"title":"星图角上的茶杯","text":"旧星图与此次航程记录拼在一起，你发现图角的小茶杯标记着适合停下来观景的位置。早年的绘图者并非只记录星名，也画下了自己的休息习惯。你把这些点补成一条舒缓路线。第一次走完的人回来，只说每一处都很想再坐一会。","hint":"前局发现「public.rescue」；前局发现「public.rule」；第一幕寻找异常的起因；第二幕与各组伙伴交流；收集至少两份线索；终幕选择「用旧日发现串联见闻」。"},{"title":"同一座花园","text":"你重拾影像与手艺记录，和旅伴辨认出行李暗袋中的草图对应一段旧家庭录像。收藏家又找到拍摄日期，那瓶土的来历终于清晰。你们在温室按图种了几株相似香草。长出的花园很小，却足够大家围坐，讲起各自记得的清晨。","hint":"前局发现「identity.1」；前局发现「relationship.1」；第一幕重拾技艺；第二幕继续研习；第一幕结识的人，在第二幕获你保护，第三幕仍守约（信任至少 5）；终幕选择「承接前世身份与未竟承诺」。"},{"title":"让声音轻一些","text":"休养时，导师帮你把常听的设备声音调成柔和的练习片段。你渐渐发现，辨认设备不必每次都依赖强烈的天赋感知。普通记录与伙伴的经验也能帮忙。后来你重新加入检修，结束后会先到茶室坐下，听一会热水机，再翻开书。","hint":"前局发现「public.sacrifice」；前局发现「relationship.2」；第一幕结识的人，在第二幕获你保护，第三幕仍守约（信任至少 5）；第二幕停止透支；第三幕接受能力限制；终幕选择「以旧日关系记忆调整天赋的用法」。"}],"turns":{"calling":{"title":"薄膜样片","text":"薄膜研究导师把澄海号温室的旧样片递给你，邀你接学长期维护透光膜。取样和调光可以借设备完成，但每次停靠都得先照看温室。旅行影像室也有修复学徒的空缺，愿从最简单的失色画面教起。","options":[{"label":"接下样片，学做温室薄膜维护者","aftermath":"六年后，温室保留着你连续记录的透光档案，靠门那片试验膜由你亲自定下更换周期。你错过了好几次整日的地面游览；导师离船前，把温室年度检修的签名栏正式交到了你这里。"},{"label":"谢过导师，转入影像室学修复","aftermath":"六年后，你修好的第一部船员家庭影像每逢聚会都会播放，片尾保留着你的修复署名。薄膜样片由另一位学徒接管；你拥有独立的暗光工作间，常为一段褪色的生日录像熬过休息时段。"}]},"bond":{"title":"旅伴的停靠单","text":"一起看星的旅伴需要长期康复，准备留在有照护设施的地面港。他请你留下，陪他做每日练习、往返复诊；照护站也能另行安排陪护。澄海号的下一段航程已开放登记，你们常坐的观景位还并排留着两份私人物件。","options":[{"label":"陪旅伴留在地面港，承担长期照护","aftermath":"五年后，你们住在复诊站旁的适居单元，你每天先陪旅伴完成练习，再处理自己的工作。澄海号的新航迹都从来信里看见；窗边装着你亲自固定的星图屏，标注的是你们在地面一起等过的夜空。"},{"label":"与旅伴告别，继续各自的旅程","aftermath":"五年后，旅伴留在地面港，由照护站安排复诊，你已经随澄海号经过三个新的停靠地。原先并排放置的物件只剩你的一份，另一处观景位有了新旅客；你寄给他的星图，总来自他没有同船抵达的地方。"}]},"home":{"title":"舱门内的尺寸图","text":"澄海号可以把你暂住的舱位改成长期居所，照明、培养空间或机体接口都可按需配置，但需要参加住舱区的定期养护。下一座环湖聚落也有合适的迁居单元，设备已经列在清单上。留下的图纸和下船的行李签摆在一起。","options":[{"label":"改好长期舱位，把澄海号当作家","aftermath":"七年后，你的舱门内侧装着按生活习惯改过的储物墙，住舱养护表上年年有你的名字。许多地面邀请因船期未能成行；每次出舱归来，转过同一段回收管道，就能看见自己的门灯。"},{"label":"告别船上住处，迁入环湖聚落","aftermath":"七年后，你在环湖聚落的家门前养出一片本地苔草，居室设备已经适应湖区的昼夜。原舱位转给了后来的常住旅客；澄海号再次停靠时，你带着家门钥匙去迎接旧友，夜里仍回岸上的住所。"}]}},"episode":{"title":"全宇宙围观我的假舱门","source":"web-original","opening":{"title":"打赏十万就开门","text":"星舰开放了闲置货舱，你和经纪人把它布置成了一间摄影棚。你在廉价摄影棚扮演星际探险家，债主兼经纪人正催你表演徒手开舱门。你小声提醒门后是杂物间，他却把直播标题改成宇宙首位无防护出舱。打赏突然暴涨，弹幕出现无法识别的文字。道具门被从外敲响，一张带鳞片的脸贴上窗户，翻译器响起：救援费已付，请立即接收遇难乘客。","a":"拉开道具门的插销","b":"把镜头转向门上的观察窗","attributes":["命势","理智"]},"followups":[{"title":"摄影棚真的漏气了","text":"门外竟连着一艘破损飞船，鳞片乘客滚进来，棚里的塑料行星全被吸向门缝。经纪人尖叫着要切断直播，乘客却指着摄像机摇头：这是唯一稳定的坐标源。弹幕里的外星观众开始逐帧指挥堵漏，你那套吹牛讲解无人再听。道具架上还有充气星球和补景胶，门外又传来幼崽的哭声。","a":"用补景胶封住门框裂口","b":"抱着充气星球钻进门内","attributes":["实力","命势"]},{"title":"骗子遇见验货员","text":"镜头对准窗户，自动字幕拆穿了你的布景：纸板舱壁，木制控制台，氧气表未通电。经纪人还想解释，外星观众却疯狂下单，称赞这是罕见的手工太空歌剧。窗外乘客敲出求救节奏，说打赏是借道费，不能当货款。你立刻关闭商品链接，屏幕弹出两项待处理事务：退款单与救援联线。","a":"逐笔确认直播退款单","b":"接通轨道救援队的联线","attributes":["声望","羁绊"]}],"codas":["补景胶堵住裂缝，救援队循直播坐标接走乘客。你对镜头承认造假，经纪人带着旧合同离场。下一场直播，你只教修门，却收到真正船厂的聘书。","充气星球撑住落下的舱板，你把幼崽抱回摄影棚。救援后它不肯松手，你只好陪去办监护交接。你的首次星际航行，从一张没有回程日期的船票开始。","退款结束，你公开拍摄布景的全过程。外星剧团买下整套纸板舱，邀请你做舞美。首演时那扇门始终锁着，观众却为一颗手拉的流星起立鼓掌。","救援队借观察窗标定位置，平安接走遇险飞船，并给摄影棚补发航道接驳许可。你拆掉假控制台，开起宇宙候船室，每天直播各种乘客错过末班船。"]}},{"id":"w8","name":"万灵生活街","premise":"旧物、屋檐与花木都能在这里说话。你在万灵生活街开起小小修补铺，听器物讲旅行和家常，与灯灵、宅灵及朋友一起准备四季的街边茶会。","factions":{"commons":"花叶茶屋","council":"万灵工坊","archive":"旧物书屋"},"fate":{"characters":["灯灵","宅灵","雀灵","一起做饭的家人","结伴采风的伙伴","石语"]},"origins":["听得见旧物故事的补器匠","替旅客照看夜灯的守灯人","打理祖宅花园的年轻园丁","陪活木看风景的筏师","记录河水歌声的采风师","沿街修理风铃的手艺人","寄居陶偶的旅行游魂","调配香草热饮的巷口茶师","记得旅客喜好的行走旅门","借枝身散步听鸟鸣的古树"],"events":[{"title":"叮当的门牌","text":"你搬进生活街的小铺，门牌在风中轻轻响。灯灵从柜台后探出光，说上位住客总在傍晚泡茶。你放下工具箱，听见墙边旧碗轻咳，似乎也想自我介绍。","a":"擦亮柜台的小灯","b":"听旧碗自我介绍"},{"title":"茶屋第一杯","text":"花叶茶屋的茶壶把水煮好，却忘了自己今天装的是哪种茶。茶师揭盖闻了闻，雀灵也凑到旁边。你看见案上的两只茶罐敞着口，叶片形状十分相近。","a":"辨闻两罐茶叶","b":"替茶壶盖好壶盖"},{"title":"旧物的招呼","text":"一把旧勺不愿与汤碗挤在同一格，说夜里总被碗边碰醒。碗有点委屈，它只是底座不平。你把它们放到软布上，发现柜架也向一边微微倾斜。","a":"检查柜架的水平","b":"给碗底垫软布"},{"title":"会痒的杯耳","text":"一只杯子说把手内侧总发痒，补器匠用灯一照，发现一条浅浅裂纹。杯子想知道能不能先看看裂纹画。你取来放大镜和细笔，窗外雀灵正在梳理羽毛。","a":"描下杯耳裂纹","b":"用放大镜查看接口"},{"title":"宅灵的晨光","text":"宅灵说东边房间好久没晒到清晨阳光，窗边藤叶长得太密。园丁拿来枝架，想把藤蔓理向屋檐。你抬头看见一枚嫩芽正卷住窗钩，像小小的绿色手指。","a":"引导藤蔓绕上枝架","b":"清理窗台落叶"},{"title":"陶偶的步子","text":"旅行游魂刚找到合适陶偶，走路时还掌握不好小脚的距离。灯灵在前面照着，陶偶一步一步跨过门槛。你看见它背上的小布包歪了，重心跟着偏向一侧。","a":"调整小布包的位置","b":"陪陶偶练习跨门槛"},{"title":"雀灵落错窗","text":"雀灵把花种送到了书屋，茶师却在茶屋等了半天。它说两扇窗都挂着蓝布帘，一急就认错。你走到街边看了看，发现门口的盆栽倒是各不相同。","a":"画下两扇窗边的盆栽","b":"陪雀灵重新走一遍"},{"title":"铜铃的轻咳","text":"门口铜铃每次响完都会多一声沙响，它以为自己嗓子哑了。手艺人检查铃舌，发现里头卡着一粒小砂。你端来浅盘，铜铃认真低下身子等着。","a":"取出铃内小砂","b":"擦净铜铃内壁"},{"title":"桌角的故事","text":"旧桌子说自己的磨痕来自一只爱写信的猫，书屋里的花猫却否认是它。你摸着桌面，发现痕迹更像笔杆反复滚动。石语慢慢走来，说它可能见过当年的笔。","a":"请石语描述旧笔","b":"拓下桌面磨痕"},{"title":"灯罩试色","text":"灯灵想换一个更柔和的罩子，茶师带来浅黄与淡绿两种纸样。宅灵说屋内墙色也会影响光感。你把纸样举到灯前，桌上的白碗依次染上不同颜色。","a":"比较碗上的两种光色","b":"把纸样移到墙边"},{"title":"给小铺起名","text":"小铺木牌还有空处，灯灵提议画个补好的杯子，雀灵想添自己的脚印。你刚蘸好颜料，旧碗便说可以把门口那朵花也画上。窗外花瓣轻轻落进水盆。","a":"描画门口的小花","b":"在木牌上画一只茶杯"},{"title":"春日来客","text":"第一位客人抱着旧砂罐进门，罐子还在回忆昨夜的菌菇汤。你把工具放整齐，灯灵照亮桌面。宅灵轻轻开大窗，温暖的风带进街边茶叶香。","a":"请砂罐描述需要修补的地方","b":"给客人倒杯温茶"},{"title":"砂罐的底纹","text":"砂罐外底有一道浅裂，内壁却还完整。它担心修补后听不见汤在里面翻滚。你敲了敲不同部位，把声音记下来，灯灵静静照着裂纹末端。","a":"记录罐底的声音","b":"描出浅裂走向"},{"title":"碗口的小月牙","text":"旧碗缺了一小块口沿，正好像月牙。它想保留这个形状，只请你磨平粗糙边。你用手指轻轻试过，粗边比看上去更明显，桌旁已经备好细磨具。","a":"细磨碗口粗边","b":"画下现有月牙轮廓"},{"title":"木梳的齿缝","text":"木梳说最近总梳到一半就卡住，家人以为是头发打结。你拿到灯下看，发现中间一根梳齿翘起。梳子有点不好意思，说自己昨天从窗台落过一次。","a":"修整翘起的梳齿","b":"清理齿缝残留细发"},{"title":"伞骨伸懒腰","text":"雨伞很久没有展开，伞骨转动时发出细细响声。它说像刚睡醒，想慢慢试着伸直。你在院里腾出一块空地，雨水已经停了，叶面还挂着水珠。","a":"陪雨伞缓缓展开","b":"检查伞骨连接处"},{"title":"镜框里的花","text":"镜子想把旧框上的花纹洗出来，却不喜欢太浓的清洁香味。茶师拿来清水与软布，园丁在旁边认出了卷叶图案。你从角落开始轻擦，木纹逐渐清晰。","a":"用清水擦拭镜框","b":"描画露出的卷叶纹"},{"title":"壶嘴的一滴水","text":"茶壶每次倒完水都会沿壶嘴挂一滴，弄湿自己的脚边。它认真演示了好几回，你发现出水口有一点结垢。茶师放下干净托盘，示意可以慢慢检查。","a":"清理壶嘴细垢","b":"观察倒水时的角度"},{"title":"旧鞋的新底","text":"一双会走路的旧鞋来到铺里，说想陪主人去远处看花。鞋底磨得厚薄不均，走在桌上也一高一低。你拿出几种柔软底料，旧鞋依次踩了踩。","a":"量取鞋底磨损处","b":"请旧鞋试踩底料"},{"title":"相框总打盹","text":"相框站在书架上老是往后倒，照片里的人仿佛躺着看天。宅灵让书架稍稍挪开，露出后面的支脚。你发现支脚布带已经松长，相框还在迷迷糊糊打哈欠。","a":"收紧支脚布带","b":"调整相框的摆放位置"},{"title":"缝纫盒的抽屉","text":"缝纫盒说抽屉里有东西顶着它，针线却都看起来放得整齐。绣线灵钻进小缝，找出一枚滚到轨道上的纽扣。你取来细镊子，纽扣在灯下闪着小小珠光。","a":"夹出轨道上的纽扣","b":"整理针线隔格"},{"title":"修补的花纹","text":"砂罐看见补口上留下的细线，想在旁边添一片蘑菇图案。画师给了几张草样，它最喜欢弯着柄的小蘑菇。你把纸贴近罐身，曲面让图案略显歪斜。","a":"调整图案在罐身的位置","b":"调配蘑菇的颜色"},{"title":"工具也要晾干","text":"收工时，小锤说布袋里总有潮气，细锉也附和。你翻开工具袋，发现清洗后的刷子和它们放在一起。灯灵把光移到空架上，架边正好有通风的小窗。","a":"把湿刷挂上空架","b":"擦干工具袋内侧"},{"title":"满架的问候","text":"修好的器物依次来道谢，木梳讲起顺畅梳发的早晨，雨伞说自己看到了彩虹。你在记录簿补上小结，旧碗把一片落花轻轻推到笔边。门外又传来熟悉的铃声。","a":"写下器物的使用反馈","b":"把落花夹入记录簿"},{"title":"天井的积水","text":"夜雨后天井积了一小滩水，宅灵说脚边有点凉。园丁查看排水口，发现落叶团卡在格栅下。你提来小桶，灯灵把一束光送到湿湿的石缝里。","a":"清理排水口落叶","b":"舀走天井积水"},{"title":"木窗的脾气","text":"木窗晴天很好推，下雨后却总卡住。它以为是自己睡迷糊了，木匠量过边框，说木材吸水会略微膨胀。你记录两天的尺寸，纸边也沾了些潮气。","a":"记录窗框湿度","b":"检查窗扇摩擦的位置"},{"title":"屋檐的风铃","text":"宅灵想听更轻的风铃声，手艺人带来几种铃舌。雀灵逐一啄响，最小的那只几乎像清脆水滴。你站到街边听，屋里屋外的感受又有不同。","a":"试换较轻的铃舌","b":"记录不同位置的铃声"},{"title":"花园旧砖","text":"园丁翻出一批旧砖，砖灵记得自己从前围着一片香草。如今它们想排在步道边，好看见来往鞋子。你把砖摆到地上，发现长度各不相同，却有相近的红色。","a":"试排弯曲的步道边","b":"清理旧砖上的泥土"},{"title":"壁纸小卷边","text":"宅灵说墙角像有一片叶子在挠痒，原来壁纸卷起了边。补器匠给你拿来小刷，提醒接缝附近还有一条细裂。你扶住纸角，露出的旧墙面带着浅浅暖色。","a":"贴平壁纸卷边","b":"查看墙面细裂"},{"title":"阁楼的旧毯","text":"一条毯子在阁楼睡了很久，展开时打了个满是灰尘的喷嚏。家人把它抱到廊下，它却惦记着一处被压扁的流苏。你轻轻抖动毯边，旧花纹在光里亮起来。","a":"梳开毯边流苏","b":"把毯子搭在晾架"},{"title":"想挪步的旅门","text":"旅门听说街尾新开了花铺，想过去看看。它能站上带轮的门架，却没试过转角。手艺人量好门框，雀灵飞到前面指着一处窄道。你扶住门架，木轮轻轻转动。","a":"陪旅门练习转弯","b":"测量街角通道"},{"title":"窗台留给谁","text":"窗台新放了花盆，花猫便没地方晒背。园丁问宅灵哪一处光照也好，宅灵缓缓打开另一扇小窗。你拿来软垫，发现那里刚好能看见茶屋门口。","a":"在小窗边铺好软垫","b":"调整花盆之间的距离"},{"title":"厨房的小回声","text":"家人在厨房说话总觉得声音比以前响，宅灵想起墙上旧布帘刚拆去洗。你拍了一下手，碗柜也轻轻应声。茶师拿来一块干帘，想先挂上看看。","a":"挂好干净布帘","b":"比较厨房不同位置的回声"},{"title":"冬前修瓦","text":"宅灵记得屋顶有一片瓦在雨里会轻轻颤，木匠在稳固梯架上找到了它。你把新瓦放进提篮，雀灵停在远处檐角，认真看着旧瓦的花纹。风里已有些凉意。","a":"把新瓦递给木匠","b":"记录旧瓦的纹样"},{"title":"房间里的香气","text":"新收的木柜带着清漆味，宅灵把窗户开得很大。茶师提醒先别急着放茶叶，家人已搬来空置通风架。你打开柜门，闻到内侧味道比外面明显。","a":"把柜子移到通风处","b":"整理暂存的茶叶罐"},{"title":"灯亮的小院","text":"一轮修整完成，宅灵请大家在天井喝茶。旧砖围着新栽香草，花猫睡在小窗边，旅门讲着花铺的见闻。你看见屋檐风铃缓缓晃动，响声比从前柔和。","a":"给大家斟上热茶","b":"画下修整后的小院"},{"title":"活木的出游","text":"筏师约几根活木一起去溪湾看花，活木在水边讨论谁适合放在外侧。你拿来软绳，发现其中一根枝杈还带着嫩芽。它晃晃芽尖，说不想把新叶浸湿。","a":"调整活木在筏上的位置","b":"给嫩芽垫上软布"},{"title":"河水哼歌","text":"采风师说今天溪声与昨天不同，河水自己也说不清换了哪一段。你蹲在岸边，看见一块小石头挡住细流，水在旁边绕出旋涡。石语听得很认真。","a":"录下石边的水声","b":"画出细流绕石的形状"},{"title":"筏上的茶杯","text":"茶杯第一次坐木筏，轻轻晃动就觉得头晕。筏师把软垫铺好，活木尽量放缓转身。你扶着小桌，看见杯中的茶面始终荡着一圈浅波纹。","a":"把茶杯放进稳固杯座","b":"陪茶杯看向远处岸边"},{"title":"芦苇来访","text":"溪湾的芦苇托雀灵带来一片叶子，问街上的纸艺师能否画出自己的花穗。纸艺师想亲眼看看，便请你带路。你摸着细长叶片，边缘有一排微微发亮的纹路。","a":"陪纸艺师去溪湾","b":"画下芦苇叶脉"},{"title":"浅滩小路","text":"水退后露出一段浅滩，石语说可以看见平时藏着的小贝壳。筏师把船停稳，提醒大家穿好适合踩水的鞋。你提起裤脚，发现水下石面铺着细细绿藻。","a":"沿干燥岸边观察","b":"穿好涉水鞋再下浅滩"},{"title":"船篷打喷嚏","text":"旧船篷被花粉落得发痒，活木笑得船身微微摇。你把篷布撑开，筏师递来柔软刷子。花粉在阳光里飘成淡黄的小云，岸边正有一树花开。","a":"轻刷船篷花粉","b":"把木筏移到花树外侧"},{"title":"漂来的果核","text":"河水送来一枚圆果核，说在上游见过同样的果树。园丁想试种，采风师想先找到树的模样。你将果核洗净，表面露出整齐的细沟，像缩小的年轮。","a":"把果核画进植物册","b":"向河水询问上游风景"},{"title":"活木的转身","text":"一根活木想靠近岸边拍照，筏师请大家先调整绳结。你握着松开的绳端，发现旧结在水里泡得很紧。活木耐心等着，树皮上的小蜗牛也慢慢探出头。","a":"慢慢解开湿绳结","b":"给活木拍一张近照"},{"title":"远处的鸟鸣","text":"雀灵听见陌生鸟鸣，想知道对方是不是在学它。采风师让大家静一会，远处传来长短不同的音节。你在纸上画了几道曲线，雀灵也试着轻轻回应。","a":"记录鸟鸣的节奏","b":"陪雀灵听完一段"},{"title":"溪边的小餐布","text":"家人带来野餐布，铺到草地才发现角上有一处旧洞。布灵说那个洞从前给雏鸟透气，讲起故事很得意。你拿来平整小板，食盒还没打开。","a":"把餐布铺在小板上","b":"听布灵讲雏鸟的故事"},{"title":"晚霞留影","text":"回程时晚霞落在水面，河水请你替它画下来，说自己流过便看不到了。纸艺师铺开小画板，活木尽量保持平稳。你看见霞色沿波纹一层层展开。","a":"画下晚霞的水纹","b":"帮纸艺师扶住画板"},{"title":"带回来的溪声","text":"你们把采风录音带回茶屋，茶壶听见溪声便说水又该烧开了。大家笑起来，雀灵纠正它这是录音。你将芦苇画摆上桌，纸上花穗像还在风里摇动。","a":"播放晚霞时的溪声","b":"挂好芦苇花穗画"},{"title":"薄荷睡醒","text":"茶屋窗边的薄荷灵总在早晨打哈欠，茶师发现它夜里也被门灯照着。灯灵把光稍稍转开，薄荷伸展了一下叶片。你摸了摸盆土，还是昨天浇水后的湿润。","a":"记录薄荷的光照时间","b":"把花盆移离门灯"},{"title":"磨臼的节奏","text":"磨臼喜欢慢慢研茶，家人却习惯快些转动小杵。两种节奏磨出的粗细不同，茶师各取一点铺到白纸上。你能看出细粉颜色更均匀，空气里的香气也有差别。","a":"比较两份茶粉","b":"请磨臼示范它的节奏"},{"title":"茶勺的分量","text":"新茶勺比旧勺深，茶壶说今天的茶味浓了许多。茶师拿来小秤，旧勺得意地伸出柄。你把同样平满的茶叶倒出来，桌上出现大小不同的两堆。","a":"称量两勺茶叶","b":"给新勺画上刻线"},{"title":"果干的太阳味","text":"烘好的果干让砂罐想起夏天院里的太阳，它想用来煮一锅甜汤。家人带来梨片，茶师又拿出几颗梅子。你闻到果干有深浅不同的酸香，砂罐已轻轻哼起歌。","a":"切好梨片","b":"请砂罐挑选喜欢的果干"},{"title":"小锅的泡泡","text":"小锅煮粥时总冒出太大的泡，吓得锅盖一跳一跳。家人转小炉火，锅盖这才站稳。你伸手拿来长柄勺，粥香里混着新磨谷物的清甜。","a":"缓缓搅动锅里的粥","b":"擦净锅沿溢出的粥水"},{"title":"热气里的眼镜","text":"茶师一端热汤，眼镜就蒙上一层雾，眼镜灵抱怨看不见菜单。灯灵移近照着字，家人递来干净镜布。你注意到汤碗放在托盘最靠近脸的位置。","a":"调整汤碗在托盘上的位置","b":"递上镜布"},{"title":"饼边的形状","text":"擀面杖想试做花形薄饼，面团灵却总弹回圆形。家人说可以先歇一会，让面团松弛。你把干净布盖上去，擀面杖开始讲自己以前做过的星形点心。","a":"给面团盖好湿布","b":"画几种薄饼花样"},{"title":"糖罐的小结晶","text":"糖罐内壁出现亮晶晶的小块，它以为自己长出了宝石。茶师取一点观察，说是受潮后重新结晶的糖。你把罐盖翻过来，边缘有几滴没擦干的水。","a":"擦干罐盖水滴","b":"把结晶画进茶食笔记"},{"title":"不烫手的杯套","text":"茶杯喜欢刚泡好的热茶，客人却不好端起它。绣线灵拿来几种杯套，杯子试到有叶纹的那一只便不肯脱。你摸着接缝，发现杯耳下还有一点过紧。","a":"松开杯耳下的针脚","b":"量取杯套开口"},{"title":"味道的便笺","text":"茶会客人留下便笺，有人闻到花香，有人想起晒过的被子。茶壶读着读着有些迷惑，说自己并没放被子。你把便笺按茶种放好，茶师笑着解释气味的联想。","a":"给茶壶读一张便笺","b":"整理各茶种的描述"},{"title":"雨声配茶","text":"雨天的茶屋格外安静，灯灵把光落在桌边，河水录音暂时停下。茶师说今天只听真正的雨就很好。你端着一壶淡茶经过窗前，窗台薄荷正轻轻伸叶。","a":"给窗边客人添茶","b":"记录真实雨声"},{"title":"茶谱装订","text":"一季试饮记录终于整理完，茶壶挑了一张淡绿封皮，砂罐想在封底画梨。你把纸页排齐，发现许多配方旁都留着客人的家常。家人穿好装订线，等你递来第一页。","a":"递上排齐的茶谱","b":"给封底画一只梨"},{"title":"古树来散步","text":"古树借一具细枝身来到街上，走得很慢，每看见一朵花都要停。雀灵站在它肩头说路还很长，古树却觉得慢慢走正好。你拿着小地图，前面便是茶屋。","a":"陪古树走向茶屋","b":"画下古树停看的花"},{"title":"陶偶换围巾","text":"天气凉了，旅行游魂想给陶偶添条围巾。绣线灵做的第一条太厚，陶偶转头不方便。你找来轻薄布样，灯灵照着脖颈接缝，陶偶认真试着左右看。","a":"改用轻薄布料","b":"量取陶偶转头的范围"},{"title":"石语的照片","text":"石语平时很少移动，这回想拍张能看见花园的照片。园丁把低矮花盆推到旁边，摄影师却说镜头角度还需更低。你蹲下试了试，正好看见一朵小花越过石边。","a":"放低相机位置","b":"调整花盆朝向"},{"title":"旅门的明信片","text":"旅门收到别处门灵寄来的照片，看得门框轻轻摇晃。它想回寄一张自己的街景，雀灵愿意帮忙取景。你站到街角，发现门上的花牌从这个角度被树叶遮住了。","a":"请雀灵拍摄街景","b":"拨开遮住花牌的枝叶"},{"title":"旧钟慢半拍","text":"茶屋的钟说最近总比门铃慢半拍，手艺人检查后发现摆锤沾了灰。钟还想听听自己修好前的声音，说以后可以比较。你拿来记录器，屋里的人都安静了片刻。","a":"录下旧钟的滴答","b":"清理摆锤上的灰"},{"title":"花猫的画像","text":"画师替花猫画了长长尾巴，花猫却说自己没那么瘦。灯灵照着它蜷起的背，雀灵提议画它睡觉的样子。你翻开先前的小院速写，里面恰好有一团圆圆的影子。","a":"把小院速写递给画师","b":"陪花猫摆好软垫"},{"title":"鸟羽书签","text":"雀灵送来自己掉落的一根羽毛，想做成书签送给石语。补器匠提醒先清洁晾干，纸艺师准备了透明夹层。你把羽毛平放，羽轴末端轻轻翘起。","a":"给羽毛做清洁晾放","b":"裁好书签夹层"},{"title":"盆栽的远方","text":"一盆迷迭香想知道溪湾是什么气味，筏师却说花盆坐筏要固定稳。园丁拿来可通气的围栏架，你试着把盆放进去。迷迭香的叶尖碰到软绳，轻轻抖了一下。","a":"调整盆栽围栏架","b":"给花盆系好柔软固定带"},{"title":"纸灯的影子戏","text":"灯灵和纸艺师准备一场影子小戏，陶偶负责把纸树推过幕布。排练时树影太大，遮住了纸猫。你移动灯的位置，墙上两道影子慢慢分开。","a":"调整灯与幕布的距离","b":"缩小纸树的轮廓"},{"title":"幕后的咳嗽声","text":"演出前砂罐想讲一段开场，却一紧张就模仿烧汤的咕噜声。家人在旁轻轻念出第一句，它跟着念了一遍。你手里握着提示卡，纸上画的是熟悉的溪湾。","a":"陪砂罐练习开场","b":"把提示卡放到它面前"},{"title":"茶会的合唱","text":"小戏结束后，铜铃、茶壶与雀灵想合唱，节拍却总对不上。古树轻敲桌面，给出缓慢稳当的拍子。你听见旧钟也加入滴答，大家便一点点跟上了。","a":"跟着古树轻打节拍","b":"记录器物合唱"},{"title":"送客的小光","text":"茶会散场，灯灵一路照到街角，旅门向最后一位来客道晚安。你和家人收好杯子，宅灵缓缓合上窗。石语还在看雀灵送的书签，透明夹层映出很淡的光。","a":"陪灯灵走回小铺","b":"给桌上的器物盖好软布"},{"title":"冬日新围裙","text":"家人给你缝了一件新围裙，旧围裙却说自己还想留在铺里。你翻开旧口袋，里面有木屑、线头和一枚早忘记的花种。灯灵看着桌上散开的小东西，像看一份旅途。","a":"把花种装进纸包","b":"清理旧围裙的口袋"},{"title":"小铺的旧账本","text":"整理柜台时，你找到上位住客记的材料本，里面夹着一页茶谱。茶壶认出那是自己年轻时常煮的一款茶，配方旁却多了手绘窗户。你将纸放平，看见窗下还有一只猫。","a":"请茶壶回忆那款茶","b":"描下纸上的窗户"},{"title":"屋檐的落雪","text":"第一场雪落下来，宅灵轻声说屋檐有点沉。园丁查看枝架，年轻枝条上也堆了薄雪。你站在廊下，用长软刷轻轻碰到边缘，几片雪花落在鞋尖。","a":"轻扫低处枝架积雪","b":"查看屋檐下的排水槽"},{"title":"远方的器物来信","text":"修好的旧鞋寄来一张花田照片，说路上又认识了一把爱唱歌的伞。你把照片给灯灵看，它认出伞边的花纹与你修过的那把相同。窗外风铃响了一小声。","a":"给旧鞋写回信","b":"把照片放进修补记录"},{"title":"柜台上的小种子","text":"旧围裙里找到的花种迟迟没发芽，园丁说外壳太厚，先不要着急。古树弯下枝身看了一会，想起自己幼时也等过很久。你摸摸盆土，灯灵把光挪远一点。","a":"记录种子的外观","b":"按园丁建议照看盆土"},{"title":"石语记得的笔","text":"石语终于在书屋找到桌子说过的旧笔，笔灵记得从前有人一边记茶谱一边描器物。那只爱写信的猫其实是笔杆上的雕花。你把笔放回旧桌，它们沉默片刻后笑了。","a":"把旧笔放进合适笔架","b":"记录桌子与笔的故事"},{"title":"茶谱里的窗","text":"你们照茶谱小画找到了旧窗的位置，原来如今的修补铺曾是上位住客的茶室。宅灵记起从前雨天满屋的蒸汽，茶壶也讲起客人留下的便笺。你望向同一扇窗，薄荷正长出新叶。","a":"画下现在的窗边","b":"整理旧茶室的便笺"},{"title":"不忙的下午","text":"冬日下午没有来修东西的客人，你坐在小铺听雨伞说旅途。灯灵打了个小小光嗝，似乎也该歇会。家人端来热粥，桌上还有一页空着的记录纸。","a":"收起工具陪家人吃粥","b":"把雨伞的旅行画下来"},{"title":"明年的小茶会","text":"大家又谈起下一次茶会，古树想带种子糕，雀灵想学一首新曲。茶壶翻开茶谱，认真挑适合春天的味道。你看见宅灵已在天井留出一处摆长桌的位置。","a":"画出茶会桌面布置","b":"陪茶壶翻看春茶配方"},{"title":"修补簿的新页","text":"你把这一年的修补记录重新装好，每件器物都补说了使用后的感受。旧鞋的花田照片、石语的书签图也夹在里面。灯灵照着封面，书脊刚好能再添一些纸。","a":"给修补簿添入新纸","b":"检查已装订的页角"},{"title":"一朵迟开的花","text":"旧围裙里的种子终于开花，花很小，只比纽扣大一点。园丁请大家别围得太近，灯灵把亮度调低。你蹲在盆旁闻了闻，香味轻得像刚晾干的布。","a":"画下小花的形状","b":"给花盆写上开花日期"},{"title":"早安生活街","text":"清晨开门时，旅门正和雀灵说着新来的住客，茶屋已经冒出热气。你把灯灵请到窗边，街角传来旧钟准时的滴答。工具箱打开，今天的第一位客人是一只喜欢旅行的水壶。","a":"迎水壶到工作台","b":"向街坊道一声早安"}],"endings":[{"title":"花叶间的一桌茶","text":"你和伙伴把街边茶会变成四季的约定。灯灵照着点心，古树慢慢打拍子，雀灵唱新学的歌。每次都多一位带故事的客人，也总有熟悉器物说到一半忘了词。你把空杯收进托盘，看见那只小花盆又长高一点，便叫园丁过来一起看看。","hint":"支持项（每项一分）：第1节点「帮助遇到困难的旅伴」、第4节点「加入花叶茶屋」、第5节点「送出备用材料」、第6节点「照顾同行者」、第8节点「协调花叶茶屋与万灵工坊，整理出行路线」；第一、二幕各至少一项；公共结算：每方向至少命中两项不同早期行动，且第一、二幕各有支持；优先兑现第三幕声明的已形成方向，否则按命中数降序；同分按结伴生活、日常经营、收拾行囊、整理见闻、长久休养、安住小屋顺序。无方向形成才兜底安住小屋。身份、关系、秘密满足原条件时优先，不满足则按此公共比较结算。"},{"title":"万灵工坊的日常","text":"你留在工坊照看每天的修补，给不同大小的器物安排合适台面。大伞可以在院里展开，小纽扣则有自己的浅盘。忙时你会忘记喝茶，茶壶便轻轻碰一下桌角。多年后招牌颜色淡了，门口那朵画上去的小花仍陪着每位来客。","hint":"支持项（每项一分）：第1节点「整理行程，联系万灵工坊」、第4节点「加入万灵工坊」、第5节点「准备万灵工坊应急储备」、第6节点「独自前往万灵工坊」、第8节点「收好笔记，拜访万灵工坊」；第一、二幕各至少一项；公共结算：每方向至少命中两项不同早期行动，且第一、二幕各有支持；优先兑现第三幕声明的已形成方向，否则按命中数降序；同分按结伴生活、日常经营、收拾行囊、整理见闻、长久休养、安住小屋顺序。无方向形成才兜底安住小屋。身份、关系、秘密满足原条件时优先，不满足则按此公共比较结算。"},{"title":"带着小灯出门","text":"你和采风伙伴收好工具，带一盏轻便小灯去看更多风景。筏师送你们走过溪湾，旧鞋的花田也终于出现在眼前。路上见到的器物各有性格，你把故事慢慢写进本子。回街时旅门先认出脚步，远远就叫起你的名字。","hint":"支持项（每项一分）：第3节点「使用随身工具」、第4节点「加入花叶茶屋」、第6节点「离开同行者」、第7节点「收起工具休息」、第8节点「协调花叶茶屋与万灵工坊，整理出行路线」；第一、二幕各至少一项；公共结算：每方向至少命中两项不同早期行动，且第一、二幕各有支持；优先兑现第三幕声明的已形成方向，否则按命中数降序；同分按结伴生活、日常经营、收拾行囊、整理见闻、长久休养、安住小屋顺序。无方向形成才兜底安住小屋。身份、关系、秘密满足原条件时优先，不满足则按此公共比较结算。"},{"title":"旧物书屋的新卷","text":"你把修补簿、茶谱与采风录音整理成一套生活记录。有人来看工艺，也有人只想听雨伞讲彩虹。石语常停在书架旁替客人找页码，雀灵偶尔把羽毛夹在新书里。你给每卷留着空处，后来果然又装进许多没听过的家常。","hint":"支持项（每项一分）：第1节点「保存样本并观察」、第4节点「加入旧物书屋」、第5节点「展示采集的样本」、第8节点「与伙伴核对记录」；第一、二幕各至少一项；公共结算：每方向至少命中两项不同早期行动，且第一、二幕各有支持；优先兑现第三幕声明的已形成方向，否则按命中数降序；同分按结伴生活、日常经营、收拾行囊、整理见闻、长久休养、安住小屋顺序。无方向形成才兜底安住小屋。身份、关系、秘密满足原条件时优先，不满足则按此公共比较结算。"},{"title":"慢工的小桌","text":"连续用天赋倾听许多器物后，你开始需要更长的休息。家人把修补桌移到窗下，伙伴接过需要用力的活。你只做少量细磨，更多时候听客人慢慢描述。灯灵照得很柔，工具也收得早了，门口花盆的每片新叶你都没有错过。","hint":"支持项（每项一分）：第3节点「练习自己的手艺」、第6节点「照顾同行者」、第7节点「继续练习手艺」、第7节点「集中使用天赋」；第一、二幕各至少一项；公共结算：每方向至少命中两项不同早期行动，且第一、二幕各有支持；优先兑现第三幕声明的已形成方向，否则按命中数降序；同分按结伴生活、日常经营、收拾行囊、整理见闻、长久休养、安住小屋顺序。无方向形成才兜底安住小屋。身份、关系、秘密满足原条件时优先，不满足则按此公共比较结算。"},{"title":"天井里的日子","text":"你安住在宅灵的小院，晨起照看盆栽，下午去茶屋坐一会。没有非完成不可的大制作，也会为修平一个杯口高兴。下雨时你听屋檐滴答，晴天便晒晒旧毯。冬末那粒迟迟不发芽的种子终于开花，你把它画在常翻的书页旁。","hint":"支持项（每项一分）：第3节点「使用随身工具」、第4节点「加入花叶茶屋」、第5节点「送出备用材料」、第7节点「收起工具休息」、第8节点「协调花叶茶屋与万灵工坊，整理出行路线」；第一、二幕各至少一项，或所有公共方向均未形成时兜底；公共结算：每方向至少命中两项不同早期行动，且第一、二幕各有支持；优先兑现第三幕声明的已形成方向，否则按命中数降序；同分按结伴生活、日常经营、收拾行囊、整理见闻、长久休养、安住小屋顺序。无方向形成才兜底安住小屋。身份、关系、秘密满足原条件时优先，不满足则按此公共比较结算。"},{"title":"每一道修补线","text":"你把补器手艺练得细致，先听器物描述，再看裂纹与磨损。砂罐上的小蘑菇成了茶屋熟悉的风景，月牙碗也用得很好。后来学徒问修补线要不要藏起来，你拿出两只不同的杯子，让他分别询问。工作台上的灯光落在釉面，照出各自喜欢的样子。","hint":"以「听得见旧物故事的补器匠」开局；第一幕研习身份技艺；第二幕继续研习；第三幕整合技艺；身份技艺达到 3；合作小组支持至少 4，技艺有实际服务对象；天赋负担不超过 6；终幕选择「以身份技艺服务合作小组」。"},{"title":"夜灯照着归途","text":"你继续替旅客照看夜灯，熟悉了不同灯芯与灯罩的亮度。来客晚归时，你把灯放到合适窗边，等他们看到门口的小花。灯灵也有打盹的时候，你便点起普通小灯。街上慢慢安静下来，远处传来脚步，你放下书，去把温茶倒好。","hint":"以「替旅客照看夜灯的守灯人」开局；第一幕研习身份技艺；第二幕继续研习；第三幕整合技艺；身份技艺达到 3；合作小组支持至少 4，技艺有实际服务对象；天赋负担不超过 6；终幕选择「以身份技艺服务合作小组」。"},{"title":"祖宅花园的四季","text":"你把园艺手艺用于祖宅，理顺藤蔓，修整步道，替不同植物寻找适合的光。宅灵渐渐能说清自己喜欢哪个季节的气味。古树来访时总停在窗前看花，花猫则仍睡在那块软垫上。你每年添一页花园图，图里的空地越来越少，坐下休息的位置却一直留着。","hint":"以「打理祖宅花园的年轻园丁」开局；第一幕研习身份技艺；第二幕继续研习；第三幕整合技艺；身份技艺达到 3；合作小组支持至少 4，技艺有实际服务对象；天赋负担不超过 6；终幕选择「以身份技艺服务合作小组」。"},{"title":"筏上的新叶","text":"你与活木熟悉了彼此的水性和习惯，沿溪载着客人看四季。出发前先整理绳结，再给嫩芽腾出干燥位置。那只会晕船的茶杯后来也能安稳看晚霞。你年纪渐长，活木放慢速度，筏上的茶仍热着，水面的光一层层经过脚边。","hint":"以「陪活木看风景的筏师」开局；第一幕研习身份技艺；第二幕继续研习；第三幕整合技艺；身份技艺达到 3；合作小组支持至少 4，技艺有实际服务对象；天赋负担不超过 6；终幕选择「以身份技艺服务合作小组」。"},{"title":"溪声收藏者","text":"你继续记录河水的歌，发现同一处细流也会随季节改变声音。石语帮你辨认水下的小石，雀灵添上岸边鸟鸣。书屋里留着最初那段旋涡声，你每次重听都想起蹲在溪边的姿势。后来河水又说今天唱得不同，你便提起记录器，慢慢走过去。","hint":"以「记录河水歌声的采风师」开局；第一幕研习身份技艺；第二幕继续研习；第三幕整合技艺；身份技艺达到 3；合作小组支持至少 4，技艺有实际服务对象；天赋负担不超过 6；终幕选择「以身份技艺服务合作小组」。"},{"title":"铃声轻一点","text":"你熟悉了生活街的风向，也学会替风铃挑合适的铃舌。宅灵喜欢的柔声留在屋檐，茶屋门口则响得更清楚。修完一只铃，你会站远些听，再回去微调。街坊常凭声音知道你走到哪一段路，你应一声，工具包在肩头轻轻晃。","hint":"以「沿街修理风铃的手艺人」开局；第一幕研习身份技艺；第二幕继续研习；第三幕整合技艺；身份技艺达到 3；合作小组支持至少 4，技艺有实际服务对象；天赋负担不超过 6；终幕选择「以身份技艺服务合作小组」。"},{"title":"陶偶的旅行箱","text":"你在陶偶里练熟了步子，学会调整行李和挑选轻围巾。后来你独自去过几处花田，也带着新照片回到生活街。陶偶喜欢停下细看路边的小草，你便把行程放慢。箱子还是很小，却装得下几片落叶、一封信和你们都喜欢的薄荷香。","hint":"以「寄居陶偶的旅行游魂」开局；第一幕研习身份技艺；第二幕继续研习；第三幕整合技艺；身份技艺达到 3；合作小组支持至少 4，技艺有实际服务对象；天赋负担不超过 6；终幕选择「以身份技艺服务合作小组」。"},{"title":"巷口的热饮","text":"你将香草热饮做成一门细致手艺，按季节记录气味和客人的喜好。茶壶会提醒你水温，磨臼也找到舒服的研磨节奏。雨天客人坐得久，你便添一壶淡茶。桌边那些写着被子、花园与家乡的便笺，后来成了茶谱最常被翻的一页。","hint":"以「调配香草热饮的巷口茶师」开局；第一幕研习身份技艺；第二幕继续研习；第三幕整合技艺；身份技艺达到 3；合作小组支持至少 4，技艺有实际服务对象；天赋负担不超过 6；终幕选择「以身份技艺服务合作小组」。"},{"title":"灯灵的晚安","text":"你与灯灵在同一张桌边过了许多年，它照你修补，你陪它试新的灯罩。有时它想出去看夜色，你便带着轻便底座同行。回到小铺，你们先喝茶，再各自休息。桌上留下的光不总一样亮，却总让你想起那些可以慢慢说话的夜晚。","hint":"第一幕与灯灵相识；第一幕结识的人，在第二幕获你保护，第三幕仍守约（信任至少 5）；终幕选择「将共同生活置于远行计划之前」。"},{"title":"宅灵的天井","text":"你与宅灵一起照看房子，知道哪扇窗适合花猫，哪面墙最爱下午阳光。雨天你清理落叶，它轻轻开窗透气。偶尔想换家具，你们就把小样放在天井里看一天。岁月让木纹颜色更深，也让你们越来越熟悉彼此说早安的语气。","hint":"第一幕与宅灵相识；第一幕结识的人，在第二幕获你保护，第三幕仍守约（信任至少 5）；终幕选择「将共同生活置于远行计划之前」。"},{"title":"雀灵的下一首歌","text":"你和雀灵常在茶会后一起收拾，它衔走纸签，你擦净杯碟。它仍偶尔认错窗，却已经能凭盆栽找到小铺。远行回来时，它会停在门牌上先唱一小段新歌。你放下手中的活，等它唱完，再问这次在哪里看见了花。","hint":"第一幕与雀灵相识；第一幕结识的人，在第二幕获你保护，第三幕仍守约（信任至少 5）；终幕选择「将共同生活置于远行计划之前」。"},{"title":"厨房里两个人","text":"你与一起做饭的家人慢慢找到默契，一个洗菜，一个照看砂罐。锅盖偶尔插话，擀面杖常把故事讲得太长，你们便边笑边等面醒好。后来茶谱里添了许多普通晚饭，纸页沾着熟悉香气。你最常翻的那页，只记着某个雨天一起喝粥。","hint":"第一幕与一起做饭的家人相识；第一幕结识的人，在第二幕获你保护，第三幕仍守约（信任至少 5）；终幕选择「将共同生活置于远行计划之前」。"},{"title":"一段又一段溪湾","text":"你与采风伙伴没有走遍所有地方，却记住了沿溪每一处适合停下的小岸。带回来的画和声音逐渐装满书屋，旅门常来挑想看的风景。重走旧路时，你们也会注意到新的芦苇。回到茶屋，再普通的一段水声也能聊上一晚。","hint":"第一幕与结伴采风的伙伴相识；第一幕结识的人，在第二幕获你保护，第三幕仍守约（信任至少 5）；终幕选择「将共同生活置于远行计划之前」。"},{"title":"桌子与旧笔","text":"你把工坊记录和茶屋旧谱放在一起，终于找到桌面磨痕的来历。那只爱写信的猫原来刻在旧笔杆上，每次笔滚过桌边便留下细线。桌子听完笑了很久，旧笔也讲起许多客人。你将两件旧物摆在窗边，让它们接着补完彼此记得的一半。","hint":"前局发现「public.rescue」；前局发现「public.rule」；第一幕寻找异常的起因；第二幕与各组伙伴交流；收集至少两份线索；终幕选择「用旧日发现串联见闻」。"},{"title":"同一扇窗的茶香","text":"重拾修补与茶谱记录时，你和灯灵循着纸上的窗形认出了小铺从前的模样。旧住客爱在这里修物、煮茶，也常忘记给花浇水。宅灵补上这些小事，你便按旧配方煮了一壶。味道并不陌生，因为如今的日子也在同一扇窗下慢慢冒着热气。","hint":"前局发现「identity.1」；前局发现「relationship.1」；第一幕重拾技艺；第二幕继续研习；第一幕结识的人，在第二幕获你保护，第三幕仍守约（信任至少 5）；终幕选择「承接前世身份与未竟承诺」。"},{"title":"等花开的办法","text":"长久休息时，宅灵和家人陪你照看旧围裙里找到的种子。你不再天天催着它发芽，只记录土壤和光照，也开始用普通工具处理简单修补。花开得迟，香气也轻，灯灵却看了整整一晚。你把它画进簿里，旁边写下那段慢慢恢复的日子。","hint":"前局发现「public.sacrifice」；前局发现「relationship.2」；第一幕结识的人，在第二幕获你保护，第三幕仍守约（信任至少 5）；第二幕停止透支；第三幕接受能力限制；终幕选择「以旧日关系记忆调整天赋的用法」。"}],"turns":{"calling":{"title":"石语的细磨盒","text":"石语把一盒多年积存的细磨料推到你面前，愿意教你专修会说话的旧器，让小铺接下那些要反复复诊的慢活。采风师也来邀你转做河声记录，沿途的活木会帮忙载器材，但常常要离街数月。","options":[{"label":"接下细磨盒，专学旧器的慢修手艺","aftermath":"五年后，你的小铺设了一排让旧器留宿的软垫格，每格都记着你追踪裂纹的日期。那把怕痒的老梳子每月只肯预约你；你为这些回访留在街上，河声采集册一直没有翻过出发前的一页。"},{"label":"谢绝细磨传承，改做河声采风师","aftermath":"五年后，你的河声录集中收进了十二处不同水湾的晨声，第一份成册作品寄存在街角故事馆。细磨盒交给了另一位补器匠；你把小铺交托出去，常随活木载着录音器材，一走便是几个月。"}]},"bond":{"title":"灯灵的晚班","text":"常陪你关店的灯灵近来存不住光，修灯师说要用几年慢慢养回，每晚都需要熟悉的伙伴陪它校正明暗。它想请你接下这份陪伴，也已找到能提供照护的灯舍。远行采风的邀约摊在店里，灯灵把自己的光挪开，让你能看清字。","options":[{"label":"答应每晚陪伴，照护灯灵养光","aftermath":"四年后，你每天都在同一时刻收起工作，陪灯灵对照窗边的明暗纸。需要在外过夜的差事被你陆续辞掉；它重新亮稳的第一晚，照见的是你们四年间逐日记下的一整柜养光笺。"},{"label":"送灯灵去灯舍，告别后各自生活","aftermath":"四年后，灯灵由灯舍伙伴陪着养光，你们共用的旧灯座已收进你的行李箱。你完成了数次跨季采风，夜间工作改用新买的行路灯；旧街寄来的茶会照片里，灯灵亮在灯舍那一桌。"}]},"home":{"title":"宅灵留的空位","text":"宅灵愿把天井旁的空处长期留给你，门廊、扎根的土槽或休憩台都可照你的需要布置，只请你一起照看会漏雨的老屋。远方溪口的一座空院也愿迎接新住客，同行的筏师正在等你决定要不要带上全部家当。","options":[{"label":"住下改造天井，与宅灵照看老屋","aftermath":"六年后，天井旁留着完全按你习惯布置的一角，你与宅灵共同换过两回排水槽。每逢长雨，你都得回来查看屋顶；街边茶会散场后，雀灵会把你忘带的东西直接送到那扇熟悉的窗前。"},{"label":"向宅灵道别，随筏师迁居溪口","aftermath":"六年后，你在溪口空院安了会报水位的门铃，行李箱终于拆成日常使用的储物格。天井空位已有新的住客；回生活街赴茶会要提前订渡船，散场时你带走的是返程包裹，回家路上的风有了溪水的味道。"}]}},"episode":{"title":"垫桌脚的器灵不装了","source":"web-original","opening":{"title":"废器也敢认主","text":"万灵街今天摆起了试器摊。你推开摊后的旧门，便站在挑选学徒的炉房里。宗门选器，你只分到一块垫桌脚的黑铁片。师兄举着新得的灵剑，让你当众把它丢进熔炉，省得废物占名额。铁片却在你掌心打了个哈欠：他那把剑，借了我的骨头。你还没听清，灵剑突然脱手跪落，所有人腰间的剑鞘一齐震响。师兄脸色发白，反咬你偷练邪术，伸手来掐你的腕骨。","a":"把黑铁片按在试器石上","b":"握住掉落灵剑的剑柄","attributes":["理智","实力"]},"followups":[{"title":"谁欠了谁一把剑","text":"试器石亮出最古老的锻造纹，黑铁片竟是剑炉失落的炉心。它逐一报出旧账：师兄那柄名剑用次品冒领上品材料，连封柄的印记都没换。铸器师核验后收走灵剑，转身请你献出炉心。铁片在掌中发颤，低声说它当年就是被锁进炉里烧了百年。殿后的古炉此时自行打开，热浪扑来。","a":"把铁片收进衣襟","b":"带着铁片走到古炉前","attributes":["资源","命势"]},{"title":"骨头记得旧主人","text":"剑柄一握，剑身便散成数截，露出藏在里面的黑色细骨。师兄惊叫这是祖传名剑，细骨却自己爬回铁片，拼出一只小小的铁雀。它不是剑灵，而是被拆来炼器的寻矿雀。铸器师当众撤掉这柄剑的评级，铁雀却忽然望向藏宝阁：里面还有我的翅膀。你袖中的入阁木牌只剩最后一次使用机会。","a":"拿入阁木牌去开藏宝阁","b":"将铁雀放到铸器师掌上","attributes":["资源","羁绊"]}],"codas":["你抱着炉心退出选器堂，把全部积蓄换成离山路费。它嫌你的锅漏底，顺手补好，第二天又补了一街的锅。所谓觉醒神技，被你们用来挣足三餐。","你拆开古炉的锁灵环，炉心才自愿跳进去。第一炉只炼出普通锄头，却再不需要困住器灵。你拒绝名剑，带着这批耐用农具回了出生的山村。","木牌打开阁门，铁雀从饰品盒里衔回双翼，留下标明矿脉的羽毛后飞向远山。你没有追。多年后，你建的矿场每逢封坑，总有铁雀先领工人出来。","铸器师认出师门失传的造物，亲手取回双翼，公开销毁拆灵炼器的旧方。铁雀留在工坊教小徒弟辨矿，你成了它的搭档，第一件作品是一只新铁雀。"]}}],"revision":"6230129cb688"};const {App}=require('src/ui/app.js');
const canvas=document.getElementById('game');new App(canvas,require('src/adapters/browser.js').browserPlatform(canvas),pack);
})();