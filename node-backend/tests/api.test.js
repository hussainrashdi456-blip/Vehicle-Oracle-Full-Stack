// Run with: npm test
// No MongoDB or FastAPI needed: the models are stubbed and a tiny fake AI server stands in for FastAPI.
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const fs = require('fs');
const path = require('path');
const jwt = require('jsonwebtoken');

const JWT_SECRET = 'x'.repeat(40);
let fakeAi; // what the fake FastAPI should answer next
let fakeAiServer;

process.env.MONGO_URI = 'mongodb://unused';
process.env.JWT_SECRET = JWT_SECRET;
process.env.AI_TIMEOUT_MS = '300';
process.env.CLIENT_URL = 'http://localhost:5173';

const request = require('supertest');
const app = require('../server');
const User = require('../models/User');
const Prediction = require('../models/Prediction');
const Listing = require('../models/Listing');
const { aiClient, clearAiCache } = require('../services/aiClient');
const { uploadDir } = require('../middleware/upload');

const tokenFor = (id) => jwt.sign({ id }, JWT_SECRET, { expiresIn: '1h', algorithm: 'HS256' });
const chain = (result) => {
  const q = { sort: () => q, skip: () => q, limit: () => q, select: () => q, lean: async () => result };
  return q;
};
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64'
);

before(async () => {
  fakeAiServer = http.createServer((req, res) => {
    req.resume();
    req.on('end', () => {
      if (fakeAi.hang) return; // never answer, to trigger the timeout
      res.writeHead(fakeAi.status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(fakeAi.body));
    });
  });
  await new Promise((resolve) => fakeAiServer.listen(0, resolve));
  aiClient.defaults.baseURL = `http://127.0.0.1:${fakeAiServer.address().port}`;
});

after(async () => {
  fakeAiServer.closeAllConnections?.();
  await new Promise((resolve) => fakeAiServer.close(resolve));
});

beforeEach(() => {
  fakeAi = { status: 200, body: { ok: true } };
  clearAiCache();
});

// ---------------------------------------------------------------- FastAPI error mapping

test('predict: success is passed through', async () => {
  fakeAi.body = { price: 1234567, explanation: {} };
  const res = await request(app).post('/api/predict').send({ Brand: 'Toyota' });
  assert.equal(res.status, 200);
  assert.equal(res.body.price, 1234567);
});

test('predict: FastAPI validation errors (detail is an array) become one readable message', async () => {
  fakeAi = {
    status: 422,
    body: { detail: [{ type: 'greater_than_equal', loc: ['body', 'mileage'], msg: 'Input should be greater than or equal to 0' }] },
  };
  const res = await request(app).post('/api/predict').send({});
  assert.equal(res.status, 422);
  assert.equal(res.body.error, 'mileage: Input should be greater than or equal to 0');
});

test('predict: FastAPI detail string (unknown brand) is shown to the user', async () => {
  fakeAi = { status: 422, body: { detail: "'Zzz' is not a known value for Brand." } };
  const res = await request(app).post('/api/predict').send({});
  assert.equal(res.status, 422);
  assert.equal(res.body.error, "'Zzz' is not a known value for Brand.");
});

test('predict: FastAPI 503 does not leak internal details', async () => {
  fakeAi = { status: 503, body: { detail: 'Missing model files: x.pkl. Run run_pipeline.py first.' } };
  const res = await request(app).post('/api/predict').send({});
  assert.equal(res.status, 503);
  assert.ok(!JSON.stringify(res.body).includes('run_pipeline'));
});

test('predict: FastAPI 500 becomes 502', async () => {
  fakeAi = { status: 500, body: { detail: 'Price prediction failed.' } };
  assert.equal((await request(app).post('/api/predict').send({})).status, 502);
});

test('predict: FastAPI 401 (wrong API key) is our problem, so 502 and not a logout for the user', async () => {
  fakeAi = { status: 401, body: { detail: 'Invalid or missing API key.' } };
  assert.equal((await request(app).post('/api/predict').send({})).status, 502);
});

test('predict: slow AI service gives 504', async () => {
  fakeAi.hang = true;
  assert.equal((await request(app).post('/api/predict').send({})).status, 504);
});

test('predict: AI service down gives 503', async () => {
  const original = aiClient.defaults.baseURL;
  aiClient.defaults.baseURL = 'http://127.0.0.1:1';
  const res = await request(app).post('/api/predict').send({});
  aiClient.defaults.baseURL = original;
  assert.equal(res.status, 503);
});

test('stats are cached between requests', async () => {
  fakeAi.body = { total_cars: 1 };
  await request(app).get('/api/stats');
  fakeAi.status = 500; // would fail if the cache were not used
  const res = await request(app).get('/api/stats');
  assert.equal(res.status, 200);
  assert.equal(res.body.total_cars, 1);
});

