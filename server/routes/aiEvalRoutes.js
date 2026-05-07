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
          // Don't fail — we still have the evaluation result
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

  return r;
};
