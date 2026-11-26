import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import multer from 'multer';
import { config } from './config.js';
import { createJob, getAccounts, getJob, listJobs, removeAccount, updatePlatform } from './store.js';
import { uploadToYouTube, youtubeAuthUrl, youtubeConfigured, youtubeHandleCallback } from './youtube.js';
import {
  metaAuthUrl,
  metaConfigured,
  metaHandleCallback,
  selectPage,
  selectedPage,
  uploadToFacebook,
  uploadToInstagram,
} from './meta.js';

const app = express();
app.disable('x-powered-by');

// ---------- signed public links to uploaded files (used when Instagram downloads by URL) ----------
function signMedia(file, exp) {
  return crypto.createHmac('sha256', config.mediaSecret).update(`${file}:${exp}`).digest('hex');
}

function publicMediaUrl(file) {
  const exp = Date.now() + 6 * 60 * 60 * 1000;
  return `${config.baseUrl}/media/${encodeURIComponent(file)}?exp=${exp}&sig=${signMedia(file, exp)}`;
}

app.get('/media/:file', (req, res) => {
  const file = path.basename(req.params.file);
  const exp = Number(req.query.exp);
  const sig = String(req.query.sig || '');
  const expected = signMedia(file, exp);
  const valid =
    exp > Date.now() &&
    sig.length === expected.length &&
    crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
  if (!valid) return res.status(403).send('Forbidden');
  const full = path.join(config.paths.uploads, file);
  if (!fs.existsSync(full)) return res.status(404).send('Not found');
  res.sendFile(full);
});

// ---------- password protection for everything else ----------
app.use((req, res, next) => {
  if (!config.appPassword) return next();
  const header = req.headers.authorization || '';
  const [scheme, encoded] = header.split(' ');
  if (scheme === 'Basic' && encoded) {
    const pass = Buffer.from(encoded, 'base64').toString().split(':').slice(1).join(':');
    const a = Buffer.from(pass);
    const b = Buffer.from(config.appPassword);
    if (a.length === b.length && crypto.timingSafeEqual(a, b)) return next();
  }
  res.set('WWW-Authenticate', 'Basic realm="Uploader"');
  res.status(401).send('Password required');
});

app.use(express.json());
app.use(express.static(config.paths.public));

// ---------- connecting accounts ----------
const pendingStates = new Map(); // state -> expiry time

function newState() {
  const state = crypto.randomBytes(16).toString('hex');
  pendingStates.set(state, Date.now() + 10 * 60 * 1000);
  return state;
}

function useState(state) {
  const exp = pendingStates.get(state);
  pendingStates.delete(state);
  return Boolean(exp && exp > Date.now());
}

const backHome = (res, params) => res.redirect(`/?${new URLSearchParams(params)}`);

app.get('/auth/google', (req, res) => {
  if (!youtubeConfigured()) return backHome(res, { error: 'Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to .env first' });
  res.redirect(youtubeAuthUrl(newState()));
});

app.get('/auth/google/callback', async (req, res) => {
  try {
    if (req.query.error) throw new Error(String(req.query.error));
    if (!useState(String(req.query.state))) throw new Error('Login link expired, try again');
    await youtubeHandleCallback(String(req.query.code));
    backHome(res, { connected: 'youtube' });
  } catch (err) {
    backHome(res, { error: `YouTube: ${err.message}` });
  }
});

app.get('/auth/facebook', (req, res) => {
  if (!metaConfigured()) return backHome(res, { error: 'Add META_APP_ID and META_APP_SECRET to .env first' });
  res.redirect(metaAuthUrl(newState()));
});

app.get('/auth/facebook/callback', async (req, res) => {
  try {
    if (req.query.error) throw new Error(String(req.query.error_description || req.query.error));
    if (!useState(String(req.query.state))) throw new Error('Login link expired, try again');
    await metaHandleCallback(String(req.query.code));
    backHome(res, { connected: 'facebook' });
  } catch (err) {
    backHome(res, { error: `Facebook: ${err.message}` });
  }
});

app.post('/api/disconnect/:platform', (req, res) => {
  const key = { youtube: 'youtube', meta: 'meta' }[req.params.platform];
  if (!key) return res.status(400).json({ error: 'Unknown platform' });
  removeAccount(key);
  res.json({ ok: true });
});

