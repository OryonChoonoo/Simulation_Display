/* The shared leaderboard.
 *
 * GET  returns the top attempts.
 * POST adds one and returns the new list.
 *
 * It runs on Netlify and keeps its list in Netlify Blobs, so there is no
 * database to run and no key in the page. The page falls back to a board kept
 * in the visitor's own browser whenever this cannot be reached, which is what
 * happens if the Open Day laptop is offline.
 *
 * This is a public write endpoint with no account behind it: anyone who finds
 * the URL can post to it. Names are capped and stripped of anything but plain
 * characters, the list is capped at twenty, and entries are small. If it is
 * ever abused, delete the blob and it starts again empty.
 */

import { getStore } from '@netlify/blobs';

const KEY = 'board';
const MAX_ENTRIES = 20;

function clean(entry) {
  const name = String(entry && entry.name || '')
    .replace(/[^\p{L}\p{N} .'-]/gu, '')     // letters, numbers and a little punctuation
    .trim()
    .slice(0, 14) || 'anonymous';
  const number = (value, lo, hi) => {
    const n = Number(value);
    return Number.isFinite(n) ? Math.min(Math.max(n, lo), hi) : lo;
  };
  return {
    name,
    seconds: number(entry && entry.seconds, 0, 3600),
    percent: number(entry && entry.percent, 0, 100),
    step: Math.round(number(entry && entry.step, 1, 999)),
    rpm: Math.round(number(entry && entry.rpm, 0, 100000)),
    at: new Date().toISOString(),
  };
}

export default async function handler(request) {
  const store = getStore('leaderboard');
  const headers = {
    'content-type': 'application/json',
    'cache-control': 'no-store',
    'access-control-allow-origin': '*',
    'access-control-allow-headers': 'content-type',
    'access-control-allow-methods': 'GET,POST,OPTIONS',
  };

  if (request.method === 'OPTIONS') return new Response('', { status: 204, headers });

  // Wiping the board needs a key set on the site, so it can be emptied before
  // Open Day without anyone who finds the URL being able to do the same. With
  // no key set, nothing can be deleted at all.
  if (request.method === 'DELETE') {
    const key = process.env.BOARD_KEY;
    const given = request.headers.get('x-board-key');
    if (!key || given !== key) {
      return new Response(JSON.stringify({ error: 'not allowed' }), { status: 403, headers });
    }
    await store.setJSON(KEY, []);
    return new Response(JSON.stringify({ list: [] }), { status: 200, headers });
  }

  let list = [];
  try {
    list = (await store.get(KEY, { type: 'json' })) || [];
    if (!Array.isArray(list)) list = [];
  } catch {
    list = [];                                 // first run, before anything is stored
  }

  if (request.method === 'POST') {
    let body = null;
    try { body = await request.json(); } catch { body = null; }
    if (!body) return new Response(JSON.stringify({ error: 'bad request' }), { status: 400, headers });
    list.push(clean(body));
    list.sort((a, b) => b.seconds - a.seconds);
    list = list.slice(0, MAX_ENTRIES);
    await store.setJSON(KEY, list);
  }

  return new Response(JSON.stringify({ list }), { status: 200, headers });
}
