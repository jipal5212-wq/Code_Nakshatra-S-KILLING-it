/**
 * AI Auto-Evaluation UI — Triggers automatically after file upload
 * No button needed. Shows score, verdict, points earned.
 */

function getScoreColor(score) {
  if (score >= 70) return '#22c55e';
  if (score >= 50) return '#ffc800';
  return '#e60000';
}

function esc(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/* ── Score Ring SVG ── */
function renderScoreRing(score) {
  var color = getScoreColor(score);
  var r = 75, circ = 2 * Math.PI * r;
  var offset = circ - (score / 100) * circ;
  return '<div class="score-ring-wrap"><div class="score-ring">'
    + '<svg viewBox="0 0 180 180"><circle class="score-ring-bg" cx="90" cy="90" r="' + r + '"/>'
    + '<circle class="score-ring-fill" cx="90" cy="90" r="' + r + '" stroke="' + color
    + '" stroke-dasharray="' + circ + '" stroke-dashoffset="' + offset + '"/></svg>'
    + '<div class="score-ring-center"><div class="score-number" style="color:' + color + '">' + score + '</div>'
    + '<div class="score-label" style="color:' + color + '">/ 100</div></div></div></div>';
}

/* ── Verdict Badge ── */
function renderVerdict(verdict, points, maxPoints, level) {
  var map = {
    accepted: { cls: 'verdict-pass', icon: '✅', text: 'ACCEPTED' },
    rejected: { cls: 'verdict-fail', icon: '✗', text: 'REJECTED' },
    needs_revision: { cls: 'verdict-revision', icon: '⚠', text: 'NEEDS REVISION' },
    deferred: { cls: 'verdict-deferred', icon: '⏳', text: 'SENT TO ADMIN' }
  };
  var v = map[verdict] || map.rejected;
  var html = '<div style="text-align:center;margin-bottom:28px">'
    + '<span class="verdict-badge ' + v.cls + '">' + v.icon + ' ' + v.text + '</span>';

  // Points display
  if (verdict === 'accepted' && points > 0) {
    html += '<div class="points-earned">'
      + '<div class="points-earned-number">+' + points + '</div>'
      + '<div class="points-earned-label">POINTS EARNED</div>'
      + '<div class="points-earned-level">' + esc(level || 'Beginner') + ' Task · Max ' + maxPoints + ' pts</div>'
      + '</div>';
  } else if (verdict === 'deferred') {
    html += '<div style="margin-top:12px;font-size:13px;color:rgba(245,158,11,.7)">'
      + 'Your submission is being reviewed by our admin team. Points (<strong style="color:#f59e0b">' + maxPoints + ' pts</strong>) will be awarded after review.</div>';
  } else if (verdict === 'rejected') {
    html += '<div style="margin-top:12px;font-size:13px;color:rgba(255,255,255,.4)">'
      + '0 points · Improve and re-upload to earn <strong style="color:#fff">' + maxPoints + ' pts</strong></div>';
  } else if (verdict === 'needs_revision') {
    html += '<div style="margin-top:12px;font-size:13px;color:rgba(255,200,0,.6)">'
      + 'Almost there! Fix issues and re-upload for <strong style="color:#ffc800">' + maxPoints + ' pts</strong></div>';
  }
  html += '</div>';
  return html;
}

/* ── Breakdown Grid ── */
function renderBreakdown(bd) {
  if (!bd) return '';
  var cats = [
    { key: 'correctness', label: 'Correctness', max: 25 },
    { key: 'completeness', label: 'Completeness', max: 25 },
    { key: 'quality', label: 'Code Quality', max: 25 },
    { key: 'effort', label: 'Effort', max: 25 }
  ];
  var html = '<div class="breakdown-grid">';
  cats.forEach(function(c) {
    var item = bd[c.key] || { score: 0, note: '' };
    var pct = Math.round((item.score / c.max) * 100);
    var color = getScoreColor(pct);
    html += '<div class="breakdown-card">'
      + '<div class="breakdown-label">' + esc(c.label) + '</div>'
      + '<div class="breakdown-score" style="color:' + color + '">' + item.score
      + '<span style="font-size:13px;color:rgba(255,255,255,.3)">/' + c.max + '</span></div>'
      + '<div class="breakdown-bar-wrap"><div class="breakdown-bar" style="width:' + pct + '%;background:' + color + '"></div></div>'
      + '<div class="breakdown-note">' + esc(item.note || '') + '</div></div>';
  });
  return html + '</div>';
}

/* ── Strengths / Improvements ── */
function renderLists(strengths, improvements) {
  var html = '<div class="eval-lists">';
  html += '<div class="eval-list-card"><div class="eval-list-title green">💪 Strengths</div><div class="eval-list strengths"><ul>';
  (strengths || []).forEach(function(s) { html += '<li>' + esc(s) + '</li>'; });
  if (!strengths || !strengths.length) html += '<li style="color:rgba(255,255,255,.25)">None identified</li>';
  html += '</ul></div></div>';
  html += '<div class="eval-list-card"><div class="eval-list-title amber">🔧 Improvements</div><div class="eval-list improvements"><ul>';
  (improvements || []).forEach(function(s) { html += '<li>' + esc(s) + '</li>'; });
  if (!improvements || !improvements.length) html += '<li style="color:rgba(255,255,255,.25)">None needed</li>';
  html += '</ul></div></div></div>';
  return html;
}

/* ── Full Result Render ── */
function renderAutoEvalResult(ev) {
  var html = '';

  // Deferred submissions show an admin-review card instead of score ring
  if (ev.verdict === 'deferred') {
    html += '<div style="text-align:center;padding:24px 0">' 
      + '<div style="font-size:3.5rem;margin-bottom:12px">📋</div>'
      + '<div style="font-family:var(--display-font,Barlow Condensed,sans-serif);font-weight:800;font-size:1.5rem;letter-spacing:.06em;color:#f59e0b;text-transform:uppercase">SUBMITTED FOR ADMIN REVIEW</div>'
      + '</div>';
    html += renderVerdict(ev.verdict, 0, ev.max_points || 10, ev.task_level);
    if (ev.summary) html += '<div class="eval-summary">' + esc(ev.summary) + '</div>';
    html += renderLists(ev.strengths, ev.improvements);
    if (ev.feedback) {
      html += '<div class="eval-feedback"><div class="eval-feedback-label">📝 Note</div>' + esc(ev.feedback) + '</div>';
    }
    if (ev.deferred_files && ev.deferred_files.length) {
      html += '<div style="margin-top:16px;font-size:.82rem;color:rgba(255,255,255,.35);text-align:center">Files received: ' + ev.deferred_files.map(function(f){return esc(f);}).join(', ') + '</div>';
    }
    return html;
  }

  html += renderScoreRing(ev.score || 0);
  html += renderVerdict(ev.verdict, ev.points_awarded || 0, ev.max_points || 10, ev.task_level);
  if (ev.summary) html += '<div class="eval-summary">' + esc(ev.summary) + '</div>';
  html += renderBreakdown(ev.breakdown);
  html += renderLists(ev.strengths, ev.improvements);
  if (ev.feedback) {
    html += '<div class="eval-feedback"><div class="eval-feedback-label">🤖 AI Feedback</div>' + esc(ev.feedback) + '</div>';
  }
  if (ev.evaluated_at) {
    html += '<div class="eval-confidence">Evaluated: ' + new Date(ev.evaluated_at).toLocaleString() + '</div>';
  }
  return html;
}

/* ── Auto-trigger after upload ── */
async function runAutoEvaluation(token, bundleKey) {
  var resultDiv = document.getElementById('evalResult');
  var statusDiv = document.getElementById('fileStatus');
  if (!resultDiv) return;

  // Show analyzing state
  resultDiv.style.display = 'block';
  resultDiv.innerHTML = '<div class="eval-loading">'
    + '<div class="eval-loading-spinner"></div>'
    + '<div class="eval-loading-title">🔬 AI IS ANALYZING YOUR CODE...</div>'
    + '<div class="eval-loading-sub">Checking correctness, completeness, quality & effort</div>'
    + '</div>';

  try {
    var body = {};
    if (bundleKey) body.bundleKey = bundleKey;

    var r = await fetch('/api/ai/auto-evaluate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      body: JSON.stringify(body)
    });
    var d = await r.json();

    if (!r.ok || !d.ok) {
      resultDiv.innerHTML = '<div style="text-align:center;padding:24px;color:var(--red);font-family:var(--display-font);font-weight:700;font-size:16px">'
        + '⚠ ' + esc(d.error || 'Evaluation failed. Please try re-uploading.') + '</div>';
      return;
    }

    resultDiv.innerHTML = renderAutoEvalResult(d.evaluation);

    // Update status div with verdict
    if (statusDiv && statusDiv.style.display !== 'none') {
      var ev = d.evaluation;
      if (ev.verdict === 'accepted') {
        statusDiv.style.background = 'rgba(34,197,94,.12)';
        statusDiv.style.color = '#22c55e';
        statusDiv.textContent = '✅ Task accepted! +' + (ev.points_awarded || 0) + ' points earned';
      } else if (ev.verdict === 'deferred') {
        statusDiv.style.background = 'rgba(245,158,11,.12)';
        statusDiv.style.color = '#f59e0b';
        statusDiv.textContent = '📋 Sent to admin for manual review — you\'ll get points once approved';
      } else if (ev.verdict === 'rejected') {
        statusDiv.style.background = 'rgba(230,0,0,.1)';
        statusDiv.style.color = '#e60000';
        statusDiv.textContent = '✗ Task rejected — review feedback below and try again';
      } else {
        statusDiv.style.background = 'rgba(255,200,0,.1)';
        statusDiv.style.color = '#ffc800';
        statusDiv.textContent = '⚠ Needs revision — close but not quite, see feedback below';
      }
    }

    // Update avatar points if accepted
    if (d.evaluation.verdict === 'accepted' && d.evaluation.total_points != null) {
      var newPts = d.evaluation.total_points;

      // 1. Update the avatar dropdown display on current page
      var ptEl = document.getElementById('avPts');
      if (ptEl) ptEl.textContent = newPts;

      // 2. Update the in-memory session object (if exists)
      if (typeof session !== 'undefined' && session) {
        session.points = newPts;
      }

      // 3. Persist to SkillingAuth localStorage so other pages pick it up
      try {
        if (window.SkillingAuth && window.SkillingAuth.readRaw) {
          var stored = window.SkillingAuth.readRaw();
          if (stored && stored.user) {
            stored.user.points = newPts;
            window.SkillingAuth.write(stored);
          }
        }
      } catch (_) {}
    }
  } catch (err) {
    resultDiv.innerHTML = '<div style="text-align:center;padding:24px;color:var(--red)">Network error. Try again.</div>';
  }
}
