/* ============================================================
   FETEMI CONTENT SYSTEM — App Logic
   ============================================================ */

'use strict';

// ── State ─────────────────────────────────────────────────────
const state = {
  sessionId: null,
  inputType: 'idea',
  draftsResponse: null,
  publishResponse: null,
  isRequesting: false,       // double-click guard
};

// ── API Endpoints ──────────────────────────────────────────────
const API = {
  input: 'https://cohort2pod1.app.n8n.cloud/webhook/fetemi-input',
  selectDraft: 'https://cohort2pod1.app.n8n.cloud/webhook/fetemi-select-draft',
  publish: 'https://cohort2pod1.app.n8n.cloud/webhook/fetemi-publish',
};

const REQUEST_TIMEOUT_MS = 90000;
const MAX_RETRIES = 1;   // 1 auto-retry on transient network failure

// ── DOM helpers ────────────────────────────────────────────────
const $ = (id) => document.getElementById(id);
const qs = (sel) => document.querySelector(sel);
const qsa = (sel) => document.querySelectorAll(sel);

// ── Screen management ──────────────────────────────────────────
function showScreen(n) {
  qsa('.screen').forEach(s => s.classList.remove('active'));
  const target = $(`screen-${n}`);
  target.classList.add('active');
  target.classList.remove('hidden');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ── Overlay / spinner ──────────────────────────────────────────
function showOverlay(text = 'Loading…') {
  $('overlay-text').textContent = text;
  $('overlay').classList.remove('hidden');
}

function hideOverlay() {
  $('overlay').classList.add('hidden');
}

// ── Session ID generator ───────────────────────────────────────
function generateSessionId() {
  const ts = Date.now().toString(36);
  const rnd = Math.random().toString(36).slice(2, 8);
  return `fetemi-${ts}-${rnd}`;
}

// ── POST helper with timeout + auto-retry ─────────────────────
async function post(url, body, retries = MAX_RETRIES) {
  const attempt = async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      return res.json().catch(() => ({}));
    } catch (err) {
      clearTimeout(timer);
      if (err.name === 'AbortError') {
        throw new Error('Request timed out. Please check your connection and try again.');
      }
      throw err;
    }
  };

  for (let i = 0; i <= retries; i++) {
    try {
      return await attempt();
    } catch (err) {
      // Only retry on network/timeout errors, not HTTP 4xx/5xx
      const isTransient = err.name === 'TypeError' || err.message.includes('timed out') || err.message.includes('fetch');
      if (i < retries && isTransient) {
        await new Promise(r => setTimeout(r, 1500 * (i + 1))); // backoff
        continue;
      }
      throw err;
    }
  }
}

// ── Validators ────────────────────────────────────────────────
const MIN_IDEA_LENGTH = 20;
const MAX_IDEA_LENGTH = 1000;

