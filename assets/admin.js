/*
 * DevLinks admin — edit links.json in the browser and commit it to GitHub via the REST API.
 * No backend: the token stays in this browser and is only sent to api.github.com.
 */
(function () {
  'use strict';

  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

  const STORE_CFG = 'devlinks.cfg';
  const STORE_TOKEN = 'devlinks.token';
  const DATA_PATH = 'links.json';
  const MAX_UPLOAD = 1024 * 1024; // 1 MB

  const state = {
    data: null,
    sha: null,
    dirty: false,
    connected: false,
    cfg: { owner: '', repo: '', branch: 'main', token: '' },
    avatarOverride: null // { path, url } — local preview of a just-uploaded photo until Pages redeploys
  };

  // ---------- helpers ----------
  function uid() {
    return (window.crypto && crypto.randomUUID) ? crypto.randomUUID().slice(0, 8) : Math.random().toString(36).slice(2, 10);
  }

  function getPath(obj, path) {
    return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
  }

  function setPath(obj, path, value) {
    const keys = path.split('.');
    let o = obj;
    keys.slice(0, -1).forEach((k) => { if (o[k] == null || typeof o[k] !== 'object') o[k] = {}; o = o[k]; });
    o[keys[keys.length - 1]] = value;
  }

  function utf8ToB64(str) {
    return bytesToB64(new TextEncoder().encode(str));
  }

  function bytesToB64(bytes) {
    let bin = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    return btoa(bin);
  }

  function b64ToUtf8(b64) {
    const bin = atob(String(b64).replace(/\s/g, ''));
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  }

  function isValidLink(url) {
    const s = String(url || '').trim();
    return s !== '' && DevLinks.safeUrl(s) !== '#';
  }

  let toastTimer = null;
  function toast(msg, kind) {
    const el = $('#toast');
    el.textContent = msg;
    el.className = 'ad-toast' + (kind ? ' is-' + kind : '');
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, kind === 'err' ? 7000 : 4000);
  }

  function normalize(raw) {
    const d = (raw && typeof raw === 'object') ? JSON.parse(JSON.stringify(raw)) : {};
    d.profile = Object.assign({
      name: '', nameLocal: '', handle: '', role: '', bio: '', avatar: '',
      status: '', showStatus: false, stack: [], accent: '#3fb950'
    }, d.profile || {});
    if (!Array.isArray(d.profile.stack)) d.profile.stack = [];
    d.links = (Array.isArray(d.links) ? d.links : []).map((l) => Object.assign({
      id: uid(), title: '', subtitle: '', url: '', icon: 'link', featured: false, enabled: true
    }, l));
    if (typeof d.footer !== 'string') d.footer = '';
    return d;
  }

  function serialize() {
    const d = JSON.parse(JSON.stringify(state.data));
    d.profile.stack = d.profile.stack.map((s) => String(s).trim()).filter(Boolean);
    return JSON.stringify(d, null, 2) + '\n';
  }

  // ---------- GitHub API ----------
  function repoPath(p) {
    return p.split('/').map(encodeURIComponent).join('/');
  }

  async function gh(path, opts) {
    const c = state.cfg;
    const res = await fetch('https://api.github.com/repos/' + encodeURIComponent(c.owner) + '/' + encodeURIComponent(c.repo) + (path ? '/' + path : ''), Object.assign({}, opts, {
      headers: Object.assign({
        Accept: 'application/vnd.github+json',
        Authorization: 'Bearer ' + c.token,
        'X-GitHub-Api-Version': '2022-11-28'
      }, opts && opts.body ? { 'Content-Type': 'application/json' } : {})
    }));
    if (!res.ok) {
      let message = '';
      try { message = (await res.json()).message || ''; } catch (e) { /* ignore */ }
      const err = new Error(res.status + (message ? ' ' + message : ''));
      err.status = res.status;
      throw err;
    }
    return res.json();
  }

  async function loadRemote() {
    const c = state.cfg;
    try {
      const file = await gh('contents/' + repoPath(DATA_PATH) + '?ref=' + encodeURIComponent(c.branch), { cache: 'no-store' });
      setData(JSON.parse(b64ToUtf8(file.content)), file.sha);
      return true;
    } catch (err) {
      if (err.status === 404) {
        // Repo reachable but no links.json yet on this branch — Save will create it.
        try {
          await gh('', {});
          state.sha = null;
          toast('links.json not found on "' + c.branch + '" — Save will create it.', 'ok');
          return true;
        } catch (e) {
          throw new Error('Repository not found, or the token has no access to it.');
        }
      }
      if (err.status === 401) throw new Error('Token rejected (401). Check that it is valid and not expired.');
      throw err;
    }
  }

  async function saveRemote() {
    const body = {
      message: ($('#commitMsg').value || '').trim() || 'Update links via admin',
      content: utf8ToB64(serialize()),
      branch: state.cfg.branch
    };
    if (state.sha) body.sha = state.sha;
    const res = await gh('contents/' + repoPath(DATA_PATH), { method: 'PUT', body: JSON.stringify(body) });
    state.sha = res.content.sha;
  }

  async function uploadFile(path, bytes, message) {
    return gh('contents/' + repoPath(path), {
      method: 'PUT',
      body: JSON.stringify({ message: message, content: bytesToB64(bytes), branch: state.cfg.branch })
    });
  }

  // ---------- data + UI sync ----------
  function setData(raw, sha) {
    state.data = normalize(raw);
    state.sha = sha || null;
    state.avatarOverride = null;
    fillFields();
    renderLinks();
    refresh();
    setDirty(false);
  }

  function markDirty() {
    setDirty(true);
    refresh();
  }

  function setDirty(v) {
    state.dirty = v;
    $('#dirtyBadge').hidden = !v;
    $('#saveBtn').disabled = !(state.connected && v);
    $('#saveBtn').title = state.connected ? '' : 'Connect to GitHub first';
  }

  function fillFields() {
    $$('[data-bind]').forEach((el) => {
      const v = getPath(state.data, el.dataset.bind);
      if (el.dataset.type === 'bool') el.checked = !!v;
      else if (el.dataset.type === 'list') el.value = (v || []).join(', ');
      else el.value = v == null ? '' : v;
    });
  }

  function refresh() {
    renderPreview();
    updateAvatarPreview();
    updateSwatches();
    $('#linkCount').textContent = '(' + state.data.links.filter((l) => l.enabled !== false).length + ' visible / ' + state.data.links.length + ')';
  }

  function previewData() {
    const d = JSON.parse(JSON.stringify(state.data));
    const o = state.avatarOverride;
    if (o && d.profile.avatar === o.path) d.profile.avatar = o.url;
    return d;
  }

  function renderPreview() {
    DevLinks.render(previewData(), $('#preview'));
  }

  function updateAvatarPreview() {
    const el = $('#avatarPreview');
    const src = DevLinks.safeImg(previewData().profile.avatar);
    el.style.backgroundImage = src ? 'url(' + JSON.stringify(src) + ')' : '';
    el.textContent = src ? '' : ((state.data.profile.name || '?').charAt(0).toUpperCase() || '?');
  }

  function updateSwatches() {
    const accent = String(state.data.profile.accent || '').toLowerCase();
    $$('.ad-swatch').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.color.toLowerCase() === accent)));
  }

  // ---------- links list ----------
  const iconOptions = Object.keys(DevLinks.ICON_LABELS).map((k) => [k, DevLinks.ICON_LABELS[k]]);

  function renderLinks() {
    const list = $('#linkList');
    list.textContent = '';
    if (!state.data.links.length) {
      const li = document.createElement('li');
      li.className = 'ad-empty';
      li.textContent = '// no links yet — click "+ Add link"';
      list.appendChild(li);
      return;
    }
    const tpl = $('#linkTpl');
    state.data.links.forEach((link, i) => {
      const li = tpl.content.firstElementChild.cloneNode(true);
      li.dataset.index = i;
      li.classList.toggle('is-hidden-link', link.enabled === false);
      const sel = $('[data-f="icon"]', li);
      iconOptions.forEach(([value, label]) => {
        const opt = document.createElement('option');
        opt.value = value; opt.textContent = label;
        sel.appendChild(opt);
      });
      $$('[data-f]', li).forEach((el) => {
        const f = el.dataset.f;
        if (el.type === 'checkbox') el.checked = f === 'enabled' ? link.enabled !== false : !!link[f];
        else el.value = link[f] == null ? '' : link[f];
      });
      $('[data-act="up"]', li).disabled = i === 0;
      $('[data-act="down"]', li).disabled = i === state.data.links.length - 1;
      validateUrl(li, link.url);
      list.appendChild(li);
    });
  }

  function validateUrl(li, url) {
    const bad = String(url || '').trim() !== '' && !isValidLink(url);
    $('.ad-url-warn', li).hidden = !bad;
    $('[data-f="url"]', li).setAttribute('aria-invalid', String(bad));
  }

  function moveLink(from, to) {
    const links = state.data.links;
    if (to < 0 || to >= links.length || from === to) return;
    const [item] = links.splice(from, 1);
    links.splice(to, 0, item);
    renderLinks();
    markDirty();
  }

  function focusLink(index, selector) {
    const li = $('#linkList').children[index];
    const el = li && $(selector, li);
    if (el) el.focus();
  }

  // ---------- events ----------
  function bindEvents() {
    // Profile + footer fields
    $$('[data-bind]').forEach((el) => {
      el.addEventListener(el.type === 'checkbox' || el.type === 'color' ? 'change' : 'input', () => {
        let v;
        if (el.dataset.type === 'bool') v = el.checked;
        else if (el.dataset.type === 'list') v = el.value.split(',').map((s) => s.trim()).filter(Boolean);
        else v = el.value;
        setPath(state.data, el.dataset.bind, v);
        markDirty();
      });
      if (el.type === 'color') el.addEventListener('input', () => { state.data.profile.accent = el.value; markDirty(); });
    });

    $$('.ad-swatch').forEach((b) => b.addEventListener('click', () => {
      state.data.profile.accent = b.dataset.color;
      $('[data-bind="profile.accent"]').value = b.dataset.color;
      markDirty();
    }));

    // Link fields (delegated)
    const list = $('#linkList');
    const onField = (e) => {
      const el = e.target.closest('[data-f]');
      const li = e.target.closest('.ad-link');
      if (!el || !li) return;
      const link = state.data.links[+li.dataset.index];
      const f = el.dataset.f;
      link[f] = el.type === 'checkbox' ? el.checked : el.value;
      if (f === 'enabled') li.classList.toggle('is-hidden-link', !el.checked);
      if (f === 'url') validateUrl(li, el.value);
      markDirty();
    };
    list.addEventListener('input', onField);
    list.addEventListener('change', (e) => { if (e.target.type === 'checkbox' || e.target.tagName === 'SELECT') onField(e); });

    list.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-act]');
      const li = e.target.closest('.ad-link');
      if (!btn || !li) return;
      const i = +li.dataset.index;
      const act = btn.dataset.act;
      if (act === 'up') { moveLink(i, i - 1); focusLink(Math.max(0, i - 1), '[data-act="up"]:not(:disabled), [data-act="down"]'); }
      if (act === 'down') { moveLink(i, i + 1); focusLink(Math.min(state.data.links.length - 1, i + 1), '[data-act="down"]:not(:disabled), [data-act="up"]'); }
      if (act === 'delete') {
        const title = state.data.links[i].title || 'this link';
        if (!window.confirm('Delete "' + title + '"?')) return;
        state.data.links.splice(i, 1);
        renderLinks();
        markDirty();
        toast('Deleted "' + title + '". Not published until you Save.');
      }
    });

    // Drag & drop reorder
    let dragFrom = null;
    list.addEventListener('dragstart', (e) => {
      const li = e.target.closest('.ad-link');
      if (!li || !e.target.closest('.ad-handle')) return;
      dragFrom = +li.dataset.index;
      li.classList.add('is-dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', String(dragFrom));
      e.dataTransfer.setDragImage(li, 24, 24);
    });
    list.addEventListener('dragover', (e) => {
      const li = e.target.closest('.ad-link');
      if (dragFrom === null || !li) return;
      e.preventDefault();
      $$('.is-drop-target', list).forEach((x) => x.classList.remove('is-drop-target'));
      li.classList.add('is-drop-target');
    });
    list.addEventListener('drop', (e) => {
      const li = e.target.closest('.ad-link');
      if (dragFrom === null || !li) return;
      e.preventDefault();
      moveLink(dragFrom, +li.dataset.index);
      dragFrom = null;
    });
    list.addEventListener('dragend', () => {
      dragFrom = null;
      $$('.is-dragging, .is-drop-target', list).forEach((x) => x.classList.remove('is-dragging', 'is-drop-target'));
    });

    $('#addLink').addEventListener('click', () => {
      state.data.links.push({ id: uid(), title: 'New link', subtitle: '', url: 'https://', icon: 'link', featured: false, enabled: true });
      renderLinks();
      markDirty();
      const i = state.data.links.length - 1;
      focusLink(i, '[data-f="title"]');
      const el = $('#linkList').children[i];
      if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); $('[data-f="title"]', el).select(); }
    });

    // Avatar
    $('#avatarFile').addEventListener('change', async (e) => {
      const file = e.target.files[0];
      e.target.value = '';
      if (!file) return;
      if (!state.connected) { toast('Connect to GitHub first — the photo is uploaded into your repo.', 'err'); return; }
      if (file.size > MAX_UPLOAD) { toast('Photo is larger than 1 MB. Please resize it first.', 'err'); return; }
      const ext = (file.name.split('.').pop() || 'png').toLowerCase().replace(/[^a-z0-9]/g, '') || 'png';
      const path = 'assets/uploads/avatar-' + Date.now() + '.' + ext;
      try {
        toast('Uploading photo…');
        const bytes = new Uint8Array(await file.arrayBuffer());
        await uploadFile(path, bytes, 'Upload avatar');
        state.data.profile.avatar = path;
        state.avatarOverride = { path: path, url: URL.createObjectURL(file) };
        $('[data-bind="profile.avatar"]').value = path;
        markDirty();
        toast('Photo uploaded. Click "Save to GitHub" to use it on the page.', 'ok');
      } catch (err) {
        toast('Upload failed: ' + err.message, 'err');
      }
    });
    $('#avatarClear').addEventListener('click', () => {
      state.data.profile.avatar = '';
      $('[data-bind="profile.avatar"]').value = '';
      markDirty();
    });

    // Connection
    $('#connForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      if (state.dirty && !window.confirm('Loading from GitHub will replace your unsaved changes. Continue?')) return;
      state.cfg = {
        owner: $('#cfgOwner').value.trim(),
        repo: $('#cfgRepo').value.trim(),
        branch: $('#cfgBranch').value.trim() || 'main',
        token: $('#cfgToken').value.trim()
      };
      await connect($('#cfgRemember').checked);
    });

    $('#disconnectBtn').addEventListener('click', () => {
      localStorage.removeItem(STORE_TOKEN);
      sessionStorage.removeItem(STORE_TOKEN);
      state.cfg.token = '';
      $('#cfgToken').value = '';
      setConnected(false);
      toast('Disconnected. Token removed from this browser.');
    });

    // Save / import / export
    $('#saveBtn').addEventListener('click', save);
    document.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); if (!$('#saveBtn').disabled) save(); }
    });

    $('#downloadBtn').addEventListener('click', () => {
      const blob = new Blob([serialize()], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'links.json';
      document.body.appendChild(a);
      a.click();
      setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 0);
    });

    $('#importFile').addEventListener('change', async (e) => {
      const file = e.target.files[0];
      e.target.value = '';
      if (!file) return;
      try {
        const json = JSON.parse(await file.text());
        const sha = state.sha;
        setData(json, sha);
        markDirty();
        toast('Imported ' + file.name + '. Review, then Save.', 'ok');
      } catch (err) {
        toast('That file is not valid JSON: ' + err.message, 'err');
      }
    });

    window.addEventListener('beforeunload', (e) => {
      if (state.dirty) { e.preventDefault(); e.returnValue = ''; }
    });
  }

  async function save() {
    const empty = state.data.links.findIndex((l) => !String(l.title || '').trim());
    if (empty !== -1) { toast('Link ' + (empty + 1) + ' needs a title.', 'err'); focusLink(empty, '[data-f="title"]'); return; }
    const btn = $('#saveBtn');
    btn.disabled = true;
    btn.textContent = 'Saving…';
    try {
      await saveRemote();
      $('#commitMsg').value = '';
      setDirty(false);
      toast('Saved to GitHub. The live page updates after Pages redeploys (about a minute).', 'ok');
    } catch (err) {
      if (err.status === 409 || err.status === 422) {
        toast('links.json changed on GitHub since you loaded it. Download your JSON, then reconnect to reload.', 'err');
      } else {
        toast('Save failed: ' + err.message, 'err');
      }
      setDirty(true);
    } finally {
      btn.textContent = 'Save to GitHub';
    }
  }

  async function connect(remember) {
    const c = state.cfg;
    if (!c.owner || !c.repo || !c.token) { toast('Fill in owner, repository and token.', 'err'); return; }
    localStorage.setItem(STORE_CFG, JSON.stringify({ owner: c.owner, repo: c.repo, branch: c.branch }));
    localStorage.removeItem(STORE_TOKEN);
    sessionStorage.removeItem(STORE_TOKEN);
    (remember ? localStorage : sessionStorage).setItem(STORE_TOKEN, c.token);
    $('#connSummary').textContent = 'Connecting…';
    try {
      await loadRemote();
      setConnected(true);
      toast('Connected to ' + c.owner + '/' + c.repo + '.', 'ok');
    } catch (err) {
      setConnected(false);
      toast('Could not connect: ' + err.message, 'err');
    }
  }

  function setConnected(on) {
    const c = state.cfg;
    state.connected = on;
    const sum = $('#connSummary');
    sum.textContent = on ? 'Connected · ' + c.owner + '/' + c.repo + ' @ ' + c.branch : 'Not connected — editing a local copy';
    sum.classList.toggle('is-ok', on);
    $('#disconnectBtn').hidden = !on;
    if (on) $('#connPanel').open = false;
    setDirty(state.dirty);
  }

  async function loadLocal() {
    try {
      const res = await fetch(DATA_PATH + '?v=' + Date.now(), { cache: 'no-store' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      setData(await res.json(), null);
    } catch (err) {
      setData({}, null);
      toast('Could not read local links.json (' + err.message + '). Starting empty.', 'err');
    }
  }

  // ---------- init ----------
  async function init() {
    let saved = {};
    try { saved = JSON.parse(localStorage.getItem(STORE_CFG) || '{}'); } catch (e) { saved = {}; }

    // On <user>.github.io/<repo>/admin.html we can guess owner + repo.
    const host = location.hostname;
    if (!saved.owner && /\.github\.io$/i.test(host)) {
      saved.owner = host.split('.')[0];
      const first = location.pathname.split('/').filter(Boolean)[0];
      saved.repo = first && !/\.html$/i.test(first) ? first : host;
    }

    $('#cfgOwner').value = saved.owner || '';
    $('#cfgRepo').value = saved.repo || '';
    $('#cfgBranch').value = saved.branch || 'main';
    const token = localStorage.getItem(STORE_TOKEN) || sessionStorage.getItem(STORE_TOKEN) || '';
    $('#cfgToken').value = token;
    $('#cfgRemember').checked = !!localStorage.getItem(STORE_TOKEN);

    bindEvents();
    await loadLocal();

    if (saved.owner && saved.repo && token) {
      state.cfg = { owner: saved.owner, repo: saved.repo, branch: saved.branch || 'main', token: token };
      await connect(!!localStorage.getItem(STORE_TOKEN));
    }
  }

  init();
})();
