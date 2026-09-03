const FRETBOARD_DEFAULTS = {
  chordRoot: 0,
  scaleRoot: 0,
  tuning: Object.keys(TUNINGS)[0],
  chord: "Major",
  scale: "Major / Ionian",
  mode: "none",
  showIntervals: false
};

const fretboardState = FretwiseSession.registerSlice("fretboard", {
  ...FRETBOARD_DEFAULTS,
  selected: new Set()
});

function activeFretboardSets() {
  return {
    chord: new Set(CHORDS[fretboardState.chord].map(interval => mod(interval + fretboardState.chordRoot))),
    scale: new Set(SCALES[fretboardState.scale].map(interval => mod(interval + fretboardState.scaleRoot)))
  };
}

function guitarOpenMidis() {
  let previousMidi = 35;
  return TUNINGS[fretboardState.tuning].map(pitch => {
    let midi = 36 + mod(pitch);
    while (midi <= previousMidi) midi += 12;
    previousMidi = midi;
    return midi;
  });
}

function updateFretboard(change, source = "ui") {
  FretwiseSession.update("fretboard", change, { source });
  syncFretboard();
  renderFretboard();
}

function resetFretboardState(state) {
  Object.assign(state, {
    chordRoot: FRETBOARD_DEFAULTS.chordRoot,
    scaleRoot: FRETBOARD_DEFAULTS.scaleRoot,
    chord: FRETBOARD_DEFAULTS.chord,
    scale: FRETBOARD_DEFAULTS.scale,
    mode: FRETBOARD_DEFAULTS.mode,
    showIntervals: FRETBOARD_DEFAULTS.showIntervals,
    selected: new Set()
  });
}

function toggleFretboardLayer(layer) {
  updateFretboard(state => {
    const chordVisible = state.mode === "chord" || state.mode === "both";
    const scaleVisible = state.mode === "scale" || state.mode === "both";
    const nextChordVisible = layer === "chord" ? !chordVisible : chordVisible;
    const nextScaleVisible = layer === "scale" ? !scaleVisible : scaleVisible;
    state.mode = nextChordVisible && nextScaleVisible ? "both" : nextChordVisible ? "chord" : nextScaleVisible ? "scale" : "none";
  });
}