function isValidUrl(str) {
  try {
    const u = new URL(str);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

function validateRecipients(raw) {
  const addresses = raw.split(/[,;]/).map(s => s.trim()).filter(Boolean);
  if (addresses.length === 0) return { ok: false, error: 'Please enter at least one recipient email address.' };
  const invalid = addresses.filter(a => !isValidEmail(a));
  if (invalid.length > 0) return { ok: false, error: `Invalid email address${invalid.length > 1 ? 'es' : ''}: ${invalid.join(', ')}` };
  return { ok: true, normalised: addresses.join(', ') };
}

function sanitiseText(str) {
  return str.replace(/<[^>]*>/g, '').trim();
}

// ── Page-leave warning ─────────────────────────────────────────
let warnOnLeave = false;
window.addEventListener('beforeunload', (e) => {
  if (warnOnLeave) {
    e.preventDefault();
    e.returnValue = '';
  }
});

// ── Inline error display (replaces alert()) ────────────────────
function showError(message, anchorEl = null) {
  // Remove any existing inline error near this anchor
  if (anchorEl) {
    const existing = anchorEl.parentElement.querySelector('.inline-error');
    if (existing) existing.remove();
  }

  const el = document.createElement('p');
  el.className = 'inline-error';
  el.setAttribute('role', 'alert');
  el.style.cssText = `
    color: #dc2626; font-size: 0.82rem; margin-top: 0.4rem;
    padding: 0.5rem 0.75rem; background: #fef2f2; border-radius: 8px;
    border-left: 3px solid #dc2626;
  `;
  el.textContent = message;

  if (anchorEl) {
    anchorEl.insertAdjacentElement('afterend', el);
    anchorEl.focus();
    setTimeout(() => el.remove(), 8000);
  } else {
    // Global error banner at top of current screen
    const screen = qs('.screen.active .screen-inner');
    const existing = screen && screen.querySelector('.global-error-banner');
    if (existing) existing.remove();
    el.className += ' global-error-banner';
    el.style.cssText += 'margin: 0 0 1rem 0;';
    if (screen) screen.prepend(el);
    setTimeout(() => el.remove(), 8000);
  }
}

function clearInlineErrors() {
  qsa('.inline-error').forEach(e => e.remove());
}

// ── Toast notification ─────────────────────────────────────────
function showToast(message, type = 'info') {
  let toast = $('toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'toast';
    toast.setAttribute('role', 'status');
    toast.setAttribute('aria-live', 'polite');
    toast.style.cssText = `
      position:fixed; bottom:1.5rem; left:50%; transform:translateX(-50%);
      padding:0.75rem 1.25rem; border-radius:10px; font-size:0.85rem;
      font-weight:500; z-index:9999; max-width:90vw; text-align:center;
      box-shadow:0 4px 20px rgba(0,0,0,0.15); transition:opacity 0.3s;
    `;
    document.body.appendChild(toast);
  }
  toast.textContent = message;
  toast.style.background = type === 'warn' ? '#f59e0b' : type === 'error' ? '#ef4444' : '#22c55e';
  toast.style.color = '#fff';
  toast.style.opacity = '1';
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => { toast.style.opacity = '0'; }, 4000);
}

/* ============================================================
   SCREEN 1 — Input Form
   ============================================================ */

// Live character hint for idea textarea
$('content-idea').addEventListener('input', () => {
  const len = $('content-idea').value.trim().length;
  let hint = $('idea-hint');
  if (!hint) {
    hint = document.createElement('p');
    hint.id = 'idea-hint';
    hint.style.cssText = 'font-size:0.78rem; margin-top:0.4rem;';
    $('content-idea').insertAdjacentElement('afterend', hint);
  }
  if (len === 0) {
    hint.textContent = '';
  } else if (len < MIN_IDEA_LENGTH) {
    hint.style.color = '#e74c3c';
    hint.textContent = `${MIN_IDEA_LENGTH - len} more character${MIN_IDEA_LENGTH - len !== 1 ? 's' : ''} needed`;
  } else if (len > MAX_IDEA_LENGTH) {
    hint.style.color = '#e74c3c';
    hint.textContent = `Too long — shorten by ${len - MAX_IDEA_LENGTH} character${len - MAX_IDEA_LENGTH !== 1 ? 's' : ''}`;
  } else {
    hint.style.color = '#22c55e';
    hint.textContent = '✓ Good length';
  }
  // Clear any prior inline error when user types
  const err = $('content-idea').parentElement.querySelector('.inline-error');
  if (err) err.remove();
});

// Toggle idea / URL
qsa('.toggle-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const type = btn.dataset.type;
    state.inputType = type;
    qsa('.toggle-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    clearInlineErrors();
    if (type === 'idea') {
      $('input-idea').classList.remove('hidden');
      $('input-url').classList.add('hidden');
    } else {
      $('input-url').classList.remove('hidden');
      $('input-idea').classList.add('hidden');
    }
  });
});

