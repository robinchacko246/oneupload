const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
// Build URLs from the origin so the page also works when opened as http://user:pass@host/
const api = (p) => new URL(p, location.origin).toString();
const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const mb = (bytes) => `${(bytes / 1024 / 1024).toFixed(bytes > 100 * 1024 * 1024 ? 0 : 1)} MB`;

// Any API call that comes back 401 means the login expired: go to the login page.
async function apiFetch(path, options) {
  const res = await fetch(api(path), { credentials: 'same-origin', ...options });
  if (res.status === 401) {
    location.href = `/login.html?next=${encodeURIComponent(location.pathname)}`;
    throw new Error('Login required');
  }
  return res;
}

// ---------- icons ----------
const ICONS = {
  youtube: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M9.5 7.8v8.4L16.5 12z"/></svg>',
  instagram:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="4" y="4" width="16" height="16" rx="5"/><circle cx="12" cy="12" r="3.6"/><circle cx="16.9" cy="7.1" r="1" fill="currentColor" stroke="none"/></svg>',
  facebook:
    '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M13.4 20v-7h2.4l.4-2.8h-2.8V8.4c0-.8.2-1.4 1.4-1.4h1.5V4.5c-.3 0-1.1-.1-2.1-.1-2.1 0-3.5 1.3-3.5 3.6v2.1H8.3V13h2.4v7z"/></svg>',
  rocket:
    '<svg class="rocket" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5 15c-1.5 1.3-2 4-2 4s2.7-.5 4-2"/><path d="M9 18l-3-3c.9-3.6 3.4-8.4 9-11 1.3 0 2.7 1.3 2.7 2.7-2.6 5.6-7.4 8.1-11 9z" fill="rgba(255,255,255,.12)"/><circle cx="14.5" cy="9.5" r="1.6"/><path d="M8.6 10.6L5 10l2-3h4M13.4 15.4L14 19l3-2v-4"/></svg>',
  check:
    '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="11" fill="#34d399"/><path d="M7 12.5l3.2 3.2L17 9" fill="none" stroke="#06281c" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  cross:
    '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="11" fill="#f87171"/><path d="M8.5 8.5l7 7M15.5 8.5l-7 7" stroke="#3b0a0a" stroke-width="2.6" stroke-linecap="round"/></svg>',
  spin: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="11" fill="#1a1a26"/><circle cx="12" cy="12" r="7" fill="none" stroke="#fbbf24" stroke-width="3" stroke-dasharray="30 14" stroke-linecap="round"><animateTransform attributeName="transform" type="rotate" from="0 12 12" to="360 12 12" dur="0.9s" repeatCount="indefinite"/></circle></svg>',
};
const PI_CLASS = { youtube: 'yt', instagram: 'ig', facebook: 'fb' };
const NAMES = { youtube: 'YouTube', instagram: 'Instagram', facebook: 'Facebook' };
const fillIcons = (root = document) =>
  root.querySelectorAll('[data-icon]').forEach((el) => {
    if (!el.innerHTML.trim()) el.innerHTML = ICONS[el.dataset.icon] || '';
  });
fillIcons();

// ---------- banner ----------
function showBanner(text, isError = false) {
  const banner = $('#banner');
  banner.hidden = false;
  banner.classList.toggle('error', isError);
  banner.textContent = text;
}
const params = new URLSearchParams(location.search);
if (params.get('error')) showBanner(params.get('error'), true);
else if (params.get('connected')) showBanner(`${params.get('connected') === 'youtube' ? 'YouTube' : 'Instagram'} connected ✓`);
if (params.size) history.replaceState(null, '', '/');

$('#logout').addEventListener('click', async () => {
  await fetch(api('/api/logout'), { method: 'POST' });
  location.href = '/login.html';
});

// ---------- accounts ----------
let status = {};

