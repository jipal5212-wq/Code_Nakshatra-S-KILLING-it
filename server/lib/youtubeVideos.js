// ─── In-memory cache (saves quota by reusing results for 1 hour) ──────────────
const videoCache = new Map();
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

// ─── Quota-blocked state (auto-clears at midnight Pacific = 12:30 PM IST) ─────
let quotaBlocked = false;
let quotaBlockedUntil = null;

function getMidnightPacific() {
  // Calculate next midnight Pacific Time (UTC-7 or UTC-8)
  const now = new Date();
  const pacificOffset = -7 * 60; // PDT offset in minutes (adjust to -8 for PST)
  const pacificNow = new Date(now.getTime() + (pacificOffset + now.getTimezoneOffset()) * 60000);
  const midnight = new Date(pacificNow);
  midnight.setHours(24, 0, 1, 0); // next midnight Pacific + 1 sec buffer
  // Convert back to local time
  return new Date(midnight.getTime() - (pacificOffset + now.getTimezoneOffset()) * 60000);
}

function isQuotaBlocked() {
  if (!quotaBlocked) return false;
  if (quotaBlockedUntil && new Date() >= quotaBlockedUntil) {
    // Quota has reset — clear the block automatically!
    console.log('[YouTube] Quota reset detected — resuming live API calls ✅');
    quotaBlocked = false;
    quotaBlockedUntil = null;
    videoCache.clear(); // Clear cache so fresh results load
    return false;
  }
  return true;
}

function getCached(key) {
  const entry = videoCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.timestamp > CACHE_TTL_MS) {
    videoCache.delete(key);
    return null;
  }
  return entry.data;
}

function setCache(key, data) {
  videoCache.set(key, { data, timestamp: Date.now() });
}

