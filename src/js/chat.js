/* chat.js — AI Concept Assistant for Phase 1 */
/* Claude-powered chat that helps plan recording sessions. */
/* API key stored in localStorage, API calls proxied through Rust backend. */

var CONCEPT_SYSTEM_PROMPT = [
  'You are the SampleArchitect Concept Assistant — an expert in sampling instruments for virtual instrument creation.',
  'You help musicians plan recording sessions for building sample libraries.',
  '',
  'Your expertise includes:',
  '- Microphone techniques for every instrument family (strings, brass, woodwinds, percussion, keyboards, ethnic instruments)',
  '- Optimal note selection for chromatic sampling (which notes to record, how many octaves)',
  '- Velocity layer strategy (how many layers for realism vs. recording time tradeoff)',
  '- Round robin recommendations (how many repetitions per note)',
  '- Articulation planning (sustain, staccato, legato, pizzicato, harmonics, etc.)',
  '- Room acoustics and recording environment advice',
  '- File naming conventions using the SampleArchitect format: [Instrument]_[Articulation]_[Note][Octave]_v[Velocity]_rr[RoundRobin].wav',
  '',
  'When the user describes their instrument or project:',
  '1. Ask clarifying questions about their recording setup, available time, and quality goals',
  '2. Recommend a specific sampling plan: which notes, how many velocity layers, which articulations',
  '3. Generate the exact file naming convention they should use',
  '4. Provide mic placement guidance specific to their instrument',
  '5. Estimate total recording time',
  '',
  'Keep responses concise and actionable. Use short paragraphs, not long essays. You\'re a practical studio assistant, not a textbook.',
  '',
  'The SampleArchitect naming convention is:',
  '[Instrument]_[Articulation]_[Note][Octave]_v[Velocity]_rr[RoundRobin].wav',
  '',
  'Notes use letters A-G. Sharps use \'s\' (not #). Flats use \'b\'. Example: Cs3 = C#3, Bb2 = Bb2.',
  'Velocity layers are numbered v1 (softest) through vN (loudest).',
  'Round robins are numbered rr1, rr2, etc.',
  '',
  'When you have enough information to create a recording plan, include a JSON block in your response',
  '(fenced with ```json) with this structure:',
  '{"instrument": "...", "articulations": [...], "noteRange": {"low": "...", "high": "..."},',
  '"velocityLayers": N, "roundRobins": N, "notes": [...], "estimatedSamples": N, "estimatedMinutes": N}',
  '',
  'This JSON will be parsed by the app to generate a visual recording plan.',
  'Include it alongside your human-readable explanation. Update it whenever the plan changes based on the conversation.',
  '',
  'When generating a recording plan, format it as a clear checklist the user can print and bring to their recording session.'
].join('\n');

var WELCOME_MESSAGE = 'Hi! I\'m your sampling assistant. Tell me about the instrument you want to sample, and I\'ll help you plan your recording session.\n\nFor example: "I have a 15-string kantele and want to create a cinematic plucked instrument" or "I want to sample my upright piano for jazz."';

// ── Settings (API key in localStorage) ──

function getApiKey() {
  return localStorage.getItem('sa_api_key') || '';
}

function setApiKey(key) {
  if (key) {
    localStorage.setItem('sa_api_key', key);
  } else {
    localStorage.removeItem('sa_api_key');
  }
}

function hasApiKey() {
  return getApiKey().length > 0;
}

// ── Chat State ──

var chatState = {
  messages: [],    // { role: 'user'|'assistant', content: string }
  isLoading: false,
  lastPlan: null   // parsed recording plan JSON
};

// ── Send message to Claude via Rust backend ──

async function sendChatMessage(userMessage) {
  if (!userMessage.trim() || chatState.isLoading) return;

  var apiKey = getApiKey();
  if (!apiKey) {
    renderChatError('No API key configured. Add your Anthropic API key in Settings (gear icon).');
    return;
  }

  chatState.messages.push({ role: 'user', content: userMessage });
  chatState.isLoading = true;
  renderChatMessages();

  try {
    var messagesJson = JSON.stringify(chatState.messages);
    var response = await window.__TAURI__.core.invoke('chat_with_claude', {
      apiKey: apiKey,
      messages: messagesJson,
      systemPrompt: CONCEPT_SYSTEM_PROMPT
    });

    chatState.messages.push({ role: 'assistant', content: response });

    // Try to parse a recording plan from the response
    var plan = extractPlanFromResponse(response);
    if (plan) {
      chatState.lastPlan = plan;
      renderRecordingPlan(plan);
    }
  } catch (err) {
    var errMsg = String(err);
    chatState.messages.push({
      role: 'assistant',
      content: 'Error: ' + errMsg + '\n\nCheck your API key in Settings (gear icon).'
    });
  }

  chatState.isLoading = false;
  renderChatMessages();
}