async function loadStatus() {
  const s = await apiFetch('/api/status').then((r) => r.json());
  status = s;
  if (s.storageWarning) showBanner(s.storageWarning, true);

  const yt = $('#acc-youtube');
  const ytWho = yt.querySelector('.who');
  yt.querySelectorAll('.actions').forEach((n) => n.remove());
  if (!s.youtube.configured) {
    ytWho.innerHTML = `<b>YouTube</b><small>.env-ൽ Google keys ചേർക്കണം</small>`;
  } else if (!s.youtube.connected) {
    ytWho.innerHTML = `<b>YouTube</b><span class="chip off"><span class="dot"></span>Not connected</span>`;
    yt.insertAdjacentHTML('beforeend', `<div class="actions"><a class="btn connect-yt" href="/auth/google">Connect YouTube</a></div>`);
  } else {
    ytWho.innerHTML = `<b>${esc(s.youtube.channelTitle)}</b><span class="chip"><span class="dot"></span>Connected</span>`;
    yt.insertAdjacentHTML(
      'beforeend',
      `<div class="actions"><a class="btn small" href="/auth/google">Reconnect</a><button class="btn small ghost" data-disconnect="youtube">Disconnect</button></div>`,
    );
  }

  const meta = $('#acc-meta');
  const metaWho = meta.querySelector('.who');
  meta.querySelectorAll('.actions, select').forEach((n) => n.remove());
  if (!s.meta.configured) {
    metaWho.innerHTML = `<b>Instagram</b><small>.env-ൽ Meta keys ചേർക്കണം</small>`;
  } else if (!s.meta.connected) {
    metaWho.innerHTML = `<b>Instagram</b><span class="chip off"><span class="dot"></span>Not connected</span>`;
    meta.insertAdjacentHTML(
      'beforeend',
      `<div class="actions"><a class="btn connect-ig" href="/auth/facebook">Connect Instagram</a><small class="muted" style="align-self:center">Facebook login വഴി</small></div>`,
    );
  } else {
    metaWho.innerHTML = s.meta.igUsername
      ? `<b>@${esc(s.meta.igUsername)}</b><span class="chip"><span class="dot"></span>Connected · ${esc(s.meta.pageName)}</span>`
      : `<b>${esc(s.meta.pageName)}</b><span class="chip warn"><span class="dot"></span>ഈ Page-ന് Instagram link ഇല്ല</span>`;
    if (s.meta.pages.length > 1) {
      const options = s.meta.pages
        .map(
          (p) =>
            `<option value="${esc(p.id)}" ${p.id === s.meta.selectedPageId ? 'selected' : ''}>${p.igUsername ? `@${esc(p.igUsername)} · ` : ''}${esc(p.name)}</option>`,
        )
        .join('');
      meta.insertAdjacentHTML('beforeend', `<select id="pageSelect" aria-label="Instagram account">${options}</select>`);
      $('#pageSelect').addEventListener('change', async (e) => {
        await apiFetch('/api/meta/page', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ pageId: e.target.value }),
        });
        loadStatus();
      });
    }
    meta.insertAdjacentHTML(
      'beforeend',
      `<div class="actions"><a class="btn small" href="/auth/facebook">Reconnect</a><button class="btn small ghost" data-disconnect="meta">Disconnect</button></div>`,
    );
  }

  $$('[data-disconnect]').forEach((b) =>
    b.addEventListener('click', async () => {
      if (!confirm('Disconnect this account?')) return;
      await apiFetch(`/api/disconnect/${b.dataset.disconnect}`, { method: 'POST' });
      loadStatus();
    }),
  );
}

// ---------- file picking ----------
const drop = $('#drop');
const input = $('#video');
const preview = $('#preview');

function showFile(file) {
  if (!file) return;
  drop.classList.add('has-file');
  $('#dropEmpty').hidden = true;
  $('#dropFile').hidden = false;
  $('#fileName').textContent = file.name;
  const tooBig = status.maxVideoBytes && file.size > status.maxVideoBytes;
  $('#fileTags').innerHTML = `<span class="tag ${tooBig ? 'bad' : ''}">${mb(file.size)}${tooBig ? ' · 300 MB-യിൽ കൂടുതൽ' : ''}</span>`;
  preview.src = URL.createObjectURL(file);
  preview.play().catch(() => {});
  preview.onloadedmetadata = () => {
    const vertical = preview.videoHeight > preview.videoWidth;
    const short = preview.duration <= 90;
    document.querySelector(`input[name=type][value=${vertical && short ? 'reel' : 'video'}]`).checked = true;
    const secs = Math.round(preview.duration);
    $('#fileTags').insertAdjacentHTML(
      'beforeend',
      `<span class="tag">${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}</span><span class="tag">${vertical ? 'Vertical' : 'Horizontal'}</span>`,
    );
  };
}

