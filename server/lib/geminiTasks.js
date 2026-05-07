/**
 * geminiTasks.js
 * Generates 7 action-oriented build tasks per domain+level using Gemini.
 * Caches results for 10 minutes to avoid hitting rate limits on every pool load.
 */

const CACHE = new Map();   // key: "domain:level"  value: { ts, tasks }
const CACHE_TTL_MS = 10 * 60 * 1000;  // 10 minutes

const DOMAIN_CONTEXT = {
  aiml:        { name: 'AI / Machine Learning', tech: 'Python, scikit-learn, TensorFlow, PyTorch, Keras, Pandas, NumPy' },
  datascience: { name: 'Data Science',          tech: 'Python, Pandas, NumPy, Matplotlib, Seaborn, SQL, Plotly, Jupyter' },
  robotics:    { name: 'Robotics',              tech: 'Arduino, Raspberry Pi, ROS, servo motors, sensors, C++' },
  iot:         { name: 'IoT (Internet of Things)', tech: 'ESP32, MQTT, Node-RED, sensors, Arduino, Python, Raspberry Pi' },
  cybersec:    { name: 'Cybersecurity',         tech: 'Python, Nmap, Wireshark, Metasploit, Burp Suite, Linux, CTF' },
  webdev:      { name: 'Web Development',       tech: 'HTML, CSS, JavaScript, React, Node.js, Express, MongoDB, REST APIs' }
};

const LEVEL_CONTEXT = {
  Beginner:     'a complete beginner with no prior experience. Tasks should be simple, single-file, achievable in ~1 hour.',
  Intermediate: 'someone with 3–6 months experience. Tasks should involve multiple components, APIs, or frameworks, achievable in 2–4 hours.',
  Advanced:     'an experienced developer. Tasks should be production-grade, involve real-world complexity, architecture decisions, achievable in 4–8 hours.'
};

/**
 * Build the Gemini prompt for a given domain + level.
 * @param {string} skillKey
 * @param {string} level
 * @param {Array|null} topics  — track node topics [{title, skills, desc}]
 */
function buildPrompt(skillKey, level, topics) {
  const ctx = DOMAIN_CONTEXT[skillKey] || DOMAIN_CONTEXT.aiml;
  const lvlCtx = LEVEL_CONTEXT[level] || LEVEL_CONTEXT.Beginner;

  const topicBlock = topics && topics.length
    ? `\n\nCURRICULUM TOPICS — generate tasks that DIRECTLY cover these track topics:\n` +
      topics.map((t, i) => `${i + 1}. ${t.title}${t.skills?.length ? ' [' + t.skills.slice(0,3).join(', ') + ']' : ''}`).join('\n')
    : '';

  return `You are a technical curriculum designer for the S-KILLING IT platform.

Generate exactly 7 PRACTICAL, ACTION-ORIENTED tasks for ${ctx.name} at ${level} level.

The learner is ${lvlCtx}
Technologies involved: ${ctx.tech}${topicBlock}

STRICT RULES:
- Every task must start with a VERB: Build, Create, Train, Implement, Deploy, Analyze, Scrape, Automate, Write, Develop, Design, Configure, Setup
- NO theory tasks. NO "What is X", NO "Explain Y", NO "Read about Z"
- Each task must produce a tangible output: a working script, a trained model, a live demo, a dashboard, a deployed app, etc.
- The ytQuery must search for a hands-on tutorial video (build/create/project), NOT an explanation video
- ytQuery should include the word "project", "build", "from scratch", or "tutorial" and the specific technology

Return ONLY valid JSON — no markdown, no explanation:
[
  {
    "title": "Short imperative task title (max 10 words)",
    "desc": "2-3 sentences: what the learner will build, which specific tools/tech they will use, and what the expected output looks like (max 60 words)",
    "effort": "~1 hr",
    "domain": "${ctx.name}",
    "level": "${level}",
    "ytQuery": "specific YouTube search query to find a hands-on tutorial for this task",
    "watchSegment": "MM:SS – MM:SS (the exact timestamp range in the tutorial video that covers this specific task — be precise, e.g. 05:30 – 22:00)"
  }
]`;
}

/**
 * Parse Gemini's response text into an array of task objects.
 * Handles markdown code fences and stray text.
 */
function parseGeminiJSON(text) {
  // Strip ```json ... ``` fences
  const cleaned = text.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
  const match = cleaned.match(/\[\s*\{[\s\S]*\}\s*\]/);
  if (!match) throw new Error('No JSON array found in Gemini response');
  return JSON.parse(match[0]);
}

