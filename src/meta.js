// Facebook Page + Instagram (Business/Creator) publishing through the Meta Graph API.
import fs from 'node:fs';
import { config } from './config.js';

const SCOPES = [
  'pages_show_list',
  'pages_read_engagement',
  'pages_manage_posts',
  'business_management',
  'instagram_basic',
  'instagram_content_publish',
  // Needed to delete Instagram posts from the app.
  'instagram_manage_contents',
  // Needed for view counts in Analytics. Not in the current App Review submission,
  // so only asked for when META_INSIGHTS=1 (turn on once it is approved).
  ...(process.env.META_INSIGHTS === '1' ? ['instagram_manage_insights'] : []),
];

const GRAPH = () => `https://graph.facebook.com/${config.meta.version}`;
const GRAPH_VIDEO = () => `https://graph-video.facebook.com/${config.meta.version}`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function metaConfigured() {
  return Boolean(config.meta.appId && config.meta.appSecret);
}

async function readGraphResponse(res) {
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = { raw: text };
  }
  if (!res.ok || data.error || data.debug_info) {
    const e = data.error || {};
    let msg = e.error_user_msg || e.message || data.debug_info?.message || text || `HTTP ${res.status}`;
    if (data.debug_info?.type) msg += ` (${data.debug_info.type})`;
    throw new Error(`Meta API: ${msg}`);
  }
  return data;
}

async function graphGet(path, params = {}) {
  const url = new URL(`${GRAPH()}${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return readGraphResponse(await fetch(url));
}

async function graphPost(path, params = {}, base = GRAPH()) {
  return readGraphResponse(
    await fetch(`${base}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(params),
    }),
  );
}

// Sends the raw video bytes to Meta's "rupload" host (used by Reels and Instagram).
async function ruploadFile(uploadUrl, token, filePath) {
  const size = fs.statSync(filePath).size;
  const blob = await fs.openAsBlob(filePath);
  return readGraphResponse(
    await fetch(uploadUrl, {
      method: 'POST',
      headers: {
        Authorization: `OAuth ${token}`,
        offset: '0',
        file_size: String(size),
      },
      body: blob,
    }),
  );
}

// ---------------- login ----------------

export function metaAuthUrl(state) {
  const url = new URL(`https://www.facebook.com/${config.meta.version}/dialog/oauth`);
  url.searchParams.set('client_id', config.meta.appId);
  url.searchParams.set('redirect_uri', config.meta.redirectUri);
  url.searchParams.set('state', state);
  url.searchParams.set('scope', SCOPES.join(','));
  url.searchParams.set('response_type', 'code');
  return url.toString();
}

// Facebook login -> every Page the person allowed, with its linked Instagram account.
export async function metaExchangeCode(code) {
  const short = await graphGet('/oauth/access_token', {
    client_id: config.meta.appId,
    client_secret: config.meta.appSecret,
    redirect_uri: config.meta.redirectUri,
    code,
  });
  // Swap for a long-lived user token, so the Page tokens below never expire.
  const long = await graphGet('/oauth/access_token', {
    grant_type: 'fb_exchange_token',
    client_id: config.meta.appId,
    client_secret: config.meta.appSecret,
    fb_exchange_token: short.access_token,
  });

  const res = await graphGet('/me/accounts', {
    access_token: long.access_token,
    fields: 'id,name,access_token,picture{url},instagram_business_account{id,username,profile_picture_url}',
    limit: '100',
  });

  const pages = (res.data || []).map((p) => ({
    id: p.id,
    name: p.name,
    accessToken: p.access_token,
    picture: p.picture?.data?.url || null,
    ig: p.instagram_business_account
      ? {
          id: p.instagram_business_account.id,
          username: p.instagram_business_account.username,
          picture: p.instagram_business_account.profile_picture_url || null,
        }
      : null,
  }));
  if (!pages.length) {
    throw new Error('No Facebook Pages found. While logging in, tick your Page (and its Instagram account) when Facebook asks which ones to allow.');
  }

  // Which permissions were actually granted (e.g. whether deleting is allowed).
  let permissions = [];
  try {
    const perms = await graphGet('/me/permissions', { access_token: long.access_token });
    permissions = (perms.data || []).filter((p) => p.status === 'granted').map((p) => p.permission);
  } catch {
    /* optional */
  }
  return { pages, permissions };
}

