const mongoose = require('mongoose');

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 60 },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    // select: false keeps the hash out of every query unless asked for with .select('+password')
    password: { type: String, required: true, select: false },
    // Promote an admin by hand: db.users.updateOne({ email: "you@x.com" }, { $set: { role: "admin" } })
    role: { type: String, enum: ['user', 'admin'], default: 'user' },
  },
  { timestamps: true }
);

module.exports = mongoose.model('User', userSchema);