function clearFile() {
  drop.classList.remove('has-file');
  $('#dropEmpty').hidden = false;
  $('#dropFile').hidden = true;
  preview.pause();
  preview.removeAttribute('src');
  input.value = '';
}

$('#change').addEventListener('click', (e) => {
  e.preventDefault();
  input.click();
});
input.addEventListener('change', () => showFile(input.files[0]));
['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); }));
['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('over'); }));
drop.addEventListener('drop', (e) => {
  const file = e.dataTransfer.files[0];
  if (!file) return;
  const dt = new DataTransfer();
  dt.items.add(file);
  input.files = dt.files;
  showFile(file);
});

const caption = document.querySelector('textarea[name=caption]');
caption.addEventListener('input', () => ($('#capCount').textContent = `${caption.value.length} / 2200`));

// Remember which platforms were ticked last time (per device).
const PLATFORM_KEY = 'oneupload.platforms';
function restorePlatforms() {
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(PLATFORM_KEY)); } catch {}
  if (!Array.isArray(saved)) return;
  $$('input[name=platforms]').forEach((i) => (i.checked = saved.includes(i.value)));
}
$$('input[name=platforms]').forEach((i) =>
  i.addEventListener('change', () => {
    const ticked = $$('input[name=platforms]:checked').map((x) => x.value);
    localStorage.setItem(PLATFORM_KEY, JSON.stringify(ticked));
  }),
);
restorePlatforms();

function resetForm(form) {
  form.reset();
  restorePlatforms();
  clearFile();
  $('#capCount').textContent = '0 / 2200';
}

// ---------- upload animation ----------
const overlay = {
  el: $('#overlay'),
  ring: $('#ringFill'),
  circumference: 2 * Math.PI * 95,
  jobId: null,
  timer: null,

  open(platforms) {
    this.jobId = null;
    this.el.hidden = false;
    $('#orbit').classList.remove('done');
    $('#hideOverlay').hidden = true;
    $('#doneOverlay').hidden = true;
    $('#targets').innerHTML = platforms
      .map(
        (p) => `<div class="target waiting" data-p="${p}">
          <span class="pi ${PI_CLASS[p]}">${ICONS[p]}<span class="badge">${ICONS.spin}</span></span>
          <small>Waiting</small></div>`,
      )
      .join('');
    this.progress(0, 'Uploading…', 'Video അയക്കുന്നു');
  },

  progress(pct, title, text) {
    const p = Math.max(0, Math.min(100, pct));
    this.ring.style.strokeDashoffset = String(this.circumference * (1 - p / 100));
    $('#center').innerHTML = `<div class="pct">${Math.round(p)}<small>%</small></div>`;
    if (title) $('#stageTitle').textContent = title;
    if (text) $('#stageText').textContent = text;
  },

  launch(jobId) {
    this.jobId = jobId;
    this.ring.style.strokeDashoffset = '0';
    $('#center').innerHTML = ICONS.rocket;
    $('#stageTitle').textContent = 'Posting…';
    $('#stageText').textContent = 'YouTube, Instagram-ലേക്ക് അയക്കുന്നു';
    $('#hideOverlay').hidden = false;
    this.poll();
  },

  async poll() {
    clearTimeout(this.timer);
    if (!this.jobId || this.el.hidden) return;
    let job;
    try {
      job = await apiFetch(`/api/jobs/${this.jobId}`).then((r) => r.json());
    } catch {
      this.timer = setTimeout(() => this.poll(), 3000);
      return;
    }
    const entries = Object.entries(job.platforms || {});
    for (const [p, s] of entries) {
      const t = $(`.target[data-p="${p}"]`);
      if (!t) continue;
      const state = s.state === 'pending' ? 'waiting' : s.state;
      if (!t.classList.contains(state)) {
        t.className = `target ${state}`;
        t.querySelector('.badge').innerHTML = state === 'done' ? ICONS.check : state === 'error' ? ICONS.cross : ICONS.spin;
      }
      const label =
        state === 'done' ? 'Posted ✓' : state === 'error' ? 'Failed' : s.progress ? `${s.progress}%` : s.message || 'Working';
      t.querySelector('small').textContent = label;
      t.title = s.message || '';
    }
    const finished = entries.length && entries.every(([, s]) => s.state === 'done' || s.state === 'error');
    if (!finished) {
      const running = entries.find(([, s]) => s.state === 'running');
      if (running) $('#stageText').textContent = `${NAMES[running[0]]}: ${running[1].message || 'Working'}`;
      this.timer = setTimeout(() => this.poll(), 2000);
      return;
    }
    const failed = entries.filter(([, s]) => s.state === 'error');
    $('#orbit').classList.add('done');
    $('#hideOverlay').hidden = true;
    $('#doneOverlay').hidden = false;
    if (!failed.length) {
      $('#center').innerHTML = `<div style="font-size:64px;line-height:1">🎉</div>`;
      $('#stageTitle').textContent = 'എല്ലായിടത്തും പോസ്റ്റ് ആയി!';
      $('#stageText').textContent = 'Instagram-ൽ നിന്ന് Facebook-ലേക്ക് auto-share ആവും';
      confetti();
    } else {
      $('#center').innerHTML = `<div style="font-size:56px;line-height:1">⚠️</div>`;
      $('#stageTitle').textContent = `${failed.map(([p]) => NAMES[p]).join(', ')} failed`;
      $('#stageText').textContent = failed[0][1].message || 'Something went wrong';
    }
    loadJobs();
  },

  close() {
    clearTimeout(this.timer);
    this.el.hidden = true;
    loadJobs();
  },
};
$('#hideOverlay').addEventListener('click', () => overlay.close());
$('#doneOverlay').addEventListener('click', () => overlay.close());

