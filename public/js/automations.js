let activeAutomationsSubView = 'hub';
let automationsList = [];
let automationSearchQuery = '';

// Sub-View Navigation: 'hub' (2 Big Cards), 'manual' (Rule list), 'workflow' (Visual Canvas)
function openAutomationsSubView(viewName = 'hub', updateUrl = true) {
  activeAutomationsSubView = viewName;
  const hubView = document.getElementById('autoHubContainer');
  const manualView = document.getElementById('autoManualContainer');
  const workflowView = document.getElementById('autoWorkflowContainer');

  if (hubView) hubView.style.display = viewName === 'hub' ? 'block' : 'none';
  if (manualView) manualView.style.display = viewName === 'manual' ? 'block' : 'none';
  if (workflowView) workflowView.style.display = viewName === 'workflow' ? 'block' : 'none';

  // Update browser URL to dedicated sub-route
  if (updateUrl) {
    let targetPath = '/automations';
    if (viewName === 'manual') targetPath = '/automations/manual';
    else if (viewName === 'workflow') targetPath = '/automations/workflow';

    if (window.location.pathname !== targetPath) {
      history.pushState({ path: targetPath, tab: 'automations', subView: viewName }, '', targetPath);
    }
  }

  if (viewName === 'manual') {
    loadAutomations();
  } else if (viewName === 'workflow') {
    if (window.Workflows && window.Workflows.init) {
      window.Workflows.init();
    }
  }
}

// Skeleton Shimmer Placeholder for Automations Tab
function renderAutomationsSkeleton() {
  const container = document.getElementById('automationsProjectsContainer');
  if (!container) return;

  container.innerHTML = Array(2).fill(0).map(() => `
    <div class="project-automations-section" style="opacity: 0.85;">
      <div class="proj-section-header">
        <div class="proj-section-top-row">
          <div class="proj-section-title-wrap">
            <div class="skeleton skeleton-avatar"></div>
            <div class="proj-section-meta">
              <div class="skeleton skeleton-title" style="width: 120px;"></div>
              <div class="skeleton skeleton-subtitle" style="width: 60px;"></div>
            </div>
          </div>
          <div class="proj-section-actions">
            <div class="skeleton skeleton-pill" style="width: 85px;"></div>
            <div class="skeleton skeleton-pill" style="width: 36px;"></div>
          </div>
        </div>
        <div class="proj-section-mobile-stat">
          <div class="skeleton skeleton-box" style="height: 32px; width: 100%;"></div>
        </div>
      </div>
      <div class="automations-grid">
        <div class="skeleton-card">
          <div class="skeleton skeleton-title" style="width: 100px;"></div>
          <div class="skeleton skeleton-box" style="height: 38px;"></div>
          <div class="skeleton skeleton-pill" style="width: 60px;"></div>
        </div>
        <div class="skeleton-card">
          <div class="skeleton skeleton-title" style="width: 120px;"></div>
          <div class="skeleton skeleton-box" style="height: 38px;"></div>
          <div class="skeleton skeleton-pill" style="width: 60px;"></div>
        </div>
      </div>
    </div>
  `).join('');
}

// Load All Automations & Projects
async function loadAutomations() {
  const container = document.getElementById('automationsProjectsContainer');
  const countBadge = document.getElementById('ruleCountBadge');
  const dashCount = document.getElementById('statActiveRules');

  if (!container) return;

  if (container.children.length === 0 || container.querySelector('.empty-state')) {
    renderAutomationsSkeleton();
  }

  try {
    const safeFetch = window.authFetch || fetch;
    const [autoRes, projRes] = await Promise.all([
      safeFetch('/api/v1/automations').then(r => r.json()),
      safeFetch('/api/v1/projects').then(r => r.json())
    ]);

    if (projRes && projRes.success && Array.isArray(projRes.data)) {
      projectsList = projRes.data;
      window.projectsList = projectsList;
      updateProjectDropdowns();
    }

    if (autoRes && autoRes.success && Array.isArray(autoRes.data)) {
      automationsList = autoRes.data;
      window.automationsList = automationsList;

      const activeCount = automationsList.filter(a => Number(a.is_active) === 1).length;
      if (countBadge) countBadge.textContent = activeCount;
      if (dashCount) dashCount.textContent = activeCount;

      renderProjectGroupedAutomations(projectsList, automationsList);
    }
  } catch (err) {
    console.error('Error loading automations:', err);
    if (container) {
      container.innerHTML = `<div class="empty-state"><p>Error loading automations: ${err.message}</p></div>`;
    }
  }
}

