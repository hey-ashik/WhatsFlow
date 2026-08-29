/**
 * WhatsFlow Projects & Dedicated API Gateway Manager
 */

let projectsList = [];
let activeProjectId = null;

// Skeleton Placeholders
function renderProjectsSkeleton() {
  const grid = document.getElementById('projectsGrid');
  if (!grid) return;

  grid.innerHTML = Array(3).fill(0).map(() => `
    <div class="skeleton-card">
      <div style="display: flex; justify-content: space-between; align-items: flex-start;">
        <div style="display: flex; align-items: center; gap: 10px;">
          <div class="skeleton skeleton-avatar"></div>
          <div style="display: flex; flex-direction: column; gap: 6px;">
            <div class="skeleton skeleton-title" style="width: 120px;"></div>
            <div class="skeleton skeleton-subtitle" style="width: 70px;"></div>
          </div>
        </div>
        <div class="skeleton skeleton-pill"></div>
      </div>
      <div style="display: flex; gap: 8px; margin: 6px 0;">
        <div class="skeleton skeleton-pill" style="width: 90px;"></div>
        <div class="skeleton skeleton-pill" style="width: 85px;"></div>
      </div>
      <div style="display: flex; justify-content: space-between; align-items: center; padding-top: 10px; border-top: 1px solid var(--border-subtle);">
        <div class="skeleton skeleton-pill" style="width: 95px;"></div>
        <div class="skeleton skeleton-avatar" style="width: 28px; height: 28px;"></div>
      </div>
    </div>
  `).join('');
}

async function loadProjects() {
  const grid = document.getElementById('projectsGrid');
  const countBadge = document.getElementById('projectsNavCount');
  const dashCount = document.getElementById('statActiveProjects');

  if (!grid) return;

  if (projectsList.length === 0) {
    renderProjectsSkeleton();
  }

  try {
    const safeFetch = window.authFetch || fetch;
    const res = await safeFetch('/api/v1/projects');
    const data = await res.json();

    if (data.success) {
      projectsList = data.data;

      if (countBadge) countBadge.textContent = projectsList.length;
      if (dashCount) dashCount.textContent = projectsList.length;

      // Update project selection dropdown in Add Automation modal
      updateProjectDropdowns();

      renderProjectsGrid(projectsList);

      // If a project is currently open in workspace, refresh it
      if (activeProjectId) {
        openProjectWorkspace(activeProjectId, false);
      }
    }
  } catch (err) {
    console.error('Error loading projects:', err);
    grid.innerHTML = `<div class="empty-state"><i class="fa-solid fa-triangle-exclamation"></i><p>Failed to load projects: ${err.message}</p></div>`;
  }
}

function updateProjectDropdowns() {
  const dropdown = document.getElementById('autoProjectSelect');
  if (!dropdown) return;

  const list = (projectsList && projectsList.length > 0) ? projectsList : (window.projectsList || []);

  if (list.length === 0) {
    dropdown.innerHTML = '<option value="">(No projects available - please create one first)</option>';
    return;
  }

  dropdown.innerHTML = list.map(p => `
    <option value="${p.id}" ${typeof activeProjectId !== 'undefined' && p.id === activeProjectId ? 'selected' : ''}>${escapeHtml(p.name)}</option>
  `).join('');
}

let projectSearchQuery = '';

function handleProjectSearch(query) {
  projectSearchQuery = (query || '').toLowerCase().trim();

  if (!projectSearchQuery) {
    renderProjectsGrid(projectsList);
    return;
  }

  const filtered = projectsList.filter(p =>
    (p.name && p.name.toLowerCase().includes(projectSearchQuery)) ||
    (p.id && p.id.toLowerCase().includes(projectSearchQuery)) ||
    (p.webhook_url && p.webhook_url.toLowerCase().includes(projectSearchQuery))
  );

  renderProjectsGrid(filtered, true);
}

function clearProjectSearch() {
  const input = document.getElementById('projectSearchInput');
  if (input) input.value = '';
  handleProjectSearch('');
}

