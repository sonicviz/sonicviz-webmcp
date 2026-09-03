const workspaceState = FretwiseSession.registerSlice("workspace", { activeView: null });

function workspaceViews() {
  return [...document.querySelectorAll('.instrument-tabs [role="tab"][data-view]')].map(tab => ({
    id: tab.dataset.view,
    label: tab.textContent.trim(),
    tab,
    panel: document.getElementById(tab.getAttribute("aria-controls"))
  })).filter(view => view.panel);
}

function workspaceViewContext() {
  const views = workspaceViews();
  const active = views.find(view => view.tab.getAttribute("aria-selected") === "true");
  return {
    activeView: active?.id ?? null,
    availableViews: views.map(view => ({ id: view.id, label: view.label }))
  };
}

function setWorkspaceView(viewId, source = "ui", record = true) {
  const views = workspaceViews();
  const target = views.find(view => view.id === viewId);
  if (!target) throw new RangeError(`Unknown workspace view: ${viewId}`);

  views.forEach(view => {
    const isActive = view === target;
    view.panel.hidden = !isActive;
    view.tab.setAttribute("aria-selected", String(isActive));
    view.tab.tabIndex = isActive ? 0 : -1;
  });
  FretwiseSession.update("workspace", { activeView: viewId }, { source, record });
  return workspaceViewContext();
}

function setupWorkspaceViews() {
  const views = workspaceViews();
  views.forEach((view, index) => {
    view.tab.onclick = () => setWorkspaceView(view.id);
    view.tab.onkeydown = event => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      let targetIndex = index;
      if (event.key === "ArrowLeft") targetIndex = (index - 1 + views.length) % views.length;
      if (event.key === "ArrowRight") targetIndex = (index + 1) % views.length;
      if (event.key === "Home") targetIndex = 0;
      if (event.key === "End") targetIndex = views.length - 1;
      setWorkspaceView(views[targetIndex].id);
      views[targetIndex].tab.focus();
    };
  });
  const selected = views.find(view => view.tab.getAttribute("aria-selected") === "true") ?? views[0];
  if (selected) setWorkspaceView(selected.id, "setup", false);
}

function workspaceWebMCPTools() {
  const viewIds = workspaceViews().map(view => view.id);
  return [{
    name: "switch_workspace_view",
    title: "Switch workspace view",
    description: "Use this only when the user explicitly asks to switch, open, show, or go to a specific tab, and call it before tools targeting that tab. It is the only WebMCP tool that changes the active workspace; all domain tools preserve the currently open tab and keep Fretboard, Harmonica, and Practice state independent.",
    inputSchema: {
      type: "object",
      properties: { view: { type: "string", enum: viewIds } },
      required: ["view"],
      additionalProperties: false
    },
    execute: async ({ view }) => setWorkspaceView(view, "webmcp")
  }];
}

setupWorkspaceViews();