// ── Extract JSON plan from assistant response ──

function extractPlanFromResponse(text) {
  var jsonMatch = text.match(/```json\s*\n([\s\S]*?)\n\s*```/);
  if (!jsonMatch) return null;

  try {
    var plan = JSON.parse(jsonMatch[1]);
    // Validate required fields
    if (plan.instrument && plan.articulations && plan.notes) {
      return plan;
    }
  } catch (e) {
    console.error('Failed to parse plan JSON:', e);
  }
  return null;
}

// ── Strip JSON blocks from display text ──

function stripJsonBlocks(text) {
  return text.replace(/```json\s*\n[\s\S]*?\n\s*```/g, '').trim();
}

// ── Render chat messages ──

function renderChatMessages() {
  var container = document.getElementById('chatMessages');
  if (!container) return;

  container.innerHTML = '';

  // Welcome message
  var welcome = document.createElement('div');
  welcome.className = 'chat-msg assistant';
  welcome.innerHTML = '<div class="chat-bubble assistant">' + escapeHtml(WELCOME_MESSAGE).replace(/\n/g, '<br>') + '</div>';
  container.appendChild(welcome);

  chatState.messages.forEach(function(msg) {
    var div = document.createElement('div');
    div.className = 'chat-msg ' + msg.role;

    var bubble = document.createElement('div');
    bubble.className = 'chat-bubble ' + msg.role;

    // For assistant messages, strip JSON blocks and render markdown-lite
    var displayText = msg.role === 'assistant' ? stripJsonBlocks(msg.content) : msg.content;
    bubble.innerHTML = renderMarkdownLite(displayText);

    div.appendChild(bubble);
    container.appendChild(div);
  });

  // Loading indicator
  if (chatState.isLoading) {
    var loading = document.createElement('div');
    loading.className = 'chat-msg assistant';
    loading.innerHTML = '<div class="chat-bubble assistant"><span class="chat-loading"><span></span><span></span><span></span></span></div>';
    container.appendChild(loading);
  }

  // Scroll to bottom
  container.scrollTop = container.scrollHeight;
}

function renderChatError(msg) {
  var container = document.getElementById('chatMessages');
  if (!container) return;

  var div = document.createElement('div');
  div.className = 'chat-msg assistant';
  div.innerHTML = '<div class="chat-bubble assistant" style="color:var(--warn);">' + escapeHtml(msg) + '</div>';
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
}

// ── Simple markdown-lite renderer ──

