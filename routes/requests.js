const express = require('express');
const router = express.Router();
const { getDb } = require('../database');
const { broadcastRequest, notifyResponders } = require('../socket');

function generateRequestId() {
  const random = Math.floor(Math.random() * 900 + 100);
  const timestamp = Date.now().toString().slice(-6);
  return `R${random}${timestamp}`;
}

// Create emergency request
router.post('/create', async (req, res) => {
  const { user_id, categories, latitude, longitude, location_text, urgency = 'urgent' } = req.body;
  
  console.log('📢 Received emergency request:', { user_id, categories, location_text, urgency });
  
  // Validate required fields
  if (!user_id) {
    return res.status(400).json({ error: 'User ID is required' });
  }
  
  if (!categories || !Array.isArray(categories) || categories.length === 0) {
    return res.status(400).json({ error: 'At least one category is required' });
  }
  
  const db = getDb();
  const request_id = generateRequestId();
  
  try {
    // Get user info
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(user_id);
    if (!user) {
      console.error('User not found:', user_id);
      return res.status(404).json({ error: 'User not found' });
    }
    
    // Use provided location or fallback to user's saved location
    const finalLat = latitude || user.latitude;
    const finalLng = longitude || user.longitude;
    const finalLocationText = location_text || user.neighborhood;
    
    console.log('Creating request:', request_id, 'for user:', user.name);
    
    // Insert the request
    const stmt = db.prepare(`
      INSERT INTO emergency_requests (
        request_id, user_id, request_type, latitude, longitude, location_text, urgency, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'active')
    `);
    stmt.run(request_id, user_id, categories[0], finalLat, finalLng, finalLocationText, urgency);
    
    // Insert categories
    const catStmt = db.prepare('INSERT INTO request_categories (request_id, category) VALUES (?, ?)');
    for (const category of categories) {
      catStmt.run(request_id, category);
    }
    
    // Find nearby responders
    let nearbyResponders = [];
    if (finalLat && finalLng) {
      const responders = db.prepare(`
        SELECT id, name, phone_number, latitude, longitude
        FROM users
        WHERE id != ? AND is_active = 1 AND latitude IS NOT NULL AND longitude IS NOT NULL
      `).all(user_id);
      
      nearbyResponders = responders.map(responder => {
        const distance = calculateDistance(finalLat, finalLng, responder.latitude, responder.longitude);
        return { ...responder, distance };
      }).filter(r => r.distance < 5).sort((a, b) => a.distance - b.distance);
    }
    
    // Create request object for broadcasting
    const newRequest = { 
      request_id, 
      user_id, 
      categories, 
      latitude: finalLat, 
      longitude: finalLng, 
      location_text: finalLocationText, 
      urgency, 
      user_name: user.name,
      user_icon: user.profile_icon || '🍎'
    };
    
    // Broadcast via WebSocket
    console.log('Broadcasting request to', nearbyResponders.length, 'nearby responders');
    broadcastRequest(newRequest);
    notifyResponders(nearbyResponders, newRequest);
    
    // Send success response
    res.json({ 
      success: true, 
      request_id, 
      message: 'Emergency request broadcasted successfully', 
      nearby_responders_count: nearbyResponders.length,
      location_source: latitude ? 'gps' : (finalLat ? 'saved' : 'manual')
    });
    
  } catch (error) {
    console.error('Request creation error:', error);
    res.status(500).json({ error: 'Failed to create request: ' + error.message });
  }
});

// Edit request
router.put('/edit/:request_id', async (req, res) => {
  const { request_id } = req.params;
  const { categories, location_text, urgency, user_id } = req.body;
  const db = getDb();
  
  try {
    // Check if request exists and belongs to user and is still active
    const request = db.prepare("SELECT * FROM emergency_requests WHERE request_id = ? AND user_id = ? AND status = 'active'").get(request_id, user_id);
    if (!request) {
      return res.status(404).json({ error: 'Request not found or already resolved' });
    }
    
    // Store edit history
    const oldCategories = db.prepare('SELECT GROUP_CONCAT(category) as cats FROM request_categories WHERE request_id = ?').get(request_id);
    const editHistory = {
      timestamp: new Date().toISOString(),
      previous: {
        categories: oldCategories ? oldCategories.cats : '',
        location_text: request.location_text,
        urgency: request.urgency
      }
    };
    
    // Update request
    db.prepare('UPDATE emergency_requests SET location_text = ?, urgency = ?, is_edited = 1, edit_history = ? WHERE request_id = ?')
      .run(location_text, urgency, JSON.stringify(editHistory), request_id);
    
    // Update categories - delete old and insert new
    db.prepare('DELETE FROM request_categories WHERE request_id = ?').run(request_id);
    const catStmt = db.prepare('INSERT INTO request_categories (request_id, category) VALUES (?, ?)');
    for (const category of categories) {
      catStmt.run(request_id, category);
    }
    
    console.log(`✏️ Request ${request_id} edited by user ${user_id}`);
    res.json({ success: true, message: 'Request updated successfully' });
  } catch (error) {
    console.error('Edit request error:', error);
    res.status(500).json({ error: 'Failed to update request: ' + error.message });
  }
});

