// One Upload — multi-user social media scheduler (YouTube, Instagram, Facebook Pages).
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
import * as db from './db.js';
import { hashPassword, hmac, safeEqual, verifyPassword } from './secure.js';
import { blobAccess, useBlob, withBlobAccess } from './store.js';
import { getAnalytics } from './analytics.js';
import { migrateLegacyData } from './migrate.js';
import {
  deleteYouTubeVideo,
  uploadToYouTube,
  youtubeAuthUrl,
  youtubeCanDelete,
  youtubeConfigured,
  youtubeExchangeCode,
  youtubeIdFromUrl,
} from './youtube.js';
import {
  deleteFacebookPost,
  deleteInstagramMedia,
  facebookIdFromUrl,
  instagramCanDelete,
  metaAuthUrl,
  metaConfigured,
  metaExchangeCode,
  pageFromChannel,
  publishFacebookPhotos,
  publishInstagramMedia,
  uploadToFacebook,
  uploadToInstagram,
} from './meta.js';

const MAX_VIDEO_BYTES = 300 * 1024 * 1024; // 300 MB (Instagram's limit for Reels)
const PLATFORMS = ['youtube', 'instagram', 'facebook'];

const app = express();
app.disable('x-powered-by');

// ---------- signed public links to local files (Instagram downloads by URL when running on https) ----------
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
  if (!(exp > Date.now()) || !safeEqual(String(req.query.sig || ''), signMedia(file, exp))) return res.status(403).send('Forbidden');
  const full = path.join(config.paths.uploads, file);
  if (!fs.existsSync(full)) return res.status(404).send('Not found');
  res.sendFile(full);
});

// =====================================================================
//  Accounts: sign up, log in, sessions
// =====================================================================

const SESSION_COOKIE = 'ou_session';
const SESSION_DAYS = 30;

function readCookie(req, name) {
  for (const part of String(req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return '';
}

const isHttps = (req) => req.secure || String(req.headers['x-forwarded-proto'] || '').split(',')[0] === 'https';

function startSession(req, res, userId) {
  const exp = Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000;
  res.cookie(SESSION_COOKIE, `${userId}.${exp}.${hmac('session', `${userId}.${exp}`)}`, {
    httpOnly: true,
    sameSite: 'lax',
    secure: isHttps(req),
    maxAge: SESSION_DAYS * 24 * 60 * 60 * 1000,
    path: '/',
  });
}

function sessionUserId(req) {
  const [userId, exp, sig] = readCookie(req, SESSION_COOKIE).split('.');
  if (!userId || !exp || !sig || Number(exp) < Date.now()) return null;
  return safeEqual(sig, hmac('session', `${userId}.${exp}`)) ? userId : null;
}

// Scripts may use HTTP Basic auth with the invite code; that acts as the owner account.
async function basicAuthOwner(req) {
  const [scheme, encoded] = String(req.headers.authorization || '').split(' ');
  if (scheme !== 'Basic' || !encoded || !config.appPassword) return null;
  const pass = Buffer.from(encoded, 'base64').toString().split(':').slice(1).join(':');
  if (!safeEqual(pass, config.appPassword)) return null;
  const [owner] = await db.q('SELECT id FROM users WHERE is_owner ORDER BY created_at LIMIT 1');
  return owner?.id || null;
}

app.use(express.json({ limit: '1mb' }));

const asyncRoute = (fn) => (req, res) =>
  fn(req, res).catch((err) => {
    console.error(err);
    if (!res.headersSent) res.status(500).json({ error: err.message });
  });

const validEmail = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(e || ''));
const slow = () => new Promise((r) => setTimeout(r, 600)); // slows down password guessing

app.get(
  '/api/auth-info',
  asyncRoute(async (req, res) => {
    const users = await db.countUsers();
    res.json({ firstUser: users === 0, inviteRequired: Boolean(config.appPassword) });
  }),
);

app.post(
  '/api/register',
  asyncRoute(async (req, res) => {
    const { name = '', email = '', password = '', invite = '' } = req.body || {};
    if (config.appPassword && !safeEqual(invite, config.appPassword)) {
      await slow();
      return res.status(403).json({ error: 'Invite code തെറ്റാണ്' });
    }
    if (!validEmail(email)) return res.status(400).json({ error: 'ശരിയായ email കൊടുക്കൂ' });
    if (String(password).length < 8) return res.status(400).json({ error: 'Password കുറഞ്ഞത് 8 അക്ഷരം വേണം' });
    if (await db.findUserByEmail(email)) return res.status(400).json({ error: 'ഈ email-ൽ already account ഉണ്ട്. Login ചെയ്യൂ.' });
    const first = (await db.countUsers()) === 0;
    const user = await db.createUser({ email, name: String(name).trim().slice(0, 80), passwordHash: hashPassword(password), isOwner: first });
    // The first account takes over the channels and posts from the single-user version.
    if (first) await migrateLegacyData(user.id).catch((err) => console.error('[migrate]', err));
    startSession(req, res, user.id);
    res.json({ ok: true });
  }),
);

app.post(
  '/api/login',
  asyncRoute(async (req, res) => {
    const { email = '', password = '' } = req.body || {};
    const user = validEmail(email) ? await db.findUserByEmail(email) : null;
    if (!user || !verifyPassword(password, user.passwordHash)) {
      await slow();
      return res.status(401).json({ error: 'Email അല്ലെങ്കിൽ password തെറ്റാണ്' });
    }
    startSession(req, res, user.id);
    res.json({ ok: true });
  }),
);

app.post('/api/logout', (req, res) => {
  res.clearCookie(SESSION_COOKIE, { path: '/' });
  res.json({ ok: true });
});

const OPEN_PATHS = new Set([
  '/login',
  '/login.html',
  '/login.js',
  '/style.css',
  '/favicon.svg',
  '/privacy.html',
  '/api/cron',
  '/api/auth-info',
]);

// Everything below needs a logged-in user (req.userId).
app.use((req, res, next) => {
  if (OPEN_PATHS.has(req.path)) return next();
  (async () => {
    req.userId = sessionUserId(req) || (await basicAuthOwner(req));
    if (req.userId) return next();
    if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'Login required' });
    res.redirect(`/login.html?next=${encodeURIComponent(req.originalUrl)}`);
  })().catch((err) => {
    console.error(err);
    res.status(500).json({ error: err.message });
  });
});

