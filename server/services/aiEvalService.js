/**
 * AI Evaluation Service — Auto-grading with level-based points
 * Beginner = 10pts, Intermediate = 20pts, Advanced = 50pts
 */
const fs = require('fs');
const path = require('path');

const TEXT_EXTENSIONS = new Set([
  '.py','.js','.ts','.jsx','.tsx','.html','.css','.json','.md','.txt',
  '.ipynb','.java','.cpp','.c','.h','.rb','.go','.rs','.php','.sql',
  '.sh','.bat','.yaml','.yml','.xml','.csv','.r','.R','.swift','.kt',
  '.dart','.lua','.ino','.pde'
]);
const MAX_FILE_CHARS = 30000;

const POINTS_MAP = { 'Beginner': 10, 'Intermediate': 20, 'Advanced': 50 };

function getPointsForLevel(level) {
  if (!level) return 10;
  for (const [key, pts] of Object.entries(POINTS_MAP)) {
    if (level.toLowerCase().includes(key.toLowerCase())) return pts;
  }
  return 10;
}

function readFileContent(filePath) {
  try {
    const ext = path.extname(filePath).toLowerCase();
    if (!TEXT_EXTENSIONS.has(ext)) return { ext, content: null, reason: `Binary format (${ext})` };
    const absPath = path.isAbsolute(filePath)
      ? filePath
      : path.join(__dirname, '..', '..', filePath.replace(/^\//, ''));
    if (!fs.existsSync(absPath)) return { ext, content: null, reason: 'File not found' };
    let content = fs.readFileSync(absPath, 'utf-8');
    if (content.length > MAX_FILE_CHARS) content = content.slice(0, MAX_FILE_CHARS) + '\n... [TRUNCATED] ...';
    return { ext, content };
  } catch (err) {
    return { ext: path.extname(filePath), content: null, reason: err.message };
  }
}

function parseNotebook(content) {
  try {
    const nb = JSON.parse(content);
    let out = '';
    for (const cell of (nb.cells || [])) {
      const src = Array.isArray(cell.source) ? cell.source.join('') : (cell.source || '');
      out += `\n--- ${cell.cell_type === 'code' ? 'CODE' : 'MARKDOWN'} CELL ---\n${src}\n`;
      if (cell.cell_type === 'code' && cell.outputs) {
        for (const o of cell.outputs) {
          if (o.text) out += `[OUTPUT]: ${Array.isArray(o.text) ? o.text.join('') : o.text}\n`;
          if (o.data?.['text/plain']) {
            const t = o.data['text/plain'];
            out += `[OUTPUT]: ${Array.isArray(t) ? t.join('') : t}\n`;
          }
        }
      }
    }
    return out || content;
  } catch { return content; }
}

function buildEvalPrompt(task, fileContents, urls) {
  let prompt = `You are a strict but fair AI code reviewer for "S-KILLING IT" education platform.
Evaluate if this student's submission correctly completes the assigned task.

## TASK
- Title: ${task.title || 'Unknown'}
- Domain: ${task.domain || 'General'}
- Level: ${task.level || 'Beginner'}
- Description: ${task.description || task.desc || 'No description'}
- Objective: ${task.objective || 'Complete the task'}
- Expected Output: ${task.expected_output || task.expectedOutput || 'Working implementation'}

## CRITERIA (score each 0-25)
1. Correctness: Does code solve the task? Runs without errors?
2. Completeness: All required parts present?
3. Quality: Clean code, comments, best practices?
4. Effort: Shows genuine understanding and learning?

## SUBMISSION\n`;

  if (fileContents.length > 0) {
    prompt += '\n### Files:\n';
    for (const f of fileContents) {
      if (f.content) {
        let c = f.ext === '.ipynb' ? parseNotebook(f.content) : f.content;
        prompt += `\n**${f.name}** (${f.ext})\n\`\`\`\n${c}\n\`\`\`\n`;
      } else {
        prompt += `\n**${f.name}** — ${f.reason}\n`;
      }
    }
  }
  if (urls.github) prompt += `\n### GitHub: ${urls.github}\n`;
  if (urls.live) prompt += `### Live URL: ${urls.live}\n`;
  if (urls.video) prompt += `### Video: ${urls.video}\n`;
  if (urls.screenshots?.length) prompt += `### Screenshots: ${urls.screenshots.join(', ')}\n`;
  if (!fileContents.length && !urls.github && !urls.live && !urls.video)
    prompt += '\n⚠️ No files or URLs provided — incomplete submission.\n';

  prompt += `
## RESPOND WITH ONLY THIS JSON (no markdown wrapping):
{
  "score": <0-100>,
  "verdict": "accepted" | "rejected" | "needs_revision",
  "breakdown": {
    "correctness": { "score": <0-25>, "note": "<reason>" },
    "completeness": { "score": <0-25>, "note": "<reason>" },
    "quality": { "score": <0-25>, "note": "<reason>" },
    "effort": { "score": <0-25>, "note": "<reason>" }
  },
  "summary": "<2-3 sentence assessment>",
  "strengths": ["<str1>", "<str2>"],
  "improvements": ["<imp1>", "<imp2>"],
  "feedback": "<friendly message to student, max 100 words>"
}

SCORING: 70-100 → "accepted", 50-69 → "needs_revision", 0-49 → "rejected"
Be fair but rigorous. No code = score 0, verdict "rejected".`;
  return prompt;
}

async function evaluateSubmission(geminiModel, task, submission) {
  if (!geminiModel) {
    return { score: 0, verdict: 'error', error: 'AI not configured' };
  }

  const fileContents = [];
  for (const fp of (submission.file_paths || [])) {
    const name = path.basename(fp);
    const { ext, content, reason } = readFileContent(fp);
    fileContents.push({ name, ext, content, reason });
  }

  const urls = {
    github: submission.github_url || null,
    live: submission.live_url || null,
    video: submission.demo_video_url || null,
    screenshots: submission.screenshot_urls || []
  };

  const prompt = buildEvalPrompt(task, fileContents, urls);

  try {
    const result = await geminiModel.generateContent(prompt);
    const text = result.response.text();
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return { score: 0, verdict: 'error', error: 'AI parse failure' };

    const ev = JSON.parse(jsonMatch[0]);
    ev.score = Math.max(0, Math.min(100, parseInt(ev.score) || 0));

    // Force correct verdict based on score
    if (ev.score >= 70) ev.verdict = 'accepted';
    else if (ev.score >= 50) ev.verdict = 'needs_revision';
    else ev.verdict = 'rejected';

    // Calculate points
    const maxPoints = getPointsForLevel(task.level);
    ev.points_awarded = ev.verdict === 'accepted' ? maxPoints : 0;
    ev.max_points = maxPoints;
    ev.task_level = task.level || 'Beginner';
    ev.evaluated_at = new Date().toISOString();
    ev.files_analyzed = fileContents.length;

    return ev;
  } catch (err) {
    return { score: 0, verdict: 'error', error: err.message };
  }
}

module.exports = { evaluateSubmission, getPointsForLevel, POINTS_MAP };
