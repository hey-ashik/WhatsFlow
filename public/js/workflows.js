/**
 * WhatsFlow — Interactive Visual Workflow Builder
 * Node-based Automation & AI Agent Canvas (n8n / Langflow style)
 */

const Workflows = {
  list: [],
  current: null,
  scale: 1,
  pan: { x: 40, y: 40 },
  isPanning: false,
  panStart: { x: 0, y: 0 },
  isPinching: false,
  pinchStartDistance: null,
  pinchStartScale: 1,
  draggedNode: null,
  dragOffset: { x: 0, y: 0 },
  dragConnecting: null, // { sourceNodeId, sourceHandle, startX, startY }
  connectingClickSource: null, // click-to-connect fallback
  selectedNode: null,
  selectedEdge: null,
  chatHistory: [],
  undoStack: [],
  redoStack: [],
  maxUndoHistory: 40,
  isFullscreen: false,
  _shortcutsBound: false,

  // Starter Default Workflow
  defaultWorkflow: {
    name: 'Customer Support & FAQ Agent',
    description: 'Intelligent AI Agent with knowledge context and WhatsApp response output.',
    is_active: 1,
    nodes: [
      {
        id: 'node_trigger',
        type: 'whatsapp_trigger',
        label: 'When WhatsApp Message Received',
        x: 60,
        y: 180,
        data: {
          title: 'When Chat Message Received',
          description: 'Triggers on incoming customer WhatsApp text',
          event: 'message_received'
        }
      },
      {
        id: 'node_context',
        type: 'document_context',
        label: 'Knowledge & Business Context',
        x: 360,
        y: 60,
        data: {
          title: 'Knowledge Base',
          contextText: 'Business Name: WhatsFlow Support\nService: 24/7 WhatsApp API & Bot Automation\nSupport Hours: Always Online\nSpecial Offer: 20% discount on annual plans!'
        }
      },
      {
        id: 'node_agent',
        type: 'ai_agent',
        label: 'AI Support Agent (LLM)',
        x: 360,
        y: 260,
        data: {
          title: 'AI Support Agent',
          model: 'openai/gpt-oss-120b',
          promptTemplate: 'Answer the customer message: {{text}}',
          systemPrompt: 'You are an intelligent, friendly customer service agent. Answer clearly and concisely using the provided context.',
          temperature: 0.7
        }
      },
      {
        id: 'node_output',
        type: 'send_message',
        label: 'Send WhatsApp Reply',
        x: 720,
        y: 200,
        data: {
          title: 'Send WhatsApp Reply',
          messageTemplate: '{{ai_reply}}'
        }
      }
    ],
    edges: [
      { id: 'e_trig_agent', source: 'node_trigger', target: 'node_agent', sourceHandle: 'out', targetHandle: 'in' },
      { id: 'e_ctx_agent', source: 'node_context', target: 'node_agent', sourceHandle: 'out', targetHandle: 'context' },
      { id: 'e_agent_out', source: 'node_agent', target: 'node_output', sourceHandle: 'out', targetHandle: 'in' }
    ],
    settings: {
      ai_model: 'openai/gpt-oss-120b',
      ai_api_key: ''
    }
  },

  async init() {
    this.bindEvents();
    this.updateUndoRedoUI();

    // Default collapse controls menu on mobile screens
    if (window.innerWidth <= 900) {
      const wrap = document.getElementById('wfTopbarContentWrap');
      if (wrap) wrap.classList.add('collapsed');
      const icon = document.getElementById('wfMobileCollapseIcon');
      if (icon) icon.className = 'fa-solid fa-sliders';
    }

    await this.renderProjectDropdown();
    await this.loadWorkflows();
  },

  async renderProjectDropdown() {
    const projectSelect = document.getElementById('wfProjectSelect');
    if (!projectSelect) return;

    try {
      let projects = window.projectsList || [];
      if (projects.length === 0) {
        const res = await window.authFetch('/api/v1/projects');
        const json = await res.json();
        if (json.success && Array.isArray(json.data)) {
          projects = json.data;
          window.projectsList = projects;
        }
      }

      projectSelect.innerHTML = '<option value="">Global / All Projects</option>';
      projects.forEach(p => {
        const opt = document.createElement('option');
        opt.value = p.id;
        opt.textContent = `${p.name}`;
        projectSelect.appendChild(opt);
      });

      if (this.current?.project_id) {
        projectSelect.value = this.current.project_id;
      }
    } catch (err) {
      console.warn('[Workflows] Failed to load projects for dropdown:', err);
    }
  },

  async loadWorkflows() {
    try {
      const res = await window.authFetch('/api/v1/workflows');
      const json = await res.json();
      if (json.success && Array.isArray(json.data)) {
        this.list = json.data;
        this.renderWorkflowDropdown();

        if (this.list.length > 0) {
          this.selectWorkflow(this.list[0].id);
        } else {
          this.loadDefaultWorkflow();
        }
      }
    } catch (err) {
      console.warn('[Workflows] Failed to fetch workflows:', err.message);
      this.loadDefaultWorkflow();
    }
  },

  renderWorkflowDropdown() {
    const select = document.getElementById('workflowSelect');
    if (!select) return;

    select.innerHTML = '';
    this.list.forEach(w => {
      const opt = document.createElement('option');
      opt.value = w.id;
      opt.textContent = `${w.name} ${w.is_active ? '● Active' : '○ Paused'}`;
      select.appendChild(opt);
    });

    // Add option to create a brand new workflow
    const newOpt = document.createElement('option');
    newOpt.value = '__new__';
    newOpt.textContent = '+ Create New Workflow...';
    select.appendChild(newOpt);

    const countBadge = document.getElementById('workflowCountBadge');
    if (countBadge) countBadge.textContent = this.list.length;
  },

  selectWorkflow(id) {
    if (id === '__new__') {
      this.createNewWorkflowPrompt();
      return;
    }

    const found = this.list.find(w => String(w.id) === String(id));
    if (found) {
      this.current = JSON.parse(JSON.stringify(found));
      this.undoStack = [];
      this.redoStack = [];
      this.saveState();
      this.syncTopBar();
      this.renderCanvas();
    }
  },

  onProjectChange(projectId) {
    if (!this.current) return;
    this.current.project_id = projectId || null;
  },

  onModelChange(model) {
    if (!this.current) return;
    if (!this.current.settings) this.current.settings = {};
    this.current.settings.ai_model = model;

    const link = document.getElementById('wfKeyHelpLink');
    if (link) {
      link.href = 'https://console.groq.com/keys';
      link.title = 'Get Groq API Key';
    }
  },

  onActiveToggleChange(isActive) {
    if (this.current) {
      this.current.is_active = isActive ? 1 : 0;
    }
    const label = document.getElementById('wfToggleStatusLabel');
    if (label) {
      label.textContent = isActive ? 'Active' : 'Paused';
      label.style.color = isActive ? '#10b981' : 'var(--text-secondary)';
    }
  },

  createNewWorkflowPrompt() {
    const name = prompt('Enter a name for the new workflow:', 'Custom AI Automation');
    if (!name || !name.trim()) {
      this.renderWorkflowDropdown();
      if (this.current) {
        document.getElementById('workflowSelect').value = this.current.id;
      }
      return;
    }

    const projectSelect = document.getElementById('wfProjectSelect');
    const selectedProjectId = projectSelect?.value || null;

    this.current = {
      id: `wf_${Date.now()}`,
      name: name.trim(),
      description: 'Custom Visual Workflow',
      project_id: selectedProjectId,
      is_active: 1,
      nodes: [
        {
          id: `node_${Date.now()}_1`,
          type: 'whatsapp_trigger',
          label: 'When WhatsApp Message Received',
          x: 60,
          y: 180,
          data: { title: 'When Chat Message Received', event: 'message_received' }
        },
        {
          id: `node_${Date.now()}_2`,
          type: 'send_message',
          label: 'Send WhatsApp Reply',
          x: 420,
          y: 180,
          data: { title: 'Send Reply', messageTemplate: 'Hello! Thanks for reaching out.' }
        }
      ],
      edges: [
        {
          id: `e_${Date.now()}`,
          source: `node_${Date.now()}_1`,
          target: `node_${Date.now()}_2`,
          sourceHandle: 'out',
          targetHandle: 'in'
        }
      ],
      settings: {
        ai_model: 'gpt-4o-mini',
        ai_api_key: ''
      }
    };

    this.undoStack = [];
    this.redoStack = [];
    this.saveState();
    this.syncTopBar();
    this.renderCanvas();
    this.saveWorkflow();
  },

  loadDefaultWorkflow() {
    const tpl = this.defaultWorkflow;
    this.current = {
      id: `wf_${Date.now()}`,
      name: tpl.name,
      description: tpl.description,
      project_id: null,
      is_active: 1,
      nodes: JSON.parse(JSON.stringify(tpl.nodes)),
      edges: JSON.parse(JSON.stringify(tpl.edges)),
      settings: JSON.parse(JSON.stringify(tpl.settings || {}))
    };

    this.undoStack = [];
    this.redoStack = [];
    this.saveState();
    this.syncTopBar();
    this.renderCanvas();
  },

  syncTopBar() {
    if (!this.current) return;
    const modelSelect = document.getElementById('wfModelSelect');
    const projectSelect = document.getElementById('wfProjectSelect');
    const activeToggle = document.getElementById('wfActiveToggle');
    const apiKeyInput = document.getElementById('wfApiKeyInput');
    const wfSelect = document.getElementById('workflowSelect');

    if (wfSelect && this.current.id) {
      wfSelect.value = this.current.id;
    }
    if (projectSelect) {
      projectSelect.value = this.current.project_id || '';
    }
    if (modelSelect) {
      const model = this.current.settings?.ai_model || 'gpt-4o-mini';
      modelSelect.value = model;
      this.onModelChange(model);
    }
    if (activeToggle) {
      const isActive = Boolean(this.current.is_active);
      activeToggle.checked = isActive;
      this.onActiveToggleChange(isActive);
    }
    if (apiKeyInput) {
      apiKeyInput.value = this.current.settings?.ai_api_key || '';
    }
  },

  async saveWorkflow() {
    if (!this.current) return;

    const modelSelect = document.getElementById('wfModelSelect');
    const projectSelect = document.getElementById('wfProjectSelect');
    const activeToggle = document.getElementById('wfActiveToggle');
    const apiKeyInput = document.getElementById('wfApiKeyInput');

    if (!this.current.settings) this.current.settings = {};
    if (modelSelect) this.current.settings.ai_model = modelSelect.value;
    if (apiKeyInput) this.current.settings.ai_api_key = apiKeyInput.value.trim();
    if (projectSelect) this.current.project_id = projectSelect.value || null;
    if (activeToggle) this.current.is_active = activeToggle.checked ? 1 : 0;

    // Exclusivity Check: Project can only run Manual Rules OR Visual Workflow
    if (this.current.project_id && Number(this.current.is_active) === 1) {
      const projId = this.current.project_id;
      const proj = (window.projectsList || []).find(p => String(p.id) === String(projId));
      const projName = proj ? proj.name : 'Selected Project';
      const projRules = (window.automationsList || []).filter(a => String(a.project_id) === String(projId));

      if (projRules.length > 0) {
        if (typeof showExclusivityModal === 'function') {
          showExclusivityModal({
            title: 'Project Automation Conflict',
            description: `Project <strong>"${escapeHtml(projName)}"</strong> already has <strong>${projRules.length} Manual Automation rule(s)</strong>.<br><br>Each project can only have <strong>one automation mode</strong> active at a time (either Manual Automations or a Visual Workflow).<br><br>To activate this Visual Workflow for <strong>${escapeHtml(projName)}</strong>, please delete the manual automation rules from this project first.`,
            actionText: 'View & Manage Manual Rules',
            onAction: () => {
              if (typeof openAutomationsSubView === 'function') {
                openAutomationsSubView('manual');
              }
            }
          });
        } else {
          showToast(`Project "${projName}" has existing manual rules. Delete them first.`, 'error');
        }
        return; // Halt saving to conflicting project
      }
    }

    try {
      const isExisting = this.list.some(w => String(w.id) === String(this.current.id));
      const url = isExisting ? `/api/v1/workflows/${this.current.id}` : '/api/v1/workflows';
      const method = isExisting ? 'PUT' : 'POST';

      const res = await window.authFetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(this.current)
      });

      const json = await res.json();
      if (json.success) {
        showToast('✓ Workflow saved successfully!', 'success');
        await this.loadWorkflows();
        if (json.data && json.data.id) this.selectWorkflow(json.data.id);
      } else {
        showToast(json.error || 'Failed to save workflow.', 'error');
      }
    } catch (err) {
      showToast('Error saving workflow: ' + err.message, 'error');
    }
  },

  async deleteCurrentWorkflow() {
    if (!this.current || !this.current.id) return;
    if (!confirm(`Are you sure you want to delete workflow "${this.current.name}"?`)) return;

    try {
      const res = await window.authFetch(`/api/v1/workflows/${this.current.id}`, { method: 'DELETE' });
      const json = await res.json();
      if (json.success) {
        showToast('Workflow deleted.', 'info');
        await this.loadWorkflows();
      } else {
        showToast(json.error || 'Delete failed.', 'error');
      }
    } catch (err) {
      showToast('Delete error: ' + err.message, 'error');
    }
  },

  // ================= CANVAS RENDERING & UNIFIED VIEWPORT =================
  renderCanvas() {
    const viewport = document.getElementById('wfCanvasViewport');
    const svgLayer = document.getElementById('wfSvgLayer');
    const nodesLayer = document.getElementById('wfNodesLayer');
    if (!viewport || !svgLayer || !nodesLayer || !this.current) return;

    // Unified coordinate transform
    viewport.style.transform = `translate(${this.pan.x}px, ${this.pan.y}px) scale(${this.scale})`;
    viewport.style.transformOrigin = '0 0';

    // Clear previous elements
    nodesLayer.innerHTML = '';

    // 1. Render Wires (Edges)
    this.renderWires();

    // 2. Render Nodes
    this.current.nodes.forEach(node => {
      const el = this.createNodeElement(node);
      nodesLayer.appendChild(el);
    });
  },

  createNodeElement(node) {
    const el = document.createElement('div');
    el.className = `wf-node wf-node-${node.type} ${this.selectedNode?.id === node.id ? 'selected' : ''}`;
    el.id = `node_${node.id}`;
    el.style.left = `${node.x}px`;
    el.style.top = `${node.y}px`;

    // Icon mapping
    const icons = {
      whatsapp_trigger: 'fa-bolt text-amber',
      keyword_filter: 'fa-filter text-blue',
      ai_agent: 'fa-robot text-purple',
      document_context: 'fa-book-open text-emerald',
      http_request: 'fa-network-wired text-cyan',
      send_message: 'fa-paper-plane text-emerald'
    };

    const iconClass = icons[node.type] || 'fa-cube';
    const title = node.data?.title || node.label || 'Node';
    const subtitle = this.getNodeSubtitle(node);

    el.innerHTML = `
      <div class="wf-node-header">
        <div class="wf-node-icon-box"><i class="fa-solid ${iconClass}"></i></div>
        <div class="wf-node-info">
          <div class="wf-node-title">${escapeHtml(title)}</div>
          <div class="wf-node-type-badge">${this.getNodeBadge(node.type)}</div>
        </div>
        <button class="wf-node-btn-edit" title="Configure Node" onclick="Workflows.openNodeConfig('${node.id}', event)">
          <i class="fa-solid fa-sliders"></i>
        </button>
      </div>
      <div class="wf-node-body">
        <div class="wf-node-summary">${escapeHtml(subtitle)}</div>
      </div>
      <!-- Handles / Ports -->
      ${node.type !== 'whatsapp_trigger' ? `<div class="wf-port wf-port-in" data-node-id="${node.id}" data-handle="in" title="Connect Input Here"></div>` : ''}
      ${node.type === 'ai_agent' ? `<div class="wf-port wf-port-context" data-node-id="${node.id}" data-handle="context" title="Connect Knowledge Context Here"></div>` : ''}
      <div class="wf-port wf-port-out" data-node-id="${node.id}" data-handle="out" title="Drag to Connect Output"></div>
    `;

    // Node Drag event handlers (Mouse)
    el.addEventListener('mousedown', (e) => {
      if (e.target.classList.contains('wf-port') || e.target.closest('.wf-node-btn-edit')) return;
      this.draggedNode = node;
      this.dragOffset = {
        x: (e.clientX / this.scale) - node.x,
        y: (e.clientY / this.scale) - node.y
      };
      this.selectedNode = node;
      if (this.selectedEdge) {
        this.selectedEdge = null;
        this.renderWires();
      }
      document.querySelectorAll('.wf-node').forEach(n => n.classList.remove('selected'));
      el.classList.add('selected');
      e.stopPropagation();
    });

    // Node Touch Drag handler (Mobile 1-finger drag)
    el.addEventListener('touchstart', (e) => {
      if (e.touches.length === 1) {
        const touch = e.touches[0];
        if (e.target.classList.contains('wf-port') || e.target.closest('.wf-node-btn-edit')) return;
        this.draggedNode = node;
        this.dragOffset = {
          x: (touch.clientX / this.scale) - node.x,
          y: (touch.clientY / this.scale) - node.y
        };
        this.selectedNode = node;
        if (this.selectedEdge) {
          this.selectedEdge = null;
          this.renderWires();
        }
        document.querySelectorAll('.wf-node').forEach(n => n.classList.remove('selected'));
        el.classList.add('selected');
        e.stopPropagation();
      }
    }, { passive: true });

    // Double click to open editor on desktop
    el.addEventListener('dblclick', () => {
      this.openNodeConfig(node.id);
    });

    return el;
  },

  getNodeBadge(type) {
    const badges = {
      whatsapp_trigger: 'START TRIGGER',
      keyword_filter: 'FILTER',
      ai_agent: 'AI AGENT',
      document_context: 'KNOWLEDGE',
      http_request: 'WEBHOOK',
      send_message: 'SEND REPLY'
    };
    return badges[type] || 'NODE';
  },

  getNodeSubtitle(node) {
    if (node.type === 'whatsapp_trigger') return 'Listens for incoming customer chat';
    if (node.type === 'keyword_filter') return `${node.data?.condition || 'contains'}: "${node.data?.keyword || 'order'}"`;
    if (node.type === 'ai_agent') return `Model: ${node.data?.model || 'gpt-4o-mini'}`;
    if (node.type === 'document_context') return `Knowledge: ${(node.data?.contextText || '').slice(0, 32)}...`;
    if (node.type === 'http_request') return `${node.data?.method || 'POST'} ${(node.data?.url || '').slice(0, 22)}...`;
    if (node.type === 'send_message') return `Reply: ${(node.data?.messageTemplate || '{{ai_reply}}').slice(0, 28)}...`;
    return 'Configured';
  },

  deleteEdge(edgeId) {
    if (!this.current) return;
    this.current.edges = (this.current.edges || []).filter(ed => ed.id !== edgeId);
    if (this.selectedEdge && this.selectedEdge.id === edgeId) {
      this.selectedEdge = null;
    }
    this.saveState();
    this.renderWires();
    showToast('✓ Connection removed.', 'info');
  },

  renderWires() {
    const svgLayer = document.getElementById('wfSvgLayer');
    if (!svgLayer || !this.current) return;
    svgLayer.innerHTML = '';

    (this.current.edges || []).forEach(edge => {
      const sourceNode = this.current.nodes.find(n => n.id === edge.source);
      const targetNode = this.current.nodes.find(n => n.id === edge.target);
      if (!sourceNode || !targetNode) return;

      // Calculate exact port centers
      const x1 = sourceNode.x + 240; // width of node
      const y1 = sourceNode.y + 42;
      const x2 = targetNode.x;
      const y2 = edge.targetHandle === 'context' ? targetNode.y + 66 : targetNode.y + 42;

      const dx = Math.max(60, Math.abs(x2 - x1) * 0.55);
      const offsetX = Number(edge.curveOffsetX || 0);
      const offsetY = Number(edge.curveOffsetY || 0);

      // Smooth natural cubic bezier control points with curve offset support
      const cp1X = x1 + dx + (offsetX * 0.75);
      const cp1Y = y1 + (offsetY * 0.85);
      const cp2X = x2 - dx + (offsetX * 0.75);
      const cp2Y = y2 + (offsetY * 0.85);

      const d = `M ${x1} ${y1} C ${cp1X} ${cp1Y}, ${cp2X} ${cp2Y}, ${x2} ${y2}`;
      const midX = Math.round((x1 + x2) / 2 + offsetX);
      const midY = Math.round((y1 + y2) / 2 + offsetY);

      const isSelected = Boolean(this.selectedEdge && this.selectedEdge.id === edge.id);

      // SVG Group wrapper
      const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      group.setAttribute('class', `wf-wire-group ${isSelected ? 'selected' : ''}`);
      group.setAttribute('data-edge-id', edge.id);

      // 1. Extra Wide Invisible Hitbox for effortless hover & selection
      const hitPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      hitPath.setAttribute('d', d);
      hitPath.setAttribute('class', 'wf-wire-hitbox');
      hitPath.setAttribute('data-edge-id', edge.id);
      hitPath.setAttribute('title', 'Click line to select (glows red) & delete with ✕');

      // 2. Visible Bezier Wire (Clean flow line without arrowheads)
      const wirePath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      wirePath.setAttribute('d', d);
      wirePath.setAttribute('class', `wf-wire ${edge.targetHandle === 'context' ? 'wf-wire-context' : ''} ${isSelected ? 'selected' : ''}`);

      // 3. Draggable Curvature Point Handle (subtle control handle)
      const curveHandle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      curveHandle.setAttribute('cx', midX - 22);
      curveHandle.setAttribute('cy', midY);
      curveHandle.setAttribute('r', isSelected ? '8' : '7');
      curveHandle.setAttribute('class', `wf-wire-curve-handle ${isSelected ? 'selected' : ''}`);
      curveHandle.setAttribute('data-edge-id', edge.id);
      curveHandle.setAttribute('title', 'Drag anywhere to bend & curve this line • Double click to reset');

      // 4. Prominent Floating Delete Cross Badge (✕) centered on the wire
      const badgeGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      badgeGroup.setAttribute('class', `wf-wire-badge ${isSelected ? 'selected' : ''}`);
      badgeGroup.setAttribute('transform', `translate(${midX + (isSelected ? 14 : 0)}, ${midY})`);
      badgeGroup.setAttribute('title', 'Click ✕ to delete connection');

      const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      circle.setAttribute('r', '14');
      circle.setAttribute('class', 'wf-wire-badge-circle');

      const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      text.setAttribute('class', 'wf-wire-badge-text');
      text.textContent = '✕';

      badgeGroup.appendChild(circle);
      badgeGroup.appendChild(text);

      // Event: Click to select line (turns red & reveals controls)
      const selectThisEdge = (e) => {
        e.stopPropagation();
        this.selectedEdge = edge;
        this.selectedNode = null;
        document.querySelectorAll('.wf-node').forEach(n => n.classList.remove('selected'));
        this.renderWires();
      };

      hitPath.addEventListener('click', selectThisEdge);
      wirePath.addEventListener('click', selectThisEdge);
      group.addEventListener('click', selectThisEdge);

      // Event: Click Delete Badge to remove connection immediately
      const deleteThisEdge = (e) => {
        e.stopPropagation();
        this.deleteEdge(edge.id);
      };

      badgeGroup.addEventListener('click', deleteThisEdge);
      badgeGroup.addEventListener('mousedown', (e) => e.stopPropagation());
      badgeGroup.addEventListener('touchstart', (e) => e.stopPropagation());

      // Curve dragging start (Mouse & Touch)
      const startCurveDrag = (clientX, clientY, e) => {
        this.draggingCurveEdge = edge;
        this.dragCurveStart = {
          mouseX: clientX,
          mouseY: clientY,
          initialOffsetX: Number(edge.curveOffsetX || 0),
          initialOffsetY: Number(edge.curveOffsetY || 0)
        };
        curveHandle.classList.add('active');
        if (e) e.stopPropagation();
      };

      curveHandle.addEventListener('mousedown', (e) => startCurveDrag(e.clientX, e.clientY, e));
      curveHandle.addEventListener('touchstart', (e) => {
        if (e.touches.length === 1) {
          startCurveDrag(e.touches[0].clientX, e.touches[0].clientY, e);
        }
      }, { passive: false });

      // Double-click to reset curve
      curveHandle.addEventListener('dblclick', (e) => {
        e.stopPropagation();
        edge.curveOffsetX = 0;
        edge.curveOffsetY = 0;
        this.saveState();
        this.renderWires();
        showToast('Line curve reset.', 'info');
      });

      group.appendChild(hitPath);
      group.appendChild(wirePath);
      group.appendChild(curveHandle);
      group.appendChild(badgeGroup);

      svgLayer.appendChild(group);
    });
  },

  toggleMobileTopbar() {
    const wrap = document.getElementById('wfTopbarContentWrap');
    const icon = document.getElementById('wfMobileCollapseIcon');
    if (!wrap) return;
    const isCollapsed = wrap.classList.toggle('collapsed');
    if (icon) {
      icon.className = isCollapsed ? 'fa-solid fa-sliders' : 'fa-solid fa-chevron-up';
    }
  },

  // ================= EVENT BINDINGS & LIVE DRAG WIRES =================
  bindEvents() {
    const canvas = document.getElementById('wfCanvas');
    if (!canvas) return;

    // Sync API key input directly to active workflow settings
    const apiKeyInput = document.getElementById('wfApiKeyInput');
    if (apiKeyInput && !apiKeyInput._boundSync) {
      apiKeyInput._boundSync = true;
      apiKeyInput.addEventListener('input', (e) => {
        if (!this.current) return;
        if (!this.current.settings) this.current.settings = {};
        this.current.settings.ai_api_key = e.target.value.trim();
      });
    }

    // 1. Mouse Down (Desktop Dragging / Panning / Port Connection)
    canvas.addEventListener('mousedown', (e) => {
      // Check if clicking port
      const port = e.target.closest('.wf-port');
      if (port) {
        const nodeId = port.getAttribute('data-node-id');
        const handle = port.getAttribute('data-handle');
        const node = this.current?.nodes.find(n => n.id === nodeId);

        if (handle === 'out' && node) {
          this.dragConnecting = {
            sourceNodeId: nodeId,
            sourceHandle: 'out',
            startX: node.x + 240,
            startY: node.y + 42
          };
          this.createDragWire(this.dragConnecting.startX, this.dragConnecting.startY);
          e.stopPropagation();
          return;
        } else if ((handle === 'in' || handle === 'context') && node) {
          // Interactive Detach / Reconnect: If port already has connected wire, detach it and drag to reconnect!
          const existingEdgeIdx = (this.current?.edges || []).findIndex(ed => ed.target === nodeId && ed.targetHandle === handle);
          if (existingEdgeIdx !== -1) {
            const existingEdge = this.current.edges[existingEdgeIdx];
            const sourceNode = this.current.nodes.find(n => n.id === existingEdge.source);
            if (sourceNode) {
              this.current.edges.splice(existingEdgeIdx, 1);
              this.saveState();
              this.renderWires();

              this.dragConnecting = {
                sourceNodeId: sourceNode.id,
                sourceHandle: existingEdge.sourceHandle || 'out',
                startX: sourceNode.x + 240,
                startY: sourceNode.y + 42
              };
              this.createDragWire(this.dragConnecting.startX, this.dragConnecting.startY);
              showToast('Detached connection. Drag to reconnect to another node.', 'info');
              e.stopPropagation();
              return;
            }
          }
        }
      }

      if (e.target === canvas || e.target.id === 'wfCanvasViewport' || e.target.id === 'wfSvgLayer' || e.target.id === 'wfNodesLayer') {
        this.isPanning = true;
        this.panStart = { x: e.clientX - this.pan.x, y: e.clientY - this.pan.y };
        if (this.selectedEdge || this.selectedNode) {
          this.selectedEdge = null;
          this.selectedNode = null;
          document.querySelectorAll('.wf-node').forEach(n => n.classList.remove('selected'));
          this.renderWires();
        }
      }
    });

    // 2. Touch Start (Mobile 1-finger drag/pan & 2-finger pinch-to-zoom)
    canvas.addEventListener('touchstart', (e) => {
      // Pinch-to-Zoom with 2 fingers
      if (e.touches.length === 2) {
        const t1 = e.touches[0];
        const t2 = e.touches[1];
        this.pinchStartDistance = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
        this.pinchStartScale = this.scale;
        this.isPinching = true;
        this.isPanning = false;
        this.draggedNode = null;
        this.dragConnecting = null;
        this.draggingCurveEdge = null;
        if (e.cancelable) e.preventDefault();
        return;
      }

      // Single finger touch handling
      if (e.touches.length === 1) {
        const touch = e.touches[0];

        // A. Touching curve handle
        const curveHandle = e.target.closest('.wf-wire-curve-handle');
        if (curveHandle) {
          const edgeId = curveHandle.getAttribute('data-edge-id');
          const edge = (this.current.edges || []).find(ed => ed.id === edgeId);
          if (edge) {
            this.draggingCurveEdge = edge;
            this.dragCurveStart = {
              mouseX: touch.clientX,
              mouseY: touch.clientY,
              initialOffsetX: Number(edge.curveOffsetX || 0),
              initialOffsetY: Number(edge.curveOffsetY || 0)
            };
            return;
          }
        }

        // B. Touching port -> start drag connecting or detach and reconnect
        const port = e.target.closest('.wf-port');
        if (port) {
          const nodeId = port.getAttribute('data-node-id');
          const handle = port.getAttribute('data-handle');
          const node = this.current?.nodes.find(n => n.id === nodeId);

          if (handle === 'out' && node) {
            this.dragConnecting = {
              sourceNodeId: nodeId,
              sourceHandle: 'out',
              startX: node.x + 240,
              startY: node.y + 42
            };
            this.createDragWire(this.dragConnecting.startX, this.dragConnecting.startY);
            return;
          } else if ((handle === 'in' || handle === 'context') && node) {
            const existingEdgeIdx = (this.current?.edges || []).findIndex(ed => ed.target === nodeId && ed.targetHandle === handle);
            if (existingEdgeIdx !== -1) {
              const existingEdge = this.current.edges[existingEdgeIdx];
              const sourceNode = this.current.nodes.find(n => n.id === existingEdge.source);
              if (sourceNode) {
                this.current.edges.splice(existingEdgeIdx, 1);
                this.saveState();
                this.renderWires();

                this.dragConnecting = {
                  sourceNodeId: sourceNode.id,
                  sourceHandle: existingEdge.sourceHandle || 'out',
                  startX: sourceNode.x + 240,
                  startY: sourceNode.y + 42
                };
                this.createDragWire(this.dragConnecting.startX, this.dragConnecting.startY);
                showToast('Detached connection. Drag to reconnect.', 'info');
                return;
              }
            }
          }
        }

        // C. Touching node -> select and prepare for dragging
        const nodeEl = e.target.closest('.wf-node');
        if (nodeEl && !port && !e.target.closest('.wf-node-btn-edit')) {
          const nodeId = nodeEl.id.replace('node_', '');
          const node = this.current?.nodes.find(n => n.id === nodeId);
          if (node) {
            this.draggedNode = node;
            this.dragOffset = {
              x: (touch.clientX / this.scale) - node.x,
              y: (touch.clientY / this.scale) - node.y
            };
            this.selectedNode = node;
            if (this.selectedEdge) {
              this.selectedEdge = null;
              this.renderWires();
            }
            document.querySelectorAll('.wf-node').forEach(n => n.classList.remove('selected'));
            nodeEl.classList.add('selected');
            return;
          }
        }

        if (port) return;

        // D. Canvas Panning
        this.isPanning = true;
        this.panStart = { x: touch.clientX - this.pan.x, y: touch.clientY - this.pan.y };
        if (this.selectedEdge || this.selectedNode) {
          this.selectedEdge = null;
          this.selectedNode = null;
          document.querySelectorAll('.wf-node').forEach(n => n.classList.remove('selected'));
          this.renderWires();
        }
      }
    }, { passive: false });

    // 3. Touch Move (Pinch zoom & live dragging)
    window.addEventListener('touchmove', (e) => {
      // A. Pinch to zoom
      if (e.touches.length === 2 && this.isPinching && this.pinchStartDistance) {
        const t1 = e.touches[0];
        const t2 = e.touches[1];
        const currentDistance = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
        if (this.pinchStartDistance > 0) {
          const scaleRatio = currentDistance / this.pinchStartDistance;
          this.scale = Math.max(0.35, Math.min(2.5, Number((this.pinchStartScale * scaleRatio).toFixed(3))));
          const viewport = document.getElementById('wfCanvasViewport');
          if (viewport) {
            viewport.style.transform = `translate(${this.pan.x}px, ${this.pan.y}px) scale(${this.scale})`;
          }
        }
        if (e.cancelable) e.preventDefault();
        return;
      }

      // B. 1-Finger touch dragging
      if (e.touches.length === 1) {
        const touch = e.touches[0];

        // Dragging wire curve
        if (this.draggingCurveEdge) {
          const deltaX = (touch.clientX - this.dragCurveStart.mouseX) / this.scale;
          const deltaY = (touch.clientY - this.dragCurveStart.mouseY) / this.scale;
          this.draggingCurveEdge.curveOffsetX = Math.round(this.dragCurveStart.initialOffsetX + deltaX);
          this.draggingCurveEdge.curveOffsetY = Math.round(this.dragCurveStart.initialOffsetY + deltaY);
          this.renderWires();
          if (e.cancelable) e.preventDefault();
          return;
        }

        // Dragging node
        if (this.draggedNode) {
          this.draggedNode.x = Math.round((touch.clientX / this.scale) - this.dragOffset.x);
          this.draggedNode.y = Math.round((touch.clientY / this.scale) - this.dragOffset.y);

          const nodeEl = document.getElementById(`node_${this.draggedNode.id}`);
          if (nodeEl) {
            nodeEl.style.left = `${this.draggedNode.x}px`;
            nodeEl.style.top = `${this.draggedNode.y}px`;
          }
          this.renderWires();
          if (e.cancelable) e.preventDefault();
          return;
        }

        // Dragging wire connection
        if (this.dragConnecting) {
          const canvasRect = canvas.getBoundingClientRect();
          const mouseCanvasX = (touch.clientX - canvasRect.left - this.pan.x) / this.scale;
          const mouseCanvasY = (touch.clientY - canvasRect.top - this.pan.y) / this.scale;
          this.updateDragWire(this.dragConnecting.startX, this.dragConnecting.startY, mouseCanvasX, mouseCanvasY);
          if (e.cancelable) e.preventDefault();
          return;
        }

        // Canvas Panning
        if (this.isPanning) {
          this.pan.x = touch.clientX - this.panStart.x;
          this.pan.y = touch.clientY - this.panStart.y;
          const viewport = document.getElementById('wfCanvasViewport');
          if (viewport) {
            viewport.style.transform = `translate(${this.pan.x}px, ${this.pan.y}px) scale(${this.scale})`;
          }
          if (e.cancelable) e.preventDefault();
        }
      }
    }, { passive: false });

    // 4. Touch End (Drop connections, finish gestures)
    window.addEventListener('touchend', (e) => {
      if (this.dragConnecting) {
        const changedTouch = e.changedTouches ? e.changedTouches[0] : null;
        if (changedTouch) {
          const elUnder = document.elementFromPoint(changedTouch.clientX, changedTouch.clientY);
          const port = elUnder ? elUnder.closest('.wf-port') : null;
          if (port) {
            const targetNodeId = port.getAttribute('data-node-id');
            const targetHandle = port.getAttribute('data-handle');

            if (targetNodeId && targetNodeId !== this.dragConnecting.sourceNodeId && (targetHandle === 'in' || targetHandle === 'context')) {
              const exists = (this.current.edges || []).some(ed => 
                ed.source === this.dragConnecting.sourceNodeId && 
                ed.target === targetNodeId && 
                ed.targetHandle === targetHandle
              );

              if (!exists) {
                this.current.edges.push({
                  id: `e_${this.dragConnecting.sourceNodeId}_${targetNodeId}_${Date.now()}`,
                  source: this.dragConnecting.sourceNodeId,
                  target: targetNodeId,
                  sourceHandle: 'out',
                  targetHandle: targetHandle
                });
                this.saveState();
                showToast('✓ Connected!', 'success');
              }
            }
          }
        }
        this.removeDragWire();
        this.dragConnecting = null;
        this.renderWires();
      }

      if (this.draggedNode || this.draggingCurveEdge) {
        this.saveState();
      }

      this.draggingCurveEdge = null;
      this.draggedNode = null;
      this.isPanning = false;

      if (!e.touches || e.touches.length < 2) {
        this.isPinching = false;
        this.pinchStartDistance = null;
      }
    });

    // 5. Global Mouse Move (Desktop)
    window.addEventListener('mousemove', (e) => {
      // Dragging a wire curve / bend point
      if (this.draggingCurveEdge) {
        const deltaX = (e.clientX - this.dragCurveStart.mouseX) / this.scale;
        const deltaY = (e.clientY - this.dragCurveStart.mouseY) / this.scale;
        this.draggingCurveEdge.curveOffsetX = Math.round(this.dragCurveStart.initialOffsetX + deltaX);
        this.draggingCurveEdge.curveOffsetY = Math.round(this.dragCurveStart.initialOffsetY + deltaY);
        this.renderWires();
        return;
      }

      // Dragging a node
      if (this.draggedNode) {
        this.draggedNode.x = Math.round((e.clientX / this.scale) - this.dragOffset.x);
        this.draggedNode.y = Math.round((e.clientY / this.scale) - this.dragOffset.y);

        const nodeEl = document.getElementById(`node_${this.draggedNode.id}`);
        if (nodeEl) {
          nodeEl.style.left = `${this.draggedNode.x}px`;
          nodeEl.style.top = `${this.draggedNode.y}px`;
        }
        this.renderWires();
      }

      // Live Dragging Wire Connection
      if (this.dragConnecting) {
        const canvasRect = canvas.getBoundingClientRect();
        const mouseCanvasX = (e.clientX - canvasRect.left - this.pan.x) / this.scale;
        const mouseCanvasY = (e.clientY - canvasRect.top - this.pan.y) / this.scale;
        this.updateDragWire(this.dragConnecting.startX, this.dragConnecting.startY, mouseCanvasX, mouseCanvasY);
      }

      // Canvas Panning
      if (this.isPanning) {
        this.pan.x = e.clientX - this.panStart.x;
        this.pan.y = e.clientY - this.panStart.y;
        const viewport = document.getElementById('wfCanvasViewport');
        if (viewport) {
          viewport.style.transform = `translate(${this.pan.x}px, ${this.pan.y}px) scale(${this.scale})`;
        }
      }
    });

    // 6. Global Mouse Up / Wire Drop Connection (Desktop)
    window.addEventListener('mouseup', (e) => {
      if (this.dragConnecting) {
        const port = e.target.closest('.wf-port');
        if (port) {
          const targetNodeId = port.getAttribute('data-node-id');
          const targetHandle = port.getAttribute('data-handle');

          if (targetNodeId && targetNodeId !== this.dragConnecting.sourceNodeId && (targetHandle === 'in' || targetHandle === 'context')) {
            const exists = this.current.edges.some(ed => 
              ed.source === this.dragConnecting.sourceNodeId && 
              ed.target === targetNodeId && 
              ed.targetHandle === targetHandle
            );

            if (!exists) {
              const newEdge = {
                id: `e_${this.dragConnecting.sourceNodeId}_${targetNodeId}_${Date.now()}`,
                source: this.dragConnecting.sourceNodeId,
                target: targetNodeId,
                sourceHandle: 'out',
                targetHandle: targetHandle
              };
              this.current.edges.push(newEdge);
              this.saveState();
              showToast('✓ Connected!', 'success');
            }
          }
        }

        this.removeDragWire();
        this.dragConnecting = null;
        this.renderWires();
      }

      if (this.draggedNode || this.draggingCurveEdge) {
        this.saveState();
      }

      this.draggingCurveEdge = null;
      this.draggedNode = null;
      this.isPanning = false;
    });

    // 7. Click-to-Connect / Tap-to-Connect
    canvas.addEventListener('click', (e) => {
      const port = e.target.closest('.wf-port');
      if (port) {
        const nodeId = port.getAttribute('data-node-id');
        const handle = port.getAttribute('data-handle');

        if (!this.connectingClickSource) {
          if (handle === 'out') {
            this.connectingClickSource = { nodeId, handle };
            port.classList.add('active-port');
            showToast('Tap target node input port to connect.', 'info');
          }
        } else {
          if (handle === 'in' || handle === 'context') {
            if (this.connectingClickSource.nodeId !== nodeId) {
              const newEdge = {
                id: `e_${this.connectingClickSource.nodeId}_${nodeId}_${Date.now()}`,
                source: this.connectingClickSource.nodeId,
                target: nodeId,
                sourceHandle: this.connectingClickSource.handle,
                targetHandle: handle
              };
              this.current.edges.push(newEdge);
              this.saveState();
              this.renderWires();
              showToast('✓ Connected!', 'success');
            }
          }
          document.querySelectorAll('.wf-port').forEach(p => p.classList.remove('active-port'));
          this.connectingClickSource = null;
        }
      }
    });

    // 8. Canvas Zoom with Ctrl + Wheel
    canvas.addEventListener('wheel', (e) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        const zoomDelta = e.deltaY < 0 ? 0.08 : -0.08;
        this.scale = Math.max(0.35, Math.min(2.5, Number((this.scale + zoomDelta).toFixed(2))));
        const viewport = document.getElementById('wfCanvasViewport');
        if (viewport) {
          viewport.style.transform = `translate(${this.pan.x}px, ${this.pan.y}px) scale(${this.scale})`;
        }
      }
    }, { passive: false });

    // 9. Global Keyboard Shortcuts (Undo, Redo, Delete Wire/Node, Fullscreen Escape)
    if (!this._shortcutsBound) {
      this._shortcutsBound = true;
      window.addEventListener('keydown', (e) => {
        const container = document.getElementById('autoWorkflowContainer');
        if (!container || container.style.display === 'none') return;

        if (['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) return;

        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
          e.preventDefault();
          if (e.shiftKey) {
            this.redo();
          } else {
            this.undo();
          }
        } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
          e.preventDefault();
          this.redo();
        } else if (e.key === 'Delete' || e.key === 'Backspace') {
          if (this.selectedEdge) {
            e.preventDefault();
            this.deleteEdge(this.selectedEdge.id);
          }
        } else if (e.key === 'Escape') {
          if (this.selectedEdge || this.selectedNode) {
            this.selectedEdge = null;
            this.selectedNode = null;
            document.querySelectorAll('.wf-node').forEach(n => n.classList.remove('selected'));
            this.renderWires();
          } else if (this.isFullscreen) {
            this.toggleFullscreen();
          }
        }
      });

      document.addEventListener('fullscreenchange', () => {
        if (!document.fullscreenElement && this.isFullscreen) {
          const container = document.getElementById('wfCanvasContainer');
          if (container) container.classList.remove('wf-is-fullscreen');
          this.isFullscreen = false;
          const icon = document.getElementById('wfFullscreenIcon');
          if (icon) icon.className = 'fa-solid fa-expand';
          const btn = document.getElementById('wfFullscreenBtn');
          if (btn) btn.title = 'Toggle Fullscreen Canvas';
          setTimeout(() => this.renderCanvas(), 100);
        }
      });
    }
  },

  createDragWire(x1, y1) {
    const svgLayer = document.getElementById('wfSvgLayer');
    if (!svgLayer) return;
    let dragWire = document.getElementById('wfDragWire');
    if (!dragWire) {
      dragWire = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      dragWire.setAttribute('id', 'wfDragWire');
      dragWire.setAttribute('class', 'wf-drag-wire');
      svgLayer.appendChild(dragWire);
    }
    dragWire.setAttribute('d', `M ${x1} ${y1} L ${x1} ${y1}`);
  },

  updateDragWire(x1, y1, x2, y2) {
    const dragWire = document.getElementById('wfDragWire');
    if (!dragWire) return;
    const dx = Math.max(40, Math.abs(x2 - x1) * 0.5);
    const d = `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;
    dragWire.setAttribute('d', d);
  },

  removeDragWire() {
    const dragWire = document.getElementById('wfDragWire');
    if (dragWire) dragWire.remove();
  },

  zoomIn() {
    this.scale = Math.min(2.2, this.scale + 0.15);
    this.renderCanvas();
  },

  zoomOut() {
    this.scale = Math.max(0.4, this.scale - 0.15);
    this.renderCanvas();
  },

  resetView() {
    this.scale = 1.0;
    this.pan = { x: 40, y: 40 };
    this.renderCanvas();
  },

  // ================= UNDO / REDO HISTORY ENGINE =================
  saveState() {
    if (!this.current) return;
    try {
      const snapshot = JSON.stringify({
        nodes: this.current.nodes,
        edges: this.current.edges,
        settings: this.current.settings
      });
      if (this.undoStack.length > 0 && this.undoStack[this.undoStack.length - 1] === snapshot) {
        return;
      }
      this.undoStack.push(snapshot);
      if (this.undoStack.length > this.maxUndoHistory) this.undoStack.shift();
      this.redoStack = [];
      this.updateUndoRedoUI();
    } catch (e) {}
  },

  undo() {
    if (!this.current || this.undoStack.length <= 1) {
      showToast('No more actions to undo', 'info');
      return;
    }
    const currentSnapshot = this.undoStack.pop();
    this.redoStack.push(currentSnapshot);
    const previousSnapshot = this.undoStack[this.undoStack.length - 1];
    if (previousSnapshot) {
      const data = JSON.parse(previousSnapshot);
      this.current.nodes = JSON.parse(JSON.stringify(data.nodes || []));
      this.current.edges = JSON.parse(JSON.stringify(data.edges || []));
      if (data.settings) this.current.settings = JSON.parse(JSON.stringify(data.settings));
      this.renderCanvas();
      showToast('↩ Undone', 'info');
    }
    this.updateUndoRedoUI();
  },

  redo() {
    if (!this.current || this.redoStack.length === 0) {
      showToast('No actions to redo', 'info');
      return;
    }
    const nextSnapshot = this.redoStack.pop();
    this.undoStack.push(nextSnapshot);
    const data = JSON.parse(nextSnapshot);
    this.current.nodes = JSON.parse(JSON.stringify(data.nodes || []));
    this.current.edges = JSON.parse(JSON.stringify(data.edges || []));
    if (data.settings) this.current.settings = JSON.parse(JSON.stringify(data.settings));
    this.renderCanvas();
    this.updateUndoRedoUI();
    showToast('↪ Redone', 'info');
  },

  updateUndoRedoUI() {
    const undoBtn = document.getElementById('wfUndoBtn');
    const redoBtn = document.getElementById('wfRedoBtn');
    if (undoBtn) {
      const canUndo = this.undoStack.length > 1;
      undoBtn.classList.toggle('disabled', !canUndo);
      undoBtn.disabled = !canUndo;
    }
    if (redoBtn) {
      const canRedo = this.redoStack.length > 0;
      redoBtn.classList.toggle('disabled', !canRedo);
      redoBtn.disabled = !canRedo;
    }
  },

  // ================= FULLSCREEN CANVAS MODE =================
  toggleFullscreen() {
    const container = document.getElementById('wfCanvasContainer');
    if (!container) return;

    this.isFullscreen = !this.isFullscreen;
    container.classList.toggle('wf-is-fullscreen', this.isFullscreen);

    const icon = document.getElementById('wfFullscreenIcon');
    const btn = document.getElementById('wfFullscreenBtn');
    if (icon) {
      icon.className = this.isFullscreen ? 'fa-solid fa-compress' : 'fa-solid fa-expand';
    }
    if (btn) {
      btn.title = this.isFullscreen ? 'Exit Fullscreen (Esc)' : 'Toggle Fullscreen Canvas';
    }

    const title = document.getElementById('wfFullscreenTitle');
    if (title && this.current) {
      title.textContent = `${this.current.name || 'Visual Workflow'}`;
    }

    try {
      if (this.isFullscreen) {
        if (container.requestFullscreen) {
          container.requestFullscreen().catch(() => {});
        } else if (container.webkitRequestFullscreen) {
          container.webkitRequestFullscreen();
        }
      } else {
        if (document.fullscreenElement && document.exitFullscreen) {
          document.exitFullscreen().catch(() => {});
        } else if (document.webkitFullscreenElement && document.webkitExitFullscreen) {
          document.webkitExitFullscreen();
        }
      }
    } catch (e) {}

    setTimeout(() => this.renderCanvas(), 100);
  },

  // ================= ADD NODE MODAL =================
  openAddNodeModal() {
    const modal = document.getElementById('wfAddNodeModal');
    if (modal) modal.classList.add('active');
  },

  closeAddNodeModal() {
    const modal = document.getElementById('wfAddNodeModal');
    if (modal) modal.classList.remove('active');
  },

  addNode(type) {
    if (!this.current) return;
    this.closeAddNodeModal();

    const id = `node_${Date.now()}`;
    
    // Position intelligently near selected node or center
    let x = 100 + Math.round(Math.random() * 200);
    let y = 100 + Math.round(Math.random() * 150);

    if (this.selectedNode) {
      x = this.selectedNode.x + 290;
      y = this.selectedNode.y;
    }

    const nodeTemplates = {
      whatsapp_trigger: {
        id, type, label: 'When WhatsApp Message Received', x, y,
        data: { title: 'When Chat Message Received', event: 'message_received' }
      },
      keyword_filter: {
        id, type, label: 'Keyword Filter', x, y,
        data: { title: 'Keyword Filter', condition: 'contains', keyword: 'order' }
      },
      ai_agent: {
        id, type, label: 'AI Agent (LLM)', x, y,
        data: {
          title: 'AI Support Agent',
          model: 'gpt-4o-mini',
          promptTemplate: 'Answer user query: {{text}}',
          systemPrompt: 'You are an intelligent, helpful WhatsApp AI assistant.',
          temperature: 0.7
        }
      },
      document_context: {
        id, type, label: 'Knowledge Context', x, y,
        data: {
          title: 'Knowledge Base',
          contextText: 'Business Information:\nSupport: 24/7\nWebsite: https://whatsflow.ashiik.com'
        }
      },
      http_request: {
        id, type, label: 'HTTP Webhook Relay', x, y,
        data: { title: 'HTTP Webhook Relay', url: 'https://webhook.site/demo', method: 'POST' }
      },
      send_message: {
        id, type, label: 'Send WhatsApp Message', x, y,
        data: { title: 'Send Reply', messageTemplate: '{{ai_reply}}' }
      }
    };

    const newNode = nodeTemplates[type] || { id, type, label: 'Custom Node', x, y, data: {} };
    this.current.nodes.push(newNode);

    this.selectedNode = newNode;
    this.saveState();
    this.renderCanvas();
    showToast(`✓ Added ${this.getNodeBadge(type)} Node!`, 'success');
  },

  // ================= CONFIGURE NODE MODAL =================
  openNodeConfig(nodeId, e) {
    if (e) e.stopPropagation();
    const node = this.current.nodes.find(n => n.id === nodeId);
    if (!node) return;

    this.editingNode = node;
    const titleEl = document.getElementById('wfConfigTitle');
    const fieldsEl = document.getElementById('wfConfigFields');
    if (!titleEl || !fieldsEl) return;

    const icons = {
      whatsapp_trigger: 'fa-bolt text-amber',
      keyword_filter: 'fa-filter text-blue',
      ai_agent: 'fa-robot text-purple',
      document_context: 'fa-book-open text-emerald',
      http_request: 'fa-network-wired text-cyan',
      send_message: 'fa-paper-plane text-emerald'
    };
    const iconClass = icons[node.type] || 'fa-cube';

    titleEl.innerHTML = `
      <div style="display:flex; align-items:center; gap:10px;">
        <div class="wf-node-icon-box" style="width:28px; height:28px; font-size:12px;"><i class="fa-solid ${iconClass}"></i></div>
        <div>
          <div style="font-size:14px; font-weight:700; color:var(--text-primary); line-height:1.2;">Configure ${escapeHtml(node.data?.title || node.label || 'Node')}</div>
          <div style="font-size:10px; font-weight:700; color:var(--text-secondary); letter-spacing:0.5px;">${this.getNodeBadge(node.type)}</div>
        </div>
      </div>
    `;

    let fieldsHtml = `
      <div class="wf-cfg-container">
        
        <div class="wf-cfg-group">
          <label class="wf-cfg-label"><i class="fa-solid fa-tag"></i> Node Name / Label</label>
          <input type="text" class="wf-cfg-input" id="cfgTitle" value="${escapeHtml(node.data?.title || node.label || '')}" placeholder="e.g. ${this.getNodeBadge(node.type)}">
        </div>
    `;

    if (node.type === 'whatsapp_trigger') {
      fieldsHtml += `
        <div class="wf-cfg-group">
          <label class="wf-cfg-label"><i class="fa-solid fa-bell"></i> Trigger Event</label>
          <select class="wf-cfg-select" id="cfgEvent">
            <option value="message_received">When Customer Sends WhatsApp Message (All Messages)</option>
          </select>
        </div>
        <div class="wf-cfg-info-box">
          <i class="fa-solid fa-circle-info" style="font-size:14px; margin-top:2px;"></i>
          <div>
            <strong>Trigger Output Variables:</strong>
            <div style="margin-top:4px;">Available in downstream nodes:</div>
            <div class="wf-cfg-var-chips" style="margin-top:6px;">
              <span class="wf-var-chip">{{text}}</span>
              <span class="wf-var-chip">{{name}}</span>
              <span class="wf-var-chip">{{from}}</span>
            </div>
          </div>
        </div>
      `;
    } else if (node.type === 'keyword_filter') {
      fieldsHtml += `
        <div class="wf-cfg-group">
          <label class="wf-cfg-label"><i class="fa-solid fa-sliders"></i> Filter Condition</label>
          <select class="wf-cfg-select" id="cfgCondition">
            <option value="contains" ${node.data?.condition === 'contains' ? 'selected' : ''}>Contains Keyword</option>
            <option value="exact" ${node.data?.condition === 'exact' ? 'selected' : ''}>Exact Match</option>
            <option value="starts_with" ${node.data?.condition === 'starts_with' ? 'selected' : ''}>Starts With Prefix</option>
            <option value="regex" ${node.data?.condition === 'regex' ? 'selected' : ''}>Regular Expression (Regex)</option>
          </select>
        </div>
        <div class="wf-cfg-group">
          <label class="wf-cfg-label"><i class="fa-solid fa-key"></i> Keyword / Pattern</label>
          <input type="text" class="wf-cfg-input" id="cfgKeyword" value="${escapeHtml(node.data?.keyword || '')}" placeholder="e.g. order, menu, price, support">
        </div>
      `;
    } else if (node.type === 'ai_agent') {
      fieldsHtml += `
        <div class="wf-cfg-group">
          <label class="wf-cfg-label"><i class="fa-solid fa-brain"></i> Groq AI Model</label>
          <select class="wf-cfg-select" id="cfgModel">
            <option value="openai/gpt-oss-120b" ${(!node.data?.model || node.data?.model === 'openai/gpt-oss-120b') ? 'selected' : ''}>openai/gpt-oss-120b (Groq - Default)</option>
            <option value="llama-3.3-70b-versatile" ${node.data?.model === 'llama-3.3-70b-versatile' ? 'selected' : ''}>llama-3.3-70b-versatile (Groq)</option>
            <option value="llama-3.1-8b-instant" ${node.data?.model === 'llama-3.1-8b-instant' ? 'selected' : ''}>llama-3.1-8b-instant (Groq)</option>
            <option value="llama-3.2-1b-preview" ${node.data?.model === 'llama-3.2-1b-preview' ? 'selected' : ''}>llama-3.2-1b-preview (Groq)</option>
            <option value="llama-3.2-3b-preview" ${node.data?.model === 'llama-3.2-3b-preview' ? 'selected' : ''}>llama-3.2-3b-preview (Groq)</option>
            <option value="llama3-70b-8192" ${node.data?.model === 'llama3-70b-8192' ? 'selected' : ''}>llama3-70b-8192 (Groq)</option>
            <option value="llama3-8b-8192" ${node.data?.model === 'llama3-8b-8192' ? 'selected' : ''}>llama3-8b-8192 (Groq)</option>
            <option value="mixtral-8x7b-32768" ${node.data?.model === 'mixtral-8x7b-32768' ? 'selected' : ''}>mixtral-8x7b-32768 (Groq)</option>
            <option value="gemma2-9b-it" ${node.data?.model === 'gemma2-9b-it' ? 'selected' : ''}>gemma2-9b-it (Groq)</option>
            <option value="llama-guard-3-8b" ${node.data?.model === 'llama-guard-3-8b' ? 'selected' : ''}>llama-guard-3-8b (Groq)</option>
          </select>
        </div>
        <div class="wf-cfg-group">
          <label class="wf-cfg-label"><i class="fa-solid fa-user-astronaut"></i> System Instructions (Agent Persona)</label>
          <textarea class="wf-cfg-textarea" id="cfgSystemPrompt" rows="3" placeholder="You are an intelligent, friendly customer service agent for WhatsFlow. Answer clearly and concisely...">${escapeHtml(node.data?.systemPrompt || '')}</textarea>
        </div>
        <div class="wf-cfg-group">
          <label class="wf-cfg-label"><i class="fa-solid fa-comment-dots"></i> User Prompt Template</label>
          <textarea class="wf-cfg-textarea" id="cfgPromptTemplate" rows="3" placeholder="Answer customer: {{text}}">${escapeHtml(node.data?.promptTemplate || '{{text}}')}</textarea>
          <div style="font-size:11px; color:var(--text-secondary); margin-top:2px;">Click variable to insert:</div>
          <div class="wf-cfg-var-chips">
            <span class="wf-var-chip" onclick="Workflows.insertVariable('cfgPromptTemplate', '{{text}}')">{{text}}</span>
            <span class="wf-var-chip" onclick="Workflows.insertVariable('cfgPromptTemplate', '{{context}}')">{{context}}</span>
            <span class="wf-var-chip" onclick="Workflows.insertVariable('cfgPromptTemplate', '{{name}}')">{{name}}</span>
            <span class="wf-var-chip" onclick="Workflows.insertVariable('cfgPromptTemplate', '{{from}}')">{{from}}</span>
          </div>
        </div>
      `;
    } else if (node.type === 'document_context') {
      fieldsHtml += `
        <div class="wf-cfg-group">
          <label class="wf-cfg-label"><i class="fa-solid fa-book-open"></i> Knowledge Base & FAQ Text (Injected into AI Prompt)</label>
          <textarea class="wf-cfg-textarea" id="cfgContextText" rows="6" placeholder="Paste your FAQ, operating hours, prices, or product catalog here...">${escapeHtml(node.data?.contextText || '')}</textarea>
        </div>
        <div class="wf-cfg-info-box">
          <i class="fa-solid fa-lightbulb" style="font-size:14px; margin-top:2px;"></i>
          <div>Connect this node's green output port to an <strong>AI Agent</strong> node's green context port to automatically provide factual answers!</div>
        </div>
      `;
    } else if (node.type === 'http_request') {
      fieldsHtml += `
        <div style="display:flex; gap:12px;">
          <div class="wf-cfg-group" style="width:120px;">
            <label class="wf-cfg-label"><i class="fa-solid fa-code"></i> Method</label>
            <select class="wf-cfg-select" id="cfgMethod">
              <option value="POST" ${node.data?.method === 'POST' ? 'selected' : ''}>POST</option>
              <option value="GET" ${node.data?.method === 'GET' ? 'selected' : ''}>GET</option>
              <option value="PUT" ${node.data?.method === 'PUT' ? 'selected' : ''}>PUT</option>
              <option value="DELETE" ${node.data?.method === 'DELETE' ? 'selected' : ''}>DELETE</option>
            </select>
          </div>
          <div class="wf-cfg-group" style="flex:1;">
            <label class="wf-cfg-label"><i class="fa-solid fa-link"></i> Webhook URL</label>
            <input type="url" class="wf-cfg-input" id="cfgUrl" value="${escapeHtml(node.data?.url || '')}" placeholder="https://api.yourdomain.com/lead_webhook">
          </div>
        </div>
      `;
    } else if (node.type === 'send_message') {
      fieldsHtml += `
        <div class="wf-cfg-group">
          <label class="wf-cfg-label"><i class="fa-solid fa-paper-plane"></i> Final WhatsApp Message Template</label>
          <textarea class="wf-cfg-textarea" id="cfgMessageTemplate" rows="4" placeholder="Hello {{name}}, your reply is: {{ai_reply}}">${escapeHtml(node.data?.messageTemplate || '{{ai_reply}}')}</textarea>
          <div style="font-size:11px; color:var(--text-secondary); margin-top:2px;">Click variable to insert:</div>
          <div class="wf-cfg-var-chips">
            <span class="wf-var-chip" onclick="Workflows.insertVariable('cfgMessageTemplate', '{{ai_reply}}')">{{ai_reply}}</span>
            <span class="wf-var-chip" onclick="Workflows.insertVariable('cfgMessageTemplate', '{{text}}')">{{text}}</span>
            <span class="wf-var-chip" onclick="Workflows.insertVariable('cfgMessageTemplate', '{{name}}')">{{name}}</span>
          </div>
        </div>
      `;
    }

    fieldsHtml += `
        <div style="display:flex; justify-content:space-between; align-items:center; gap:12px; margin-top:8px; padding-top:14px; border-top:1px solid var(--border-subtle);">
          <button type="button" class="btn btn-secondary btn-sm danger" onclick="Workflows.deleteNode('${node.id}')">
            <i class="fa-solid fa-trash"></i> Delete Node
          </button>
          <button type="button" class="btn btn-primary btn-sm" onclick="Workflows.saveNodeConfig()">
            <i class="fa-solid fa-check"></i> Apply Changes
          </button>
        </div>
      </div>
    `;

    fieldsEl.innerHTML = fieldsHtml;
    const modal = document.getElementById('wfConfigModal');
    if (modal) modal.classList.add('active');
  },

  insertVariable(elementId, varText) {
    const el = document.getElementById(elementId);
    if (!el) return;
    const start = el.selectionStart || el.value.length;
    const end = el.selectionEnd || el.value.length;
    el.value = el.value.substring(0, start) + varText + el.value.substring(end);
    el.focus();
    el.selectionStart = el.selectionEnd = start + varText.length;
  },

  closeNodeConfig() {
    const modal = document.getElementById('wfConfigModal');
    if (modal) modal.classList.remove('active');
    this.editingNode = null;
  },

  saveNodeConfig() {
    if (!this.editingNode) return;
    const node = this.editingNode;
    if (!node.data) node.data = {};

    const titleInput = document.getElementById('cfgTitle');
    if (titleInput && titleInput.value.trim()) {
      node.data.title = titleInput.value.trim();
      node.label = node.data.title;
    }

    if (node.type === 'keyword_filter') {
      node.data.condition = document.getElementById('cfgCondition')?.value || 'contains';
      node.data.keyword = document.getElementById('cfgKeyword')?.value || '';
    } else if (node.type === 'ai_agent') {
      node.data.model = document.getElementById('cfgModel')?.value || 'openai/gpt-oss-120b';
      node.data.systemPrompt = document.getElementById('cfgSystemPrompt')?.value || '';
      node.data.promptTemplate = document.getElementById('cfgPromptTemplate')?.value || '{{text}}';
    } else if (node.type === 'document_context') {
      node.data.contextText = document.getElementById('cfgContextText')?.value || '';
    } else if (node.type === 'http_request') {
      node.data.method = document.getElementById('cfgMethod')?.value || 'POST';
      node.data.url = document.getElementById('cfgUrl')?.value || '';
    } else if (node.type === 'send_message') {
      node.data.messageTemplate = document.getElementById('cfgMessageTemplate')?.value || '{{ai_reply}}';
    }

    this.closeNodeConfig();
    this.saveState();
    this.renderCanvas();
    showToast('✓ Node updated!', 'success');
  },

  deleteNode(nodeId) {
    if (!this.current) return;
    this.current.nodes = this.current.nodes.filter(n => n.id !== nodeId);
    this.current.edges = this.current.edges.filter(e => e.source !== nodeId && e.target !== nodeId);
    if (this.selectedNode?.id === nodeId) this.selectedNode = null;
    this.closeNodeConfig();
    this.saveState();
    this.renderCanvas();
    showToast('Node removed.', 'info');
  },

  // ================= LIVE SIMULATOR & TEST DRAWER =================
  openTestDrawer() {
    const drawer = document.getElementById('wfTestDrawer');
    if (drawer) drawer.classList.add('active');
  },

  closeTestDrawer() {
    const drawer = document.getElementById('wfTestDrawer');
    if (drawer) drawer.classList.remove('active');
  },

  clearTestChat() {
    this.chatHistory = [];
    const chatContainer = document.getElementById('wfTestChatMessages');
    const logsContainer = document.getElementById('wfTestLogs');
    if (chatContainer) {
      chatContainer.innerHTML = `
        <div class="wf-chat-empty">
          <i class="fa-solid fa-comments"></i>
          <p>Send a message below to test your workflow logic live.</p>
        </div>
      `;
    }
    if (logsContainer) {
      logsContainer.innerHTML = `<div class="wf-log-empty">No executions recorded yet. Send a test message to run the graph.</div>`;
    }
  },

  async sendTestMessage() {
    const input = document.getElementById('wfTestInput');
    if (!input || !input.value.trim() || !this.current) return;

    const text = input.value.trim();
    input.value = '';

    const chatContainer = document.getElementById('wfTestChatMessages');
    const logsContainer = document.getElementById('wfTestLogs');

    // Remove empty state
    const emptyState = chatContainer.querySelector('.wf-chat-empty');
    if (emptyState) emptyState.remove();

    // Render User Message
    const userMsgEl = document.createElement('div');
    userMsgEl.className = 'wf-chat-bubble wf-chat-user';
    userMsgEl.innerHTML = `
      <div>${escapeHtml(text)}</div>
      <div class="wf-chat-time">${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
    `;
    chatContainer.appendChild(userMsgEl);
    chatContainer.scrollTop = chatContainer.scrollHeight;

    if (logsContainer) {
      logsContainer.innerHTML = `<div class="wf-log-loading"><i class="fa-solid fa-spinner fa-spin"></i> Executing workflow nodes...</div>`;
    }

    try {
      const res = await window.authFetch(`/api/v1/workflows/${this.current.id || 'draft'}/test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nodes: this.current.nodes,
          edges: this.current.edges,
          settings: this.current.settings,
          text: text,
          from: '+8801700000000',
          name: 'Ashik (Test User)'
        })
      });

      const json = await res.json();
      if (json.success && json.data) {
        const reply = json.data.finalReply || '_(No response generated)_';
        const trace = json.data.executionTrace || [];

        // Render Bot Reply
        const botMsgEl = document.createElement('div');
        botMsgEl.className = 'wf-chat-bubble wf-chat-bot';
        botMsgEl.innerHTML = `
          <div>${escapeHtml(reply)}</div>
          <div class="wf-chat-time">${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
        `;
        chatContainer.appendChild(botMsgEl);
        chatContainer.scrollTop = chatContainer.scrollHeight;

        // Render Execution Trace Logs
        this.renderExecutionTrace(trace, json.data.durationMs);
      } else {
        if (logsContainer) {
          logsContainer.innerHTML = `<div class="wf-log-error"><i class="fa-solid fa-triangle-exclamation"></i> Error: ${escapeHtml(json.error || 'Execution failed')}</div>`;
        }
      }
    } catch (err) {
      if (logsContainer) {
        logsContainer.innerHTML = `<div class="wf-log-error"><i class="fa-solid fa-triangle-exclamation"></i> Test Error: ${escapeHtml(err.message)}</div>`;
      }
    }
  },

  renderExecutionTrace(trace, totalMs) {
    const logsContainer = document.getElementById('wfTestLogs');
    if (!logsContainer) return;

    let html = `
      <div class="wf-log-summary">
        <span><strong>Execution Status:</strong> Completed</span>
        <span class="wf-log-pill">${totalMs || 0}ms total</span>
      </div>
      <div class="wf-trace-list">
    `;

    trace.forEach((step, idx) => {
      const isSuccess = step.status === 'success';
      html += `
        <div class="wf-trace-item ${isSuccess ? 'trace-success' : 'trace-error'}">
          <div class="wf-trace-header">
            <div class="wf-trace-title">
              <i class="fa-solid ${isSuccess ? 'fa-circle-check text-emerald' : 'fa-circle-xmark text-amber'}"></i>
              <span>Step ${idx + 1}: ${escapeHtml(step.label)}</span>
            </div>
            <span class="wf-trace-badge">${step.durationMs}ms</span>
          </div>
          <pre class="wf-trace-code">${escapeHtml(JSON.stringify(step.output, null, 2))}</pre>
        </div>
      `;
    });

    html += `</div>`;
    logsContainer.innerHTML = html;
  }
};

window.Workflows = Workflows;
