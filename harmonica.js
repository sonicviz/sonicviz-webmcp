const HARP_POSITIONS = {
  "1st position": 0,
  "2nd position": 7,
  "3rd position": 2,
  "4th position": 9,
  "5th position": 4
};

const HARP_POSITION_SCALES = {
  "1st position": "Major / Ionian",
  "2nd position": "Mixolydian",
  "3rd position": "Dorian",
  "4th position": "Natural minor / Aeolian",
  "5th position": "Phrygian"
};

const HARP_TUNINGS = {
  "Major Richter": {
    blow: [60, 64, 67, 72, 76, 79, 84, 88, 91, 96],
    draw: [62, 67, 71, 74, 77, 81, 83, 86, 89, 93]
  },
  Country: {
    blow: [60, 64, 67, 72, 76, 79, 84, 88, 91, 96],
    draw: [62, 67, 71, 74, 78, 81, 83, 86, 89, 93]
  },
  "Paddy Richter": {
    blow: [60, 64, 69, 72, 76, 79, 84, 88, 91, 96],
    draw: [62, 67, 71, 74, 77, 81, 83, 86, 89, 93]
  }
};

function harmonicaRows(tuning = harmonicaState.tuning) {
  const { blow, draw } = HARP_TUNINGS[tuning];
  const drawBend = step => draw.map((midi, hole) => midi - step > blow[hole] ? midi - step : null);
  const blowBend = step => blow.map((midi, hole) => {
    const bendCount = Math.floor((midi - draw[hole] + 1) / 2);
    return step <= bendCount ? midi - step : null;
  });
  return [
    { label: "Overblow", kind: "overbend", symbol: "+", suffix: "°", notes: draw.map((midi, hole) => midi > blow[hole] ? midi + 1 : null) },
    { label: "Blow bend 2", kind: "bend", symbol: "+", suffix: "''", notes: blowBend(2) },
    { label: "Blow bend 1", kind: "bend", symbol: "+", suffix: "'", notes: blowBend(1) },
    { label: "Blow", kind: "natural", symbol: "+", suffix: "", notes: blow },
    { label: "Draw", kind: "natural", symbol: "-", suffix: "", notes: draw },
    { label: "Draw bend 1", kind: "bend", symbol: "-", suffix: "'", notes: drawBend(1) },
    { label: "Draw bend 2", kind: "bend", symbol: "-", suffix: "''", notes: drawBend(2) },
    { label: "Draw bend 3", kind: "bend", symbol: "-", suffix: "'''", notes: drawBend(3) },
    { label: "Overdraw", kind: "overbend", symbol: "-", suffix: "°", notes: blow.map((midi, hole) => midi > draw[hole] ? midi + 1 : null) }
  ];
}

const HARMONICA_DEFAULTS = {
  tuning: Object.keys(HARP_TUNINGS)[0],
  key: 0,
  chordRoot: 0,
  scaleRoot: 0,
  position: "1st position",
  scale: "Major / Ionian",
  chord: "Major",
  mode: "none",
  showIntervals: false,
  showOverbends: false
};

const harmonicaState = FretwiseSession.registerSlice("harmonica", {
  ...HARMONICA_DEFAULTS,
  phrase: [],
  playing: null
});

function updateHarmonica(change, source = "ui", record = true) {
  FretwiseSession.update("harmonica", change, { source, record });
  syncHarmonica();
  renderHarmonica();
}

function resetHarmonicaTheoryState(state) {
  Object.assign(state, {
    chordRoot: HARMONICA_DEFAULTS.chordRoot,
    scaleRoot: HARMONICA_DEFAULTS.scaleRoot,
    scale: HARMONICA_DEFAULTS.scale,
    chord: HARMONICA_DEFAULTS.chord,
    mode: HARMONICA_DEFAULTS.mode,
    showIntervals: HARMONICA_DEFAULTS.showIntervals,
    showOverbends: HARMONICA_DEFAULTS.showOverbends
  });
}

