const express = require('express');
const router = express.Router();
const { getDb } = require('../database');

// Get all crisis locations for map
router.get('/crisis-locations', async (req, res) => {
  const db = getDb();
  
  try {
    // Get all active requests with location data
    const activeCrises = db.prepare(`
      SELECT 
        r.request_id,
        r.user_id,
        r.latitude,
        r.longitude,
        r.location_text,
        r.urgency,
        r.status,
        r.created_at,
        u.name as user_name,
        u.profile_icon,
        (SELECT GROUP_CONCAT(category) FROM request_categories WHERE request_id = r.request_id) as categories
      FROM emergency_requests r
      JOIN users u ON r.user_id = u.id
      WHERE r.status = 'active' 
        AND r.latitude IS NOT NULL 
        AND r.longitude IS NOT NULL
    `).all();
    
    // Get resolved requests from last 24 hours
    const recentResolved = db.prepare(`
      SELECT 
        r.request_id,
        r.user_id,
        r.latitude,
        r.longitude,
        r.location_text,
        r.urgency,
        r.status,
        r.resolved_at,
        u.name as user_name,
        u.profile_icon,
        (SELECT GROUP_CONCAT(category) FROM request_categories WHERE request_id = r.request_id) as categories
      FROM emergency_requests r
      JOIN users u ON r.user_id = u.id
      WHERE r.status = 'resolved' 
        AND r.latitude IS NOT NULL 
        AND r.longitude IS NOT NULL
        AND r.resolved_at >= datetime('now', '-24 hours')
    `).all();
    
    res.json({
      success: true,
      active_crises: activeCrises,
      recent_resolved: recentResolved,
      total_active: activeCrises.length
    });
  } catch (error) {
    console.error('Error fetching crisis locations:', error);
    res.status(500).json({ error: 'Failed to fetch crisis locations' });
  }
});

// Get user location
router.get('/user-location/:user_id', async (req, res) => {
  const { user_id } = req.params;
  const db = getDb();
  
  try {
    const user = db.prepare('SELECT id, name, latitude, longitude, neighborhood, profile_icon FROM users WHERE id = ?').get(user_id);
    
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    res.json({
      success: true,
      user: {
        id: user.id,
        name: user.name,
        latitude: user.latitude,
        longitude: user.longitude,
        neighborhood: user.neighborhood,
        profile_icon: user.profile_icon
      }
    });
  } catch (error) {
    console.error('Error fetching user location:', error);
    res.status(500).json({ error: 'Failed to fetch user location' });
  }
});

// Update user location (for real-time tracking)
router.post('/update-location', async (req, res) => {
  const { user_id, latitude, longitude } = req.body;
  const db = getDb();
  
  try {
    db.prepare('UPDATE users SET latitude = ?, longitude = ?, last_seen = CURRENT_TIMESTAMP WHERE id = ?')
      .run(latitude, longitude, user_id);
    
    res.json({ success: true });
  } catch (error) {
    console.error('Error updating location:', error);
    res.status(500).json({ error: 'Failed to update location' });
  }
});

module.exports = router;