// Generate Drafts
$('btn-generate').addEventListener('click', async () => {
  if (state.isRequesting) return;

  clearInlineErrors();
  const idea = sanitiseText($('content-idea').value);
  const url = $('content-url').value.trim();

  // ── Input validation (inline errors, not alert()) ──
  if (state.inputType === 'idea') {
    if (!idea) {
      showError('Please enter a content idea before generating drafts.', $('content-idea'));
      return;
    }
    if (idea.length < MIN_IDEA_LENGTH) {
      showError(`Your idea is too short — add at least ${MIN_IDEA_LENGTH - idea.length} more character${MIN_IDEA_LENGTH - idea.length !== 1 ? 's' : ''}.`, $('content-idea'));
      return;
    }
    if (idea.length > MAX_IDEA_LENGTH) {
      showError(`Your idea is too long — shorten by ${idea.length - MAX_IDEA_LENGTH} character${idea.length - MAX_IDEA_LENGTH !== 1 ? 's' : ''}.`, $('content-idea'));
      return;
    }
  }

  if (state.inputType === 'url') {
    if (!url) {
      showError('Please enter a URL before generating drafts.', $('content-url'));
      return;
    }
    if (!isValidUrl(url)) {
      showError("That doesn't look like a valid URL. Please enter a full URL starting with https://", $('content-url'));
      return;
    }
  }

  // Lock UI
  state.isRequesting = true;
  warnOnLeave = true;
  $('btn-generate').disabled = true;
  state.sessionId = generateSessionId();

  const body = state.inputType === 'idea'
    ? { sessionId: state.sessionId, inputType: 'idea', contentIdea: idea }
    : { sessionId: state.sessionId, inputType: 'url', url };

  showOverlay('Generating your drafts… this can take up to 60 seconds.');

  try {
    const data = await post(API.input, body);

    // Validate that we actually got usable drafts before proceeding
    const drafts = parseDrafts(data);
    const hasRealContent = drafts.some(d => d.content && !d.content.startsWith('[Draft'));
    if (!hasRealContent) {
      throw new Error('The AI did not return any draft content or this idea has already been documented. Please try again.');
    }

    state.draftsResponse = data;
    hideOverlay();
    renderDraftScreen(data);
    showScreen(2);
  } catch (err) {
    hideOverlay();
    console.error('Generate drafts error:', err);
    showError(`Could not generate drafts: ${err.message}`, $('btn-generate'));
  } finally {
    state.isRequesting = false;
    $('btn-generate').disabled = false;
  }
});

/* ============================================================
   SCREEN 2 — Draft Review
   ============================================================ */

function parseDrafts(data) {
  if (data?.drafts && Array.isArray(data.drafts)) return data.drafts;

  if (Array.isArray(data)) {
    if (data[0]?.angle) return data;
    if (typeof data[0] === 'string') {
      const labels = ['Problem/Solution Approach', 'Data/Insight Approach', 'How-To/Practical Approach'];
      return data.slice(0, 3).map((content, i) => ({ angle: labels[i] || `Draft ${i + 1}`, content }));
    }
  }

  const angleFallbacks = ['Problem/Solution Approach', 'Data/Insight Approach', 'How-To/Practical Approach'];
  const values = Object.values(data).filter(v => typeof v === 'string' && v.length > 20);
  if (values.length >= 3) {
    return values.slice(0, 3).map((content, i) => ({ angle: angleFallbacks[i], content }));
  }

  // Return fallback markers — caller must check for these
  return angleFallbacks.map((angle, i) => ({
    angle,
    content: `[Draft ${i + 1} content not available — check API response format]`,
  }));
}

function renderDraftScreen(data) {
  const drafts = parseDrafts(data);
  const container = $('drafts-container');
  container.innerHTML = '';

  // Show an error card if any draft failed to populate
  const failedIndexes = drafts.filter(d => d.content.startsWith('[Draft'));
  if (failedIndexes.length > 0) {
    const warn = document.createElement('p');
    warn.style.cssText = 'color:#b45309;background:#fffbeb;border-left:3px solid #f59e0b;padding:0.6rem 0.9rem;border-radius:8px;font-size:0.85rem;margin-bottom:1rem;';
    warn.textContent = `Warning: ${failedIndexes.length} draft(s) could not be loaded. You can still select the others.`;
    container.appendChild(warn);
  }

  drafts.forEach((draft, idx) => {
    const isBroken = draft.content.startsWith('[Draft');
    const card = document.createElement('div');
    card.className = 'draft-card' + (isBroken ? ' draft-card--error' : '');
    if (isBroken) card.style.opacity = '0.5';
    card.innerHTML = `
      <div class="draft-angle">${escapeHtml(draft.angle)}</div>
      <div class="draft-body">${isBroken ? `<em>${escapeHtml(draft.content)}</em>` : DOMPurify.sanitize(marked.parse(stripFencedCodeBlock(draft.content)))}</div>
      <button class="btn-select" id="select-draft-${idx}" data-index="${idx}" ${isBroken ? 'disabled' : ''}>
        ${isBroken ? 'Unavailable' : 'Select This Draft'}
      </button>
    `;
    container.appendChild(card);
  });

  container.querySelectorAll('.btn-select:not([disabled])').forEach(btn => {
    btn.addEventListener('click', () => {
      container.querySelectorAll('.btn-select').forEach(b => b.disabled = true);
      selectDraft(drafts, parseInt(btn.dataset.index));
    });
  });
}

