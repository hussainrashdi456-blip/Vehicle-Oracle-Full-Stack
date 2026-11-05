// Loads .env and validates it once, so a bad setup fails at startup
// instead of on the first login request.
require('dotenv').config();

const missing = ['MONGO_URI', 'JWT_SECRET'].filter((key) => !process.env[key]);
if (missing.length > 0) {
  console.error(`Missing required environment variables: ${missing.join(', ')}`);
  process.exit(1);
}
if (process.env.JWT_SECRET.length < 32) {
  console.error('JWT_SECRET must be at least 32 characters. Generate one with:');
  console.error('  node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'hex\'))"');
  process.exit(1);
}

module.exports = {
  port: Number(process.env.PORT) || 5000,
  mongoUri: process.env.MONGO_URI,
  jwtSecret: process.env.JWT_SECRET,
  // Comma-separated list of frontend origins allowed to call this API.
  clientUrls: (process.env.CLIENT_URL || 'http://localhost:5173')
    .split(',')
    .map((url) => url.trim())
    .filter(Boolean),
  aiApiUrl: process.env.AI_API_URL || 'http://localhost:8000',
  // Must match INTERNAL_API_KEY on the FastAPI side. Optional in local development.
  aiApiKey: process.env.AI_API_KEY || null,
  aiTimeoutMs: Number(process.env.AI_TIMEOUT_MS) || 15000,
  // Set to 1 when deployed behind one reverse proxy (Render, Railway, Nginx...),
  // otherwise every visitor shares the proxy's IP and the rate limiter breaks.
  trustProxy: process.env.TRUST_PROXY ? Number(process.env.TRUST_PROXY) : null,
};
