import fs from 'node:fs';
import { google } from 'googleapis';
import { config } from './config.js';
import { getAccounts, updateAccounts } from './store.js';

const SCOPES = [
  'https://www.googleapis.com/auth/youtube.upload',
  'https://www.googleapis.com/auth/youtube.readonly',
];

export function youtubeConfigured() {
  return Boolean(config.google.clientId && config.google.clientSecret);
}

function makeClient() {
  const client = new google.auth.OAuth2(
    config.google.clientId,
    config.google.clientSecret,
    config.google.redirectUri,
  );
  // Google sends a fresh access token from time to time: keep it.
  client.on('tokens', (tokens) => {
    updateAccounts((all) =>
      all.youtube ? { youtube: { ...all.youtube, tokens: { ...all.youtube.tokens, ...tokens } } } : {},
    ).catch((err) => console.error('Could not save refreshed YouTube token', err));
  });
  return client;
}

export function youtubeAuthUrl(state) {
  return makeClient().generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: SCOPES,
    state,
  });
}

export async function youtubeHandleCallback(code) {
  const client = makeClient();
  const { tokens } = await client.getToken(code);
  if (!tokens.refresh_token) {
    throw new Error('Google did not return a refresh token. Remove the app at myaccount.google.com/permissions and connect again.');
  }
  client.setCredentials(tokens);
  const yt = google.youtube({ version: 'v3', auth: client });
  const me = await yt.channels.list({ part: ['snippet'], mine: true });
  const channel = me.data.items?.[0];
  if (!channel) throw new Error('This Google account has no YouTube channel.');
  await updateAccounts({
    youtube: {
      tokens,
      channelId: channel.id,
      channelTitle: channel.snippet.title,
      connectedAt: new Date().toISOString(),
    },
  });
}

export async function uploadToYouTube({ filePath, title, description, tags, privacy, isShort }, onProgress) {
  const account = (await getAccounts()).youtube;
  if (!account) throw new Error('YouTube is not connected');

  const client = makeClient();
  client.setCredentials(account.tokens);
  const yt = google.youtube({ version: 'v3', auth: client });

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
        status: {
          privacyStatus: privacy || 'public',
          selfDeclaredMadeForKids: false,
        },
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