async function selectDraft(drafts, index) {
  if (state.isRequesting) return;
  state.isRequesting = true;

  const chosen = drafts[index];
  showOverlay('Adapting your content for each platform…');

  try {
    const body = {
      sessionId: state.sessionId,
      selectedDraft: chosen.content,
      draftAngle: chosen.angle,
    };
    const data = await post(API.selectDraft, body);

    // Validate platform content came back
    const platforms = parsePlatforms(data);
    if (!platforms.linkedin && !platforms.twitter && !platforms.email.body) {
      throw new Error('Platform content was not returned. Please try selecting the draft again.');
    }

    state.publishResponse = data;
    hideOverlay();
    renderPublishScreen(data);
    showScreen(3);
  } catch (err) {
    hideOverlay();
    console.error('Select draft error:', err);
    showError(`Could not adapt content: ${err.message}`);
    $('drafts-container').querySelectorAll('.btn-select:not([disabled])').forEach(b => b.disabled = false);
  } finally {
    state.isRequesting = false;
  }
}

// Back button with confirmation
$('btn-back-s2').addEventListener('click', () => {
  if (confirm('Go back? Your generated drafts will be lost.')) {
    clearInlineErrors();
    showScreen(1);
  }
});

/* ============================================================
   SCREEN 3 — Preview & Publish
   ============================================================ */

function parsePlatforms(data) {
  const d = Array.isArray(data) ? data[0] : data;
  const p = d?.platforms || d;
  return {
    linkedin: p?.linkedin || p?.LinkedIn || '',
    twitter: p?.twitter || p?.Twitter || p?.x || p?.X || '',
    email: {
      subject: p?.email?.subject || p?.emailSubject || p?.subject || '',
      body: p?.email?.body || p?.emailBody || (typeof p?.email === 'string' ? p.email : ''),
    },
  };
}

function renderPublishScreen(data) {
  const platforms = parsePlatforms(data);

  $('linkedin-content').value = stripMarkdown(platforms.linkedin);

  // Auto-trim Twitter to 280 if AI returned more
  let twitterText = stripMarkdown(platforms.twitter);
  if (twitterText.length > 280) {
    twitterText = twitterText.slice(0, 277) + '…';
    showToast('X (Twitter) post was trimmed to 280 characters. Please review before publishing.', 'warn');
  }
  $('twitter-content').value = twitterText;

  $('email-subject').value = platforms.email.subject;
  $('email-body').value = stripMarkdown(platforms.email.body);

  updateCharCount('linkedin');
  updateCharCount('twitter');

  // Reset publish states
  ['linkedin', 'twitter', 'email'].forEach(p => {
    publishedPlatforms[p] = false;
    $(`action-${p}`).classList.remove('published', 'scheduled');
    const btn = $(`btn-publish-${p}`);
    btn.classList.remove('done', 'scheduled-btn');
    btn.disabled = false;
    $(`status-${p}`).textContent = 'Ready to publish';
  });

  // Reset schedule
  $('schedule-toggle').checked = false;
  $('schedule-fields').classList.add('hidden');
  $('schedule-date').value = '';
  $('schedule-time').value = '';
  $('schedule-preview').textContent = '';
  updatePublishButtonLabels();

  $('success-banner').classList.add('hidden');
  clearInlineErrors();
}

// Tab switching
qsa('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const tab = btn.dataset.tab;
    qsa('.tab-btn').forEach(b => { b.classList.remove('active'); b.setAttribute('aria-selected', 'false'); });
    btn.classList.add('active');
    btn.setAttribute('aria-selected', 'true');
    qsa('.tab-panel').forEach(p => p.classList.add('hidden'));
    $(`panel-${tab}`).classList.remove('hidden');
  });
});

// Live char counts
function updateCharCount(platform) {
  const limits = { linkedin: 3000, twitter: 280 };
  const el = $(platform + '-content');
  const countEl = $('count-' + platform);
  if (!el || !countEl) return;
  const len = el.value.length;
  countEl.textContent = `${len} / ${limits[platform]}`;
  countEl.classList.toggle('over', len > limits[platform]);
}

$('linkedin-content').addEventListener('input', () => updateCharCount('linkedin'));
$('twitter-content').addEventListener('input', () => {
  updateCharCount('twitter');
  const len = $('twitter-content').value.length;
  if (len > 280) showToast(`X post is ${len - 280} character${len - 280 !== 1 ? 's' : ''} over the 280 limit.`, 'warn');
});

