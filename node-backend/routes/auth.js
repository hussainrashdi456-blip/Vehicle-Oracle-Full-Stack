const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { rateLimit } = require('express-rate-limit');
const { z } = require('zod');
const config = require('../config');
const User = require('../models/User');
const { parseBody } = require('../utils/validate');

const router = express.Router();

const BCRYPT_ROUNDS = 12;

// Strings only. Without this, a JSON body like { "email": { "$ne": null } } would be
// passed to Mongo as a query operator (NoSQL injection).
const emailField = z.string().trim().toLowerCase().pipe(z.email('Enter a valid email address.'));

const signupSchema = z.object({
  name: z.string().trim().min(2, 'Name is too short.').max(60),
  email: emailField,
  // bcrypt only uses the first 72 bytes, so longer passwords add nothing.
  password: z.string().min(8, 'Password must be at least 8 characters.').max(72),
});

const loginSchema = z.object({
  email: emailField,
  password: z.string().min(1).max(72),
});

const authLimiter = (options) =>
  rateLimit({
    windowMs: 15 * 60 * 1000,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many attempts. Please try again in 15 minutes.' },
    ...options,
  });

const signToken = (user) =>
  jwt.sign({ id: user._id }, config.jwtSecret, { expiresIn: '7d', algorithm: 'HS256' });

const publicUser = (user) => ({ id: user._id, name: user.name, email: user.email, role: user.role });

router.post('/signup', authLimiter({ limit: 20 }), async (req, res) => {
  const { name, email, password } = parseBody(signupSchema, req.body);
  const hashedPassword = await bcrypt.hash(password, BCRYPT_ROUNDS);

  let user;
  try {
    user = await User.create({ name, email, password: hashedPassword });
  } catch (err) {
    // The unique index decides, so two simultaneous signups can't both succeed.
    if (err.code === 11000) return res.status(409).json({ error: 'Email already exists.' });
    throw err;
  }

  res.status(201).json({ token: signToken(user), user: publicUser(user) });
});

router.post('/login', authLimiter({ limit: 10, skipSuccessfulRequests: true }), async (req, res) => {
  const { email, password } = parseBody(loginSchema, req.body);

  const user = await User.findOne({ email }).select('+password');
  const passwordMatches = user && (await bcrypt.compare(password, user.password));
  // Same message for "no such user" and "wrong password" so the form can't be used to find emails.
  if (!passwordMatches) return res.status(401).json({ error: 'Invalid email or password.' });

  res.json({ token: signToken(user), user: publicUser(user) });
});

module.exports = router;