app.get('/login', (req, res) => res.redirect('/login.html'));
app.use(express.static(config.paths.public));

// =====================================================================
//  Channels
// =====================================================================

// OAuth "state" carries the user id and is signed, so any server instance can check it.
function newState(userId) {
  const payload = `${userId}.${Date.now() + 10 * 60 * 1000}.${crypto.randomBytes(6).toString('hex')}`;
  return `${payload}.${hmac('state', payload)}`;
}

function checkState(state, userId) {
  const i = String(state).lastIndexOf('.');
  if (i < 0) return false;
  const payload = state.slice(0, i);
  const [uid, exp] = payload.split('.');
  return uid === userId && Number(exp) > Date.now() && safeEqual(state.slice(i + 1), hmac('state', payload));
}

const backToChannels = (res, params) => res.redirect(`/?${new URLSearchParams(params)}#channels`);

app.get('/auth/google', (req, res) => {
  if (!youtubeConfigured()) return backToChannels(res, { error: 'Google keys are missing on the server' });
  res.redirect(youtubeAuthUrl(newState(req.userId)));
});

app.get('/auth/google/callback', async (req, res) => {
  try {
    if (req.query.error) throw new Error(String(req.query.error));
    if (!checkState(String(req.query.state || ''), req.userId)) throw new Error('Login link expired, try again');
    const { tokens, channel } = await youtubeExchangeCode(String(req.query.code));
    await db.upsertChannel(req.userId, {
      platform: 'youtube',
      externalId: channel.id,
      name: channel.title,
      username: channel.handle,
      avatar: channel.avatar,
      secret: { tokens },
      info: {},
    });
    backToChannels(res, { connected: channel.title });
  } catch (err) {
    backToChannels(res, { error: `YouTube: ${err.message}` });
  }
});

app.get('/auth/facebook', (req, res) => {
  if (!metaConfigured()) return backToChannels(res, { error: 'Meta keys are missing on the server' });
  res.redirect(metaAuthUrl(newState(req.userId)));
});

app.get('/auth/facebook/callback', async (req, res) => {
  try {
    if (req.query.error) throw new Error(String(req.query.error_description || req.query.error));
    if (!checkState(String(req.query.state || ''), req.userId)) throw new Error('Login link expired, try again');
    const { pages, permissions } = await metaExchangeCode(String(req.query.code));
    // Channels from these Pages that are already connected get fresh tokens straight away.
    const existing = await db.listChannels(req.userId);
    for (const page of pages) {
      for (const ch of existing) {
        const sameIg = ch.platform === 'instagram' && page.ig && ch.externalId === page.ig.id;
        const sameFb = ch.platform === 'facebook' && ch.externalId === page.id;
        if (sameIg || sameFb) await saveMetaChannel(req.userId, ch.platform, page, permissions);
      }
    }
    const pendingId = await db.createPending(req.userId, { pages, permissions });
    backToChannels(res, { pick: pendingId });
  } catch (err) {
    backToChannels(res, { error: `Facebook: ${err.message}` });
  }
});