// ── Schedule toggle ────────────────────────────────────────────
$('schedule-toggle').addEventListener('change', () => {
  const on = $('schedule-toggle').checked;
  $('schedule-fields').classList.toggle('hidden', !on);
  updatePublishButtonLabels();
  updateSchedulePreview();
});

function updateSchedulePreview() {
  const date = $('schedule-date').value;
  const time = $('schedule-time').value;
  const preview = $('schedule-preview');

  if (!date || !time) {
    preview.style.color = '#e74c3c';
    preview.textContent = date || time ? 'Please fill in both date and time.' : '';
    return;
  }

  const dt = new Date(`${date}T${time}`);
  if (dt <= new Date()) {
    preview.style.color = '#e74c3c';
    preview.textContent = '⚠ Scheduled time is in the past. Please choose a future date and time.';
    return;
  }

  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  preview.style.color = '';
  preview.textContent = `Scheduled for ${dt.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })} (${tz})`;
}

$('schedule-date').addEventListener('change', updateSchedulePreview);
$('schedule-time').addEventListener('change', updateSchedulePreview);

function isScheduled() { return $('schedule-toggle').checked; }

function getScheduledAt() {
  const date = $('schedule-date').value;
  const time = $('schedule-time').value;
  if (!date || !time) return null;
  return new Date(`${date}T${time}`).toISOString();
}

function updatePublishButtonLabels() {
  const scheduled = isScheduled();
  $('btn-linkedin-label').textContent = scheduled ? 'Schedule' : 'Post';
  $('btn-twitter-label').textContent = scheduled ? 'Schedule' : 'Post';
  $('btn-email-label').textContent = scheduled ? 'Schedule' : 'Send';
  $('btn-publish-all-label').textContent = scheduled ? 'Schedule All Platforms' : 'Publish All Platforms';
}

// ── Platform publish state ─────────────────────────────────────
const publishedPlatforms = { linkedin: false, twitter: false, email: false };