// ---------------------------------------------------------------- damage upload

test('detect-damage: rejects non-images with 415', async () => {
  const res = await request(app).post('/api/detect-damage').attach('image', Buffer.from('hi'), { filename: 'a.html', contentType: 'text/html' });
  assert.equal(res.status, 415);
});

test('detect-damage: rejects files over 5 MB with 413', async () => {
  const big = Buffer.alloc(5 * 1024 * 1024 + 10);
  const res = await request(app).post('/api/detect-damage').attach('image', big, { filename: 'a.png', contentType: 'image/png' });
  assert.equal(res.status, 413);
});

test('detect-damage: forwards a valid image and passes on a FastAPI 400', async () => {
  fakeAi.body = { damage_detected: false, detections: [] };
  const ok = await request(app).post('/api/detect-damage').attach('image', PNG, { filename: 'a.png', contentType: 'image/png' });
  assert.equal(ok.status, 200);

  fakeAi = { status: 400, body: { detail: 'That file could not be read as an image.' } };
  const bad = await request(app).post('/api/detect-damage').attach('image', PNG, { filename: 'a.png', contentType: 'image/png' });
  assert.equal(bad.status, 400);
  assert.equal(bad.body.error, 'That file could not be read as an image.');
});

// ---------------------------------------------------------------- auth and authorization

test('signup: rejects NoSQL-injection style input and weak passwords', async () => {
  const injected = await request(app).post('/api/auth/signup').send({ name: 'Ali', email: { $ne: null }, password: 'password123' });
  assert.equal(injected.status, 400);
  const weak = await request(app).post('/api/auth/signup').send({ name: 'Ali', email: 'ali@example.com', password: 'short' });
  assert.equal(weak.status, 400);
});

test('login: operator objects are rejected before reaching the database', async () => {
  const res = await request(app).post('/api/auth/login').send({ email: { $gt: '' }, password: 'x' });
  assert.equal(res.status, 400);
});

test('signup: duplicate email gives 409', async () => {
  User.create = async () => { const e = new Error('dup'); e.code = 11000; throw e; };
  const res = await request(app).post('/api/auth/signup').send({ name: 'Ali', email: 'ali@example.com', password: 'password123' });
  assert.equal(res.status, 409);
});

test('signup then login round trip returns a token', async () => {
  let stored;
  User.create = async (doc) => (stored = { _id: 'u1', role: 'user', ...doc });
  const signup = await request(app).post('/api/auth/signup').send({ name: 'Ali', email: 'ALI@Example.com', password: 'password123' });
  assert.equal(signup.status, 201);
  assert.equal(stored.email, 'ali@example.com'); // normalised
  assert.notEqual(stored.password, 'password123'); // hashed

  User.findOne = () => chain(null);
  User.findOne = () => ({ select: async () => stored });
  const login = await request(app).post('/api/auth/login').send({ email: 'ali@example.com', password: 'password123' });
  assert.equal(login.status, 200);
  assert.ok(login.body.token);
  const wrong = await request(app).post('/api/auth/login').send({ email: 'ali@example.com', password: 'wrongpass1' });
  assert.equal(wrong.status, 401);
});

test('history: needs a token and only returns your own', async () => {
  Prediction.find = () => chain([{ brand: 'Toyota' }]);
  assert.equal((await request(app).get('/api/history/u1')).status, 401);
  assert.equal((await request(app).get('/api/history/u2').set('Authorization', `Bearer ${tokenFor('u1')}`)).status, 403);
  const own = await request(app).get('/api/history/u1').set('Authorization', `Bearer ${tokenFor('u1')}`);
  assert.equal(own.status, 200);
});

test('tokens signed with another secret or the "none" algorithm are rejected', async () => {
  const forged = jwt.sign({ id: 'u1' }, 'some-other-secret-some-other-secret-1234');
  assert.equal((await request(app).get('/api/history/u1').set('Authorization', `Bearer ${forged}`)).status, 401);
  const none = `${Buffer.from('{"alg":"none","typ":"JWT"}').toString('base64url')}.${Buffer.from('{"id":"u1"}').toString('base64url')}.`;
  assert.equal((await request(app).get('/api/history/u1').set('Authorization', `Bearer ${none}`)).status, 401);
});

