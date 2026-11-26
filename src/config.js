import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const baseUrl = (process.env.PUBLIC_BASE_URL || `http://localhost:${process.env.PORT || 3000}`).replace(/\/+$/, '');

export const config = {
  port: Number(process.env.PORT || 3000),
  baseUrl,
  appPassword: process.env.APP_PASSWORD || '',
  mediaSecret: process.env.MEDIA_SECRET || 'dev-secret-change-me',
  keepFilesHours: Number(process.env.KEEP_FILES_HOURS || 24),
  // "resumable" sends the file straight to Instagram (works on localhost).
  // "url" makes Instagram download it from PUBLIC_BASE_URL (needs a public https address).
  igUploadMode: (process.env.IG_UPLOAD_MODE || 'resumable').toLowerCase(),

  google: {
    clientId: process.env.GOOGLE_CLIENT_ID || '',
    clientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
    redirectUri: `${baseUrl}/auth/google/callback`,
  },
  meta: {
    appId: process.env.META_APP_ID || '',
    appSecret: process.env.META_APP_SECRET || '',
    version: process.env.META_GRAPH_VERSION || 'v21.0',
    redirectUri: `${baseUrl}/auth/facebook/callback`,
  },

  paths: {
    root,
    public: path.join(root, 'public'),
    uploads: path.join(root, 'uploads'),
    data: path.join(root, 'data'),
  },
};