function confetti() {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const box = document.createElement('div');
  box.className = 'confetti';
  const colors = ['#8b6cff', '#ff4f9a', '#ffb547', '#34d399', '#60a5fa', '#ffffff'];
  for (let i = 0; i < 90; i++) {
    const c = document.createElement('i');
    c.style.left = `${Math.random() * 100}%`;
    c.style.background = colors[i % colors.length];
    c.style.animationDuration = `${1.8 + Math.random() * 1.8}s`;
    c.style.animationDelay = `${Math.random() * 0.5}s`;
    c.style.transform = `rotate(${Math.random() * 360}deg)`;
    box.appendChild(c);
  }
  document.body.appendChild(box);
  setTimeout(() => box.remove(), 4500);
}

// ---------- sending ----------
// Local server: send the video straight to it.
function sendDirect(data, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', api('/api/upload'));
    xhr.upload.onprogress = (ev) => ev.lengthComputable && onProgress((ev.loaded / ev.total) * 100);
    xhr.onload = () => {
      let res = {};
      try { res = JSON.parse(xhr.responseText); } catch {}
      if (xhr.status === 401) location.href = '/login.html';
      if (xhr.status !== 200) reject(new Error(res.error || `Upload failed (${xhr.status})`));
      else resolve(res);
    };
    xhr.onerror = () => reject(new Error('Network error'));
    xhr.send(data);
  });
}

// Vercel: upload the video to Vercel Blob first (Vercel itself only accepts 4.5 MB per request),
// then tell the server where it is.
async function sendViaBlob(file, data, onProgress) {
  const { upload } = await import('https://esm.sh/@vercel/blob@2.9.0/client');
  const safeName = file.name.replace(/[^\w.\-]+/g, '_') || 'video.mp4';
  const options = {
    handleUploadUrl: api('/api/blob-upload'),
    multipart: file.size > 20 * 1024 * 1024,
    contentType: file.type || 'video/mp4',
    onUploadProgress: ({ percentage }) => onProgress(percentage),
  };
  let blob;
  try {
    blob = await upload(`uploads/${safeName}`, file, { ...options, access: 'private' });
  } catch (err) {
    if (!/access|private|public/i.test(String(err?.message))) throw err;
    blob = await upload(`uploads/${safeName}`, file, { ...options, access: 'public' });
  }
  const body = Object.fromEntries(data.entries());
  delete body.video;
  body.blobUrl = blob.url;
  body.fileName = file.name;
  const res = await apiFetch('/api/upload', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || `Upload failed (${res.status})`);
  return json;
}

