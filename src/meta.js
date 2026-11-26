// Facebook Page + Instagram (Business/Creator) publishing through the Meta Graph API.
import fs from 'node:fs';
import { config } from './config.js';
import { getAccounts, updateAccounts } from './store.js';

const SCOPES = [
  'pages_show_list',
  'pages_read_engagement',
  'pages_manage_posts',
  'business_management',
  'instagram_basic',
  'instagram_content_publish',
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
  if (!res.ok || data.error) {
    const e = data.error || {};
    const msg = e.error_user_msg || e.message || data.debug_info?.message || text || `HTTP ${res.status}`;
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

export async function metaHandleCallback(code) {
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
    fields: 'id,name,access_token,instagram_business_account{id,username}',
    limit: '100',
  });

  const pages = (res.data || []).map((p) => ({
    id: p.id,
    name: p.name,
    accessToken: p.access_token,
    ig: p.instagram_business_account
      ? { id: p.instagram_business_account.id, username: p.instagram_business_account.username }
      : null,
  }));
  if (!pages.length) {
    throw new Error('No Facebook Pages found. While logging in, tick your Page (and its Instagram account) when Facebook asks which ones to allow.');
  }

  const previous = getAccounts().meta?.selectedPageId;
  const selected = pages.find((p) => p.id === previous) || pages.find((p) => p.ig) || pages[0];
  updateAccounts({
    meta: { pages, selectedPageId: selected.id, connectedAt: new Date().toISOString() },
  });
}

export function selectedPage() {
  const meta = getAccounts().meta;
  if (!meta) return null;
  return meta.pages.find((p) => p.id === meta.selectedPageId) || null;
}

export function selectPage(pageId) {
  const meta = getAccounts().meta;
  if (!meta || !meta.pages.some((p) => p.id === pageId)) throw new Error('Unknown page');
  updateAccounts({ meta: { ...meta, selectedPageId: pageId } });
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

export async function uploadToFacebook({ filePath, title, description, isShort }, onStatus) {
  const page = selectedPage();
  if (!page) throw new Error('Facebook is not connected');

  if (!isShort) {
    onStatus?.('Uploading video to Facebook Page');
    return facebookRegularVideo(page, { filePath, title, description });
  }
  try {
    onStatus?.('Uploading reel to Facebook Page');
    return await facebookReel(page, { filePath, description });
  } catch (err) {
    // Reels must be 3–90 s and vertical. If Facebook refuses, post it as a normal video instead.
    onStatus?.(`Reel refused (${err.message}); posting as a normal video`);
    const result = await facebookRegularVideo(page, { filePath, title, description });
    return { ...result, note: 'Posted as a normal video because Facebook refused it as a Reel' };
  }
}

// ---------------- Instagram ----------------

export async function uploadToInstagram({ filePath, caption, publicVideoUrl, shareToFeed = true }, onStatus) {
  const page = selectedPage();
  if (!page) throw new Error('Facebook/Instagram is not connected');
  if (!page.ig) throw new Error(`The Page "${page.name}" has no Instagram Business/Creator account linked`);

  const token = page.accessToken;
  const params = {
    media_type: 'REELS',
    caption: (caption || '').slice(0, 2200),
    share_to_feed: String(shareToFeed),
    access_token: token,
  };

  let container;
  if (config.igUploadMode === 'url') {
    if (!publicVideoUrl?.startsWith('https://')) {
      throw new Error('IG_UPLOAD_MODE=url needs PUBLIC_BASE_URL to be a public https address');
    }
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
    if (s.status_code === 'FINISHED') break;
    if (s.status_code === 'ERROR' || s.status_code === 'EXPIRED') {
      throw new Error(`Instagram could not process the video: ${s.status || s.status_code}`);
    }
    if (Date.now() > deadline) throw new Error('Instagram took too long to process the video');
    await sleep(5000);
  }

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
  return { id: published.id, url };
}