function renderProjectsGrid(projects, isSearch = false) {
  const grid = document.getElementById('projectsGrid');
  if (!grid) return;

  if (projects.length === 0) {
    if (isSearch) {
      grid.innerHTML = `
        <div class="empty-state" style="grid-column: 1 / -1;">
          <i class="fa-solid fa-magnifying-glass"></i>
          <p>No projects found matching "<strong>${escapeHtml(projectSearchQuery)}</strong>"</p>
          <button class="btn btn-secondary btn-sm" onclick="clearProjectSearch()" style="margin-top: 12px;">
            <i class="fa-solid fa-xmark"></i> Clear Search
          </button>
        </div>
      `;
      return;
    }

    grid.innerHTML = `
      <div class="empty-state" style="grid-column: 1 / -1;">
        <i class="fa-solid fa-cubes"></i>
        <p>No projects created yet.</p>
        <p style="font-size: 13px; color: var(--text-muted); margin-top: 4px;">Click "Create Project" to get a dedicated API key, custom webhook, and automations.</p>
        <button class="btn btn-primary btn-sm" onclick="openCreateProjectModal()" style="margin-top: 12px;">
          <i class="fa-solid fa-plus"></i> Create First Project
        </button>
      </div>
    `;
    return;
  }

  grid.innerHTML = projects.map(p => `
    <div class="project-box-card" onclick="openProjectWorkspace('${p.id}')">
      <div class="project-box-header">
        <div class="project-box-title-wrap">
          <div class="project-box-icon"><i class="fa-solid fa-cube"></i></div>
          <div>
            <h3 class="project-box-title">${escapeHtml(p.name)}</h3>
            <span class="project-box-date"><i class="fa-regular fa-clock"></i> ${new Date(p.created_at || Date.now()).toLocaleDateString()}</span>
          </div>
        </div>
        <span class="badge ${p.is_active ? 'badge-exact' : 'badge-disabled'}">
          ${p.is_active ? 'Active' : 'Paused'}
        </span>
      </div>

      <div class="project-box-stats">
        <div class="stat-pill"><i class="fa-solid fa-bolt"></i> ${p.automationsCount || 0} Automations</div>
        <div class="stat-pill"><i class="fa-solid fa-key"></i> Dedicated Key</div>
      </div>

      <div class="project-box-footer" onclick="event.stopPropagation()">
        <button class="btn btn-secondary btn-sm" onclick="openProjectWorkspace('${p.id}')">
          <i class="fa-solid fa-arrow-up-right-from-square"></i> Open Project
        </button>
        <button class="btn-icon danger" onclick="deleteProject('${p.id}', '${escapeHtml(p.name)}')" title="Delete Project">
          <i class="fa-solid fa-trash"></i>
        </button>
      </div>
    </div>
  `).join('');
}

