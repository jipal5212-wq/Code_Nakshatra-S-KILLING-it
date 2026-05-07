const express = require('express');
const path = require('path');
const fs = require('fs');
const cors = require('cors');
const multer = require('multer');
const cookieParser = require('cookie-parser');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { getAdminClient } = require('./lib/supabase');
const { seedTasksIfEmpty } = require('./lib/seedTasks');

const publicRoutes = require('./routes/publicRoutes');
const authRoutes = require('./routes/authRoutes');
const userRoutes = require('./routes/userRoutes');
const taskRoutes = require('./routes/taskRoutes');
const newsRoutes = require('./routes/newsRoutes');
const adminRoutes = require('./routes/adminRoutes');
const tfeedRoutes = require('./routes/tfeedRoutes');
const cycleRoutes = require('./routes/cycleRoutes');
const aiEvalRoutes = require('./routes/aiEvalRoutes');

let genAI = null;
let geminiModel = null;
if (process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY !== 'YOUR_GEMINI_API_KEY_HERE') {
  genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  geminiModel = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });
}

function ensureUploadDir() {
  const isVercel = process.env.VERCEL || process.env.NOW_REGION;
  const u = isVercel 
    ? path.join('/tmp', 'uploads')
    : path.join(__dirname, '..', 'uploads');
  
  if (!fs.existsSync(u)) {
    try {
      fs.mkdirSync(u, { recursive: true });
    } catch (err) {
      console.warn('Could not create upload dir:', u, err.message);
    }
  }
  return u;
}

function createApp() {
  ensureUploadDir();
  const app = express();
  const UPLOAD_DIR = ensureUploadDir();

  const storage = multer.diskStorage({
    destination: (_req, _f, cb) => cb(null, UPLOAD_DIR),
    filename: (_req, file, cb) => {
      // Strip spaces and any character that isn't alphanumeric, dot, dash, or underscore
      const safe = file.originalname
        .replace(/\s+/g, '_')
        .replace(/[^a-zA-Z0-9.\-_]/g, '');
      cb(null, `${Date.now()}-${safe || 'file'}`);
    }
  });
  const upload = multer({ storage, limits: { fileSize: 100 * 1024 * 1024 } });

  app.use(
    cors({
      origin: true,
      credentials: true
    })
  );
  app.use(express.json({ limit: '4mb' }));
  app.use(cookieParser());
  app.use(express.static(path.join(__dirname, '..', 'public')));
  app.use('/uploads', express.static(UPLOAD_DIR));

  const admin = getAdminClient();
  if (admin)
    seedTasksIfEmpty(admin).catch((err) => console.error('[startup seed]', err));
  else console.warn('⚠️  SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY missing — API routes needing DB disabled.');

  // ── Content pack + explore: always available (Gemini + YT, no DB needed) ─
  app.use(publicRoutes(admin, geminiModel));

  if (admin) {
    app.use(authRoutes(admin));
    app.use(userRoutes(admin, upload));
    app.use(taskRoutes(admin));
    app.use(newsRoutes(admin));
    app.use(adminRoutes(admin, upload));
    app.use(tfeedRoutes(admin, geminiModel));
    app.use(cycleRoutes(admin));
    app.use(aiEvalRoutes(admin, geminiModel));
  }

  // ── Legacy-compatible JSON fallbacks when Supabase off ───
  if (!admin) {
    app.get('/api/news', (_req, res) => res.json({ news: [] }));
    app.get('/api/tasks', (_req, res) => res.json({ tasks: [] }));
  }

  // ─── AI (Gemini) ───
  app.post('/api/ai/generate-tasks', async (req, res) => {
    if (!geminiModel) return res.status(503).json({ error: 'Gemini API not configured' });
    if (!admin) return res.status(503).json({ error: 'Database required.' });
    const { domain, level } = req.body;
    try {
      const prompt = `Generate exactly 6 practical tasks for ${level} in "${domain}". Return ONLY JSON: [{"title":"...","desc":"...","effort":"~1 hr","ytQuery":"..."}]`;
      const result = await geminiModel.generateContent(prompt);
      const text = result.response.text();
      const jsonMatch = text.match(/\[[\s\S]*\]/);
      if (!jsonMatch) return res.status(500).json({ error: 'Failed to parse model output' });
      const arr = JSON.parse(jsonMatch[0]);
      if (!Array.isArray(arr))
        return res.status(500).json({ error: 'Model did not return an array' });

      const { mapTaskRow } = require('./routes/mapTask');
      const rows = arr.map((t) => ({
        domain: domain || 'General',
        level: level || 'Beginner',
        title: t.title,
        description: t.desc || '',
        effort: t.effort || '~1 hr',
        yt_query: t.ytQuery || `${t.title || 'task'} tutorial`,
        objective: '',
        watch_segment: '',
        expected_output: ''
      }));
      await admin.from('tasks').insert(rows);
      const { data } = await admin.from('tasks').select('*').order('title', { ascending: true }).limit(rows.length);
      res.json({
        success: true,
        tasks: (data || []).map(mapTaskRow)
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/ai/chat', async (req, res) => {
    if (!geminiModel) return res.status(503).json({ error: 'Gemini API not configured' });
    const { message, taskContext } = req.body || {};
    try {
      const prompt = `You are SKILLING IT AI mentor. Concise practical advice. ${taskContext ? `Task: "${taskContext}".` : ''} Question: ${message}`;
      const result = await geminiModel.generateContent(prompt);
      res.json({ success: true, reply: result.response.text() });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/leaderboard', async (_req, res) => {
    try {
      if (!admin) return res.json({ leaderboard: [] });
      const { data, error } = await admin
        .from('profiles')
        .select('display_name, skill_domain, level, points, id')
        .order('points', { ascending: false })
        .limit(30);
      if (error) return res.status(500).json({ error: error.message });
      res.json({
        leaderboard: (data || []).map((u, i) => ({
          rank: i + 1,
          name: u.display_name || 'Learner',
          domain: u.skill_domain || '',
          level: u.level || '',
          points: u.points || 0,
          streak: null
        }))
      });
    } catch {
      res.json({ leaderboard: [] });
    }
  });

  app.get('/api/health', (_req, res) =>
    res.json({
      status: 'ok',
      supabase: !!admin,
      geminiActive: !!geminiModel,
      youtube: !!(process.env.YOUTUBE_API_KEY && process.env.YOUTUBE_API_KEY !== 'YOUR_YOUTUBE_API_KEY_HERE')
    })
  );

  app.get('/', (_req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'index.html')));
  app.get('/login.html', (_req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'login.html')));
  app.get('/admin.html', (_req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'admin.html')));
  app.get('/admin', (_req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'admin.html')));
  app.get('/dashboard', (_req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'dashboard.html')));

  return app;
}

module.exports = { createApp };
