// Views / likes / comments for one user's posts, per connected channel.
import * as db from './db.js';
import { youtubeIdFromUrl, youtubeStats } from './youtube.js';
import { instagramAccountReach, instagramCanSeeViews, instagramPostStats, pageFromChannel } from './meta.js';

const CACHE_MS = 10 * 60 * 1000; // stats change slowly; keep API calls low
const cache = new Map(); // userId -> { at, data }

export async function getAnalytics(userId, refresh = false) {
  const hit = cache.get(userId);
  if (!refresh && hit && Date.now() - hit.at < CACHE_MS) return hit.data;

  const [posts, channelRows] = await Promise.all([db.listPosts(userId, 200), db.listChannels(userId)]);
  const channels = Object.fromEntries(channelRows.map((c) => [c.id, db.withSecret(c)]));
  const posted = posts.filter((p) => p.status === 'posted' && p.type !== 'story').slice(0, 100);
  const live = (t) => t?.state === 'done' && !t.deleted;

  // YouTube: one stats call per channel for all its videos.
  const ytIds = new Map(); // channelId -> [videoIds]
  for (const p of posted) {
    for (const [cid, t] of Object.entries(p.targets)) {
      if (t.platform !== 'youtube' || !live(t)) continue;
      const vid = t.postId || youtubeIdFromUrl(t.url);
      if (vid) ytIds.set(cid, [...(ytIds.get(cid) || []), vid]);
    }
  }
  const errors = [];
  const ytStats = {};
  await Promise.all(
    [...ytIds.entries()].map(async ([cid, ids]) => {
      if (!channels[cid]) return;
      try {
        Object.assign(ytStats, await youtubeStats(channels[cid], ids));
      } catch (err) {
        errors.push(`${channels[cid].name}: ${err.message}`);
      }
    }),
  );

  // Instagram: one call per post.
  const igStats = {};
  await Promise.all(
    posted.flatMap((p) =>
      Object.entries(p.targets)
        .filter(([cid, t]) => t.platform === 'instagram' && live(t) && t.postId && channels[cid])
        .map(async ([cid, t]) => {
          try {
            igStats[t.postId] = await instagramPostStats(pageFromChannel(channels[cid]), t.postId);
          } catch (err) {
            igStats[t.postId] = { error: /does not exist|cannot be loaded/i.test(err.message) ? 'deleted' : err.message };
          }
        }),
    ),
  );

  // Instagram account reach (last 28 days), per connected account that granted insights.
  const accounts = [];
  await Promise.all(
    Object.values(channels)
      .filter((c) => c.platform === 'instagram' && instagramCanSeeViews(c))
      .map(async (c) => {
        try {
          accounts.push({ channelId: c.id, name: c.username || c.name, reach28: await instagramAccountReach(pageFromChannel(c)) });
        } catch (err) {
          errors.push(`${c.username || c.name}: ${err.message}`);
        }
      }),
  );

  const rows = posted
    .map((p) => {
      const lines = Object.entries(p.targets)
        .filter(([, t]) => live(t) && t.platform !== 'facebook')
        .map(([cid, t]) => {
          const vid = t.platform === 'youtube' ? t.postId || youtubeIdFromUrl(t.url) : null;
          const stats = vid ? ytStats[vid] : t.postId ? igStats[t.postId] : { note: 'old post' };
          const thumb = vid ? `https://i.ytimg.com/vi/${vid}/mqdefault.jpg` : null;
          return { channelId: cid, platform: t.platform, channelName: t.channelName, url: t.url, thumb, ...(stats || {}) };
        });
      return { id: p.id, title: (p.caption || '').split('\n')[0] || p.fileName, createdAt: p.postedAt || p.createdAt, type: p.type, lines };
    })
    .filter((r) => r.lines.length);

  const totals = {};
  for (const platform of ['youtube', 'instagram']) {
    const ls = rows.flatMap((r) => r.lines.filter((l) => l.platform === platform));
    const sum = (k) => ls.reduce((n, l) => n + (Number(l[k]) || 0), 0);
    totals[platform] = { posts: ls.length, views: sum('views'), likes: sum('likes'), comments: sum('comments') };
  }

  const data = {
    updatedAt: new Date().toISOString(),
    totals,
    instagramViews: channelRows.filter((c) => c.platform === 'instagram').some((c) => instagramCanSeeViews(c)),
    errors,
    accounts,
    rows,
  };
  cache.set(userId, { at: Date.now(), data });
  return data;
}
