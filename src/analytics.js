// Views / likes / comments for posts made through the app.
import { google } from 'googleapis';
import { config } from './config.js';
import { getAccounts } from './store.js';

const GRAPH = () => `https://graph.facebook.com/${config.meta.version}`;
const CACHE_MS = 10 * 60 * 1000; // stats change slowly; keep API calls low
let cache = { at: 0, data: null };

function youtubeIdFrom(entry) {
  if (entry?.postId) return entry.postId;
  const m = String(entry?.url || '').match(/(?:shorts\/|youtu\.be\/|[?&]v=)([\w-]{6,})/);
  return m ? m[1] : null;
}

async function youtubeStats(ids, account) {
  const out = {};
  if (!ids.length || !account) return out;
  const client = new google.auth.OAuth2(config.google.clientId, config.google.clientSecret, config.google.redirectUri);
  client.setCredentials(account.tokens);
  const yt = google.youtube({ version: 'v3', auth: client });
  for (let i = 0; i < ids.length; i += 50) {
    const res = await yt.videos.list({ part: ['statistics'], id: ids.slice(i, i + 50) });
    for (const v of res.data.items || []) {
      out[v.id] = {
        views: Number(v.statistics?.viewCount || 0),
        likes: Number(v.statistics?.likeCount || 0),
        comments: Number(v.statistics?.commentCount || 0),
      };
    }
  }
  return out;
}

async function graphGet(path, params) {
  const url = new URL(`${GRAPH()}${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url);
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.error) throw new Error(data.error?.message || `HTTP ${res.status}`);
  return data;
}

async function instagramStats(entries, accounts) {
  const out = {};
  const pages = accounts.meta?.pages || [];
  const canInsights = accounts.meta?.permissions?.includes('instagram_manage_insights');
  await Promise.all(
    entries.map(async (e) => {
      const page = pages.find((p) => p.id === e.pageId) || pages.find((p) => p.id === accounts.meta?.selectedPageId);
      if (!page) return;
      const token = page.accessToken;
      try {
        const basic = await graphGet(`/${e.postId}`, { fields: 'like_count,comments_count', access_token: token });
        const stats = { likes: basic.like_count ?? null, comments: basic.comments_count ?? null, views: null };
        if (canInsights) {
          // "views" on newer API versions, "plays" on older ones.
          for (const metric of ['views', 'plays']) {
            try {
              const ins = await graphGet(`/${e.postId}/insights`, { metric, access_token: token });
              const value = ins.data?.[0]?.values?.[0]?.value ?? ins.data?.[0]?.total_value?.value;
              if (value != null) {
                stats.views = Number(value);
                break;
              }
            } catch {
              /* try the next metric name */
            }
          }
        }
        out[e.postId] = stats;
      } catch (err) {
        out[e.postId] = { error: /does not exist|cannot be loaded/i.test(err.message) ? 'deleted' : err.message };
      }
    }),
  );
  return out;
}

export async function getAnalytics(jobs, refresh = false) {
  if (!refresh && cache.data && Date.now() - cache.at < CACHE_MS) return cache.data;
  const accounts = await getAccounts();
  const posted = jobs.filter((j) => (j.status || 'posted') === 'posted').slice(0, 100);

  const ytIds = posted
    .map((j) => j.platforms?.youtube)
    .filter((p) => p?.state === 'done' && !p.deleted)
    .map(youtubeIdFrom)
    .filter(Boolean);
  const igEntries = posted
    .map((j) => j.platforms?.instagram)
    .filter((p) => p?.state === 'done' && !p.deleted && p.postId);

  const [yt, ig] = await Promise.all([
    youtubeStats(ytIds, accounts.youtube).catch((err) => ({ _error: err.message })),
    instagramStats(igEntries, accounts).catch((err) => ({ _error: err.message })),
  ]);

  const rows = posted
    .map((j) => {
      const row = { id: j.id, title: (j.caption || '').split('\n')[0] || j.fileName, createdAt: j.postedAt || j.createdAt, type: j.type };
      const y = j.platforms?.youtube;
      if (y?.state === 'done' && !y.deleted) row.youtube = { url: y.url, ...(yt[youtubeIdFrom(y)] || {}) };
      const i = j.platforms?.instagram;
      if (i?.state === 'done' && !i.deleted) row.instagram = { url: i.url, ...(i.postId ? ig[i.postId] || {} : { note: 'old post' }) };
      return row;
    })
    .filter((r) => r.youtube || r.instagram);

  const sum = (platform, key) => rows.reduce((n, r) => n + (Number(r[platform]?.[key]) || 0), 0);
  const data = {
    updatedAt: new Date().toISOString(),
    totals: {
      youtube: { posts: rows.filter((r) => r.youtube).length, views: sum('youtube', 'views'), likes: sum('youtube', 'likes'), comments: sum('youtube', 'comments') },
      instagram: { posts: rows.filter((r) => r.instagram).length, views: sum('instagram', 'views'), likes: sum('instagram', 'likes'), comments: sum('instagram', 'comments') },
    },
    instagramViews: Boolean(accounts.meta?.permissions?.includes('instagram_manage_insights')),
    errors: [yt._error && `YouTube: ${yt._error}`, ig._error && `Instagram: ${ig._error}`].filter(Boolean),
    rows,
  };
  cache = { at: Date.now(), data };
  return data;
}