function saveMetaChannel(userId, platform, page, permissions) {
  if (platform === 'instagram') {
    return db.upsertChannel(userId, {
      platform: 'instagram',
      externalId: page.ig.id,
      name: page.ig.username,
      username: page.ig.username,
      avatar: page.ig.picture,
      secret: { pageToken: page.accessToken, pageId: page.id },
      info: { pageId: page.id, pageName: page.name, permissions },
    });
  }
  return db.upsertChannel(userId, {
    platform: 'facebook',
    externalId: page.id,
    name: page.name,
    avatar: page.picture,
    secret: { pageToken: page.accessToken, pageId: page.id },
    info: { pageId: page.id, pageName: page.name, permissions },
  });
}

// After a Facebook login: which Instagram accounts / Pages can be added.
app.get(
  '/api/connect/:pendingId',
  asyncRoute(async (req, res) => {
    const data = await db.getPending(req.userId, req.params.pendingId);
    if (!data) return res.status(404).json({ error: 'This connection link expired. Connect again.' });
    const existing = await db.listChannels(req.userId);
    const has = (platform, id) => existing.some((c) => c.platform === platform && c.externalId === id);
    res.json({
      options: data.pages.map((p) => ({
        pageId: p.id,
        pageName: p.name,
        pagePicture: p.picture,
        pageConnected: has('facebook', p.id),
        ig: p.ig ? { id: p.ig.id, username: p.ig.username, picture: p.ig.picture, connected: has('instagram', p.ig.id) } : null,
      })),
    });
  }),
);

app.post(
  '/api/connect/:pendingId',
  asyncRoute(async (req, res) => {
    const data = await db.getPending(req.userId, req.params.pendingId);
    if (!data) return res.status(404).json({ error: 'This connection link expired. Connect again.' });
    const igIds = new Set((req.body?.instagram || []).map(String));
    const pageIds = new Set((req.body?.facebook || []).map(String));
    let added = 0;
    for (const page of data.pages) {
      if (page.ig && igIds.has(page.ig.id)) {
        await saveMetaChannel(req.userId, 'instagram', page, data.permissions);
        added++;
      }
      if (pageIds.has(page.id)) {
        await saveMetaChannel(req.userId, 'facebook', page, data.permissions);
        added++;
      }
    }
    await db.deletePending(req.userId, req.params.pendingId);
    res.json({ added });
  }),
);

function channelForUi(c) {
  const full = db.withSecret(c);
  return {
    ...db.publicChannel(c),
    canDelete: c.platform === 'youtube' ? youtubeCanDelete(full) : c.platform === 'instagram' ? instagramCanDelete(c) : true,
  };
}

app.get(
  '/api/channels',
  asyncRoute(async (req, res) => res.json((await db.listChannels(req.userId)).map(channelForUi))),
);

app.post(
  '/api/channels/:id/delete',
  asyncRoute(async (req, res) => {
    await db.deleteChannel(req.userId, req.params.id);
    res.json({ ok: true });
  }),
);

// =====================================================================
//  Status
// =====================================================================

app.get(
  '/api/status',
  asyncRoute(async (req, res) => {
    // Backup for the timer: opening the app also posts anything that is due.
    waitUntil(runDuePosts().catch((err) => console.error('[schedule]', err)));
    const [user, channels] = await Promise.all([db.getUser(req.userId), db.listChannels(req.userId)]);
    res.json({
      user: user && { id: user.id, email: user.email, name: user.name, isOwner: user.isOwner },
      channels: channels.map(channelForUi),
      blobUploads: useBlob,
      maxVideoBytes: MAX_VIDEO_BYTES,
      youtubeConfigured: youtubeConfigured(),
      metaConfigured: metaConfigured(),
      storageWarning: config.onVercel && !useBlob ? 'No Vercel Blob store is connected, so uploads will not work.' : null,
    });
  }),
);

// =====================================================================
//  Uploading & posting
// =====================================================================

