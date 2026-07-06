const express = require('express');
const router = express.Router();
const { getDb } = require('../database');

// Get dashboard statistics
router.get('/dashboard', async (req, res) => {
  const db = getDb();
  
  try {
    // Get total active requests
    const activeRequests = db.prepare(`
      SELECT COUNT(*) as count 
      FROM emergency_requests 
      WHERE status = 'active'
    `).get();
    
    // Get urgent requests count
    const urgentRequests = db.prepare(`
      SELECT COUNT(*) as count 
      FROM emergency_requests 
      WHERE status = 'active' AND urgency = 'urgent'
    `).get();
    
    // Get requests by category
    const requestsByCategory = db.prepare(`
      SELECT category, COUNT(*) as count
      FROM request_categories rc
      JOIN emergency_requests r ON rc.request_id = r.request_id
      WHERE r.status = 'active'
      GROUP BY category
    `).all();
    
    // Get active responders count (users who have accepted requests)
    const activeResponders = db.prepare(`
      SELECT COUNT(DISTINCT responder_id) as count
      FROM active_matches
      WHERE status = 'active'
    `).get();
    
    // Get total people helped (resolved requests in last 24 hours)
    const helpedToday = db.prepare(`
      SELECT COUNT(*) as count
      FROM emergency_requests
      WHERE status = 'resolved' 
        AND resolved_at >= datetime('now', '-24 hours')
    `).get();
    
    // Get average response time (in minutes)
    const avgResponseTime = db.prepare(`
      SELECT AVG(
        (julianday(created_at) - julianday(resolved_at)) * 24 * 60
      ) as avg_minutes
      FROM emergency_requests
      WHERE status = 'resolved' 
        AND resolved_at IS NOT NULL
        AND created_at IS NOT NULL
    `).get();
    
    res.json({
      success: true,
      stats: {
        active_requests: activeRequests.count || 0,
        urgent_requests: urgentRequests.count || 0,
        requests_by_category: requestsByCategory,
        active_responders: activeResponders.count || 0,
        helped_today: helpedToday.count || 0,
        avg_response_time: Math.round(avgResponseTime.avg_minutes) || 0
      }
    });
  } catch (error) {
    console.error('Error fetching stats:', error);
    res.status(500).json({ error: 'Failed to fetch statistics' });
  }
});

// Get real-time updates for dashboard
router.get('/realtime/:user_id', async (req, res) => {
  const { user_id } = req.params;
  const db = getDb();
  
  try {
    // Get nearby active requests count (within 5km if location available)
    const user = db.prepare('SELECT latitude, longitude FROM users WHERE id = ?').get(user_id);
    
    let nearbyCount = 0;
    if (user && user.latitude && user.longitude) {
      const nearby = db.prepare(`
        SELECT COUNT(*) as count
        FROM emergency_requests r
        WHERE r.status = 'active'
          AND r.user_id != ?
          AND r.latitude IS NOT NULL
          AND r.longitude IS NOT NULL
          AND (6371 * acos(cos(radians(?)) * cos(radians(r.latitude)) * 
               cos(radians(r.longitude) - radians(?)) + sin(radians(?)) * 
               sin(radians(r.latitude)))) < 5
      `).get(user_id, user.latitude, user.longitude, user.latitude);
      nearbyCount = nearby.count || 0;
    }
    
    // Get user's active chats count
    const activeChats = db.prepare(`
      SELECT COUNT(*) as count
      FROM active_matches
      WHERE (requester_id = ? OR responder_id = ?)
        AND status = 'active'
    `).get(user_id, user_id);
    
    res.json({
      success: true,
      nearby_requests: nearbyCount,
      active_chats: activeChats.count || 0
    });
  } catch (error) {
    console.error('Error fetching realtime stats:', error);
    res.status(500).json({ error: 'Failed to fetch realtime stats' });
  }
});

module.exports = router;
