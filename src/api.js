// Serializd API client. Pure fetch, no browser needed.
// API base + auth pattern reverse-engineered from serializd.com network traffic.

const API = 'https://serializd.onrender.com/api';
const SHOW_URL_BASE = 'https://www.serializd.com/show';

const BASE_HEADERS = {
  'x-requested-with': 'serializd_vercel',
  'accept': 'application/json, text/plain, */*',
  'referer': 'https://www.serializd.com/',
  'user-agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function slugifyShowName(name) {
  return String(name ?? '')
    .replace(/['']/g, '')
    .replace(/[^\p{L}\p{N}\- ]/gu, '')
    .trim()
    .replace(/\s+/g, '-');
}

export function showUrl(name, id) {
  if (id == null) return null;
  const slug = slugifyShowName(name);
  return slug ? `${SHOW_URL_BASE}/${slug}-${id}` : `${SHOW_URL_BASE}/${id}`;
}

export class SerializdClient {
  constructor({ token = null, log = () => {} } = {}) {
    this.token = token;
    this.log = log;
  }

  async login({ email, password }) {
    const r = await fetch(`${API}/login`, {
      method: 'POST',
      headers: { ...BASE_HEADERS, 'content-type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    if (!r.ok) {
      const body = await r.text().catch(() => '');
      throw new Error(`Login failed (${r.status}): ${body.slice(0, 200)}`);
    }
    const data = await r.json();
    if (!data.token) throw new Error('Login response missing token');
    this.token = data.token;
    return data; // { username, token }
  }

  async get(urlPath, { retries = 3 } = {}) {
    if (!this.token) throw new Error('Not authenticated — call login() first');
    const url = urlPath.startsWith('http') ? urlPath : `${API}${urlPath}`;
    let lastErr;
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const r = await fetch(url, {
          headers: { ...BASE_HEADERS, authorization: `Bearer ${this.token}` },
        });
        if (r.status === 429 || r.status >= 500) {
          lastErr = new Error(`HTTP ${r.status} on ${url}`);
          await sleep(800 * (attempt + 1));
          continue;
        }
        if (!r.ok) {
          const text = await r.text().catch(() => '');
          throw new Error(`HTTP ${r.status} on ${url} — ${text.slice(0, 200)}`);
        }
        return await r.json();
      } catch (e) {
        lastErr = e;
        await sleep(500 * (attempt + 1));
      }
    }
    throw lastErr;
  }

  async fetchAllWatched(username) {
    const all = [];
    let totalPages = 1;
    let totalShows = 0;
    let totalSeasons = 0;
    let page = 1;
    while (page <= totalPages) {
      this.log(`  watched page ${page}${totalPages > 1 ? ` / ${totalPages}` : ''}`);
      const data = await this.get(
        `/user/${encodeURIComponent(username)}/watchedpage_v2/${page}?sort_by=date_added_desc`,
      );
      if (data.items?.length) all.push(...data.items);
      if (typeof data.totalPages === 'number' && data.totalPages > 0) totalPages = data.totalPages;
      if (typeof data.numberOfShows === 'number') totalShows = data.numberOfShows;
      if (typeof data.numberOfSeasons === 'number') totalSeasons = data.numberOfSeasons;
      if (!data.items?.length) break;
      page++;
    }
    return { items: all, totalShows, totalSeasons, totalPages };
  }

  async fetchAllDiary(username) {
    const all = [];
    let page = 1;
    while (page <= 200) {
      this.log(`  diary page ${page}`);
      const data = await this.get(`/user/${encodeURIComponent(username)}/diary?page=${page}`);
      const reviews = data.reviews ?? [];
      if (!reviews.length) break;
      all.push(...reviews);
      if (typeof data.totalPages === 'number' && data.totalPages > 0 && page >= data.totalPages) break;
      page++;
    }
    return all;
  }

  async fetchShow(showId) {
    return this.get(`/show/${showId}`);
  }
}

// Concurrency-limited map. Used for enrichment.
export async function mapWithConcurrency(items, limit, fn) {
  const results = new Array(items.length);
  let nextIdx = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (true) {
      const i = nextIdx++;
      if (i >= items.length) return;
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}