$('#form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target;
  const platforms = $$('input[name=platforms]:checked').map((i) => i.value);
  if (!platforms.length) return alert('ഒരു platform എങ്കിലും തിരഞ്ഞെടുക്കൂ');
  const file = input.files[0];
  if (!file) {
    drop.classList.add('over');
    setTimeout(() => drop.classList.remove('over'), 600);
    return;
  }
  if (status.maxVideoBytes && file.size > status.maxVideoBytes) {
    return alert(`Video 300 MB-യിൽ കൂടുതലാണ് (${mb(file.size)}). ചെറുതാക്കി വീണ്ടും ശ്രമിക്കൂ.`);
  }

  const data = new FormData(form);
  data.delete('platforms');
  data.set('platforms', platforms.join(','));

  const submit = $('#submit');
  submit.disabled = true;
  overlay.open(platforms);
  const onProgress = (pct) =>
    overlay.progress(pct, 'Uploading…', `${mb((file.size * pct) / 100)} / ${mb(file.size)}`);
  try {
    const { jobId } = status.blobUploads ? await sendViaBlob(file, data, onProgress) : await sendDirect(data, onProgress);
    resetForm(form);
    overlay.launch(jobId);
  } catch (err) {
    overlay.close();
    showBanner(`Upload failed: ${err.message}`, true);
  } finally {
    submit.disabled = false;
  }
});

// ---------- history ----------
function timeAgo(iso) {
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return new Date(iso).toLocaleDateString();
}

const UI_ICONS = {
  trash:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6M10 11v6M14 11v6"/></svg>',
  open: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/></svg>',
  remove: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  retry:
    '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 0 1 15.5-6.2L21 8M21 3v5h-5M21 12a9 9 0 0 1-15.5 6.2L3 16M3 21v-5h5"/></svg>',
};

let allJobs = [];
let currentTab = 'all';
let shown = 15;

const isActive = (s) => s.state === 'pending' || s.state === 'running';
const jobActive = (j) => Object.values(j.platforms || {}).some(isActive);
const titleOf = (j) => (j.caption || '').split('\n')[0].trim() || j.fileName || 'Video';

// ---------- toast ----------
function toast(text, isError = false) {
  const t = $('#toast');
  t.textContent = text;
  t.classList.toggle('error', isError);
  t.hidden = false;
  t.style.animation = 'none';
  void t.offsetWidth;
  t.style.animation = '';
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => (t.hidden = true), isError ? 6000 : 3000);
}

// ---------- confirm dialog ----------
function askConfirm({ icon, title, text, yes = 'Delete' }) {
  return new Promise((resolve) => {
    $('#confirmIcon').innerHTML = icon;
    $('#confirmTitle').textContent = title;
    $('#confirmText').textContent = text;
    $('#confirmYes').textContent = yes;
    $('#confirm').hidden = false;
    const done = (answer) => {
      $('#confirm').hidden = true;
      $('#confirmYes').onclick = $('#confirmNo').onclick = $('#confirm').onclick = null;
      resolve(answer);
    };
    $('#confirmYes').onclick = () => done(true);
    $('#confirmNo').onclick = () => done(false);
    $('#confirm').onclick = (e) => e.target.id === 'confirm' && done(false);
  });
}

// ---------- rendering ----------
function rowLinks(j, p, s) {
  const open =
    s.url && !s.deleted
      ? `<a class="icon-btn" href="${esc(s.url)}" target="_blank" rel="noopener" title="Open">${UI_ICONS.open}</a>`
      : '';
  const del =
    s.state === 'done' && !s.deleted
      ? `<button class="icon-btn del" data-del="${esc(j.id)}" data-platform="${p}" title="Delete from ${NAMES[p]}">${UI_ICONS.trash}</button>`
      : '';
  const retry =
    s.state === 'error' && j.canRetry
      ? `<button class="btn small retry" data-retry="${esc(j.id)}" data-platform="${p}">${UI_ICONS.retry} Retry</button>`
      : '';
  return `<span class="links">${retry}${open}${del}</span>`;
}

