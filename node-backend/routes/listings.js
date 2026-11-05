const fs = require('fs');
const express = require('express');
const { z } = require('zod');
const Listing = require('../models/Listing');
const { requireAuth } = require('../middleware/auth');
const { diskUpload } = require('../middleware/upload');
const { parseBody } = require('../utils/validate');

const router = express.Router();

const listingSchema = z.object({
  title: z.string().trim().min(3).max(100),
  price: z.coerce.number().positive().max(1_000_000_000),
  year: z.coerce.number().int().min(1980).max(2100),
  city: z.string().trim().min(2).max(60),
  description: z.string().trim().max(2000).optional(),
});

router.post('/', requireAuth, diskUpload.single('image'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'An image is required.' });

  try {
    const fields = parseBody(listingSchema, req.body);
    const listing = await Listing.create({
      ...fields,
      imageUrl: `/uploads/${req.file.filename}`,
      userId: req.user.id,
    });
    res.status(201).json({ success: true, listing });
  } catch (err) {
    // Don't leave an orphaned image on disk when the listing is rejected.
    await fs.promises.unlink(req.file.path).catch(() => {});
    throw err;
  }
});

// Returns a plain array like before. Use ?page=2&limit=20 to paginate; the total is in the X-Total-Count header.
router.get('/', async (req, res) => {
  const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 100);

  const [listings, total] = await Promise.all([
    Listing.find().sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
    Listing.countDocuments(),
  ]);

  res.set('X-Total-Count', String(total));
  res.json(listings);
});

module.exports = router;
