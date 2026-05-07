const express = require('express');
const { requireUser } = require('../middleware/requireUser');
const { ensureUserCycle } = require('../services/cycleService');
const { normalizeSkillKey } = require('../lib/skills');
const { mapTaskRow } = require('./mapTask');

module.exports = function userRoutes(admin, upload) {
  const r = express.Router();

  /** Profile + onboarding skill */
  r.patch('/api/me/profile', requireUser, async (req, res) => {
    try {
      const uid = req.user.id;
      const patch = {};
      if (typeof req.body?.displayName === 'string')
        patch.display_name = req.body.displayName.trim().slice(0, 120);
      if (req.body?.skillDomain) patch.skill_domain = normalizeSkillKey(req.body.skillDomain);
      if (req.body?.level) patch.level = String(req.body.level);
      patch.updated_at = new Date().toISOString();

      await admin.from('profiles').update(patch).eq('id', uid);

      const { data: profile } = await admin.from('profiles').select('*').eq('id', uid).single();
      res.json({ profile });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: e.message });
    }
  });

  /** Start tracking loop explicitly (stores loop_started_at and syncs cycle) */
  r.post('/api/me/start-loop', requireUser, async (req, res) => {
    try {
      const uid = req.user.id;
      await admin.from('profiles').update({ loop_started_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq('id', uid);
      const { data: profile } = await admin.from('profiles').select('*').eq('id', uid).single();
      const cycle = await ensureUserCycle(admin, uid, profile);
      res.json({ ok: true, cycle, profile });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: e.message });
    }
  });

  /** Current cycle timers + locked task + selection window */
  r.get('/api/me/cycle', requireUser, async (req, res) => {
    try {
      const uid = req.user.id;
      const { data: profile } = await admin.from('profiles').select('*').eq('id', uid).single();
      const cycle = await ensureUserCycle(admin, uid, profile);
      res.json({ cycle, profile });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: e.message });
    }
  });

  r.post('/api/me/confirm-task', requireUser, async (req, res) => {
    try {
      const uid = req.user.id;
      const taskId = req.body?.taskId;
      if (!taskId) return res.status(400).json({ error: 'taskId required' });

      const { data: profile } = await admin.from('profiles').select('*').eq('id', uid).single();
      const cycleWrap = await ensureUserCycle(admin, uid, profile);
      const { data: tid } = await admin.from('tasks').select('id').eq('id', taskId).maybeSingle();
      if (!tid) return res.status(404).json({ error: 'Task not found' });

      await admin
        .from('user_cycle_state')
        .update({
          locked_task_id: taskId,
          auto_assigned: false,
          updated_at: new Date().toISOString()
        })
        .eq('user_id', uid);

      const { data: t } = await admin.from('tasks').select('*').eq('id', taskId).single();
      const freshCycle = await ensureUserCycle(admin, uid, profile);
      res.json({ ok: true, task: mapTaskRow(t), cycle: freshCycle });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: e.message });
    }
  });

  /** Merge proof fields on current cycle bundle */
  r.patch('/api/me/submission', requireUser, async (req, res) => {
    try {
      const uid = req.user.id;
      const { data: profile } = await admin.from('profiles').select('*').eq('id', uid).single();
      const cycleWrap = await ensureUserCycle(admin, uid, profile);
      const bounds = cycleWrap.bounds;
      const baseCycleStart = bounds.cycleStartISO;

      // Determine submission type + domain-scoped key
      const submissionType = req.body?.submission_type || 'daily'; // 'daily' | 'additional'
      const domain = req.body?.skill_domain || profile?.skill_domain || 'default';
      const taskId = req.body?.taskId || req.body?.task_id || '';

      // Each domain gets its own daily bundle; additional tasks get unique keys
      const cStart = submissionType === 'additional'
        ? `additional:${baseCycleStart}:${domain}:${taskId || Date.now()}`
        : `${baseCycleStart}:${domain}`;

      let { data: bundle } = await admin
        .from('submission_bundles')
        .select('*')
        .eq('user_id', uid)
        .eq('cycle_start_iso', cStart)
        .maybeSingle();

      // Only block re-submission if THIS exact bundle (same domain) is already approved
      if (bundle?.status === 'accepted')
        return res.status(400).json({ error: 'This task is already approved for today.' });

      function pick(next, fallback) {
        return typeof next === 'string' && next.trim()
          ? next.trim()
          : fallback ?? null;
      }
      let shots = [];
      if (Array.isArray(req.body?.screenshot_urls)) shots = req.body.screenshot_urls.filter(Boolean).slice(0, 10);
      if (typeof req.body?.screenshot_url === 'string' && req.body.screenshot_url) shots.push(req.body.screenshot_url);

      const nextTask = taskId || bundle?.task_id || cycleWrap.lockedTaskId || null;

      const nextShots =
        shots.length && bundle?.screenshot_urls?.length
          ? [...bundle.screenshot_urls.filter(Boolean), ...shots]
          : shots.length
            ? shots
            : bundle?.screenshot_urls?.length
              ? bundle.screenshot_urls
              : [];

      const upsertPayload = {
        user_id: uid,
        cycle_start_iso: cStart,
        task_id: nextTask,
        github_url: pick(req.body?.github_url, bundle?.github_url),
        live_url: pick(req.body?.live_url, bundle?.live_url),
        demo_video_url: pick(req.body?.demo_video_url, bundle?.demo_video_url),
        screenshot_urls: nextShots,
        file_paths: bundle?.file_paths || [],
        status: 'pending_review',
        admin_feedback: bundle?.admin_feedback || '',
        points_awarded: 0,
        reviewed_at: null,
        updated_at: new Date().toISOString()
      };

      await admin.from('submission_bundles').upsert(upsertPayload, { onConflict: 'user_id,cycle_start_iso' });

      const { data: refreshed } = await admin
        .from('submission_bundles')
        .select('*')
        .eq('user_id', uid)
        .eq('cycle_start_iso', cStart)
        .maybeSingle();

      res.json({ ok: true, bundle: refreshed, bundleKey: cStart });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: e.message });
    }
  });

  r.post('/api/me/submission/file', requireUser, upload.single('file'), async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ error: 'file required (field name file)' });
      const uid = req.user.id;
      const { data: profile } = await admin.from('profiles').select('*').eq('id', uid).single();
      const cycleWrap = await ensureUserCycle(admin, uid, profile);
      const baseCycleStart = cycleWrap.bounds.cycleStartISO;

      // Use the bundleKey sent by the client (set during PATCH /api/me/submission)
      // Falls back to domain-scoped daily key if not provided
      const domain = req.body?.skill_domain || profile?.skill_domain || 'default';
      const cStart = req.body?.bundleKey || `${baseCycleStart}:${domain}`;

      let { data: bundle } = await admin
        .from('submission_bundles')
        .select('*')
        .eq('user_id', uid)
        .eq('cycle_start_iso', cStart)
        .maybeSingle();

      // Allow re-upload even if previously accepted (for AI re-evaluation)
      const rel = `/uploads/${req.file.filename}`;
      const files = [rel]; // Fresh file list on new upload

      const upsertPayload = {
        user_id: uid,
        cycle_start_iso: cStart,
        task_id: bundle?.task_id || cycleWrap.lockedTaskId,
        github_url: bundle?.github_url ?? null,
        live_url: bundle?.live_url ?? null,
        demo_video_url: bundle?.demo_video_url ?? null,
        screenshot_urls: bundle?.screenshot_urls || [],
        file_paths: files,
        status: 'pending_review',
        admin_feedback: bundle?.admin_feedback || '',
        points_awarded: 0,
        reviewed_at: null,
        updated_at: new Date().toISOString()
      };

      await admin.from('submission_bundles').upsert(upsertPayload, { onConflict: 'user_id,cycle_start_iso' });
      res.json({ ok: true, path: rel, file_paths: files, bundleKey: cStart });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: e.message });
    }
  });

  /** Task history tiles for rewards dashboard */
  r.get('/api/me/submission-history', requireUser, async (req, res) => {
    try {
      const uid = req.user.id;
      const { data: rows } = await admin
        .from('submission_bundles')
        .select('*')
        .eq('user_id', uid)
        .order('created_at', { ascending: false })
        .limit(50);
      res.json({ bundles: rows || [] });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: e.message });
    }
  });

  r.get('/api/me/summary', requireUser, async (req, res) => {
    try {
      const uid = req.user.id;
      const { data: profile } = await admin.from('profiles').select('*').eq('id', uid).single();
      const cycle = await ensureUserCycle(admin, uid, profile);
      const { data: bundle } = await admin
        .from('submission_bundles')
        .select('*')
        .eq('user_id', uid)
        .eq('cycle_start_iso', cycle.bounds.cycleStartISO)
        .maybeSingle();

      res.json({
        profile,
        cycle,
        submission: bundle || null,
        reviewerNote: bundle?.admin_feedback || '',
        reviewerStatus: bundle?.status || 'none'
      });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: e.message });
    }
  });

  /** Progress analytics — aggregated from submission history */
  r.get('/api/me/analytics', requireUser, async (req, res) => {
    try {
      const uid = req.user.id;

      const { data: profile } = await admin.from('profiles').select('*').eq('id', uid).single();
      const { data: bundles } = await admin
        .from('submission_bundles')
        .select('*, tasks(domain)')
        .eq('user_id', uid)
        .order('cycle_start_iso', { ascending: true });

      const rows = bundles || [];

      // ── KPIs ──────────────────────────────────────────────────────────────
      const acceptedRows = rows.filter(b => b.status === 'accepted');
      const rejectedRows = rows.filter(b => b.status === 'rejected');
      const pendingRows  = rows.filter(b => b.status === 'pending_review');
      const totalPoints  = acceptedRows.reduce((s, b) => s + (b.points_awarded || 0), 0);

      // Domain-specific accepted count (for track progress reset on domain change)
      const currentDomain = (profile?.skill_domain || '').toLowerCase();
      const domainAcceptedRows = currentDomain ? acceptedRows.filter(b => {
        const td = String(b.tasks?.domain || '').toLowerCase();
        if (!td) return true; // no domain info — include
        if (currentDomain === 'aiml')        return td.includes('ai') || td.includes('ml');
        if (currentDomain === 'datascience') return td.includes('data');
        if (currentDomain === 'robotics')    return td.includes('robot');
        if (currentDomain === 'iot')         return td.includes('iot');
        if (currentDomain === 'cybersec')    return td.includes('cyber') || td.includes('sec');
        if (currentDomain === 'webdev')      return td.includes('web');
        return td.includes(currentDomain);
      }) : acceptedRows;

      // streak: consecutive accepted days (from newest going back)
      const acceptedDays = new Set(
        acceptedRows
          .filter(b => b.reviewed_at)
          .map(b => b.reviewed_at.slice(0, 10))
      );
      let bestStreak = 0, cur = 0;
      const today = new Date();
      for (let i = 0; i < 365; i++) {
        const d = new Date(today);
        d.setDate(d.getDate() - i);
        const ds = d.toISOString().slice(0, 10);
        if (acceptedDays.has(ds)) { cur++; bestStreak = Math.max(bestStreak, cur); }
        else if (i > 0) cur = 0;
      }

      // ── Points timeline (cumulative) ──────────────────────────────────────
      let cumulative = 0;
      const pointsTimeline = acceptedRows
        .filter(b => b.reviewed_at)
        .map(b => {
          cumulative += (b.points_awarded || 0);
          return { date: b.reviewed_at.slice(0, 10), cumulative, points: b.points_awarded || 0 };
        });

      // ── Activity heatmap (all submissions, last 90 days) ─────────────────
      const heatmapData = {};
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - 90);
      for (const b of rows) {
        const ds = (b.cycle_start_iso || '').slice(0, 10);
        if (!ds || new Date(ds) < cutoff) continue;
        heatmapData[ds] = (heatmapData[ds] || 0) + 1;
      }

      // ── Status breakdown ──────────────────────────────────────────────────
      const statusBreakdown = {
        accepted:       acceptedRows.length,
        rejected:       rejectedRows.length,
        pending_review: pendingRows.length
      };

      // ── Weekly accepted count (last 8 weeks) ──────────────────────────────
      const weeklyActivity = [];
      for (let w = 7; w >= 0; w--) {
        const wStart = new Date();
        wStart.setDate(wStart.getDate() - w * 7 - wStart.getDay());
        wStart.setHours(0, 0, 0, 0);
        const wEnd = new Date(wStart);
        wEnd.setDate(wEnd.getDate() + 7);
        const label = wStart.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
        const count = acceptedRows.filter(b => {
          if (!b.reviewed_at) return false;
          const d = new Date(b.reviewed_at);
          return d >= wStart && d < wEnd;
        }).length;
        weeklyActivity.push({ week: label, count });
      }

      res.json({
        kpis: {
          totalPoints,
          tasksCompleted: rows.length,
          acceptedCount: acceptedRows.length,
          domainAcceptedCount: domainAcceptedRows.length,
          rejectedCount: rejectedRows.length,
          bestStreak,
          level: profile?.level || 'Beginner',
          domain: profile?.skill_domain || '',
          displayName: profile?.display_name || ''
        },
        pointsTimeline,
        heatmapData,
        statusBreakdown,
        weeklyActivity
      });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: e.message });
    }
  });

  /** Admin: get all additional task submissions (from Explore / T-Feed) */
  r.get('/api/admin/additional-submissions', async (req, res) => {
    const pass = process.env.ADMIN_SITE_PASSWORD || '';
    const auth = req.headers['x-admin-password'] || '';
    if (!pass || auth !== pass) return res.status(401).json({ error: 'Unauthorized.' });
    try {
      const { data: bundles } = await admin
        .from('submission_bundles')
        .select('*, profiles(display_name, email, skill_domain, level)')
        .like('cycle_start_iso', 'additional:%')
        .order('updated_at', { ascending: false })
        .limit(100);
      res.json({ bundles: bundles || [] });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: e.message });
    }
  });

  return r;
};