function escapeHtml(text) {
  var div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function renderMarkdownLite(text) {
  // Escape HTML first
  var html = escapeHtml(text);

  // Bold: **text**
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');

  // Inline code: `text`
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');

  // Line breaks
  html = html.replace(/\n/g, '<br>');

  return html;
}

// ── Render recording plan panel ──

function renderRecordingPlan(plan) {
  var panel = document.getElementById('recordingPlan');
  if (!panel) return;

  var notesStr = plan.notes ? plan.notes.join(', ') : '\u2014';
  var artStr = plan.articulations ? plan.articulations.join(', ') : '\u2014';
  var range = plan.noteRange ? (plan.noteRange.low + ' \u2013 ' + plan.noteRange.high) : '\u2014';

  panel.innerHTML =
    '<div class="plan-section">' +
    '<span class="label-lg" style="display:block;margin-bottom:12px;">RECORDING PLAN</span>' +
    '<div class="plan-grid">' +
    '<div class="plan-item"><span class="label">INSTRUMENT</span><div class="value">' + escapeHtml(plan.instrument || '\u2014') + '</div></div>' +
    '<div class="plan-item"><span class="label">NOTE RANGE</span><div class="value">' + escapeHtml(range) + '</div></div>' +
    '<div class="plan-item"><span class="label">VELOCITY LAYERS</span><div class="value">' + (plan.velocityLayers || '\u2014') + '</div></div>' +
    '<div class="plan-item"><span class="label">ROUND ROBINS</span><div class="value">' + (plan.roundRobins || '\u2014') + '</div></div>' +
    '<div class="plan-item"><span class="label">EST. SAMPLES</span><div class="value">' + (plan.estimatedSamples || '\u2014') + '</div></div>' +
    '<div class="plan-item"><span class="label">EST. TIME</span><div class="value">' + (plan.estimatedMinutes ? plan.estimatedMinutes + ' min' : '\u2014') + '</div></div>' +
    '</div>' +
    '</div>' +
    '<div class="plan-section">' +
    '<span class="label-lg" style="display:block;margin-bottom:8px;">ARTICULATIONS</span>' +
    '<div class="plan-tags">' + plan.articulations.map(function(a) {
      return '<span class="plan-tag">' + escapeHtml(a) + '</span>';
    }).join('') + '</div>' +
    '</div>' +
    '<div class="plan-section">' +
    '<span class="label-lg" style="display:block;margin-bottom:8px;">NOTES</span>' +
    '<div class="plan-notes">' + escapeHtml(notesStr) + '</div>' +
    '</div>' +
    '<div class="plan-actions">' +
    '<button class="btn-secondary" id="btnDownloadPlanFolders">Download Folder Structure</button>' +
    '<button class="btn-primary large" id="btnPlanReady">I\'m Ready \u2014 Import Samples</button>' +
    '</div>';

  // Wire plan buttons
  document.getElementById('btnDownloadPlanFolders').addEventListener('click', function() {
    downloadPlanFolders(plan);
  });
  document.getElementById('btnPlanReady').addEventListener('click', function() {
    // Store plan and pre-populate instrument name
    state.recordingPlan = plan;
    if (plan.instrument) {
      state.instrumentName = plan.instrument;
    }
    completePhase(1);
    goToPhase(2);
  });
}

async function downloadPlanFolders(plan) {
  try {
    var result = await window.__TAURI__.dialog.save({
      title: 'Choose location for sample folders',
      defaultPath: (plan.instrument || 'MySamples')
    });
    if (result) {
      var arts = plan.articulations || ['Default'];
      for (var i = 0; i < arts.length; i++) {
        await window.__TAURI__.core.invoke('create_directory', {
          path: result + '/' + arts[i]
        });
      }
      console.log('Plan folders created at:', result);
    }
  } catch (err) {
    console.error('Plan folder creation failed:', err);
  }
}

// ── Settings Modal ──

function openSettingsModal() {
  var overlay = document.getElementById('settingsOverlay');
  overlay.classList.add('visible');

  var input = document.getElementById('settingsApiKey');
  input.value = getApiKey();
  input.type = 'password';

  var statusEl = document.getElementById('settingsKeyStatus');
  statusEl.textContent = hasApiKey() ? 'Key saved' : 'Not configured';
  statusEl.className = 'settings-key-status ' + (hasApiKey() ? 'ok' : '');
}

function closeSettingsModal() {
  document.getElementById('settingsOverlay').classList.remove('visible');
}

function toggleApiKeyVisibility() {
  var input = document.getElementById('settingsApiKey');
  input.type = input.type === 'password' ? 'text' : 'password';
}

async function testApiKey() {
  var key = document.getElementById('settingsApiKey').value.trim();
  var statusEl = document.getElementById('settingsKeyStatus');

  if (!key) {
    statusEl.textContent = 'No key entered';
    statusEl.className = 'settings-key-status';
    return;
  }

  statusEl.textContent = 'Testing\u2026';
  statusEl.className = 'settings-key-status';

  try {
    await window.__TAURI__.core.invoke('chat_with_claude', {
      apiKey: key,
      messages: JSON.stringify([{ role: 'user', content: 'Hi' }]),
      systemPrompt: 'Reply with just the word OK.'
    });

    statusEl.textContent = 'Connected';
    statusEl.className = 'settings-key-status ok';
  } catch (err) {
    statusEl.textContent = 'Failed: ' + String(err).substring(0, 60);
    statusEl.className = 'settings-key-status error';
  }
}

function saveSettings() {
  var key = document.getElementById('settingsApiKey').value.trim();
  setApiKey(key);
  closeSettingsModal();
  // Update Phase 1 UI based on API key presence
  updatePhase1Layout();
}

// ── Phase 1 Layout Toggle ──

function updatePhase1Layout() {
  var phase1 = document.getElementById('phase1');
  var chatPanel = document.getElementById('phase1Chat');
  var guidePanel = document.getElementById('phase1Guide');
  var planPanel = document.getElementById('phase1Plan');
  var noBanner = document.getElementById('noKeyBanner');

  if (hasApiKey()) {
    // Show chat + plan layout
    phase1.classList.add('chat-mode');
    if (chatPanel) chatPanel.style.display = '';
    if (planPanel) planPanel.style.display = '';
    if (guidePanel) guidePanel.style.display = 'none';
    if (noBanner) noBanner.style.display = 'none';
  } else {
    // Show static guide with banner
    phase1.classList.remove('chat-mode');
    if (chatPanel) chatPanel.style.display = 'none';
    if (planPanel) planPanel.style.display = 'none';
    if (guidePanel) guidePanel.style.display = '';
    if (noBanner) noBanner.style.display = '';
  }
}
