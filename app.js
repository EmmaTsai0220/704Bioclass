/* ============================================================
   704 生物課 — 前端主程式
   功能：作業佈達、各組計分（角色權重）、籤筒、拖曳座位、訂正狀況即時同步
   ============================================================ */
(function () {
  'use strict';

  const CFG = window.APP_CONFIG || {};
  const DEMO = !CFG.GAS_URL;
  const PRESETS = CFG.POINT_PRESETS || [5, 10, 20, 30];
  const PW_KEY = 'bio704_pw';
  const DRAWN_KEY = 'bio704_drawn';
  const CYCLE = ['OK', '未訂正', '缺交', ''];
  const ROLES = ['教授', '研究員', '文書', '總務'];

  const $ = (s, el) => (el || document).querySelector(s);
  const $$ = (s, el) => Array.from((el || document).querySelectorAll(s));
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const clone = (x) => JSON.parse(JSON.stringify(x));
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const state = {
    data: null,
    admin: false,
    password: '',
    tab: 'home',
    // 座位
    seatGrid: [], seatHistory: [], seatDirty: false, sortables: [], lastDragEnd: 0,
    // 籤筒
    drawn: loadDrawn(), drawResult: null,
    // 訂正狀況：等待寫回的變更
    pendingSub: {}, subTimer: null, subSaving: false,
  };

  /* ================= API ================= */
  async function api(action, payload, write) {
    if (DEMO) return demoApi(action, payload);
    let res;
    if (write) {
      // 用 text/plain 送 JSON，避免 CORS 預檢（GAS 不支援）
      res = await fetch(CFG.GAS_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ action: action, payload: payload || {}, password: state.password }),
      });
    } else {
      const q = new URLSearchParams({ action: action, _: Date.now() });
      if (payload) q.set('payload', JSON.stringify(payload));
      res = await fetch(CFG.GAS_URL + '?' + q.toString(), { cache: 'no-store' });
    }
    if (!res.ok) throw new Error('連線失敗（HTTP ' + res.status + '）');
    const j = await res.json();
    if (!j.ok) {
      if (j.error === 'UNAUTHORIZED') {
        if (state.admin) setAdmin(false);
        throw new Error('密碼錯誤或已變更，請重新登入');
      }
      throw new Error(j.error);
    }
    return j.data;
  }

  // 上次讀到的資料先存在瀏覽器裡：打開網頁時先秒開舊資料，再背景更新成最新的
  const CACHE_KEY = 'bio704_cache_v1';
  function readCache() {
    try { return JSON.parse(localStorage.getItem(CACHE_KEY) || 'null'); } catch (e) { return null; }
  }
  function writeCache(d) {
    try { localStorage.setItem(CACHE_KEY, JSON.stringify(d)); } catch (e) { /* 空間不足或無痕模式 */ }
  }
  function setSyncing(on) {
    document.body.classList.toggle('syncing', on);
    $('#refreshBtn').textContent = on ? '更新中…' : '重新整理';
  }

  async function load(manual) {
    if (manual && state.seatDirty && !confirm('座位還沒儲存，重新整理會放棄這些變更。確定嗎？')) return;
    const btn = $('#refreshBtn');
    btn.disabled = true;
    if (!state.data && !DEMO) {
      const cached = readCache();
      if (cached) { state.data = cached; renderAll(); }
    }
    setSyncing(true);
    try {
      await flushSubmissions();
      const fresh = await api('getAll');
      if (state.seatDirty && !manual) fresh.seats = state.data.seats;
      state.data = fresh;
      if (manual) { state.seatDirty = false; state.seatHistory = []; }
      renderAll();
      if (!DEMO) writeCache(fresh);
      if (manual) toast('已讀取最新資料');
    } catch (e) {
      toast(e.message, true);
      if (!state.data) $('#termLabel').textContent = '讀取失敗：' + e.message;
    } finally {
      btn.disabled = false;
      setSyncing(false);
    }
  }

  /* ================= 共用 ================= */
  function groupColor(groupName) {
    const i = state.data.groups.findIndex((g) => g.name === groupName);
    return i < 0 ? 'var(--st-blank)' : 'var(--g' + (i % 5) + ')';
  }
  function student(name) { return state.data.students.find((s) => s.name === name); }
  function weightOf(role) {
    const w = state.data.weights[role];
    return w == null ? 1 : w;
  }
  function round1(n) { return Math.round(n * 10) / 10; }
  function fmt(n) { return Number.isInteger(n) ? String(n) : n.toFixed(1); }
  function signed(n) { return (n > 0 ? '+' : '') + fmt(n); }
  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  let toastTimer;
  function toast(msg, isError, action) {
    const t = $('#toast');
    $('#toastMsg').textContent = msg;
    const btn = $('#toastAction');
    if (action) {
      btn.textContent = action.label;
      btn.hidden = false;
      btn.onclick = () => { t.classList.remove('show'); action.run(); };
    } else {
      btn.hidden = true;
      btn.onclick = null;
    }
    t.classList.toggle('error', !!isError);
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), action ? 6000 : (isError ? 4500 : 2500));
  }

  function renderAll() {
    renderHeader();
    renderHome();
    if (!state.seatDirty) state.seatGrid = clone(state.data.seats);
    renderSeats();
    renderGroups();
    renderDrawPool();
    renderDrawResult();
    renderSubmit();
  }

  /* ================= 頂部 ================= */
  function renderHeader() {
    $('#className').textContent = CFG.CLASS_NAME || '704 生物課';
    document.title = CFG.CLASS_NAME || '704 生物課';
    const sc = state.data.scores;
    $('#termLabel').textContent = sc.term + '，' + sc.startedAt + ' 起計分' + (DEMO ? '（示範模式）' : '');
  }

  /* ================= 作業與分數 ================= */
  function renderHome() {
    const hw = state.data.homework || {};
    $('#hwCurrent').textContent = hw.current ? hw.current.text : '尚未佈達作業';
    $('#hwCurrentDate').textContent = hw.current ? hw.current.date + ' 佈達' : '';
    $('#hwPrevious').textContent = hw.previous ? hw.previous.text : '沒有紀錄';
    $('#hwPrevDate').textContent = hw.previous ? '（' + hw.previous.date + '）' : '';
    renderScores();
  }

  function rule() { return state.data.hwCheckRule || { full: 30, perMissing: 20, alert: 3 }; }
  function checkScore(n) { return rule().full - rule().perMissing * n; }
  function checks() { const c = state.data.hwChecks; return c && !c.error ? c : { records: [], counts: {} }; }
  function currentLabel() { return $('#checkLabel').value.trim() || defaultLabel(); }
  function defaultLabel() { const d = new Date(); return (d.getMonth() + 1) + '/' + d.getDate() + ' 作業'; }

  function renderScores() {
    const sc = state.data.scores;
    const totals = state.data.groups.map((g) => sc.totals[g.name] || 0);
    const max = Math.max(1, ...totals);
    const top = Math.max(...totals);
    const w = state.data.weights;
    const r = rule();
    $('#scoreSince').textContent = '加分會乘上角色權重：教授 ×' + w['教授'] + '、研究員 ×' + w['研究員'] +
      '、文書 ×' + w['文書'] + '、總務 ×' + w['總務'];
    $('#checkRule').textContent = '作業全數完成 +' + r.full + '；每一人未完成少 ' + r.perMissing +
      ' 分（1 人 = ' + signed(checkScore(1)) + '、2 人 = ' + signed(checkScore(2)) + '、3 人 = ' + signed(checkScore(3)) + '）';

    const label = currentLabel();
    const recs = checks().records;
    $('#groupCards').innerHTML = state.data.groups.map((g, i) => {
      const total = totals[i];
      const count = Object.values(g.members).filter(Boolean).length;
      const lead = top > 0 && total === top;
      const done = recs.filter((x) => !x.undone && x.group === g.name && x.label === label);
      const last = done[done.length - 1];
      const status = last
        ? '「' + esc(label) + '」<b>' + (last.missing.length ? last.missing.join('、') + ' 號未完成' : '全數完成') +
          ' ' + signed(last.delta) + '</b> <button type="button" class="linkish undo-check" data-id="' + esc(last.id) + '">撤銷</button>'
        : '';
      return '<div class="gcard' + '' + '" style="--g:' + groupColor(g.name) + '">' +
        '<div class="gcard-head"><h3>' + esc(g.name) + '<small>' + count + ' 人</small></h3>' +
        '<span class="gtotal">' + fmt(total) + '</span></div>' +
        '<div class="score-track"><div class="score-bar" style="width:' + Math.max(0, total / max * 100) + '%"></div></div>' +
        '<p class="gstatus admin-text">' + (state.admin ? status : '') + '</p>' +
        '<div class="gactions">' +
          '<button type="button" class="pt-btn act-full" data-group="' + esc(g.name) + '">作業全數完成 +' + r.full + '</button>' +
          '<button type="button" class="pt-btn act-miss" data-group="' + esc(g.name) + '">作業未完成</button>' +
          '<button type="button" class="pt-btn act-pts" data-group="' + esc(g.name) + '">其他加分</button>' +
        '</div></div>';
    }).join('');

    // 最近加分紀錄
    const hwIds = new Set(recs.map((x) => x.id));
    const log = (sc.log || []).slice(0, 20);
    $('#scoreLog').innerHTML = log.length ? log.map((x) =>
      '<li class="' + (x.undone ? 'undone' : '') + '"><span>' + esc(x.time) + '</span>' +
      '<span><b>' + esc(x.group) + '</b> ' + esc(x.student || '') +
      (x.role && x.role !== '全組' ? '（' + esc(x.role) + ' ×' + x.weight + '）' : '') +
      ' <b>' + signed(x.delta) + '</b> ' + esc(state.admin || !hwIds.has(x.id) ? (x.reason || '') : (x.reason || '').split('：')[0]) + '</span>' +
      (state.admin && !x.undone ? '<button type="button" class="linkish undo" data-id="' + esc(x.id) + '"' +
        (hwIds.has(x.id) ? ' data-hw="1"' : '') + '>撤銷</button>' : '') +
      '</li>'
    ).join('') : '<li>這個段考還沒有加分紀錄</li>';

    renderMissStats();
    renderCheckMatrix();

    // 計分設定
    $('#totalsForm').innerHTML = state.data.groups.map((g) =>
      '<label style="--g:' + groupColor(g.name) + '">' + esc(g.name) +
      '<input type="number" step="0.1" data-group="' + esc(g.name) + '" value="' + (sc.totals[g.name] || 0) + '"></label>'
    ).join('');
    const hist = state.data.history || [];
    $('#historyList').innerHTML = hist.slice().reverse().map((h) =>
      '<li><b>' + esc(h.term) + '</b>（' + esc(h.from) + '～' + esc(h.to) + '）：' +
      Object.keys(h.totals).map((k) => esc(k) + ' ' + fmt(h.totals[k])).join('、') + '</li>'
    ).join('');
  }

  // 每位同學本段考累計幾次沒寫
  function renderMissStats() {
    const c = checks();
    const alert = rule().alert;
    $('#missStatsHint').textContent = (c.error ? '讀不到紀錄：' + c.error : '本段考累計，達 ' + alert + ' 次會標紅');
    const labelsOf = {};
    c.records.filter((x) => !x.undone).forEach((x) => x.missing.forEach((no) => {
      (labelsOf[no] = labelsOf[no] || []).push(x.label);
    }));
    const rows = Object.keys(c.counts).map(Number)
      .map((no) => ({ no: no, n: c.counts[no], s: state.data.students.find((x) => x.no === no) }))
      .sort((a, b) => b.n - a.n || a.no - b.no);
    $('#missStats').innerHTML = rows.length ? rows.map((r) =>
      '<li class="' + (r.n >= alert ? 'alert' : '') + '"><span class="no">' + r.no + '</span>' +
      '<span class="name">' + esc(r.s ? r.s.name : '') + '</span>' +
      '<span class="labels" title="' + esc((labelsOf[r.no] || []).join('、')) + '">' + esc((labelsOf[r.no] || []).join('、')) + '</span>' +
      '<span class="cnt">' + r.n + ' 次</span></li>'
    ).join('') : '<li class="empty"><span class="empty">目前大家都有完成作業</span></li>';
  }

  // 各組每次作業檢查的結果表
  function renderCheckMatrix() {
    const recs = checks().records.filter((x) => !x.undone);
    const labels = [];
    recs.forEach((x) => { if (labels.indexOf(x.label) < 0) labels.push(x.label); });
    const groups = state.data.groups;
    if (!labels.length) {
      $('#checkMatrix').innerHTML = '<tbody><tr><td class="none">還沒有作業檢查紀錄</td></tr></tbody>';
      return;
    }
    const head = '<thead><tr><th scope="col">作業</th>' + groups.map((g) =>
      '<th scope="col" style="--g:' + groupColor(g.name) + '">' + esc(g.name) + '</th>').join('') + '</tr></thead>';
    const body = '<tbody>' + labels.slice().reverse().map((lb) =>
      '<tr><th scope="row">' + esc(lb) + '</th>' + groups.map((g) => {
        const list = recs.filter((x) => x.label === lb && x.group === g.name);
        const x = list[list.length - 1];
        if (!x) return '<td class="none">—</td>';
        if (!x.missing.length) return '<td class="full">全數完成<small>' + signed(x.delta) + '</small></td>';
        const who = state.admin ? x.missing.join('、') + ' 號' : x.missing.length + ' 人未完成';
        return '<td class="part">' + esc(who) + '<small>' + signed(x.delta) + '</small></td>';
      }).join('') + '</tr>'
    ).join('') + '</tbody>';
    $('#checkMatrix').innerHTML = head + body;
  }

  /* ================= 作業檢查 ================= */
  async function recordCheck(groupName, missing) {
    const label = currentLabel();
    const dup = checks().records.some((x) => !x.undone && x.group === groupName && x.label === label);
    if (dup && !confirm(groupName + '的「' + label + '」已經登記過了，還要再登記一次嗎？\n（如果要改，建議先按「撤銷」再重新登記）')) return;
    $$('#groupCards .pt-btn').forEach((b) => { b.disabled = true; });
    try {
      const res = await api('recordHomeworkCheck', { group: groupName, label: label, missing: missing }, true);
      state.data.scores = res.scores;
      state.data.hwChecks = res.hwChecks;
      renderScores();
      const c = res.check;
      toast(c.group + '「' + c.label + '」' + (c.missing.length ? c.missing.join('、') + ' 號未完成' : '全數完成') + ' ' + signed(c.delta),
        false, { label: '撤銷', run: () => undoCheck(c.id) });
    } catch (e) {
      toast('登記失敗：' + e.message, true);
      renderScores();
    }
  }

  async function undoCheck(id) {
    try {
      const res = await api('undoHomeworkCheck', { id: id }, true);
      state.data.scores = res.scores;
      state.data.hwChecks = res.hwChecks;
      renderScores();
      toast('已撤銷這筆作業紀錄');
    } catch (e) { toast('撤銷失敗：' + e.message, true); }
  }

  let missGroup = null;
  function openMissDialog(groupName) {
    missGroup = groupName;
    const dlg = $('#missDialog');
    dlg.style.setProperty('--g', groupColor(groupName));
    $('#missTitle').textContent = groupName + '：作業未完成';
    $('#missSub').textContent = '登記的作業：「' + currentLabel() + '」';
    $('#missInput').value = '';
    $('#missError').hidden = true;
    const members = state.data.students.filter((s) => s.group === groupName);
    $('#missChips').innerHTML = members.map((s) =>
      '<button type="button" class="miss-chip" aria-pressed="false" data-no="' + s.no + '"><span class="no">' + s.no + '</span>' + esc(s.name) + '</button>'
    ).join('');
    updateMissPreview();
    dlg.showModal();
    $('#missInput').focus();
  }

  function parseMissing() {
    const nos = ($('#missInput').value.match(/\d+/g) || []).map(Number);
    return nos.filter((n, i) => nos.indexOf(n) === i);
  }

  function updateMissPreview() {
    const nos = parseMissing();
    const members = state.data.students.filter((s) => s.group === missGroup);
    const bad = nos.filter((n) => !members.some((s) => s.no === n));
    $$('#missChips .miss-chip').forEach((b) => b.setAttribute('aria-pressed', String(nos.indexOf(Number(b.dataset.no)) >= 0)));
    const err = $('#missError');
    if (bad.length) {
      err.textContent = bad.join('、') + ' 號不是' + missGroup + '的組員';
      err.hidden = false;
    } else err.hidden = true;
    const ok = nos.filter((n) => bad.indexOf(n) < 0);
    $('#missPreview').innerHTML = ok.length
      ? ok.length + ' 人未完成：' + rule().full + ' − ' + rule().perMissing + ' × ' + ok.length + ' = <b>' + signed(checkScore(ok.length)) + '</b> 分'
      : '還沒輸入座號（沒有人未完成的話，請改按「作業全數完成」）';
    $('#missSubmit').disabled = !ok.length || bad.length > 0;
  }

  /**
   * 加分：items = [{ group, student?, role?, base }]
   * 先在畫面上立即加上去，再寫回後端；失敗就還原
   */
  async function addPoints(items) {
    const prepared = items.map((it) => {
      const s = it.student ? student(it.student) : null;
      const role = it.role || (s && s.role) || '全組';
      const group = it.group || (s && s.group);
      return { group: group, student: it.student || '', role: role, base: it.base,
               delta: round1(it.base * weightOf(role)), reason: it.reason || '' };
    });
    const before = clone(state.data.scores.totals);
    prepared.forEach((x) => {
      state.data.scores.totals[x.group] = round1((state.data.scores.totals[x.group] || 0) + x.delta);
    });
    renderScores();

    const label = prepared.length === 1
      ? prepared[0].group + ' ' + signed(prepared[0].delta) +
        (prepared[0].student ? '（' + prepared[0].student + (prepared[0].role !== '全組' ? ' ' + prepared[0].role + ' ×' + weightOf(prepared[0].role) : '') + '）' : '')
      : prepared.length + ' 組已加分';
    try {
      const res = await api('addPoints', {
        items: prepared.map((x) => ({ group: x.group, student: x.student, role: x.role, base: x.base, reason: x.reason })),
      }, true);
      state.data.scores = res.scores;
      renderScores();
      const ids = res.results.map((r) => r.id);
      toast(label, false, { label: '復原', run: () => undoPoints(ids) });
      return prepared;
    } catch (e) {
      state.data.scores.totals = before;
      renderScores();
      toast('加分失敗：' + e.message, true);
      return null;
    }
  }

  async function undoPoints(ids) {
    try {
      let res;
      for (const id of ids) res = await api('undoPoints', { id: id }, true);
      state.data.scores = res.scores;
      renderScores();
      toast('已撤銷');
    } catch (e) {
      toast('撤銷失敗：' + e.message, true);
    }
  }

  async function publishHomework(e) {
    e.preventDefault();
    const text = $('#hwInput').value.trim();
    if (!text) { toast('請先輸入作業內容'); return; }
    const btn = $('#hwSubmit');
    btn.disabled = true;
    try {
      const res = await api('setHomework', { text: text, edit: $('#hwEdit').checked }, true);
      state.data.homework = res.homework;
      $('#hwInput').value = '';
      $('#hwEdit').checked = false;
      renderHome();
      toast('作業已佈達');
    } catch (err) {
      toast(err.message, true);
    } finally {
      btn.disabled = false;
    }
  }

  async function saveTotals() {
    const totals = {};
    $$('#totalsForm input').forEach((i) => { totals[i.dataset.group] = Number(i.value) || 0; });
    try {
      const res = await api('setTotals', { totals: totals }, true);
      state.data.scores = res.scores;
      renderScores();
      toast('總分已更新');
    } catch (e) { toast(e.message, true); }
  }

  async function newTerm() {
    const name = $('#newTermName').value.trim();
    if (!name) { toast('請輸入新的段考名稱'); return; }
    if (!confirm('確定要結算「' + state.data.scores.term + '」並把各組分數歸零，開始「' + name + '」嗎？')) return;
    try {
      const res = await api('newTerm', { term: name }, true);
      state.data.scores = res.scores;
      state.data.history = res.history;
      state.data.hwChecks = { term: res.scores.term, records: [], counts: {} };
      $('#newTermName').value = '';
      renderHeader();
      renderScores();
      toast('已開始' + name);
    } catch (e) { toast(e.message, true); }
  }

  /* ================= 加分視窗 ================= */
  let pointTarget = null;

  function openPointDialog(target) {
    if (!state.admin) return;
    pointTarget = target;
    const s = target.student ? student(target.student) : null;
    const group = target.group || (s && s.group);
    if (!group) { toast((target.student || '') + ' 還沒分組，無法加分'); return; }
    const role = (s && s.role) || '全組';
    const w = weightOf(role);
    const dlg = $('#pointDialog');
    dlg.style.setProperty('--g', groupColor(group));
    $('#pointTitle').textContent = s ? s.name : group;
    $('#pointSub').textContent = s
      ? group + '，' + role + '：分數 ×' + w + ' 加到全組'
      : '全組加分（×1）';
    const values = PRESETS.concat(PRESETS.map((v) => -v));
    $('#pointPresets').innerHTML = values.map((v) =>
      '<button type="button" class="pt-btn' + (v < 0 ? ' neg' : '') + '" data-base="' + v + '">' + signed(v) +
      (w !== 1 ? '<small>實得 ' + signed(round1(v * w)) + '</small>' : '') + '</button>'
    ).join('');
    $('#pointCustom').value = '';
    dlg.showModal();
  }

  async function pointFromDialog(base) {
    if (!pointTarget || !base) return;
    const t = pointTarget;
    $('#pointDialog').close();
    await addPoints([{ group: t.group, student: t.student, base: base }]);
  }

  /* ================= 籤筒 ================= */
  // 公平規則：每抽出一位／一組算一次，每 FAIR_BLOCK 次為一輪
  //   1. 同一組不會連續被抽到
  //   2. 一輪內每組至少被抽到一次（快到輪尾時，還沒抽到的組會優先）
  const FAIR_BLOCK = 10;

  function emptyFair() { return { count: 0, seen: [], last: '' }; }
  function loadDrawn() {
    try {
      const o = JSON.parse(sessionStorage.getItem(DRAWN_KEY) || '{}');
      return { people: o.people || [], group: o.group || [], fair: o.fair || emptyFair() };
    } catch (e) { return { people: [], group: [], fair: emptyFair() }; }
  }
  function saveDrawn() {
    try { sessionStorage.setItem(DRAWN_KEY, JSON.stringify(state.drawn)); } catch (e) { /* ignore */ }
  }
  function syncDrawFields() {
    const mode = $('input[name="drawMode"]:checked').value;
    $$('.draw-controls .field').forEach((f) => { f.hidden = f.dataset.for.split(' ').indexOf(mode) < 0; });
    renderDrawPool();
  }
  function drawablePeople() { return state.data.students.filter((s) => s.group); }
  function fairOn() { return $('#drawFair').checked; }

  function renderDrawPool() {
    if (!state.data) return;
    const mode = $('input[name="drawMode"]:checked').value;
    const noRepeat = $('#drawNoRepeat').checked;
    let text = '';
    if (!noRepeat) text = '每次都從全部抽';
    else if (mode === 'group') {
      const left = state.data.groups.length - state.drawn.group.length;
      text = '還有 ' + left + ' 組沒抽過';
    } else {
      const list = mode === 'role'
        ? drawablePeople().filter((s) => s.role === $('#drawRole').value)
        : drawablePeople();
      const left = list.filter((s) => state.drawn.people.indexOf(s.name) < 0).length;
      text = (mode === 'role' ? $('#drawRole').value + '：' : '') + '還有 ' + left + ' / ' + list.length + ' 人沒抽過';
    }
    $('#drawPool').textContent = text;

  }

  function resetDrawn() {
    state.drawn = { people: [], group: [], fair: emptyFair() };
    saveDrawn();
    renderDrawPool();
    toast('籤筒已重置');
  }

  /**
   * 依序抽出 n 個，每抽一個都套用公平規則與「不重複」：
   *   list：可抽的對象；keyFn：用來記錄抽過沒；groupOf：對象屬於哪一組
   */
  function pick(list, n, drawnList, keyFn, groupOf) {
    const noRepeat = $('#drawNoRepeat').checked;
    const fair = fairOn();
    const f = state.drawn.fair;
    const allGroups = state.data.groups.map((g) => g.name);
    const picked = [];

    for (let k = 0; k < n; k++) {
      const avail = list.filter((x) => picked.indexOf(x) < 0);
      if (!avail.length) break;
      let cands = avail;
      if (fair) {
        // 規則 1：不跟上一次同一組
        const notSame = cands.filter((x) => groupOf(x) !== f.last);
        if (notSame.length) cands = notSame;
        // 規則 2：剩下的次數 ≤ 還沒抽到的組數時，只能從還沒抽到的組裡抽
        const remaining = FAIR_BLOCK - f.count;
        const missing = allGroups.filter((g) => f.seen.indexOf(g) < 0 && avail.some((x) => groupOf(x) === g));
        if (missing.length && missing.length >= remaining) {
          const forced = cands.filter((x) => missing.indexOf(groupOf(x)) >= 0);
          if (forced.length) cands = forced;
        }
      }
      // 不重複：優先抽還沒抽過的（公平規則優先，必要時才會重複）
      if (noRepeat) {
        const fresh = cands.filter((x) => drawnList.indexOf(keyFn(x)) < 0);
        if (fresh.length) cands = fresh;
      }
      const x = cands[Math.floor(Math.random() * cands.length)];
      picked.push(x);

      const g = groupOf(x);
      f.last = g;
      if (f.seen.indexOf(g) < 0) f.seen.push(g);
      if (++f.count >= FAIR_BLOCK) { f.count = 0; f.seen = []; }
    }

    // 不重複模式：整份名單都抽過了 → 開新一輪
    let newRound = false;
    if (noRepeat) {
      picked.forEach((x) => { if (drawnList.indexOf(keyFn(x)) < 0) drawnList.push(keyFn(x)); });
      if (list.every((x) => drawnList.indexOf(keyFn(x)) >= 0)) {
        newRound = true;
        const keys = list.map(keyFn);
        for (let i = drawnList.length - 1; i >= 0; i--) if (keys.indexOf(drawnList[i]) >= 0) drawnList.splice(i, 1);
      }
    }
    return { picked: picked, newRound: newRound };
  }

  function doDraw() {
    if (!state.data) return;
    const mode = $('input[name="drawMode"]:checked').value;
    let result;

    if (mode === 'people') {
      const n = Math.max(1, Math.min(drawablePeople().length, parseInt($('#drawCount').value, 10) || 1));
      const r = pick(drawablePeople(), n, state.drawn.people, (s) => s.name, (s) => s.group);
      if (r.newRound) toast('全班都抽過一輪了，接下來重新開始');
      result = { mode: 'people', items: r.picked.map((s) => ({ student: s.name, group: s.group, role: s.role, got: 0 })) };
    } else if (mode === 'group') {
      const r = pick(state.data.groups, 1, state.drawn.group, (g) => g.name, (g) => g.name);
      if (r.newRound) toast('每組都抽過了，接下來重新開始');
      result = { mode: 'group', items: r.picked.map((g) => ({ group: g.name, role: '全組', got: 0 })) };
    } else {
      const role = $('#drawRole').value;
      const cands = drawablePeople().filter((x) => x.role === role);
      const n = Math.max(1, Math.min(cands.length, parseInt($('#drawCount').value, 10) || 1));
      const r = pick(cands, n, state.drawn.people, (x) => x.name, (x) => x.group);
      if (r.newRound) toast('這個角色都抽過一輪了，接下來重新開始');
      result = { mode: 'role', role: role, items: r.picked.map((x) => ({ student: x.name, group: x.group, role: x.role, got: 0 })) };
    }
    saveDrawn();
    renderDrawPool();
    revealDraw(result);
  }

  // 抽籤的小動畫：名字快速跳動約 0.8 秒後停下
  function revealDraw(result) {
    state.drawResult = result;
    const btn = $('#drawBtn');
    if (reduceMotion) { renderDrawResult(); return; }
    btn.disabled = true;
    const names = result.mode === 'group'
      ? state.data.groups.map((g) => g.name)
      : drawablePeople().map((s) => s.name);
    renderDrawResult(true);
    const slots = $$('#drawResult .big-name');
    let ticks = 0;
    const timer = setInterval(() => {
      slots.forEach((el) => { el.textContent = names[Math.floor(Math.random() * names.length)]; });
      if (++ticks >= 14) {
        clearInterval(timer);
        renderDrawResult();
        btn.disabled = false;
      }
    }, 55);
  }

  function ptButtons(i) {
    return '<div class="pts">' +
      PRESETS.map((v) => '<button type="button" class="pt-btn" data-i="' + i + '" data-base="' + v + '">' + signed(v) + '</button>').join('') +
      '</div>';
  }

  function renderDrawResult(shuffling) {
    const box = $('#drawResult');
    const r = state.drawResult;
    if (!r || !state.data) {
      box.className = 'draw-result';
      box.innerHTML = '<p class="empty">選好方式後按「抽籤」。</p>';
      return;
    }
    if (!r.items.length) {
      box.className = 'draw-result';
      box.innerHTML = '<p class="empty">沒有符合的同學。</p>';
      return;
    }
    const cards = r.items.map((it, i) => {
      const color = groupColor(it.group);
      if (r.mode === 'group') {
        const g = state.data.groups.find((x) => x.name === it.group);
        const members = g ? Object.values(g.members).filter(Boolean).join('、') : '';
        return '<div class="draw-card' + (shuffling ? ' shuffling' : '') + '" style="--g:' + color + '">' +
          '<div class="big-name">' + esc(shuffling ? '' : it.group) + '</div>' +
          (shuffling ? '' : '<p class="members">' + esc(members) + '</p>' + ptButtons(i) +
            '<div class="got">' + (it.got ? '已加 ' + signed(it.got) : '') + '</div>') +
          '</div>';
      }
      const s = student(it.student);
      return '<div class="draw-card' + (shuffling ? ' shuffling' : '') + '" style="--g:' + color + '">' +
        '<div class="big-name">' + esc(shuffling ? '' : it.student) + (shuffling || !s ? '' : '<small>' + s.no + ' 號</small>') + '</div>' +
        (shuffling ? '' : '<div class="who-meta">' + esc(it.group) + '<span>' + esc(it.role) + ' ×' + weightOf(it.role) + '</span></div>' +
          ptButtons(i) + '<div class="got">' + (it.got ? '已加 ' + signed(it.got) : '') + '</div>') +
        '</div>';
    }).join('');

    if (r.items.length > 1) {
      box.className = 'draw-result batch';
      box.innerHTML = '<div class="draw-batch"><span>抽到的 ' + r.items.length + ' 位一起加分：</span>' +
        PRESETS.map((v) => '<button type="button" class="pt-btn" data-all="' + v + '">全部 ' + signed(v) + '</button>').join('') +
        '</div><div class="draw-cards">' + cards + '</div>';
    } else {
      box.className = 'draw-result';
      box.innerHTML = cards;
    }
  }

  async function drawPoints(btn) {
    const r = state.drawResult;
    if (!r) return;
    const targets = btn.dataset.all != null ? r.items.map((_, i) => i) : [Number(btn.dataset.i)];
    const base = Number(btn.dataset.all != null ? btn.dataset.all : btn.dataset.base);
    $$('#drawResult .pt-btn').forEach((b) => { b.disabled = true; });
    const done = await addPoints(targets.map((i) => {
      const it = r.items[i];
      return it.student ? { student: it.student, group: it.group, role: it.role, base: base }
                        : { group: it.group, role: '全組', base: base };
    }));
    if (done && state.drawResult === r) {
      targets.forEach((i, k) => { r.items[i].got = round1(r.items[i].got + done[k].delta); });
    }
    renderDrawResult();
  }

  /* ================= 座位表 ================= */
  function cardHtml(name) {
    const s = student(name);
    const g = s && s.group;
    return '<div class="card" data-name="' + esc(name) + '" style="--g:' + (g ? groupColor(g) : 'var(--st-blank)') + '">' +
      '<span class="name">' + esc(name) + (s ? '<small>' + s.no + '</small>' : '') + '</span>' +
      '<span class="meta"><span class="grp">' + esc(g || '未分組') + '</span>' +
      '<span class="role">' + esc(s && s.role ? s.role : '') + '</span></span></div>';
  }

  function renderSeats() {
    const grid = state.seatGrid;
    const cols = Math.max(1, ...grid.map((r) => r.length));
    const el = $('#seatGrid');
    el.style.setProperty('--cols', cols);

    let html = '';
    for (let c = 0; c < cols; c++) html += '<div class="col-label">第' + '一二三四五六七八九十'.charAt(c) + '排</div>';
    grid.forEach((row, r) => {
      for (let c = 0; c < cols; c++) {
        const n = row[c] || '';
        html += '<div class="seat-cell" data-r="' + r + '" data-c="' + c + '">' + (n ? cardHtml(n) : '') + '</div>';
      }
    });
    el.innerHTML = html;

    const seated = new Set(grid.flat().filter(Boolean));
    $('#seatTray').innerHTML = state.data.students
      .filter((s) => !seated.has(s.name))
      .map((s) => cardHtml(s.name)).join('');

    $('#saveSeatBtn').disabled = !state.seatDirty;
    $('#undoSeatBtn').disabled = !state.seatHistory.length;
    setupSortables();
  }

  function readGridFromDom() {
    const rows = state.seatGrid.length;
    const cols = Math.max(1, ...state.seatGrid.map((r) => r.length));
    const grid = Array.from({ length: rows }, () => Array(cols).fill(''));
    $$('#seatGrid .seat-cell').forEach((cell) => {
      const card = cell.querySelector('.card');
      if (card) grid[+cell.dataset.r][+cell.dataset.c] = card.dataset.name;
    });
    return grid;
  }

  function commitSeats(newGrid) {
    if (JSON.stringify(newGrid) === JSON.stringify(state.seatGrid)) { renderSeats(); return; }
    state.seatHistory.push(clone(state.seatGrid));
    if (state.seatHistory.length > 30) state.seatHistory.shift();
    state.seatGrid = newGrid;
    state.seatDirty = true;
    renderSeats();
  }

  function setupSortables() {
    state.sortables.forEach((s) => s.destroy());
    state.sortables = [];
    if (!state.admin || !window.Sortable) return;

    const base = {
      group: 'seats',
      animation: 150,
      delay: 120,
      delayOnTouchOnly: true,
      ghostClass: 'sortable-ghost',
      chosenClass: 'sortable-chosen',
      onEnd: () => { state.lastDragEnd = Date.now(); commitSeats(readGridFromDom()); },
    };
    // 每格只放一張卡：拖進有人的格子就互換
    $$('#seatGrid .seat-cell').forEach((cell) => {
      state.sortables.push(Sortable.create(cell, Object.assign({}, base, {
        onAdd: (evt) => {
          Array.from(evt.to.children)
            .filter((c) => c !== evt.item)
            .forEach((c) => evt.from.appendChild(c));
        },
      })));
    });
    state.sortables.push(Sortable.create($('#seatTray'), base));
  }

  function addSeatRow() {
    const cols = Math.max(1, ...state.seatGrid.map((r) => r.length));
    if (state.seatGrid.length >= 8) { toast('座位最多 8 列'); return; }
    commitSeats(state.seatGrid.concat([Array(cols).fill('')]));
  }
  function deleteSeatRow() {
    const last = state.seatGrid[state.seatGrid.length - 1] || [];
    if (state.seatGrid.length <= 1) return;
    if (last.some(Boolean)) { toast('最後一列還有人，請先把他們移到別的位置'); return; }
    commitSeats(state.seatGrid.slice(0, -1));
  }
  function undoSeats() {
    if (!state.seatHistory.length) return;
    state.seatGrid = state.seatHistory.pop();
    state.seatDirty = JSON.stringify(state.seatGrid) !== JSON.stringify(state.data.seats);
    renderSeats();
  }
  async function saveSeats() {
    const grid = clone(state.seatGrid);
    while (grid.length > 1 && grid[grid.length - 1].every((x) => !x)) grid.pop();
    const btn = $('#saveSeatBtn');
    btn.disabled = true;
    btn.textContent = '儲存中…';
    try {
      const res = await api('saveSeats', { grid: grid }, true);
      state.data.seats = res.seats;
      state.seatGrid = clone(res.seats);
      state.seatDirty = false;
      state.seatHistory = [];
      renderSeats();
      toast('座位已儲存');
    } catch (e) {
      toast(e.message, true);
      btn.disabled = false;
    } finally {
      btn.textContent = '儲存座位';
    }
  }

  function renderGroups() {
    const slotLabel = { 教授: '教授', 研究員: '研究員', 文書1: '文書', 文書2: '文書', 總務: '總務' };
    $('#groupList').innerHTML = state.data.groups.map((g) => {
      const rows = state.data.roleSlots
        .filter((slot) => g.members[slot])
        .map((slot) => {
          const role = slotLabel[slot];
          return '<dt>' + role + ' <small>×' + weightOf(role) + '</small></dt><dd>' + esc(g.members[slot]) + '</dd>';
        }).join('');
      return '<div class="group" style="--g:' + groupColor(g.name) + '"><h3>' + esc(g.name) + '</h3><dl>' + rows + '</dl></div>';
    }).join('');
  }

  /* ================= 訂正狀況（即時連動試算表） ================= */
  const ST = { 'OK': ['st-ok', 'OK'], '未訂正': ['st-fix', '未訂正'], '缺交': ['st-miss', '缺交'], '': ['st-blank', '—'] };

  function renderSubmit() {
    const sub = state.data.submissions;
    if (!sub || sub.error) {
      $('#submitMeta').textContent = '';
      $('#pendingList').innerHTML = '<p class="error">讀不到作業表：' + esc(sub && sub.error) + '</p>';
      $('#submitTable').innerHTML = '';
      return;
    }
    renderSubmitMeta();

    $('#hwTabSelect').innerHTML = (sub.tabs || [sub.tab]).map((t) =>
      '<option' + (t === sub.tab ? ' selected' : '') + '>' + esc(t) + '</option>').join('') +
      '<option value="__new">＋ 建立新分頁…</option>';

    $('#pendingList').innerHTML = sub.homeworks.slice().reverse().map((hw) => {
      const pend = sub.records.filter((r) => r.status[hw] && r.status[hw] !== 'OK');
      const blank = sub.records.filter((r) => !r.status[hw]).length;
      let body;
      if (blank === sub.records.length) body = '<span class="empty">尚未登記</span>';
      else if (!pend.length) body = '<span class="all-ok">全部完成</span>';
      else body = pend.map((r) =>
        '<span class="who ' + (r.status[hw] === '缺交' ? 'miss' : 'fix') + '"><span class="no">' + r.no + '</span>' +
        esc(r.name) + (r.status[hw] === '缺交' ? '（缺交）' : '') + '</span>').join('');
      return '<div class="pending-item"><h3>' + esc(hw) + '</h3><p>' + body + '</p></div>';
    }).join('');

    const head = '<thead><tr><th scope="col">座號 姓名</th>' +
      sub.homeworks.map((hw) => '<th scope="col">' + esc(hw) + '</th>').join('') + '</tr></thead>';
    const body = '<tbody>' + sub.records.map((r) =>
      '<tr><th scope="row"><span class="no">' + r.no + '</span>' + esc(r.name) + '</th>' +
      sub.homeworks.map((hw) => {
        const v = r.status[hw] || '';
        const st = ST[v] || ['st-blank', v];
        const saving = state.pendingSub[r.no + '|' + hw] != null;
        return '<td><button type="button" class="st ' + st[0] + (saving ? ' saving' : '') + '" data-no="' + r.no +
          '" data-hw="' + esc(hw) + '" aria-label="' + esc(r.name + ' ' + hw + '：' + (v || '未登記')) + '">' + esc(st[1]) + '</button></td>';
      }).join('') + '</tr>'
    ).join('') + '</tbody>';
    $('#submitTable').innerHTML = head + body;
    if (!$('#lookupPanel').hidden && $('#lookupInput').value.trim()) runLookup();
  }

  /* 查詢自己的作業：座號、全名、姓或名都可以 */
  function findStudents(q) {
    q = q.replace(/\s+/g, '').replace(/號$/, '');
    if (!q) return [];
    const recs = state.data.submissions.records;
    if (/^\d+$/.test(q)) return recs.filter((r) => r.no === Number(q));
    const exact = recs.filter((r) => r.name === q);
    if (exact.length) return exact;
    const given = recs.filter((r) => r.name.slice(1) === q);      // 名
    const family = recs.filter((r) => r.name.charAt(0) === q);    // 姓
    const part = recs.filter((r) => r.name.indexOf(q) >= 0);      // 部分符合
    const seen = new Set();
    return given.concat(family, part).filter((r) => !seen.has(r.no) && seen.add(r.no));
  }

  function runLookup() {
    const box = $('#lookupResult');
    const sub = state.data && state.data.submissions;
    if (!sub || sub.error) { box.innerHTML = '<p class="error">目前讀不到作業表，請稍後再試</p>'; return; }
    const q = $('#lookupInput').value.trim();
    if (!q) { box.innerHTML = ''; return; }
    const found = findStudents(q);
    if (!found.length) {
      box.innerHTML = '<p class="empty">找不到「' + esc(q) + '」，請確認座號或姓名有沒有打錯。</p>';
      return;
    }
    box.innerHTML = (found.length > 1 ? '<p class="date">找到 ' + found.length + ' 位同學</p>' : '') +
      found.map((r) => {
        const s = student(r.name);
        const bad = sub.homeworks.filter((hw) => r.status[hw] === '未訂正' || r.status[hw] === '缺交');
        const color = s && s.group ? groupColor(s.group) : 'var(--st-blank)';
        const list = bad.length
          ? '<ul class="lookup-list">' + bad.map((hw) => {
              const st = r.status[hw];
              return '<li><span class="hw">' + esc(hw) + '</span><span class="st ' + (st === '缺交' ? 'st-miss' : 'st-fix') + '">' + esc(st) + '</span></li>';
            }).join('') + '</ul>'
          : '<p class="all-ok">目前登記的作業都 OK</p>';
        return '<div class="lookup-card" style="--g:' + color + '">' +
          '<h3><span class="no">' + r.no + '</span>' + esc(r.name) +
          (s && s.group ? '<small>' + esc(s.group) + '</small>' : '') +
          (bad.length ? '<span class="count">' + bad.length + ' 項要處理</span>' : '') + '</h3>' + list + '</div>';
      }).join('');
  }

  function toggleLookup() {
    const p = $('#lookupPanel');
    p.hidden = !p.hidden;
    $('#lookupBtn').setAttribute('aria-expanded', String(!p.hidden));
    if (!p.hidden) { $('#lookupInput').focus(); runLookup(); }
  }

  function goSummary() {
    const t = $('#pendingTitle');
    t.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
    t.focus({ preventScroll: true });
  }

  function renderSubmitMeta(text) {
    const sub = state.data.submissions;
    if (!sub || sub.error) return;
    if (text) { $('#submitMeta').textContent = text; return; }
    const t = sub.readAt ? new Date(sub.readAt) : null;
    $('#submitMeta').textContent = '試算表分頁「' + sub.tab + '」' +
      (t ? '，' + t.getHours() + ':' + String(t.getMinutes()).padStart(2, '0') + ' 同步' : '');
  }

  // 點格子：立即改畫面，0.7 秒內的連續點擊合併成一次寫回
  function cycleSubmission(btn) {
    const sub = state.data.submissions;
    const no = Number(btn.dataset.no);
    const hw = btn.dataset.hw;
    const rec = sub.records.find((r) => r.no === no);
    if (!rec) return;
    const cur = rec.status[hw] || '';
    const next = CYCLE[(CYCLE.indexOf(cur) + 1) % CYCLE.length];
    rec.status[hw] = next;
    state.pendingSub[no + '|' + hw] = next;
    renderSubmit();
    renderSubmitMeta('儲存中…');
    clearTimeout(state.subTimer);
    state.subTimer = setTimeout(flushSubmissions, 700);
  }

  async function flushSubmissions() {
    clearTimeout(state.subTimer);
    const keys = Object.keys(state.pendingSub);
    if (!keys.length || state.subSaving) return;
    const batch = state.pendingSub;
    state.pendingSub = {};
    state.subSaving = true;
    const items = keys.map((k) => {
      const i = k.indexOf('|');
      return { no: Number(k.slice(0, i)), homework: k.slice(i + 1), status: batch[k] };
    });
    try {
      await api('setSubmission', { items: items }, true);
      state.data.submissions.readAt = new Date().toISOString();
      renderSubmit();
    } catch (e) {
      toast('訂正狀態沒有存到：' + e.message + '，已重新讀取試算表', true);
      await refreshSubmissions(true);
    } finally {
      state.subSaving = false;
      if (Object.keys(state.pendingSub).length) flushSubmissions();
    }
  }

  async function refreshSubmissions(force) {
    if (!force && (Object.keys(state.pendingSub).length || state.subSaving)) return;
    try {
      state.data.submissions = await api('getSubmissions');
      renderSubmit();
    } catch (e) { /* 背景更新失敗就略過 */ }
  }

  async function addHomeworkColumn(e) {
    e.preventDefault();
    const name = $('#newHwName').value.trim();
    if (!name) return;
    await flushSubmissions();
    try {
      state.data.submissions = await api('addHomeworkColumn', { name: name }, true);
      $('#newHwName').value = '';
      renderSubmit();
      toast('已新增作業「' + name + '」');
    } catch (err) { toast(err.message, true); }
  }

  async function changeHwTab() {
    const sel = $('#hwTabSelect');
    let tab = sel.value;
    let create = false;
    if (tab === '__new') {
      tab = (prompt('新分頁名稱（例如：二段）') || '').trim();
      create = true;
      if (!tab) { renderSubmit(); return; }
    }
    await flushSubmissions();
    try {
      state.data.submissions = await api('setHwTab', { tab: tab, create: create }, true);
      renderSubmit();
      toast('已切換到分頁「' + tab + '」');
    } catch (err) {
      toast(err.message, true);
      renderSubmit();
    }
  }

  /* ================= 管理模式 ================= */
  function setAdmin(on) {
    state.admin = on;
    document.body.classList.toggle('admin', on);
    $('#modeBtn').textContent = on ? '管理模式：登出' : '老師登入';
    if (state.data) {
      renderScores();
      renderSeats();
      renderDrawResult();
    }
  }

  async function login(pw, silent) {
    state.password = pw;
    try {
      await api('verifyPassword', {}, true);
      try { sessionStorage.setItem(PW_KEY, pw); } catch (e) { /* 無痕模式 */ }
      setAdmin(true);
      return true;
    } catch (e) {
      state.password = '';
      try { sessionStorage.removeItem(PW_KEY); } catch (err) { /* ignore */ }
      if (!silent) throw e;
      return false;
    }
  }

  async function logout() {
    if (state.seatDirty && !confirm('座位還沒儲存，登出會放棄這些變更。確定嗎？')) return;
    await flushSubmissions();
    state.password = '';
    try { sessionStorage.removeItem(PW_KEY); } catch (e) { /* ignore */ }
    if (state.seatDirty) {
      state.seatGrid = clone(state.data.seats);
      state.seatDirty = false;
      state.seatHistory = [];
    }
    setAdmin(false);
    toast('已登出');
  }

  /* ================= 分頁 ================= */
  function showTab(name) {
    state.tab = name;
    $$('.tabs [role="tab"]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === name)));
    $$('.panel').forEach((p) => { p.hidden = p.id !== 'tab-' + name; });
    if (location.hash !== '#' + name) history.replaceState(null, '', '#' + name);
    if (name === 'submit' && state.data) refreshSubmissions();
  }

  /* ================= 事件 ================= */
  function bindEvents() {
    $$('.tabs [role="tab"]').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.tab)));
    $('#refreshBtn').addEventListener('click', () => load(true));

    // 登入
    const dlg = $('#loginDialog');
    $('#modeBtn').addEventListener('click', () => {
      if (state.admin) { logout(); return; }
      $('#loginError').hidden = true;
      $('#pwInput').value = '';
      dlg.showModal();
      $('#pwInput').focus();
    });
    $('#loginCancel').addEventListener('click', () => dlg.close());
    $('#loginForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = $('#loginSubmit');
      btn.disabled = true;
      btn.textContent = '確認中…';
      try {
        await login($('#pwInput').value);
        dlg.close();
        toast('已進入管理模式');
      } catch (err) {
        $('#loginError').textContent = err.message;
        $('#loginError').hidden = false;
      } finally {
        btn.disabled = false;
        btn.textContent = '登入';
      }
    });

    // 作業與分數
    $('#hwForm').addEventListener('submit', publishHomework);
    $('#groupCards').addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b || !state.admin) return;
      const g = b.dataset.group;
      if (b.classList.contains('act-full')) recordCheck(g, []);
      else if (b.classList.contains('act-miss')) openMissDialog(g);
      else if (b.classList.contains('act-pts')) openPointDialog({ group: g });
      else if (b.classList.contains('undo-check') && confirm('確定撤銷這筆作業紀錄嗎？分數也會一起扣回來。')) undoCheck(b.dataset.id);
    });
    $('#scoreLog').addEventListener('click', (e) => {
      const b = e.target.closest('.undo');
      if (!b || !confirm('確定撤銷這筆加分嗎？')) return;
      if (b.dataset.hw) undoCheck(b.dataset.id);
      else undoPoints([b.dataset.id]);
    });
    $('#checkLabel').value = defaultLabel();
    $('#checkLabel').addEventListener('input', () => { if (state.data) renderScores(); });

    // 作業未完成視窗
    $('#missInput').addEventListener('input', updateMissPreview);
    $('#missChips').addEventListener('click', (e) => {
      const b = e.target.closest('.miss-chip');
      if (!b) return;
      const nos = parseMissing();
      const no = Number(b.dataset.no);
      const next = nos.indexOf(no) >= 0 ? nos.filter((n) => n !== no) : nos.concat(no);
      $('#missInput').value = next.sort((a, c) => a - c).join(' ');
      updateMissPreview();
    });
    $('#missForm').addEventListener('submit', (e) => {
      e.preventDefault();
      const nos = parseMissing();
      if (!nos.length || !$('#missError').hidden) return;
      $('#missDialog').close();
      recordCheck(missGroup, nos);
    });
    $('#missCancel').addEventListener('click', () => $('#missDialog').close());
    $('#saveTotalsBtn').addEventListener('click', saveTotals);
    $('#newTermBtn').addEventListener('click', newTerm);

    // 加分視窗
    $('#pointPresets').addEventListener('click', (e) => {
      const b = e.target.closest('.pt-btn');
      if (b) pointFromDialog(Number(b.dataset.base));
    });
    $('#pointForm').addEventListener('submit', (e) => {
      e.preventDefault();
      const v = Number($('#pointCustom').value);
      if (!v) { toast('請輸入分數'); return; }
      pointFromDialog(v);
    });
    $('#pointCancel').addEventListener('click', () => $('#pointDialog').close());

    // 籤筒
    $$('input[name="drawMode"]').forEach((r) => r.addEventListener('change', syncDrawFields));
    $('#drawNoRepeat').addEventListener('change', renderDrawPool);
    $('#drawRole').addEventListener('change', renderDrawPool);
    $('#drawBtn').addEventListener('click', doDraw);
    $('#drawResetBtn').addEventListener('click', resetDrawn);
    $('#drawResult').addEventListener('click', (e) => {
      const b = e.target.closest('.pt-btn');
      if (b && state.admin) drawPoints(b);
    });

    // 座位
    $('#addRowBtn').addEventListener('click', addSeatRow);
    $('#delRowBtn').addEventListener('click', deleteSeatRow);
    $('#undoSeatBtn').addEventListener('click', undoSeats);
    $('#saveSeatBtn').addEventListener('click', saveSeats);
    $('#seatGrid').addEventListener('click', (e) => {
      const card = e.target.closest('.card');
      if (card && state.admin && Date.now() - state.lastDragEnd > 300) {
        openPointDialog({ student: card.dataset.name });
      }
    });

    // 訂正狀況
    $('#submitTable').addEventListener('click', (e) => {
      const b = e.target.closest('button.st');
      if (b && state.admin) cycleSubmission(b);
    });
    $('#addHwForm').addEventListener('submit', addHomeworkColumn);
    $('#lookupBtn').addEventListener('click', toggleLookup);
    $('#summaryBtn').addEventListener('click', goSummary);
    $('#lookupForm').addEventListener('submit', (e) => { e.preventDefault(); runLookup(); });
    $('#lookupInput').addEventListener('input', runLookup);
    $('#hwTabSelect').addEventListener('change', changeHwTab);

    // 在「訂正狀況」頁時每分鐘自動同步一次試算表
    setInterval(() => {
      if (state.tab === 'submit' && state.data && document.visibilityState === 'visible') refreshSubmissions();
    }, 60000);

    window.addEventListener('beforeunload', (e) => {
      if (state.seatDirty || Object.keys(state.pendingSub).length) { e.preventDefault(); e.returnValue = ''; }
    });
  }

  /* ================= 示範模式（GAS_URL 留空時） ================= */
  const DEMO_DB = (function () {
    const names = ['王玨琋', '王思甯', '王婷藝', '林杰宓', '林禹希', '林宸妃', '倪苡菲', '張安柔', '張芝婕', '許婕羚',
      '陳侑萱', '陳亮晴', '陳品璇', '陳秋彤', '陳語晴', '陳瑾妍', '曾楷扉', '黃羽璐', '黃煒筑', '劉羽瑄', '劉芸瑄', '劉宸均', '蔡誠萱'];
    const groups = [
      { name: '美秀組', members: { 教授: '蔡誠萱', 研究員: '張安柔', 文書1: '林宸妃', 文書2: '陳語晴', 總務: '黃煒筑' } },
      { name: '虎克組', members: { 教授: '倪苡菲', 研究員: '林杰宓', 文書1: '曾楷扉', 文書2: '劉羽瑄', 總務: '陳秋彤' } },
      { name: '林奈組', members: { 教授: '陳瑾妍', 研究員: '黃羽璐', 文書1: '劉芸瑄', 文書2: '', 總務: '許婕羚' } },
      { name: '達爾文組', members: { 教授: '陳品璇', 研究員: '林禹希', 文書1: '陳侑萱', 文書2: '', 總務: '劉宸均' } },
      { name: '孟德爾組', members: { 教授: '王思甯', 研究員: '王婷藝', 文書1: '王玨琋', 文書2: '陳亮晴', 總務: '張芝婕' } },
    ];
    const info = {};
    groups.forEach((g) => Object.keys(g.members).forEach((slot) => {
      const n = g.members[slot];
      if (n) info[n] = { group: g.name, slot: slot, role: slot.replace(/\d/, '') };
    }));
    const code = { O: 'OK', F: '未訂正', M: '缺交', _: '' };
    const raw = ['FO_', 'OO_', 'OOF', 'OOF', 'OO_', 'FF_', 'OO_', 'OOF', 'FOM', 'FO_', 'FF_', 'FF_', 'OF_', 'FF_', 'OO_', 'OO_',
      'FF_', 'FF_', 'FF_', 'FF_', 'FFF', 'FF_', 'FF_'];
    const hws = ['CH0-1', 'CH0-2', 'CH1-1'];
    return {
      weights: { 教授: 1, 研究員: 1.2, 文書: 1.5, 總務: 2, 全組: 1 },
      roleSlots: ['教授', '研究員', '文書1', '文書2', '總務'],
      hwStatuses: ['OK', '未訂正', '缺交', ''],
      groups: groups,
      students: names.map((n, i) => Object.assign({ no: i + 1, name: n }, info[n] || { group: null, role: null, slot: null })),
      seats: [
        ['王婷藝', '林杰宓', '林禹希', '林宸妃', '倪苡菲'],
        ['許婕羚', '曾楷扉', '陳侑萱', '劉宸均', '張安柔'],
        ['劉芸瑄', '陳品璇', '陳秋彤', '陳語晴', '黃煒筑'],
        ['陳瑾妍', '黃羽璐', '張芝婕', '陳亮晴', '蔡誠萱'],
        ['', '劉羽瑄', '王玨琋', '王思甯', ''],
      ],
      scores: { term: '第二次段考', startedAt: '10/19', totals: { 美秀組: 0, 虎克組: 0, 林奈組: 0, 達爾文組: 0, 孟德爾組: 0 }, log: [] },
      history: [],
      hwCheckRule: { full: 30, perMissing: 20, alert: 3 },
      hwChecks: { term: '第二次段考', records: [], counts: {} },
      homework: {
        current: { date: '10/8', text: '1. 白講CH2-1\n2. 習作 CH2-1\n3. 小藍CH2-1\n4. 訂正CH2-1' },
        previous: { date: '10/5', text: '1. 白講CH1-4\n2. 習作 CH1-4\n3. 小藍CH1-4\n4. 訂正CH1-3' },
      },
      submissions: {
        tab: '一段', tabs: ['一段'], homeworks: hws, readAt: new Date().toISOString(),
        records: names.map((n, i) => {
          const status = {};
          hws.forEach((h, k) => { status[h] = code[raw[i][k]]; });
          return { no: i + 1, name: n, status: status };
        }),
      },
    };
  })();

  function demoApi(action, p) {
    const db = DEMO_DB;
    const now = () => { const d = new Date(); return (d.getMonth() + 1) + '/' + d.getDate() + ' ' + d.getHours() + ':' + String(d.getMinutes()).padStart(2, '0'); };
    return new Promise((resolve, reject) => setTimeout(() => {
      try {
        if (action !== 'getAll' && action !== 'getSubmissions' && state.password !== 'demo') {
          throw new Error(action === 'verifyPassword' ? '密碼錯誤（示範模式的密碼是 demo）' : 'UNAUTHORIZED');
        }
        switch (action) {
          case 'getAll': return resolve(clone(db));
          case 'getSubmissions': return resolve(clone(db.submissions));
          case 'verifyPassword': return resolve({ valid: true });
          case 'saveSeats': db.seats = clone(p.grid); return resolve({ seats: clone(p.grid) });
          case 'addPoints': {
            const results = p.items.map((it) => {
              const w = db.weights[it.role] == null ? 1 : db.weights[it.role];
              const x = { id: Math.random().toString(16).slice(2, 10), time: now(), group: it.group, student: it.student || '',
                          role: it.role || '全組', base: it.base, weight: w, delta: round1(it.base * w), reason: it.reason || '', undone: false };
              db.scores.totals[x.group] = round1((db.scores.totals[x.group] || 0) + x.delta);
              db.scores.log.unshift(x);
              return x;
            });
            return resolve({ results: results, scores: clone(db.scores) });
          }
          case 'undoPoints': {
            const x = db.scores.log.find((l) => l.id === p.id);
            if (!x || x.undone) throw new Error('找不到這筆紀錄或已撤銷');
            x.undone = true;
            db.scores.totals[x.group] = round1(db.scores.totals[x.group] - x.delta);
            return resolve({ undone: p.id, scores: clone(db.scores) });
          }
          case 'setTotals': Object.assign(db.scores.totals, p.totals); return resolve({ scores: clone(db.scores) });
          case 'newTerm': {
            db.history.push({ term: db.scores.term, from: db.scores.startedAt, to: now().split(' ')[0], totals: clone(db.scores.totals) });
            Object.keys(db.scores.totals).forEach((k) => { db.scores.totals[k] = 0; });
            db.scores.term = p.term; db.scores.log = []; db.hwChecks = { term: p.term, records: [], counts: {} };
            return resolve({ scores: clone(db.scores), history: clone(db.history) });
          }
          case 'setHomework': {
            const entry = { date: now().split(' ')[0], text: p.text };
            if (p.edit) db.homework.current = entry;
            else { db.homework.previous = db.homework.current; db.homework.current = entry; }
            return resolve({ homework: clone(db.homework) });
          }
          case 'setSubmission':
            p.items.forEach((it) => { db.submissions.records.find((r) => r.no === it.no).status[it.homework] = it.status; });
            return resolve({ updated: p.items });
          case 'addHomeworkColumn':
            db.submissions.homeworks.push(p.name);
            db.submissions.records.forEach((r) => { r.status[p.name] = ''; });
            return resolve(clone(db.submissions));
          case 'setHwTab': throw new Error('示範模式不能切換分頁');
          case 'recordHomeworkCheck': {
            const delta = 30 - 20 * p.missing.length;
            const id = Math.random().toString(16).slice(2, 10);
            const rec = { id: id, date: now().split(' ')[0], label: p.label, group: p.group, missing: p.missing.slice().sort((a, b) => a - b), delta: delta, undone: false };
            db.hwChecks.records.push(rec);
            rec.missing.forEach((no) => { db.hwChecks.counts[no] = (db.hwChecks.counts[no] || 0) + 1; });
            db.scores.totals[p.group] = round1((db.scores.totals[p.group] || 0) + delta);
            db.scores.log.unshift({ id: id, time: now(), group: p.group, student: '', role: '全組', base: delta, weight: 1, delta: delta,
              reason: p.label + '：' + (rec.missing.length ? rec.missing.join('、') + ' 號未完成' : '全數完成'), undone: false });
            return resolve({ check: rec, scores: clone(db.scores), hwChecks: clone(db.hwChecks) });
          }
          case 'undoHomeworkCheck': {
            const rec = db.hwChecks.records.find((x) => x.id === p.id);
            if (!rec || rec.undone) throw new Error('找不到這筆紀錄或已撤銷');
            rec.undone = true;
            rec.missing.forEach((no) => { db.hwChecks.counts[no]--; if (!db.hwChecks.counts[no]) delete db.hwChecks.counts[no]; });
            db.scores.totals[rec.group] = round1(db.scores.totals[rec.group] - rec.delta);
            const l = db.scores.log.find((x) => x.id === p.id); if (l) l.undone = true;
            return resolve({ undone: p.id, scores: clone(db.scores), hwChecks: clone(db.hwChecks) });
          }
          default: throw new Error('示範模式不支援：' + action);
        }
      } catch (e) { reject(e); }
    }, 250));
  }

  /* ================= 啟動 ================= */
  async function init() {
    bindEvents();
    syncDrawFields();
    const fromHash = location.hash.replace('#', '');
    showTab(['home', 'points', 'draw', 'submit'].indexOf(fromHash) >= 0 ? fromHash : 'home');
    await load(false);
    let saved = '';
    try { saved = sessionStorage.getItem(PW_KEY) || ''; } catch (e) { /* ignore */ }
    if (saved) login(saved, true);
  }

  init();
})();
