import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import express from 'express';
import multer from 'multer';
import { del as blobDel, get as blobGet } from '@vercel/blob';
import { handleUpload } from '@vercel/blob/client';
import { waitUntil } from '@vercel/functions';
import { config } from './config.js';
import { getAccounts, getJob, listJobs, removeAccount, saveJob, useBlob, withBlobAccess } from './store.js';
import { uploadToYouTube, youtubeAuthUrl, youtubeConfigured, youtubeHandleCallback } from './youtube.js';
import {
  metaAuthUrl,
  metaConfigured,
  metaHandleCallback,
  pageFromAccounts,
  selectPage,
  uploadToFacebook,
  uploadToInstagram,
} from './meta.js';

const MAX_VIDEO_BYTES = 300 * 1024 * 1024; // 300 MB (Instagram's limit for Reels)

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

const asyncRoute = (fn) => (req, res) =>
  fn(req, res).catch((err) => {
    console.error(err);
    res.status(500).json({ error: err.message });
  });

// ---------- connecting accounts ----------
// The login "state" is signed instead of kept in memory, because on Vercel the
// login callback can land on a different server instance than the one that started it.
function signState(payload) {
  return crypto.createHmac('sha256', `state:${config.mediaSecret}`).update(payload).digest('hex');
}

function newState() {
  const payload = `${Date.now() + 10 * 60 * 1000}.${crypto.randomBytes(8).toString('hex')}`;
  return `${payload}.${signState(payload)}`;
}