// Search & Filter Automations with Full Anti-Autofill Protection
function handleAutomationSearch(query) {
  const clean = (query || '').trim();
  const userEmail = (window.Auth && window.Auth.user && window.Auth.user.email) ? window.Auth.user.email.toLowerCase() : '';

  // Intercept and neutralize any browser credential autofill
  if (clean.includes('@') && (userEmail.includes(clean.toLowerCase()) || clean.toLowerCase().includes(userEmail) || clean.includes('@gmail') || clean.includes('@yahoo') || clean.includes('@outlook'))) {
    const input = document.getElementById('automationSearchInput');
    if (input) input.value = '';
    automationSearchQuery = '';
    renderProjectGroupedAutomations(projectsList, automationsList);
    return;
  }

  automationSearchQuery = clean.toLowerCase();
  renderProjectGroupedAutomations(projectsList, automationsList);
}

function clearAutomationSearch() {
  const input = document.getElementById('automationSearchInput');
  if (input) {
    input.value = '';
  }
  automationSearchQuery = '';
  renderProjectGroupedAutomations(projectsList, automationsList);
}

// Background Sweeper: cleans search input if browser autofill fired asynchronously
function sanitizeSearchInputs() {
  const input = document.getElementById('automationSearchInput');
  if (input && input.value && input.value.includes('@')) {
    input.value = '';
    automationSearchQuery = '';
    if (typeof renderProjectGroupedAutomations === 'function' && Array.isArray(projectsList) && Array.isArray(automationsList)) {
      renderProjectGroupedAutomations(projectsList, automationsList);
    }
  }
}

// Page load protection against browser email autofill
['DOMContentLoaded', 'load'].forEach(ev => {
  window.addEventListener(ev, () => {
    for (let t of [0, 50, 100, 200, 300, 500, 800, 1200, 2000]) {
      setTimeout(sanitizeSearchInputs, t);
    }
  });
});

