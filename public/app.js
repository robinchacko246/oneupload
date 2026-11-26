const $ = (s) => document.querySelector(s);
// Build URLs from the origin so the page also works when opened as http://user:pass@host/
const api = (p) => new URL(p, location.origin).toString();
const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// ---------- banner from login redirects ----------
const params = new URLSearchParams(location.search);
if (params.get('connected') || params.get('error')) {
  const banner = $('#banner');
  banner.hidden = false;
  if (params.get('error')) {
    banner.classList.add('error');
    banner.textContent = params.get('error');
  } else {
    banner.textContent = `${params.get('connected') === 'youtube' ? 'YouTube' : 'Facebook + Instagram'} connected ✓`;
  }
  history.replaceState(null, '', '/');
}

// ---------- accounts ----------
async function loadStatus() {
  const s = await fetch(api('/api/status')).then((r) => r.json());

  const yt = $('#acc-youtube .acc-body');
  if (!s.youtube.configured) {
    yt.innerHTML = `<span class="muted">.env-ൽ GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET ചേർക്കണം (SETUP-ML.md നോക്കൂ)</span>`;
  } else if (!s.youtube.connected) {
    yt.innerHTML = `<a class="btn" href="/auth/google">Connect YouTube</a>`;
  } else {
    yt.innerHTML = `<div>✓ <b>${esc(s.youtube.channelTitle)}</b></div>
      <div><a class="btn ghost" href="/auth/google">Reconnect</a> <button class="ghost" data-disconnect="youtube">Disconnect</button></div>`;
  }

  const meta = $('#acc-meta .acc-body');
  if (!s.meta.configured) {
    meta.innerHTML = `<span class="muted">.env-ൽ META_APP_ID, META_APP_SECRET ചേർക്കണം (SETUP-ML.md നോക്കൂ)</span>`;
  } else if (!s.meta.connected) {
    meta.innerHTML = `<a class="btn" href="/auth/facebook">Connect Facebook + Instagram</a>`;
  } else {
    const options = s.meta.pages
      .map((p) => `<option value="${esc(p.id)}" ${p.id === s.meta.selectedPageId ? 'selected' : ''}>${esc(p.name)}${p.igUsername ? ` (@${esc(p.igUsername)})` : ''}</option>`)
      .join('');
    meta.innerHTML = `
      ${s.meta.pages.length > 1 ? `<select id="pageSelect">${options}</select>` : ''}
      <div>✓ Page: <b>${esc(s.meta.pageName)}</b></div>
      <div>${s.meta.igUsername ? `✓ Instagram: <b>@${esc(s.meta.igUsername)}</b>` : `<span style="color:var(--err)">✗ ഈ Page-ന് Instagram Business/Creator അക്കൗണ്ട് link ചെയ്തിട്ടില്ല</span>`}</div>
      <div><a class="btn ghost" href="/auth/facebook">Reconnect</a> <button class="ghost" data-disconnect="meta">Disconnect</button></div>`;
    $('#pageSelect')?.addEventListener('change', async (e) => {
      await fetch(api('/api/meta/page'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pageId: e.target.value }),
      });
      loadStatus();
    });
  }

  document.querySelectorAll('[data-disconnect]').forEach((b) =>
    b.addEventListener('click', async () => {
      if (!confirm('Disconnect this account?')) return;
      await fetch(api(`/api/disconnect/${b.dataset.disconnect}`), { method: 'POST' });
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
  $('#dropText').textContent = `${file.name} · ${(file.size / 1024 / 1024).toFixed(1)} MB`;
  preview.src = URL.createObjectURL(file);
  preview.hidden = false;
  preview.onloadedmetadata = () => {
    const vertical = preview.videoHeight > preview.videoWidth;
    const short = preview.duration <= 90;
    document.querySelector(`input[name=type][value=${vertical && short ? 'reel' : 'video'}]`).checked = true;
  };
}

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

// ---------- submit ----------
$('#form').addEventListener('submit', (e) => {
  e.preventDefault();
  const form = e.target;
  const platforms = [...form.querySelectorAll('input[name=platforms]:checked')].map((i) => i.value);
  if (!platforms.length) return alert('ഒരു platform എങ്കിലും തിരഞ്ഞെടുക്കൂ');
  if (!input.files[0]) return alert('Video തിരഞ്ഞെടുക്കൂ');

  const data = new FormData(form);
  data.delete('platforms');
  data.set('platforms', platforms.join(','));

  const bar = $('#sendProgress');
  const submit = $('#submit');
  bar.hidden = false;
  submit.disabled = true;

  const xhr = new XMLHttpRequest();
  xhr.open('POST', api('/api/upload'));
  xhr.upload.onprogress = (ev) => {
    if (!ev.lengthComputable) return;
    const pct = Math.round((ev.loaded / ev.total) * 100);
    bar.querySelector('div').style.width = `${pct}%`;
    bar.querySelector('span').textContent = pct < 100 ? `Sending to server ${pct}%` : 'Starting uploads…';
  };
  xhr.onload = () => {
    submit.disabled = false;
    bar.hidden = true;
    let res = {};
    try { res = JSON.parse(xhr.responseText); } catch {}
    if (xhr.status !== 200) return alert(res.error || `Upload failed (${xhr.status})`);
    form.reset();
    preview.hidden = true;
    preview.removeAttribute('src');
    $('#dropText').textContent = 'Video തിരഞ്ഞെടുക്കൂ (അല്ലെങ്കിൽ ഇവിടെ drag ചെയ്യൂ)';
    $('#capCount').textContent = '0 / 2200';
    loadJobs();
  };
  xhr.onerror = () => {
    submit.disabled = false;
    bar.hidden = true;
    alert('Network error');
  };
  xhr.send(data);
});

// ---------- history ----------
const NAMES = { youtube: 'YouTube', instagram: 'Instagram', facebook: 'Facebook' };
const ICON = { pending: '⏳', running: '⏳', done: '✅', error: '❌' };

async function loadJobs() {
  const jobs = await fetch(api('/api/jobs')).then((r) => r.json());
  const box = $('#jobs');
  if (!jobs.length) {
    box.innerHTML = '<p class="muted">ഇതുവരെ ഒന്നുമില്ല</p>';
  } else {
    box.innerHTML = jobs
      .map(
        (j) => `<div class="job">
          <div class="job-head"><b>${esc(j.fileName)} <span class="muted">· ${j.type === 'reel' ? 'Reel' : 'Video'}</span></b>
          <time>${new Date(j.createdAt).toLocaleString()}</time></div>
          ${Object.entries(j.platforms)
            .map(
              ([p, s]) => `<div class="pstat"><span class="name">${NAMES[p]}</span>
                <span class="${s.state}">${ICON[s.state]} ${esc(s.message)}
                ${s.url ? ` · <a href="${esc(s.url)}" target="_blank" rel="noopener">Open</a>` : ''}</span></div>`,
            )
            .join('')}
        </div>`,
      )
      .join('');
  }
  const active = jobs.some((j) => Object.values(j.platforms).some((s) => s.state === 'pending' || s.state === 'running'));
  clearTimeout(loadJobs.timer);
  loadJobs.timer = setTimeout(loadJobs, active ? 2500 : 15000);
}

loadStatus();
loadJobs();
