const express = require('express');
const FormData = require('form-data');
const { rateLimit } = require('express-rate-limit');
const { aiClient, sendAiError, getCached } = require('../services/aiClient');
const { memoryUpload } = require('../middleware/upload');

const router = express.Router();

const limiter = (limit, windowMs = 60 * 1000) =>
  rateLimit({
    windowMs,
    limit,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests. Please slow down.' },
  });

// Public on purpose: guests can try a prediction, but only logged-in users can save one.
// Inference is CPU-heavy, so each route gets its own per-IP limit.
router.post('/predict', limiter(30), async (req, res) => {
  try {
    const { data } = await aiClient.post('/predict', req.body);
    res.json(data);
  } catch (error) {
    sendAiError(res, error, 'predict');
  }
});

router.post('/detect-damage', limiter(10), memoryUpload.single('image'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No image uploaded.' });

  const form = new FormData();
  // A fixed filename means nothing the user typed reaches the AI service.
  form.append('file', req.file.buffer, { filename: 'upload', contentType: req.file.mimetype });

  try {
    const { data } = await aiClient.post('/api/detect-damage', form, {
      headers: form.getHeaders(),
      timeout: 45000, // first YOLO run can be slow
    });
    res.json(data);
  } catch (error) {
    sendAiError(res, error, 'detect-damage');
  }
});

router.get('/car-details', async (req, res) => {
  const { brand, model } = req.query; // forward only the keys we know about
  try {
    const { data } = await aiClient.get('/api/car-details', { params: { brand, model } });
    res.json(data);
  } catch (error) {
    sendAiError(res, error, 'car-details');
  }
});

router.get('/market-comparison', async (req, res) => {
  const { brand, model, year } = req.query;
  try {
    const { data } = await aiClient.get('/api/market-comparison', { params: { brand, model, year } });
    res.json(data);
  } catch (error) {
    sendAiError(res, error, 'market-comparison');
  }
});

// Cached dataset endpoints
const cachedRoute = (path, label) => async (req, res) => {
  try {
    res.set('Cache-Control', 'public, max-age=300');
    res.json(await getCached(path));
  } catch (error) {
    res.removeHeader('Cache-Control');
    sendAiError(res, error, label);
  }
};

router.get('/stats', cachedRoute('/api/stats', 'stats'));
router.get('/car-options', cachedRoute('/api/car-options', 'car-options'));
router.get('/trends', cachedRoute('/api/trends', 'trends'));

module.exports = router;
