// Storage for connected accounts and upload history.
//
// - On Vercel (with a Blob store connected) everything is saved as private JSON files in
//   Vercel Blob, so logins survive restarts and work from any device.
// - Locally it is saved as JSON files in the data/ folder.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { del, get, list, put } from '@vercel/blob';
import { config } from './config.js';


// ---------- backends ----------

const fileBackend = {
  name: 'file',
  file: (key) => path.join(config.paths.data, ...key.split('/')),
  async read(key) {
    try {
      return JSON.parse(fs.readFileSync(this.file(key), 'utf8'));
    } catch {
      return null;
    }
  },
  async write(key, value) {
    const file = this.file(key);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(`${file}.tmp`, JSON.stringify(value, null, 2));
    fs.renameSync(`${file}.tmp`, file);
  },
  async remove(key) {
    fs.rmSync(this.file(key), { force: true });
  },
  async listKeys(prefix) {
    const dir = this.file(prefix);
    if (!fs.existsSync(dir)) return [];
    return fs
      .readdirSync(dir)
      .filter((f) => f.endsWith('.json'))
      .map((f) => ({ key: `${prefix}/${f}`, time: fs.statSync(path.join(dir, f)).mtimeMs }));
  },
};

const BLOB_DIR = 'oneupload-state';

// State is encrypted before it goes to Blob, so the tokens stay safe even in a public store.
const stateKey = crypto.createHash('sha256').update(`oneupload-state:${config.mediaSecret}`).digest();

function encrypt(value) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', stateKey, iv);
  const data = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return JSON.stringify({ v: 1, iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: data.toString('base64') });
}

function decrypt(text) {
  const box = JSON.parse(text);
  const decipher = crypto.createDecipheriv('aes-256-gcm', stateKey, Buffer.from(box.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(box.tag, 'base64'));
  const plain = Buffer.concat([decipher.update(Buffer.from(box.data, 'base64')), decipher.final()]);
  return JSON.parse(plain.toString('utf8'));
}

// Blob stores are either private or public; try private first and remember what works.
export let blobAccess = process.env.BLOB_ACCESS === 'public' ? 'public' : 'private';
export async function withBlobAccess(fn) {
  try {
    return await fn(blobAccess);
  } catch (err) {
    if (blobAccess === 'private' && /access|private|public/i.test(String(err?.message))) {
      blobAccess = 'public';
      return fn(blobAccess);
    }
    throw err;
  }
}

const blobBackend = {
  name: 'blob',
  async read(key) {
    const res = await withBlobAccess((access) => get(`${BLOB_DIR}/${key}`, { access, useCache: false }));
    if (!res || !res.stream) return null;
    try {
      return decrypt(await new Response(res.stream).text());
    } catch {
      return null; // written with a different MEDIA_SECRET, or damaged
    }
  },
  async write(key, value) {
    await withBlobAccess((access) =>
      put(`${BLOB_DIR}/${key}`, encrypt(value), {
        access,
        addRandomSuffix: false,
        allowOverwrite: true,
        contentType: 'application/json',
        cacheControlMaxAge: 60,
      }),
    );
  },
  async remove(key) {
    await del(`${BLOB_DIR}/${key}`);
  },
  async listKeys(prefix) {
    const out = [];
    let cursor;
    do {
      const page = await list({ prefix: `${BLOB_DIR}/${prefix}/`, cursor, limit: 1000 });
      for (const b of page.blobs) {
        out.push({ key: b.pathname.slice(BLOB_DIR.length + 1), time: new Date(b.uploadedAt).getTime() });
      }
      cursor = page.hasMore ? page.cursor : undefined;
    } while (cursor);
    return out;
  },
};

export const useBlob = Boolean(process.env.BLOB_READ_WRITE_TOKEN);
const backend = useBlob ? blobBackend : fileBackend;

if (!useBlob) {
  fs.mkdirSync(config.paths.data, { recursive: true });
  fs.mkdirSync(config.paths.uploads, { recursive: true });
}
if (config.onVercel && !useBlob) {
  console.warn('No Vercel Blob store connected: logins will be forgotten. Connect a Blob store to this project.');
}

// Writes are queued per key so two updates never overwrite each other out of order.
const queues = new Map();
function queued(key, fn) {
  const next = (queues.get(key) || Promise.resolve()).then(fn, fn);
  queues.set(key, next.catch(() => {}));
  return next;
}

// Short in-memory cache for reads. Vercel Blob's free plan counts every read and write,
// so we avoid reading the same file again and again within a few seconds.
const cache = new Map(); // key -> { at, value }
async function cachedRead(key, ttlMs) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return structuredClone(hit.value);
  const value = await backend.read(key);
  cache.set(key, { at: Date.now(), value });
  return structuredClone(value);
}
async function writeAndCache(key, value) {
  await backend.write(key, value);
  cache.set(key, { at: Date.now(), value: structuredClone(value) });
}

