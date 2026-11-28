const $ = (s) => document.querySelector(s);
// Language helper: tr('മലയാളം', 'English'). English unless the user picked Malayalam.
const tr = (ml, en) => (window.LANG === 'ml' ? ml : en);
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
else if (params.get('connected')) showBanner(`${params.get('connected')} connected ✓`);
const pendingPick = params.get('pick');
if (params.size) history.replaceState(null, '', `/${location.hash}`);

$('#logout').addEventListener('click', async () => {
  await fetch(api('/api/logout'), { method: 'POST' });
  location.href = '/login.html';
});

// ---------- user & channels ----------
let status = {};
let channels = [];
const chanById = (id) => channels.find((c) => c.id === id);

// Round avatar with a small platform badge. `c` is a channel or a post target.
function avatar(c, size = '') {
  const platform = c.platform;
  const name = c.name || c.channelName || NAMES[platform] || '?';
  const letter = esc(name.replace(/^@/, '').slice(0, 1).toUpperCase() || '?');
  const img = c.avatar
    ? `<img src="${esc(c.avatar)}" alt="" referrerpolicy="no-referrer" data-letter="${letter}" />`
    : `<span class="ph">${letter}</span>`;
  return `<span class="cav ${size}" title="${esc(name)} · ${NAMES[platform] || ''}">${img}<span class="pi pb ${PI_CLASS[platform]}">${ICONS[platform] || ''}</span></span>`;
}

// Profile pictures from Instagram/Facebook links expire: fall back to the first letter.
document.addEventListener(
  'error',
  (e) => {
    const img = e.target;
    if (img.tagName !== 'IMG' || !img.closest('.cav')) return;
    const ph = document.createElement('span');
    ph.className = 'ph';
    ph.textContent = img.dataset.letter || '?';
    img.replaceWith(ph);
  },
  true,
);

const channelLabel = (c) => (c.platform === 'instagram' ? `@${c.username || c.name}` : c.name);

async function loadStatus() {
  const s = await apiFetch('/api/status').then((r) => r.json());
  status = s;
  channels = s.channels || [];
  if (s.storageWarning) showBanner(s.storageWarning, true);
  const who = s.user?.name || s.user?.email || '';
  $('#meName').textContent = who;
  $('#meAvatar').textContent = (who.trim()[0] || '?').toUpperCase();
  renderChannelPicker();
  renderChannelMini();
  renderChannelList();
  renderSideChannels();
  if (!$('[data-view="channel"].view').hidden) renderChannelView();
  if (!channels.length && !location.hash) location.hash = '#channels';
}

function renderChannelMini() {
  $('#channelMini').innerHTML = channels.length
    ? channels.map((c) => avatar(c)).join('') + `<a class="btn small" href="#channels">＋ Add</a>`
    : `<div class="empty" style="padding:8px">${tr('Channels ഒന്നുമില്ല. <a href="#channels">ചേർക്കൂ →</a>', 'No channels yet. <a href="#channels">Add one →</a>')}</div>`;
}

// ---------- composer: which channels to post to (remembered per device) ----------
const CHANNEL_KEY = 'oneupload.channels';
function savedChannelIds() {
  try {
    const v = JSON.parse(localStorage.getItem(CHANNEL_KEY));
    return Array.isArray(v) ? v : null;
  } catch {
    return null;
  }
}

function renderChannelPicker() {
  const box = $('#channelPicker');
  if (!channels.length) {
    box.innerHTML = `<div class="picker-empty">${tr('ആദ്യം ഒരു channel ചേർക്കൂ', 'Add a channel first')} → <a href="#channels">Channels</a></div>`;
    return updatePickedCount();
  }
  const saved = savedChannelIds();
  box.innerHTML = channels
    .map((c) => {
      const on = saved ? saved.includes(c.id) : c.platform !== 'facebook';
      return `<label class="chpick" title="${esc(channelLabel(c))}">
        <input type="checkbox" name="channels" value="${esc(c.id)}" data-platform="${c.platform}" ${on ? 'checked' : ''} />
        ${avatar(c)}<span class="tick">✓</span><small>${esc(channelLabel(c))}</small>
      </label>`;
    })
    .join('');
  if (photoMode()) setPhotoUi(true);
  updatePickedCount();
}

function pickedChannels() {
  return $$('input[name=channels]:checked:not(:disabled)').map((i) => chanById(i.value)).filter(Boolean);
}

function updatePickedCount() {
  const n = pickedChannels().length;
  $('#pickedCount').textContent = channels.length ? `· ${n} / ${channels.length} selected` : '';
}

$('#channelPicker').addEventListener('change', () => {
  const ticked = $$('input[name=channels]:checked').map((x) => x.value);
  localStorage.setItem(CHANNEL_KEY, JSON.stringify(ticked));
  updatePickedCount();
});

// ---------- Channels page ----------
function renderChannelList() {
  const order = { youtube: 0, instagram: 1, facebook: 2 };
  const list = [...channels].sort((a, b) => order[a.platform] - order[b.platform]);
  $('#channelList').innerHTML = list.length
    ? list
        .map((c) => {
          const reconnect = c.platform === 'youtube' ? '/auth/google' : '/auth/facebook';
          const sub = [NAMES[c.platform], c.platform === 'instagram' && c.info?.pageName ? `Page: ${c.info.pageName}` : '', c.canDelete ? '' : tr('⚠️ delete permission ഇല്ല — Reconnect ചെയ്യൂ', '⚠️ no delete permission — Reconnect')]
            .filter(Boolean)
            .join(' · ');
          return `<div class="chrow">${avatar(c)}
            <span class="txt"><b>${esc(channelLabel(c))}</b><small>${esc(sub)}</small></span>
            <span class="acts"><a class="btn small" href="${reconnect}">Reconnect</a>
              <button class="btn small ghost" data-remove-channel="${esc(c.id)}">Remove</button></span>
          </div>`;
        })
        .join('')
    : `<div class="empty"><span class="big">🔗</span>${tr('ഇതുവരെ channels ഇല്ല. മുകളിൽ നിന്ന് YouTube / Instagram / Facebook ചേർക്കൂ.', 'No channels yet. Connect YouTube / Instagram / Facebook above.')}</div>`;
}

$('#channelList').addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-remove-channel]');
  if (!btn) return;
  const c = chanById(btn.dataset.removeChannel);
  const ok = await askConfirm({
    icon: avatar(c),
    title: tr(`${channelLabel(c)} മാറ്റണോ?`, `Remove ${channelLabel(c)}?`),
    text: tr('ഈ channel app-ൽ നിന്ന് മാറും. ഇതിനകം post ചെയ്തവ അവിടെ തന്നെ ഉണ്ടാവും. Schedule ചെയ്തവ ഈ channel-ലേക്ക് പോവില്ല.', 'The channel is removed from the app and its access tokens are deleted. Posts already published stay where they are. Scheduled posts will not go to this channel.'),
    yes: 'Remove',
  });
  if (!ok) return;
  await apiFetch(`/api/channels/${encodeURIComponent(c.id)}/delete`, { method: 'POST' });
  toast('Channel removed');
  loadStatus();
});