test('save-prediction: needs a token, validates input, uses the token user', async () => {
  let saved;
  Prediction.create = async (doc) => (saved = doc);
  const body = { brand: 'Toyota', model: 'Corolla', year: 2018, price: 3500000, details: { fuel: 'Petrol' } };
  assert.equal((await request(app).post('/api/save-prediction').send(body)).status, 401);
  const auth = { Authorization: `Bearer ${tokenFor('u1')}` };
  assert.equal((await request(app).post('/api/save-prediction').set(auth).send({ ...body, price: 'abc' })).status, 400);
  const ok = await request(app).post('/api/save-prediction').set(auth).send({ ...body, userId: 'someone-else' });
  assert.equal(ok.status, 201);
  assert.equal(saved.userId, 'u1');
});

test('admin stats: public access gone, non-admins blocked, admins allowed', async () => {
  User.countDocuments = async () => 3;
  Listing.countDocuments = async () => 2;
  Prediction.countDocuments = async () => 9;
  Prediction.aggregate = async () => [{ _id: 'Toyota', count: 5 }];
  User.find = () => chain([{ name: 'Ali', email: 'a@x.com', createdAt: new Date() }]);
  Prediction.find = () => chain([{ brand: 'Toyota', model: 'Corolla', price: 1, createdAt: new Date() }]);

  assert.equal((await request(app).get('/api/admin/stats')).status, 401);

  User.findById = () => chain({ role: 'user' });
  assert.equal((await request(app).get('/api/admin/stats').set('Authorization', `Bearer ${tokenFor('u1')}`)).status, 403);

  User.findById = () => chain({ role: 'admin' });
  const res = await request(app).get('/api/admin/stats').set('Authorization', `Bearer ${tokenFor('u1')}`);
  assert.equal(res.status, 200);
  assert.equal(res.body.totalUsers, 3);
});

// ---------------------------------------------------------------- listings

test('listings: create needs login, only accepts images, stores a random filename', async () => {
  Listing.create = async (doc) => ({ _id: 'l1', ...doc });
  const auth = { Authorization: `Bearer ${tokenFor('u1')}` };
  const fields = { title: 'Corolla 2018', price: '3500000', year: '2018', city: 'Karachi' };

  assert.equal((await request(app).post('/api/listings').field(fields).attach('image', PNG, { filename: 'a.png', contentType: 'image/png' })).status, 401);

  const html = await request(app).post('/api/listings').set(auth).field(fields).attach('image', Buffer.from('<script>1</script>'), { filename: 'x.html', contentType: 'text/html' });
  assert.equal(html.status, 415);

  const ok = await request(app).post('/api/listings').set(auth).field(fields).attach('image', PNG, { filename: '../../evil name.png', contentType: 'image/png' });
  assert.equal(ok.status, 201);
  assert.match(ok.body.listing.imageUrl, /^\/uploads\/[0-9a-f-]{36}\.png$/);
  assert.equal(ok.body.listing.userId, 'u1');
  fs.unlinkSync(path.join(uploadDir, path.basename(ok.body.listing.imageUrl)));
});

test('listings: a rejected listing does not leave its image on disk', async () => {
  const before = fs.readdirSync(uploadDir).length;
  const auth = { Authorization: `Bearer ${tokenFor('u1')}` };
  const res = await request(app).post('/api/listings').set(auth).field({ title: 'x', price: '-5', year: '2018', city: 'K' }).attach('image', PNG, { filename: 'a.png', contentType: 'image/png' });
  assert.equal(res.status, 400);
  assert.equal(fs.readdirSync(uploadDir).length, before);
});

test('listings: list is paginated and reports the total in a header', async () => {
  Listing.find = () => chain([{ title: 'a' }]);
  Listing.countDocuments = async () => 42;
  const res = await request(app).get('/api/listings?page=2&limit=500');
  assert.equal(res.status, 200);
  assert.ok(Array.isArray(res.body));
  assert.equal(res.headers['x-total-count'], '42');
});

// ---------------------------------------------------------------- hardening

test('CORS only allows the configured frontend', async () => {
  const allowed = await request(app).get('/api/stats').set('Origin', 'http://localhost:5173');
  assert.equal(allowed.headers['access-control-allow-origin'], 'http://localhost:5173');
  const evil = await request(app).get('/api/stats').set('Origin', 'https://evil.example');
  assert.equal(evil.headers['access-control-allow-origin'], undefined);
});

test('security headers, JSON 404 and malformed JSON handling', async () => {
  const res = await request(app).get('/api/nope');
  assert.equal(res.status, 404);
  assert.equal(res.headers['x-content-type-options'], 'nosniff');
  assert.equal(res.headers['x-powered-by'], undefined);
  const bad = await request(app).post('/api/predict').set('Content-Type', 'application/json').send('{not json');
  assert.equal(bad.status, 400);
});

test('oversized JSON bodies are refused', async () => {
  const res = await request(app).post('/api/predict').send({ blob: 'a'.repeat(200 * 1024) });
  assert.equal(res.status, 413);
});