/**
 * Generate 7 tasks for a domain+level using Gemini.
 * @param {object|null} geminiModel
 * @param {string} skillKey
 * @param {string} level
 * @param {Array|null} topics  — track topics to align content with
 * @returns {Promise<Array>}
 */
async function generateTasks(geminiModel, skillKey, level, topics) {
  const cacheKey = topics ? `${skillKey}:${level}:track` : `${skillKey}:${level}`;
  const cached = CACHE.get(cacheKey);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
    return cached.tasks;
  }

  if (!geminiModel) {
    return getStaticTasks(skillKey, level, topics);
  }

  try {
    const prompt = buildPrompt(skillKey, level, topics);
    // 3-second timeout so Gemini never blocks the pool from loading
    const result = await Promise.race([
      geminiModel.generateContent(prompt),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Gemini timeout')), 3000))
    ]);
    const text = result.response.text();
    const raw = parseGeminiJSON(text);

    if (!Array.isArray(raw) || raw.length === 0) {
      throw new Error('Empty task array from Gemini');
    }

    // Normalize and validate each task
    const tasks = raw.slice(0, 7).map((t, i) => ({
      id: `gemini-${skillKey}-${level}-${i}`.toLowerCase().replace(/\s+/g, '-'),
      title: String(t.title || 'Build a Project').trim(),
      desc: String(t.desc || '').trim(),
      effort: String(t.effort || '~1 hr').trim(),
      domain: String(t.domain || DOMAIN_CONTEXT[skillKey]?.name || skillKey).trim(),
      level: String(t.level || level).trim(),
      ytQuery: String(t.ytQuery || `${t.title} tutorial project`).trim(),
      watchSegment: String(t.watchSegment || '').trim(),
      source: 'gemini'
    }));

    CACHE.set(cacheKey, { ts: Date.now(), tasks });
    return tasks;
  } catch (err) {
    console.error('[geminiTasks] Error:', err.message);
    const staticTasks = getStaticTasks(skillKey, level, topics);
    CACHE.set(cacheKey, { ts: Date.now(), tasks: staticTasks });
    return staticTasks;
  }
}

/**
 * Generate a watch segment hint from task effort.
 */
function effortToSegment(effort) {
  const e = (effort || '').toLowerCase();
  if (e.includes('30')) return '00:00 – 10:00';
  if (e.includes('1.5')) return '00:00 – 25:00';
  if (e.includes('2') || e.includes('3')) return '00:00 – 35:00';
  return '00:00 – 18:00';
}

/**
 * Static fallback tasks.
 * If track topics are supplied, generate directly from them (topic-aligned).
 * Otherwise fall back to the hardcoded generic list.
 */
