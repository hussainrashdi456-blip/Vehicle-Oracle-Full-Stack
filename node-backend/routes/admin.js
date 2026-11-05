const express = require('express');
const User = require('../models/User');
const Listing = require('../models/Listing');
const Prediction = require('../models/Prediction');
const { requireAuth, requireAdmin } = require('../middleware/auth');

const router = express.Router();

router.get('/stats', requireAuth, requireAdmin, async (req, res) => {
  // Independent queries, so run them in parallel instead of one after another.
  const [totalUsers, totalListings, totalPredictions, brandStats, recentUsers, recentPredictions] =
    await Promise.all([
      User.countDocuments(),
      Listing.countDocuments(),
      Prediction.countDocuments(),
      Prediction.aggregate([
        { $group: { _id: '$brand', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 5 },
      ]),
      User.find().sort({ createdAt: -1 }).limit(5).select('name email createdAt').lean(),
      Prediction.find().sort({ createdAt: -1 }).limit(5).select('brand model price createdAt').lean(),
    ]);

  res.json({
    totalUsers,
    totalListings,
    totalPredictions,
    brandStats: brandStats.map((row) => ({ name: row._id, count: row.count })),
    recentUsers: recentUsers.map((u) => ({ name: u.name, email: u.email, date: u.createdAt })),
    recentPredictions: recentPredictions.map((p) => ({
      car: `${p.brand} ${p.model}`,
      price: p.price,
      date: p.createdAt,
    })),
  });
});

module.exports = router;
