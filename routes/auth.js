const express = require('express');
const router = express.Router();
const { getDb } = require('../database');

router.post('/register', async (req, res) => {
  const { phone_number, name, neighborhood, zip_code, latitude, longitude, profile_icon } = req.body;
  
  if (!phone_number || !name || !neighborhood) {
    return res.status(400).json({ error: 'Phone, name, and neighborhood required' });
  }
  
  const db = getDb();
  
  try {
    const existing = db.prepare('SELECT * FROM users WHERE phone_number = ?').get(phone_number);
    
    if (existing) {
      db.prepare('UPDATE users SET last_seen = CURRENT_TIMESTAMP WHERE phone_number = ?').run(phone_number);
      return res.json({ success: true, user: existing, message: 'Welcome back!' });
    }
    
    const stmt = db.prepare(`
      INSERT INTO users (phone_number, name, neighborhood, zip_code, latitude, longitude, profile_icon)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    const result = stmt.run(phone_number, name, neighborhood, zip_code, latitude || null, longitude || null, profile_icon || '🍎');
    
    const newUser = db.prepare('SELECT * FROM users WHERE id = ?').get(result.lastInsertRowid);
    
    res.json({ success: true, user: newUser, message: 'Registration successful' });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ error: 'Registration failed: ' + error.message });
  }
});

router.post('/update-profile', async (req, res) => {
  const { user_id, profile_icon, name, neighborhood } = req.body;
  const db = getDb();
  
  try {
    if (profile_icon) {
      db.prepare('UPDATE users SET profile_icon = ? WHERE id = ?').run(profile_icon, user_id);
    }
    if (name) {
      db.prepare('UPDATE users SET name = ? WHERE id = ?').run(name, user_id);
    }
    if (neighborhood) {
      db.prepare('UPDATE users SET neighborhood = ? WHERE id = ?').run(neighborhood, user_id);
    }
    
    const updatedUser = db.prepare('SELECT * FROM users WHERE id = ?').get(user_id);
    res.json({ success: true, user: updatedUser });
  } catch (error) {
    console.error('Profile update error:', error);
    res.status(500).json({ error: 'Failed to update profile' });
  }
});

router.get('/user/:id', async (req, res) => {
  const db = getDb();
  const user = db.prepare('SELECT id, name, phone_number, neighborhood, latitude, longitude, profile_icon, is_active FROM users WHERE id = ?').get(req.params.id);
  
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json(user);
});

router.get('/my-requests/:user_id', async (req, res) => {
  const { user_id } = req.params;
  const db = getDb();
  
  const requests = db.prepare(`
    SELECT r.*, 
      (SELECT GROUP_CONCAT(category) FROM request_categories WHERE request_id = r.request_id) as categories
    FROM emergency_requests r
    WHERE r.user_id = ? AND r.status != 'resolved'
    ORDER BY r.created_at DESC
  `).all(user_id);
  
  res.json(requests);
});

router.put('/location', async (req, res) => {
  const { user_id, latitude, longitude } = req.body;
  const db = getDb();
  db.prepare('UPDATE users SET latitude = ?, longitude = ?, last_seen = CURRENT_TIMESTAMP WHERE id = ?').run(latitude, longitude, user_id);
  res.json({ success: true });
});

module.exports = router;