function markPlatformDone(platform, scheduled = false) {
  publishedPlatforms[platform] = true;
  const card = $(`action-${platform}`);
  const btn = $(`btn-publish-${platform}`);
  const status = $(`status-${platform}`);

  if (scheduled) {
    card.classList.add('scheduled');
    btn.classList.add('scheduled-btn');
    const dt = new Date(getScheduledAt());
    status.textContent = `Scheduled for ${dt.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}`;
  } else {
    card.classList.add('published');
    btn.classList.add('done');
    status.textContent = 'Published ✓';
  }
  btn.disabled = true;

  if (Object.values(publishedPlatforms).every(Boolean)) {
    warnOnLeave = false;
    $('success-message').textContent = isScheduled()
      ? 'All platforms scheduled successfully!'
      : 'Your content has been published to all platforms.';
    $('success-banner').classList.remove('hidden');
    $('success-banner').scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
}

// ── Build & validate publish payload ──────────────────────────
function buildPayload(platforms = ['linkedin', 'twitter', 'email']) {
  clearInlineErrors();
  const scheduled = isScheduled();
  const scheduledAt = getScheduledAt();

  // Schedule validations
  if (scheduled) {
    if (!scheduledAt) {
      showError('Please set both a date and time for scheduling.', $('schedule-date'));
      return null;
    }
    if (new Date(scheduledAt) <= new Date()) {
      showError('Scheduled time is in the past. Please choose a future date and time.', $('schedule-date'));
      return null;
    }
  }

  // Empty content checks
  if (platforms.includes('linkedin') && !$('linkedin-content').value.trim()) {
    qs('[data-tab="linkedin"]').click();
    showError('LinkedIn content is empty. Please add content before publishing.', $('linkedin-content'));
    return null;
  }
  if (platforms.includes('twitter')) {
    const twitterVal = $('twitter-content').value.trim();
    if (!twitterVal) {
      qs('[data-tab="twitter"]').click();
      showError('X (Twitter) content is empty. Please add content before publishing.', $('twitter-content'));
      return null;
    }
    if (twitterVal.length > 280) {
      qs('[data-tab="twitter"]').click();
      showError(`X (Twitter) post is ${twitterVal.length - 280} characters over the 280 limit. Please shorten it.`, $('twitter-content'));
      return null;
    }
  }

  // Email validations
  if (platforms.includes('email')) {
    const recipient = $('recipient-email').value.trim();
    if (!recipient) {
      showError('Please enter a recipient email address before sending.', $('recipient-email'));
      return null;
    }
    const recipientCheck = validateRecipients(recipient);
    if (!recipientCheck.ok) {
      showError(recipientCheck.error, $('recipient-email'));
      return null;
    }
    if (!$('email-subject').value.trim()) {
      qs('[data-tab="email"]').click();
      showError('Email subject is empty. Please add a subject before sending.', $('email-subject'));
      return null;
    }
    if (!$('email-body').value.trim()) {
      qs('[data-tab="email"]').click();
      showError('Email body is empty. Please add content before sending.', $('email-body'));
      return null;
    }
  }

  const payload = {
    sessionId: state.sessionId,
    action: scheduled ? 'schedule' : 'publish',
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    ...(scheduled && { scheduledAt }),
  };

  if (platforms.includes('linkedin')) payload.linkedin = $('linkedin-content').value.trim();
  if (platforms.includes('twitter')) payload.twitter = $('twitter-content').value.trim();
  if (platforms.includes('email')) {
    const recipientCheck = validateRecipients($('recipient-email').value.trim());
    payload.email = {
      subject: $('email-subject').value.trim(),
      body: $('email-body').value.trim(),
      recipientList: recipientCheck.normalised,
    };
  }

  return payload;
}

// ── Individual platform publish ────────────────────────────────
['linkedin', 'twitter', 'email'].forEach(platform => {
  $(`btn-publish-${platform}`).addEventListener('click', async () => {
    if (state.isRequesting) return;

    const payload = buildPayload([platform]);
    if (!payload) return;

    state.isRequesting = true;
    const label = $(`btn-${platform}-label`);
    const original = label.textContent;
    label.textContent = 'Sending…';
    $(`btn-publish-${platform}`).disabled = true;

    try {
      await post(API.publish, payload);
      markPlatformDone(platform, isScheduled());
      showToast(`${platform.charAt(0).toUpperCase() + platform.slice(1)} ${isScheduled() ? 'scheduled' : 'published'} successfully!`);
    } catch (err) {
      console.error(`Publish ${platform} error:`, err);
      label.textContent = original;
      $(`btn-publish-${platform}`).disabled = false;
      showError(`Failed to publish to ${platform}: ${err.message} (Your other platforms were not affected.)`);
    } finally {
      state.isRequesting = false;
    }
  });
});

// ── Publish All ────────────────────────────────────────────────
$('btn-publish-all').addEventListener('click', async () => {
  if (state.isRequesting) return;

  const payload = buildPayload(['linkedin', 'twitter', 'email']);
  if (!payload) return;

  state.isRequesting = true;
  $('btn-publish-all').disabled = true;
  showOverlay(isScheduled() ? 'Scheduling all platforms…' : 'Publishing to all platforms…');

  try {
    await post(API.publish, payload);
    hideOverlay();
    ['linkedin', 'twitter', 'email'].forEach(p => {
      if (!publishedPlatforms[p]) markPlatformDone(p, isScheduled());
    });
  } catch (err) {
    hideOverlay();
    console.error('Publish all error:', err);
    showError(`Something went wrong: ${err.message} — Please try again.`);
  } finally {
    state.isRequesting = false;
    $('btn-publish-all').disabled = false;
  }
});

// Back button with confirmation
$('btn-back-s3').addEventListener('click', () => {
  const anyPublished = Object.values(publishedPlatforms).some(Boolean);
  if (anyPublished) {
    if (!confirm('Go back? Some platforms have already been published in this session.')) return;
  }
  clearInlineErrors();
  showScreen(2);
});

// ── Helpers ───────────────────────────────────────────────────
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function stripFencedCodeBlock(str) {
  return str
    .replace(/^```[\w]*\n?/m, '')
    .replace(/```\s*$/m, '')
    .trim();
}

function stripMarkdown(str) {
  if (!str) return '';
  return str
    .replace(/```[\s\S]*?```/g, '')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/\*(.*?)\*/g, '$1')
    .replace(/__(.*?)__/g, '$1')
    .replace(/_(.*?)_/g, '$1')
    .replace(/^#+\s/gm, '')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1')
    .replace(/^>\s?/gm, '')
    .trim();
}

// ── Initial boot ──────────────────────────────────────────────
showScreen(1);