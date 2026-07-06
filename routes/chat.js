const express = require('express');
const router = express.Router();
const { getDb } = require('../database');

router.post('/send', async (req, res) => {
  const { request_id, from_user_id, to_user_id, message, use_sms_fallback } = req.body;
  const db = getDb();
  
  if (!request_id || !from_user_id || !to_user_id || !message) {
    return res.status(400).json({ error: 'Missing required fields' });
  }
  
  try {
    const isSmsFallback = use_sms_fallback === true || use_sms_fallback === 1 || use_sms_fallback === 'true' ? 1 : 0;
    
    const stmt = db.prepare(`
      INSERT INTO chat_messages (request_id, from_user_id, to_user_id, message, is_sms_fallback, delivered)
      VALUES (?, ?, ?, ?, ?, 1)
    `);
    const result = stmt.run(request_id, from_user_id, to_user_id, message, isSmsFallback);
    
    console.log(`💬 Message sent: ${from_user_id} -> ${to_user_id}: ${message.substring(0, 50)}`);
    
    res.json({ 
      success: true, 
      message_id: result.lastInsertRowid,
      delivered: true
    });
  } catch (error) {
    console.error('Send message error:', error);
    res.status(500).json({ error: 'Failed to send message: ' + error.message });
  }
});

// Get all active chats for a user
router.get('/my-chats/:user_id', async (req, res) => {
  const { user_id } = req.params;
  const db = getDb();
  
  try {
    // Get all active matches where user is either requester or responder
    const chats = db.prepare(`
      SELECT 
        am.*,
        am.request_id,
        am.status as match_status,
        am.created_at as matched_at,
        r.urgency,
        r.location_text,
        r.created_at as request_created_at,
        CASE 
          WHEN am.requester_id = ? THEN am.responder_id
          ELSE am.requester_id
        END as other_user_id,
        CASE 
          WHEN am.requester_id = ? THEN 'requester'
          ELSE 'responder'
        END as my_role,
        (
          SELECT COUNT(*) 
          FROM chat_messages 
          WHERE request_id = am.request_id 
            AND to_user_id = ? 
            AND read = 0
        ) as unread_count,
        (
          SELECT message 
          FROM chat_messages 
          WHERE request_id = am.request_id 
          ORDER BY created_at DESC 
          LIMIT 1
        ) as last_message,
        (
          SELECT created_at 
          FROM chat_messages 
          WHERE request_id = am.request_id 
          ORDER BY created_at DESC 
          LIMIT 1
        ) as last_message_time
      FROM active_matches am
      JOIN emergency_requests r ON am.request_id = r.request_id
      WHERE am.status = 'active' 
        AND (am.requester_id = ? OR am.responder_id = ?)
      ORDER BY last_message_time DESC
    `).all(user_id, user_id, user_id, user_id, user_id);
    
    // Get details for the other user in each chat
    for (const chat of chats) {
      const otherUser = db.prepare('SELECT id, name, phone_number, profile_icon, neighborhood FROM users WHERE id = ?').get(chat.other_user_id);
      chat.other_user = otherUser;
      
      // Get request categories
      const categories = db.prepare('SELECT GROUP_CONCAT(category) as cats FROM request_categories WHERE request_id = ?').get(chat.request_id);
      chat.categories = categories ? categories.cats : '';
    }
    
    res.json(chats);
  } catch (error) {
    console.error('Get active chats error:', error);
    res.status(500).json({ error: 'Failed to get chats' });
  }
});

// Mark messages as read
router.post('/mark-read', async (req, res) => {
  const { request_id, user_id } = req.body;
  const db = getDb();
  
  try {
    db.prepare(`
      UPDATE chat_messages 
      SET read = 1 
      WHERE request_id = ? AND to_user_id = ? AND read = 0
    `).run(request_id, user_id);
    
    res.json({ success: true });
  } catch (error) {
    console.error('Mark read error:', error);
    res.status(500).json({ error: 'Failed to mark messages as read' });
  }
});

router.get('/conversation/:request_id', async (req, res) => {
  const { request_id } = req.params;
  const db = getDb();
  
  try {
    const messages = db.prepare(`
      SELECT m.*, u_from.name as from_name, u_from.profile_icon as from_icon,
        u_to.name as to_name, u_to.profile_icon as to_icon
      FROM chat_messages m
      JOIN users u_from ON m.from_user_id = u_from.id
      JOIN users u_to ON m.to_user_id = u_to.id
      WHERE m.request_id = ?
      ORDER BY m.created_at ASC
      LIMIT 200
    `).all(request_id);
    
    res.json(messages);
  } catch (error) {
    console.error('Get conversation error:', error);
    res.status(500).json({ error: 'Failed to get messages' });
  }
});

router.get('/active/:request_id', async (req, res) => {
  const { request_id } = req.params;
  const db = getDb();
  
  try {
    const match = db.prepare("SELECT * FROM active_matches WHERE request_id = ? AND status = 'active'").get(request_id);
    if (!match) {
      return res.status(404).json({ error: 'No active match found' });
    }
    
    const requester = db.prepare('SELECT id, name, phone_number, profile_icon FROM users WHERE id = ?').get(match.requester_id);
    const responder = db.prepare('SELECT id, name, phone_number, profile_icon FROM users WHERE id = ?').get(match.responder_id);
    
    res.json({ 
      request_id, 
      requester, 
      responder, 
      match_status: match.status 
    });
  } catch (error) {
    console.error('Get active match error:', error);
    res.status(500).json({ error: 'Failed to get match info' });
  }
});

module.exports = router;