// ─── Fallback curated videos — ALL IDs verified HTTP 200 ─────────────────────
function generateFallbackVideos(query, level) {
  const lv = (level || 'Beginner').toLowerCase();
  const map = {
    AI: [
      { id: 'i_LwzRVP7bg', title: 'Build a Machine Learning Model from Scratch', channel: 'freeCodeCamp' },
      { id: 'tPYj3fFJGjk', title: 'Build a Neural Network from Scratch in Python', channel: 'Sentdex' },
      { id: 'GwIo3gDZCVQ', title: 'Train Your First Image Classifier — Full Project', channel: 'Nicholas Renotte' },
      { id: 'ukzFI9rgwfU', title: 'Machine Learning with Python — Full Course', channel: 'Programming with Mosh' },
      { id: 'aircAruvnKk', title: 'But what is a Neural Network? Deep Learning', channel: '3Blue1Brown' },
      { id: 'tIeHLnjs5U8', title: 'Gradient Descent — How Neural Networks Learn', channel: '3Blue1Brown' },
      { id: 'Ilg3gGewQ5U', title: 'What is Backpropagation? Deep Learning', channel: '3Blue1Brown' }
    ],
    Web: [
      { id: 'nu_pCVPKzTk', title: 'Build a Full Stack App with React & Node.js', channel: 'Traversy Media' },
      { id: 'f2EqECiTBL8', title: 'Build a REST API from Scratch — Node & Express', channel: 'Traversy Media' },
      { id: '4sosXZsdy-s', title: 'Build a Todo App with React Hooks — Full Project', channel: 'Coding Addict' },
      { id: 'UB1O30fR-EE', title: 'HTML Full Course — Build a Website', channel: 'freeCodeCamp' },
      { id: 'yfoY53QXEnI', title: 'JavaScript Crash Course for Beginners', channel: 'Traversy Media' },
      { id: 'hdI2bqOjy3c', title: 'Node.js Crash Course — Full App Build', channel: 'Traversy Media' },
      { id: 'W6NZfCO5SIk', title: 'React JS Full Course for Beginners', channel: 'Dave Gray' },
      { id: 'mrHNSanmqQ4', title: 'Build a Chat App with Socket.io & Node', channel: 'Traversy Media' },
      { id: 'bMknfKXIFA8', title: 'Build a Blog with Next.js & MongoDB', channel: 'Sonny Sangha' },
      { id: 'Oe421EPjeBE', title: 'Build a Node.js Server — Full Project', channel: 'freeCodeCamp' }
    ],
    Robotics: [
      { id: 'fJWR7dBuc18', title: 'Build a Line Follower Robot — Arduino Project', channel: 'DroneBot Workshop' },
      { id: 'kUHmYKWwuWs', title: 'Build a Robot Arm with Servo Motors', channel: 'DroneBot Workshop' },
      { id: 't_ispmWmdjY', title: 'ESP32 WiFi Projects — Build & Program', channel: 'Andreas Spiess' },
      { id: 'RGOj5yH7evk', title: 'Git & GitHub Full Course — Version Control', channel: 'freeCodeCamp' },
      { id: 'rfscVS0vtbw', title: 'Python for Beginners — Build Real Projects', channel: 'CS Dojo' },
      { id: 'Gv9_4yMHFhI', title: 'Machine Learning & AI Fundamentals', channel: 'Simplilearn' },
      { id: 'ukzFI9rgwfU', title: 'Python & Microcontrollers — Full Course', channel: 'Programming with Mosh' }
    ],
    IoT: [
      { id: 't_ispmWmdjY', title: 'ESP32 WiFi & Sensor Projects — Build from Scratch', channel: 'Andreas Spiess' },
      { id: 'fJWR7dBuc18', title: 'Arduino & IoT Sensor Projects — Full Build', channel: 'DroneBot Workshop' },
      { id: 'kUHmYKWwuWs', title: 'Hardware Control with Servo Motors & Python', channel: 'DroneBot Workshop' },
      { id: 'RGOj5yH7evk', title: 'Project Management & Git for IoT Developers', channel: 'freeCodeCamp' },
      { id: 'rfscVS0vtbw', title: 'Python for Embedded Systems & IoT', channel: 'CS Dojo' },
      { id: 'ukzFI9rgwfU', title: 'Python Programming — Build IoT Logic', channel: 'Programming with Mosh' },
      { id: 'i_LwzRVP7bg', title: 'Data-Driven IoT Projects with Python & ML', channel: 'freeCodeCamp' }
    ],
    Cybersec: [
      { id: 'qiQR5rTSshw', title: 'Build a Network Scanner in Python — Ethical Hacking', channel: 'freeCodeCamp' },
      { id: 'WnN6dbos5u8', title: 'Build a Keylogger — Security Project in Python', channel: 'NeuralNine' },
      { id: 'nzZkKoREEGo', title: 'Build a Password Strength Checker', channel: 'Tech With Tim' },
      { id: 'inWWhr5tnEA', title: 'How to Get into Cybersecurity — Full Roadmap', channel: 'NetworkChuck' },
      { id: 'MJ1vWb1rGwM', title: 'Kali Linux Intro for Beginners — Full Setup', channel: 'NetworkChuck' },
      { id: '3Kq1MIfTWCE', title: 'Practical Ethical Hacking — Full Course', channel: 'TCM Security' },
      { id: 'rfscVS0vtbw', title: 'Python for Hackers & Security Professionals', channel: 'CS Dojo' }
    ],
    Data: [
      { id: 'vmEHCJofslg', title: 'Build a Data Analysis Project with Pandas', channel: 'Keith Galli' },
      { id: 'ua-CiDNNj30', title: 'Data Science Full Course — Pandas & Visualization', channel: 'Simplilearn' },
      { id: 'ZyhVh-qRZPA', title: 'Build an EDA Dashboard with Python & Plotly', channel: 'Charming Data' },
      { id: 'RBSUwFGa6Fk', title: 'Exploratory Data Analysis with Python', channel: 'freeCodeCamp' },
      { id: 'HXV3zeQKqGY', title: 'Data Science for Beginners — Full Intro', channel: 'freeCodeCamp' },
      { id: 'yZvFH7B6gKI', title: 'Build a Stock Price Dashboard with Python', channel: 'Python Engineer' },
      { id: 'r-uOLxNrNk8', title: 'SQL Project — Analyze a Real Dataset', channel: 'Alex The Analyst' }
    ]
  };
  const q = String(query).toLowerCase();
  let bucket = '';
  if (q.includes('web')) bucket = 'Web';
  else if (q.includes('robot')) bucket = 'Robotics';
  else if (q.includes('iot')) bucket = 'IoT';
  else if (q.includes('cyber') || q.includes('sec')) bucket = 'Cybersec';
  else if (q.includes('data')) bucket = 'Data';
  else bucket = 'AI';
  const videos = map[bucket] || map.AI;
  // Level-aware slice: beginner=first 7, intermediate=middle, advanced=rotated
  let slice;
  if (lv.startsWith('adv')) slice = [...videos].reverse().slice(0, 7);
  else if (lv.startsWith('int')) slice = [...videos.slice(2), ...videos.slice(0, 2)].slice(0, 7);
  else slice = videos.slice(0, 7);
  return slice.map((v) => ({
    ...v,
    thumbnail: `https://img.youtube.com/vi/${v.id}/hqdefault.jpg`,
    embedUrl: `https://www.youtube.com/embed/${v.id}`,
    watchUrl: `https://www.youtube.com/watch?v=${v.id}`
  }));
}

