const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const wordsRouter = require('./routes/words');
const aiRouter = require('./routes/ai');
const audioRouter = require('./routes/audio');
const calendarRouter = require('./routes/calendar');
const haRouter = require('./routes/ha');
const authRouter = require('./routes/auth');
const auditRouter = require('./routes/audit');
const adminRouter = require('./routes/admin');

const app = express();
const PORT = process.env.PORT || 1234;

app.use(cors());
app.use(express.json({ limit: '25mb' }));
app.use(express.urlencoded({ extended: true, limit: '25mb' }));

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

const fs = require('fs');

// Mount routes
app.use('/api/auth', authRouter);
app.use('/api/audit', auditRouter);
app.use('/api/admin', adminRouter);
app.use('/api', wordsRouter);
app.use('/api/ai', aiRouter);
app.use('/api/audio', audioRouter);
app.use('/api/calendar', calendarRouter);
app.use('/api/ha', haRouter);

// Serve static frontend in production if built
const distPath = path.join(__dirname, '..', '..', 'client', 'dist');
if (fs.existsSync(distPath)) {
  app.use(express.static(distPath));
  app.use((req, res) => {
    res.sendFile(path.join(distPath, 'index.html'));
  });
}


// Error handler
app.use((err, req, res, next) => {
  console.error('Server error:', err);
  res.status(500).json({ error: err.message || 'Internal Server Error' });
});

app.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});

