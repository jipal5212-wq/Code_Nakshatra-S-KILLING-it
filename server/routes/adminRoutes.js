const express = require('express');
const jwt = require('jsonwebtoken');
const { requireSiteAdmin } = require('../middleware/requireSiteAdmin');
const { mapTaskRow } = require('./mapTask');
const { getCycleBounds } = require('../lib/cycleBounds');

function mapNewsRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    title: row.title,
    details: row.details,
    relatedTasks: row.related_tasks || '',
    imageUrl: row.image_url,
    createdAt: row.created_at
  };
}

module.exports = function adminRoutes(admin, upload) {
  const r = express.Router();

  r.post('/api/admin/site-login', (req, res) => {
    const pass = process.env.ADMIN_SITE_PASSWORD;
    const secret = process.env.ADMIN_JWT_SECRET;
    if (!pass || !secret)
      return res.status(503).json({ error: 'ADMIN_SITE_PASSWORD and ADMIN_JWT_SECRET must be set.' });
    if (String(req.body?.password || '') !== pass) return res.status(401).json({ error: 'Invalid password.' });
    const token = jwt.sign({ role: 'site_admin' }, secret, { expiresIn: '18h' });
    res.cookie('skilling_site_admin', token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: 18 * 3600 * 1000,
      path: '/'
    });
    res.json({ ok: true });
  });

  r.post('/api/admin/site-logout', (_req, res) => {
    res.clearCookie('skilling_site_admin', { path: '/' });
    res.json({ ok: true });
  });

  r.get('/api/admin/session', requireSiteAdmin, (_req, res) => {
    res.json({ ok: true, role: 'site_admin' });
  });

  r.post('/api/admin/be-relevant', requireSiteAdmin, upload.single('image'), async (req, res) => {
    try {
      const title = String(req.body?.title || '').trim();
      const details = String(req.body?.details || '').trim();
      const relatedTasks = String(req.body?.relatedTasks || '').trim();
      if (!title || !details) return res.status(400).json({ error: 'Title and details required.' });
      const imageUrl = req.file ? `/uploads/${req.file.filename}` : null;

      // 1. Insert into be_relevant_posts (existing system)
      const { data, error } = await admin
        .from('be_relevant_posts')
        .insert({
          title,
          details,
          related_tasks: relatedTasks,
          image_url: imageUrl
        })
        .select('*')
        .single();
      if (error) return res.status(500).json({ error: error.message });

      // 2. Also insert into tfeed_posts so it appears in T-Feed immediately
      const tagList = relatedTasks
        ? relatedTasks.split(/[,·\s]+/).map(t => t.trim()).filter(Boolean)
        : ['admin', 'news'];
      const tfeedFull = {
        title, summary: details, tags: tagList,
        domain: 'General', source_hint: 'Admin',
        article_url: '', image_url: imageUrl || '',
        pub_date: new Date().toISOString(),
        project_idea: '', project_stack: '', project_effort: '',
        like_count: 0, comment_count: 0
      };
      try {
        const { error: e1 } = await admin.from('tfeed_posts').insert(tfeedFull);
        if (e1 && (e1.code === '42703' || (e1.message||'').includes('article_url') || (e1.message||'').includes('pub_date'))) {
          // Columns not migrated yet — insert without new columns
          const { image_url, article_url, pub_date, ...legacy } = tfeedFull;
          await admin.from('tfeed_posts').insert(legacy);
        } else if (e1) {
          throw e1;
        }
      } catch (tfeedErr) {
        console.warn('[be-relevant] tfeed dual-write failed:', tfeedErr.message || tfeedErr);
      }

      res.json({ success: true, news: mapNewsRow(data) });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  r.get('/api/admin/users-with-pending', requireSiteAdmin, async (_req, res) => {
    try {
      const { data: bundles, error } = await admin
        .from('submission_bundles')
        .select('*')
        .eq('status', 'pending_review')
        .order('updated_at', { ascending: false });
      if (error) return res.status(500).json({ error: error.message });

      const userIds = [...new Set((bundles || []).map((b) => b.user_id))];
      const { data: profiles } = await admin.from('profiles').select('*').in('id', userIds);

      const profMap = Object.fromEntries((profiles || []).map((p) => [p.id, p]));

      const grouped = {};
      for (const b of bundles || []) {
        if (!grouped[b.user_id]) grouped[b.user_id] = { user: profMap[b.user_id] || { id: b.user_id }, submissions: [] };
        let task = null;
        if (b.task_id) {
          const { data: t } = await admin.from('tasks').select('*').eq('id', b.task_id).maybeSingle();
          task = t ? mapTaskRow(t) : null;
        }
        grouped[b.user_id].submissions.push({ ...b, task });
      }

      res.json({ groups: Object.values(grouped) });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  r.get('/api/admin/all-submissions', requireSiteAdmin, async (req, res) => {
    try {
      const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
      const statusFilter = req.query.status;
      let query = admin
        .from('submission_bundles')
        .select('*')
        .gte('updated_at', twoDaysAgo)
        .order('updated_at', { ascending: false })
        .limit(200);
      if (statusFilter && ['pending_review', 'accepted', 'rejected'].includes(statusFilter)) {
        query = query.eq('status', statusFilter);
      }
      const { data: bundles, error } = await query;
      if (error) return res.status(500).json({ error: error.message });

      const userIds = [...new Set((bundles || []).map(b => b.user_id))];
      let profMap = {};
      if (userIds.length) {
        const { data: profiles } = await admin.from('profiles').select('*').in('id', userIds);
        (profiles || []).forEach(p => { profMap[p.id] = p; });
      }
      const taskIds = [...new Set((bundles || []).map(b => b.task_id).filter(Boolean))];
      let taskMap = {};
      if (taskIds.length) {
        const { data: tasks } = await admin.from('tasks').select('*').in('id', taskIds);
        (tasks || []).forEach(t => { taskMap[t.id] = mapTaskRow(t); });
      }
      const submissions = (bundles || []).map(b => ({
        ...b,
        user: profMap[b.user_id] || { id: b.user_id },
        task: b.task_id ? (taskMap[b.task_id] || null) : null
      }));
      res.json({ submissions });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  r.post('/api/admin/review-submission', requireSiteAdmin, async (req, res) => {
    try {
      const submissionId = req.body?.submissionId;
      const status = req.body?.status === 'accepted' ? 'accepted' : 'rejected';
      const feedback = String(req.body?.feedback || '').slice(0, 2000);
      const points = Math.max(0, parseInt(req.body?.points || '0', 10) || 0);
      if (!submissionId) return res.status(400).json({ error: 'submissionId required' });

      const { data: row, error: fErr } = await admin
        .from('submission_bundles')
        .select('*')
        .eq('id', submissionId)
        .single();
      if (fErr || !row) return res.status(404).json({ error: 'Submission not found' });
      if (row.status === 'accepted') return res.status(400).json({ error: 'Already reviewed as accepted.' });

      if (status === 'accepted' && points > 0) {
        const { data: prof } = await admin.from('profiles').select('points').eq('id', row.user_id).single();
        const next = (prof?.points || 0) + points;
        await admin.from('profiles').update({ points: next, updated_at: new Date().toISOString() }).eq('id', row.user_id);
      }

      const { data: updated, error: uErr } = await admin
        .from('submission_bundles')
        .update({
          status,
          admin_feedback: feedback,
          points_awarded: status === 'accepted' ? points : 0,
          reviewed_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        })
        .eq('id', submissionId)
        .select('*')
        .single();
      if (uErr) return res.status(500).json({ error: uErr.message });

      res.json({ success: true, submission: updated });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  r.post('/api/admin/tasks', requireSiteAdmin, async (req, res) => {
    try {
      const { domain, level, title, desc, objective, watchSegment, expectedOutput, effort, ytQuery } = req.body;
      if (!title || !domain) return res.status(400).json({ error: 'Title and domain required' });
      const row = {
        domain,
        level: level || 'Beginner',
        title,
        description: desc || '',
        objective: objective || '',
        watch_segment: watchSegment || '',
        expected_output: expectedOutput || '',
        effort: effort || '~1 hr',
        yt_query: ytQuery || `${title} tutorial`
      };
      const { data, error } = await admin.from('tasks').insert(row).select('*').single();
      if (error) return res.status(500).json({ error: error.message });
      res.json({ success: true, task: mapTaskRow(data) });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // ── GET /api/admin/all-users ─────────────────────────────────────────────
  r.get('/api/admin/all-users', requireSiteAdmin, async (_req, res) => {
    try {
      const { data: profiles, error } = await admin
        .from('profiles')
        .select('*')
        .order('display_name', { ascending: true });
      if (error) return res.status(500).json({ error: error.message });

      const userIds = (profiles || []).map(p => p.id);
      let submCounts = {}, accCounts = {};
      if (userIds.length) {
        const { data: subs } = await admin
          .from('submission_bundles')
          .select('user_id, status')
          .in('user_id', userIds);
        (subs || []).forEach(s => {
          submCounts[s.user_id] = (submCounts[s.user_id] || 0) + 1;
          if (s.status === 'accepted') accCounts[s.user_id] = (accCounts[s.user_id] || 0) + 1;
        });
      }
      const users = (profiles || []).map(p => ({
        id: p.id,
        displayName: p.display_name || 'Unnamed',
        email: p.email || '',
        skillDomain: p.skill_domain || 'aiml',
        level: p.level || 'Beginner',
        points: p.points || 0,
        totalSubmissions: submCounts[p.id] || 0,
        acceptedSubmissions: accCounts[p.id] || 0,
        loopStartedAt: p.loop_started_at,
        updatedAt: p.updated_at
      }));
      res.json({ users });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // ── GET /api/admin/user/:id/history ─────────────────────────────────────
  r.get('/api/admin/user/:id/history', requireSiteAdmin, async (req, res) => {
    try {
      const uid = req.params.id;
      const { data: profile } = await admin.from('profiles').select('*').eq('id', uid).maybeSingle();
      const { data: bundles } = await admin
        .from('submission_bundles')
        .select('*')
        .eq('user_id', uid)
        .order('created_at', { ascending: false })
        .limit(20);
      const taskIds = [...new Set((bundles || []).map(b => b.task_id).filter(Boolean))];
      let taskMap = {};
      if (taskIds.length) {
        const { data: tasks } = await admin.from('tasks').select('*').in('id', taskIds);
        (tasks || []).forEach(t => { taskMap[t.id] = mapTaskRow(t); });
      }
      const history = (bundles || []).map(b => ({ ...b, task: b.task_id ? (taskMap[b.task_id] || null) : null }));
      res.json({ profile, history });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // ── POST /api/admin/assign-task ──────────────────────────────────────────
  r.post('/api/admin/assign-task', requireSiteAdmin, async (req, res) => {
    try {
      const { userId, taskId } = req.body || {};
      if (!userId || !taskId) return res.status(400).json({ error: 'userId and taskId required' });
      const { data: task } = await admin.from('tasks').select('*').eq('id', taskId).maybeSingle();
      if (!task) return res.status(404).json({ error: 'Task not found' });
      const b = getCycleBounds(Date.now());
      await admin.from('user_cycle_state').upsert({
        user_id: userId,
        cycle_start_iso: b.cycleStartISO,
        cycle_end_iso: b.cycleEndISO,
        selection_deadline_iso: b.selectionDeadlineISO,
        locked_task_id: taskId,
        auto_assigned: false,
        updated_at: new Date().toISOString()
      }, { onConflict: 'user_id' });
      res.json({ success: true, task: mapTaskRow(task) });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // ── POST /api/admin/tfeed-post ───────────────────────────────────────────
  r.post('/api/admin/tfeed-post', requireSiteAdmin, async (req, res) => {
    try {
      const { title, summary, domain, projectIdea, projectStack, projectEffort, tags, articleUrl, imageUrl } = req.body || {};
      if (!title || !summary) return res.status(400).json({ error: 'Title and summary required' });
      const tagList = Array.isArray(tags)
        ? tags
        : (tags ? String(tags).split(',').map(t => t.trim()).filter(Boolean) : ['admin', 'featured']);
      const row = {
        title: String(title).slice(0, 200),
        summary: String(summary).slice(0, 1000),
        domain: domain || 'General',
        tags: tagList,
        source_hint: 'Admin',
        article_url: articleUrl || '',
        image_url: imageUrl || '',
        pub_date: new Date().toISOString(),
        project_idea: projectIdea || '',
        project_stack: projectStack || '',
        project_effort: projectEffort || '~2 hrs',
        like_count: 0,
        comment_count: 0
      };
      let data, error;
      ({ data, error } = await admin.from('tfeed_posts').insert(row).select().single());
      if (error && (error.code === '42703' || (error.message||'').includes('article_url') || (error.message||'').includes('pub_date'))) {
        // Legacy schema fallback
        const { image_url, article_url, pub_date, ...legacyRow } = row;
        ({ data, error } = await admin.from('tfeed_posts').insert(legacyRow).select().single());
      }
      if (error) return res.status(500).json({ error: error.message });
      res.json({ success: true, post: data });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  /** Additional task submissions (from Explore / T-Feed) */
  r.get('/api/admin/additional-submissions', requireSiteAdmin, async (_req, res) => {
    try {
      const { data: bundles, error } = await admin
        .from('submission_bundles')
        .select('*, profiles(display_name, email, skill_domain, level)')
        .like('cycle_start_iso', 'additional:%')
        .order('updated_at', { ascending: false })
        .limit(100);
      if (error) return res.status(500).json({ error: error.message });
      res.json({ bundles: bundles || [] });
    } catch (e) {
      console.error('[additional-submissions]', e);
      res.status(500).json({ error: e.message });
    }
  });

  return r;
};
