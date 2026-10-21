/* ============================================================
   704 生物課 — 上方工具列：計時器（倒數／碼表）＋ 音樂播放
   ============================================================ */
(function () {
  'use strict';

  const CFG = window.APP_CONFIG || {};
  const $ = (s, el) => (el || document).querySelector(s);
  const $$ = (s, el) => Array.from((el || document).querySelectorAll(s));
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  /* ================= 計時器 ================= */
  const T = {
    mode: 'down',        // 'down' 倒數 | 'up' 碼表
    setMs: 0,            // 倒數設定的時間（用 +1 分、+10 秒…累加）
    baseMs: 0,           // 暫停時累積的剩餘／經過時間
    startAt: 0,          // 開始時間（0 = 沒在跑）
    raf: 0,
    done: false,
  };

  function nowMs() {
    if (!T.startAt) return T.baseMs;
    const d = Date.now() - T.startAt;
    return T.mode === 'down' ? Math.max(0, T.baseMs - d) : T.baseMs + d;
  }
  function fmt(ms) {
    // 倒數用無條件進位（剩 0.3 秒時顯示 0:01），碼表用無條件捨去
    const total = T.mode === 'down' ? Math.ceil(ms / 1000) : Math.floor(ms / 1000);
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(s).padStart(2, '0');
  }

  function render() {
    const ms = nowMs();
    const text = fmt(ms);
    $('#timerDisplay').textContent = text;
    $('#bigTime').textContent = text;
    const running = !!T.startAt;
    $('#timerStart').textContent = running ? '暫停' : (T.mode === 'up' && T.baseMs > 0) || (T.mode === 'down' && T.baseMs < T.setMs && T.baseMs > 0 && !T.done) ? '繼續' : '開始';
    $('#bigModeLabel').textContent = T.mode === 'down' ? '倒數' : '碼表';
    $('#bigStart').textContent = $('#timerStart').textContent;
    const warn = T.mode === 'down' && running && ms <= 10000;
    document.body.classList.toggle('timer-warn', warn);
    document.body.classList.toggle('timer-done', T.done);
    document.body.classList.toggle('timer-running', running);
    // 倒數進度條
    const pct = T.mode === 'down' && T.setMs ? (ms / T.setMs) * 100 : 0;
    $('#timerProgress').style.width = (T.mode === 'down' ? pct : 0) + '%';
  }

  function tick() {
    render();
    if (T.mode === 'down' && T.startAt && nowMs() <= 0) { finish(); return; }
    T.raf = requestAnimationFrame(tick);
  }

  function start() {
    if (T.startAt) { pause(); return; }
    if (T.mode === 'down' && T.baseMs <= 0) T.baseMs = T.setMs;
    if (T.mode === 'down' && T.baseMs <= 0) { toast('先按 +1 分、+30 秒… 設定倒數時間'); return; }
    T.done = false;
    unlockAudio();
    T.startAt = Date.now();
    cancelAnimationFrame(T.raf);
    tick();
  }
  function pause() {
    T.baseMs = nowMs();
    T.startAt = 0;
    cancelAnimationFrame(T.raf);
    render();
  }
  function reset() {
    T.startAt = 0;
    T.done = false;
    T.baseMs = T.mode === 'down' ? T.setMs : 0;
    cancelAnimationFrame(T.raf);
    stopAlarm();
    render();
  }
  function setMode(mode) {
    T.mode = mode;
    $$('#timerModes button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.mode === mode)));
    $('#timerPresets').hidden = mode !== 'down';
    $('#bigPresets').hidden = mode !== 'down';
    reset();
  }
  const MAX_MS = 3 * 3600 * 1000;
  // 累加倒數時間；正在跑或暫停中也可以直接加時間
  function addTime(sec) {
    if (T.mode !== 'down') setMode('down');
    const add = sec * 1000;
    stopAlarm();
    if (T.done) { T.done = false; T.setMs = 0; T.baseMs = 0; }
    if (T.startAt) {
      const left = nowMs();
      T.baseMs = Math.min(MAX_MS, left + add);
      T.startAt = Date.now();
      T.setMs = Math.max(T.setMs, T.baseMs);
    } else {
      const fresh = T.baseMs === T.setMs;
      T.baseMs = Math.min(MAX_MS, T.baseMs + add);
      T.setMs = fresh ? T.baseMs : Math.max(T.setMs, T.baseMs);
    }
    render();
  }
  function clearTime() {
    T.setMs = 0;
    if (T.mode !== 'down') setMode('down');
    reset();
  }
  function finish() {
    T.startAt = 0;
    T.baseMs = 0;
    T.done = true;
    cancelAnimationFrame(T.raf);
    render();
    if (Music.playing()) Music.fadeOut();
    playAlarm();
  }

  /* 倒數結束的提示音（不需要任何音效檔） */
  let actx = null;
  let alarmTimer = 0;
  function unlockAudio() {
    try {
      actx = actx || new (window.AudioContext || window.webkitAudioContext)();
      if (actx.state === 'suspended') actx.resume();
    } catch (e) { /* 不支援就算了 */ }
  }
  function beep(at, freq) {
    const o = actx.createOscillator();
    const g = actx.createGain();
    o.type = 'sine';
    o.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(0.35, at + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, at + 0.35);
    o.connect(g).connect(actx.destination);
    o.start(at);
    o.stop(at + 0.4);
  }
  function playAlarm() {
    if (!actx) return;
    let rounds = 0;
    const ring = () => {
      const t = actx.currentTime;
      [0, 0.45, 0.9].forEach((d, i) => beep(t + d, i === 2 ? 1320 : 880));
      if (++rounds < 3) alarmTimer = setTimeout(ring, 1800);
    };
    ring();
  }
  function stopAlarm() { clearTimeout(alarmTimer); }

  /* 放大顯示（投影用） */
  function openBig() {
    $('#bigTimer').hidden = false;
    document.body.classList.add('big-open');
    $('#bigClose').focus();
  }
  function closeBig() {
    $('#bigTimer').hidden = true;
    document.body.classList.remove('big-open');
  }

  /* ================= 音樂 ================= */
  const MUSIC_KEY = 'bio704_music';
  const Music = (function () {
    let list = [];
    let current = -1;
    let ytPlayer = null;
    let ytReady = false;
    let ytLoading = null;
    let audio = null;
    let isPlaying = false;

    function load() {
      const fromCfg = (CFG.MUSIC || []).map((m) => ({ title: m.title, url: m.url, fixed: true }));
      let saved = [];
      try { saved = JSON.parse(localStorage.getItem(MUSIC_KEY) || '[]'); } catch (e) { /* ignore */ }
      list = fromCfg.concat(saved.filter((s) => !fromCfg.some((f) => f.url === s.url)));
    }
    function persist() {
      try { localStorage.setItem(MUSIC_KEY, JSON.stringify(list.filter((x) => !x.fixed))); } catch (e) { /* ignore */ }
    }

    function ytId(url) {
      const m = String(url).match(/(?:youtu\.be\/|v=|\/embed\/|\/shorts\/|\/live\/)([A-Za-z0-9_-]{11})/);
      return m ? m[1] : (/^[A-Za-z0-9_-]{11}$/.test(url) ? url : null);
    }
    function ytList(url) {
      const m = String(url).match(/[?&]list=([A-Za-z0-9_-]+)/);
      return m ? m[1] : null;
    }
    function isAudioFile(url) { return /\.(mp3|m4a|ogg|wav)(\?|$)/i.test(url); }

    function loadYT() {
      if (ytLoading) return ytLoading;
      ytLoading = new Promise((resolve, reject) => {
        if (window.YT && window.YT.Player) { resolve(); return; }
        const prev = window.onYouTubeIframeAPIReady;
        window.onYouTubeIframeAPIReady = () => { if (prev) prev(); resolve(); };
        const s = document.createElement('script');
        s.src = 'https://www.youtube.com/iframe_api';
        s.onerror = () => { ytLoading = null; reject(new Error('連不到 YouTube')); };
        document.head.appendChild(s);
        setTimeout(() => reject(new Error('YouTube 載入逾時')), 15000);
      });
      return ytLoading;
    }

    async function play(i) {
      const item = list[i];
      if (!item) return;
      current = i;
      stop(true);
      renderList();
      $('#musicNow').textContent = '載入中：' + item.title;
      if (isAudioFile(item.url)) {
        audio = audio || new Audio();
        audio.src = item.url;
        audio.loop = !!$('#musicLoop').checked;
        audio.volume = 1;
        audio.onended = () => { if (!audio.loop) setPlaying(false); };
        try { await audio.play(); setPlaying(true); }
        catch (e) { toast('無法播放這個音樂檔'); setPlaying(false); }
        return;
      }
      const id = ytId(item.url);
      const listId = ytList(item.url);
      if (!id && !listId) { toast('看不懂這個 YouTube 網址'); return; }
      $('#ytDock').hidden = false;
      try { await loadYT(); } catch (e) { toast(e.message); $('#ytDock').hidden = true; return; }
      const vars = { autoplay: 1, controls: 1, rel: 0, playsinline: 1 };
      if (ytPlayer && ytReady) {
        if (listId && !id) ytPlayer.loadPlaylist({ list: listId, listType: 'playlist' });
        else ytPlayer.loadVideoById(id);
        ytPlayer.setVolume(100);
        return;
      }
      ytPlayer = new YT.Player('ytPlayer', {
        width: 320, height: 180,
        videoId: id || undefined,
        playerVars: listId ? Object.assign({ listType: 'playlist', list: listId }, vars) : vars,
        events: {
          onReady: (e) => { ytReady = true; e.target.setVolume(100); e.target.playVideo(); },
          onStateChange: (e) => {
            if (e.data === YT.PlayerState.PLAYING) setPlaying(true);
            else if (e.data === YT.PlayerState.PAUSED) setPlaying(false);
            else if (e.data === YT.PlayerState.ENDED) {
              if ($('#musicLoop').checked) e.target.seekTo(0) || e.target.playVideo();
              else setPlaying(false);
            }
          },
          onError: (e) => {
            const why = (e.data === 101 || e.data === 150) ? '這部影片的上傳者不允許在其他網站播放，請換一首' : '這部影片無法播放（錯誤 ' + e.data + '）';
            toast(why);
            setPlaying(false);
          },
        },
      });
    }

    function toggle() {
      if (current < 0) {
        if (!list.length) { openPanel(); return; }
        play(0);
        return;
      }
      if (audio && audio.src && isAudioFile(list[current].url)) {
        if (audio.paused) { audio.play(); setPlaying(true); } else { audio.pause(); setPlaying(false); }
        return;
      }
      if (ytPlayer && ytReady) {
        if (isPlaying) ytPlayer.pauseVideo(); else { ytPlayer.setVolume(100); ytPlayer.playVideo(); }
      }
    }

    function stop(keepDock) {
      if (audio) { audio.pause(); }
      if (ytPlayer && ytReady) ytPlayer.stopVideo();
      setPlaying(false);
      if (!keepDock) { $('#ytDock').hidden = true; current = -1; renderList(); }
    }

    function fadeOut() {
      let v = 100;
      const step = setInterval(() => {
        v -= 10;
        if (audio && !audio.paused) audio.volume = Math.max(0, v / 100);
        if (ytPlayer && ytReady) ytPlayer.setVolume(Math.max(0, v));
        if (v <= 0) {
          clearInterval(step);
          if (audio) { audio.pause(); audio.volume = 1; }
          if (ytPlayer && ytReady) { ytPlayer.pauseVideo(); ytPlayer.setVolume(100); }
          setPlaying(false);
        }
      }, 120);
    }

    function setPlaying(on) {
      isPlaying = on;
      const btn = $('#musicBtn');
      btn.setAttribute('aria-pressed', String(on));
      btn.querySelector('.label').textContent = on ? '暫停音樂' : '播放音樂';
      const item = list[current];
      $('#musicNow').textContent = item ? (on ? '正在播放：' : '已暫停：') + item.title : '還沒選音樂';
    }

    function add(url, title) {
      url = String(url || '').trim();
      if (!url) return false;
      if (!isAudioFile(url) && !ytId(url) && !ytList(url)) { toast('請貼上 YouTube 網址或 mp3 檔的網址'); return false; }
      if (list.some((x) => x.url === url)) { toast('這首已經在清單裡了'); return false; }
      list.push({ title: String(title || '').trim() || (isAudioFile(url) ? url.split('/').pop() : '音樂 ' + (list.length + 1)), url: url });
      persist();
      renderList();
      return true;
    }
    function remove(i) {
      if (!list[i] || list[i].fixed) return;
      if (i === current) stop();
      list.splice(i, 1);
      if (current > i) current--;
      persist();
      renderList();
    }

    function renderList() {
      $('#musicList').innerHTML = list.length ? list.map((m, i) =>
        '<li class="' + (i === current ? 'current' : '') + '">' +
        '<button type="button" class="music-play" data-i="' + i + '">' + (i === current && isPlaying ? '■' : '▶') + '</button>' +
        '<span class="music-title" title="' + esc(m.url) + '">' + esc(m.title) +
          '<small>' + (isAudioFile(m.url) ? '音樂檔' : 'YouTube') + (m.fixed ? '・預設' : '') + '</small></span>' +
        (m.fixed ? '' : '<button type="button" class="music-del linkish" data-i="' + i + '">移除</button>') +
        '</li>'
      ).join('') : '<li class="empty">清單是空的。貼上 YouTube 網址加入第一首。</li>';
    }

    function openPanel() {
      const p = $('#musicPanel');
      p.hidden = !p.hidden;
      $('#musicMore').setAttribute('aria-expanded', String(!p.hidden));
      if (!p.hidden) $('#musicUrl').focus();
    }

    return {
      load: load, renderList: renderList, play: play, toggle: toggle, stop: stop, add: add, remove: remove,
      fadeOut: fadeOut, openPanel: openPanel, playing: () => isPlaying,
      setLoop: (on) => { if (audio) audio.loop = on; },
    };
  })();

  /* ================= 提示 ================= */
  function toast(msg) {
    const t = $('#toast');
    if (!t) { alert(msg); return; }
    $('#toastMsg').textContent = msg;
    $('#toastAction').hidden = true;
    t.classList.remove('error');
    t.classList.add('show');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => t.classList.remove('show'), 3500);
  }

  /* ================= 事件 ================= */
  function bind() {
    $$('#timerModes button').forEach((b) => b.addEventListener('click', () => setMode(b.dataset.mode)));
    $('#timerStart').addEventListener('click', start);
    $('#timerReset').addEventListener('click', reset);
    $('#timerDisplay').addEventListener('click', openBig);
    const onPreset = (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      if (b.hasAttribute('data-clear')) clearTime();
      else if (b.dataset.add) addTime(Number(b.dataset.add));
    };
    $('#timerPresets').addEventListener('click', onPreset);
    $('#timerBig').addEventListener('click', openBig);

    $('#bigStart').addEventListener('click', start);
    $('#bigReset').addEventListener('click', reset);
    $('#bigClose').addEventListener('click', closeBig);
    $('#bigPresets').addEventListener('click', onPreset);
    $('#bigTimer').addEventListener('click', (e) => { if (e.target.id === 'bigTimer') closeBig(); });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !$('#bigTimer').hidden) closeBig();
      // 放大畫面時，空白鍵 = 開始／暫停
      if (e.key === ' ' && !$('#bigTimer').hidden) { e.preventDefault(); start(); }
    });

    $('#musicBtn').addEventListener('click', () => { unlockAudio(); Music.toggle(); });
    $('#musicMore').addEventListener('click', Music.openPanel);
    $('#musicAddForm').addEventListener('submit', (e) => {
      e.preventDefault();
      if (Music.add($('#musicUrl').value, $('#musicName').value)) {
        $('#musicUrl').value = '';
        $('#musicName').value = '';
      }
    });
    $('#musicList').addEventListener('click', (e) => {
      const p = e.target.closest('.music-play');
      const d = e.target.closest('.music-del');
      if (p) {
        const i = Number(p.dataset.i);
        if (p.closest('li').classList.contains('current')) Music.toggle(); else Music.play(i);
      }
      if (d && confirm('從清單移除這首？')) Music.remove(Number(d.dataset.i));
    });
    $('#musicLoop').addEventListener('change', (e) => Music.setLoop(e.target.checked));
    $('#ytClose').addEventListener('click', () => Music.stop());
    document.addEventListener('click', (e) => {
      const p = $('#musicPanel');
      if (!p.hidden && !e.target.closest('#musicPanel') && !e.target.closest('#musicMore')) {
        p.hidden = true;
        $('#musicMore').setAttribute('aria-expanded', 'false');
      }
    });

    window.addEventListener('beforeunload', (e) => {
      if (T.startAt) { e.preventDefault(); e.returnValue = ''; }
    });
  }

  bind();
  Music.load();
  Music.renderList();
  setMode('down');
  window.ClassTools = { timer: T, music: Music };
})();