function toggleHarmonicaLayer(layer) {
  updateHarmonica(state => {
    const chordVisible = state.mode === "chord" || state.mode === "both";
    const scaleVisible = state.mode === "scale" || state.mode === "both";
    const nextChordVisible = layer === "chord" ? !chordVisible : chordVisible;
    const nextScaleVisible = layer === "scale" ? !scaleVisible : scaleVisible;
    state.mode = nextChordVisible && nextScaleVisible ? "both" : nextChordVisible ? "chord" : nextScaleVisible ? "scale" : "none";
  });
}

function harmonicaMidiName(midi) {
  return `${note(midi)}${Math.floor(midi / 12) - 1}`;
}

function harmonicaSets() {
  return {
    chord: new Set(CHORDS[harmonicaState.chord].map(interval => mod(interval + harmonicaState.chordRoot))),
    scale: new Set(SCALES[harmonicaState.scale].map(interval => mod(interval + harmonicaState.scaleRoot)))
  };
}

function harmonicaTab(row, hole) {
  return `${row.symbol}${hole + 1}${row.suffix}`;
}

function playHarmonicaMidi(midi, duration = 0.48) {
  FretwiseAudio.playHarmonica(midi, { duration });
}

function chooseHarmonicaNote(row, hole, baseMidi) {
  const entry = {
    tab: harmonicaTab(row, hole),
    midi: baseMidi + harmonicaState.key,
    note: harmonicaMidiName(baseMidi + harmonicaState.key)
  };
  FretwiseSession.update("harmonica", state => {
    state.phrase.push(entry);
    state.playing = `${row.label}:${hole}`;
  });
  $("toneSummary").textContent = `${entry.note} · ${entry.tab}`;
  playHarmonicaMidi(entry.midi);
  renderHarmonica();
  setTimeout(() => {
    updateHarmonica({ playing: null }, "audio", false);
  }, 220);
}