// A channel (Instagram account or Facebook Page) -> the page object the functions below use.
export function pageFromChannel(channel) {
  const s = channel.secret || {};
  return {
    id: s.pageId || channel.info?.pageId || channel.externalId,
    name: channel.info?.pageName || channel.name,
    accessToken: s.pageToken,
    permissions: channel.info?.permissions || [],
    ig: channel.platform === 'instagram' ? { id: channel.externalId, username: channel.username } : null,
  };
}

export function instagramCanDelete(channel) {
  return Boolean(channel?.info?.permissions?.includes('instagram_manage_contents'));
}

export function instagramCanSeeViews(channel) {
  return Boolean(channel?.info?.permissions?.includes('instagram_manage_insights'));
}

async function graphDelete(path, token) {
  const url = new URL(`${GRAPH()}${path}`);
  url.searchParams.set('access_token', token);
  const res = await fetch(url, { method: 'DELETE' });
  try {
    return await readGraphResponse(res);
  } catch (err) {
    // Already deleted, or never existed: treat as done.
    if (/does not exist|cannot be loaded|Unsupported delete request|not found/i.test(err.message)) {
      return { alreadyGone: true };
    }
    throw err;
  }
}

export function facebookIdFromUrl(url) {
  const m = String(url || '').match(/(?:reel|videos)\/(\d+)/);
  return m ? m[1] : null;
}

export async function deleteFacebookPost(page, id) {
  return graphDelete(`/${id}`, page.accessToken);
}

export async function deleteInstagramMedia(page, mediaId) {
  if (!page.permissions.includes('instagram_manage_contents')) {
    throw new Error('No permission to delete on Instagram. Reconnect this Instagram account on the Channels page and try again.');
  }
  return graphDelete(`/${mediaId}`, page.accessToken);
}

