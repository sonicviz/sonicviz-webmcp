function setWebMCPStatus(message) {
  $("mcpStatus").textContent = message;
}

function allWebMCPTools() {
  return [
    ...fretboardWebMCPTools(),
    ...workspaceWebMCPTools(),
    ...harmonicaWebMCPTools(),
    ...practiceWebMCPTools()
  ];
}

async function registerWebMCPTools() {
  const api = document.modelContext;
  if (!api?.registerTool) {
    setWebMCPStatus("This browser has no WebMCP API yet. The normal app remains fully usable; agent tools will register automatically in a supported browser.");
    return;
  }

  const tools = allWebMCPTools();
  try {
    for (const tool of tools) await api.registerTool(tool);
    setWebMCPStatus(`${tools.length} WebMCP tools ready across the workspace.`);
  } catch (error) {
    setWebMCPStatus(`WebMCP tool registration failed: ${error.message}`);
  }
}

registerWebMCPTools();