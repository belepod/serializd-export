// Quick probe to find per-show user data endpoints (ratings, reviews, episode progress).
// Uses the API directly with the JWT we discovered.
import dotenv from 'dotenv';
import fs from 'node:fs';
import path from 'node:path';

dotenv.config();
const { SERIALIZD_EMAIL, SERIALIZD_PASSWORD, SERIALIZD_USERNAME } = process.env;

const API = 'https://serializd.onrender.com/api';
const COMMON_HEADERS = {
  'x-requested-with': 'serializd_vercel',
  'accept': 'application/json, text/plain, */*',
  'referer': 'https://www.serializd.com/',
  'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
};

async function login() {
  const r = await fetch(`${API}/login`, {
    method: 'POST',
    headers: { ...COMMON_HEADERS, 'content-type': 'application/json' },
    body: JSON.stringify({ email: SERIALIZD_EMAIL, password: SERIALIZD_PASSWORD }),
  });
  if (!r.ok) throw new Error(`login failed: ${r.status}`);
  return r.json();
}

async function authedGet(token, urlPath) {
  const url = urlPath.startsWith('http') ? urlPath : `${API}${urlPath}`;
  const r = await fetch(url, {
    headers: { ...COMMON_HEADERS, authorization: `Bearer ${token}` },
  });
  let body = null;
  try {
    body = await r.json();
  } catch {
    try {
      body = await r.text();
    } catch {}
  }
  return { status: r.status, url, body };
}

async function main() {
  const { token, username } = await login();
  console.log('Logged in as', username);

  // Get first page of watched shows to grab a real showId
  const p1 = await authedGet(token, `/user/${SERIALIZD_USERNAME}/watchedpage_v2/1?sort_by=date_added_desc`);
  console.log('Watchedpage status:', p1.status, '— numberOfShows:', p1.body?.numberOfShows, 'totalPages:', p1.body?.totalPages);
  const sample = p1.body?.items?.[0];
  if (!sample) { console.error('No items returned'); process.exit(1); }
  const showId = sample.showId;
  const showName = sample.showName;
  console.log(`Probing endpoints for showId=${showId} (${showName})\n`);

  // Candidate endpoints to probe
  const candidates = [
    `/show/${showId}`,
    `/show/${showId}/user_info`,
    `/show/${showId}/user_data`,
    `/show/${showId}/userdata`,
    `/user/${SERIALIZD_USERNAME}/show/${showId}`,
    `/user/${SERIALIZD_USERNAME}/show/${showId}/info`,
    `/user/${SERIALIZD_USERNAME}/show/${showId}/review`,
    `/user/${SERIALIZD_USERNAME}/show/${showId}/rating`,
    `/user/${SERIALIZD_USERNAME}/reviews`,
    `/user/${SERIALIZD_USERNAME}/reviews/1`,
    `/user/${SERIALIZD_USERNAME}/ratings`,
    `/user/${SERIALIZD_USERNAME}/ratings/1`,
    `/user/${SERIALIZD_USERNAME}/diary`,
    `/user/${SERIALIZD_USERNAME}/diary/1`,
    `/user/${SERIALIZD_USERNAME}/log`,
    `/user/${SERIALIZD_USERNAME}/log/1`,
    `/user/${SERIALIZD_USERNAME}/watched`,
    `/user/${SERIALIZD_USERNAME}/watched/1`,
    `/user/${SERIALIZD_USERNAME}/watchedshows`,
    `/user/${SERIALIZD_USERNAME}/watchedshows/1`,
    `/user/${SERIALIZD_USERNAME}/watchedpage/1`,
    `/review/show/${showId}`,
    `/review/show/${showId}/1`,
    `/review/${SERIALIZD_USERNAME}/${showId}`,
    `/rating/show/${showId}`,
    `/rating/${SERIALIZD_USERNAME}`,
    `/episode_watch/show/${showId}`,
    `/show/${showId}/episodes_watched`,
    `/show/${showId}/user_review`,
    `/show/${showId}/reviews`,
    `/show/${showId}/reviews/1`,
    `/show/${showId}/seasons_watched`,
  ];

  const results = [];
  for (const c of candidates) {
    try {
      const r = await authedGet(token, c);
      const bodyPreview = typeof r.body === 'string' ? r.body.slice(0, 300) : JSON.stringify(r.body).slice(0, 300);
      const bodyKeys = r.body && typeof r.body === 'object' && !Array.isArray(r.body) ? Object.keys(r.body).slice(0, 25) : null;
      const isArray = Array.isArray(r.body);
      results.push({ path: c, status: r.status, isArray, keys: bodyKeys, preview: bodyPreview });
      const tag = r.status === 200 ? 'OK ' : r.status === 404 ? '404' : `${r.status}`;
      console.log(`${tag}  ${c}`);
      if (r.status === 200) {
        console.log('     keys:', bodyKeys, isArray ? `(array len ${r.body.length})` : '');
        console.log('     preview:', bodyPreview.slice(0, 200));
      }
    } catch (e) {
      console.log(`ERR  ${c} — ${e.message}`);
    }
  }

  fs.mkdirSync('captures', { recursive: true });
  fs.writeFileSync(path.join('captures', 'probe-results.json'), JSON.stringify(results, null, 2));
  console.log('\nSaved captures/probe-results.json');
}

main().catch((e) => { console.error(e); process.exit(1); });
