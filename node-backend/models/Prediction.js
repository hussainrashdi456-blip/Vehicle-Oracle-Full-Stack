const mongoose = require('mongoose');

const predictionSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    brand: { type: String, required: true, trim: true },
    model: { type: String, required: true, trim: true },
    year: { type: Number, required: true },
    price: { type: Number, required: true, min: 0 },
    details: { type: mongoose.Schema.Types.Mixed },
  },
  { timestamps: true }
);

// History is always read as "this user's predictions, newest first".
predictionSchema.index({ userId: 1, createdAt: -1 });

module.exports = mongoose.model('Prediction', predictionSchema);