// 1) On Vercel the browser uploads files straight to Vercel Blob (Vercel only accepts 4.5 MB per request).
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
          allowedContentTypes: ['video/*', 'image/jpeg', 'image/png', 'image/webp'],
          maximumSizeInBytes: MAX_VIDEO_BYTES,
          addRandomSuffix: true,
        };
      },
    });
    res.json(result);
  }),
);

// 2) Locally files are posted straight to this server.
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
    if (file.mimetype.startsWith('video/') || file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('Please choose a video or photo'));
  },
});

const PHOTO_TYPES = new Set(['photo', 'carousel']);
const isPhotoPost = (post) => PHOTO_TYPES.has(post.type);

function readFields(b) {
  const caption = String(b.caption || '');
  return {
    channelIds: (Array.isArray(b.channels) ? b.channels : String(b.channels || '').split(','))
      .map((s) => String(s).trim())
      .filter(Boolean),
    type: ['video', 'photo', 'carousel'].includes(b.type) ? b.type : 'reel',
    caption,
    ytTitle: String(b.ytTitle || '').trim(),
    // Empty = use the caption (worked out when posting, so caption edits carry over).
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

const STATE_LABEL = { scheduled: 'Scheduled', draft: 'Draft' };
const stateFor = (mode) => (mode === 'schedule' ? 'scheduled' : 'draft');

function checkScheduleTime(fields) {
  if (fields.mode !== 'schedule') return null;
  if (!fields.scheduledAt || Number.isNaN(fields.scheduledAt.getTime())) return 'Choose a date and time';
  if (fields.scheduledAt.getTime() < Date.now() - 60_000) return 'That time is in the past';
  return null;
}

// The chosen channels -> post targets ({ channelId: {platform, channelName, ...} }).
async function buildTargets(userId, fields, state) {
  const channels = await db.listChannels(userId);
  const chosen = fields.channelIds.map((id) => channels.find((c) => c.id === id)).filter(Boolean);
  if (!chosen.length) throw httpError(400, 'ഒരു channel എങ്കിലും തിരഞ്ഞെടുക്കൂ');
  const message = state === 'pending' ? 'Waiting' : STATE_LABEL[state];
  return Object.fromEntries(
    chosen.map((c) => [c.id, { platform: c.platform, channelName: c.name, avatar: c.avatar, state, message }]),
  );
}

function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}

// Photo / carousel posts: YouTube can't take them, and need 1–10 items.
function checkMedia(type, targets, kinds) {
  if (!PHOTO_TYPES.has(type)) return null;
  const platforms = Object.values(targets).map((t) => t.platform);
  if (!kinds.length) return 'Add at least one photo';
  if (kinds.length > 10) return 'A carousel can have at most 10 items';
  if (platforms.includes('youtube')) return 'YouTube does not accept photo posts. Untick the YouTube channels.';
  if (platforms.includes('facebook') && kinds.includes('video') && kinds.length > 1) {
    return 'Facebook multi-photo posts cannot include videos. Untick the Facebook Pages.';
  }
  return null;
}

function inputFromPost(post) {
  const i = post.input || {};
  return {
    caption: post.caption || '',
    ytTitle: i.ytTitle || (post.caption || '').split('\n')[0].slice(0, 100) || post.fileName,
    ytDescription: i.ytDescription || '',
    tags: i.tags || [],
    privacy: i.privacy || 'public',
  };
}

async function startPost(req, res, fields, source, fileName, mediaKinds = []) {
  const later = fields.mode !== 'now';
  const state = later ? stateFor(fields.mode) : 'pending';
  const targets = await buildTargets(req.userId, fields, state);
  const problem = checkScheduleTime(fields) || checkMedia(fields.type, targets, mediaKinds);
  if (problem) throw httpError(400, problem);
  const post = await db.createPost({
    userId: req.userId,
    status: later ? state : 'posting',
    scheduledAt: fields.mode === 'schedule' ? fields.scheduledAt.toISOString() : null,
    type: fields.type,
    caption: fields.caption,
    fileName,
    input: { ytTitle: fields.ytTitle, ytDescription: fields.ytDescription, tags: fields.tags, privacy: fields.privacy },
    targets,
    mediaSource: later ? source : null, // the video waits in storage until it is posted
  });
  if (later) return res.json(publicPost(post));
  liveJobs.set(post.id, post);
  res.json({ jobId: post.id });
  // waitUntil keeps the work going on Vercel after the reply has been sent.
  waitUntil(runPost(post, inputFromPost(post), source));
}

const isBlobUrl = (u) => {
  try {
    return new URL(String(u)).hostname.endsWith('.blob.vercel-storage.com');
  } catch {
    return false;
  }
};

const sendError = (res, err) => res.status(err.status || 500).json({ error: err.message });

app.post('/api/upload', (req, res) => {
  // Vercel: the files are already in Blob storage; we get their URLs as JSON.
  if (req.is('application/json')) {
    const b = req.body || {};
    const fields = readFields(b);
    if (!useBlob) return res.status(400).json({ error: 'Blob uploads are not enabled' });
    if (Array.isArray(b.media)) {
      const items = b.media.slice(0, 10).map((m) => ({
        kind: 'blob',
        url: String(m.url),
        media: m.kind === 'video' ? 'video' : 'image',
        name: String(m.fileName || ''),
      }));
      if (items.some((i) => !isBlobUrl(i.url))) return res.status(400).json({ error: 'Bad file URL' });
      const name = items.length > 1 ? `${items.length} items` : items[0]?.name || 'photo.jpg';
      return startPost(req, res, fields, { kind: 'multi', items }, name, items.map((i) => i.media)).catch((e) => sendError(res, e));
    }
    if (!isBlobUrl(b.blobUrl)) return res.status(400).json({ error: 'Bad video URL' });
    return startPost(req, res, fields, { kind: 'blob', url: String(b.blobUrl) }, String(b.fileName || 'video.mp4')).catch((e) =>
      sendError(res, e),
    );
  }

  // Local server: "video" = one video, "media" = photos / carousel.
  upload.fields([
    { name: 'video', maxCount: 1 },
    { name: 'media', maxCount: 10 },
  ])(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'File is bigger than 300 MB' : err.message });
    const all = [...(req.files?.video || []), ...(req.files?.media || [])];
    const cleanup = () => all.forEach((f) => fs.rmSync(f.path, { force: true }));
    const fields = readFields(req.body);
    const fail = (e) => {
      cleanup();
      sendError(res, e);
    };
    if (PHOTO_TYPES.has(fields.type)) {
      const files = req.files?.media || [];
      const items = files.map((f) => ({ kind: 'file', path: f.path, name: f.filename, media: f.mimetype.startsWith('video/') ? 'video' : 'image' }));
      const name = files.length > 1 ? `${files.length} items` : files[0]?.originalname || 'photo.jpg';
      return startPost(req, res, fields, { kind: 'multi', items }, name, items.map((i) => i.media)).catch(fail);
    }
    const file = req.files?.video?.[0];
    if (!file) return fail(httpError(400, 'No video received'));
    startPost(req, res, fields, { kind: 'file', path: file.path, name: file.filename }, file.originalname).catch(fail);
  });
});

