// One-time move of the single-user version's data (connected accounts, upload history, ideas)
// into the first account that signs up.
import * as db from './db.js';
import * as legacy from './store.js';

export async function migrateLegacyData(userId) {
  const accounts = await legacy.getAccounts().catch(() => ({}));
  const history = await legacy.listJobs().catch(() => []);
  const ideas = await legacy.listIdeas().catch(() => []);
  const channelFor = {}; // old platform name -> new channel id

  if (accounts.youtube?.tokens) {
    const ch = await db.upsertChannel(userId, {
      platform: 'youtube',
      externalId: accounts.youtube.channelId || 'legacy-youtube',
      name: accounts.youtube.channelTitle || 'YouTube',
      secret: { tokens: accounts.youtube.tokens },
      info: {},
    });
    channelFor.youtube = ch;
  }

  const meta = accounts.meta;
  const page = meta?.pages?.find((p) => p.id === meta.selectedPageId) || meta?.pages?.[0];
  if (page) {
    const info = { pageId: page.id, pageName: page.name, permissions: meta.permissions || [] };
    const secret = { pageToken: page.accessToken, pageId: page.id };
    if (page.ig) {
      channelFor.instagram = await db.upsertChannel(userId, {
        platform: 'instagram',
        externalId: page.ig.id,
        name: page.ig.username,
        username: page.ig.username,
        secret,
        info,
      });
    }
    if (history.some((j) => j.platforms?.facebook)) {
      channelFor.facebook = await db.upsertChannel(userId, { platform: 'facebook', externalId: page.id, name: page.name, secret, info });
    }
  }

  for (const job of [...history].reverse()) {
    const targets = {};
    for (const [platform, t] of Object.entries(job.platforms || {})) {
      const ch = channelFor[platform];
      if (!ch) continue;
      targets[ch.id] = { ...t, platform, channelName: ch.name, avatar: ch.avatar || null };
    }
    if (!Object.keys(targets).length) continue;
    const post = await db.createPost({
      id: job.id,
      userId,
      status: job.status || 'posted',
      scheduledAt: job.scheduledAt || null,
      type: job.type || 'reel',
      caption: job.caption || '',
      fileName: job.fileName || '',
      input: job.input || {},
      targets,
      mediaSource: job.mediaSource || null,
    }).catch(() => null);
    if (post && (job.postedAt || job.retrySource)) {
      post.postedAt = job.postedAt || job.createdAt;
      post.retrySource = job.retrySource || null;
      await db.savePost(post).catch(() => {});
    }
    if (post) await db.q('UPDATE posts SET created_at = $2 WHERE id = $1', [post.id, job.createdAt]).catch(() => {});
  }

  for (const idea of [...ideas].reverse()) await db.createIdea(userId, idea.text).catch(() => {});
}