// Render Single Automation Card
function renderAutomationCard(rule) {
  let badgeLabel = (rule.trigger_type || 'exact').toUpperCase();
  let badgeClass = 'badge-exact';
  let matchText = `"${escapeHtml(rule.trigger_value || '')}"`;

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
    <div class="automation-box-card ${isRuleActive ? '' : 'disabled-card'}" id="auto-card-${rule.id}">
      <div class="auto-card-top">
        <div class="auto-card-title-wrap">
          <i class="fa-solid fa-bolt auto-icon"></i>
          <span class="auto-card-name">${escapeHtml(rule.name || 'Untitled Rule')}</span>
        </div>
        <span class="badge ${badgeClass}">
          ${badgeLabel}
        </span>
      </div>

      <div class="auto-card-body">
        <div class="auto-field-label">MATCH: <span class="auto-match-val">${matchText}</span></div>
        <div class="auto-field-label" style="margin-top: 8px;">BOT RESPONSE:</div>
        <div class="auto-reply-preview">${escapeHtml(rule.response_content || '')}</div>
      </div>

      <div class="auto-card-footer">
        <button class="btn-toggle ${isRuleActive ? 'active' : ''}" onclick="toggleAutomation('${rule.id}', ${isRuleActive ? 0 : 1})">
          <i class="fa-solid ${isRuleActive ? 'fa-check' : 'fa-ban'}"></i>
          <span>${isRuleActive ? 'Active' : 'Disabled'}</span>
        </button>
        <div class="auto-card-actions">
          <button class="btn-icon" onclick="openEditModal('${rule.id}')" title="Edit Rule">
            <i class="fa-solid fa-pen-to-square"></i>
          </button>
          <button class="btn-icon danger" onclick="deleteAutomation('${rule.id}')" title="Delete Rule">
            <i class="fa-solid fa-trash"></i>
          </button>
        </div>
      </div>
    </div>
  `;
}

// Render Project-Grouped Automations
function renderProjectGroupedAutomations(projects = [], automations = []) {
  const container = document.getElementById('automationsProjectsContainer');
  if (!container) return;

  const validProjects = Array.isArray(projects) ? projects : [];
  const validAutomations = Array.isArray(automations) ? automations : [];

  if (validProjects.length === 0 && validAutomations.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <i class="fa-solid fa-bolt"></i>
        <p>No automations created yet.</p>
        <p style="font-size: 13px; color: var(--text-muted); margin-top: 4px;">Click the button below to create your first keyword automation rule.</p>
        <button class="btn btn-primary btn-sm" onclick="openAddModal()" style="margin-top: 12px;">
          <i class="fa-solid fa-plus"></i> Create Automation
        </button>
      </div>
    `;
    return;
  }

  const sections = [];

  // 1. Render all Project Groups
  validProjects.forEach(project => {
    const isProjectNameMatch = Boolean(automationSearchQuery && project.name && project.name.toLowerCase().includes(automationSearchQuery));

    const projectRules = validAutomations.filter(a => {
      if (String(a.project_id) !== String(project.id)) return false;
      if (!automationSearchQuery || isProjectNameMatch) return true;
      return (
        (a.name && a.name.toLowerCase().includes(automationSearchQuery)) ||
        (a.trigger_value && a.trigger_value.toLowerCase().includes(automationSearchQuery)) ||
        (a.response_content && a.response_content.toLowerCase().includes(automationSearchQuery)) ||
        (a.trigger_type && a.trigger_type.toLowerCase().includes(automationSearchQuery))
      );
    });

    if (automationSearchQuery && !isProjectNameMatch && projectRules.length === 0) {
      return;
    }

    const activeCount = projectRules.filter(a => Number(a.is_active) === 1).length;

    let rulesHtml = '';
    if (projectRules.length === 0) {
      rulesHtml = `
        <div class="empty-state" style="grid-column: 1 / -1; padding: 20px; background: var(--bg-secondary); border-radius: var(--radius-sm);">
          <i class="fa-solid fa-bolt" style="font-size: 20px; color: var(--text-muted);"></i>
          <p style="font-size: 13px;">No automations created yet for <strong>${escapeHtml(project.name)}</strong>.</p>
          <button class="btn btn-secondary btn-sm" onclick="openAddProjectAutomationModal('${project.id}')" style="margin-top: 8px;">
            <i class="fa-solid fa-plus"></i> Add Automation
          </button>
        </div>
      `;
    } else {
      rulesHtml = projectRules.map(rule => renderAutomationCard(rule)).join('');
    }

    sections.push(`
      <div class="project-automations-section">
        <div class="proj-section-header">
          <div class="proj-section-top-row">
            <div class="proj-section-title-wrap">
              <div class="proj-section-icon"><i class="fa-solid fa-cube"></i></div>
              <div class="proj-section-meta">
                <h2 class="proj-section-name">${escapeHtml(project.name)}</h2>
                <span class="badge ${project.is_active ? 'badge-exact' : 'badge-disabled'}">
                  ${project.is_active ? 'Active' : 'Paused'}
                </span>
              </div>
            </div>

            <div class="proj-section-actions">
              <span class="stat-pill desktop-stat-pill"><i class="fa-solid fa-bolt"></i> ${projectRules.length} Automations (${activeCount} Active)</span>
              <button class="btn btn-primary btn-sm" onclick="openAddProjectAutomationModal('${project.id}')" title="Add Automation">
                <i class="fa-solid fa-plus"></i><span class="btn-text-hide-mobile"> Add Automation</span>
              </button>
            </div>
          </div>

          <div class="proj-section-mobile-stat">
            <span class="stat-pill full-width-stat"><i class="fa-solid fa-bolt"></i> ${projectRules.length} Automations (${activeCount} Active)</span>
          </div>
        </div>

        <div class="automations-grid">
          ${rulesHtml}
        </div>
      </div>
    `);
  });

  // 2. Render Unassigned / Global Automations if any exist
  const unassignedRules = validAutomations.filter(a => {
    const hasMatchingProject = a.project_id && validProjects.some(p => String(p.id) === String(a.project_id));
    if (hasMatchingProject) return false;
    if (!automationSearchQuery) return true;
    return (
      (a.name && a.name.toLowerCase().includes(automationSearchQuery)) ||
      (a.trigger_value && a.trigger_value.toLowerCase().includes(automationSearchQuery)) ||
      (a.response_content && a.response_content.toLowerCase().includes(automationSearchQuery)) ||
      (a.trigger_type && a.trigger_type.toLowerCase().includes(automationSearchQuery))
    );
  });

  if (unassignedRules.length > 0) {
    const activeUnassigned = unassignedRules.filter(a => Number(a.is_active) === 1).length;
    sections.push(`
      <div class="project-automations-section">
        <div class="proj-section-header">
          <div class="proj-section-top-row">
            <div class="proj-section-title-wrap">
              <div class="proj-section-icon" style="background: rgba(56, 189, 248, 0.15); color: #38bdf8;"><i class="fa-solid fa-bolt"></i></div>
              <div class="proj-section-meta">
                <h2 class="proj-section-name">General & Global Automations</h2>
                <span class="badge badge-exact">Active</span>
              </div>
            </div>

            <div class="proj-section-actions">
              <span class="stat-pill desktop-stat-pill"><i class="fa-solid fa-bolt"></i> ${unassignedRules.length} Automations (${activeUnassigned} Active)</span>
              <button class="btn btn-primary btn-sm" onclick="openAddModal()" title="Add Automation">
                <i class="fa-solid fa-plus"></i><span class="btn-text-hide-mobile"> Add Automation</span>
              </button>
            </div>
          </div>
        </div>

        <div class="automations-grid">
          ${unassignedRules.map(rule => renderAutomationCard(rule)).join('')}
        </div>
      </div>
    `);
  }

  if (sections.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <i class="fa-solid fa-magnifying-glass"></i>
        <p>No automations or projects found matching "<strong>${escapeHtml(automationSearchQuery)}</strong>"</p>
        <button class="btn btn-secondary btn-sm" onclick="clearAutomationSearch()" style="margin-top: 12px;">
          <i class="fa-solid fa-xmark"></i> Clear Search
        </button>
      </div>
    `;
    return;
  }

  container.innerHTML = sections.join('');
}

// Handle Dynamic Match Type Change (Hide keyword field for Default Fallback)
function handleTriggerTypeChange() {
  const typeSelect = document.getElementById('ruleTriggerType');
  const group = document.getElementById('triggerKeywordGroup');
  const input = document.getElementById('ruleTriggerValue');
  if (!typeSelect || !group || !input) return;

  if (typeSelect.value === 'default') {
    group.style.display = 'none';
    input.removeAttribute('required');
    input.value = '*';
  } else {
    group.style.display = 'block';
    input.setAttribute('required', 'required');
    if (input.value === '*') input.value = '';
  }
}

// Modal Handlers
function openAddModal() {
  document.getElementById('ruleModalTitle').innerHTML = '<i class="fa-solid fa-bolt" style="margin-right: 8px;"></i>Add Automation';
  document.getElementById('ruleIdInput').value = '';
  document.getElementById('ruleNameInput').value = '';
  document.getElementById('ruleTriggerType').value = 'exact';
  document.getElementById('ruleTriggerValue').value = '';
  document.getElementById('ruleResponseContent').value = '';
  document.getElementById('ruleIsActive').checked = true;

  handleTriggerTypeChange();
  updateProjectDropdowns();

  const modal = document.getElementById('automationModal');
  if (modal) modal.classList.add('active');
}

function openAddProjectAutomationModal(projectId) {
  openAddModal();
  const select = document.getElementById('autoProjectSelect');
  if (select && projectId) {
    select.value = projectId;
  }
}

async function openEditModal(id) {
  const targetId = String(id);
  let rule = automationsList.find(a => String(a.id) === targetId);

  if (!rule) {
    try {
      const safeFetch = window.authFetch || fetch;
      const res = await safeFetch('/api/v1/automations');
      const data = await res.json();
      if (data.success && data.data) {
        automationsList = data.data;
        rule = automationsList.find(a => String(a.id) === targetId);
      }
    } catch (e) {}
  }

  if (!rule) {
    showToast('Automation rule details not found.', 'error');
    return;
  }

  document.getElementById('ruleModalTitle').innerHTML = '<i class="fa-solid fa-pen-to-square" style="margin-right: 8px;"></i>Edit Automation';
  document.getElementById('ruleIdInput').value = String(rule.id);
  document.getElementById('ruleNameInput').value = rule.name || '';
  document.getElementById('ruleTriggerType').value = rule.trigger_type || 'exact';
  document.getElementById('ruleTriggerValue').value = rule.trigger_value || '';
  document.getElementById('ruleResponseContent').value = rule.response_content || '';
  document.getElementById('ruleIsActive').checked = Number(rule.is_active) === 1;

  handleTriggerTypeChange();
  updateProjectDropdowns();
  const projSelect = document.getElementById('autoProjectSelect');
  if (projSelect && rule.project_id) projSelect.value = rule.project_id;

  const modal = document.getElementById('automationModal');
  if (modal) modal.classList.add('active');
}

function closeAutomationModal() {
  const modal = document.getElementById('automationModal');
  if (modal) modal.classList.remove('active');
}

// Form Submit Handler
async function handleAutomationFormSubmit(e) {
  e.preventDefault();

  const id = document.getElementById('ruleIdInput').value;
  const project_id = document.getElementById('autoProjectSelect').value;
  const name = document.getElementById('ruleNameInput').value.trim();
  const trigger_type = document.getElementById('ruleTriggerType').value;
  let trigger_value = document.getElementById('ruleTriggerValue').value.trim();
  const response_content = document.getElementById('ruleResponseContent').value.trim();
  const is_active = document.getElementById('ruleIsActive').checked ? 1 : 0;
  const modal = document.getElementById('automationModal');
  const submitBtn = modal ? modal.querySelector('button[type="submit"]') : null;

  if (trigger_type === 'default') {
    trigger_value = '*';
  }

  if (!project_id) {
    showToast('Please select a project for this automation.', 'error');
    return;
  }

  // Exclusivity Check: Project can only run Manual Rules OR Visual Workflow
  if (window.Workflows && Array.isArray(window.Workflows.list)) {
    const linkedWorkflow = window.Workflows.list.find(w => String(w.project_id) === String(project_id) && Number(w.is_active) === 1);
    if (linkedWorkflow) {
      const proj = (projectsList || []).find(p => String(p.id) === String(project_id));
      const projName = proj ? proj.name : 'Selected Project';
      
      showExclusivityModal({
        title: 'Project Workflow Conflict',
        description: `Project <strong>"${escapeHtml(projName)}"</strong> is already connected to active Visual Workflow <strong>"${escapeHtml(linkedWorkflow.name)}"</strong>.<br><br>Each project can only have <strong>one automation mode</strong> active at a time (either Manual Automations or a Visual Workflow).<br><br>To create Manual Automations for <strong>${escapeHtml(projName)}</strong>, please unlink or delete the visual workflow first.`,
        actionText: 'Open Visual Workflow',
        onAction: () => {
          closeAutomationModal();
          if (typeof openAutomationsSubView === 'function') {
            openAutomationsSubView('workflow');
          }
          if (window.Workflows && window.Workflows.selectWorkflow) {
            window.Workflows.selectWorkflow(linkedWorkflow.id);
          }
        }
      });
      return; // Halt saving manual rule
    }
  }

  const payload = {
    project_id,
    name,
    trigger_type,
    trigger_value,
    response_type: 'text',
    response_content,
    is_active
  };

  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Saving...';
  }

  try {
    const safeFetch = window.authFetch || fetch;
    let res;
    if (id) {
      res = await safeFetch(`/api/v1/automations/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
    } else {
      res = await safeFetch('/api/v1/automations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
    }

    const data = await res.json();
    if (data.success) {
      showToast(id ? 'Automation updated successfully!' : 'Automation created successfully!', 'success');
      closeAutomationModal();

      // Instant optimistic update
      if (id && data.data) {
        const idx = automationsList.findIndex(a => String(a.id) === String(id));
        if (idx !== -1) {
          automationsList[idx] = data.data;
        } else {
          automationsList.push(data.data);
        }
      } else if (data.data) {
        automationsList.push(data.data);
      }

      renderProjectGroupedAutomations(projectsList, automationsList);
      loadAutomations();
      if (typeof loadProjects === 'function') loadProjects();
      if (typeof activeProjectId !== 'undefined' && activeProjectId) {
        loadProjectAutomations(activeProjectId);
      }
    } else {
      showToast(data.error || 'Failed to save automation.', 'error');
    }
  } catch (err) {
    showToast('Error: ' + err.message, 'error');
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.innerHTML = 'Save Automation';
    }
  }
}