// ---------- accounts ----------

export async function getAccounts() {
  return (await cachedRead('accounts.json', 20_000)) || {};
}

// `patch` is an object, or a function that gets the current accounts and returns one.
export function updateAccounts(patch) {
  return queued('accounts.json', async () => {
    const current = (await backend.read('accounts.json')) || {};
    const next = { ...current, ...(typeof patch === 'function' ? patch(current) : patch) };
    await writeAndCache('accounts.json', next);
    return next;
  });
}

export function removeAccount(key) {
  return queued('accounts.json', async () => {
    const current = (await backend.read('accounts.json')) || {};
    delete current[key];
    await writeAndCache('accounts.json', current);
  });
}

// ---------- upload history ----------
// All uploads live in one file (newest first), so the list costs a single read.

const HISTORY = 'history.json';
const MAX_HISTORY = 1000;

async function readHistory(fresh = false) {
  let history = fresh ? await backend.read(HISTORY) : await cachedRead(HISTORY, 3_000);
  if (history) return history;
  // First run after the update: bring over uploads saved by the older version (one file per job).
  const found = [];
  try {
    const keys = await backend.listKeys('jobs');
    found.push(...(await Promise.all(keys.map((k) => backend.read(k.key).catch(() => null)))));
  } catch {
    /* nothing to migrate */
  }
  // The very first version kept everything in jobs.json.
  const legacy = await backend.read('jobs.json').catch(() => null);
  if (Array.isArray(legacy)) found.push(...legacy);
  const seen = new Set();
  return found
    .filter((j) => j && j.id && !seen.has(j.id) && seen.add(j.id))
    .map(({ storedFile, ...j }) => j)
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

function changeHistory(fn) {
  return queued(HISTORY, async () => {
    const history = await readHistory(true);
    const result = fn(history);
    await writeAndCache(HISTORY, history.slice(0, MAX_HISTORY));
    return result;
  });
}

export async function listJobs() {
  return readHistory();
}

export async function getJob(id) {
  return (await readHistory()).find((j) => j.id === id) || null;
}

export function createJob(job) {
  return changeHistory((history) => {
    history.unshift(job);
    return job;
  });
}

// `fn` gets the stored job and changes it in place.
export function updateJob(id, fn) {
  return changeHistory((history) => {
    const job = history.find((j) => j.id === id);
    if (job) fn(job);
    return job || null;
  });
}

export function removeJob(id) {
  return changeHistory((history) => {
    const i = history.findIndex((j) => j.id === id);
    if (i >= 0) history.splice(i, 1);
    return i >= 0;
  });
}

// ---------- ideas (text notes for future posts) ----------

const IDEAS = 'ideas.json';

export async function listIdeas() {
  return (await cachedRead(IDEAS, 3_000)) || [];
}

export function changeIdeas(fn) {
  return queued(IDEAS, async () => {
    const ideas = (await backend.read(IDEAS)) || [];
    const result = fn(ideas);
    await writeAndCache(IDEAS, ideas.slice(0, 500));
    return result;
  });
}

// Locally, anything still "running" when the server restarted can never finish.
if (!useBlob) {
  changeHistory((history) => {
    for (const job of history) {
      for (const p of Object.values(job.platforms || {})) {
        if (p.state === 'pending' || p.state === 'running') {
          p.state = 'error';
          p.message = 'Server restarted during upload';
        }
      }
    }
  }).catch(() => {});
}