function renderAll(jobs) {
  return jobs
    .map((j) => {
      const removeBtn = jobActive(j)
        ? ''
        : `<button class="icon-btn" data-remove="${esc(j.id)}" title="List-ൽ നിന്ന് മാറ്റുക">${UI_ICONS.remove}</button>`;
      return `<div class="job" data-job="${esc(j.id)}">
        <div class="job-head">
          <b>${esc(titleOf(j))} <span class="muted">· ${j.type === 'reel' ? 'Reel' : 'Video'}</span></b>
          <span class="menu"><time title="${esc(new Date(j.createdAt).toLocaleString())}">${timeAgo(j.createdAt)}</time>${removeBtn}</span>
        </div>
        ${Object.entries(j.platforms || {})
          .map(([p, s]) => {
            const active = isActive(s);
            const mark = active ? '<span class="spin"></span> ' : s.deleted ? '' : s.state === 'done' ? '✓ ' : '✕ ';
            const msg = s.deleted ? '<span class="tag deleted">Deleted</span>' : esc(s.message);
            return `<div class="prow ${s.deleted ? 'deleted' : ''}">
              <span class="pi ${PI_CLASS[p]}">${ICONS[p]}</span>
              <span class="msg ${s.state}">${mark}${msg}</span>
              ${rowLinks(j, p, s)}
              ${active ? `<span class="bar ${s.progress ? '' : 'indef'}"><i style="width:${s.progress || 0}%"></i></span>` : ''}
            </div>`;
          })
          .join('')}
      </div>`;
    })
    .join('');
}

function renderPlatform(posts, p) {
  return posts
    .map(({ j, s }) => {
      const sub = s.deleted
        ? '<span class="tag deleted">Deleted</span>'
        : `${timeAgo(j.createdAt)} · ${j.type === 'reel' ? 'Reel' : 'Video'}${s.account ? ` · @${esc(s.account)}` : ''}`;
      return `<div class="post ${s.deleted ? 'deleted' : ''}">
        <span class="pi ${PI_CLASS[p]}">${ICONS[p]}</span>
        <span class="txt"><b>${esc(titleOf(j))}</b><small>${sub}</small></span>
        ${rowLinks(j, p, s)}
      </div>`;
    })
    .join('');
}

function render() {
  // Tab counts: posts that are live on each platform.
  const live = (p) => allJobs.filter((j) => j.platforms?.[p]?.state === 'done' && !j.platforms[p].deleted).length;
  $$('[data-count]').forEach((el) => {
    el.textContent = el.dataset.count === 'all' ? allJobs.length : live(el.dataset.count);
  });
  const hasFb = allJobs.some((j) => j.platforms?.facebook);
  $('.tab[data-tab="facebook"]').hidden = !hasFb;
  if (!hasFb && currentTab === 'facebook') currentTab = 'all';
  $$('.tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === currentTab));

  let html = '';
  let total = 0;
  if (currentTab === 'all') {
    total = allJobs.length;
    html = renderAll(allJobs.slice(0, shown));
  } else {
    const posts = allJobs
      .filter((j) => j.platforms?.[currentTab]?.state === 'done')
      .map((j) => ({ j, s: j.platforms[currentTab] }));
    total = posts.length;
    html = renderPlatform(posts.slice(0, shown), currentTab);
  }
  $('#jobs').innerHTML =
    html ||
    `<div class="empty"><span class="big">🎬</span>${
      currentTab === 'all' ? 'ഇതുവരെ ഒന്നുമില്ല. ആദ്യത്തെ video അപ്‌ലോഡ് ചെയ്യൂ!' : `${NAMES[currentTab]}-ൽ ഇതുവരെ ഒന്നുമില്ല`
    }</div>`;
  $('#more').hidden = total <= shown;
  $('#more').textContent = `Show more (${total - shown})`;
}

async function loadJobs() {
  try {
    allJobs = await apiFetch('/api/jobs').then((r) => r.json());
  } catch {
    return;
  }
  render();
  // Only keep checking while something is uploading (saves storage operations).
  clearTimeout(loadJobs.timer);
  if (allJobs.some(jobActive)) loadJobs.timer = setTimeout(loadJobs, 5000);
}

$('#tabs').addEventListener('click', (e) => {
  const t = e.target.closest('.tab');
  if (!t) return;
  currentTab = t.dataset.tab;
  shown = 15;
  render();
});
$('#more').addEventListener('click', () => {
  shown += 15;
  render();
});
document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && loadJobs());

