const Database = require('better-sqlite3');
const path = require('path');

let db = null;

function initializeDatabase() {
  try {
    db = new Database(path.join(__dirname, 'ubuntu_aid.db'));
    console.log('✅ SQLite database connected');
    
    db.pragma('foreign_keys = ON');
    
    // Users table with profile icon
    db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        phone_number TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL,
        neighborhood TEXT NOT NULL,
        zip_code TEXT,
        latitude REAL,
        longitude REAL,
        profile_icon TEXT DEFAULT '🍎',
        is_active BOOLEAN DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        last_seen DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
    
    // Emergency requests table
    db.exec(`
      CREATE TABLE IF NOT EXISTS emergency_requests (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        request_id TEXT UNIQUE NOT NULL,
        user_id INTEGER NOT NULL,
        request_type TEXT NOT NULL,
        latitude REAL,
        longitude REAL,
        location_text TEXT,
        status TEXT DEFAULT 'active',
        urgency TEXT DEFAULT 'urgent',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        matched_with INTEGER,
        resolved_at DATETIME,
        is_edited BOOLEAN DEFAULT 0,
        edit_history TEXT,
        FOREIGN KEY (user_id) REFERENCES users(id),
        FOREIGN KEY (matched_with) REFERENCES users(id)
      )
    `);
    
    // Request categories junction table
    db.exec(`
      CREATE TABLE IF NOT EXISTS request_categories (
        request_id TEXT NOT NULL,
        category TEXT NOT NULL,
        PRIMARY KEY (request_id, category)
      )
    `);
    
    // Chat messages table
    db.exec(`
      CREATE TABLE IF NOT EXISTS chat_messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        request_id TEXT NOT NULL,
        from_user_id INTEGER NOT NULL,
        to_user_id INTEGER NOT NULL,
        message TEXT NOT NULL,
        is_sms_fallback BOOLEAN DEFAULT 0,
        delivered BOOLEAN DEFAULT 0,
        read BOOLEAN DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (from_user_id) REFERENCES users(id),
        FOREIGN KEY (to_user_id) REFERENCES users(id)
      )
    `);
    
    // Active matches table
    db.exec(`
      CREATE TABLE IF NOT EXISTS active_matches (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        request_id TEXT NOT NULL,
        responder_id INTEGER NOT NULL,
        requester_id INTEGER NOT NULL,
        status TEXT DEFAULT 'active',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(request_id, responder_id)
      )
    `);
    
    console.log('✅ Database tables ready');
    return db;
  } catch (error) {
    console.error('❌ Database initialization error:', error);
    throw error;
  }
}

function getDb() {
  if (!db) {
    initializeDatabase();
  }
  return db;
}

module.exports = { initializeDatabase, getDb };
