// YouTube: connecting channels, uploading, deleting and stats. Every function works on one
// connected channel (its tokens live in channel.secret.tokens).
import fs from 'node:fs';
import { google } from 'googleapis';
import { config } from './config.js';
import { updateChannelSecret } from './db.js';

const DELETE_SCOPE = 'https://www.googleapis.com/auth/youtube.force-ssl';
const SCOPES = [
  'https://www.googleapis.com/auth/youtube.upload',
  'https://www.googleapis.com/auth/youtube.readonly',
  // Needed to delete videos from the app.
  DELETE_SCOPE,
];

export function youtubeConfigured() {
  return Boolean(config.google.clientId && config.google.clientSecret);
}

export function youtubeCanDelete(channel) {
  const granted = String(channel?.secret?.tokens?.scope || '');
  return granted.includes(DELETE_SCOPE) || /auth\/youtube(\s|$)/.test(granted);
}

function newClient() {
  return new google.auth.OAuth2(config.google.clientId, config.google.clientSecret, config.google.redirectUri);
}

// A YouTube API client for one channel. Refreshed access tokens are saved back to the channel.
function apiFor(channel) {
  const client = newClient();
  client.setCredentials(channel.secret?.tokens || {});
  client.on('tokens', (tokens) => {
    const merged = { ...(channel.secret?.tokens || {}), ...tokens };
    channel.secret = { ...(channel.secret || {}), tokens: merged };
    updateChannelSecret(channel.id, channel.secret).catch((err) => console.error('Could not save refreshed YouTube token', err));
  });
  return google.youtube({ version: 'v3', auth: client });
}

export function youtubeAuthUrl(state) {
  return newClient().generateAuthUrl({
    access_type: 'offline',
    // select_account lets people pick a different Google account / brand channel each time.
    prompt: 'consent select_account',
    scope: SCOPES,
    state,
  });
}

// Google login -> the channel that account chose, plus its tokens.
export async function youtubeExchangeCode(code) {
  const client = newClient();
  const { tokens } = await client.getToken(code);
  if (!tokens.refresh_token) {
    throw new Error('Google did not return a refresh token. Remove the app at myaccount.google.com/permissions and connect again.');
  }
  client.setCredentials(tokens);
  const yt = google.youtube({ version: 'v3', auth: client });
  const me = await yt.channels.list({ part: ['snippet'], mine: true });
  const ch = me.data.items?.[0];
  if (!ch) throw new Error('This Google account has no YouTube channel.');
  return {
    tokens,
    channel: {
      id: ch.id,
      title: ch.snippet.title,
      handle: ch.snippet.customUrl || null,
      avatar: ch.snippet.thumbnails?.default?.url || null,
    },
  };
}

export async function uploadToYouTube(channel, { filePath, title, description, tags, privacy, isShort }, onProgress) {
  const yt = apiFor(channel);
  let finalTitle = (title || 'New video').trim();
  let finalDescription = description || '';
  if (isShort && !/#shorts/i.test(finalTitle + finalDescription)) {
    finalDescription = `${finalDescription}\n\n#Shorts`.trim();
  }
  finalTitle = finalTitle.replace(/[<>]/g, '').slice(0, 100);

  const fileSize = fs.statSync(filePath).size;
  const res = await yt.videos.insert(
    {
      part: ['snippet', 'status'],
      notifySubscribers: true,
      requestBody: {
        snippet: {
          title: finalTitle,
          description: finalDescription.replace(/[<>]/g, '').slice(0, 5000),
          tags: tags?.length ? tags : undefined,
          categoryId: '22',
        },
        status: { privacyStatus: privacy || 'public', selfDeclaredMadeForKids: false },
      },
      media: { body: fs.createReadStream(filePath) },
    },
    {
      onUploadProgress: (evt) => {
        if (onProgress && fileSize) onProgress(Math.round((evt.bytesRead / fileSize) * 100));
      },
    },
  );

  const id = res.data.id;
  const url = isShort ? `https://youtube.com/shorts/${id}` : `https://youtu.be/${id}`;
  return { id, url, privacy: res.data.status?.privacyStatus };
}

export function youtubeIdFromUrl(url) {
  const m = String(url || '').match(/(?:shorts\/|youtu\.be\/|[?&]v=)([\w-]{6,})/);
  return m ? m[1] : null;
}

export async function deleteYouTubeVideo(channel, videoId) {
  if (!youtubeCanDelete(channel)) {
    throw new Error('YouTube-ൽ delete ചെയ്യാൻ permission ഇല്ല. Channels-ൽ ഈ YouTube "Reconnect" ചെയ്ത് വീണ്ടും ശ്രമിക്കൂ.');
  }
  try {
    await apiFor(channel).videos.delete({ id: videoId });
  } catch (err) {
    const code = err?.code || err?.response?.status;
    if (code === 404) return { alreadyGone: true }; // already deleted on YouTube
    if (code === 403) throw new Error('YouTube refused: reconnect this channel and try again.');
    throw err;
  }
  return { alreadyGone: false };
}

// Views / likes / comments for up to 50 videos per call.
export async function youtubeStats(channel, ids) {
  const out = {};
  const yt = apiFor(channel);
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
