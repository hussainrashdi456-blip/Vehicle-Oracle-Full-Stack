const mongoose = require('mongoose');

const listingSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true, maxlength: 100 },
    price: { type: Number, required: true, min: 1 },
    year: { type: Number, required: true, min: 1980 },
    city: { type: String, required: true, trim: true, maxlength: 60 },
    description: { type: String, trim: true, maxlength: 2000 },
    imageUrl: { type: String, required: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true }
);

listingSchema.index({ createdAt: -1 });

module.exports = mongoose.model('Listing', listingSchema);