function renderHarmonica() {
  const grid = $("harpGrid");
  const { chord, scale } = harmonicaSets();
  const rows = harmonicaRows().filter(row => harmonicaState.showOverbends || row.kind !== "overbend");
  const chordVisible = harmonicaState.mode === "chord" || harmonicaState.mode === "both";
  grid.innerHTML = "";
  renderQuickChords("harpQuickChords", harmonicaState.scaleRoot, harmonicaState.scale, harmonicaState.chordRoot, harmonicaState.chord, chordVisible, triad => {
    updateHarmonica(state => {
      const scaleVisible = state.mode === "scale" || state.mode === "both";
      state.chordRoot = triad.root;
      state.chord = triad.chord;
      state.mode = scaleVisible ? "both" : "chord";
    });
  });
  $("harpScaleTones").innerHTML = theoryToneSummary(harmonicaState.scaleRoot, SCALES[harmonicaState.scale]);
  $("harpChordTones").innerHTML = theoryToneSummary(harmonicaState.chordRoot, CHORDS[harmonicaState.chord]);
  $("intervalLegend").innerHTML = intervalLegendMarkup();

  rows.forEach(row => {
    if (row.label === "Draw") {
      const spacer = document.createElement("div");
      spacer.className = "harp-row-label hole-spacer";
      spacer.textContent = "Hole";
      grid.append(spacer);
      for (let hole = 0; hole < 10; hole++) {
        const holeLabel = document.createElement("div");
        holeLabel.className = "hole-label";
        holeLabel.textContent = hole + 1;
        grid.append(holeLabel);
      }
    }

    const label = document.createElement("div");
    label.className = "harp-row-label";
    label.textContent = row.label;
    grid.append(label);

    row.notes.forEach((baseMidi, hole) => {
      if (baseMidi === null) {
        const empty = document.createElement("span");
        empty.className = "harp-empty";
        grid.append(empty);
        return;
      }

      const midi = baseMidi + harmonicaState.key;
      const pitch = mod(midi);
      const button = document.createElement("button");
      const inChord = (harmonicaState.mode === "chord" || harmonicaState.mode === "both") && chord.has(pitch);
      const inScale = (harmonicaState.mode === "scale" || harmonicaState.mode === "both") && scale.has(pitch);
      const chordInterval = mod(pitch - harmonicaState.chordRoot);
      const scaleInterval = mod(pitch - harmonicaState.scaleRoot);
      button.className = "harp-note";
      if (inChord) button.style.setProperty("--chord-interval-color", `var(--interval-${chordInterval})`);
      if (inScale) button.style.setProperty("--scale-interval-color", `var(--interval-${scaleInterval})`);
      if (inChord && inScale) button.classList.add("both");
      else if (inChord) button.classList.add("chord");
      else if (inScale) button.classList.add("scale");
      if (inChord || inScale) button.classList.add("interval-tone");
      if (pitch === harmonicaState.chordRoot && pitch === harmonicaState.scaleRoot && (inChord || inScale)) button.classList.add("both-root");
      else if (pitch === harmonicaState.chordRoot && inChord) button.classList.add("chord-root");
      else if (pitch === harmonicaState.scaleRoot && inScale) button.classList.add("scale-root");
      if (harmonicaState.playing === `${row.label}:${hole}`) button.classList.add("playing");
      const activeIntervals = [];
      if (inChord) activeIntervals.push(intervalName(chordInterval));
      if (inScale && (!inChord || scaleInterval !== chordInterval)) activeIntervals.push(intervalName(scaleInterval));
      const primaryLabel = harmonicaState.showIntervals && activeIntervals.length ? activeIntervals.join(" / ") : harmonicaMidiName(midi);
      const noteLabel = document.createElement("span");
      const tabLabel = document.createElement("small");
      noteLabel.textContent = primaryLabel;
      tabLabel.textContent = harmonicaTab(row, hole);
      button.append(noteLabel, tabLabel);
      button.title = `${row.label}, hole ${hole + 1}: ${harmonicaMidiName(midi)} · chord ${intervalName(chordInterval)} · scale ${intervalName(scaleInterval)}`;
      button.setAttribute("aria-label", button.title);
      button.onclick = () => chooseHarmonicaNote(row, hole, baseMidi);
      grid.append(button);
    });
  });

  const positionRoot = mod(harmonicaState.key + HARP_POSITIONS[harmonicaState.position]);
  $("harpTitle").textContent = `${note(harmonicaState.key)} ${harmonicaState.tuning} · ${harmonicaState.position}`;
  $("harpSummary").textContent = `${note(harmonicaState.key)} ${harmonicaState.tuning}`;
  $("positionSummary").textContent = `${note(positionRoot)} · Chord ${note(harmonicaState.chordRoot)} ${harmonicaState.chord} · Scale ${note(harmonicaState.scaleRoot)} ${harmonicaState.scale}`;
  $("tabStrip").replaceChildren();
  if (harmonicaState.phrase.length) {
    harmonicaState.phrase.forEach(item => {
      const token = document.createElement("span");
      token.className = "tab-token";
      token.title = item.note;
      token.textContent = item.tab;
      $("tabStrip").append(token);
    });
  } else {
    const placeholder = document.createElement("span");
    placeholder.className = "tab-placeholder";
    placeholder.textContent = "Click notes on the harmonica to begin.";
    $("tabStrip").append(placeholder);
  }
}

function syncHarmonica() {
  $("harpTuning").value = harmonicaState.tuning;
  $("harpKey").value = harmonicaState.key;
  $("harpChordRoot").value = harmonicaState.chordRoot;
  $("harpScaleRoot").value = harmonicaState.scaleRoot;
  $("harpPosition").value = harmonicaState.position;
  $("harpScale").value = harmonicaState.scale;
  $("harpChord").value = harmonicaState.chord;
  const chordVisible = harmonicaState.mode === "chord" || harmonicaState.mode === "both";
  const scaleVisible = harmonicaState.mode === "scale" || harmonicaState.mode === "both";
  for (const [id, pressed] of [
    ["harpShowChord", chordVisible],
    ["harpShowScale", scaleVisible],
    ["harpIntervals", harmonicaState.showIntervals],
    ["harpOverbends", harmonicaState.showOverbends]
  ]) {
    $(id).classList.toggle("active", pressed);
    $(id).setAttribute("aria-pressed", String(pressed));
  }
}

