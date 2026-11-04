// Meta Graph API connector: real Instagram numbers for any public
// Business/Creator account via Business Discovery.
//
// Requires an Instagram Business account connected to a Facebook Page owned
// by the agency (its IG user id), and an access token with
// instagram_basic + instagram_manage_insights + pages_read_engagement.
// Docs: https://developers.facebook.com/docs/instagram-platform/instagram-api-with-facebook-login/business-discovery

export const GRAPH_BASE_URL = 'https://graph.facebook.com';
export const DEFAULT_GRAPH_VERSION = 'v24.0';

export class GraphApiError extends Error {
  constructor(message, status, body) {
    super(message);
    this.name = 'GraphApiError';
    this.status = status;
    this.body = body;
  }
}

/** Instagram handle from a URL or "@handle". Returns null if it is not a profile. */
export function instagramHandle(input) {
  if (!input) return null;
  const s = String(input).trim();
  const m = s.match(/instagram\.com\/([A-Za-z0-9._]+)/i);
  const handle = m ? m[1] : s.replace(/^@/, '');
  if (!/^[A-Za-z0-9._]{1,30}$/.test(handle)) return null;
  if (['p', 'reel', 'reels', 'explore', 'stories', 'accounts'].includes(handle.toLowerCase())) return null;
  return handle;
}

/** Posts per week across the timestamps of the recent media sample. */
export function postsPerWeek(timestamps, nowIso) {
  const times = timestamps.map((t) => Date.parse(t)).filter((t) => Number.isFinite(t)).sort((a, b) => a - b);
  if (times.length < 2) return null;
  const end = Math.max(times[times.length - 1], nowIso ? Date.parse(nowIso) : times[times.length - 1]);
  const weeks = (end - times[0]) / (7 * 86_400_000);
  return weeks > 0 ? Math.round((times.length / weeks) * 10) / 10 : null;
}

/**
 * Fetch an Instagram profile's public metrics.
 * Returns fields of the Base44 SocialProfile entity, with data_sources.
 * When the account does not exist or is a personal account, returns
 * { profile_found: false } (Business Discovery only sees Business/Creator accounts).
 */
export async function fetchInstagramProfile({
  handle, igUserId, accessToken, graphVersion = DEFAULT_GRAPH_VERSION, mediaLimit = 12, fetchImpl = fetch, now,
}) {
  const fetchedAt = now || new Date().toISOString();
  const username = instagramHandle(handle);
  if (!username) return { platform: 'instagram', profile_found: false, not_found_reason: 'invalid handle' };
  if (!igUserId || !accessToken) throw new GraphApiError('Meta Graph credentials missing (AgencySettings.api_keys.meta_graph / meta_ig_user_id)', 0, null);

  const fields = `business_discovery.username(${username}){username,name,biography,followers_count,follows_count,media_count,`
    + `media.limit(${mediaLimit}){like_count,comments_count,timestamp,media_type,permalink}}`;
  const url = `${GRAPH_BASE_URL}/${graphVersion}/${encodeURIComponent(igUserId)}?fields=${encodeURIComponent(fields)}&access_token=${encodeURIComponent(accessToken)}`;
  const res = await fetchImpl(url, { method: 'GET' });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = json && json.error;
    // 110 / subcode 2207013: user not found or not a business account.
    if (err && (err.code === 110 || err.error_subcode === 2207013 || /cannot be found|not.*business/i.test(err.message || ''))) {
      return { platform: 'instagram', handle: username, profile_url: `https://www.instagram.com/${username}/`, profile_found: false,
        not_found_reason: 'not a public Business/Creator account' };
    }
    throw new GraphApiError(`Meta Graph business_discovery failed: ${(err && err.message) || `HTTP ${res.status}`}`, res.status, json);
  }

  const bd = json.business_discovery || {};
  const media = (bd.media && bd.media.data) || [];
  const followers = typeof bd.followers_count === 'number' ? bd.followers_count : null;
  const withCounts = media.filter((m) => typeof m.like_count === 'number' || typeof m.comments_count === 'number');
  const avgLikes = withCounts.length ? withCounts.reduce((a, m) => a + (m.like_count || 0), 0) / withCounts.length : null;
  const avgComments = withCounts.length ? withCounts.reduce((a, m) => a + (m.comments_count || 0), 0) / withCounts.length : null;
  const engagement = followers && avgLikes !== null ? ((avgLikes + (avgComments || 0)) / followers) * 100 : null;
  const perWeek = postsPerWeek(media.map((m) => m.timestamp), fetchedAt);
  const profileUrl = `https://www.instagram.com/${bd.username || username}/`;
  const meta = { source: 'meta_graph', url: profileUrl, fetched_at: fetchedAt };
  const derivedMeta = { ...meta, note: `Computed from the ${withCounts.length} most recent posts` };

  return {
    platform: 'instagram',
    handle: bd.username || username,
    profile_url: profileUrl,
    profile_found: true,
    followers,
    total_posts: typeof bd.media_count === 'number' ? bd.media_count : null,
    avg_likes: avgLikes === null ? null : Math.round(avgLikes * 10) / 10,
    avg_comments: avgComments === null ? null : Math.round(avgComments * 10) / 10,
    engagement_rate: engagement === null ? null : Math.round(engagement * 100) / 100,
    post_frequency: perWeek === null ? null : `${perWeek} posts/week`,
    last_post_date: media.length ? media.map((m) => m.timestamp).sort().reverse()[0] : null,
    data_source: 'meta_graph',
    fetched_at: fetchedAt,
    data_sources: {
      followers: meta,
      total_posts: meta,
      avg_likes: derivedMeta,
      avg_comments: derivedMeta,
      engagement_rate: derivedMeta,
      post_frequency: derivedMeta,
    },
  };
}