// ================= DEDICATED PROJECT WORKSPACE =================
async function openProjectWorkspace(projectId, updateUrl = true) {
  activeProjectId = String(projectId);
  
  if (updateUrl) {
    const targetUrl = `/projects/${projectId}`;
    if (window.location.pathname !== targetUrl) {
      history.pushState({ path: targetUrl, projectId }, '', targetUrl);
    }
  }

  // Ensure projects are loaded
  if (projectsList.length === 0) {
    try {
      const safeFetch = window.authFetch || fetch;
      const res = await safeFetch('/api/v1/projects');
      const data = await res.json();
      if (data.success) projectsList = data.data;
    } catch (e) {}
  }

  const project = projectsList.find(p => String(p.id) === String(projectId));
  if (!project) return;

  const allProjectsView = document.getElementById('allProjectsView');
  const workspaceView = document.getElementById('projectWorkspaceView');

  if (allProjectsView) allProjectsView.style.display = 'none';
  if (workspaceView) workspaceView.style.display = 'block';

  // Populate Workspace header & details
  document.getElementById('wsProjectName').textContent = project.name;
  document.getElementById('wsProjectBadge').className = `badge ${project.is_active ? 'badge-exact' : 'badge-disabled'}`;
  document.getElementById('wsProjectBadge').textContent = project.is_active ? 'Active' : 'Paused';

  // Populate Endpoint
  const endpointEl = document.getElementById('wsProjectEndpoint');
  let canonicalEndpoint = project.endpoint;
  if (!canonicalEndpoint) {
    canonicalEndpoint = `${window.location.origin}/api/v1/projects/${project.id}/send-message`;
  }
  // Enforce https on deployed domains (e.g. whatsflow.ashiik.com)
  if (window.location.protocol === 'https:' && canonicalEndpoint.startsWith('http://') && !canonicalEndpoint.includes('localhost') && !canonicalEndpoint.includes('127.0.0.1')) {
    canonicalEndpoint = canonicalEndpoint.replace(/^http:\/\//i, 'https://');
  }
  if (endpointEl) endpointEl.value = canonicalEndpoint;

  // Populate API Key
  const apiKeyEl = document.getElementById('wsProjectApiKey');
  if (apiKeyEl) apiKeyEl.value = project.api_key;

  // Populate Webhook
  const webhookEl = document.getElementById('wsProjectWebhook');
  if (webhookEl) webhookEl.value = project.webhook_url || '';

  // Pre-fill Project Test Message Key
  const testApiKeyEl = document.getElementById('testApiKeyInput');
  if (testApiKeyEl) testApiKeyEl.value = project.api_key;

  // Load project-specific automations
  await loadProjectAutomations(projectId);
}

function closeProjectWorkspace(updateUrl = true) {
  activeProjectId = null;
  const allProjectsView = document.getElementById('allProjectsView');
  const workspaceView = document.getElementById('projectWorkspaceView');

  if (allProjectsView) allProjectsView.style.display = 'block';
  if (workspaceView) workspaceView.style.display = 'none';

  if (updateUrl) {
    if (window.location.pathname !== '/projects') {
      history.pushState({ path: '/projects', tab: 'projects' }, '', '/projects');
    }
  }

  loadProjects();
}

async function loadProjectAutomations(projectId) {
  const container = document.getElementById('projectAutomationsGrid');
  if (!container) return;

  if (container.children.length === 0 || container.querySelector('.empty-state')) {
    container.innerHTML = Array(3).fill(0).map(() => `
      <div class="skeleton-card">
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <div class="skeleton skeleton-title" style="width: 120px;"></div>
          <div class="skeleton skeleton-pill"></div>
        </div>
        <div class="skeleton skeleton-box" style="height: 48px; border-radius: var(--radius-sm);"></div>
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <div class="skeleton skeleton-pill" style="width: 65px;"></div>
          <div class="skeleton skeleton-pill" style="width: 50px;"></div>
        </div>
      </div>
    `).join('');
  }

  try {
    const safeFetch = window.authFetch || fetch;
    const [autoRes, wfRes] = await Promise.all([
      safeFetch(`/api/v1/projects/${projectId}/automations`).then(r => r.json()),
      safeFetch('/api/v1/workflows').then(r => r.json()).catch(() => ({ success: false, data: [] }))
    ]);

    const rules = autoRes.success ? autoRes.data : [];
    const workflows = (wfRes.success && Array.isArray(wfRes.data)) ? wfRes.data : [];
    const linkedWf = workflows.find(w => String(w.project_id) === String(projectId));

    let html = '';

    // If project is powered by a Visual Workflow
    if (linkedWf) {
      const isWfActive = Number(linkedWf.is_active) === 1;
      html += `
        <div class="card" style="grid-column: 1 / -1; background: linear-gradient(135deg, rgba(168,85,247,0.12), rgba(59,130,246,0.08)); border: 1px solid rgba(168,85,247,0.35); border-radius: 14px; padding: 22px; margin-bottom: 8px;">
          <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 16px;">
            <div style="display: flex; align-items: center; gap: 16px;">
              <div style="width: 48px; height: 48px; border-radius: 12px; background: rgba(168,85,247,0.25); display: flex; align-items: center; justify-content: center; font-size: 22px; color: #c084fc;">
                <i class="fa-solid fa-diagram-project"></i>
              </div>
              <div>
                <div style="display: flex; align-items: center; gap: 10px;">
                  <h3 style="font-size: 16px; font-weight: 700; color: var(--text-primary); margin: 0;">${escapeHtml(linkedWf.name)}</h3>
                  <span class="badge ${isWfActive ? 'badge-exact' : 'badge-disabled'}">${isWfActive ? 'Active Workflow' : 'Paused'}</span>
                </div>
                <p style="font-size: 13px; color: var(--text-secondary); margin-top: 4px; margin-bottom: 0;">
                  This project is automated by an interactive Visual AI Workflow with <strong>${escapeHtml(linkedWf.settings?.ai_model || 'gpt-4o-mini')}</strong>.
                </p>
              </div>
            </div>
            <button class="btn btn-primary" onclick="openWorkflowForProject('${linkedWf.id}')">
              <i class="fa-solid fa-pen-ruler"></i> Open in Visual Workflow Builder
            </button>
          </div>
        </div>
      `;
    }

    if (rules.length === 0 && !linkedWf) {
      container.innerHTML = `
        <div class="empty-state" style="grid-column: 1 / -1; padding: 28px;">
          <i class="fa-solid fa-bolt"></i>
          <p style="font-weight: 600; font-size: 15px;">No automations or workflow linked yet.</p>
          <p style="font-size: 13px; color: var(--text-secondary); max-width: 400px; margin: 4px auto 16px;">
            You can create keyword-based manual automations or build an AI visual node workflow for this project.
          </p>
          <div style="display: flex; gap: 10px; justify-content: center; align-items: center; flex-wrap: wrap;">
            <button class="btn btn-secondary btn-sm" onclick="openAddProjectAutomationModal('${projectId}')">
              <i class="fa-solid fa-plus"></i><span> Add Manual Automation</span>
            </button>
            <button class="btn btn-secondary btn-sm" onclick="openCreateWorkflowForProject('${projectId}')" style="border-color: rgba(168, 85, 247, 0.4); color: #c084fc;">
              <i class="fa-solid fa-diagram-project"></i><span> Create Visual Workflow</span>
            </button>
          </div>
        </div>
      `;
      return;
    }

      const rulesHtml = rules.map(rule => {
        let badgeLabel = (rule.trigger_type || 'exact').toUpperCase();
        let badgeClass = 'badge-exact';
        let matchText = `"${escapeHtml(rule.trigger_value)}"`;

        if (rule.trigger_type === 'default' || rule.trigger_type === 'fallback') {
          badgeLabel = 'DEFAULT FALLBACK';
          badgeClass = 'badge-contains';
          matchText = '<span style="color: var(--text-secondary); font-style: italic;">All Unmatched Messages</span>';
        } else if (rule.trigger_type === 'contains') {
          badgeLabel = 'CONTAINS';
          badgeClass = 'badge-contains';
        } else if (rule.trigger_type === 'starts_with') {
          badgeLabel = 'STARTS WITH';
          badgeClass = 'badge-exact';
        }

        const isRuleActive = Number(rule.is_active) === 1;

        return `
          <div class="automation-box-card ${isRuleActive ? '' : 'disabled-card'}" id="proj-auto-${rule.id}">
            <div class="auto-card-top">
              <div class="auto-card-title-wrap">
                <i class="fa-solid fa-bolt auto-icon"></i>
                <span class="auto-card-name">${escapeHtml(rule.name)}</span>
              </div>
              <span class="badge ${badgeClass}">
                ${badgeLabel}
              </span>
            </div>

            <div class="auto-card-body">
              <div class="auto-field-label">MATCH: <span class="auto-match-val">${matchText}</span></div>
              <div class="auto-field-label" style="margin-top: 8px;">BOT RESPONSE:</div>
              <div class="auto-reply-preview">${escapeHtml(rule.response_content)}</div>
            </div>

            <div class="auto-card-footer">
              <button class="btn-toggle ${isRuleActive ? 'active' : ''}" onclick="toggleProjectAutomation('${rule.id}', ${isRuleActive ? 0 : 1})">
                <i class="fa-solid ${isRuleActive ? 'fa-check' : 'fa-ban'}"></i>
                <span>${isRuleActive ? 'Active' : 'Disabled'}</span>
              </button>
              <div class="auto-card-actions">
                <button class="btn-icon" onclick="openEditModal('${rule.id}')" title="Edit Rule">
                  <i class="fa-solid fa-pen-to-square"></i>
                </button>
                <button class="btn-icon danger" onclick="deleteProjectAutomation('${rule.id}')" title="Delete Rule">
                  <i class="fa-solid fa-trash"></i>
                </button>
              </div>
            </div>
          </div>
        `;
      }).join('');

      container.innerHTML = html + rulesHtml;
  } catch (err) {
    console.error('Error loading project automations:', err);
  }
}

// Open Visual Workflow directly from Project
function openWorkflowForProject(workflowId) {
  if (typeof switchTab === 'function') {
    switchTab('automations');
  }
  if (typeof openAutomationsSubView === 'function') {
    openAutomationsSubView('workflow');
  }
  if (window.Workflows && window.Workflows.selectWorkflow) {
    window.Workflows.selectWorkflow(workflowId);
  }
}

function openCreateWorkflowForProject(projectId) {
  if (typeof switchTab === 'function') {
    switchTab('automations');
  }
  if (typeof openAutomationsSubView === 'function') {
    openAutomationsSubView('workflow');
  }
  if (window.Workflows) {
    const projSelect = document.getElementById('wfProjectSelect');
    if (projSelect) projSelect.value = projectId;
    if (window.Workflows.createNewWorkflowPrompt) {
      window.Workflows.createNewWorkflowPrompt();
    }
  }
}

// Project Webhook Update
async function saveProjectWebhook() {
  if (!activeProjectId) return;
  const webhook_url = document.getElementById('wsProjectWebhook').value.trim();

  try {
    const safeFetch = window.authFetch || fetch;
    const res = await safeFetch(`/api/v1/projects/${activeProjectId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ webhook_url })
    });
    const data = await res.json();
    if (data.success) {
      showToast('Project custom webhook saved successfully!', 'success');
      loadProjects();
    } else {
      showToast(data.error || 'Failed to save webhook.', 'error');
    }
  } catch (err) {
    showToast('Error: ' + err.message, 'error');
  }
}

// Modal Handlers
function openCreateProjectModal() {
  document.getElementById('projectNameInput').value = '';
  document.getElementById('projectWebhookInput').value = '';
  const modal = document.getElementById('createProjectModal');
  if (modal) modal.classList.add('active');
}

function closeCreateProjectModal() {
  const modal = document.getElementById('createProjectModal');
  if (modal) modal.classList.remove('active');
}

async function handleCreateProjectSubmit(e) {
  e.preventDefault();
  const name = document.getElementById('projectNameInput').value.trim();
  const webhook_url = document.getElementById('projectWebhookInput').value.trim();
  const modal = document.getElementById('createProjectModal');
  const submitBtn = modal ? modal.querySelector('button[type="submit"]') : null;

  if (!name) {
    showToast('Please enter a project name.', 'error');
    return;
  }

  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Creating...';
  }

  try {
    const safeFetch = window.authFetch || fetch;
    const res = await safeFetch('/api/v1/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, webhook_url })
    });
    const data = await res.json();
    if (data.success && data.data) {
      showToast('Project created successfully!', 'success');
      closeCreateProjectModal();
      
      // Instant optimistic update
      projectsList.unshift(data.data);
      renderProjectsGrid(projectsList);
      updateProjectDropdowns();

      // Open new project workspace smoothly
      if (data.data.id) {
        openProjectWorkspace(data.data.id);
      }
    } else {
      showToast(data.error || 'Failed to create project.', 'error');
    }
  } catch (err) {
    showToast('Error: ' + err.message, 'error');
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.innerHTML = 'Create Project';
    }
  }
}

async function deleteProject(projectId, projectName) {
  if (!confirm(`Delete project "${projectName}" and all its automations?`)) return;
  const targetId = String(projectId);

  // Optimistic instant removal from grid
  projectsList = projectsList.filter(p => String(p.id) !== targetId);
  renderProjectsGrid(projectsList);
  updateProjectDropdowns();

  if (activeProjectId === targetId) {
    closeProjectWorkspace();
  }

  try {
    const safeFetch = window.authFetch || fetch;
    const res = await safeFetch(`/api/v1/projects/${targetId}`, { method: 'DELETE' });
    const data = await res.json();
    if (data.success) {
      showToast('Project deleted successfully.', 'info');
      loadProjects();
      if (typeof loadAutomations === 'function') loadAutomations();
    } else {
      showToast(data.error || 'Delete failed.', 'error');
      loadProjects();
    }
  } catch (err) {
    showToast('Error: ' + err.message, 'error');
    loadProjects();
  }
}

async function toggleProjectAutomation(id, newStatus) {
  const targetId = String(id);
  
  // Optimistic UI toggle in project automations
  const card = document.getElementById(`proj-auto-${targetId}`);
  if (card) {
    const btn = card.querySelector('.btn-toggle');
    if (btn) {
      if (newStatus) {
        btn.classList.add('active');
        btn.innerHTML = '<i class="fa-solid fa-check"></i><span>Active</span>';
        card.classList.remove('disabled-card');
      } else {
        btn.classList.remove('active');
        btn.innerHTML = '<i class="fa-solid fa-ban"></i><span>Disabled</span>';
        card.classList.add('disabled-card');
      }
    }
  }

  try {
    const safeFetch = window.authFetch || fetch;
    const res = await safeFetch(`/api/v1/automations/${targetId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_active: newStatus })
    });
    const data = await res.json();
    if (data.success) {
      showToast(newStatus ? 'Rule enabled.' : 'Rule disabled.', 'success');
      if (activeProjectId) loadProjectAutomations(activeProjectId);
      if (typeof loadAutomations === 'function') loadAutomations();
    } else {
      showToast(data.error || 'Failed to toggle status.', 'error');
      if (activeProjectId) loadProjectAutomations(activeProjectId);
    }
  } catch (err) {
    showToast('Error: ' + err.message, 'error');
    if (activeProjectId) loadProjectAutomations(activeProjectId);
  }
}