function setupHarmonica() {
  for (const id of ["harpKey", "harpChordRoot", "harpScaleRoot"]) {
    $(id).innerHTML = N.map((name, index) => `<option value="${index}">${name}</option>`).join("");
  }
  fill("harpScale", SCALES);
  fill("harpChord", CHORDS);
  fill("harpTuning", HARP_TUNINGS);
  $("harpPosition").innerHTML = Object.keys(HARP_POSITIONS).map(name => `<option>${name}</option>`).join("");

  $("harpKey").onchange = event => {
    updateHarmonica(state => {
      state.key = Number(event.target.value);
      state.chordRoot = mod(state.key + HARP_POSITIONS[state.position]);
      state.scaleRoot = state.chordRoot;
    });
  };
  $("harpChordRoot").onchange = event => updateHarmonica({ chordRoot: Number(event.target.value) });
  $("harpScaleRoot").onchange = event => updateHarmonica({ scaleRoot: Number(event.target.value) });
  $("harpPosition").onchange = event => {
    updateHarmonica(state => {
      state.position = event.target.value;
      state.chordRoot = mod(state.key + HARP_POSITIONS[state.position]);
      state.scaleRoot = state.chordRoot;
      state.scale = HARP_POSITION_SCALES[state.position];
    });
  };
  $("harpScale").onchange = event => updateHarmonica({ scale: event.target.value });
  $("harpChord").onchange = event => updateHarmonica({ chord: event.target.value });
  $("harpTuning").onchange = event => updateHarmonica({ tuning: event.target.value });
  $("harpIntervals").onclick = () => updateHarmonica({ showIntervals: !harmonicaState.showIntervals });
  $("harpOverbends").onclick = () => updateHarmonica({ showOverbends: !harmonicaState.showOverbends });
  $("harpShowScale").onclick = () => toggleHarmonicaLayer("scale");
  $("harpShowChord").onclick = () => toggleHarmonicaLayer("chord");
  $("harpClearHighlights").onclick = () => updateHarmonica(resetHarmonicaTheoryState);
  $("clearPhrase").onclick = () => updateHarmonica({ phrase: [] });
  $("copyPhrase").onclick = copyHarmonicaPhrase;
  $("playPhrase").onclick = () => harmonicaState.phrase.forEach((item, index) => {
    FretwiseAudio.playHarmonica(item.midi, { duration: 0.38, delay: index * 0.43 });
  });
  syncHarmonica();
  renderHarmonica();
}

async function copyHarmonicaPhrase() {
  const copyButton = $("copyPhrase");
  try {
    await navigator.clipboard.writeText(harmonicaState.phrase.map(item => item.tab).join(" "));
    copyButton.textContent = "Copied";
  } catch {
    copyButton.textContent = "Unavailable";
  }
  setTimeout(() => { copyButton.textContent = "Copy"; }, 900);
}