app.post('/api/meta/page', (req, res) => {
  try {
    selectPage(String(req.body.pageId));
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get('/api/status', (req, res) => {
  const { youtube, meta } = getAccounts();
  const page = selectedPage();
  res.json({
    baseUrl: config.baseUrl,
    igUploadMode: config.igUploadMode,
    youtube: {
      configured: youtubeConfigured(),
      connected: Boolean(youtube),
      channelTitle: youtube?.channelTitle,
    },
    meta: {
      configured: metaConfigured(),
      connected: Boolean(meta),
      pages: (meta?.pages || []).map((p) => ({ id: p.id, name: p.name, igUsername: p.ig?.username || null })),
      selectedPageId: page?.id || null,
      pageName: page?.name || null,
      igUsername: page?.ig?.username || null,
    },
  });
});

// ---------- uploading ----------
const upload = multer({
  storage: multer.diskStorage({
    destination: config.paths.uploads,
    filename: (req, file, cb) => {
      const ext = (path.extname(file.originalname) || '.mp4').toLowerCase().replace(/[^.a-z0-9]/g, '');
      cb(null, `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${ext}`);
    },
  }),
  limits: { fileSize: 4 * 1024 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('video/')) cb(null, true);
    else cb(new Error('Please choose a video file'));
  },
});

app.post('/api/upload', (req, res) => {
  upload.single('video')(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message });
    if (!req.file) return res.status(400).json({ error: 'No video received' });

    const b = req.body;
    const platforms = String(b.platforms || '')
      .split(',')
      .map((s) => s.trim())
      .filter((s) => ['youtube', 'instagram', 'facebook'].includes(s));
    if (!platforms.length) {
      fs.rmSync(req.file.path, { force: true });
      return res.status(400).json({ error: 'Choose at least one platform' });
    }

    const caption = String(b.caption || '');
    const job = createJob({
      id: crypto.randomBytes(8).toString('hex'),
      createdAt: new Date().toISOString(),
      fileName: req.file.originalname,
      storedFile: req.file.filename,
      type: b.type === 'video' ? 'video' : 'reel',
      caption,
      platforms: Object.fromEntries(platforms.map((p) => [p, { state: 'pending', message: 'Waiting' }])),
    });

    res.json({ jobId: job.id });

    runJob(job, {
      filePath: req.file.path,
      caption,
      ytTitle: String(b.ytTitle || '').trim() || caption.split('\n')[0].slice(0, 100) || req.file.originalname,
      ytDescription: String(b.ytDescription || '').trim() || caption,
      tags: String(b.tags || '')
        .split(',')
        .map((t) => t.trim().replace(/^#/, ''))
        .filter(Boolean),
      privacy: ['public', 'unlisted', 'private'].includes(b.privacy) ? b.privacy : 'public',
    });
  });
});

async function runJob(job, input) {
  const isShort = job.type === 'reel';
  const tasks = {
    youtube: () =>
      uploadToYouTube(
        {
          filePath: input.filePath,
          title: input.ytTitle,
          description: input.ytDescription,
          tags: input.tags,
          privacy: input.privacy,
          isShort,
        },
        (pct) => updatePlatform(job.id, 'youtube', { message: `Uploading ${pct}%`, progress: pct }),
      ),
    facebook: () =>
      uploadToFacebook(
        { filePath: input.filePath, title: input.ytTitle, description: input.caption, isShort },
        (msg) => updatePlatform(job.id, 'facebook', { message: msg }),
      ),
    instagram: () =>
      uploadToInstagram(
        {
          filePath: input.filePath,
          caption: input.caption,
          publicVideoUrl: publicMediaUrl(job.storedFile),
        },
        (msg) => updatePlatform(job.id, 'instagram', { message: msg }),
      ),
  };

  await Promise.allSettled(
    Object.keys(job.platforms).map(async (platform) => {
      updatePlatform(job.id, platform, { state: 'running', message: 'Starting' });
      try {
        const result = await tasks[platform]();
        let message = result.note || 'Posted';
        if (platform === 'youtube' && result.privacy && result.privacy !== input.privacy) {
          message = `Uploaded, but YouTube set it to "${result.privacy}" (unverified Google project). Change it in YouTube Studio.`;
        }
        updatePlatform(job.id, platform, { state: 'done', message, url: result.url, progress: 100 });
      } catch (err) {
        console.error(`[${platform}]`, err);
        updatePlatform(job.id, platform, { state: 'error', message: err.message });
      }
    }),
  );
}

app.get('/api/jobs', (req, res) => {
  res.json(listJobs().map(({ storedFile, ...rest }) => rest));
});

app.get('/api/jobs/:id', (req, res) => {
  const job = getJob(req.params.id);
  if (!job) return res.status(404).json({ error: 'Not found' });
  const { storedFile, ...rest } = job;
  res.json(rest);
});

// ---------- delete old video files ----------
function cleanupUploads() {
  const busy = new Set(
    listJobs()
      .filter((j) => Object.values(j.platforms).some((p) => p.state === 'pending' || p.state === 'running'))
      .map((j) => j.storedFile),
  );
  const maxAge = config.keepFilesHours * 60 * 60 * 1000;
  for (const f of fs.readdirSync(config.paths.uploads)) {
    const full = path.join(config.paths.uploads, f);
    try {
      if (!busy.has(f) && Date.now() - fs.statSync(full).mtimeMs > maxAge) fs.rmSync(full, { force: true });
    } catch {
      /* ignore */
    }
  }
}
setInterval(cleanupUploads, 60 * 60 * 1000).unref();
cleanupUploads();

app.listen(config.port, () => {
  console.log(`Uploader running at http://localhost:${config.port}`);
  console.log(`Public address: ${config.baseUrl}`);
  if (!config.appPassword) console.log('WARNING: APP_PASSWORD is empty, the page has no password.');
});
