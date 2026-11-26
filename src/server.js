import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import express from 'express';
import multer from 'multer';
import { del as blobDel, get as blobGet, issueSignedToken, presignUrl } from '@vercel/blob';
import { handleUpload } from '@vercel/blob/client';
import { waitUntil } from '@vercel/functions';
import { config } from './config.js';
import { getAnalytics } from './analytics.js';
import {
  blobAccess,
  createJob,
  getAccounts,
  getJob,
  listJobs,
  removeAccount,
  removeJob,
  updateJob,
  useBlob,
  listIdeas,
  changeIdeas,
  withBlobAccess,
} from './store.js';
import {
  deleteYouTubeVideo,
  uploadToYouTube,
  youtubeAuthUrl,
  youtubeCanDelete,
  youtubeConfigured,
  youtubeHandleCallback,
  youtubeIdFromUrl,
} from './youtube.js';
import {
  deleteFacebookVideo,
  deleteInstagramMedia,
  facebookIdFromUrl,
  instagramCanDelete,
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

// ---------- login (password -> signed session cookie) ----------
const SESSION_COOKIE = 'ou_session';
const SESSION_DAYS = 30;

function sessionSig(exp) {
  // Changing APP_PASSWORD or MEDIA_SECRET logs everyone out.
  return crypto.createHmac('sha256', `session:${config.appPassword}:${config.mediaSecret}`).update(String(exp)).digest('hex');
}

function readCookie(req, name) {
  for (const part of String(req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return '';
}

function hasSession(req) {
  const [exp, sig] = readCookie(req, SESSION_COOKIE).split('.');
  if (!exp || !sig || Number(exp) < Date.now()) return false;
  const a = Buffer.from(sig);
  const b = Buffer.from(sessionSig(exp));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function passwordMatches(pass) {
  const a = crypto.createHash('sha256').update(String(pass)).digest();
  const b = crypto.createHash('sha256').update(config.appPassword).digest();
  return crypto.timingSafeEqual(a, b);
}

// Scripts (and curl) may still use HTTP Basic auth.
function hasBasicAuth(req) {
  const [scheme, encoded] = String(req.headers.authorization || '').split(' ');
  if (scheme !== 'Basic' || !encoded) return false;
  return passwordMatches(Buffer.from(encoded, 'base64').toString().split(':').slice(1).join(':'));
}

function isHttps(req) {
  return req.secure || String(req.headers['x-forwarded-proto'] || '').split(',')[0] === 'https';
}

app.use(express.json());

app.post('/api/login', async (req, res) => {
  if (!config.appPassword || passwordMatches(req.body?.password || '')) {
    const exp = Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000;
    res.cookie(SESSION_COOKIE, `${exp}.${sessionSig(exp)}`, {
      httpOnly: true,
      sameSite: 'lax',
      secure: isHttps(req),
      maxAge: SESSION_DAYS * 24 * 60 * 60 * 1000,
      path: '/',
    });
    return res.json({ ok: true });
  }
  await new Promise((r) => setTimeout(r, 600)); // slow down guessing
  res.status(401).json({ error: 'Wrong password' });
});

app.post('/api/logout', (req, res) => {
  res.clearCookie(SESSION_COOKIE, { path: '/' });
  res.json({ ok: true });
});

const OPEN_PATHS = new Set(['/login', '/login.html', '/login.js', '/style.css', '/favicon.svg', '/api/cron', '/privacy.html']);

app.use((req, res, next) => {
  if (!config.appPassword || OPEN_PATHS.has(req.path) || hasSession(req) || hasBasicAuth(req)) return next();
  if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'Login required' });
  res.redirect(`/login.html?next=${encodeURIComponent(req.originalUrl)}`);
});

app.get('/login', (req, res) => res.redirect('/login.html'));
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
    // Backup for the timer: opening the app also posts anything that is due.
    waitUntil(runDuePosts().catch((err) => console.error('[schedule]', err)));
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
        canDelete: youtubeCanDelete(youtube),
      },
      meta: {
        configured: metaConfigured(),
        connected: Boolean(meta),
        pages: (meta?.pages || []).map((p) => ({ id: p.id, name: p.name, igUsername: p.ig?.username || null })),
        selectedPageId: page?.id || null,
        pageName: page?.name || null,
        igUsername: page?.ig?.username || null,
        canDeleteInstagram: instagramCanDelete(accounts),
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
    // Empty = use the caption (worked out when posting, so edits to the caption carry over).
    ytDescription: String(b.ytDescription || '').trim(),
    tags: (Array.isArray(b.tags) ? b.tags : String(b.tags || '').split(','))
      .map((t) => String(t).trim().replace(/^#/, ''))
      .filter(Boolean),
    privacy: ['public', 'unlisted', 'private'].includes(b.privacy) ? b.privacy : 'public',
    // "now" = post right away, "schedule" = post at scheduledAt, "draft" = keep for later.
    mode: ['schedule', 'draft'].includes(b.mode) ? b.mode : 'now',
    scheduledAt: b.scheduledAt ? new Date(b.scheduledAt) : null,
  };
}

const PLATFORM_LABEL = { scheduled: 'Scheduled', draft: 'Draft' };

function checkScheduleTime(fields) {
  if (fields.mode !== 'schedule') return null;
  if (!fields.scheduledAt || Number.isNaN(fields.scheduledAt.getTime())) return 'Choose a date and time';
  if (fields.scheduledAt.getTime() < Date.now() - 60_000) return 'That time is in the past';
  return null;
}

// What runJob needs, built from a stored job (used for scheduled posts, drafts and retries).
function inputFromJob(job) {
  const i = job.input || {};
  return {
    caption: job.caption || '',
    ytTitle: i.ytTitle || (job.caption || '').split('\n')[0].slice(0, 100) || job.fileName,
    ytDescription: i.ytDescription || '',
    tags: i.tags || [],
    privacy: i.privacy || 'public',
  };
}

async function startJob(res, fields, source, fileName) {
  const later = fields.mode !== 'now';
  const job = {
    id: crypto.randomBytes(8).toString('hex'),
    createdAt: new Date().toISOString(),
    fileName,
    type: fields.type,
    caption: fields.caption,
    status: later ? (fields.mode === 'schedule' ? 'scheduled' : 'draft') : 'posting',
    scheduledAt: fields.mode === 'schedule' ? fields.scheduledAt.toISOString() : null,
    // Kept so the post can run later / be retried with the same settings.
    input: { ytTitle: fields.ytTitle, ytDescription: fields.ytDescription, tags: fields.tags, privacy: fields.privacy },
    platforms: Object.fromEntries(
      fields.platforms.map((p) => [
        p,
        later ? { state: stateFor(fields.mode), message: PLATFORM_LABEL[stateFor(fields.mode)] } : { state: 'pending', message: 'Waiting' },
      ]),
    ),
  };
  if (later) job.mediaSource = source; // the video waits in storage until it is posted
  await createJob(job);
  if (later) return res.json(publicJob(job));
  liveJobs.set(job.id, job);
  res.json({ jobId: job.id });
  // waitUntil keeps the work going on Vercel after the reply has been sent.
  waitUntil(runJob(job, inputFromJob(job), source));
}

function stateFor(mode) {
  return mode === 'schedule' ? 'scheduled' : 'draft';
}

// Start posting a draft or scheduled post now (the posting itself continues in the background).
async function publishStored(job) {
  if (!job.mediaSource) throw new Error('This post has no video');
  for (const p of Object.keys(job.platforms)) job.platforms[p] = { state: 'pending', message: 'Waiting' };
  job.status = 'posting';
  job.claimedAt = new Date().toISOString();
  await updateJob(job.id, (stored) => {
    stored.platforms = job.platforms;
    stored.status = 'posting';
    stored.claimedAt = job.claimedAt;
  });
  liveJobs.set(job.id, job);
  waitUntil(runJob(job, inputFromJob(job), job.mediaSource));
}

// Posts whose time has come. Called by the timer (cron-job.org) and when the app is opened.
async function runDuePosts() {
  const now = Date.now();
  const due = (await listJobs()).filter(
    (j) =>
      j.status === 'scheduled' &&
      j.scheduledAt &&
      new Date(j.scheduledAt).getTime() <= now &&
      !liveJobs.has(j.id) &&
      !(j.claimedAt && now - new Date(j.claimedAt).getTime() < 15 * 60 * 1000),
  );
  for (const job of due) {
    await publishStored(job).catch((err) => console.error('[schedule]', err));
  }
  return due.length;
}

function cronKey() {
  return crypto.createHmac('sha256', config.mediaSecret).update('oneupload-cron').digest('hex').slice(0, 32);
}

// A short-lived signed link to a private Blob video, so Instagram can download it itself.
async function signedBlobUrl(url) {
  if (blobAccess === 'public') return url;
  const pathname = decodeURIComponent(new URL(url).pathname.replace(/^\//, ''));
  const validUntil = Date.now() + 2 * 60 * 60 * 1000;
  const token = await issueSignedToken({ pathname, operations: ['get'], validUntil });
  const { presignedUrl } = await presignUrl(token, { operation: 'get', pathname, access: 'private', validUntil });
  return presignedUrl;
}

app.post('/api/upload', (req, res) => {
  // Vercel: the video is already in Blob storage; we get its URL as JSON.
  if (req.is('application/json')) {
    const b = req.body || {};
    const fields = readFields(b);
    if (!useBlob) return res.status(400).json({ error: 'Blob uploads are not enabled' });
    if (!fields.platforms.length) return res.status(400).json({ error: 'Choose at least one platform' });
    const timeError = checkScheduleTime(fields);
    if (timeError) return res.status(400).json({ error: timeError });
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
    const problem = !fields.platforms.length ? 'Choose at least one platform' : checkScheduleTime(fields);
    if (problem) {
      fs.rmSync(req.file.path, { force: true });
      return res.status(400).json({ error: problem });
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

// Jobs running on this server instance, with live progress. Only important changes
// (started / posted / failed) are written to storage, to keep storage operations low.
const liveJobs = new Map();

// `only` limits the run to some platforms (used by Retry).
async function runJob(job, input, source, only = null) {
  const isShort = job.type === 'reel';

  const update = (platform, patch, save = false) => {
    job.platforms[platform] = { ...job.platforms[platform], ...patch, updatedAt: new Date().toISOString() };
    if (!save) return;
    const snapshot = { ...job.platforms[platform] };
    updateJob(job.id, (stored) => {
      stored.platforms[platform] = { ...stored.platforms[platform], ...snapshot };
    }).catch((err) => console.error('Could not save job', err));
  };
  const platforms = only || Object.keys(job.platforms);

  let filePath = source.path;
  let tempFile = null;
  let igVideoUrl = null;
  try {
    if (source.kind === 'blob') {
      platforms.forEach((p) => update(p, { message: 'Preparing video' }));
      tempFile = path.join(config.paths.uploads, `${job.id}${path.extname(job.fileName) || '.mp4'}`);
      await downloadBlob(source.url, tempFile);
      filePath = tempFile;
      if (platforms.includes('instagram')) {
        igVideoUrl = await signedBlobUrl(source.url).catch((err) => {
          console.error('[instagram] could not make a signed link', err.message);
          return null;
        });
      }
    } else if (config.baseUrl.startsWith('https://')) {
      igVideoUrl = publicMediaUrl(source.name);
    }

    const tasks = {
      youtube: () =>
        uploadToYouTube(
          {
            filePath,
            title: input.ytTitle,
            description: input.ytDescription || input.caption,
            tags: input.tags,
            privacy: input.privacy,
            isShort,
          },
          (pct) => update('youtube', { message: `Uploading ${pct}%`, progress: pct }),
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
            publicVideoUrl: igVideoUrl,
          },
          (msg) => update('instagram', { message: msg }),
        ),
    };

    await Promise.allSettled(
      platforms.map(async (platform) => {
        update(platform, { state: 'running', message: 'Starting' }, true);
        try {
          const result = await tasks[platform]();
          let message = result.note || 'Posted';
          if (platform === 'youtube' && result.privacy && result.privacy !== input.privacy) {
            message = `Uploaded, but YouTube set it to "${result.privacy}" (unverified Google project). Change it in YouTube Studio.`;
          }
          update(
            platform,
            {
              state: 'done',
              message,
              url: result.url,
              postId: result.id,
              pageId: result.pageId,
              account: result.account,
              progress: 100,
            },
            true,
          );
        } catch (err) {
          console.error(`[${platform}]`, err);
          update(platform, { state: 'error', message: err.message }, true);
        }
      }),
    );
  } catch (err) {
    console.error('[job]', err);
    platforms.forEach((p) => {
      if (job.platforms[p].state !== 'done') update(p, { state: 'error', message: err.message }, true);
    });
  } finally {
    // If something failed, keep the video for a while so that platform can be retried.
    const failed = Object.values(job.platforms).some((p) => p.state === 'error');
    await updateJob(job.id, (stored) => {
      stored.platforms = { ...stored.platforms, ...job.platforms };
      stored.status = 'posted';
      stored.postedAt = new Date().toISOString();
      delete stored.mediaSource;
      delete stored.claimedAt;
      if (failed) stored.retrySource = { ...source, keptAt: new Date().toISOString() };
      else delete stored.retrySource;
    }).catch((err) => console.error('Could not save job', err));
    job.status = 'posted';
    liveJobs.delete(job.id);
    if (tempFile) fs.rmSync(tempFile, { force: true });
    if (!failed) await deleteSourceVideo(source);
  }
}

async function deleteSourceVideo(source) {
  if (!source) return;
  if (source.kind === 'blob') await blobDel(source.url).catch(() => {});
  if (source.kind === 'file' && source.path) fs.rmSync(source.path, { force: true });
}

// What the browser may see of a job (no internal storage links).
function publicJob(j) {
  const { retrySource, mediaSource, input, ...rest } = j;
  const keptMs = retrySource ? Date.now() - new Date(retrySource.keptAt).getTime() : Infinity;
  return {
    ...rest,
    status: j.status || 'posted', // uploads from before scheduling existed
    hasVideo: Boolean(mediaSource),
    // Settings the edit form needs (no storage links).
    settings: { ytTitle: input?.ytTitle || '', ytDescription: input?.ytDescription || '', tags: input?.tags || [], privacy: input?.privacy || 'public' },
    canRetry: keptMs < 24 * 60 * 60 * 1000,
  };
}

app.get(
  '/api/jobs',
  asyncRoute(async (req, res) => {
    const jobs = await listJobs();
    // Show live progress for jobs running on this instance.
    res.json(jobs.map((j) => publicJob(liveJobs.get(j.id) || j)));
  }),
);

app.get(
  '/api/jobs/:id',
  asyncRoute(async (req, res) => {
    const job = liveJobs.get(req.params.id) || (await getJob(req.params.id));
    if (!job) return res.status(404).json({ error: 'Not found' });
    res.json(publicJob(job));
  }),
);

// Try a failed platform again with the same video (kept for 24 hours after a failure).
app.post(
  '/api/jobs/:id/retry',
  asyncRoute(async (req, res) => {
    const platform = String(req.body?.platform || '');
    const job = await getJob(req.params.id);
    if (!job || job.platforms?.[platform]?.state !== 'error') return res.status(400).json({ error: 'Nothing to retry' });
    if (liveJobs.has(job.id)) return res.status(400).json({ error: 'Upload is still running' });
    if (!publicJob(job).canRetry) {
      return res.status(400).json({ error: 'Video ഇനി ലഭ്യമല്ല. Video വീണ്ടും upload ചെയ്യൂ (ഈ platform മാത്രം tick ചെയ്ത്).' });
    }
    job.platforms[platform] = { state: 'pending', message: 'Retrying' };
    await updateJob(job.id, (stored) => {
      stored.platforms[platform] = job.platforms[platform];
    });
    liveJobs.set(job.id, job);
    res.json(publicJob(job));
    waitUntil(runJob(job, inputFromJob(job), job.retrySource, [platform]));
  }),
);

// ---------- deleting posts ----------

const deleters = {
  youtube: (p) => deleteYouTubeVideo(p.postId || youtubeIdFromUrl(p.url)),
  facebook: (p) => deleteFacebookVideo(p.postId || facebookIdFromUrl(p.url), p.pageId),
  instagram: (p) => {
    if (!p.postId) {
      throw new Error('ഈ പഴയ Instagram post app-ൽ നിന്ന് delete ചെയ്യാൻ പറ്റില്ല. Instagram-ൽ "Open" ചെയ്ത് delete ചെയ്യൂ.');
    }
    return deleteInstagramMedia(p.postId, p.pageId);
  },
};

// Delete one platform's post (from YouTube / Instagram / Facebook itself).
app.post(
  '/api/jobs/:id/delete',
  asyncRoute(async (req, res) => {
    const platform = String(req.body?.platform || '');
    if (!deleters[platform]) return res.status(400).json({ error: 'Unknown platform' });
    const job = await getJob(req.params.id);
    const entry = job?.platforms?.[platform];
    if (!entry) return res.status(404).json({ error: 'Not found' });
    if (entry.state !== 'done' || entry.deleted) return res.status(400).json({ error: 'Nothing to delete' });
    try {
      await deleters[platform](entry);
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }
    const updated = await updateJob(job.id, (stored) => {
      stored.platforms[platform] = {
        ...stored.platforms[platform],
        deleted: true,
        deletedAt: new Date().toISOString(),
        message: 'Deleted',
      };
    });
    res.json(updated);
  }),
);

// Remove an upload from this list only (posts stay online).
app.post(
  '/api/jobs/:id/remove',
  asyncRoute(async (req, res) => {
    if (liveJobs.has(req.params.id)) return res.status(400).json({ error: 'Upload is still running' });
    const job = await getJob(req.params.id);
    await deleteSourceVideo(job?.retrySource);
    await deleteSourceVideo(job?.mediaSource); // a draft / scheduled post's waiting video
    res.json({ ok: await removeJob(req.params.id) });
  }),
);

// ---------- drafts & scheduled posts ----------

// Change a draft or scheduled post (caption, time, platforms, YouTube settings), or move
// it between draft and scheduled.
app.post(
  '/api/jobs/:id/edit',
  asyncRoute(async (req, res) => {
    const job = await getJob(req.params.id);
    if (!job || !['draft', 'scheduled'].includes(job.status)) return res.status(400).json({ error: 'Only drafts and scheduled posts can be edited' });
    const b = req.body || {};
    const fields = readFields({
      platforms: b.platforms ?? Object.keys(job.platforms).join(','),
      type: b.type ?? job.type,
      caption: b.caption ?? job.caption,
      ytTitle: b.ytTitle ?? job.input?.ytTitle,
      ytDescription: b.ytDescription ?? job.input?.ytDescription,
      tags: b.tags ?? job.input?.tags,
      privacy: b.privacy ?? job.input?.privacy,
      mode: b.mode ?? (job.status === 'scheduled' ? 'schedule' : 'draft'),
      scheduledAt: b.scheduledAt ?? job.scheduledAt,
    });
    if (!fields.platforms.length) return res.status(400).json({ error: 'Choose at least one platform' });
    if (fields.mode === 'now') fields.mode = 'draft';
    const timeError = checkScheduleTime(fields);
    if (timeError) return res.status(400).json({ error: timeError });
    const state = stateFor(fields.mode);
    const updated = await updateJob(job.id, (stored) => {
      stored.caption = fields.caption;
      stored.type = fields.type;
      stored.status = fields.mode === 'schedule' ? 'scheduled' : 'draft';
      stored.scheduledAt = fields.mode === 'schedule' ? fields.scheduledAt.toISOString() : null;
      stored.input = { ytTitle: fields.ytTitle, ytDescription: fields.ytDescription, tags: fields.tags, privacy: fields.privacy };
      stored.platforms = Object.fromEntries(fields.platforms.map((p) => [p, { state, message: PLATFORM_LABEL[state] }]));
      delete stored.claimedAt;
    });
    res.json(publicJob(updated));
  }),
);

// Post a draft or scheduled post right now.
app.post(
  '/api/jobs/:id/publish',
  asyncRoute(async (req, res) => {
    const job = await getJob(req.params.id);
    if (!job || !['draft', 'scheduled'].includes(job.status)) return res.status(400).json({ error: 'Nothing to post' });
    if (liveJobs.has(job.id)) return res.status(400).json({ error: 'Already posting' });
    await publishStored(job);
    res.json({ jobId: job.id });
  }),
);

// The timer. cron-job.org calls this every few minutes: GET /api/cron?key=...
app.all('/api/cron', async (req, res) => {
  const key = String(req.query.key || '');
  const expected = cronKey();
  if (key.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(key), Buffer.from(expected))) {
    return res.status(403).json({ error: 'Bad key' });
  }
  try {
    const started = await runDuePosts();
    res.json({ ok: true, started });
  } catch (err) {
    console.error('[cron]', err);
    res.status(500).json({ error: err.message });
  }
});

// The timer link to paste into cron-job.org (only shown to the logged-in owner).
app.get('/api/cron-info', (req, res) => {
  res.json({ url: `${config.baseUrl}/api/cron?key=${cronKey()}` });
});

// ---------- ideas ----------

app.get(
  '/api/ideas',
  asyncRoute(async (req, res) => res.json(await listIdeas())),
);

app.post(
  '/api/ideas',
  asyncRoute(async (req, res) => {
    const text = String(req.body?.text || '').trim().slice(0, 2200);
    if (!text) return res.status(400).json({ error: 'Write something first' });
    const idea = { id: crypto.randomBytes(6).toString('hex'), text, createdAt: new Date().toISOString() };
    await changeIdeas((ideas) => ideas.unshift(idea));
    res.json(idea);
  }),
);

app.post(
  '/api/ideas/:id/delete',
  asyncRoute(async (req, res) => {
    await changeIdeas((ideas) => {
      const i = ideas.findIndex((x) => x.id === req.params.id);
      if (i >= 0) ideas.splice(i, 1);
    });
    res.json({ ok: true });
  }),
);

// ---------- analytics ----------

app.get(
  '/api/analytics',
  asyncRoute(async (req, res) => {
    res.json(await getAnalytics(await listJobs(), req.query.refresh === '1'));
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