function useState(state) {
  const i = state.lastIndexOf('.');
  if (i < 0) return false;
  const payload = state.slice(0, i);
  const sig = Buffer.from(state.slice(i + 1));
  const expected = Buffer.from(signState(payload));
  if (sig.length !== expected.length || !crypto.timingSafeEqual(sig, expected)) return false;
  return Number(payload.split('.')[0]) > Date.now();
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

app.post(
  '/api/disconnect/:platform',
  asyncRoute(async (req, res) => {
    const key = { youtube: 'youtube', meta: 'meta' }[req.params.platform];
    if (!key) return res.status(400).json({ error: 'Unknown platform' });
    await removeAccount(key);
    res.json({ ok: true });
  }),
);

app.post('/api/meta/page', async (req, res) => {
  try {
    await selectPage(String(req.body.pageId));
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get(
  '/api/status',
  asyncRoute(async (req, res) => {
    const accounts = await getAccounts();
    const { youtube, meta } = accounts;
    const page = pageFromAccounts(accounts);
    res.json({
      baseUrl: config.baseUrl,
      igUploadMode: config.igUploadMode,
      blobUploads: useBlob,
      maxVideoBytes: MAX_VIDEO_BYTES,
      storageWarning:
        config.onVercel && !useBlob ? 'No Vercel Blob store is connected, so logins will be forgotten.' : null,
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
  }),
);

// ---------- uploading ----------

// 1) On Vercel the browser uploads the video straight to Vercel Blob (Vercel itself
//    only accepts 4.5 MB per request). This route hands the browser a short-lived token.
app.post(
  '/api/blob-upload',
  asyncRoute(async (req, res) => {
    if (!useBlob) return res.status(400).json({ error: 'Blob uploads are not enabled' });
    const result = await handleUpload({
      body: req.body,
      request: req,
      onBeforeGenerateToken: async (pathname) => {
        if (!pathname.startsWith('uploads/')) throw new Error('Bad upload path');
        return {
          allowedContentTypes: ['video/*'],
          maximumSizeInBytes: MAX_VIDEO_BYTES,
          addRandomSuffix: true,
        };
      },
    });
    res.json(result);
  }),
);

// 2) Locally the video is posted straight to this server.
const upload = multer({
  storage: multer.diskStorage({
    destination: config.paths.uploads,
    filename: (req, file, cb) => {
      const ext = (path.extname(file.originalname) || '.mp4').toLowerCase().replace(/[^.a-z0-9]/g, '');
      cb(null, `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${ext}`);
    },
  }),
  limits: { fileSize: MAX_VIDEO_BYTES },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('video/')) cb(null, true);
    else cb(new Error('Please choose a video file'));
  },
});

function readFields(b) {
  const platforms = String(b.platforms || '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => ['youtube', 'instagram', 'facebook'].includes(s));
  const caption = String(b.caption || '');
  return {
    platforms,
    type: b.type === 'video' ? 'video' : 'reel',
    caption,
    ytTitle: String(b.ytTitle || '').trim(),
    ytDescription: String(b.ytDescription || '').trim() || caption,
    tags: String(b.tags || '')
      .split(',')
      .map((t) => t.trim().replace(/^#/, ''))
      .filter(Boolean),
    privacy: ['public', 'unlisted', 'private'].includes(b.privacy) ? b.privacy : 'public',
  };
}

async function startJob(res, fields, source, fileName) {
  const job = {
    id: crypto.randomBytes(8).toString('hex'),
    createdAt: new Date().toISOString(),
    fileName,
    type: fields.type,
    caption: fields.caption,
    platforms: Object.fromEntries(fields.platforms.map((p) => [p, { state: 'pending', message: 'Waiting' }])),
  };
  await saveJob(job);
  res.json({ jobId: job.id });
  const title = fields.ytTitle || fields.caption.split('\n')[0].slice(0, 100) || fileName;
  // waitUntil keeps the work going on Vercel after the reply has been sent.
  waitUntil(runJob(job, { ...fields, ytTitle: title }, source));
}

app.post('/api/upload', (req, res) => {
  // Vercel: the video is already in Blob storage; we get its URL as JSON.
  if (req.is('application/json')) {
    const b = req.body || {};
    const fields = readFields(b);
    if (!useBlob) return res.status(400).json({ error: 'Blob uploads are not enabled' });
    if (!fields.platforms.length) return res.status(400).json({ error: 'Choose at least one platform' });
    let host = '';
    try {
      host = new URL(String(b.blobUrl)).hostname;
    } catch {
      /* invalid */
    }
    if (!host.endsWith('.blob.vercel-storage.com')) return res.status(400).json({ error: 'Bad video URL' });
    return startJob(res, fields, { kind: 'blob', url: String(b.blobUrl) }, String(b.fileName || 'video.mp4')).catch(
      (err) => res.status(500).json({ error: err.message }),
    );
  }

  upload.single('video')(req, res, (err) => {
    if (err) {
      const msg = err.code === 'LIMIT_FILE_SIZE' ? 'Video is bigger than 300 MB' : err.message;
      return res.status(400).json({ error: msg });
    }
    if (!req.file) return res.status(400).json({ error: 'No video received' });
    const fields = readFields(req.body);
    if (!fields.platforms.length) {
      fs.rmSync(req.file.path, { force: true });
      return res.status(400).json({ error: 'Choose at least one platform' });
    }
    startJob(res, fields, { kind: 'file', path: req.file.path, name: req.file.filename }, req.file.originalname).catch(
      (e) => res.status(500).json({ error: e.message }),
    );
  });
});

async function downloadBlob(url, dest) {
  const result = await withBlobAccess((access) => blobGet(url, { access, useCache: false }));
  if (!result?.stream) throw new Error('Uploaded video not found in storage');
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  await pipeline(Readable.fromWeb(result.stream), fs.createWriteStream(dest));
}

async function runJob(job, input, source) {
  const isShort = job.type === 'reel';

  // Save progress, but not more than every 2 seconds unless something important changed.
  let lastSave = 0;
  const update = (platform, patch, important = true) => {
    job.platforms[platform] = { ...job.platforms[platform], ...patch, updatedAt: new Date().toISOString() };
    if (!important && Date.now() - lastSave < 2000) return;
    lastSave = Date.now();
    saveJob(job).catch((err) => console.error('Could not save job', err));
  };
  const platforms = Object.keys(job.platforms);

  let filePath = source.path;
  let tempFile = null;
  try {
    if (source.kind === 'blob') {
      platforms.forEach((p) => update(p, { message: 'Preparing video' }));
      tempFile = path.join(config.paths.uploads, `${job.id}${path.extname(job.fileName) || '.mp4'}`);
      await downloadBlob(source.url, tempFile);
      filePath = tempFile;
    }

    const tasks = {
      youtube: () =>
        uploadToYouTube(
          {
            filePath,
            title: input.ytTitle,
            description: input.ytDescription,
            tags: input.tags,
            privacy: input.privacy,
            isShort,
          },
          (pct) => update('youtube', { message: `Uploading ${pct}%`, progress: pct }, false),
        ),
      facebook: () =>
        uploadToFacebook({ filePath, title: input.ytTitle, description: input.caption, isShort }, (msg) =>
          update('facebook', { message: msg }),
        ),
      instagram: () =>
        uploadToInstagram(
          {
            filePath,
            caption: input.caption,
            publicVideoUrl: source.kind === 'file' ? publicMediaUrl(source.name) : null,
          },
          (msg) => update('instagram', { message: msg }),
        ),
    };

    await Promise.allSettled(
      platforms.map(async (platform) => {
        update(platform, { state: 'running', message: 'Starting' });
        try {
          const result = await tasks[platform]();
          let message = result.note || 'Posted';
          if (platform === 'youtube' && result.privacy && result.privacy !== input.privacy) {
            message = `Uploaded, but YouTube set it to "${result.privacy}" (unverified Google project). Change it in YouTube Studio.`;
          }
          update(platform, { state: 'done', message, url: result.url, progress: 100 });
        } catch (err) {
          console.error(`[${platform}]`, err);
          update(platform, { state: 'error', message: err.message });
        }
      }),
    );
  } catch (err) {
    console.error('[job]', err);
    platforms.forEach((p) => {
      if (job.platforms[p].state !== 'done') update(p, { state: 'error', message: err.message });
    });
  } finally {
    await saveJob(job).catch((err) => console.error('Could not save job', err));
    if (tempFile) fs.rmSync(tempFile, { force: true });
    if (source.kind === 'blob') await blobDel(source.url).catch(() => {});
  }
}

app.get(
  '/api/jobs',
  asyncRoute(async (req, res) => {
    res.json(await listJobs());
  }),
);

app.get(
  '/api/jobs/:id',
  asyncRoute(async (req, res) => {
    const job = await getJob(req.params.id);
    if (!job) return res.status(404).json({ error: 'Not found' });
    res.json(job);
  }),
);

// ---------- delete old local video files ----------
function cleanupUploads() {
  const maxAge = config.keepFilesHours * 60 * 60 * 1000;
  let files = [];
  try {
    files = fs.readdirSync(config.paths.uploads);
  } catch {
    return;
  }
  for (const f of files) {
    const full = path.join(config.paths.uploads, f);
    try {
      if (Date.now() - fs.statSync(full).mtimeMs > maxAge) fs.rmSync(full, { force: true });
    } catch {
      /* ignore */
    }
  }
}

// On Vercel the app is exported and Vercel runs it; locally we start our own server.
if (!config.onVercel) {
  setInterval(cleanupUploads, 60 * 60 * 1000).unref();
  cleanupUploads();
  app.listen(config.port, () => {
    console.log(`Uploader running at http://localhost:${config.port}`);
    console.log(`Public address: ${config.baseUrl}`);
    console.log(`Storage: ${useBlob ? 'Vercel Blob' : 'local files'}`);
    if (!config.appPassword) console.log('WARNING: APP_PASSWORD is empty, the page has no password.');
  });
}

export default app;
