// AI Brand Position Tracker - Server
// -----------------------------------
// Run: npm install && npm start
// Visit: http://localhost:3000

require('dotenv').config();
const express = require('express');
const session = require('express-session');
const path = require('path');
const Database = require('better-sqlite3');
const OpenAI = require('openai');

// ============ CONFIG ============
const PORT = process.env.PORT || 3000;
const ACCESS_PASSWORD = process.env.ACCESS_PASSWORD || 'Brandtracker2026';
const SESSION_SECRET = process.env.SESSION_SECRET || 'change-this-in-production-' + Math.random();
const OPENAI_API_KEY = process.env.OPENAI_API_KEY; // set in .env
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';

// ============ DATABASE ============
const db = new Database(path.join(__dirname, 'tracker.db'));
db.exec(`
  CREATE TABLE IF NOT EXISTS tracks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    brand_name TEXT NOT NULL,
    prompt TEXT NOT NULL,
    response TEXT NOT NULL,
    position INTEGER,
    found INTEGER NOT NULL,
    model TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );
`);

// ============ APP ============
const app = express();
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 1000 * 60 * 60 * 24 * 7 } // 1 week
}));
app.use(express.static(path.join(__dirname, 'public')));

// ============ AUTH MIDDLEWARE ============
function requireAuth(req, res, next) {
  if (req.session && req.session.authed) return next();
  return res.status(401).json({ error: 'Not authenticated' });
}

function requireAuthPage(req, res, next) {
  if (req.session && req.session.authed) return next();
  return res.redirect('/login');
}

// ============ ROUTES ============

// Login page
app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

// Login submit
app.post('/api/login', (req, res) => {
  const { password } = req.body;
  if (password === ACCESS_PASSWORD) {
    req.session.authed = true;
    return res.json({ ok: true });
  }
  return res.status(401).json({ ok: false, error: 'Incorrect password' });
});

// Logout
app.post('/api/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

// Main app page
app.get('/', requireAuthPage, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'app.html'));
});

// --- Track endpoint: queries ChatGPT ---
app.post('/api/track', requireAuth, async (req, res) => {
  const { brandName, prompt } = req.body;
  if (!brandName || !prompt) {
    return res.status(400).json({ error: 'brandName and prompt are required' });
  }
  if (!OPENAI_API_KEY) {
    return res.status(500).json({ error: 'OPENAI_API_KEY not set on the server. Add it to your .env file.' });
  }

  try {
    const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

    const completion = await openai.chat.completions.create({
      model: OPENAI_MODEL,
      messages: [
        { role: 'system', content: 'You are a helpful assistant. When asked for a ranked list, respond with a clearly numbered list (1., 2., 3., ...). Keep each item concise with the name first, then a short description.' },
        { role: 'user', content: prompt }
      ],
      temperature: 0.3
    });

    const responseText = completion.choices[0]?.message?.content || '';

    // --- Find brand position ---
    const { position, found } = findBrandPosition(responseText, brandName);

    // --- Save to DB ---
    const stmt = db.prepare(`
      INSERT INTO tracks (brand_name, prompt, response, position, found, model)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    const info = stmt.run(brandName, prompt, responseText, position, found ? 1 : 0, OPENAI_MODEL);

    return res.json({
      id: info.lastInsertRowid,
      brandName,
      prompt,
      response: responseText,
      position,
      found,
      model: OPENAI_MODEL,
      createdAt: new Date().toISOString()
    });
  } catch (err) {
    console.error('OpenAI error:', err.message);
    return res.status(500).json({ error: 'OpenAI request failed: ' + err.message });
  }
});

// --- History endpoint ---
app.get('/api/history', requireAuth, (req, res) => {
  const rows = db.prepare(`
    SELECT id, brand_name AS brandName, prompt, response, position, found, model, created_at AS createdAt
    FROM tracks
    ORDER BY id DESC
    LIMIT 100
  `).all();
  res.json(rows.map(r => ({ ...r, found: !!r.found })));
});

// --- Delete a record ---
app.delete('/api/history/:id', requireAuth, (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(400).json({ error: 'Invalid id' });
  db.prepare('DELETE FROM tracks WHERE id = ?').run(id);
  res.json({ ok: true });
});

// ============ BRAND POSITION LOGIC ============
// Strategy: try to parse a numbered list first. If found, search for the brand
// within each numbered item. Otherwise, fall back to order of first mention.
function findBrandPosition(text, brandName) {
  if (!text || !brandName) return { position: null, found: false };
  const needle = brandName.trim().toLowerCase();

  // Escape brand name for regex and allow word-ish boundaries.
  // We do a case-insensitive substring match rather than strict word boundaries
  // so brands with punctuation ("OpenAI", "H&M") still match.
  const matches = (haystack) => haystack.toLowerCase().includes(needle);

  // Try numbered-list parsing: lines starting with "1.", "2)", "1:" etc.
  const lines = text.split(/\r?\n/);
  const items = []; // { num, content }
  let currentNum = null;
  let currentBuf = [];

  const numberRe = /^\s*(\d{1,3})[\.\):\-]\s+(.*)$/;
  const boldNumberRe = /^\s*\**\s*(\d{1,3})[\.\):\-]\s+(.*)$/;

  for (const line of lines) {
    const m = line.match(numberRe) || line.match(boldNumberRe);
    if (m) {
      if (currentNum !== null) {
        items.push({ num: currentNum, content: currentBuf.join(' ') });
      }
      currentNum = parseInt(m[1], 10);
      currentBuf = [m[2]];
    } else if (currentNum !== null) {
      currentBuf.push(line);
    }
  }
  if (currentNum !== null) {
    items.push({ num: currentNum, content: currentBuf.join(' ') });
  }

  if (items.length >= 2) {
    // Use the numbered list. Position = the item number that contains the brand.
    for (const it of items) {
      if (matches(it.content)) {
        return { position: it.num, found: true };
      }
    }
    return { position: null, found: false };
  }

  // Fallback: find order of first mention by splitting on common separators.
  // We approximate "position" as the sentence index where the brand first appears.
  const sentences = text.split(/(?<=[\.\!\?])\s+|\n+/).map(s => s.trim()).filter(Boolean);
  for (let i = 0; i < sentences.length; i++) {
    if (matches(sentences[i])) {
      return { position: i + 1, found: true };
    }
  }
  return { position: null, found: false };
}

// ============ START ============
app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🚀 AI Brand Position Tracker`);
  console.log(`   → http://localhost:${PORT}`);
  console.log(`   → Login password: ${ACCESS_PASSWORD}`);
  if (!OPENAI_API_KEY) {
    console.log(`\n⚠️  WARNING: OPENAI_API_KEY is not set. Add it to .env before tracking.\n`);
  }
});
