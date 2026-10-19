/* ============================================================
   704 生物課 — 前端主程式（第二步：畫面、讀取資料、拖曳座位）
   第三步會補上：抽籤、加分、佈達作業、點選切換訂正狀態
   ============================================================ */
(function () {
  'use strict';

  const CFG = window.APP_CONFIG || {};
  const DEMO = !CFG.GAS_URL;
  const PW_KEY = 'bio704_pw';

  const $ = (s, el) => (el || document).querySelector(s);
  const $$ = (s, el) => Array.from((el || document).querySelectorAll(s));
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const state = {
    data: null,        // getAll 回傳的全部資料
    admin: false,
    password: '',
    tab: 'home',
    seatGrid: [],      // 座位表的編輯中版本
    seatHistory: [],   // 復原用
    seatDirty: false,
    sortables: [],
  };

  /* ---------------- API ---------------- */
  async function api(action, payload, write) {
    if (DEMO) return demoApi(action, payload);
    let res;
    if (write) {
      // 用 text/plain 送 JSON，避免瀏覽器先發 CORS 預檢請求（GAS 不支援）
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
    if (!j.ok) throw new Error(j.error === 'UNAUTHORIZED' ? '密碼錯誤，請重新登入' : j.error);
    return j.data;
  }

  async function load(manual) {
    if (manual && state.seatDirty && !confirm('座位還沒儲存，重新整理會放棄這些變更。確定嗎？')) return;
    const btn = $('#refreshBtn');
    btn.disabled = true;
    try {
      state.data = await api('getAll');
      state.seatDirty = false;
      state.seatHistory = [];
      renderAll();
      if (manual) toast('已讀取最新資料');
    } catch (e) {
      toast(e.message, true);
      if (!state.data) $('#termLabel').textContent = '讀取失敗：' + e.message;
    } finally {
      btn.disabled = false;
    }
  }

  /* ---------------- 共用 ---------------- */
  function groupColor(groupName) {
    const i = state.data.groups.findIndex((g) => g.name === groupName);
    return i < 0 ? 'var(--st-blank)' : 'var(--g' + (i % 5) + ')';
  }
  function student(name) {
    return state.data.students.find((s) => s.name === name);
  }
  function fmt(n) {
    return Number.isInteger(n) ? String(n) : n.toFixed(1);
  }
  let toastTimer;
  function toast(msg, isError) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.toggle('error', !!isError);
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), isError ? 4500 : 2500);
  }
  function soon() { toast('這個功能會在第三步接上'); }

  function renderAll() {
    renderHeader();
    renderHome();
    if (!state.seatDirty) state.seatGrid = clone(state.data.seats);
    renderSeats();
    renderGroups();
    renderSubmit();
  }
  function clone(x) { return JSON.parse(JSON.stringify(x)); }

  /* ---------------- 頂部 ---------------- */
  function renderHeader() {
    $('#className').textContent = CFG.CLASS_NAME || '704 生物課';
    document.title = CFG.CLASS_NAME || '704 生物課';
    const sc = state.data.scores;
    $('#termLabel').textContent = sc.term + '，' + sc.startedAt + ' 起計分' + (DEMO ? '（示範模式）' : '');
  }

  /* ---------------- 作業與分數 ---------------- */
  function renderHome() {
    const hw = state.data.homework || {};
    $('#hwCurrent').textContent = hw.current ? hw.current.text : '尚未佈達作業';
    $('#hwCurrentDate').textContent = hw.current ? hw.current.date + ' 佈達' : '';
    $('#hwPrevious').textContent = hw.previous ? hw.previous.text : '沒有紀錄';
    $('#hwPrevDate').textContent = hw.previous ? '（' + hw.previous.date + '）' : '';

    const sc = state.data.scores;
    const totals = state.data.groups.map((g) => sc.totals[g.name] || 0);
    const max = Math.max(1, ...totals);
    const top = Math.max(...totals);
    $('#scoreSince').textContent = '加分會乘上角色權重：教授 ×1、研究員 ×1.2、文書 ×1.5、總務 ×2';
    $('#scoreboard').innerHTML = state.data.groups.map((g, i) => {
      const total = totals[i];
      const count = Object.values(g.members).filter(Boolean).length;
      const lead = top > 0 && total === top;
      return '<li class="score-row' + (lead ? ' lead' : '') + '" style="--g:' + groupColor(g.name) + '">' +
        '<div class="score-name">' + esc(g.name) + '<small>' + count + ' 人</small></div>' +
        '<div class="score-track"><div class="score-bar" style="width:' + Math.max(0, total / max * 100) + '%"></div></div>' +
        '<div class="score-total">' + fmt(total) + '</div></li>';
    }).join('');

    const log = (sc.log || []).slice(0, 15);
    $('#scoreLog').innerHTML = log.length ? log.map((x) =>
      '<li class="' + (x.undone ? 'undone' : '') + '"><span>' + esc(x.time) + '</span>' +
      '<span><b>' + esc(x.group) + '</b> ' + esc(x.student || '') + (x.role && x.role !== '全組' ? '（' + esc(x.role) + ' ×' + x.weight + '）' : '') +
      ' <b>' + (x.delta > 0 ? '+' : '') + fmt(x.delta) + '</b> ' + esc(x.reason || '') + '</span></li>'
    ).join('') : '<li>這個段考還沒有加分紀錄</li>';
  }

  /* ---------------- 籤筒（第三步接上邏輯） ---------------- */
  function syncDrawFields() {
    const mode = $('input[name="drawMode"]:checked').value;
    $$('.draw-controls .field').forEach((f) => { f.hidden = f.dataset.for !== mode; });
  }

  /* ---------------- 座位表 ---------------- */
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
      delay: 120,              // 手機上長按一下才開始拖，避免跟捲動打架
      delayOnTouchOnly: true,
      ghostClass: 'sortable-ghost',
      chosenClass: 'sortable-chosen',
      onEnd: () => commitSeats(readGridFromDom()),
    };

    // 每個座位格是一個只能放一張卡的容器：
    // 拖進有人的格子 → 原本那位換到拖出來的位置（互換）
    $$('#seatGrid .seat-cell').forEach((cell) => {
      state.sortables.push(Sortable.create(cell, Object.assign({}, base, {
        onAdd: (evt) => {
          Array.from(evt.to.children)
            .filter((c) => c !== evt.item)
            .forEach((c) => evt.from.appendChild(c));
        },
      })));
    });
    // 待排區可以放很多張
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
    const w = state.data.weights;
    $('#groupList').innerHTML = state.data.groups.map((g) => {
      const rows = state.data.roleSlots
        .filter((slot) => g.members[slot])
        .map((slot) => {
          const role = slotLabel[slot];
          return '<dt>' + role + ' <small>×' + w[role] + '</small></dt><dd>' + esc(g.members[slot]) + '</dd>';
        }).join('');
      return '<div class="group" style="--g:' + groupColor(g.name) + '"><h3>' + esc(g.name) + '</h3><dl>' + rows + '</dl></div>';
    }).join('');
  }

  /* ---------------- 訂正狀況 ---------------- */
  const ST = { 'OK': ['st-ok', 'OK'], '未訂正': ['st-fix', '未訂正'], '缺交': ['st-miss', '缺交'], '': ['st-blank', '—'] };

  function renderSubmit() {
    const sub = state.data.submissions;
    if (!sub || sub.error) {
      $('#submitMeta').textContent = '';
      $('#pendingList').innerHTML = '<p class="error">讀不到作業表：' + esc(sub && sub.error) + '</p>';
      $('#submitTable').innerHTML = '';
      return;
    }
    const t = sub.readAt ? new Date(sub.readAt) : null;
    $('#submitMeta').textContent = '試算表分頁「' + sub.tab + '」' +
      (t ? '，' + t.getHours() + ':' + String(t.getMinutes()).padStart(2, '0') + ' 讀取' : '');

    // 每份作業誰還沒完成（新的作業排前面）
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
        return '<td><button type="button" class="st ' + st[0] + '" data-no="' + r.no + '" data-hw="' + esc(hw) + '">' + esc(st[1]) + '</button></td>';
      }).join('') + '</tr>'
    ).join('') + '</tbody>';
    $('#submitTable').innerHTML = head + body;
  }

  /* ---------------- 管理模式 ---------------- */
  function setAdmin(on) {
    state.admin = on;
    document.body.classList.toggle('admin', on);
    $('#modeBtn').textContent = on ? '管理模式：登出' : '老師登入';
    if (state.data) renderSeats();
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

  function logout() {
    if (state.seatDirty && !confirm('座位還沒儲存，登出會放棄這些變更。確定嗎？')) return;
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

  /* ---------------- 分頁 ---------------- */
  function showTab(name) {
    state.tab = name;
    $$('.tabs [role="tab"]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === name)));
    $$('.panel').forEach((p) => { p.hidden = p.id !== 'tab-' + name; });
    if (location.hash !== '#' + name) history.replaceState(null, '', '#' + name);
  }

  /* ---------------- 事件 ---------------- */
  function bindEvents() {
    $$('.tabs [role="tab"]').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.tab)));
    $('#refreshBtn').addEventListener('click', () => load(true));

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

    // 座位
    $('#addRowBtn').addEventListener('click', addSeatRow);
    $('#delRowBtn').addEventListener('click', deleteSeatRow);
    $('#undoSeatBtn').addEventListener('click', undoSeats);
    $('#saveSeatBtn').addEventListener('click', saveSeats);
    window.addEventListener('beforeunload', (e) => {
      if (state.seatDirty) { e.preventDefault(); e.returnValue = ''; }
    });

    // 籤筒（第三步）
    $$('input[name="drawMode"]').forEach((r) => r.addEventListener('change', syncDrawFields));
    $('#drawBtn').addEventListener('click', soon);

    // 作業佈達（第三步）
    $('#hwForm').addEventListener('submit', (e) => { e.preventDefault(); soon(); });

    // 訂正狀態切換（第三步）
    $('#submitTable').addEventListener('click', (e) => {
      if (state.admin && e.target.closest('button.st')) soon();
    });
  }

  /* ---------------- 示範模式（GAS_URL 留空時） ---------------- */
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
      scores: {
        term: '第二次段考', startedAt: '10/19',
        totals: { 美秀組: 35, 虎克組: 52, 林奈組: 28, 達爾文組: 41, 孟德爾組: 47 },
        log: [
          { id: 'd3', time: '10/19 09:12', group: '虎克組', student: '陳秋彤', role: '總務', base: 10, weight: 2, delta: 20, reason: '回答問題', undone: false },
          { id: 'd2', time: '10/19 09:05', group: '孟德爾組', student: '王婷藝', role: '研究員', base: 10, weight: 1.2, delta: 12, reason: '', undone: false },
          { id: 'd1', time: '10/19 08:58', group: '美秀組', student: '', role: '全組', base: 5, weight: 1, delta: 5, reason: '小組討論', undone: false },
        ],
      },
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

  function demoApi(action, payload) {
    return new Promise((resolve, reject) => setTimeout(() => {
      try {
        if (action === 'getAll') return resolve(clone(DEMO_DB));
        if (action === 'verifyPassword') {
          if (state.password !== 'demo') throw new Error('密碼錯誤（示範模式的密碼是 demo）');
          return resolve({ valid: true });
        }
        if (action === 'saveSeats') { DEMO_DB.seats = clone(payload.grid); return resolve({ seats: clone(payload.grid) }); }
        throw new Error('示範模式不支援：' + action);
      } catch (e) { reject(e); }
    }, 250));
  }

  /* ---------------- 啟動 ---------------- */
  async function init() {
    bindEvents();
    syncDrawFields();
    const fromHash = location.hash.replace('#', '');
    showTab(['home', 'draw', 'seats', 'submit'].indexOf(fromHash) >= 0 ? fromHash : 'home');
    await load(false);
    let saved = '';
    try { saved = sessionStorage.getItem(PW_KEY) || ''; } catch (e) { /* ignore */ }
    if (saved) login(saved, true);
  }

  // 第三步會用到
  window.Bio = { api: api, state: state, toast: toast, renderAll: renderAll, load: load };

  init();
})();
