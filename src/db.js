// Postgres (Neon) storage for users, their connected channels, posts and ideas.
import { neon } from '@neondatabase/serverless';
import { decrypt, encrypt, newId } from './secure.js';

const url = process.env.DATABASE_URL || process.env.POSTGRES_URL || '';
export const hasDb = Boolean(url);
const sql = hasDb ? neon(url) : null;

export async function q(text, params = []) {
  if (!sql) throw new Error('Database is not set up (DATABASE_URL missing)');
  await ensureSchema();
  return sql.query(text, params);
}

let ready = null;
export function ensureSchema() {
  if (!sql) return Promise.resolve();
  ready ||= (async () => {
    const statements = [
      `CREATE TABLE IF NOT EXISTS users (
        id text PRIMARY KEY,
        email text UNIQUE NOT NULL,
        name text NOT NULL DEFAULT '',
        password_hash text NOT NULL,
        is_owner boolean NOT NULL DEFAULT false,
        created_at timestamptz NOT NULL DEFAULT now()
      )`,
      `CREATE TABLE IF NOT EXISTS channels (
        id text PRIMARY KEY,
        user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        platform text NOT NULL,
        external_id text NOT NULL,
        name text NOT NULL DEFAULT '',
        username text,
        avatar text,
        secret text,
        info jsonb NOT NULL DEFAULT '{}'::jsonb,
        created_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE (user_id, platform, external_id)
      )`,
      `CREATE TABLE IF NOT EXISTS posts (
        id text PRIMARY KEY,
        user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at timestamptz NOT NULL DEFAULT now(),
        status text NOT NULL,
        scheduled_at timestamptz,
        posted_at timestamptz,
        claimed_at timestamptz,
        type text NOT NULL DEFAULT 'reel',
        caption text NOT NULL DEFAULT '',
        file_name text NOT NULL DEFAULT '',
        input jsonb NOT NULL DEFAULT '{}'::jsonb,
        targets jsonb NOT NULL DEFAULT '{}'::jsonb,
        media_source jsonb,
        retry_source jsonb
      )`,
      `CREATE INDEX IF NOT EXISTS posts_user_created ON posts (user_id, created_at DESC)`,
      `CREATE INDEX IF NOT EXISTS posts_due ON posts (status, scheduled_at)`,
      `CREATE TABLE IF NOT EXISTS ideas (
        id text PRIMARY KEY,
        user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        text text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      )`,
      `CREATE TABLE IF NOT EXISTS pending_connections (
        id text PRIMARY KEY,
        user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        data text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      )`,
      // Claude connector (MCP): sha256 of the user's connector key.
      'ALTER TABLE users ADD COLUMN IF NOT EXISTS api_key_hash text',
      'CREATE UNIQUE INDEX IF NOT EXISTS users_api_key ON users (api_key_hash)',
    ];
    for (const s of statements) await sql.query(s);
  })().catch((err) => {
    ready = null;
    throw err;
  });
  return ready;
}

const iso = (d) => (d ? new Date(d).toISOString() : null);

// ---------------- users ----------------

const userRow = (r) => r && { id: r.id, email: r.email, name: r.name, isOwner: r.is_owner, createdAt: iso(r.created_at), passwordHash: r.password_hash, hasApiKey: Boolean(r.api_key_hash) };

export async function countUsers() {
  const [r] = await q('SELECT count(*)::int AS n FROM users');
  return r.n;
}

export async function createUser({ email, name, passwordHash, isOwner }) {
  const [r] = await q(
    'INSERT INTO users (id, email, name, password_hash, is_owner) VALUES ($1, lower($2), $3, $4, $5) RETURNING *',
    [newId(), email, name, passwordHash, Boolean(isOwner)],
  );
  return userRow(r);
}

export async function findUserByEmail(email) {
  const [r] = await q('SELECT * FROM users WHERE email = lower($1)', [email]);
  return userRow(r);
}