// ---------- running a post ----------

async function signedBlobUrl(url) {
  if (blobAccess === 'public') return url;
  const pathname = decodeURIComponent(new URL(url).pathname.replace(/^\//, ''));
  const validUntil = Date.now() + 2 * 60 * 60 * 1000;
  const token = await issueSignedToken({ pathname, operations: ['get'], validUntil });
  const { presignedUrl } = await presignUrl(token, { operation: 'get', pathname, access: 'private', validUntil });
  return presignedUrl;
}

// A link Instagram / Facebook can download a file from.
async function publicUrlFor(item) {
  if (item.kind === 'blob') return signedBlobUrl(item.url);
  if (config.baseUrl.startsWith('https://')) return publicMediaUrl(item.name);
  throw new Error('Photo posts need the app to be online (Vercel), so Instagram can fetch the photos');
}

async function downloadBlob(url, dest) {
  const result = await withBlobAccess((access) => blobGet(url, { access, useCache: false }));
  if (!result?.stream) throw new Error('Uploaded video not found in storage');
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  await pipeline(Readable.fromWeb(result.stream), fs.createWriteStream(dest));
}

async function deleteSourceVideo(source) {
  if (!source) return;
  if (source.kind === 'multi') return void (await Promise.all(source.items.map((i) => deleteSourceVideo(i))));
  if (source.kind === 'blob') await blobDel(source.url).catch(() => {});
  if (source.kind === 'file' && source.path) fs.rmSync(source.path, { force: true });
}

// Posts running on this server instance, with live progress.
const liveJobs = new Map();

// `only` limits the run to some targets (used by Retry).
async function runPost(post, input, source, only = null) {
  const isShort = post.type === 'reel';
  const keys = only || Object.keys(post.targets);
  const channels = Object.fromEntries(
    await Promise.all(keys.map(async (k) => [k, db.withSecret(await db.getChannelById(k))])),
  );

  // Progress lives in memory; only important changes (started / posted / failed) are saved.
  const update = (key, patch, save = false) => {
    post.targets[key] = { ...post.targets[key], ...patch, updatedAt: new Date().toISOString() };
    if (save) db.patchTarget(post.id, key, post.targets[key]).catch((err) => console.error('Could not save target', err));
  };

  let tempFile = null;
  try {
    let filePath = source.path;
    let videoUrl = null;
    let items = null;
    if (source.kind === 'multi') {
      keys.forEach((k) => update(k, { message: 'Preparing photos' }));
      items = await Promise.all(source.items.map(async (i) => ({ kind: i.media, url: await publicUrlFor(i) })));
    } else if (source.kind === 'blob') {
      keys.forEach((k) => update(k, { message: 'Preparing video' }));
      tempFile = path.join(config.paths.uploads, `${post.id}${path.extname(post.fileName) || '.mp4'}`);
      await downloadBlob(source.url, tempFile);
      filePath = tempFile;
      if (keys.some((k) => post.targets[k].platform === 'instagram')) {
        videoUrl = await signedBlobUrl(source.url).catch((err) => {
          console.error('[instagram] could not make a signed link', err.message);
          return null;
        });
      }
    } else if (config.baseUrl.startsWith('https://')) {
      videoUrl = publicMediaUrl(source.name);
    }

    const run = (key) => {
      const ch = channels[key];
      if (!ch) throw new Error('This channel was removed. Connect it again.');
      const status = (msg) => update(key, { message: msg });
      if (ch.platform === 'youtube') {
        if (items) throw new Error('YouTube does not accept photo posts');
        return uploadToYouTube(
          ch,
          { filePath, title: input.ytTitle, description: input.ytDescription || input.caption, tags: input.tags, privacy: input.privacy, isShort },
          (pct) => update(key, { message: `Uploading ${pct}%`, progress: pct }),
        );
      }
      const page = pageFromChannel(ch);
      if (ch.platform === 'instagram') {
        if (items) return publishInstagramMedia(page, { items, caption: input.caption }, status);
        return uploadToInstagram(page, { filePath, caption: input.caption, publicVideoUrl: videoUrl }, status);
      }
      if (items) return publishFacebookPhotos(page, { items, caption: input.caption }, status);
      return uploadToFacebook(page, { filePath, title: input.ytTitle, description: input.caption, isShort }, status);
    };

    await Promise.allSettled(
      keys.map(async (key) => {
        update(key, { state: 'running', message: 'Starting' }, true);
        try {
          const result = await run(key);
          let message = result.note || 'Posted';
          if (post.targets[key].platform === 'youtube' && result.privacy && result.privacy !== input.privacy) {
            message = `Uploaded, but YouTube set it to "${result.privacy}" (unverified Google project). Change it in YouTube Studio.`;
          }
          update(key, { state: 'done', message, url: result.url, postId: result.id, progress: 100 }, true);
        } catch (err) {
          console.error(`[${post.targets[key].platform}]`, err);
          update(key, { state: 'error', message: err.message }, true);
        }
      }),
    );
  } catch (err) {
    console.error('[post]', err);
    keys.forEach((k) => post.targets[k].state !== 'done' && update(k, { state: 'error', message: err.message }, true));
  } finally {
    // If something failed, keep the files for a while so that channel can be retried.
    const failed = Object.values(post.targets).some((t) => t.state === 'error');
    const latest = (await db.getPost(post.userId, post.id).catch(() => null)) || post;
    latest.targets = { ...latest.targets, ...post.targets };
    latest.status = 'posted';
    latest.postedAt = new Date().toISOString();
    latest.mediaSource = null;
    latest.claimedAt = null;
    latest.retrySource = failed ? { ...source, keptAt: new Date().toISOString() } : null;
    await db.savePost(latest).catch((err) => console.error('Could not save post', err));
    post.status = 'posted';
    liveJobs.delete(post.id);
    if (tempFile) fs.rmSync(tempFile, { force: true });
    if (!failed) await deleteSourceVideo(source);
  }
}

// What the browser sees of a post (no storage links). `platforms` maps channel id -> target.
function publicPost(p) {
  const keptMs = p.retrySource?.keptAt ? Date.now() - new Date(p.retrySource.keptAt).getTime() : Infinity;
  const i = p.input || {};
  return {
    id: p.id,
    createdAt: p.createdAt,
    status: p.status,
    scheduledAt: p.scheduledAt,
    postedAt: p.postedAt,
    type: p.type,
    caption: p.caption,
    fileName: p.fileName,
    platforms: p.targets,
    hasVideo: Boolean(p.mediaSource),
    settings: { ytTitle: i.ytTitle || '', ytDescription: i.ytDescription || '', tags: i.tags || [], privacy: i.privacy || 'public' },
    canRetry: keptMs < 24 * 60 * 60 * 1000,
  };
}

app.get(
  '/api/jobs',
  asyncRoute(async (req, res) => {
    const posts = await db.listPosts(req.userId);
    res.json(posts.map((p) => publicPost(liveJobs.get(p.id) || p)));
  }),
);

app.get(
  '/api/jobs/:id',
  asyncRoute(async (req, res) => {
    const live = liveJobs.get(req.params.id);
    const post = live && live.userId === req.userId ? live : await db.getPost(req.userId, req.params.id);
    if (!post) return res.status(404).json({ error: 'Not found' });
    res.json(publicPost(post));
  }),
);

// Try one failed channel again with the same files (kept for 24 hours after a failure).
app.post(
  '/api/jobs/:id/retry',
  asyncRoute(async (req, res) => {
    const key = String(req.body?.target || req.body?.platform || '');
    const post = await db.getPost(req.userId, req.params.id);
    if (!post || post.targets?.[key]?.state !== 'error') return res.status(400).json({ error: 'Nothing to retry' });
    if (liveJobs.has(post.id)) return res.status(400).json({ error: 'Upload is still running' });
    if (!publicPost(post).canRetry) {
      return res.status(400).json({ error: 'Video ഇനി ലഭ്യമല്ല. വീണ്ടും upload ചെയ്യൂ (ഈ channel മാത്രം tick ചെയ്ത്).' });
    }
    post.targets[key] = { ...post.targets[key], state: 'pending', message: 'Retrying' };
    await db.patchTarget(post.id, key, post.targets[key]);
    liveJobs.set(post.id, post);
    res.json(publicPost(post));
    waitUntil(runPost(post, inputFromPost(post), post.retrySource, [key]));
  }),
);

// ---------- deleting posts from the platforms ----------

app.post(
  '/api/jobs/:id/delete',
  asyncRoute(async (req, res) => {
    const key = String(req.body?.target || req.body?.platform || '');
    const post = await db.getPost(req.userId, req.params.id);
    const t = post?.targets?.[key];
    if (!t) return res.status(404).json({ error: 'Not found' });
    if (t.state !== 'done' || t.deleted) return res.status(400).json({ error: 'Nothing to delete' });
    const ch = db.withSecret(await db.getChannel(req.userId, key));
    if (!ch) return res.status(400).json({ error: 'This channel is no longer connected' });
    try {
      if (t.platform === 'youtube') await deleteYouTubeVideo(ch, t.postId || youtubeIdFromUrl(t.url));
      else if (t.platform === 'instagram') {
        if (!t.postId) throw new Error('ഈ പഴയ Instagram post app-ൽ നിന്ന് delete ചെയ്യാൻ പറ്റില്ല. Instagram-ൽ "Open" ചെയ്ത് delete ചെയ്യൂ.');
        await deleteInstagramMedia(pageFromChannel(ch), t.postId);
      } else await deleteFacebookPost(pageFromChannel(ch), t.postId || facebookIdFromUrl(t.url));
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }
    await db.patchTarget(post.id, key, { deleted: true, deletedAt: new Date().toISOString(), message: 'Deleted' });
    res.json(publicPost(await db.getPost(req.userId, post.id)));
  }),
);

// Remove from the app's list only (posts stay online). Drafts/scheduled posts lose their files.
app.post(
  '/api/jobs/:id/remove',
  asyncRoute(async (req, res) => {
    if (liveJobs.has(req.params.id)) return res.status(400).json({ error: 'Upload is still running' });
    const post = await db.getPost(req.userId, req.params.id);
    if (!post) return res.json({ ok: false });
    await deleteSourceVideo(post.retrySource);
    await deleteSourceVideo(post.mediaSource);
    await db.deletePost(req.userId, post.id);
    res.json({ ok: true });
  }),
);

// ---------- drafts & scheduled posts ----------

app.post(
  '/api/jobs/:id/edit',
  asyncRoute(async (req, res) => {
    const post = await db.getPost(req.userId, req.params.id);
    if (!post || !['draft', 'scheduled'].includes(post.status)) {
      return res.status(400).json({ error: 'Only drafts and scheduled posts can be edited' });
    }
    const b = req.body || {};
    const fields = readFields({
      channels: b.channels ?? Object.keys(post.targets).join(','),
      type: post.type,
      caption: b.caption ?? post.caption,
      ytTitle: b.ytTitle ?? post.input?.ytTitle,
      ytDescription: b.ytDescription ?? post.input?.ytDescription,
      tags: b.tags ?? post.input?.tags,
      privacy: b.privacy ?? post.input?.privacy,
      mode: b.mode ?? (post.status === 'scheduled' ? 'schedule' : 'draft'),
      scheduledAt: b.scheduledAt ?? post.scheduledAt,
    });
    if (fields.mode === 'now') fields.mode = 'draft';
    const state = stateFor(fields.mode);
    try {
      post.targets = await buildTargets(req.userId, fields, state);
    } catch (err) {
      return sendError(res, err);
    }
    const kinds = (post.mediaSource?.items || []).map((i) => i.media);
    const problem = checkScheduleTime(fields) || (isPhotoPost(post) ? checkMedia(post.type, post.targets, kinds) : null);
    if (problem) return res.status(400).json({ error: problem });
    post.caption = fields.caption;
    post.status = state;
    post.scheduledAt = fields.mode === 'schedule' ? fields.scheduledAt.toISOString() : null;
    post.input = { ytTitle: fields.ytTitle, ytDescription: fields.ytDescription, tags: fields.tags, privacy: fields.privacy };
    post.claimedAt = null;
    res.json(publicPost(await db.savePost(post)));
  }),
);

async function runClaimed(post) {
  for (const k of Object.keys(post.targets)) post.targets[k] = { ...post.targets[k], state: 'pending', message: 'Waiting' };
  await db.savePost(post);
  liveJobs.set(post.id, post);
  return runPost(post, inputFromPost(post), post.mediaSource);
}

app.post(
  '/api/jobs/:id/publish',
  asyncRoute(async (req, res) => {
    const post = await db.claimPost(req.userId, req.params.id);
    if (!post) return res.status(400).json({ error: 'Nothing to post (already posting?)' });
    if (!post.mediaSource) return res.status(400).json({ error: 'This post has no video' });
    res.json({ jobId: post.id });
    waitUntil(runClaimed(post));
  }),
);

// Scheduled posts whose time has come (all users). Called by the timer and when the app is opened.
async function runDuePosts() {
  const due = await db.claimDuePosts();
  for (const post of due) waitUntil(runClaimed(post).catch((err) => console.error('[schedule]', err)));
  return due.length;
}

const cronKey = () => hmac('cron', 'oneupload-cron').slice(0, 32);

app.all(
  '/api/cron',
  asyncRoute(async (req, res) => {
    if (!safeEqual(String(req.query.key || ''), cronKey())) return res.status(403).json({ error: 'Bad key' });
    res.json({ ok: true, started: await runDuePosts() });
  }),
);

app.get('/api/cron-info', (req, res) => res.json({ url: `${config.baseUrl}/api/cron?key=${cronKey()}` }));

// =====================================================================
//  Ideas & analytics
// =====================================================================

app.get(
  '/api/ideas',
  asyncRoute(async (req, res) => res.json(await db.listIdeas(req.userId))),
);

app.post(
  '/api/ideas',
  asyncRoute(async (req, res) => {
    const text = String(req.body?.text || '').trim().slice(0, 2200);
    if (!text) return res.status(400).json({ error: 'Write something first' });
    res.json(await db.createIdea(req.userId, text));
  }),
);

app.post(
  '/api/ideas/:id/delete',
  asyncRoute(async (req, res) => {
    await db.deleteIdea(req.userId, req.params.id);
    res.json({ ok: true });
  }),
);

app.get(
  '/api/analytics',
  asyncRoute(async (req, res) => {
    res.json(await getAnalytics(req.userId, req.query.refresh === '1'));
  }),
);

// ---------- delete old local files ----------
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
    console.log(`One Upload running at http://localhost:${config.port}`);
    console.log(`Public address: ${config.baseUrl}`);
    console.log(`Storage: ${useBlob ? 'Vercel Blob' : 'local files'} · Database: ${db.hasDb ? 'Postgres' : 'MISSING'}`);
  });
}

export default app;