function getStaticTasks(skillKey, level, topics) {
  // Topic-aligned path: build tasks straight from track nodes
  if (topics && topics.length) {
    const ctx = DOMAIN_CONTEXT[skillKey] || DOMAIN_CONTEXT.aiml;
    const verbs = ['Build','Create','Implement','Develop','Write','Design','Configure'];
    return topics.slice(0, 7).map((t, i) => ({
      id:      `track-${skillKey}-${level}-${i}`,
      title:   `${verbs[i % verbs.length]} a ${t.title} Project`,
      desc:    t.desc || `Apply ${t.title} concepts with ${(t.skills || []).slice(0,2).join(' and ')}.`,
      effort:  t.effort || '~1 hr',
      domain:  ctx.name,
      level,
      ytQuery: t.ytQuery || `${t.title} project tutorial from scratch`,
      source:  'track-static'
    }));
  }

  const isInter = level === 'Intermediate';
  const isAdv = level === 'Advanced';

  const map = {
    aiml: [
      { title: 'Train a Handwritten Digit Classifier', desc: 'Build and train a neural network on MNIST dataset using TensorFlow/Keras.', ytQuery: 'train MNIST neural network Python tensorflow from scratch', effort: '~1.5 hr' },
      { title: 'Build a Spam Email Detector', desc: 'Create a text classifier using Naive Bayes and scikit-learn on an email dataset.', ytQuery: 'build spam email classifier python scikit-learn project', effort: '~1 hr' },
      { title: 'Create a Movie Recommendation System', desc: 'Implement collaborative filtering using Pandas and cosine similarity.', ytQuery: 'build movie recommendation system python project tutorial', effort: '~2 hr' },
      { title: 'Train an Image Classifier with Transfer Learning', desc: 'Fine-tune a pre-trained MobileNet model to classify custom images.', ytQuery: 'transfer learning image classifier python keras project', effort: '~2 hr' },
      { title: 'Build a Sentiment Analysis API', desc: 'Train a sentiment model and expose it via a Flask REST endpoint.', ytQuery: 'sentiment analysis python flask api project tutorial', effort: '~2 hr' },
      { title: 'Implement K-Means Clustering on Customer Data', desc: 'Segment customer data into clusters and visualize with Matplotlib.', ytQuery: 'kmeans clustering python project tutorial pandas', effort: '~1 hr' },
      { title: 'Deploy an ML Model to a Web App', desc: 'Train a model, pickle it, and serve predictions via a Streamlit dashboard.', ytQuery: 'deploy machine learning model streamlit python project', effort: '~2 hr' }
    ],
    datascience: [
      { title: 'Analyze Netflix Dataset with Pandas', desc: 'Load, clean, and visualize trends in the Netflix titles dataset using Pandas and Seaborn.', ytQuery: 'netflix data analysis pandas python project tutorial', effort: '~1.5 hr' },
      { title: 'Build a Sales Dashboard with Plotly', desc: 'Create an interactive sales analytics dashboard using Plotly Express.', ytQuery: 'plotly express sales dashboard python project tutorial', effort: '~1.5 hr' },
      { title: 'Scrape and Analyze Job Postings', desc: 'Web-scrape job listings and analyze the most in-demand tech skills.', ytQuery: 'web scraping job postings python data analysis project', effort: '~2 hr' },
      { title: 'Predict House Prices with Linear Regression', desc: 'Build a regression model on the Boston housing dataset and evaluate with RMSE.', ytQuery: 'house price prediction linear regression python project', effort: '~1 hr' },
      { title: 'Build an SQL Analytics Report', desc: 'Write SQL queries to analyze a real e-commerce database and generate insights.', ytQuery: 'sql project data analysis tutorial from scratch', effort: '~1.5 hr' },
      { title: 'Create a COVID-19 Data Visualization', desc: 'Pull open COVID data and build animated time-series charts with Plotly.', ytQuery: 'covid data visualization python plotly project tutorial', effort: '~1.5 hr' },
      { title: 'Automate Excel Reports with Python', desc: 'Use openpyxl and Pandas to auto-generate formatted Excel reports from raw CSV data.', ytQuery: 'automate excel report python openpyxl pandas project', effort: '~1 hr' }
    ],
    robotics: [
      { title: 'Build a Line Follower Robot', desc: 'Wire IR sensors to an Arduino and program a PID line-following algorithm.', ytQuery: 'line follower robot arduino project build from scratch', effort: '~2 hr' },
      { title: 'Create an Obstacle Avoidance Bot', desc: 'Use an ultrasonic sensor with servo sweep to detect and avoid obstacles.', ytQuery: 'obstacle avoiding robot arduino ultrasonic project build', effort: '~1.5 hr' },
      { title: 'Build a Bluetooth Remote Controlled Car', desc: 'Program HC-05 Bluetooth module and control a 4-wheel robot from your phone.', ytQuery: 'bluetooth controlled car arduino project build tutorial', effort: '~2 hr' },
      { title: 'Implement Servo Arm Control with Joystick', desc: 'Map joystick analog values to a 3-axis servo arm using PWM signals.', ytQuery: 'servo arm joystick control arduino project tutorial', effort: '~1.5 hr' },
      { title: 'Build a Self-Balancing Robot', desc: 'Use MPU-6050 gyroscope and PID control to keep a 2-wheel bot balanced.', ytQuery: 'self balancing robot arduino MPU6050 project build', effort: '~3 hr' },
      { title: 'Program a ROS Navigation Node', desc: 'Write a ROS publisher/subscriber node to control robot movement via topics.', ytQuery: 'ROS robot navigation tutorial project from scratch', effort: '~2 hr' },
      { title: 'Build a Voice-Controlled Robot', desc: 'Integrate speech recognition with Arduino motor control for voice commands.', ytQuery: 'voice controlled robot arduino python project build', effort: '~2 hr' }
    ],
    iot: [
      { title: 'Build a Temperature Monitoring Dashboard', desc: 'Read DHT11 sensor data from ESP32 and display live readings on a Node-RED dashboard.', ytQuery: 'ESP32 DHT11 temperature dashboard node-red project tutorial', effort: '~1.5 hr' },
      { title: 'Create a Smart Door Lock System', desc: 'Use a keypad and servo motor with ESP32 to build a PIN-protected door lock.', ytQuery: 'smart door lock ESP32 keypad servo project build', effort: '~2 hr' },
      { title: 'Build an MQTT Smart Home Hub', desc: 'Publish sensor data via MQTT and subscribe on a Raspberry Pi to control devices.', ytQuery: 'MQTT smart home ESP32 raspberry pi project tutorial', effort: '~2 hr' },
      { title: 'Implement a Plant Watering Automation System', desc: 'Read soil moisture sensor and auto-trigger a water pump via relay with ESP32.', ytQuery: 'automatic plant watering system ESP32 project build tutorial', effort: '~1.5 hr' },
      { title: 'Create a Real-Time GPS Tracker', desc: 'Connect GPS module to ESP32 and send location data to a web map via HTTP.', ytQuery: 'GPS tracker ESP32 real time project tutorial', effort: '~2 hr' },
      { title: 'Build an Air Quality Monitoring Device', desc: 'Use MQ-135 sensor with ESP32 to log and alert when CO2 levels exceed threshold.', ytQuery: 'air quality monitor ESP32 MQ135 project tutorial', effort: '~1.5 hr' },
      { title: 'Setup OTA Firmware Updates for ESP32', desc: 'Implement Over-The-Air updates so your IoT device can be updated without USB.', ytQuery: 'ESP32 OTA update project tutorial from scratch', effort: '~1 hr' }
    ],
    cybersec: [
      { title: 'Build a Network Port Scanner in Python', desc: 'Create a multithreaded TCP port scanner from scratch using Python sockets.', ytQuery: 'python port scanner from scratch project tutorial', effort: '~1 hr' },
      { title: 'Write a Password Strength Analyser', desc: 'Build a tool that checks password entropy, patterns, and breach lists via API.', ytQuery: 'password strength checker python project build tutorial', effort: '~1 hr' },
      { title: 'Solve a Beginner CTF Challenge', desc: 'Complete a TryHackMe or HackTheBox beginner box and document your methodology.', ytQuery: 'TryHackMe beginner CTF walkthrough tutorial hacking', effort: '~2 hr' },
      { title: 'Build a Packet Sniffer with Scapy', desc: 'Use Python Scapy to capture and parse HTTP/DNS packets on your local network.', ytQuery: 'python packet sniffer scapy project build tutorial', effort: '~1.5 hr' },
      { title: 'Implement a Caesar Cipher & Cracker', desc: 'Code Caesar cipher encryption and a brute-force frequency analysis cracker.', ytQuery: 'caesar cipher python project build from scratch', effort: '~1 hr' },
      { title: 'Perform SQL Injection on a Vulnerable App', desc: 'Set up DVWA locally and exploit SQL injection vulnerabilities step by step.', ytQuery: 'SQL injection DVWA tutorial ethical hacking practice', effort: '~1.5 hr' },
      { title: 'Build a Log Analyser for Intrusion Detection', desc: 'Parse Apache/Nginx logs with Python to detect suspicious IP patterns.', ytQuery: 'python log analyzer intrusion detection project tutorial', effort: '~1.5 hr' }
    ],
    webdev: [
      { title: 'Build a REST API with Node.js & Express', desc: 'Create a full CRUD API with Express, MongoDB, and Mongoose with authentication.', ytQuery: 'build REST API node express mongodb project tutorial', effort: '~2 hr' },
      { title: 'Create a Real-Time Chat App with Socket.io', desc: 'Build a multi-room chat application with WebSocket connections via Socket.io.', ytQuery: 'real time chat app socket.io node.js project build tutorial', effort: '~2 hr' },
      { title: 'Build a Full-Stack Todo App with React & Node', desc: 'Create a production-ready todo app with React frontend, Express API, and MongoDB.', ytQuery: 'full stack todo app react node mongodb project tutorial', effort: '~3 hr' },
      { title: 'Deploy a Next.js App to Vercel', desc: 'Build a blog with Next.js App Router, Markdown posts, and deploy it live.', ytQuery: 'nextjs blog app router deploy vercel project tutorial', effort: '~2 hr' },
      { title: 'Implement JWT Authentication from Scratch', desc: 'Build login/register with bcrypt password hashing and JWT token issuance.', ytQuery: 'JWT authentication node express from scratch project tutorial', effort: '~2 hr' },
      { title: 'Create a Weather Dashboard with an API', desc: 'Fetch OpenWeatherMap data and display a responsive dashboard with charts.', ytQuery: 'weather app javascript API project build tutorial', effort: '~1.5 hr' },
      { title: 'Build a Stripe Payment Integration', desc: 'Integrate Stripe checkout into a React/Node app with webhook handling.', ytQuery: 'stripe payment integration react node project tutorial', effort: '~2 hr' }
    ]
  };

  const base = map[skillKey] || map.aiml;
  return base.map((t, i) => ({
    ...t,
    id: `static-${skillKey}-${level}-${i}`,
    level,
    watchSegment: t.watchSegment || effortToSegment(t.effort),
    source: 'static'
  }));
}

module.exports = { generateTasks };