async function deleteProjectAutomation(id) {
  if (!confirm('Delete this automation rule?')) return;
  const targetId = String(id);

  // Optimistic card removal
  const card = document.getElementById(`proj-auto-${targetId}`);
  if (card) card.remove();

  try {
    const safeFetch = window.authFetch || fetch;
    const res = await safeFetch(`/api/v1/automations/${targetId}`, { method: 'DELETE' });
    const data = await res.json();
    if (data.success) {
      showToast('Automation deleted.', 'info');
      if (activeProjectId) loadProjectAutomations(activeProjectId);
      if (typeof loadAutomations === 'function') loadAutomations();
    } else {
      showToast(data.error || 'Delete failed.', 'error');
      if (activeProjectId) loadProjectAutomations(activeProjectId);
    }
  } catch (err) {
    showToast('Error: ' + err.message, 'error');
    if (activeProjectId) loadProjectAutomations(activeProjectId);
  }
}

// Helper Utilities
function copyInputText(inputId, label) {
  const input = document.getElementById(inputId);
  if (!input) return;
  navigator.clipboard.writeText(input.value).then(() => {
    showToast(`Copied ${label} to clipboard!`, 'success');
  }).catch(() => {
    input.select();
    document.execCommand('copy');
    showToast(`Copied ${label} to clipboard!`, 'success');
  });
}

