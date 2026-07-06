const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const path = require('path');
const dotenv = require('dotenv');

dotenv.config();

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  },
  transports: ['websocket', 'polling'],
  pingTimeout: 60000,
  pingInterval: 25000
});

app.use(helmet({ contentSecurityPolicy: false }));
app.use(compression());
app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

const dbSetup = require('./database');
dbSetup.initializeDatabase();

const authRoutes = require('./routes/auth');
const requestRoutes = require('./routes/requests');
const chatRoutes = require('./routes/chat');
const smsRoutes = require('./routes/sms');
const statsRoutes = require('./routes/stats');
const mapRoutes = require('./routes/map');

app.use('/api/auth', authRoutes);
app.use('/api/requests', requestRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/sms', smsRoutes);
app.use('/api/stats', statsRoutes);
app.use('/api/map', mapRoutes);

// Serve HTML files
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});
app.get('/request', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'request.html'));
});
app.get('/view-requests', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'view-requests.html'));
});
app.get('/chat', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'chat.html'));
});
app.get('/profile', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'profile.html'));
});
app.get('/map', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'map.html'));
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🚨 UbuntuAid server running on port ${PORT}`);
  console.log(`📱 Low-bandwidth mode enabled`);
  console.log(`📡 SMS fallback: ${process.env.TWILIO_ENABLED === 'true' ? 'ACTIVE' : 'DISABLED'}`);
  console.log(`🗺️ Map available at http://localhost:${PORT}/map`);
});