// After Facebook login: choose which Instagram accounts / Pages to add.
async function openPicker(id) {
  const res = await apiFetch(`/api/connect/${encodeURIComponent(id)}`);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return showBanner(data.error || 'Could not load accounts', true);
  const row = (kind, value, title, sub, pic, connected) => `
    <label class="pick-row ${connected ? 'disabled' : ''}">
      <input type="checkbox" name="pick-${kind}" value="${esc(value)}" ${connected ? 'checked disabled' : kind === 'instagram' ? 'checked' : ''} />
      ${avatar({ platform: kind, name: title, avatar: pic })}
      <span class="txt"><b>${esc(title)}</b><small>${esc(sub)}${connected ? ' · already added' : ''}</small></span>
    </label>`;
  $('#pickerList').innerHTML =
    data.options
      .map(
        (o) =>
          (o.ig ? row('instagram', o.ig.id, `@${o.ig.username}`, `Instagram · ${o.pageName}`, o.ig.picture, o.ig.connected) : '') +
          row('facebook', o.pageId, o.pageName, 'Facebook Page', o.pagePicture, o.pageConnected),
      )
      .join('') || `<div class="empty">${tr('Accounts ഒന്നും കിട്ടിയില്ല', 'No accounts found')}</div>`;
  $('#picker').hidden = false;
  $('#pickerForm').onsubmit = async (e) => {
    e.preventDefault();
    const pick = (kind) => $$(`input[name=pick-${kind}]:checked:not(:disabled)`).map((i) => i.value);
    const r = await apiFetch(`/api/connect/${encodeURIComponent(id)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ instagram: pick('instagram'), facebook: pick('facebook') }),
    });
    const out = await r.json().catch(() => ({}));
    $('#picker').hidden = true;
    if (!r.ok) return toast(out.error || 'Could not add', true);
    toast(out.added ? `${out.added} channel${out.added > 1 ? 's' : ''} added ✓` : 'Updated ✓');
    loadStatus();
  };
}
$('#pickerCancel').addEventListener('click', () => ($('#picker').hidden = true));



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
  $('#fileTags').innerHTML = `<span class="tag ${tooBig ? 'bad' : ''}">${mb(file.size)}${tooBig ? tr(' · 300 MB-യിൽ കൂടുതൽ', ' · over 300 MB') : ''}</span>`;
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
  picked = [];
  thumbUrls.forEach((u) => URL.revokeObjectURL(u));
  thumbUrls = [];
  drop.classList.remove('has-file');
  $('#dropEmpty').hidden = false;
  $('#dropFile').hidden = true;
  $('#mediaGrid').hidden = true;
  preview.pause();
  preview.removeAttribute('src');
  input.value = '';
  setPhotoUi(false);
}

// ---------- picked files: one video, or 1–10 photos/videos (carousel) ----------
let picked = [];
let thumbUrls = [];
let addingMore = false;
const isImage = (f) => f.type.startsWith('image/');
const isVideo = (f) => f.type.startsWith('video/');
const photoMode = () => picked.length > 1 || (picked.length === 1 && isImage(picked[0]));

function takeFiles(files) {
  let list = [...files].filter((f) => isImage(f) || isVideo(f));
  if (!list.length) return toast('Video അല്ലെങ്കിൽ photo തിരഞ്ഞെടുക്കൂ', true);
  if (addingMore) list = [...picked, ...list];
  addingMore = false;
  if (list.length > 10) toast('Carousel-ൽ പരമാവധി 10 items. ആദ്യത്തെ 10 എടുത്തു', true);
  picked = list.slice(0, 10);
  renderPicked();
}

// Photo posts can't go to YouTube, so its tile is switched off while photos are picked.
function setPhotoUi(on) {
  // YouTube channels can't take photo posts: switch them off while photos are picked.
  $$('input[name=channels][data-platform=youtube]').forEach((i) => {
    i.disabled = on;
    i.closest('.chpick').title = on ? tr('YouTube photo posts സ്വീകരിക്കില്ല', 'YouTube does not accept photo posts') : channelLabel(chanById(i.value) || {});
  });
  updatePickedCount?.();
  document.querySelector('input[name=type][value=photo]').disabled = !on;
  $$('input[name=type]:not([value=photo])').forEach((r) => (r.disabled = on));
  if (on) document.querySelector('input[name=type][value=photo]').checked = true;
  else if (document.querySelector('input[name=type][value=photo]').checked) {
    document.querySelector('input[name=type][value=reel]').checked = true;
  }
}

function renderPicked() {
  thumbUrls.forEach((u) => URL.revokeObjectURL(u));
  thumbUrls = [];
  if (!picked.length) return clearFile();
  drop.classList.add('has-file');
  $('#dropEmpty').hidden = true;
  if (!photoMode()) {
    $('#mediaGrid').hidden = true;
    setPhotoUi(false);
    showFile(picked[0]);
    return;
  }
  $('#dropFile').hidden = true;
  preview.pause();
  setPhotoUi(true);
  const total = picked.reduce((n, f) => n + f.size, 0);
  const grid = $('#mediaGrid');
  grid.hidden = false;
  grid.innerHTML =
    picked
      .map((f, i) => {
        const url = URL.createObjectURL(f);
        thumbUrls.push(url);
        const media = isVideo(f) ? `<video src="${url}" muted playsinline></video><span class="vbadge">▶</span>` : `<img src="${url}" alt="" />`;
        return `<div class="thumb">${media}<span class="num">${i + 1}</span>
          <div class="tbtns">
            <button type="button" data-move="${i}" data-dir="-1" ${i === 0 ? 'disabled' : ''} aria-label="Move left">‹</button>
            <button type="button" data-drop="${i}" aria-label="Remove">✕</button>
            <button type="button" data-move="${i}" data-dir="1" ${i === picked.length - 1 ? 'disabled' : ''} aria-label="Move right">›</button>
          </div></div>`;
      })
      .join('') +
    (picked.length < 10 ? '<button type="button" class="thumb add" data-add="1">＋<small>Add</small></button>' : '') +
    `<div class="grid-info">${picked.length === 1 ? 'Photo post' : `Carousel · ${picked.length} items`} · ${mb(total)}${
      total > (status.maxVideoBytes || Infinity) ? ` · <b style="color:var(--err)">${tr('300 MB-യിൽ കൂടുതൽ', 'over 300 MB')}</b>` : ''
    }<br><small class="muted">${tr('Instagram-നായി photos 4:5 – 1.91:1 ratio-യിലേക്ക് crop ചെയ്യും', 'Photos are cropped to a 4:5 – 1.91:1 ratio for Instagram')}</small></div>`;
}

$('#mediaGrid').addEventListener('click', (e) => {
  e.preventDefault(); // don't let the surrounding label open the file picker
  const move = e.target.closest('[data-move]');
  const del = e.target.closest('[data-drop]');
  const add = e.target.closest('[data-add]');
  if (move) {
    const i = Number(move.dataset.move);
    const j = i + Number(move.dataset.dir);
    [picked[i], picked[j]] = [picked[j], picked[i]];
    renderPicked();
  } else if (del) {
    picked.splice(Number(del.dataset.drop), 1);
    renderPicked();
  } else if (add) {
    addingMore = true;
    input.click();
  }
});

$('#change').addEventListener('click', (e) => {
  e.preventDefault();
  input.click();
});
input.addEventListener('change', () => {
  if (input.files.length) takeFiles(input.files);
  else addingMore = false;
  input.value = '';
});
['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); }));
['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('over'); }));
drop.addEventListener('drop', (e) => {
  if (e.dataTransfer.files.length) takeFiles(e.dataTransfer.files);
});

const caption = document.querySelector('textarea[name=caption]');
caption.addEventListener('input', () => ($('#capCount').textContent = `${caption.value.length} / 2200`));

function resetForm(form) {
  form.reset();
  clearFile();
  renderChannelPicker();
  $('#capCount').textContent = '0 / 2200';
  updateWhen();
}

// ---------- upload animation ----------
const overlay = {
  el: $('#overlay'),
  ring: $('#ringFill'),
  circumference: 2 * Math.PI * 95,
  jobId: null,
  timer: null,

  // list: channels (or post targets) with { id, platform, name/channelName, avatar }.
  open(list) {
    this.jobId = null;
    this.el.hidden = false;
    $('#orbit').classList.remove('done');
    $('#hideOverlay').hidden = true;
    $('#doneOverlay').hidden = true;
    $('#targets').innerHTML = list
      .map(
        (c) => `<div class="target waiting" data-p="${esc(c.id)}">
          <span class="tav">${avatar(c)}<span class="badge">${ICONS.spin}</span></span>
          <small>Waiting</small></div>`,
      )
      .join('');
    this.progress(0, 'Uploading…', tr('Video അയക്കുന്നു', 'Sending the video'));
  },

  progress(pct, title, text) {
    const p = Math.max(0, Math.min(100, pct));
    this.ring.style.strokeDashoffset = String(this.circumference * (1 - p / 100));
    $('#center').innerHTML = `<div class="pct">${Math.round(p)}<small>%</small></div>`;
    if (title) $('#stageTitle').textContent = title;
    if (text) $('#stageText').textContent = text;
  },

  // A scheduled post or draft was saved (nothing is posted yet).
  saved(job) {
    this.ring.style.strokeDashoffset = '0';
    $('#orbit').classList.add('done');
    const scheduled = job.status === 'scheduled';
    $('#center').innerHTML = `<div style="font-size:60px;line-height:1">${scheduled ? '📅' : '📝'}</div>`;
    $('#stageTitle').textContent = scheduled ? 'Scheduled!' : 'Draft saved';
    $('#stageText').textContent = scheduled
      ? tr(`${fmtWhen(job.scheduledAt)}-ന് ഓട്ടോമാറ്റിക്കായി post ആവും`, `Will be posted automatically on ${fmtWhen(job.scheduledAt)}`)
      : tr('Queue → Drafts-ൽ നിന്ന് എപ്പോൾ വേണമെങ്കിലും post ചെയ്യാം', 'Post it any time from Queue → Drafts');
    $$('#targets .target').forEach((t) => {
      t.className = 'target done';
      t.querySelector('.badge').innerHTML = ICONS.check;
      t.querySelector('small').textContent = scheduled ? 'Scheduled' : 'Draft';
    });
    $('#hideOverlay').hidden = true;
    $('#doneOverlay').hidden = false;
    if (scheduled) confetti();
  },

  launch(jobId) {
    this.jobId = jobId;
    this.ring.style.strokeDashoffset = '0';
    $('#center').innerHTML = ICONS.rocket;
    $('#stageTitle').textContent = 'Posting…';
    $('#stageText').textContent = tr('Channels-ലേക്ക് അയക്കുന്നു', 'Publishing to your channels');
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
      if (running) $('#stageText').textContent = `${running[1].channelName || NAMES[running[1].platform]}: ${running[1].message || 'Working'}`;
      this.timer = setTimeout(() => this.poll(), 2000);
      return;
    }
    const failed = entries.filter(([, s]) => s.state === 'error');
    $('#orbit').classList.add('done');
    $('#hideOverlay').hidden = true;
    $('#doneOverlay').hidden = false;
    if (!failed.length) {
      $('#center').innerHTML = `<div style="font-size:64px;line-height:1">🎉</div>`;
      $('#stageTitle').textContent = tr('എല്ലായിടത്തും പോസ്റ്റ് ആയി!', 'Posted everywhere!');
      $('#stageText').textContent = tr('എല്ലാ channels-ലും post ആയി', 'Your post is live on every selected channel');
      confetti();
    } else {
      $('#center').innerHTML = `<div style="font-size:56px;line-height:1">⚠️</div>`;
      $('#stageTitle').textContent = `${failed.map(([, s]) => s.channelName || NAMES[s.platform]).join(', ')} failed`;
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
async function uploadToBlob(file, onProgress) {
  const { upload } = await import('https://esm.sh/@vercel/blob@2.9.0/client');
  const safeName = file.name.replace(/[^\w.\-]+/g, '_') || 'file';
  const options = {
    handleUploadUrl: api('/api/blob-upload'),
    multipart: file.size > 20 * 1024 * 1024,
    contentType: file.type || 'video/mp4',
    onUploadProgress: ({ percentage }) => onProgress(percentage),
  };
  try {
    return await upload(`uploads/${safeName}`, file, { ...options, access: 'private' });
  } catch (err) {
    if (!/access|private|public/i.test(String(err?.message))) throw err;
    return upload(`uploads/${safeName}`, file, { ...options, access: 'public' });
  }
}

async function postUpload(body) {
  const res = await apiFetch('/api/upload', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || `Upload failed (${res.status})`);
  return json;
}

// Instagram only takes JPEG photos with a width:height ratio between 4:5 and 1.91:1,
// so photos are converted (and centre-cropped if needed) in the browser first.
async function toInstagramJpeg(file) {
  let bitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error(tr(`"${file.name}" തുറക്കാൻ പറ്റിയില്ല (HEIC ആണെങ്കിൽ JPEG ആക്കി വീണ്ടും ശ്രമിക്കൂ)`, `Could not open "${file.name}" (if it is HEIC, convert it to JPEG and try again)`));
  }
  let sx = 0;
  let sy = 0;
  let sw = bitmap.width;
  let sh = bitmap.height;
  const ratio = sw / sh;
  if (ratio < 0.8) {
    sh = Math.round(sw / 0.8);
    sy = Math.round((bitmap.height - sh) / 2);
  } else if (ratio > 1.91) {
    sw = Math.round(sh * 1.91);
    sx = Math.round((bitmap.width - sw) / 2);
  }
  const scale = Math.min(1, 1440 / sw);
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(sw * scale);
  canvas.height = Math.round(sh * scale);
  canvas.getContext('2d').drawImage(bitmap, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.9));
  return new File([blob], file.name.replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' });
}

// Photo / carousel post: send each file, then tell the server the list.
async function sendMedia(files, data, onProgress) {
  const prepared = [];
  for (const f of files) prepared.push(isImage(f) ? await toInstagramJpeg(f) : f);
  const total = prepared.reduce((n, f) => n + f.size, 0) || 1;
  if (!status.blobUploads) {
    data.delete('video');
    prepared.forEach((f) => data.append('media', f));
    return sendDirect(data, onProgress);
  }
  let done = 0;
  const media = [];
  for (const f of prepared) {
    const blob = await uploadToBlob(f, (pct) => onProgress(((done + (f.size * pct) / 100) / total) * 100));
    done += f.size;
    media.push({ url: blob.url, kind: isVideo(f) ? 'video' : 'image', fileName: f.name });
  }
  const body = Object.fromEntries([...data.entries()].filter(([k]) => k !== 'media' && k !== 'video'));
  body.media = media;
  return postUpload(body);
}

async function sendViaBlob(file, data, onProgress) {
  const blob = await uploadToBlob(file, onProgress);
  const body = Object.fromEntries([...data.entries()].filter(([k]) => k !== 'video'));
  body.blobUrl = blob.url;
  body.fileName = file.name;
  return postUpload(body);
}

$('#form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target;
  const chosen = pickedChannels();
  if (!chosen.length) return toast(channels.length ? tr('ഒരു channel എങ്കിലും തിരഞ്ഞെടുക്കൂ', 'Select at least one channel') : tr('ആദ്യം Channels-ൽ ഒരു channel ചേർക്കൂ', 'Add a channel on the Channels page first'), true);
  const platforms = chosen.map((c) => c.platform);
  if (!picked.length) {
    drop.classList.add('over');
    setTimeout(() => drop.classList.remove('over'), 600);
    return;
  }
  const photos = photoMode();
  const file = picked[0];
  const totalSize = picked.reduce((n, f) => n + f.size, 0);
  if (status.maxVideoBytes && totalSize > status.maxVideoBytes) {
    return toast(tr(`300 MB-യിൽ കൂടുതലാണ് (${mb(totalSize)}). ചെറുതാക്കി വീണ്ടും ശ്രമിക്കൂ.`, `Over 300 MB (${mb(totalSize)}). Use a smaller file and try again.`), true);
  }
  if (photos && platforms.includes('facebook') && picked.length > 1 && picked.some(isVideo)) {
    return toast(tr('Facebook multi-photo post-ൽ video പറ്റില്ല. FB Page untick ചെയ്യൂ.', 'Facebook multi-photo posts cannot include a video. Untick the Facebook Page.'), true);
  }

  const mode = currentMode();
  let scheduledAt = null;
  if (mode === 'schedule') {
    const when = new Date($('#scheduleAt').value);
    if (Number.isNaN(when.getTime())) return toast(tr('Schedule ചെയ്യാനുള്ള തീയതിയും സമയവും തിരഞ്ഞെടുക്കൂ', 'Pick a date and time to schedule'), true);
    if (when.getTime() < Date.now()) return toast(tr('ആ സമയം കഴിഞ്ഞുപോയി. ഭാവിയിലെ ഒരു സമയം തിരഞ്ഞെടുക്കൂ', 'That time has passed. Pick a time in the future'), true);
    scheduledAt = when.toISOString();
  }

  const data = new FormData(form);
  data.delete('channels');
  data.set('channels', chosen.map((c) => c.id).join(','));
  data.set('mode', mode);
  if (scheduledAt) data.set('scheduledAt', scheduledAt);
  if (photos) data.set('type', picked.length > 1 ? 'carousel' : 'photo');
  else data.set('video', file);

  const submit = $('#submit');
  submit.disabled = true;
  overlay.open(chosen);
  const onProgress = (pct) =>
    overlay.progress(pct, 'Uploading…', `${mb((totalSize * pct) / 100)} / ${mb(totalSize)}`);
  try {
    const result = photos
      ? await sendMedia(picked, data, onProgress)
      : status.blobUploads
        ? await sendViaBlob(file, data, onProgress)
        : await sendDirect(data, onProgress);
    resetForm(form);
    if (mode === 'now') overlay.launch(result.jobId);
    else overlay.saved(result);
    loadJobs();
  } catch (err) {
    overlay.close();
    showBanner(`Upload failed: ${err.message}`, true);
  } finally {
    submit.disabled = false;
  }
});

// ---------- when to post: now / schedule / draft ----------
const currentMode = () => document.querySelector('input[name=mode]:checked')?.value || 'now';
const pad = (n) => String(n).padStart(2, '0');
const toLocalInput = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;

function quickTimes() {
  const now = new Date();
  const at = (days, h, m = 0) => {
    const d = new Date(now);
    d.setDate(d.getDate() + days);
    d.setHours(h, m, 0, 0);
    return d;
  };
  const options = [];
  const inHour = new Date(now.getTime() + 60 * 60 * 1000);
  inHour.setMinutes(Math.ceil(inHour.getMinutes() / 15) * 15, 0, 0);
  options.push(['+1 hour', inHour]);
  if (at(0, 18) > now) options.push(['Today 6 PM', at(0, 18)]);
  if (at(0, 20) > now) options.push(['Today 8 PM', at(0, 20)]);
  options.push(['Tomorrow 9 AM', at(1, 9)], ['Tomorrow 6 PM', at(1, 18)]);
  return options;
}

function updateWhen() {
  const mode = currentMode();
  $('#whenTime').hidden = mode !== 'schedule';
  $('#submit').textContent = { now: '🚀 Upload everywhere', schedule: '📅 Schedule post', draft: '📝 Save draft' }[mode];
  if (mode === 'schedule') {
    const input = $('#scheduleAt');
    input.min = toLocalInput(new Date());
    if (!input.value || new Date(input.value) < new Date()) input.value = toLocalInput(quickTimes()[0][1]);
    $('#quickTimes').innerHTML = quickTimes()
      .map(([label, d]) => `<button type="button" data-at="${toLocalInput(d)}">${label}</button>`)
      .join('');
  }
}
$$('input[name=mode]').forEach((r) => r.addEventListener('change', updateWhen));
$('#quickTimes').addEventListener('click', (e) => {
  const b = e.target.closest('[data-at]');
  if (b) $('#scheduleAt').value = b.dataset.at;
});
updateWhen();

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
      ? `<button class="icon-btn del" data-del="${esc(j.id)}" data-platform="${esc(p)}" title="Delete from ${esc(s.channelName || NAMES[s.platform || p])}">${UI_ICONS.trash}</button>`
      : '';
  const retry =
    s.state === 'error' && j.canRetry
      ? `<button class="btn small retry" data-retry="${esc(j.id)}" data-platform="${esc(p)}">${UI_ICONS.retry} Retry</button>`
      : '';
  return `<span class="links">${retry}${open}${del}</span>`;
}

function renderAll(jobs) {
  return jobs
    .map((j) => {
      const removeBtn = jobActive(j)
        ? ''
        : `<button class="icon-btn" data-remove="${esc(j.id)}" title="${tr('List-ൽ നിന്ന് മാറ്റുക', 'Remove from list')}">${UI_ICONS.remove}</button>`;
      return `<div class="job" data-job="${esc(j.id)}">
        <div class="job-head">
          <b>${esc(titleOf(j))} <span class="muted">· ${typeLabel(j)}</span></b>
          <span class="menu"><time title="${esc(new Date(j.createdAt).toLocaleString())}">${timeAgo(j.createdAt)}</time>${removeBtn}</span>
        </div>
        ${Object.entries(j.platforms || {})
          .map(([p, s]) => {
            const active = isActive(s);
            const mark = active ? '<span class="spin"></span> ' : s.deleted ? '' : s.state === 'done' ? '✓ ' : '✕ ';
            const msg = s.deleted ? '<span class="tag deleted">Deleted</span>' : esc(s.message);
            return `<div class="prow ${s.deleted ? 'deleted' : ''}">
              ${targetAvatar(p, s)}
              <span class="msg ${s.state}"><b class="chn">${esc(s.channelName || NAMES[s.platform || p] || '')}</b> ${mark}${msg}</span>
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
    .map(({ j, s, key }) => {
      const sub = s.deleted
        ? '<span class="tag deleted">Deleted</span>'
        : `${timeAgo(j.createdAt)} · ${typeLabel(j)} · ${esc(s.channelName || '')}`;
      return `<div class="post ${s.deleted ? 'deleted' : ''}">
        ${targetAvatar(key, s)}
        <span class="txt"><b>${esc(titleOf(j))}</b><small>${sub}</small></span>
        ${rowLinks(j, key, s)}
      </div>`;
    })
    .join('');
}

// A post target's platform (old single-user posts used the platform name as the key).
const platformOf = (key, t) => t?.platform || key;
const targetAvatar = (key, t) => avatar({ ...t, id: key, platform: platformOf(key, t), avatar: t.avatar || chanById(key)?.avatar }, 'sm');
// All targets of the posts on one platform, as rows.
const targetsOn = (jobs, platform) =>
  jobs.flatMap((j) => Object.entries(j.platforms || {}).filter(([k, t]) => platformOf(k, t) === platform).map(([key, s]) => ({ j, s, key })));

function render() {
  renderPlanner();
  renderSideChannels();
  if (!$('[data-view="channel"].view').hidden) renderChannelView();
  // The Posted page only shows uploads that went out (or are going out now).
  const postedJobs = allJobs.filter((j) => j.status === 'posted' || j.status === 'posting');
  // Tab counts: posts that are live on each platform.
  const live = (p) => targetsOn(postedJobs, p).filter(({ s }) => s.state === 'done' && !s.deleted).length;
  $$('[data-count]').forEach((el) => {
    el.textContent = el.dataset.count === 'all' ? postedJobs.length : live(el.dataset.count);
  });
  const hasFb = targetsOn(postedJobs, 'facebook').length > 0;
  $('.tab[data-tab="facebook"]').hidden = !hasFb;
  if (!hasFb && currentTab === 'facebook') currentTab = 'all';
  $$('.tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === currentTab));

  let html = '';
  let total = 0;
  if (currentTab === 'all') {
    total = postedJobs.length;
    html = renderAll(postedJobs.slice(0, shown));
  } else {
    const posts = targetsOn(postedJobs, currentTab).filter(({ s }) => s.state === 'done');
    total = posts.length;
    html = renderPlatform(posts.slice(0, shown), currentTab);
  }
  $('#jobs').innerHTML =
    html ||
    `<div class="empty"><span class="big">🎬</span>${
      currentTab === 'all' ? tr('ഇതുവരെ ഒന്നുമില്ല. ആദ്യത്തെ video അപ്‌ലോഡ് ചെയ്യൂ!', 'Nothing yet. Upload your first post!') : tr(`${NAMES[currentTab]}-ൽ ഇതുവരെ ഒന്നുമില്ല`, `Nothing on ${NAMES[currentTab]} yet`)
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
  const p = btn.dataset.platform; // the target key (channel id)
  const job = allJobs.find((j) => j.id === id);
  const t = job?.platforms?.[p] || {};
  const where = t.channelName || NAMES[platformOf(p, t)];
  const extra = platformOf(p, t) === 'instagram' ? tr(' Facebook profile-ലേക്ക് auto-share ആയ copy Facebook-ൽ നിന്ന് വേറെ delete ചെയ്യണം.', ' A copy auto-shared to a Facebook profile has to be deleted on Facebook separately.') : '';
  const ok = await askConfirm({
    icon: targetAvatar(p, t),
    title: tr(`${where}-ൽ നിന്ന് delete ചെയ്യണോ?`, `Delete from ${where}?`),
    text: tr(`"${titleOf(job)}" ${where}-ൽ നിന്ന് ഒഴിവാക്കും. ഇത് തിരിച്ചെടുക്കാൻ പറ്റില്ല.${extra}`, `"${titleOf(job)}" will be deleted from ${where}. This cannot be undone.${extra}`),
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
    toast(tr(`${where}-ൽ നിന്ന് delete ചെയ്തു ✓`, `Deleted from ${where} ✓`));
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
    title: tr('List-ൽ നിന്ന് മാറ്റണോ?', 'Remove from the list?'),
    text: tr(`"${titleOf(job)}" ഈ list-ൽ നിന്ന് മാത്രം മാറും. YouTube/Instagram-ലെ post അവിടെ തന്നെ ഉണ്ടാവും.`, `"${titleOf(job)}" is only removed from this list. The published post stays on the platform.`),
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
    toast(`${allJobs.find((j) => j.id === id)?.platforms?.[p]?.channelName || 'Channel'}${tr(' വീണ്ടും ശ്രമിക്കുന്നു…', ': retrying…')}`);
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

// =====================================================================
//  Planner: Queue, Drafts, Calendar, Ideas, Analytics
// =====================================================================

function fmtWhen(iso) {
  return new Date(iso).toLocaleString([], { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
}
const fmtTime = (iso) => new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
const dayKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
function dayLabel(d) {
  const today = new Date();
  const tomorrow = new Date();
  tomorrow.setDate(today.getDate() + 1);
  if (dayKey(d) === dayKey(today)) return 'Today';
  if (dayKey(d) === dayKey(tomorrow)) return 'Tomorrow';
  return d.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' });
}
const platIcons = (j) =>
  Object.entries(j.platforms || {})
    .map(([k, t]) => targetAvatar(k, t))
    .join('');
// A post's targets as channel-like objects (for the upload animation).
const targetList = (j) => Object.entries(j.platforms || {}).map(([k, t]) => ({ ...t, id: k, platform: platformOf(k, t), name: t.channelName }));
function outcome(j) {
  if (j.status !== 'posted') return j.status;
  const states = Object.values(j.platforms || {});
  return states.some((s) => s.state === 'error') ? 'failed' : 'posted';
}
const ST_LABEL = { scheduled: 'Scheduled', draft: 'Draft', posting: 'Posting…', posted: 'Posted', failed: 'Failed' };
const EDIT_ICON =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h4L19 9l-4-4L4 16v4zM13.5 6.5l4 4"/></svg>';

function plannedItem(j, { showDay = false } = {}) {
  const isDraft = j.status === 'draft';
  const overdue = j.status === 'scheduled' && new Date(j.scheduledAt) < new Date();
  const time = isDraft
    ? '<b>📝</b><small>Draft</small>'
    : `<b>${fmtTime(j.scheduledAt)}</b><small>${showDay ? dayLabel(new Date(j.scheduledAt)) : overdue ? 'due now' : ''}</small>`;
  return `<div class="qitem ${overdue ? 'overdue' : ''}">
    <div class="time">${time}</div>
    <div class="body">
      <b>${esc(titleOf(j))}</b>
      <div class="plats">${platIcons(j)}<span class="st ${j.status}">${ST_LABEL[j.status]}</span><small class="muted">${typeLabel(j)}</small></div>
    </div>
    <div class="acts">
      <button class="btn small" data-act="now" data-id="${esc(j.id)}">⚡ Post now</button>
      <button class="icon-btn" data-act="edit" data-id="${esc(j.id)}" title="Edit">${EDIT_ICON}</button>
      <button class="icon-btn del" data-act="delete" data-id="${esc(j.id)}" title="Delete">${UI_ICONS.trash}</button>
    </div>
  </div>`;
}

function renderPlanner() {
  const scheduled = allJobs
    .filter((j) => j.status === 'scheduled')
    .sort((a, b) => new Date(a.scheduledAt) - new Date(b.scheduledAt));
  const drafts = allJobs.filter((j) => j.status === 'draft');

  $('#queueCount').hidden = !scheduled.length;
  $('#queueCount').textContent = scheduled.length;

  // "Coming up" on the Create page
  $('#upNext').innerHTML = scheduled.length
    ? scheduled.slice(0, 3).map((j) => plannedItem(j, { showDay: true })).join('')
    : `<div class="empty"><span class="big">📅</span>${tr('Schedule ചെയ്ത posts ഇല്ല. "When → Schedule" തിരഞ്ഞെടുത്ത് സമയം വെക്കൂ.', 'No scheduled posts. Choose "When → Schedule" to set a time.')}</div>`;

  // Queue, grouped by day
  const groups = new Map();
  for (const j of scheduled) {
    const d = new Date(j.scheduledAt);
    const key = dayKey(d);
    if (!groups.has(key)) groups.set(key, { label: dayLabel(d), items: [] });
    groups.get(key).items.push(j);
  }
  $('#queueList').innerHTML = groups.size
    ? [...groups.values()]
        .map((g) => `<div class="qday"><h4>${esc(g.label)}</h4><div class="items">${g.items.map((j) => plannedItem(j)).join('')}</div></div>`)
        .join('')
    : `<div class="empty"><span class="big">🗓️</span>${tr('Queue കാലിയാണ്. Create-ൽ "Schedule" തിരഞ്ഞെടുത്ത് post-ന് സമയം വെക്കൂ.', 'The queue is empty. In Create, choose "Schedule" to give a post a time.')}</div>`;

  $('#draftList').innerHTML = drafts.length
    ? drafts.map((j) => plannedItem(j)).join('')
    : `<div class="empty"><span class="big">📝</span>${tr('Drafts ഇല്ല', 'No drafts')}</div>`;

  if (!$('[data-view="calendar"].view').hidden) renderCalendar();
}

// ---------- actions on drafts / scheduled posts ----------
document.addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-act]');
  if (!btn) return;
  const job = allJobs.find((j) => j.id === btn.dataset.id);
  if (!job) return;
  const act = btn.dataset.act;

  if (act === 'edit') return openEditor(job);

  if (act === 'now') {
    const ok = await askConfirm({
      icon: '<div style="font-size:34px">⚡</div>',
      title: tr('ഇപ്പോൾ തന്നെ post ചെയ്യണോ?', 'Post it now?'),
      text: tr(`"${titleOf(job)}" ഇപ്പോൾ ${targetList(job).map((t) => t.name || NAMES[t.platform]).join(', ')}-ൽ post ആവും.`, `"${titleOf(job)}" will be published now to ${targetList(job).map((t) => t.name || NAMES[t.platform]).join(', ')}.`),
      yes: 'Post now',
    });
    if (!ok) return;
    try {
      const res = await apiFetch(`/api/jobs/${encodeURIComponent(job.id)}/publish`, { method: 'POST' });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || 'Could not post');
      overlay.open(targetList(job));
      overlay.launch(json.jobId);
      loadJobs();
    } catch (err) {
      toast(err.message, true);
    }
    return;
  }

  if (act === 'delete') {
    const ok = await askConfirm({
      icon: UI_ICONS.trash,
      title: job.status === 'draft' ? tr('Draft delete ചെയ്യണോ?', 'Delete this draft?') : tr('Scheduled post delete ചെയ്യണോ?', 'Delete this scheduled post?'),
      text: tr(`"${titleOf(job)}"-ഉം അതിന്റെ video-യും ഒഴിവാക്കും. ഇതുവരെ ഒന്നും post ചെയ്തിട്ടില്ല.`, `"${titleOf(job)}" and its media will be deleted. Nothing has been posted yet.`),
    });
    if (!ok) return;
    const res = await apiFetch(`/api/jobs/${encodeURIComponent(job.id)}/remove`, { method: 'POST' });
    if (!res.ok) return toast((await res.json().catch(() => ({}))).error || 'Could not delete', true);
    allJobs = allJobs.filter((j) => j.id !== job.id);
    render();
    toast('Deleted ✓');
  }
});

// ---------- editor ----------
let editing = null;
function openEditor(job) {
  editing = job;
  $('#editTitle').textContent = job.status === 'draft' ? 'Edit draft' : 'Edit scheduled post';
  const photo = job.type === 'photo' || job.type === 'carousel';
  $('#editPlatforms').innerHTML = channels.length
    ? channels
        .map(
          (c) => `<label class="chpick" title="${esc(channelLabel(c))}">
            <input type="checkbox" value="${esc(c.id)}" ${job.platforms?.[c.id] ? 'checked' : ''} ${photo && c.platform === 'youtube' ? 'disabled' : ''} />
            ${avatar(c)}<span class="tick">✓</span><small>${esc(channelLabel(c))}</small></label>`,
        )
        .join('')
    : `<div class="picker-empty">${tr('Channels ഇല്ല', 'No channels')}</div>`;
  $('#editCaption').value = job.caption || '';
  $('#editYtTitle').value = job.settings?.ytTitle || '';
  const mode = job.status === 'scheduled' ? 'schedule' : 'draft';
  document.querySelector(`input[name=editMode][value=${mode}]`).checked = true;
  const at = job.scheduledAt ? new Date(job.scheduledAt) : quickTimes()[0][1];
  $('#editAt').value = toLocalInput(at);
  $('#editAt').hidden = mode !== 'schedule';
  $('#editor').hidden = false;
}
$$('input[name=editMode]').forEach((r) =>
  r.addEventListener('change', () => ($('#editAt').hidden = r.value !== 'schedule' || !r.checked)),
);
$('#editCancel').addEventListener('click', () => ($('#editor').hidden = true));
$('#editor').addEventListener('click', (e) => e.target.id === 'editor' && ($('#editor').hidden = true));
$('#editForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!editing) return;
  const picked = $$('#editPlatforms input:checked:not(:disabled)').map((i) => i.value);
  if (!picked.length) return toast(tr('ഒരു channel എങ്കിലും തിരഞ്ഞെടുക്കൂ', 'Select at least one channel'), true);
  const mode = document.querySelector('input[name=editMode]:checked').value;
  const body = {
    channels: picked.join(','),
    caption: $('#editCaption').value,
    ytTitle: $('#editYtTitle').value,
    mode,
  };
  if (mode === 'schedule') {
    const when = new Date($('#editAt').value);
    if (Number.isNaN(when.getTime()) || when < new Date()) return toast(tr('ഭാവിയിലെ ഒരു സമയം തിരഞ്ഞെടുക്കൂ', 'Pick a time in the future'), true);
    body.scheduledAt = when.toISOString();
  }
  const res = await apiFetch(`/api/jobs/${encodeURIComponent(editing.id)}/edit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) return toast(json.error || 'Could not save', true);
  const i = allJobs.findIndex((j) => j.id === json.id);
  if (i >= 0) allJobs[i] = json;
  $('#editor').hidden = true;
  render();
  toast(mode === 'schedule' ? `Scheduled · ${fmtWhen(json.scheduledAt)}` : 'Draft saved ✓');
});

// ---------- calendar ----------
let calMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
let calSelected = dayKey(new Date());
let calFilter = null; // channel id, or null for all channels

function calendarEvents() {
  const map = new Map();
  for (const j of allJobs) {
    if (j.status === 'draft') continue;
    if (calFilter && !j.platforms?.[calFilter]) continue;
    const iso = j.status === 'scheduled' ? j.scheduledAt : j.postedAt || j.createdAt;
    if (!iso) continue;
    const key = dayKey(new Date(iso));
    if (!map.has(key)) map.set(key, []);
    map.get(key).push({ j, iso, kind: outcome(j) });
  }
  for (const list of map.values()) list.sort((a, b) => new Date(a.iso) - new Date(b.iso));
  return map;
}

function renderCalendar() {
  const events = calendarEvents();
  $('#calTitle').textContent = calMonth.toLocaleDateString([], { month: 'long', year: 'numeric' });
  const start = new Date(calMonth);
  start.setDate(1 - start.getDay()); // back to Sunday
  const todayKey = dayKey(new Date());
  let html = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => `<div class="dow">${d}</div>`).join('');
  for (let i = 0; i < 42; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    const key = dayKey(d);
    const list = events.get(key) || [];
    const cls = [
      'cell',
      d.getMonth() !== calMonth.getMonth() ? 'other' : '',
      key === todayKey ? 'today' : '',
      key === calSelected ? 'sel' : '',
    ].join(' ');
    html += `<button class="${cls}" data-day="${key}">
      <span class="n">${d.getDate()}</span>
      ${list
        .slice(0, 3)
        .map((ev) => `<span class="ev"><i class="dotc ${ev.kind}"></i><span>${esc(fmtTime(ev.iso))} ${esc(titleOf(ev.j))}</span></span>`)
        .join('')}
      ${list.length > 3 ? `<span class="more">+${list.length - 3} more</span>` : ''}
    </button>`;
  }
  $('#calGrid').innerHTML = html;

  const sel = events.get(calSelected) || [];
  const [y, m, dd] = calSelected.split('-').map(Number);
  $('#calDay').innerHTML = `<h4>${esc(dayLabel(new Date(y, m - 1, dd)))}</h4>${
    sel.length
      ? sel
          .map(({ j, kind }) =>
            j.status === 'scheduled'
              ? plannedItem(j)
              : `<div class="post"><span class="plats">${platIcons(j)}</span>
                  <span class="txt"><b>${esc(titleOf(j))}</b><small>${fmtTime(j.postedAt || j.createdAt)} · <span class="st ${kind}">${ST_LABEL[kind]}</span></small></span>
                  <span class="links">${Object.entries(j.platforms)
                    .filter(([, s]) => s.url && !s.deleted)
                    .map(([p, s]) => `<a class="icon-btn" href="${esc(s.url)}" target="_blank" rel="noopener" title="Open on ${esc(s.channelName || NAMES[platformOf(p, s)])}">${UI_ICONS.open}</a>`)
                    .join('')}</span></div>`,
          )
          .join('')
      : `<div class="empty" style="padding:12px">${tr('ഈ ദിവസം posts ഇല്ല', 'No posts on this day')}</div>`
  }`;
}
$('#calGrid').addEventListener('click', (e) => {
  const cell = e.target.closest('[data-day]');
  if (!cell) return;
  calSelected = cell.dataset.day;
  renderCalendar();
});
$('#calPrev').addEventListener('click', () => {
  calMonth = new Date(calMonth.getFullYear(), calMonth.getMonth() - 1, 1);
  renderCalendar();
});
$('#calNext').addEventListener('click', () => {
  calMonth = new Date(calMonth.getFullYear(), calMonth.getMonth() + 1, 1);
  renderCalendar();
});
$('#calToday').addEventListener('click', () => {
  calMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  calSelected = dayKey(new Date());
  renderCalendar();
});

// ---------- ideas ----------
let ideas = [];
async function loadIdeas() {
  try {
    ideas = await apiFetch('/api/ideas').then((r) => r.json());
  } catch {
    return;
  }
  renderIdeas();
}
function renderIdeas() {
  $('#ideaList').innerHTML = ideas.length
    ? ideas
        .map(
          (i) => `<div class="idea">
            <p>${esc(i.text)}</p>
            <div class="foot2"><small>${timeAgo(i.createdAt)}</small>
              <button class="btn small" data-use-idea="${esc(i.id)}">✨ Use</button>
              <button class="icon-btn del" data-del-idea="${esc(i.id)}" title="Delete">${UI_ICONS.trash}</button>
            </div>
          </div>`,
        )
        .join('')
    : `<div class="empty"><span class="big">💡</span>${tr('ആശയങ്ങൾ ഒന്നുമില്ല. മനസ്സിൽ വരുന്നത് ഇവിടെ എഴുതി വെക്കൂ.', 'No ideas yet. Jot down whatever comes to mind.')}</div>`;
}
$('#ideaForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const text = $('#ideaText').value.trim();
  if (!text) return;
  const res = await apiFetch('/api/ideas', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) return toast(json.error || 'Could not save', true);
  ideas.unshift(json);
  $('#ideaText').value = '';
  renderIdeas();
  toast('Idea saved 💡');
});
$('#ideaList').addEventListener('click', async (e) => {
  const use = e.target.closest('[data-use-idea]');
  const del = e.target.closest('[data-del-idea]');
  if (use) {
    const idea = ideas.find((i) => i.id === use.dataset.useIdea);
    caption.value = idea?.text || '';
    caption.dispatchEvent(new Event('input'));
    location.hash = '#create';
    toast(tr('Caption-ൽ ചേർത്തു. ഇനി video തിരഞ്ഞെടുക്കൂ', 'Added to the caption. Now choose a video'));
  } else if (del) {
    const ok = await askConfirm({ icon: '💡', title: tr('Idea delete ചെയ്യണോ?', 'Delete this idea?'), text: tr('ഈ ആശയം list-ൽ നിന്ന് മാറ്റും.', 'The idea is removed from the list.') });
    if (!ok) return;
    await apiFetch(`/api/ideas/${encodeURIComponent(del.dataset.delIdea)}/delete`, { method: 'POST' });
    ideas = ideas.filter((i) => i.id !== del.dataset.delIdea);
    renderIdeas();
  }
});

// ---------- analytics ----------
const num = (n) => (n == null ? '–' : Intl.NumberFormat([], { notation: n >= 10000 ? 'compact' : 'standard' }).format(n));
async function loadAnalytics(refresh = false) {
  $('#statTiles').innerHTML = '<div class="skeleton"></div>';
  let data;
  try {
    data = await apiFetch(`/api/analytics${refresh ? '?refresh=1' : ''}`).then((r) => r.json());
  } catch {
    return;
  }
  if (!data.error) statsData = data;
  if (data.error) {
    $('#statTiles').innerHTML = `<div class="empty">${esc(data.error)}</div>`;
    return;
  }
  const tile = (p, t) => `<div class="tile">
    <div class="th"><span class="pi ${PI_CLASS[p]}">${ICONS[p]}</span>${NAMES[p]}<small class="muted" style="margin-left:auto">${t.posts} posts</small></div>
    <div class="nums"><div><b>${num(p === 'instagram' && !data.instagramViews ? null : t.views)}</b><small>views</small></div><div><b>${num(t.likes)}</b><small>likes</small></div><div><b>${num(t.comments)}</b><small>comments</small></div></div>
  </div>`;
  const reachTile = (a) => `<div class="tile">
    <div class="th">${avatar({ platform: 'instagram', name: a.name, avatar: chanById(a.channelId)?.avatar }, 'sm')}${esc(a.name)}<small class="muted" style="margin-left:auto">${tr('കഴിഞ്ഞ 28 ദിവസം', 'last 28 days')}</small></div>
    <div class="nums"><div><b>${num(a.reach28)}</b><small>${tr('reach (account)', 'account reach')}</small></div></div>
  </div>`;
  $('#statTiles').innerHTML =
    tile('youtube', data.totals.youtube) + tile('instagram', data.totals.instagram) + (data.accounts || []).map(reachTile).join('');
  const notes = [`Updated ${timeAgo(data.updatedAt)}`];
  if (!data.instagramViews) notes.push(tr('Instagram views കാണാൻ Instagram "Reconnect" ചെയ്യൂ', 'Reconnect Instagram to see Instagram views'));
  notes.push(...data.errors);
  $('#statsNote').textContent = notes.join(' · ');

  const maxViews = Math.max(1, ...data.rows.flatMap((r) => r.lines.map((l) => l.views || 0)));
  const line = (s) => `<div class="sline">${avatar({ platform: s.platform, name: s.channelName, avatar: chanById(s.channelId)?.avatar }, 'sm')}
          <span class="muted">${esc(s.channelName || '')}</span>
          ${s.error ? `<span>${esc(s.error === 'deleted' ? 'Deleted' : s.error)}</span>` : `
          <span><b>${num(s.views)}</b> views</span><span><b>${num(s.likes)}</b> ♥</span><span><b>${num(s.comments)}</b> 💬</span>
          <span class="bar-h"><i style="width:${Math.round(((s.views || 0) / maxViews) * 100)}%"></i></span>`}
          ${s.url ? `<a class="icon-btn" href="${esc(s.url)}" target="_blank" rel="noopener" title="Open">${UI_ICONS.open}</a>` : ''}
        </div>`;
  $('#statRows').innerHTML = data.rows.length
    ? data.rows
        .map((r) => `<div class="srow"><div class="h"><b>${esc(r.title)}</b><small>${timeAgo(r.createdAt)}</small></div>${r.lines.map(line).join('')}</div>`)
        .join('')
    : `<div class="empty"><span class="big">📊</span>${tr('Post ചെയ്തതിന് ശേഷം ഇവിടെ views, likes കാണാം', 'Views and likes appear here after you post')}</div>`;
}
$('#statsRefresh').addEventListener('click', () => loadAnalytics(true));

// ---------- timer (cron-job.org) setup ----------
let cronLoaded = false;
async function loadCronInfo() {
  if (cronLoaded) return;
  cronLoaded = true;
  const info = await apiFetch('/api/cron-info').then((r) => r.json()).catch(() => ({}));
  $('#cronUrl').value = info.url || '';
}
$('#copyCron').addEventListener('click', async () => {
  await navigator.clipboard.writeText($('#cronUrl').value).catch(() => $('#cronUrl').select());
  toast(tr('Link copy ചെയ്തു ✓', 'Link copied ✓'));
});

// ---------- Claude connector ----------
function showConnector(hasKey, url = '') {
  $('#connectorRow').hidden = !url;
  $('#connectorUrl').value = url;
  $('#revokeConnector').hidden = !hasKey;
  $('#makeConnector').textContent = hasKey ? tr('പുതിയ link ഉണ്ടാക്കൂ', 'Create a new link') : tr('Connector link ഉണ്ടാക്കൂ', 'Create connector link');
  $('#connectorNote').textContent = url
    ? tr('ഈ link ഇപ്പോൾ മാത്രമേ കാണിക്കൂ. Copy ചെയ്ത് Claude-ൽ ചേർക്കൂ.', 'This link is shown only now. Copy it and add it in Claude.')
    : hasKey
      ? tr('Connector on ആണ് ✓ (link വീണ്ടും കാണിക്കില്ല; വേണമെങ്കിൽ പുതിയത് ഉണ്ടാക്കൂ)', 'Connector is on ✓ (the link is not shown again; create a new one if you need it)')
      : '';
}
async function loadConnector() {
  const info = await apiFetch('/api/connector').then((r) => r.json()).catch(() => ({}));
  if (!$('#connectorUrl').value) showConnector(Boolean(info.hasKey));
}
$('#makeConnector').addEventListener('click', async () => {
  if (!$('#revokeConnector').hidden) {
    const ok = await askConfirm({
      icon: '🔑',
      title: tr('പുതിയ link ഉണ്ടാക്കണോ?', 'Create a new link?'),
      text: tr('പഴയ link ഉടനെ പ്രവർത്തിക്കാതാവും. Claude-ൽ പുതിയ link ചേർക്കണം.', 'The old link stops working right away. You will need to add the new link in Claude.'),
      yes: tr('ഉണ്ടാക്കൂ', 'Create'),
    });
    if (!ok) return;
  }
  const r = await apiFetch('/api/connector', { method: 'POST' }).then((x) => x.json());
  if (r.url) showConnector(true, r.url);
});
$('#revokeConnector').addEventListener('click', async () => {
  const ok = await askConfirm({
    icon: '🔌',
    title: tr('Connector off ചെയ്യണോ?', 'Turn the connector off?'),
    text: tr('Claude-ന് ഇനി One Upload ഉപയോഗിക്കാൻ പറ്റില്ല.', 'Claude will no longer be able to use One Upload.'),
    yes: tr('Off ചെയ്യൂ', 'Turn off'),
  });
  if (!ok) return;
  await apiFetch('/api/connector/revoke', { method: 'POST' });
  showConnector(false);
});
$('#copyConnector').addEventListener('click', async () => {
  await navigator.clipboard.writeText($('#connectorUrl').value).catch(() => $('#connectorUrl').select());
  toast(tr('Link copy ചെയ്തു ✓', 'Link copied ✓'));
});

// =====================================================================
//  Sidebar channel list + one channel's Queue / Drafts / Sent
// =====================================================================
let currentCh = null; // channel id shown on the channel page
let chTab = 'queue';
let statsData = null; // last /api/analytics answer (views, likes, thumbnails)
let statsLoading = null;

const targetOf = (j, id) => j.platforms?.[id];
const chScheduled = (id) => allJobs.filter((j) => j.status === 'scheduled' && targetOf(j, id));

function renderSideChannels() {
  const box = $('#sideChannels');
  if (!box) return;
  if (!channels.length) {
    box.innerHTML = `<div class="side-empty">${tr('Channels ഇല്ല. <a href="#channels">ചേർക്കൂ →</a>', 'No channels yet. <a href="#channels">Connect one →</a>')}</div>`;
    return;
  }
  box.innerHTML = channels
    .map((c) => {
      const n = chScheduled(c.id).length;
      const sub = c.platform === 'facebook' ? 'Facebook Page' : c.platform === 'youtube' ? 'YouTube' : c.info?.pageName ? `Instagram · ${c.info.pageName}` : 'Instagram';
      return `<a class="side-ch ${c.id === currentCh && location.hash.startsWith('#ch/') ? 'active' : ''}" href="#ch/${encodeURIComponent(c.id)}" title="${esc(channelLabel(c))} · ${n} ${tr('scheduled', 'scheduled')}">
        ${avatar(c, 'md')}<span class="nm"><b>${esc(c.username || c.name)}</b><small>${esc(sub)}</small></span><span class="n">${n || ''}</span></a>`;
    })
    .join('');
}

async function loadStats(refresh = false) {
  if (statsData && !refresh) return statsData;
  statsLoading ||= apiFetch(`/api/analytics${refresh ? '?refresh=1' : ''}`)
    .then((r) => r.json())
    .then((d) => (statsData = d.error ? statsData : d))
    .catch(() => statsData)
    .finally(() => (statsLoading = null));
  return statsLoading;
}
const statLine = (postId, chId) => statsData?.rows?.find((r) => r.id === postId)?.lines?.find((l) => l.channelId === chId) || null;

function ytThumb(url) {
  const m = String(url || '').match(/(?:shorts\/|v=|youtu\.be\/)([\w-]{6,})/);
  return m ? `https://i.ytimg.com/vi/${m[1]}/mqdefault.jpg` : null;
}

function postCard(j, c, mode) {
  const t = targetOf(j, c.id) || {};
  const line = mode === 'sent' ? statLine(j.id, c.id) : null;
  const thumb = line?.thumb || (c.platform === 'youtube' ? ytThumb(t.url) : null);
  const others = Object.entries(j.platforms || {}).filter(([k]) => k !== c.id);
  const photo = j.type === 'photo' || j.type === 'carousel';
  const overdue = j.status === 'scheduled' && new Date(j.scheduledAt) < new Date();

  let stats = '';
  if (mode === 'sent' && t.state === 'done' && !t.deleted && c.platform !== 'facebook') {
    if (line && !line.error) {
      const cell = (label, v) => `<div><small>${label}</small><b>${num(v)}</b></div>`;
      stats = `<div class="stats">${line.views != null ? cell('Views', line.views) : ''}${cell('Likes', line.likes)}${cell('Comments', line.comments)}</div>`;
    } else if (!statsData) {
      stats = `<div class="stats"><div><small>${tr('Stats എടുക്കുന്നു…', 'Loading stats…')}</small></div></div>`;
    }
  }

  let info = '';
  let acts = '';
  if (mode === 'sent') {
    if (t.deleted) info = `<span class="tag deleted">Deleted</span>`;
    else if (isActive(t)) info = `<span class="spin"></span> ${esc(t.message || tr('Post ചെയ്യുന്നു…', 'Posting…'))}`;
    else if (t.state === 'error') info = `✕ ${esc(t.message || 'Failed')}`;
    else info = `${tr('Post ചെയ്തത്', 'Posted')} ${timeAgo(j.postedAt || j.createdAt)}`;
    if (t.state === 'error' && j.canRetry) acts += `<button class="btn small retry" data-retry="${esc(j.id)}" data-platform="${esc(c.id)}">${UI_ICONS.retry} Retry</button>`;
    if (t.url && !t.deleted) acts += `<a class="btn" href="${esc(t.url)}" target="_blank" rel="noopener">${UI_ICONS.open.replace('<svg', '<svg width="15" height="15"')} ${tr('Post കാണൂ', 'Go to post')}</a>`;
    if (t.state === 'done' && !t.deleted) acts += `<button class="icon-btn del" data-del="${esc(j.id)}" data-platform="${esc(c.id)}" title="${tr('Delete ചെയ്യൂ', 'Delete')}">${UI_ICONS.trash}</button>`;
  } else {
    info = j.status === 'draft' ? tr('Draft · സമയം വെച്ചിട്ടില്ല', 'Draft · no time set') : overdue ? tr('സമയം കഴിഞ്ഞു, ഉടനെ post ആവും', 'Due now, going out shortly') : `${tr('Schedule ചെയ്തത്', 'Scheduled for')} ${fmtWhen(j.scheduledAt)}`;
    acts = `<button class="btn small" data-act="now" data-id="${esc(j.id)}">⚡ ${tr('ഇപ്പോൾ post', 'Post now')}</button>
      <button class="icon-btn" data-act="edit" data-id="${esc(j.id)}" title="Edit">${EDIT_ICON}</button>
      <button class="icon-btn del" data-act="delete" data-id="${esc(j.id)}" title="Delete">${UI_ICONS.trash}</button>`;
  }

  return `<div class="pcard ${overdue ? 'overdue' : ''}">
    <div class="pbody">
      <div style="min-width:0">
        <div class="who">${avatar(c, 'md')}<b>${esc(c.username || c.name)}</b><span class="chip">${typeLabel(j)}</span></div>
        <p class="cap">${esc(j.caption || j.fileName || '')}</p>
        ${others.length ? `<div class="others">${tr('ഇവിടെയും:', 'Also on:')} ${others.map(([k, o]) => targetAvatar(k, o)).join('')}</div>` : ''}
      </div>
      <div class="thumb">${thumb ? `<img src="${esc(thumb)}" alt="" loading="lazy" referrerpolicy="no-referrer" />` : photo ? '🖼️' : '🎬'}</div>
    </div>
    ${stats}
    <div class="pfoot"><span class="info ${t.state === 'error' && mode === 'sent' ? 'err' : ''}">${info}</span>${acts}</div>
  </div>`;
}

function renderChannelView() {
  const c = chanById(currentCh);
  if (!c) {
    $('#chId').innerHTML = '';
    $('#chList').innerHTML = `<div class="empty"><span class="big">🔗</span>${tr('ഈ channel ഇപ്പോൾ ഇല്ല.', 'This channel is not connected any more.')} <a href="#channels">Channels →</a></div>`;
    return;
  }
  const mine = allJobs.filter((j) => targetOf(j, c.id));
  const queue = mine.filter((j) => j.status === 'scheduled').sort((a, b) => new Date(a.scheduledAt) - new Date(b.scheduledAt));
  const drafts = mine.filter((j) => j.status === 'draft');
  const sent = mine
    .filter((j) => j.status === 'posted' || j.status === 'posting')
    .sort((a, b) => new Date(b.postedAt || b.createdAt) - new Date(a.postedAt || a.createdAt));
  const weekAgo = Date.now() - 7 * 864e5;
  const thisWeek = sent.filter((j) => targetOf(j, c.id).state === 'done' && new Date(j.postedAt || j.createdAt) > weekAgo).length;

  const sub = [NAMES[c.platform], c.platform === 'instagram' && c.info?.pageName ? c.info.pageName : ''].filter(Boolean).join(' · ');
  $('#chId').innerHTML = `${avatar(c, 'lg')}<div style="min-width:0"><h2>${esc(c.username || c.name)}</h2>
    <small>${tr(`ഈ ആഴ്ച ${thisWeek} posts`, `${thisWeek} ${thisWeek === 1 ? 'post' : 'posts'} sent this week`)} · ${esc(sub)}</small></div>`;
  $('#chNew').href = `#new/${encodeURIComponent(c.id)}`;
  $$('[data-chcount]').forEach((el) => (el.textContent = { queue: queue.length, draft: drafts.length, sent: sent.length }[el.dataset.chcount]));
  $$('.ch-tab').forEach((b) => b.classList.toggle('on', b.dataset.chtab === chTab));
  $('#chTz').textContent = `🌐 ${Intl.DateTimeFormat().resolvedOptions().timeZone || ''}`;

  const list = { queue, draft: drafts, sent }[chTab];
  if (!list.length) {
    const msg = {
      queue: tr('Queue കാലിയാണ്. “New post”-ൽ Schedule തിരഞ്ഞെടുത്ത് സമയം വെക്കൂ.', 'The queue is empty. Use “New post” and pick Schedule to add one.'),
      draft: tr('Drafts ഇല്ല', 'No drafts'),
      sent: tr('ഈ channel-ൽ One Upload വഴി ഇതുവരെ ഒന്നും post ചെയ്തിട്ടില്ല', 'Nothing has been posted to this channel from One Upload yet'),
    }[chTab];
    $('#chList').innerHTML = `<div class="empty"><span class="big">${{ queue: '🗓️', draft: '📝', sent: '📭' }[chTab]}</span>${msg}</div>`;
    return;
  }
  if (chTab === 'draft') {
    $('#chList').innerHTML = `<div class="feed-day"><div class="items">${list.map((j) => postCard(j, c, 'draft')).join('')}</div></div>`;
    return;
  }
  const groups = new Map();
  for (const j of list) {
    const d = new Date(chTab === 'queue' ? j.scheduledAt : j.postedAt || j.createdAt);
    const key = dayKey(d);
    if (!groups.has(key)) groups.set(key, { d, items: [] });
    groups.get(key).items.push({ j, d });
  }
  const head = (d) => {
    const l = dayLabel(d);
    const date = d.toLocaleDateString([], { month: 'long', day: 'numeric' });
    return ['Today', 'Tomorrow'].includes(l) ? `${l}, <span>${esc(date)}</span>` : esc(l);
  };
  $('#chList').innerHTML = [...groups.values()]
    .map(
      (g) => `<div class="feed-day"><h4>${head(g.d)}</h4><div class="items">${g.items
        .map(({ j, d }) => `<div class="feed-row"><div class="when"><b>${fmtTime(d.toISOString())}</b><small>${chTab === 'queue' ? tr('Schedule', 'Scheduled') : tr('Post ചെയ്തു', 'Sent')}</small></div>${postCard(j, c, chTab)}</div>`)
        .join('')}</div></div>`,
    )
    .join('');
  if (chTab === 'sent' && !statsData) loadStats().then(() => !$('[data-view="channel"].view').hidden && renderChannelView());
}

$('#chTabs').addEventListener('click', (e) => {
  const b = e.target.closest('[data-chtab]');
  if (!b) return;
  chTab = b.dataset.chtab;
  renderChannelView();
});
$('.chview .seg-mini').addEventListener('click', (e) => {
  const b = e.target.closest('[data-layout]');
  if (b?.dataset.layout !== 'calendar') return;
  calFilter = currentCh;
  location.hash = '#calendar';
});
$('#chList').addEventListener('click', (e) => {
  const retryBtn = e.target.closest('[data-retry]');
  if (retryBtn) return retryPost(retryBtn);
  const delBtn = e.target.closest('[data-del]');
  if (delBtn) return deletePost(delBtn);
});

// Calendar: optional filter to one channel.
function renderCalFilter() {
  const sel = $('#calFilter');
  sel.innerHTML = `<option value="">${tr('എല്ലാ channels', 'All channels')}</option>` + channels.map((c) => `<option value="${esc(c.id)}">${esc(channelLabel(c))}</option>`).join('');
  sel.value = calFilter && chanById(calFilter) ? calFilter : '';
}
$('#calFilter').addEventListener('change', (e) => {
  calFilter = e.target.value || null;
  renderCalendar();
});

// Mobile: the sidebar slides in.
const setSide = (open) => {
  document.body.classList.toggle('side-open', open);
  $('#sideScrim').hidden = !open;
};
$('#sideOpen').addEventListener('click', () => setSide(true));
$('#sideClose').addEventListener('click', () => setSide(false));
$('#sideScrim').addEventListener('click', () => setSide(false));

// "New post" from a channel page: tick only that channel in the composer.
function preselectChannel(id) {
  // Saved first: if channels are still loading, the picker reads it when it renders.
  localStorage.setItem(CHANNEL_KEY, JSON.stringify([id]));
  $$('input[name=channels]').forEach((i) => (i.checked = i.value === id));
  updatePickedCount();
}

// ---------- navigation ----------
const VIEW_NAMES = ['create', 'queue', 'calendar', 'posted', 'ideas', 'analytics', 'channels', 'channel'];
function showView(hash) {
  let name = hash;
  let arg = null;
  const slash = hash.indexOf('/');
  if (slash > 0) {
    name = hash.slice(0, slash);
    arg = decodeURIComponent(hash.slice(slash + 1));
  }
  if (name === 'ch') name = 'channel';
  if (name === 'new') {
    name = 'create';
    if (arg) preselectChannel(arg);
  }
  if (!VIEW_NAMES.includes(name) || (name === 'channel' && !arg)) name = 'create';
  if (name === 'channel') {
    if (arg !== currentCh) chTab = 'queue';
    currentCh = arg;
  }
  setSide(false);
  $$('.view').forEach((v) => (v.hidden = v.dataset.view !== name));
  $$('#nav a').forEach((a) => a.classList.toggle('active', a.dataset.view === name));
  renderSideChannels();
  if (['queue', 'calendar', 'posted', 'channel'].includes(name)) loadJobs();
  if (name === 'channels') {
    loadStatus().catch(() => {});
    loadConnector();
  }
  if (name === 'channel') renderChannelView();
  if (name === 'calendar') {
    renderCalFilter();
    renderCalendar();
  } else if (name !== 'channel') calFilter = null;
  if (name === 'ideas') loadIdeas();
  if (name === 'analytics') loadAnalytics();
  if (name === 'queue') loadCronInfo();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
window.addEventListener('hashchange', () => showView(location.hash.slice(1)));
showView(location.hash.slice(1));

loadStatus()
  .then(() => pendingPick && openPicker(pendingPick))
  .catch(() => {});
loadJobs();


function typeLabel(j) {
  return { reel: 'Reel', video: 'Video', photo: 'Photo', carousel: 'Carousel' }[j.type] || 'Video';
}