function togglePasswordVisibility(inputId, iconId) {
  const input = document.getElementById(inputId);
  const icon = document.getElementById(iconId);
  if (!input || !icon) return;

  if (input.classList.contains('wf-masked-key')) {
    const isRevealed = input.classList.toggle('revealed');
    if (icon) {
      icon.className = isRevealed ? 'fa-solid fa-eye-slash' : 'fa-solid fa-eye';
    }
  } else {
    const isPass = input.type === 'password';
    input.type = isPass ? 'text' : 'password';
    if (icon) {
      icon.className = isPass ? 'fa-solid fa-eye-slash' : 'fa-solid fa-eye';
    }
  }
}

// Project Workflow Navigation Helpers
function openWorkflowForProject(workflowId) {
  if (typeof switchTab === 'function') switchTab('automations');
  if (typeof openAutomationsSubView === 'function') openAutomationsSubView('workflow');
  if (window.Workflows && typeof window.Workflows.selectWorkflow === 'function') {
    window.Workflows.selectWorkflow(workflowId);
  }
}

function openCreateWorkflowForProject(projectId) {
  const projId = projectId || activeProjectId;
  const projRules = (window.automationsList || []).filter(a => String(a.project_id) === String(projId));
  const proj = (window.projectsList || []).find(p => String(p.id) === String(projId));
  const projName = proj ? proj.name : 'Selected Project';

  if (projRules.length > 0) {
    if (typeof showExclusivityModal === 'function') {
      showExclusivityModal({
        title: 'Project Automation Conflict',
        description: `Project <strong>"${escapeHtml(projName)}"</strong> already has <strong>${projRules.length} Manual Automation rule(s)</strong>.<br><br>Each project can only have <strong>one automation mode</strong> active at a time (either Manual Automations or a Visual Workflow).<br><br>To build and activate a Visual Workflow for <strong>${escapeHtml(projName)}</strong>, please delete the manual automation rules from this project first.`,
        actionText: 'View Manual Rules',
        onAction: () => {
          if (typeof openAutomationsSubView === 'function') openAutomationsSubView('manual');
        }
      });
    }
    return;
  }

  if (typeof switchTab === 'function') switchTab('automations');
  if (typeof openAutomationsSubView === 'function') openAutomationsSubView('workflow');
  if (window.Workflows) {
    if (typeof window.Workflows.createNewWorkflow === 'function') {
      window.Workflows.createNewWorkflow();
    }
    if (projId) {
      setTimeout(() => {
        const projSelect = document.getElementById('wfProjectSelect');
        if (projSelect) {
          projSelect.value = projId;
          if (typeof window.Workflows.onProjectChange === 'function') {
            window.Workflows.onProjectChange(projId);
          }
        }
      }, 50);
    }
  }
}