export async function findUserByApiKeyHash(hash) {
  const [r] = await q('SELECT * FROM users WHERE api_key_hash = $1', [hash]);
  return userRow(r);
}

export async function setApiKeyHash(userId, hash) {
  await q('UPDATE users SET api_key_hash = $2 WHERE id = $1', [userId, hash]);
}

export async function getUser(id) {
  const [r] = await q('SELECT * FROM users WHERE id = $1', [id]);
  return userRow(r);
}

// ---------------- channels ----------------

const channelRow = (r) =>
  r && {
    id: r.id,
    userId: r.user_id,
    platform: r.platform,
    externalId: r.external_id,
    name: r.name,
    username: r.username,
    avatar: r.avatar,
    info: r.info || {},
    createdAt: iso(r.created_at),
    _secret: r.secret,
  };

// Tokens are stored encrypted; `withSecret` decrypts them for use on the server only.
export function withSecret(channel) {
  if (!channel) return null;
  let secret = null;
  try {
    secret = decrypt(channel._secret);
  } catch {
    secret = null;
  }
  return { ...channel, secret };
}

export function publicChannel(c) {
  const { _secret, secret, userId, ...rest } = c;
  return rest;
}

export async function listChannels(userId) {
  const rows = await q('SELECT * FROM channels WHERE user_id = $1 ORDER BY platform, created_at', [userId]);
  return rows.map(channelRow);
}

export async function getChannel(userId, id) {
  const [r] = await q('SELECT * FROM channels WHERE user_id = $1 AND id = $2', [userId, id]);
  return channelRow(r);
}

export async function getChannelById(id) {
  const [r] = await q('SELECT * FROM channels WHERE id = $1', [id]);
  return channelRow(r);
}

// Adds a channel, or refreshes it (new tokens/name) if the same account is connected again.
export async function upsertChannel(userId, { platform, externalId, name, username, avatar, secret, info }) {
  const [r] = await q(
    `INSERT INTO channels (id, user_id, platform, external_id, name, username, avatar, secret, info)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     ON CONFLICT (user_id, platform, external_id)
     DO UPDATE SET name = EXCLUDED.name, username = EXCLUDED.username, avatar = EXCLUDED.avatar,
                   secret = EXCLUDED.secret, info = EXCLUDED.info
     RETURNING *`,
    [newId(), userId, platform, String(externalId), name || '', username || null, avatar || null, encrypt(secret), JSON.stringify(info || {})],
  );
  return channelRow(r);
}

export async function updateChannelSecret(id, secret) {
  await q('UPDATE channels SET secret = $2 WHERE id = $1', [id, encrypt(secret)]);
}

export async function deleteChannel(userId, id) {
  await q('DELETE FROM channels WHERE user_id = $1 AND id = $2', [userId, id]);
}

// ---------------- posts ----------------

const postRow = (r) =>
  r && {
    id: r.id,
    userId: r.user_id,
    createdAt: iso(r.created_at),
    status: r.status,
    scheduledAt: iso(r.scheduled_at),
    postedAt: iso(r.posted_at),
    claimedAt: iso(r.claimed_at),
    type: r.type,
    caption: r.caption,
    fileName: r.file_name,
    input: r.input || {},
    targets: r.targets || {},
    mediaSource: r.media_source,
    retrySource: r.retry_source,
  };