// Delete request with chat cleanup
router.delete('/delete/:request_id', async (req, res) => {
  const { request_id } = req.params;
  const { user_id } = req.body;
  const db = getDb();
  
  try {
    // Check if request exists and belongs to user
    const request = db.prepare("SELECT * FROM emergency_requests WHERE request_id = ? AND user_id = ? AND status = 'active'").get(request_id, user_id);
    if (!request) {
      return res.status(404).json({ error: 'Request not found or already resolved' });
    }
    
    // Delete all chat messages associated with this request
    const messagesDeleted = db.prepare('DELETE FROM chat_messages WHERE request_id = ?').run(request_id);
    console.log(`📝 Deleted ${messagesDeleted.changes} chat messages for request ${request_id}`);
    
    // Delete active matches
    const matchesDeleted = db.prepare('DELETE FROM active_matches WHERE request_id = ?').run(request_id);
    console.log(`🔗 Deleted ${matchesDeleted.changes} active matches for request ${request_id}`);
    
    // Delete request categories
    db.prepare('DELETE FROM request_categories WHERE request_id = ?').run(request_id);
    
    // Delete the request
    db.prepare('DELETE FROM emergency_requests WHERE request_id = ?').run(request_id);
    
    console.log(`🗑️ Request ${request_id} deleted by user ${user_id}`);
    res.json({ success: true, message: 'Request and associated chat deleted successfully' });
  } catch (error) {
    console.error('Delete request error:', error);
    res.status(500).json({ error: 'Failed to delete request: ' + error.message });
  }
});

// Get active requests
router.get('/active', async (req, res) => {
  const { user_id, latitude, longitude } = req.query;
  const db = getDb();
  
  try {
    let query = `
      SELECT r.request_id, r.user_id, r.location_text, r.latitude, r.longitude, r.urgency, r.status, r.created_at, r.is_edited, 
             u.name as user_name, u.neighborhood, u.profile_icon,
        (SELECT GROUP_CONCAT(category) FROM request_categories WHERE request_id = r.request_id) as categories
      FROM emergency_requests r 
      JOIN users u ON r.user_id = u.id
      WHERE r.status = 'active'
    `;
    
    const params = [];
    if (user_id) {
      query += ` AND r.user_id != ?`;
      params.push(user_id);
    }
    query += ` AND r.request_id NOT IN (SELECT request_id FROM active_matches WHERE status = 'active')`;
    query += ` ORDER BY 
      CASE r.urgency 
        WHEN 'urgent' THEN 1 
        WHEN 'high' THEN 2 
        ELSE 3 
      END, r.created_at DESC`;
    
    let requests = db.prepare(query).all(...params);
    
    // Calculate distances if coordinates provided
    if (latitude && longitude && requests.length > 0) {
      for (const req of requests) {
        if (req.latitude && req.longitude) {
          const distance = calculateDistance(latitude, longitude, req.latitude, req.longitude);
          req.distance_km = Math.round(distance * 10) / 10;
          req.distance_display = distance < 1 ? `${Math.round(distance * 1000)}m away` : `${req.distance_km}km away`;
        } else {
          req.distance_display = 'Location unknown';
        }
      }
      requests.sort((a, b) => (a.distance_km || 999) - (b.distance_km || 999));
    } else {
      // Add default distance display
      requests.forEach(req => {
        req.distance_display = 'Location unknown';
      });
    }
    
    res.json(requests);
  } catch (error) {
    console.error('Error fetching requests:', error);
    res.status(500).json({ error: 'Failed to fetch requests' });
  }
});

// Accept a request
router.post('/accept', async (req, res) => {
  const { request_id, responder_id } = req.body;
  const db = getDb();
  
  try {
    // Check if request exists and is active
    const request = db.prepare("SELECT * FROM emergency_requests WHERE request_id = ? AND status = 'active'").get(request_id);
    if (!request) {
      return res.status(404).json({ error: 'Request no longer active' });
    }
    
    // Check if already accepted
    const existingMatch = db.prepare("SELECT * FROM active_matches WHERE request_id = ? AND status = 'active'").get(request_id);
    if (existingMatch) {
      return res.status(409).json({ error: 'Already accepted by someone else' });
    }
    
    // Create match
    const insertMatch = db.prepare("INSERT INTO active_matches (request_id, responder_id, requester_id, status) VALUES (?, ?, ?, 'active')");
    insertMatch.run(request_id, responder_id, request.user_id);
    
    // Update request status
    const updateRequest = db.prepare("UPDATE emergency_requests SET matched_with = ?, status = 'matched' WHERE request_id = ?");
    updateRequest.run(responder_id, request_id);
    
    // Get user details
    const responder = db.prepare('SELECT id, name, phone_number, profile_icon FROM users WHERE id = ?').get(responder_id);
    const requester = db.prepare('SELECT id, name, phone_number, profile_icon FROM users WHERE id = ?').get(request.user_id);
    
    console.log(`✅ Request ${request_id} accepted by responder ${responder.name}`);
    
    res.json({ success: true, chat_id: request_id, responder, requester });
  } catch (error) {
    console.error('Accept request error:', error);
    res.status(500).json({ error: 'Failed to accept request: ' + error.message });
  }
});

// Resolve a request
router.post('/resolve', async (req, res) => {
  const { request_id } = req.body;
  const db = getDb();
  
  try {
    db.prepare("UPDATE emergency_requests SET status = 'resolved', resolved_at = CURRENT_TIMESTAMP WHERE request_id = ?").run(request_id);
    db.prepare("UPDATE active_matches SET status = 'resolved', updated_at = CURRENT_TIMESTAMP WHERE request_id = ?").run(request_id);
    console.log(`✅ Request ${request_id} marked as resolved`);
    res.json({ success: true });
  } catch (error) {
    console.error('Resolve request error:', error);
    res.status(500).json({ error: 'Failed to resolve request' });
  }
});

// Haversine formula for distance calculation
function calculateDistance(lat1, lon1, lat2, lon2) {
  const R = 6371; // Earth's radius in km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon/2) * Math.sin(dLon/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
}

module.exports = router;
