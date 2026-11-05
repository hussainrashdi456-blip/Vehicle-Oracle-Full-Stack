const axios = require('axios');
const config = require('../config');

const aiClient = axios.create({
  baseURL: config.aiApiUrl,
  timeout: config.aiTimeoutMs,
  headers: config.aiApiKey ? { 'X-API-Key': config.aiApiKey } : {},
});

/**
 * FastAPI reports errors as { detail: "message" } for HTTPException, and as
 * { detail: [{ loc, msg, type }, ...] } for request validation (422).
 * Flatten either shape into one readable string.
 */
function readAiDetail(data) {
  const detail = data && data.detail;
  if (typeof detail === 'string') return detail;
  if (!Array.isArray(detail)) return null;

  return detail
    .map((issue) => {
      const field = Array.isArray(issue.loc)
        ? issue.loc.filter((part) => part !== 'body' && part !== 'query').join('.')
        : '';
      return field ? `${field}: ${issue.msg}` : issue.msg;
    })
    .join('; ');
}

/**
 * Turn an axios error from the AI service into a response for our own client.
 *
 *  - FastAPI 4xx (bad input): pass the status and its message through. These are
 *    written for users ("'Zzz' is not a known value for Brand.").
 *  - FastAPI 401/403: that means our API key is wrong, which is our bug, not the user's.
 *  - FastAPI 503: models not loaded yet.
 *  - Other FastAPI 5xx: 502, with details kept in our logs only.
 *  - Timeout: 504. No response at all (service down): 503.
 *
 * The client always receives { error: "..." }, whatever shape FastAPI used.
 */
function sendAiError(res, error, context) {
  if (error.response) {
    const { status, data } = error.response;
    const detail = readAiDetail(data);

    if (status >= 400 && status < 500 && status !== 401 && status !== 403) {
      return res.status(status).json({ error: detail || 'The AI service rejected this request.' });
    }

    console.error(`[AI:${context}] upstream responded ${status}: ${detail || 'no detail'}`);
    if (status === 503) {
      return res.status(503).json({ error: 'The AI service is still starting up. Please try again shortly.' });
    }
    return res.status(502).json({ error: 'The AI service could not process this request.' });
  }

  if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT') {
    console.error(`[AI:${context}] timed out`);
    return res.status(504).json({ error: 'The AI service took too long to respond.' });
  }

  console.error(`[AI:${context}] unreachable: ${error.code || error.message}`);
  return res.status(503).json({ error: 'The AI service is currently unavailable.' });
}

// Dataset-level endpoints (stats, dropdown options, trends) only change when the
// CSV is regenerated, so a short in-memory cache saves a round trip per page view.
const cache = new Map();

async function getCached(path, ttlMs = 10 * 60 * 1000) {
  const hit = cache.get(path);
  if (hit && hit.expiresAt > Date.now()) return hit.data;

  const { data } = await aiClient.get(path);
  cache.set(path, { data, expiresAt: Date.now() + ttlMs });
  return data;
}

module.exports = { aiClient, sendAiError, getCached, clearAiCache: () => cache.clear() };