function renderFretboard() {
  const { chord, scale } = activeFretboardSets();
  const starts = guitarOpenMidis().reverse();
  const board = $("fretboard");
  const chordVisible = fretboardState.mode === "chord" || fretboardState.mode === "both";
  board.innerHTML = "";
  renderQuickChords("fretQuickChords", fretboardState.scaleRoot, fretboardState.scale, fretboardState.chordRoot, fretboardState.chord, chordVisible, triad => {
    updateFretboard(state => {
      const scaleVisible = state.mode === "scale" || state.mode === "both";
      state.chordRoot = triad.root;
      state.chord = triad.chord;
      state.mode = scaleVisible ? "both" : "chord";
    });
  });
  $("fretChordTones").innerHTML = theoryToneSummary(fretboardState.chordRoot, CHORDS[fretboardState.chord]);
  $("fretScaleTones").innerHTML = theoryToneSummary(fretboardState.scaleRoot, SCALES[fretboardState.scale]);
  $("fretIntervalLegend").innerHTML = intervalLegendMarkup();
  $("fretMarkers").innerHTML = `<span></span>${Array.from({ length: 13 }, (_, fret) =>
    `<span class="${[3, 5, 7, 9, 12].includes(fret) ? "key-marker" : ""}">${fret}</span>`
  ).join("")}`;

  starts.forEach((open, stringIndex) => {
    const stringNumber = stringIndex + 1;
    const label = document.createElement("div");
    label.className = "cell string-label";
    label.textContent = `${stringNumber} · ${note(open)}`;
    board.append(label);

    for (let fret = 0; fret <= 12; fret++) {
      const pitch = mod(open + fret);
      const wrapper = document.createElement("div");
      const button = document.createElement("button");
      const showChord = (fretboardState.mode === "chord" || fretboardState.mode === "both") && chord.has(pitch);
      const showScale = (fretboardState.mode === "scale" || fretboardState.mode === "both") && scale.has(pitch);
      const isTheory = showChord || showScale;
      const chordInterval = mod(pitch - fretboardState.chordRoot);
      const scaleInterval = mod(pitch - fretboardState.scaleRoot);

      button.className = `note ${isTheory ? "theory" : "neutral"}`;
      button.textContent = note(pitch);
      button.title = `String ${stringNumber}, fret ${fret}: ${note(pitch)} (chord ${intervalName(chordInterval)}, scale ${intervalName(scaleInterval)})`;
      if (showChord) button.style.setProperty("--chord-interval-color", `var(--interval-${chordInterval})`);
      if (showScale) button.style.setProperty("--scale-interval-color", `var(--interval-${scaleInterval})`);

      if (fretboardState.showIntervals && isTheory) {
        button.classList.add("show-intervals");
        const labels = [`<span>${note(pitch)}</span>`];
        const activeIntervals = [];
        if (showChord) activeIntervals.push(intervalName(chordInterval));
        if (showScale && (!showChord || scaleInterval !== chordInterval)) activeIntervals.push(intervalName(scaleInterval));
        labels.push(`<small>${activeIntervals.join(" / ")}</small>`);
        button.innerHTML = `<span class="note-stack">${labels.join("")}</span>`;
      }

      if (showChord && showScale) button.classList.add("both");
      else if (showChord) button.classList.add("chord");
      else if (showScale) button.classList.add("scale");

      if (pitch === fretboardState.chordRoot && pitch === fretboardState.scaleRoot && isTheory) button.classList.add("both-root");
      else if (pitch === fretboardState.chordRoot && showChord) button.classList.add("chord-root");
      else if (pitch === fretboardState.scaleRoot && showScale) button.classList.add("scale-root");

      const selectionKey = `${stringIndex}:${fret}`;
      if (fretboardState.selected.has(selectionKey)) button.classList.add("selected");
      button.onclick = () => {
        FretwiseAudio.playGuitar(open + fret);
        updateFretboard(state => {
          if (state.selected.has(selectionKey)) state.selected.delete(selectionKey);
          else state.selected.add(selectionKey);
        });
      };
      wrapper.className = "cell";
      if ([3, 5, 7, 9].includes(fret) && stringNumber === 3) wrapper.classList.add("fret-inlay");
      if (fret === 12 && [2, 4].includes(stringNumber)) wrapper.classList.add("fret-inlay", "double-inlay");
      wrapper.append(button);
      board.append(wrapper);
    }
  });

  const chordNames = [...chord].map(note).join(" · ");
  const scaleNames = [...scale].map(note).join(" · ");
  const chordRoot = note(fretboardState.chordRoot);
  const scaleRoot = note(fretboardState.scaleRoot);
  const overlap = [...chord].filter(pitch => scale.has(pitch)).map(note);
  const contained = [...chord].every(pitch => scale.has(pitch));
  $("title").textContent = `${chordRoot} ${fretboardState.chord} · ${scaleRoot} ${fretboardState.scale}`;
  $("notes").textContent = fretboardState.mode === "chord" ? chordNames : fretboardState.mode === "scale" ? scaleNames : `Chord: ${chordNames}  |  Scale: ${scaleNames}`;
  $("detail").textContent = contained ? "Every chord tone belongs to the selected scale." : `Shared tones: ${overlap.join(" · ") || "none"}. Shape identifies membership; split fills show chord / scale intervals.`;
  $("relationship").textContent = contained ? `${chordRoot} ${fretboardState.chord} fits completely inside ${scaleRoot} ${fretboardState.scale}. Compare each shared note's chord and scale intervals while changing voicings.` : `${chordRoot} ${fretboardState.chord} over ${scaleRoot} ${fretboardState.scale} has ${overlap.length} shared tone${overlap.length === 1 ? "" : "s"}—a useful tension-and-resolution palette.`;
}

function syncFretboard() {
  for (const key of ["chordRoot", "scaleRoot", "tuning", "chord", "scale"]) $(key).value = fretboardState[key];
  const chordVisible = fretboardState.mode === "chord" || fretboardState.mode === "both";
  const scaleVisible = fretboardState.mode === "scale" || fretboardState.mode === "both";
  for (const [id, pressed] of [["showChord", chordVisible], ["showScale", scaleVisible], ["showIntervals", fretboardState.showIntervals]]) {
    $(id).classList.toggle("active", pressed);
    $(id).setAttribute("aria-pressed", String(pressed));
  }
}

function fretboardContext() {
  return musicTheoryContext();
}

function musicTheoryContext() {
  const { chord, scale } = activeFretboardSets();
  const shared = [...chord].filter(pitch => scale.has(pitch));
  return {
    tuning: fretboardState.tuning,
    chordRoot: note(fretboardState.chordRoot),
    scaleRoot: note(fretboardState.scaleRoot),
    chord: fretboardState.chord,
    scale: fretboardState.scale,
    chordTones: [...chord].map(note),
    scaleTones: [...scale].map(note),
    sharedTones: shared.map(note),
    chordIsContainedInScale: [...chord].every(pitch => scale.has(pitch)),
    mode: fretboardState.mode,
    showIntervals: fretboardState.showIntervals
  };
}