// Toggle & Delete
async function toggleAutomation(id, newStatus) {
  const targetId = String(id);
  
  // 1. Optimistic instant UI update
  const rule = automationsList.find(a => String(a.id) === targetId);
  if (rule) {
    rule.is_active = Number(newStatus);
    renderProjectGroupedAutomations(projectsList, automationsList);
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
      showToast(newStatus ? 'Automation enabled.' : 'Automation disabled.', 'success');
      if (data.data) {
        const idx = automationsList.findIndex(a => String(a.id) === targetId);
        if (idx !== -1) automationsList[idx] = data.data;
        renderProjectGroupedAutomations(projectsList, automationsList);
      }
      loadAutomations();
      if (typeof activeProjectId !== 'undefined' && activeProjectId) {
        loadProjectAutomations(activeProjectId);
      }
    } else {
      showToast(data.error || 'Failed to toggle status.', 'error');
      loadAutomations();
    }
  } catch (err) {
    showToast('Toggle error: ' + err.message, 'error');
    loadAutomations();
  }
}

async function deleteAutomation(id) {
  if (!confirm('Are you sure you want to delete this automation rule?')) return;
  const targetId = String(id);

  // Optimistic removal
  automationsList = automationsList.filter(a => String(a.id) !== targetId);
  renderProjectGroupedAutomations(projectsList, automationsList);

  try {
    const safeFetch = window.authFetch || fetch;
    const res = await safeFetch(`/api/v1/automations/${targetId}`, { method: 'DELETE' });
    const data = await res.json();
    if (data.success) {
      showToast('Automation rule deleted.', 'info');
      loadAutomations();
      if (typeof loadProjects === 'function') loadProjects();
      if (typeof activeProjectId !== 'undefined' && activeProjectId) {
        loadProjectAutomations(activeProjectId);
      }
    } else {
      showToast(data.error || 'Delete failed.', 'error');
      loadAutomations();
    }
  } catch (err) {
    showToast('Delete error: ' + err.message, 'error');
    loadAutomations();
  }
}

// Custom Glassmorphic Dark-Themed Exclusivity Modal
let exclusivityActionCallback = null;

function showExclusivityModal({ title, description, actionText, onAction }) {
  const modal = document.getElementById('exclusivityModal');
  const titleEl = document.getElementById('exclusivityModalTitle');
  const descEl = document.getElementById('exclusivityModalDesc');
  const actionBtn = document.getElementById('exclusivityModalActionBtn');

  if (titleEl) titleEl.textContent = title || 'Automation Conflict';
  if (descEl) descEl.innerHTML = description || '';
  if (actionBtn) {
    actionBtn.textContent = actionText || 'Manage Existing Rules';
    exclusivityActionCallback = onAction || null;
  }

  if (modal) {
    modal.style.display = 'flex';
    modal.classList.add('active');
  }
}

function closeExclusivityModal() {
  const modal = document.getElementById('exclusivityModal');
  if (modal) {
    modal.style.display = 'none';
    modal.classList.remove('active');
  }
  exclusivityActionCallback = null;
}

function handleExclusivityAction() {
  if (typeof exclusivityActionCallback === 'function') {
    exclusivityActionCallback();
  }
  closeExclusivityModal();
}
