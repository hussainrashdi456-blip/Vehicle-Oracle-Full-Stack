const express = require('express');
const { z } = require('zod');
const Prediction = require('../models/Prediction');
const { requireAuth } = require('../middleware/auth');
const { parseBody } = require('../utils/validate');

const router = express.Router();

const savePredictionSchema = z.object({
  brand: z.string().trim().min(1).max(60),
  model: z.string().trim().min(1).max(80),
  year: z.coerce.number().int().min(1980).max(2100),
  price: z.coerce.number().nonnegative().finite(),
  details: z.record(z.string(), z.unknown()).optional(),
});

// The user comes from the verified token, never from the request body.
router.post('/save-prediction', requireAuth, async (req, res) => {
  const fields = parseBody(savePredictionSchema, req.body);
  await Prediction.create({ ...fields, userId: req.user.id });
  res.status(201).json({ success: true });
});

// The :userId segment is kept so the existing React calls keep working, but you can only read your own history.
router.get('/history/:userId', requireAuth, async (req, res) => {
  if (req.params.userId !== req.user.id) {
    return res.status(403).json({ error: 'You can only view your own history.' });
  }

  const history = await Prediction.find({ userId: req.user.id }).sort({ createdAt: -1 }).limit(100).lean();
  res.json(history);
});

module.exports = router;