// ---------- delete a post / take an upload off the list ----------
async function deletePost(btn) {
  const id = btn.dataset.del;
  const p = btn.dataset.platform;
  const job = allJobs.find((j) => j.id === id);
  const extra = p === 'instagram' ? ' Facebook profile-ലേക്ക് auto-share ആയ copy Facebook-ൽ നിന്ന് വേറെ delete ചെയ്യണം.' : '';
  const ok = await askConfirm({
    icon: `<span class="pi ${PI_CLASS[p]}">${ICONS[p]}</span>`,
    title: `${NAMES[p]}-ൽ നിന്ന് delete ചെയ്യണോ?`,
    text: `"${titleOf(job)}" ${NAMES[p]}-ൽ നിന്ന് ഒഴിവാക്കും. ഇത് തിരിച്ചെടുക്കാൻ പറ്റില്ല.${extra}`,
  });
  if (!ok) return;
  btn.disabled = true;
  btn.innerHTML = '<span class="spin"></span>';
  try {
    const res = await apiFetch(`/api/jobs/${encodeURIComponent(id)}/delete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ platform: p }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error || 'Delete failed');
    const i = allJobs.findIndex((j) => j.id === id);
    if (i >= 0) allJobs[i] = json;
    render();
    toast(`${NAMES[p]}-ൽ നിന്ന് delete ചെയ്തു ✓`);
  } catch (err) {
    btn.disabled = false;
    btn.innerHTML = UI_ICONS.trash;
    toast(err.message, true);
  }
}

async function takeOffList(btn) {
  const id = btn.dataset.remove;
  const job = allJobs.find((j) => j.id === id);
  const ok = await askConfirm({
    icon: UI_ICONS.remove,
    title: 'List-ൽ നിന്ന് മാറ്റണോ?',
    text: `"${titleOf(job)}" ഈ list-ൽ നിന്ന് മാത്രം മാറും. YouTube/Instagram-ലെ post അവിടെ തന്നെ ഉണ്ടാവും.`,
    yes: 'Remove',
  });
  if (!ok) return;
  const card = btn.closest('.job');
  card?.classList.add('removing');
  try {
    const res = await apiFetch(`/api/jobs/${encodeURIComponent(id)}/remove`, { method: 'POST' });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Could not remove');
    allJobs = allJobs.filter((j) => j.id !== id);
    setTimeout(render, 250);
  } catch (err) {
    card?.classList.remove('removing');
    toast(err.message, true);
  }
}

async function retryPost(btn) {
  const id = btn.dataset.retry;
  const p = btn.dataset.platform;
  btn.disabled = true;
  btn.innerHTML = '<span class="spin"></span> Retrying';
  try {
    const res = await apiFetch(`/api/jobs/${encodeURIComponent(id)}/retry`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ platform: p }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error || 'Retry failed');
    toast(`${NAMES[p]} വീണ്ടും ശ്രമിക്കുന്നു…`);
    loadJobs();
  } catch (err) {
    btn.disabled = false;
    btn.innerHTML = `${UI_ICONS.retry} Retry`;
    toast(err.message, true);
  }
}

$('#jobs').addEventListener('click', (e) => {
  const retryBtn = e.target.closest('[data-retry]');
  if (retryBtn) return retryPost(retryBtn);
  const delBtn = e.target.closest('[data-del]');
  if (delBtn) return deletePost(delBtn);
  const listBtn = e.target.closest('[data-remove]');
  if (listBtn) return takeOffList(listBtn);
});

loadStatus().catch(() => {});
loadJobs();

