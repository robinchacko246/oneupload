// Claude connector: a small MCP server (Streamable HTTP, stateless, JSON responses).
// Each user has a secret connector key; the URL /mcp/<key> acts as that user.
// The tools call back into the app through `api` (see server.js).

const PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];

const TOOLS = [
  {
    name: 'list_channels',
    title: 'List channels',
    description:
      'List the channels connected to One Upload (Instagram accounts, Facebook Pages, YouTube channels), with the id to use in create_post. Call this first to find a client by name.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'create_post',
    title: 'Create or schedule a post',
    description:
      'Create a post on one or more channels from media links. when="now" publishes immediately, when="schedule" publishes at scheduled_at, when="draft" saves it for later. ' +
      'media_urls must be direct, publicly reachable links to a video or photos (Google Drive "anyone with the link" and Dropbox share links are converted automatically). ' +
      'One video = a Reel / Short (or type "video" for a normal long video). 1 photo = photo post, 2–10 photos = carousel. ' +
      'type "story" = an Instagram Story from exactly one photo or video (Instagram channels only, no caption shown). YouTube only takes videos. Max 300 MB.',
    inputSchema: {
      type: 'object',
      properties: {
        channel_ids: { type: 'array', items: { type: 'string' }, minItems: 1, description: 'Channel ids from list_channels.' },
        caption: { type: 'string', description: 'Caption / description, with hashtags.' },
        media_urls: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 10, description: 'Links to the video or photos.' },
        when: { type: 'string', enum: ['now', 'schedule', 'draft'], description: 'Default "schedule" if scheduled_at is given, otherwise "draft".' },
        scheduled_at: {
          type: 'string',
          description: 'When to publish, ISO 8601 with a timezone offset, e.g. 2026-11-28T19:00:00+05:30 (India). Needed for when="schedule".',
        },
        type: { type: 'string', enum: ['reel', 'video', 'photo', 'carousel', 'story'], description: 'Optional. Worked out from the media if left out.' },
        youtube_title: { type: 'string', description: 'Optional YouTube title (default: first line of the caption).' },
        youtube_privacy: { type: 'string', enum: ['public', 'unlisted', 'private'] },
      },
      required: ['channel_ids', 'media_urls'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
  },
  {
    name: 'list_posts',
    title: 'List posts',
    description: 'List posts: scheduled (the queue), drafts, posted, or all. Newest first.',
    inputSchema: {
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['scheduled', 'draft', 'posted', 'all'], description: 'Default "all".' },
        limit: { type: 'integer', minimum: 1, maximum: 100, description: 'Default 20.' },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'get_post',
    title: 'Get a post',
    description: 'Details of one post: per-channel status (waiting, running, posted, error), links to the published posts and error messages.',
    inputSchema: { type: 'object', properties: { post_id: { type: 'string' } }, required: ['post_id'], additionalProperties: false },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'update_post',
    title: 'Change a scheduled post or draft',
    description:
      'Change the caption, channels or time of a scheduled post or draft. Set when="schedule" with scheduled_at to (re)schedule, or when="draft" to unschedule. Published posts cannot be changed.',
    inputSchema: {
      type: 'object',
      properties: {
        post_id: { type: 'string' },
        caption: { type: 'string' },
        channel_ids: { type: 'array', items: { type: 'string' }, minItems: 1 },
        when: { type: 'string', enum: ['schedule', 'draft'] },
        scheduled_at: { type: 'string', description: 'ISO 8601 with a timezone offset.' },
      },
      required: ['post_id'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false },
  },
  {
    name: 'cancel_post',
    title: 'Cancel a scheduled post or draft',
    description:
      'Delete a scheduled post or draft from One Upload (and its uploaded media). It has not been published, so nothing is removed from Instagram, Facebook or YouTube. Published posts are not touched by this tool.',
    inputSchema: { type: 'object', properties: { post_id: { type: 'string' } }, required: ['post_id'], additionalProperties: false },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
  },
  {
    name: 'get_analytics',
    title: 'Analytics',
    description: 'Views, likes and comments of posts published through One Upload, totals per platform, and Instagram account reach for the last 28 days.',
    inputSchema: { type: 'object', properties: { refresh: { type: 'boolean', description: 'Fetch fresh numbers instead of the 10-minute cache.' } }, additionalProperties: false },
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
];

const hasOffset = (s) => /([+-]\d{2}:?\d{2}|Z)$/i.test(String(s).trim());

function checkTime(s) {
  if (!s) return null;
  if (!hasOffset(s)) throw new Error('scheduled_at needs a timezone offset, e.g. 2026-11-28T19:00:00+05:30');
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) throw new Error('scheduled_at is not a valid date');
  return d.toISOString();
}

// Compact view of a post for the model.
function summarize(p) {
  return {
    id: p.id,
    status: p.status,
    type: p.type,
    caption: p.caption,
    scheduled_at: p.scheduledAt,
    posted_at: p.postedAt,
    created_at: p.createdAt,
    channels: Object.entries(p.platforms || {}).map(([id, t]) => ({
      channel_id: id,
      platform: t.platform,
      name: t.channelName,
      state: t.state,
      message: t.message,
      url: t.url || null,
      deleted: Boolean(t.deleted),
    })),
  };
}

async function callTool(api, userId, name, a = {}) {
  switch (name) {
    case 'list_channels':
      return (await api.listChannels(userId)).map((c) => ({
        id: c.id,
        platform: c.platform,
        name: c.name,
        username: c.username || null,
        page: c.info?.pageName || null,
      }));
    case 'create_post': {
      const scheduledAt = checkTime(a.scheduled_at);
      const when = a.when || (scheduledAt ? 'schedule' : 'draft');
      if (when === 'schedule' && !scheduledAt) throw new Error('when="schedule" needs scheduled_at');
      const post = await api.createPostFromUrls(userId, {
        channelIds: a.channel_ids,
        caption: a.caption || '',
        mediaUrls: a.media_urls,
        mode: when === 'now' ? 'now' : when,
        scheduledAt,
        type: a.type,
        ytTitle: a.youtube_title,
        privacy: a.youtube_privacy,
      });
      return {
        ...summarize(post),
        note:
          post.status === 'posting'
            ? 'Publishing has started. Check progress with get_post in a minute.'
            : post.status === 'scheduled'
              ? 'Scheduled. It goes out at scheduled_at (the timer runs every few minutes).'
              : 'Saved as a draft.',
      };
    }
    case 'list_posts': {
      const status = a.status || 'all';
      const posts = (await api.listPosts(userId)).filter((p) => status === 'all' || p.status === status);
      return posts.slice(0, a.limit || 20).map(summarize);
    }
    case 'get_post': {
      const p = await api.getPost(userId, a.post_id);
      if (!p) throw new Error('No post with that id');
      return summarize(p);
    }
    case 'update_post': {
      const scheduledAt = checkTime(a.scheduled_at);
      const change = {};
      if (a.caption != null) change.caption = a.caption;
      if (a.channel_ids) change.channels = a.channel_ids.join(',');
      if (a.when) change.mode = a.when;
      if (scheduledAt) {
        change.scheduledAt = scheduledAt;
        change.mode ||= 'schedule';
      }
      return summarize(await api.editPost(userId, a.post_id, change));
    }
    case 'cancel_post': {
      const p = await api.getPost(userId, a.post_id);
      if (!p) throw new Error('No post with that id');
      if (!['scheduled', 'draft'].includes(p.status)) throw new Error('Only scheduled posts and drafts can be cancelled here');
      await api.removePost(userId, a.post_id);
      return { cancelled: true, post_id: a.post_id };
    }
    case 'get_analytics':
      return api.analytics(userId, Boolean(a.refresh));
    default:
      throw Object.assign(new Error(`Unknown tool: ${name}`), { rpc: -32602 });
  }
}

const reply = (id, result) => ({ jsonrpc: '2.0', id, result });
const fail = (id, code, message) => ({ jsonrpc: '2.0', id, error: { code, message } });

async function handleMessage(api, userId, msg) {
  const { id, method, params = {} } = msg || {};
  const isRequest = id !== undefined && id !== null;
  if (!method) return isRequest ? fail(id, -32600, 'Invalid request') : null;
  if (!isRequest) return null; // notifications (e.g. notifications/initialized) need no answer

  switch (method) {
    case 'initialize': {
      const asked = params.protocolVersion;
      return reply(id, {
        protocolVersion: PROTOCOL_VERSIONS.includes(asked) ? asked : PROTOCOL_VERSIONS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'one-upload', title: 'One Upload', version: '1.0.0' },
        instructions:
          'One Upload publishes and schedules posts to the user\'s Instagram accounts, Facebook Pages and YouTube channels (often for several clients). ' +
          'Use list_channels to find channel ids by client name, then create_post. Times are usually India time (+05:30) unless the user says otherwise.',
      });
    }
    case 'ping':
      return reply(id, {});
    case 'tools/list':
      return reply(id, { tools: TOOLS });
    case 'tools/call': {
      try {
        const data = await callTool(api, userId, params.name, params.arguments || {});
        return reply(id, { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }], structuredContent: Array.isArray(data) ? { items: data } : data });
      } catch (err) {
        if (err.rpc) return fail(id, err.rpc, err.message);
        return reply(id, { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true });
      }
    }
    case 'resources/list':
      return reply(id, { resources: [] });
    case 'prompts/list':
      return reply(id, { prompts: [] });
    default:
      return fail(id, -32601, `Method not found: ${method}`);
  }
}

/** Express handler for POST /mcp/:key. `findUser(req)` returns the user id or null. */
export function mcpHandler(api, findUser) {
  return async (req, res) => {
    if (req.method === 'GET') return res.status(405).set('Allow', 'POST').end(); // no server-initiated stream
    if (req.method === 'DELETE') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).set('Allow', 'POST').end();
    try {
      const userId = await findUser(req);
      if (!userId) return res.status(401).json(fail(null, -32001, 'Unknown or revoked connector key. Create a new link in One Upload → Channels.'));
      const body = req.body;
      if (Array.isArray(body)) {
        const out = (await Promise.all(body.map((m) => handleMessage(api, userId, m)))).filter(Boolean);
        return out.length ? res.json(out) : res.status(202).end();
      }
      const out = await handleMessage(api, userId, body);
      return out ? res.json(out) : res.status(202).end();
    } catch (err) {
      console.error('[mcp]', err);
      res.status(500).json(fail(null, -32603, err.message));
    }
  };
}