export async function createPost(p) {
  const [r] = await q(
    `INSERT INTO posts (id, user_id, status, scheduled_at, type, caption, file_name, input, targets, media_source)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
    [
      p.id || newId(),
      p.userId,
      p.status,
      p.scheduledAt || null,
      p.type,
      p.caption || '',
      p.fileName || '',
      JSON.stringify(p.input || {}),
      JSON.stringify(p.targets || {}),
      p.mediaSource ? JSON.stringify(p.mediaSource) : null,
    ],
  );
  return postRow(r);
}

export async function getPost(userId, id) {
  const [r] = await q('SELECT * FROM posts WHERE user_id = $1 AND id = $2', [userId, id]);
  return postRow(r);
}

export async function listPosts(userId, limit = 300) {
  const rows = await q('SELECT * FROM posts WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2', [userId, limit]);
  return rows.map(postRow);
}

// Writes the changeable fields of a post object back.
export async function savePost(p) {
  const [r] = await q(
    `UPDATE posts SET status = $2, scheduled_at = $3, posted_at = $4, claimed_at = $5, type = $6, caption = $7,
       input = $8, targets = $9, media_source = $10, retry_source = $11
     WHERE id = $1 RETURNING *`,
    [
      p.id,
      p.status,
      p.scheduledAt || null,
      p.postedAt || null,
      p.claimedAt || null,
      p.type,
      p.caption || '',
      JSON.stringify(p.input || {}),
      JSON.stringify(p.targets || {}),
      p.mediaSource ? JSON.stringify(p.mediaSource) : null,
      p.retrySource ? JSON.stringify(p.retrySource) : null,
    ],
  );
  return postRow(r);
}

// Updates one target's status inside a post without touching the others.
export async function patchTarget(postId, key, patch) {
  await q(`UPDATE posts SET targets = jsonb_set(targets, $2, COALESCE(targets -> $3, '{}'::jsonb) || $4::jsonb) WHERE id = $1`, [
    postId,
    `{${key}}`,
    key,
    JSON.stringify(patch),
  ]);
}

export async function deletePost(userId, id) {
  await q('DELETE FROM posts WHERE user_id = $1 AND id = $2', [userId, id]);
}

// Atomically takes due scheduled posts (any user) so they are posted only once.
export async function claimDuePosts() {
  const rows = await q(
    `UPDATE posts SET status = 'posting', claimed_at = now()
     WHERE id IN (SELECT id FROM posts WHERE status = 'scheduled' AND scheduled_at <= now() ORDER BY scheduled_at LIMIT 10)
     RETURNING *`,
  );
  return rows.map(postRow);
}

// Atomically takes one draft/scheduled post for "Post now".
export async function claimPost(userId, id) {
  const [r] = await q(
    `UPDATE posts SET status = 'posting', claimed_at = now()
     WHERE user_id = $1 AND id = $2 AND status IN ('draft', 'scheduled') RETURNING *`,
    [userId, id],
  );
  return postRow(r);
}

// ---------------- ideas ----------------

export async function listIdeas(userId) {
  const rows = await q('SELECT * FROM ideas WHERE user_id = $1 ORDER BY created_at DESC LIMIT 500', [userId]);
  return rows.map((r) => ({ id: r.id, text: r.text, createdAt: iso(r.created_at) }));
}

export async function createIdea(userId, text) {
  const [r] = await q('INSERT INTO ideas (id, user_id, text) VALUES ($1, $2, $3) RETURNING *', [newId(), userId, text]);
  return { id: r.id, text: r.text, createdAt: iso(r.created_at) };
}

export async function deleteIdea(userId, id) {
  await q('DELETE FROM ideas WHERE user_id = $1 AND id = $2', [userId, id]);
}

// ---------------- pending connections (Facebook login -> choose accounts) ----------------

export async function createPending(userId, data) {
  await q(`DELETE FROM pending_connections WHERE created_at < now() - interval '1 hour'`);
  const id = newId();
  await q('INSERT INTO pending_connections (id, user_id, data) VALUES ($1, $2, $3)', [id, userId, encrypt(data)]);
  return id;
}

export async function getPending(userId, id) {
  const [r] = await q(`SELECT * FROM pending_connections WHERE user_id = $1 AND id = $2 AND created_at > now() - interval '1 hour'`, [userId, id]);
  return r ? decrypt(r.data) : null;
}

export async function deletePending(userId, id) {
  await q('DELETE FROM pending_connections WHERE user_id = $1 AND id = $2', [userId, id]);
}
