const prisma = require('../../config/prisma');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const validator = require('validator');

const { JWT_SECRET } = require('../../config/jwt');


// ─────────────────────────────────────────────
// Generate Unique Username
// ─────────────────────────────────────────────
async function generateUsername(fullName) {
  let base = fullName?.toLowerCase().replace(/[^a-z0-9]/g, '') || 'user';
  let username = base;
  let count = 1;

  while (true) {
    const exists = await prisma.user.findUnique({ where: { username } });
    if (!exists) return username;
    username = `${base}${count}`;
    count++;
  }
}


// ─────────────────────────────────────────────
// Register
// POST /api/auth/register
// ─────────────────────────────────────────────
exports.register = async (req, res) => {
  try {
    const { email, password, full_name } = req.body;

    if (!email || !password || !full_name) {
      return res.status(400).json({
        success: false,
        message: 'Email, password and full name are required',
      });
    }

    if (!validator.isEmail(email)) {
      return res.status(400).json({ success: false, message: 'Invalid email format' });
    }

    if (password.length < 6) {
      return res.status(400).json({ success: false, message: 'Password must be at least 6 characters' });
    }

    const existingEmail = await prisma.user.findUnique({
      where: { email: email.toLowerCase() },
    });

    if (existingEmail) {
      return res.status(409).json({ success: false, message: 'Email already registered' });
    }

    const username = await generateUsername(full_name);
    const hashedPassword = await bcrypt.hash(password, 10);

    const user = await prisma.user.create({
      data: {
        email: email.toLowerCase(),
        password: hashedPassword,
        fullName: full_name,
        username,
      },
    });

    const token = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: '30d' });
    const { password: _, ...safeUser } = user;

    return res.status(201).json({
      success: true,
      message: 'Account created successfully',
      token,
      user: safeUser,
    });

  } catch (error) {
    console.error('REGISTER ERROR:', error);
    return res.status(500).json({
      success: false,
      message: 'Something went wrong',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
};


// ─────────────────────────────────────────────
// Login
// POST /api/auth/login
// ─────────────────────────────────────────────
exports.login = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ success: false, message: 'Email and password are required' });
    }

    if (!validator.isEmail(email)) {
      return res.status(400).json({ success: false, message: 'Invalid email format' });
    }

    const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });

    if (!user) {
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }

    const isMatch = await bcrypt.compare(password, user.password);

    if (!isMatch) {
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }

    const token = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: '30d' });
    const { password: _, ...safeUser } = user;

    return res.status(200).json({
      success: true,
      message: 'Login successful',
      token,
      user: safeUser,
    });

  } catch (error) {
    console.error('LOGIN ERROR:', error);
    return res.status(500).json({
      success: false,
      message: 'Something went wrong',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
};


// ─────────────────────────────────────────────
// Get Me
// GET /api/auth/user/me
// ─────────────────────────────────────────────
exports.getMe = async (req, res) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.user.id } });

    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    const { password: _, ...safeUser } = user;

    return res.status(200).json({ success: true, user: safeUser });

  } catch (error) {
    console.error('GET_ME ERROR:', error);
    return res.status(500).json({
      success: false,
      message: 'Something went wrong',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
};


// ─────────────────────────────────────────────
// Update Profile
// PUT /api/auth/user/profile
// ─────────────────────────────────────────────
exports.updateProfile = async (req, res) => {
  try {
    const { full_name, country, city } = req.body;

    const updated = await prisma.user.update({
      where: { id: req.user.id },
      data: {
        ...(full_name !== undefined && { fullName: full_name }),
        ...(country !== undefined && { country }),
        ...(city !== undefined && { city }),
      },
    });

    const { password: _, ...safeUser } = updated;

    return res.status(200).json({ success: true, message: 'Profile updated', user: safeUser });

  } catch (error) {
    console.error('UPDATE_PROFILE ERROR:', error);
    return res.status(500).json({
      success: false,
      message: 'Something went wrong',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
};


// ─────────────────────────────────────────────
// Change Username
// PATCH /api/auth/user/username
// ─────────────────────────────────────────────
exports.changeUsername = async (req, res) => {
  try {
    const { username } = req.body;

    if (!username) {
      return res.status(400).json({ success: false, message: 'Username is required' });
    }

    const sanitized = username.toLowerCase().replace(/[^a-z0-9_]/g, '');

    if (sanitized.length < 3) {
      return res.status(400).json({ success: false, message: 'Username must be at least 3 characters' });
    }

    const existing = await prisma.user.findUnique({ where: { username: sanitized } });

    if (existing && existing.id !== req.user.id) {
      return res.status(409).json({ success: false, message: 'Username already taken' });
    }

    const updated = await prisma.user.update({
      where: { id: req.user.id },
      data: { username: sanitized },
    });

    const { password: _, ...safeUser } = updated;

    return res.status(200).json({ success: true, message: 'Username updated', user: safeUser });

  } catch (error) {
    console.error('CHANGE_USERNAME ERROR:', error);
    return res.status(500).json({
      success: false,
      message: 'Something went wrong',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
};