function fretboardWebMCPTools() {
  return [
    {
      name: "set_fretboard_context",
      title: "Set fretboard context",
      description: "Use this when Fretboard is the active tab or the user explicitly names the standalone Fretboard explorer: configure its tuning, independent chord and scale roots, chord, and scale, or reset its clearable theory state while preserving tuning. Its guitar tuning is independent from Practice; never mirror a Practice tuning here unless the user explicitly asks to change both. This tool does not switch tabs; if the user explicitly asks to switch to Fretboard, call switch_workspace_view first.",
      inputSchema: {
        type: "object",
        properties: {
          reset: { type: "boolean" },
          tuning: { type: "string", enum: Object.keys(TUNINGS) },
          chordRoot: { type: "string", enum: N },
          scaleRoot: { type: "string", enum: N },
          chord: { type: "string", enum: Object.keys(CHORDS) },
          scale: { type: "string", enum: Object.keys(SCALES) }
        },
        additionalProperties: false
      },
      execute: async args => {
        updateFretboard(state => {
          if (args.reset) resetFretboardState(state);
          for (const key of ["tuning", "chord", "scale"]) if (args[key]) state[key] = args[key];
          if (args.chordRoot) state.chordRoot = N.indexOf(args.chordRoot);
          if (args.scaleRoot) state.scaleRoot = N.indexOf(args.scaleRoot);
        }, "webmcp");
        return fretboardContext();
      }
    },
    {
      name: "get_music_theory_context",
      title: "Get music theory context",
      description: "Use this read-only tool to explain the selected guitar chord and scale, their independent roots, tones, and overlap without changing the explorer.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: true },
      execute: async () => musicTheoryContext()
    },
    {
      name: "set_display_mode",
      title: "Set display mode",
      description: "Use this when Fretboard is the active tab or the user explicitly names the standalone Fretboard explorer to show chord tones, scale tones, both, or neither and control interval labels. This tool does not switch tabs; if the user explicitly asks to switch to Fretboard, call switch_workspace_view first.",
      inputSchema: {
        type: "object",
        properties: {
          mode: { type: "string", enum: ["chord", "scale", "both", "none"] },
          showIntervals: { type: "boolean" }
        },
        additionalProperties: false
      },
      execute: async args => {
        updateFretboard(state => {
          if (args.mode) state.mode = args.mode;
          if (typeof args.showIntervals === "boolean") state.showIntervals = args.showIntervals;
        }, "webmcp");
        return fretboardContext();
      }
    },
    {
      name: "inspect_fret_position",
      title: "Inspect fret position",
      description: "Use this to explain one visible guitar position by returning its note, chord interval, scale interval, and membership role.",
      inputSchema: {
        type: "object",
        required: ["string", "fret"],
        properties: {
          string: { type: "integer", minimum: 1, maximum: 6 },
          fret: { type: "integer", minimum: 0, maximum: 12 }
        },
        additionalProperties: false
      },
      annotations: { readOnlyHint: true },
      execute: async ({ string, fret }) => {
        const open = TUNINGS[fretboardState.tuning][6 - string];
        const pitch = mod(open + fret);
        const { chord, scale } = activeFretboardSets();
        const inChord = chord.has(pitch);
        const inScale = scale.has(pitch);
        return {
          string,
          fret,
          note: note(pitch),
          chordInterval: intervalName(pitch - fretboardState.chordRoot),
          scaleInterval: intervalName(pitch - fretboardState.scaleRoot),
          role: inChord && inScale ? "shared" : inChord ? "chord-only" : inScale ? "scale-only" : "neither"
        };
      }
    }
  ];
}

function setupFretboard() {
  fill("tuning", TUNINGS);
  fill("chord", CHORDS);
  fill("scale", SCALES);
  for (const id of ["chordRoot", "scaleRoot"]) {
    $(id).innerHTML = N.map((name, index) => `<option value="${index}">${name}</option>`).join("");
  }

  $("showChord").onclick = () => toggleFretboardLayer("chord");
  $("showScale").onclick = () => toggleFretboardLayer("scale");
  $("showIntervals").onclick = () => updateFretboard({ showIntervals: !fretboardState.showIntervals });
  $("clear").onclick = () => updateFretboard(resetFretboardState);
  $("random").onclick = () => updateFretboard(state => {
    state.chordRoot = Math.floor(Math.random() * 12);
    state.scaleRoot = Math.floor(Math.random() * 12);
    state.chord = Object.keys(CHORDS)[Math.floor(Math.random() * Object.keys(CHORDS).length)];
    state.scale = Object.keys(SCALES)[Math.floor(Math.random() * Object.keys(SCALES).length)];
  });

  for (const key of ["chordRoot", "scaleRoot", "tuning", "chord", "scale"]) {
    $(key).onchange = event => updateFretboard({
      [key]: key.endsWith("Root") ? Number(event.target.value) : event.target.value
    });
  }
  syncFretboard();
  renderFretboard();
}

setupFretboard();