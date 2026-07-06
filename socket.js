const { getDb } = require('./database');

let ioInstance = null;
let connectedUsers = new Map();

function setupSocketHandlers(io) {
  ioInstance = io;
  
  io.on('connection', (socket) => {
    console.log('🔌 New client connected:', socket.id);
    
    socket.on('register', async (userId) => {
      connectedUsers.set(userId, socket.id);
      socket.userId = userId;
      console.log(`✅ User ${userId} registered`);
      
      const db = getDb();
      try {
        const pending = db.prepare(`
          SELECT * FROM chat_messages 
          WHERE to_user_id = ? AND delivered = 0 AND is_sms_fallback = 0
        `).all(userId);
        
        if (pending && pending.length > 0) {
          socket.emit('pending_messages', pending);
          db.prepare('UPDATE chat_messages SET delivered = 1 WHERE to_user_id = ? AND delivered = 0').run(userId);
        }
      } catch (error) {
        console.error('Error fetching pending messages:', error);
      }
    });
    
    socket.on('join_chat', (requestId) => {
      if (requestId) {
        socket.join(`chat_${requestId}`);
        console.log(`📢 User ${socket.userId} joined chat ${requestId}`);
      }
    });
    
    socket.on('send_message', async (data) => {
      const { request_id, from_user_id, to_user_id, message } = data;
      
      if (!request_id || !from_user_id || !to_user_id || !message) {
        console.error('Invalid message data:', data);
        return;
      }
      
      // Note: The message is already saved via REST API
      // This socket event is only for real-time broadcasting to the recipient
      
      // Emit to chat room for the recipient
      io.to(`chat_${request_id}`).emit('new_message', {
        request_id,
        from_user_id,
        to_user_id,
        message,
        created_at: new Date().toISOString()
      });
      
      // Notify recipient if online (separate from chat room)
      const recipientSocketId = connectedUsers.get(to_user_id);
      if (recipientSocketId && recipientSocketId !== socket.id) {
        io.to(recipientSocketId).emit('chat_notification', {
          request_id,
          from_user_id,
          message_preview: message.substring(0, 50)
        });
        io.to(recipientSocketId).emit('refresh_chats');
      }
      
      console.log(`💬 Socket broadcast: ${from_user_id} -> ${to_user_id}`);
    });
    
    socket.on('typing', ({ request_id, user_id, is_typing }) => {
      if (request_id && user_id) {
        socket.to(`chat_${request_id}`).emit('user_typing', { user_id, is_typing });
      }
    });
    
    socket.on('disconnect', () => {
      if (socket.userId) {
        connectedUsers.delete(socket.userId);
        console.log(`🔌 User ${socket.userId} disconnected`);
      }
    });
  });
}

function broadcastRequest(request) {
  if (!ioInstance) return;
  ioInstance.emit('new_emergency', { ...request, timestamp: new Date().toISOString() });
}

function notifyResponders(responders, request) {
  if (responders && responders.length > 0 && ioInstance) {
    responders.forEach(responder => {
      const socketId = connectedUsers.get(responder.id);
      if (socketId) {
        ioInstance.to(socketId).emit('emergency_alert', { request, distance: responder.distance });
      }
    });
  }
  console.log(`📢 Notified ${responders ? responders.length : 0} potential responders`);
}

module.exports = setupSocketHandlers;
module.exports.broadcastRequest = broadcastRequest;
module.exports.notifyResponders = notifyResponders;