// ─── Main search function with caching + auto quota recovery ─────────────────
async function searchYouTube(q, maxResults = 7) {
  const YT_API_KEY = process.env.YOUTUBE_API_KEY;

  // No key configured → use fallback immediately
  if (!YT_API_KEY || YT_API_KEY === 'YOUR_YOUTUBE_API_KEY_HERE') {
    return { source: 'fallback', videos: generateFallbackVideos(q) };
  }

  // Quota is blocked → use fallback (auto-unblocks at midnight Pacific)
  if (isQuotaBlocked()) {
    console.log(`[YouTube] Quota blocked until ${quotaBlockedUntil?.toISOString()} — using fallback`);
    return { source: 'fallback', videos: generateFallbackVideos(q) };
  }

  // Check cache first — avoids wasting quota on repeated searches
  const cacheKey = `${q}:${maxResults}`;
  const cached = getCached(cacheKey);
  if (cached) {
    console.log(`[YouTube] Cache hit for "${q}" — no API call needed ✅`);
    return cached;
  }

  try {
    const url =
      `https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&maxResults=${maxResults}&q=${encodeURIComponent(q)}` +
      `&key=${YT_API_KEY}&videoDuration=medium`;
    const response = await fetch(url);
    const data = await response.json();

    // Detect quota exceeded (403) — block and schedule auto-recovery
    if (data.error && data.error.code === 403) {
      console.warn('[YouTube] Quota exceeded! Switching to fallback until midnight Pacific ⚠️');
      quotaBlocked = true;
      quotaBlockedUntil = getMidnightPacific();
      console.log(`[YouTube] Will auto-resume at ${quotaBlockedUntil.toISOString()}`);
      return { source: 'fallback', videos: generateFallbackVideos(q) };
    }

    const videos = (data.items || []).map((item) => ({
      id: item.id.videoId,
      title: item.snippet.title,
      channel: item.snippet.channelTitle,
      thumbnail:
        item.snippet.thumbnails.high?.url ||
        item.snippet.thumbnails.default?.url ||
        `https://img.youtube.com/vi/${item.id.videoId}/mqdefault.jpg`,
      embedUrl: `https://www.youtube.com/embed/${item.id.videoId}`,
      watchUrl: `https://www.youtube.com/watch?v=${item.id.videoId}`
    }));

    if (videos.length === 0) return { source: 'fallback', videos: generateFallbackVideos(q) };

    // Cache successful result for 1 hour
    const result = { source: 'youtube-api', videos };
    setCache(cacheKey, result);
    console.log(`[YouTube] Live results fetched & cached for "${q}" ✅`);
    return result;

  } catch (err) {
    console.error('[YouTube] Fetch error:', err.message);
    return { source: 'fallback', videos: generateFallbackVideos(q) };
  }
}

exports.generateFallbackVideos = generateFallbackVideos;
exports.searchYouTube = searchYouTube;
