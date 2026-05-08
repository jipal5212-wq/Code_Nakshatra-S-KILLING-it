/**
 * AI Evaluation Routes — Auto-evaluate + auto-accept/reject + auto-award points
 * Fixed: handles already-accepted bundles, missing DB columns, bundleKey lookup
 */
const express = require('express');
const { requireUser } = require('../middleware/requireUser');
const { evaluateSubmission } = require('../services/aiEvalService');
const { mapTaskRow } = require('./mapTask');

module.exports = function aiEvalRoutes(admin, geminiModel) {
  const r = express.Router();

  r.post('/api/ai/auto-evaluate', requireUser, async (req, res) => {
    try {
      const uid = req.user.id;
      const bundleKey = req.body?.bundleKey;

      console.log('[ai-eval] Starting auto-evaluate for user', uid, 'bundleKey:', bundleKey || '(none)');

      // ── 1. Find the submission bundle ──
      let bundle = null;

      // Try by bundleKey first
      if (bundleKey) {
        const { data, error } = await admin
          .from('submission_bundles')
          .select('*')
          .eq('user_id', uid)
          .eq('cycle_start_iso', bundleKey)
          .maybeSingle();
        if (error) console.warn('[ai-eval] bundleKey lookup error:', error.message);
        bundle = data;
      }

      // Fallback: most recent submission (any status that's not accepted)
      if (!bundle) {
        const { data, error } = await admin
          .from('submission_bundles')
          .select('*')
          .eq('user_id', uid)
          .in('status', ['pending_review', 'rejected'])
          .order('updated_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        if (error) console.warn('[ai-eval] fallback lookup error:', error.message);
        bundle = data;
      }

      // Last resort: get the absolute latest submission regardless of status
      if (!bundle) {
        const { data, error } = await admin
          .from('submission_bundles')
          .select('*')
          .eq('user_id', uid)
          .order('updated_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        if (error) console.warn('[ai-eval] last-resort lookup error:', error.message);
        bundle = data;
      }

      if (!bundle) {
        console.log('[ai-eval] No submission found for user', uid);
        return res.status(404).json({ error: 'No submission found. Upload your work first.' });
      }

      console.log('[ai-eval] Found bundle:', bundle.id, 'status:', bundle.status, 'files:', bundle.file_paths?.length || 0);

      // If already accepted, still run evaluation but don't re-award points
      const alreadyAccepted = bundle.status === 'accepted';

      // Check content
      const hasContent = (bundle.file_paths?.length > 0)
        || bundle.github_url || bundle.live_url
        || bundle.demo_video_url || (bundle.screenshot_urls?.length > 0);

      if (!hasContent) {
        return res.status(400).json({ error: 'No files or URLs to evaluate. Upload your code first.' });
      }

      // ── 2. Get task details ──
      let task = { title: 'Unknown Task', domain: 'General', level: 'Beginner', description: '', objective: '', expected_output: '' };
      if (bundle.task_id) {
        const { data: t } = await admin.from('tasks').select('*').eq('id', bundle.task_id).maybeSingle();
        if (t) task = t;
      }
      // Also try to get task from session (user_cycle_state)
      if (!bundle.task_id || task.title === 'Unknown Task') {
        const { data: cs } = await admin.from('user_cycle_state').select('locked_task_id').eq('user_id', uid).maybeSingle();
        if (cs?.locked_task_id) {
          const { data: t2 } = await admin.from('tasks').select('*').eq('id', cs.locked_task_id).maybeSingle();
          if (t2) task = t2;
        }
      }

      console.log('[ai-eval] Task:', task.title, '| Level:', task.level, '| Domain:', task.domain);

      // ── 3. Run AI evaluation ──
      const evaluation = await evaluateSubmission(geminiModel, task, bundle);

      if (evaluation.verdict === 'error') {
        console.error('[ai-eval] Gemini error:', evaluation.error);
        return res.json({ ok: false, evaluation, task: mapTaskRow(task) });
      }

      // ── DEFERRED → Admin review (binary files, too large, etc.) ──
      if (evaluation.verdict === 'deferred') {
        console.log('[ai-eval] Deferred to admin:', evaluation.deferred_reason, '| Files:', evaluation.deferred_files?.join(', '));
        if (!alreadyAccepted) {
          const updatePayload = {
            status: 'pending_review',
            admin_feedback: `⏳ Awaiting admin review — ${evaluation.deferred_reason === 'binary_files' ? 'Binary file(s) submitted, AI cannot read' : 'Large/complex submission'}. Files: ${(evaluation.deferred_files || []).join(', ')}`,
            points_awarded: 0,
            updated_at: new Date().toISOString()
          };
          await admin.from('submission_bundles').update(updatePayload).eq('id', bundle.id);
          try {
            await admin.from('submission_bundles').update({ ai_evaluation: evaluation }).eq('id', bundle.id);
          } catch (_) {}
        }
        return res.json({
          ok: true,
          evaluation,
          task: mapTaskRow(task),
          submissionStatus: 'deferred'
        });
      }

      console.log('[ai-eval] Score:', evaluation.score, '| Verdict:', evaluation.verdict, '| Points:', evaluation.points_awarded);

      // ── 4. Update submission in DB ──
      if (!alreadyAccepted) {
        const newStatus = evaluation.verdict === 'accepted' ? 'accepted'
          : evaluation.verdict === 'rejected' ? 'rejected'
          : 'pending_review';

        // Build update payload WITHOUT ai_evaluation (column may not exist)
        const updatePayload = {
          status: newStatus,
          admin_feedback: `🤖 AI Auto-Review: ${evaluation.feedback || evaluation.summary || 'Evaluated'}`,
          points_awarded: evaluation.points_awarded || 0,
          reviewed_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        };

        const { error: updateErr } = await admin
          .from('submission_bundles')
          .update(updatePayload)
          .eq('id', bundle.id);

        if (updateErr) {
          console.warn('[ai-eval] Bundle update error:', updateErr.message);
        }

        // Try to store ai_evaluation JSON separately (column may not exist)
        try {
          await admin.from('submission_bundles').update({ ai_evaluation: evaluation }).eq('id', bundle.id);
        } catch (e) {
          console.warn('[ai-eval] ai_evaluation column not found, skipping storage');
        }

        // Award points to profile if accepted
        if (newStatus === 'accepted' && evaluation.points_awarded > 0) {
          try {
            const { data: prof } = await admin.from('profiles').select('points').eq('id', uid).single();
            const newPoints = (prof?.points || 0) + evaluation.points_awarded;
            await admin.from('profiles').update({ points: newPoints, updated_at: new Date().toISOString() }).eq('id', uid);
            evaluation.total_points = newPoints;
            console.log('[ai-eval] Points awarded:', evaluation.points_awarded, '→ Total:', newPoints);
          } catch (e) {
            console.warn('[ai-eval] Points update error:', e.message);
          }
        }
      } else {
        console.log('[ai-eval] Bundle already accepted, showing evaluation without re-awarding');
      }

      res.json({
        ok: true,
        evaluation,
        task: mapTaskRow(task),
        submissionStatus: alreadyAccepted ? 'accepted' : evaluation.verdict
      });
    } catch (e) {
      console.error('[ai-eval] FATAL:', e.message, e.stack);
      res.status(500).json({ error: 'AI evaluation error: ' + e.message });
    }
  });

  /* ── Task Steps Generator ───────────────────────────────────────── */
  r.post('/api/ai/task-steps', requireUser, async (req, res) => {
    try {
      const { title, desc, domain, level, effort } = req.body || {};
      if (!title) return res.status(400).json({ error: 'Task title required' });

      // Try Gemini first
      if (geminiModel) {
        try {
          const prompt = `You are a technical mentor for the S-KILLING IT learning platform.

Given this task, generate 6-8 detailed, actionable build steps that a ${level || 'Beginner'} student should follow.

TASK: ${title}
DESCRIPTION: ${desc || 'No description'}
DOMAIN: ${domain || 'General'}
LEVEL: ${level || 'Beginner'}
ESTIMATED TIME: ${effort || '~1 hr'}

Each step must be practical and specific to THIS task. Not generic advice.
Include what tools to open, what code to write, what to test.

Return ONLY valid JSON array — no markdown, no explanation:
[
  { "title": "Step title (3-6 words)", "body": "Detailed instruction (2-3 sentences, specific to the task)" }
]`;
          const result = await Promise.race([
            geminiModel.generateContent(prompt),
            new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 5000))
          ]);
          const text = result.response.text();
          const cleaned = text.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
          const match = cleaned.match(/\[\s*\{[\s\S]*\}\s*\]/);
          if (match) {
            const steps = JSON.parse(match[0]);
            if (Array.isArray(steps) && steps.length > 0) {
              return res.json({ ok: true, steps: steps.slice(0, 8) });
            }
          }
        } catch (e) {
          console.warn('[task-steps] Gemini failed:', e.message);
        }
      }

      // Fallback: generic steps
      res.json({ ok: true, steps: [
        { title: 'Set up your environment', body: 'Install required tools, libraries, and dependencies for ' + (title || 'the project') + '. Create your project folder and initialize files.' },
        { title: 'Watch the tutorial segment', body: 'Watch the highlighted portion of the tutorial video. Take notes on the key concepts and code patterns shown.' },
        { title: 'Build the core feature', body: 'Implement the main functionality: ' + (desc || title) + '. Follow along with the video but write the code yourself.' },
        { title: 'Add error handling', body: 'Add try-catch blocks, input validation, and edge case handling. Make your code robust and production-ready.' },
        { title: 'Add your own improvements', body: 'Go beyond the tutorial. Add unique features, better UI, comments, or optimizations that show your understanding.' },
        { title: 'Test everything', body: 'Run your code end-to-end. Fix any bugs. Take screenshots of the working output to include in your submission.' },
        { title: 'Submit your work', body: 'Upload your code file, paste your GitHub repo link, and add screenshots. The AI will auto-evaluate your submission and award points.' }
      ]});
    } catch (e) {
      console.error('[task-steps] Error:', e.message);
      res.status(500).json({ error: 'Failed to generate steps' });
    }
  });

  return r;
};