function harmonicaWebMCPTools() {
  return [
    {
      name: "set_harmonica_context",
      title: "Set harmonica context",
      description: "Use this when Harmonica is the active tab or the user explicitly names the standalone Harmonica workspace to configure its 10-hole diatonic harmonica and chord/scale contexts, or reset its clearable theory state while preserving tuning, Harp key, position, and phrase. Its state is independent from Practice. This tool does not switch tabs; if the user explicitly asks to switch to Harmonica, call switch_workspace_view first.",
      inputSchema: {
        type: "object",
        properties: {
          reset: { type: "boolean" },
          tuning: { type: "string", enum: Object.keys(HARP_TUNINGS) },
          harpKey: { type: "string", enum: N },
          position: { type: "string", enum: Object.keys(HARP_POSITIONS) },
          chordRoot: { type: "string", enum: N },
          scaleRoot: { type: "string", enum: N },
          scale: { type: "string", enum: Object.keys(SCALES) },
          chord: { type: "string", enum: Object.keys(CHORDS) }
        },
        additionalProperties: false
      },
      execute: async args => {
        updateHarmonica(state => {
          if (args.reset) resetHarmonicaTheoryState(state);
          if (args.tuning) state.tuning = args.tuning;
          if (args.harpKey) state.key = N.indexOf(args.harpKey);
          if (args.position) state.position = args.position;
          if (args.harpKey || args.position) {
            state.chordRoot = mod(state.key + HARP_POSITIONS[state.position]);
            state.scaleRoot = state.chordRoot;
          }
          if (args.position) state.scale = HARP_POSITION_SCALES[state.position];
          if (args.chordRoot) state.chordRoot = N.indexOf(args.chordRoot);
          if (args.scaleRoot) state.scaleRoot = N.indexOf(args.scaleRoot);
          if (args.scale) state.scale = args.scale;
          if (args.chord) state.chord = args.chord;
        }, "webmcp");
        return harmonicaContext();
      }
    },
    {
      name: "get_harmonica_context",
      title: "Get harmonica context",
      description: "Use this read-only tool to explain the harmonica setup, complete technique layout, theory overlap, display state, and current tablature phrase.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: true },
      execute: async () => harmonicaContext()
    },
    {
      name: "set_harmonica_display",
      title: "Set harmonica display",
      description: "Use this when Harmonica is the active tab or the user explicitly names the standalone Harmonica workspace to show chord tones, scale tones, both, or neither and toggle interval labels and overbend rows. This tool does not switch tabs; if the user explicitly asks to switch to Harmonica, call switch_workspace_view first.",
      inputSchema: {
        type: "object",
        properties: {
          mode: { type: "string", enum: ["chord", "scale", "both", "none"] },
          showIntervals: { type: "boolean" },
          showOverbends: { type: "boolean" }
        },
        additionalProperties: false
      },
      execute: async args => {
        updateHarmonica(state => {
          if (args.mode) state.mode = args.mode;
          if (typeof args.showIntervals === "boolean") state.showIntervals = args.showIntervals;
          if (typeof args.showOverbends === "boolean") state.showOverbends = args.showOverbends;
        }, "webmcp");
        return harmonicaContext();
      }
    }
  ];
}

function harmonicaContext() {
  const { chord, scale } = harmonicaSets();
  const shared = [...chord].filter(pitch => scale.has(pitch));
  const rows = harmonicaRows();
  return {
    harpKey: note(harmonicaState.key),
    tuning: harmonicaState.tuning,
    position: harmonicaState.position,
    positionKey: note(harmonicaState.key + HARP_POSITIONS[harmonicaState.position]),
    chordRoot: note(harmonicaState.chordRoot),
    scaleRoot: note(harmonicaState.scaleRoot),
    scale: harmonicaState.scale,
    chord: harmonicaState.chord,
    chordTones: [...chord].map(note),
    scaleTones: [...scale].map(note),
    sharedTones: shared.map(note),
    chordIsContainedInScale: [...chord].every(pitch => scale.has(pitch)),
    mode: harmonicaState.mode,
    showIntervals: harmonicaState.showIntervals,
    showOverbends: harmonicaState.showOverbends,
    phrase: harmonicaState.phrase.map(item => item.tab),
    phraseNotes: harmonicaState.phrase.map(({ tab, note: noteName }) => ({ tab, note: noteName })),
    blowNotes: rows.find(row => row.label === "Blow").notes.map(midi => harmonicaMidiName(midi + harmonicaState.key)),
    drawNotes: rows.find(row => row.label === "Draw").notes.map(midi => harmonicaMidiName(midi + harmonicaState.key)),
    layout: rows.map(row => ({
      technique: row.label,
      kind: row.kind,
      holes: row.notes.map((midi, hole) => midi === null ? null : {
        hole: hole + 1,
        tab: harmonicaTab(row, hole),
        note: harmonicaMidiName(midi + harmonicaState.key)
      })
    }))
  };
}

setupHarmonica();