// Likes / comments (and views when allowed) for one Instagram post.
export async function instagramPostStats(page, mediaId) {
  const basic = await graphGet(`/${mediaId}`, { fields: 'like_count,comments_count,media_type,media_url,thumbnail_url', access_token: page.accessToken });
  const stats = {
    likes: basic.like_count ?? null,
    comments: basic.comments_count ?? null,
    views: null,
    thumb: basic.thumbnail_url || (basic.media_type === 'VIDEO' ? null : basic.media_url) || null,
  };
  if (page.permissions.includes('instagram_manage_insights')) {
    for (const metric of ['views', 'plays']) {
      try {
        const ins = await graphGet(`/${mediaId}/insights`, { metric, access_token: page.accessToken });
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
  return stats;
}

// Account reach over the last 28 days (instagram_manage_insights). Tries the newer
// total_value form first, then the classic daily series, since Graph versions differ.
export async function instagramAccountReach(page) {
  const until = Math.floor(Date.now() / 1000);
  const since = until - 28 * 24 * 3600;
  const id = page.ig?.id;
  if (!id) return null;
  try {
    const r = await graphGet(`/${id}/insights`, {
      metric: 'reach',
      period: 'day',
      metric_type: 'total_value',
      since,
      until,
      access_token: page.accessToken,
    });
    const v = r.data?.[0]?.total_value?.value;
    if (v != null) return Number(v);
  } catch {
    /* fall back below */
  }
  const r = await graphGet(`/${id}/insights`, { metric: 'reach', period: 'day', since, until, access_token: page.accessToken });
  const values = r.data?.[0]?.values || [];
  return values.reduce((n, x) => n + (Number(x.value) || 0), 0);
}

// ---------------- Facebook ----------------

async function facebookRegularVideo(page, { filePath, title, description }) {
  const form = new FormData();
  form.set('access_token', page.accessToken);
  form.set('description', description || '');
  if (title) form.set('title', title);
  form.set('source', await fs.openAsBlob(filePath), 'video.mp4');
  const data = await readGraphResponse(
    await fetch(`${GRAPH_VIDEO()}/${page.id}/videos`, { method: 'POST', body: form }),
  );
  return { id: data.id, url: `https://www.facebook.com/${page.id}/videos/${data.id}` };
}

async function facebookReel(page, { filePath, description }) {
  const start = await graphPost(`/${page.id}/video_reels`, {
    upload_phase: 'start',
    access_token: page.accessToken,
  });
  const uploadUrl = start.upload_url || `https://rupload.facebook.com/video-upload/${config.meta.version}/${start.video_id}`;
  await ruploadFile(uploadUrl, page.accessToken, filePath);
  await graphPost(`/${page.id}/video_reels`, {
    upload_phase: 'finish',
    video_id: start.video_id,
    video_state: 'PUBLISHED',
    description: description || '',
    access_token: page.accessToken,
  });
  return { id: start.video_id, url: `https://www.facebook.com/reel/${start.video_id}` };
}

export async function uploadToFacebook(page, { filePath, title, description, isShort }, onStatus) {
  if (!page) throw new Error('Facebook is not connected');

  if (!isShort) {
    onStatus?.('Uploading video to Facebook Page');
    return { ...(await facebookRegularVideo(page, { filePath, title, description })), pageId: page.id };
  }
  try {
    onStatus?.('Uploading reel to Facebook Page');
    return { ...(await facebookReel(page, { filePath, description })), pageId: page.id };
  } catch (err) {
    // Reels must be 3–90 s and vertical. If Facebook refuses, post it as a normal video instead.
    onStatus?.(`Reel refused (${err.message}); posting as a normal video`);
    const result = await facebookRegularVideo(page, { filePath, title, description });
    return { ...result, pageId: page.id, note: 'Posted as a normal video because Facebook refused it as a Reel' };
  }
}

// ---------------- Instagram ----------------

export async function uploadToInstagram(page, { filePath, caption, publicVideoUrl, shareToFeed = true }, onStatus) {
  if (!page) throw new Error('Facebook/Instagram is not connected');
  if (!page.ig) throw new Error(`The Page "${page.name}" has no Instagram Business/Creator account linked`);

  const token = page.accessToken;
  const params = {
    media_type: 'REELS',
    caption: (caption || '').slice(0, 2200),
    share_to_feed: String(shareToFeed),
    access_token: token,
  };

  // Two ways to hand Instagram the video:
  //  - "url": Instagram downloads it from a public https link (most reliable when we have one)
  //  - "resumable": we send the bytes to Meta's upload server ourselves
  // We try them in order and fall back to the other one if Instagram refuses.
  const hasUrl = Boolean(publicVideoUrl?.startsWith('https://'));
  const modes = hasUrl ? ['url', 'resumable'] : ['resumable'];
  if (config.igUploadMode === 'url' && !hasUrl) {
    throw new Error('IG_UPLOAD_MODE=url needs PUBLIC_BASE_URL to be a public https address');
  }

  async function createAndProcess(mode) {
    let container;
    if (mode === 'url') {
      onStatus?.('Instagram is downloading the video');
      container = await graphPost(`/${page.ig.id}/media`, { ...params, video_url: publicVideoUrl });
    } else {
      onStatus?.('Uploading video to Instagram');
      container = await graphPost(`/${page.ig.id}/media`, { ...params, upload_type: 'resumable' });
      const uploadUrl = container.uri || `https://rupload.facebook.com/ig-api-upload/${config.meta.version}/${container.id}`;
      await ruploadFile(uploadUrl, token, filePath);
    }

    // Instagram processes the video before it can be published (can take a few minutes).
    onStatus?.('Instagram is processing the video');
    const deadline = Date.now() + 20 * 60 * 1000;
    while (true) {
      const s = await graphGet(`/${container.id}`, { fields: 'status_code,status', access_token: token });
      if (s.status_code === 'FINISHED') return container;
      if (s.status_code === 'ERROR' || s.status_code === 'EXPIRED') {
        throw new Error(`Instagram could not process the video: ${s.status || s.status_code}`);
      }
      if (Date.now() > deadline) throw new Error('Instagram took too long to process the video');
      await sleep(5000);
    }
  }

  let container;
  let lastError;
  for (const mode of modes) {
    try {
      container = await createAndProcess(mode);
      break;
    } catch (err) {
      console.error(`[instagram] ${mode} upload failed:`, err.message);
      lastError = err;
    }
  }
  if (!container) throw lastError;

  onStatus?.('Publishing on Instagram');
  const published = await graphPost(`/${page.ig.id}/media_publish`, {
    creation_id: container.id,
    access_token: token,
  });

  let url = `https://www.instagram.com/${page.ig.username}/`;
  try {
    const info = await graphGet(`/${published.id}`, { fields: 'permalink', access_token: token });
    if (info.permalink) url = info.permalink;
  } catch {
    /* permalink is optional */
  }
  return { id: published.id, url, pageId: page.id, account: page.ig.username };
}

// ---------------- Instagram photo / carousel ----------------

// Waits until Instagram has finished processing a container (videos take a while; photos are quick).
async function waitForContainer(id, token, onStatus, label = 'Instagram is processing') {
  const deadline = Date.now() + 15 * 60 * 1000;
  while (true) {
    const s = await graphGet(`/${id}`, { fields: 'status_code,status', access_token: token });
    if (s.status_code === 'FINISHED' || !s.status_code) return;
    if (s.status_code === 'ERROR' || s.status_code === 'EXPIRED') {
      throw new Error(`Instagram could not process the file: ${s.status || s.status_code}`);
    }
    if (Date.now() > deadline) throw new Error('Instagram took too long to process the files');
    onStatus?.(label);
    await sleep(4000);
  }
}

// items: [{ kind: 'image' | 'video', url }] — 1 item = single photo post, 2–10 = carousel.
export async function publishInstagramMedia(page, { items, caption }, onStatus) {
  if (!page) throw new Error('Facebook/Instagram is not connected');
  if (!page.ig) throw new Error(`The Page "${page.name}" has no Instagram Business/Creator account linked`);
  const token = page.accessToken;
  const igId = page.ig.id;
  const text = (caption || '').slice(0, 2200);

  let container;
  if (items.length === 1 && items[0].kind === 'image') {
    onStatus?.('Instagram is fetching the photo');
    container = await graphPost(`/${igId}/media`, { image_url: items[0].url, caption: text, access_token: token });
    await waitForContainer(container.id, token, onStatus);
  } else {
    // Each photo/video becomes a carousel item first.
    const children = [];
    for (const [n, item] of items.entries()) {
      onStatus?.(`Instagram is fetching item ${n + 1} of ${items.length}`);
      const params =
        item.kind === 'video'
          ? { media_type: 'VIDEO', video_url: item.url, is_carousel_item: 'true', access_token: token }
          : { image_url: item.url, is_carousel_item: 'true', access_token: token };
      const child = await graphPost(`/${igId}/media`, params);
      children.push(child.id);
    }
    for (const [n, id] of children.entries()) {
      await waitForContainer(id, token, onStatus, `Instagram is processing item ${n + 1} of ${children.length}`);
    }
    onStatus?.('Building the carousel');
    container = await graphPost(`/${igId}/media`, {
      media_type: 'CAROUSEL',
      children: children.join(','),
      caption: text,
      access_token: token,
    });
    await waitForContainer(container.id, token, onStatus);
  }

  onStatus?.('Publishing on Instagram');
  const published = await graphPost(`/${igId}/media_publish`, { creation_id: container.id, access_token: token });
  let url = `https://www.instagram.com/${page.ig.username}/`;
  try {
    const info = await graphGet(`/${published.id}`, { fields: 'permalink', access_token: token });
    if (info.permalink) url = info.permalink;
  } catch {
    /* permalink is optional */
  }
  return { id: published.id, url, pageId: page.id, account: page.ig.username };
}

// ---------------- Instagram: own recent media (to copy to other channels) ----------------

// Recent posts of the connected account, newest first. `withUrl` adds the (short-lived) media_url.
export async function instagramRecentMedia(page, { days = 60, withUrl = false } = {}) {
  if (!page?.ig) throw new Error('Not an Instagram channel');
  const since = Date.now() - days * 864e5;
  const fields = ['id', 'caption', 'media_type', 'media_product_type', 'timestamp', 'permalink', 'thumbnail_url'];
  if (withUrl) fields.push('media_url');
  const out = [];
  let next = `/${page.ig.id}/media`;
  let params = { fields: fields.join(','), limit: '50', access_token: page.accessToken };
  while (next && out.length < 300) {
    const r = await graphGet(next, params);
    for (const m of r.data || []) {
      if (new Date(m.timestamp).getTime() < since) return out;
      out.push(m);
    }
    const after = r.paging?.cursors?.after;
    if (!r.paging?.next || !after) break;
    params = { ...params, after };
  }
  return out;
}

export async function instagramMediaUrl(page, mediaId) {
  const m = await graphGet(`/${mediaId}`, { fields: 'media_type,media_url,caption,timestamp', access_token: page.accessToken });
  if (!m.media_url) throw new Error('Instagram did not give a download link for this post');
  return m;
}

// ---------------- Instagram story ----------------

// item: { kind: 'image' | 'video', url }. Stories have no caption; they disappear after 24 hours.
export async function publishInstagramStory(page, item, onStatus) {
  if (!page) throw new Error('Facebook/Instagram is not connected');
  if (!page.ig) throw new Error(`The Page "${page.name}" has no Instagram Business/Creator account linked`);
  const token = page.accessToken;
  const igId = page.ig.id;
  onStatus?.(item.kind === 'video' ? 'Instagram is fetching the story video' : 'Instagram is fetching the story photo');
  const container = await graphPost(`/${igId}/media`, {
    media_type: 'STORIES',
    ...(item.kind === 'video' ? { video_url: item.url } : { image_url: item.url }),
    access_token: token,
  });
  await waitForContainer(container.id, token, onStatus, 'Instagram is processing the story');
  onStatus?.('Publishing the story');
  const published = await graphPost(`/${igId}/media_publish`, { creation_id: container.id, access_token: token });
  let url = `https://www.instagram.com/stories/${page.ig.username}/`;
  try {
    const info = await graphGet(`/${published.id}`, { fields: 'permalink', access_token: token });
    if (info.permalink) url = info.permalink;
  } catch {
    /* permalink is optional */
  }
  return { id: published.id, url, pageId: page.id, account: page.ig.username };
}

// ---------------- Facebook Page story ----------------

// item: { kind: 'image' | 'video', url }. Page stories last 24 hours; they have no caption.
export async function publishFacebookStory(page, item, onStatus) {
  if (!page) throw new Error('Facebook is not connected');
  const token = page.accessToken;
  let result;
  if (item.kind === 'video') {
    onStatus?.('Starting the Facebook story upload');
    const start = await graphPost(`/${page.id}/video_stories`, { upload_phase: 'start', access_token: token });
    onStatus?.('Facebook is fetching the story video');
    await readGraphResponse(
      await fetch(start.upload_url, { method: 'POST', headers: { Authorization: `OAuth ${token}`, file_url: item.url } }),
    );
    onStatus?.('Publishing the Facebook story');
    result = await graphPost(`/${page.id}/video_stories`, { upload_phase: 'finish', video_id: start.video_id, access_token: token });
  } else {
    onStatus?.('Facebook is fetching the story photo');
    const photo = await graphPost(`/${page.id}/photos`, { url: item.url, published: 'false', access_token: token });
    onStatus?.('Publishing the Facebook story');
    result = await graphPost(`/${page.id}/photo_stories`, { photo_id: photo.id, access_token: token });
  }
  const id = result.post_id || result.id || null;
  return { id, url: `https://www.facebook.com/stories/${page.id}`, pageId: page.id };
}

// ---------------- Facebook Page photos ----------------

// items: photos only. 1 photo = photo post; several = one post with all photos attached.
export async function publishFacebookPhotos(page, { items, caption }, onStatus) {
  if (!page) throw new Error('Facebook is not connected');
  const token = page.accessToken;
  const photos = items.filter((i) => i.kind === 'image');
  if (!photos.length) throw new Error('Facebook: no photos to post');

  if (photos.length === 1) {
    onStatus?.('Posting photo to Facebook Page');
    const r = await graphPost(`/${page.id}/photos`, { url: photos[0].url, caption: caption || '', access_token: token });
    const id = r.post_id || r.id;
    return { id, url: `https://www.facebook.com/${id}`, pageId: page.id };
  }

  const ids = [];
  for (const [n, photo] of photos.entries()) {
    onStatus?.(`Uploading photo ${n + 1} of ${photos.length} to Facebook`);
    const r = await graphPost(`/${page.id}/photos`, { url: photo.url, published: 'false', access_token: token });
    ids.push(r.id);
  }
  onStatus?.('Publishing Facebook post');
  const params = { message: caption || '', access_token: token };
  ids.forEach((id, i) => (params[`attached_media[${i}]`] = JSON.stringify({ media_fbid: id })));
  const post = await graphPost(`/${page.id}/feed`, params);
  return { id: post.id, url: `https://www.facebook.com/${post.id}`, pageId: page.id };
}
