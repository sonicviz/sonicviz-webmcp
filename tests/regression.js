const fixture = document.querySelector("#fixture");
const results = document.querySelector("#results");
const summary = document.querySelector("#summary");
const tests = [];

function test(name, execute) {
  tests.push({ name, execute });
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertEqual(actual, expected, message) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${message}: expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`);
  }
}

const config = {
  seed: 1234,
  key: "G",
  level: "beginner",
  style: "blues",
  bars: 8,
  tempo: 72,
  harpKey: "C",
  harpTuning: "Major Richter",
  guitarTuning: "Standard (E A D G B E)"
};

fixture.addEventListener("load", async () => {
  const app = fixture.contentWindow;

  test("generation is deterministic", () => {
    const first = app.generatePracticeExercise(config);
    const second = app.generatePracticeExercise(config);
    assertEqual(first, second, "identical inputs must produce identical exercises");
  });

  test("canonical events remain free of derived notation", () => {
    const context = app.installPracticeExercise(config, "test");
    context.exercise.melody.forEach(event => {
      assertEqual(Object.keys(event).sort(), ["beat", "durationBeats", "id", "midi"], `canonical fields for ${event.id}`);
    });
    assert(context.representations.every(item => item.guitar && item.harmonica && item.note), "every event must have both derived instrument representations");
  });

  test("loop range maps inclusive bars to beat boundaries", () => {
    app.installPracticeExercise(config, "test");
    app.setPracticeLoopRange({ startBar: 3, endBar: 5 }, "test");
    assertEqual(app.practiceLoopRange(), { startBar: 3, endBar: 5, startBeat: 8, endBeat: 20 }, "loop range");
  });

  test("enabling a phrase loop moves an outside playhead to its start", () => {
    const context = app.controlPracticeTransport("loop", { enabled: true, source: "test" });
    assertEqual(context.transport.playheadBeat, 8, "loop playhead");
    assertEqual([context.transport.loopStartBar, context.transport.loopEndBar], [3, 5], "returned loop bars");
  });

  test("loop with explicit bounds is an idempotent enable, not a toggle", () => {
    app.installPracticeExercise(config, "test");
    app.setPracticeLoopRange({ startBar: 3, endBar: 5 }, "test");
    const first = app.controlPracticeTransport("loop", { startBar: 3, endBar: 5, source: "test" });
    assertEqual(first.transport.loop, true, "first bounded loop request enables the loop");
    const repeated = app.controlPracticeTransport("loop", { startBar: 3, endBar: 5, source: "test" });
    assertEqual(repeated.transport.loop, true, "repeated bounded loop request keeps the loop enabled");
    assertEqual([repeated.transport.loopStartBar, repeated.transport.loopEndBar], [3, 5], "bounds after repeat");
    const disabled = app.controlPracticeTransport("loop", { startBar: 3, endBar: 5, enabled: false, source: "test" });
    assertEqual(disabled.transport.loop, false, "explicit enabled false disables the loop despite bounds");
    const bare = app.controlPracticeTransport("loop", { source: "test" });
    assertEqual(bare.transport.loop, true, "bare loop call toggles back on");
  });

  test("scheduled projection is bounded without mutating canonical events", () => {
    const before = JSON.stringify(app.practiceExerciseContext().exercise.melody);
    const scheduled = app.practiceScheduledEvents();
    assert(scheduled.length > 0, "selected phrase should contain scheduled events");
    assert(scheduled.every(event => event.beat >= 8 && event.beat < 20), "scheduled events must stay inside bars 3 through 5");
    assertEqual(JSON.stringify(app.practiceExerciseContext().exercise.melody), before, "canonical melody after scheduling");
  });

  test("expressive playback is deterministic and separate from canonical events", () => {
    const [firstEvent, secondEvent] = app.practiceExerciseContext().exercise.melody;
    const profile = (event) => app.eval(`FretwiseAudio.expressionProfile(${JSON.stringify(event)}, ${config.seed})`);
    const first = profile(firstEvent);
    const repeated = profile(firstEvent);
    const second = profile(secondEvent);
    assertEqual(first, repeated, "same event expression profile");
    assert(JSON.stringify(first) !== JSON.stringify(second), "different events should receive different expression profiles");
    assert(first.gain >= 0.94 && first.gain <= 1.1, "expression gain should remain subtle");
    assert(first.attack >= 0.026 && first.attack <= 0.044, "expression attack should remain bounded");
    assert(first.pluckAttack >= 0.003 && first.pluckAttack <= 0.008, "guitar pluck attack should remain crisp and bounded");
    assert(first.stringDamping >= 0.988 && first.stringDamping <= 0.996, "guitar string damping should remain bounded");
    assert(first.stringResonance >= 0.5 && first.stringResonance <= 0.75, "guitar string resonance should remain bounded");
    assert(first.bodyResonance >= 0.9 && first.bodyResonance <= 1.1, "guitar body resonance should remain bounded");
    assert(first.pluckPosition >= 0.18 && first.pluckPosition <= 0.64, "guitar pluck position should remain bounded");
    assert(first.noiseSeed >= 0 && first.noiseSeed <= 1, "guitar excitation seed should remain normalized");
    assertEqual(typeof app.eval("FretwiseAudio.playSynthGuitar"), "function", "physical-string Guitar fallback remains available");
    assertEqual(Object.keys(firstEvent).sort(), ["beat", "durationBeats", "id", "midi"], "canonical event after expression profiling");
  });

  test("practice levels form a distinct technique ladder", () => {
    const entries = level => app.eval(`harpEntries("C", "Major Richter", "${level}")`);
    const beginner = entries("beginner");
    const intermediate = entries("intermediate");
    const advanced = entries("advanced");
    const pro = entries("pro");
    const maximumDepth = levelEntries => Math.max(...levelEntries.map(entry => entry.bendDepth));
    assertEqual(maximumDepth(beginner), 0, "beginner maximum bend depth");
    assertEqual(maximumDepth(intermediate), 1, "intermediate maximum bend depth");
    assert(maximumDepth(advanced) > maximumDepth(intermediate), "advanced should add deeper conventional bends");
    assert(advanced.every(entry => entry.kind !== "overbend"), "advanced should exclude overblows and overdraws");
    assert(pro.some(entry => entry.kind === "overbend"), "pro should include overblows and overdraws");
    const descriptor = app.practiceWebMCPTools().find(tool => tool.name === "generate_practice_exercise");
    assertEqual(descriptor.inputSchema.properties.level.enum, ["beginner", "intermediate", "advanced", "pro"], "practice level schema");
  });

  test("range controls and selected bars reflect transport state", () => {
    assertEqual(app.document.querySelector("#practiceLoopStart").value, "3", "start selector");
    assertEqual(app.document.querySelector("#practiceLoopEnd").value, "5", "end selector");
    assertEqual(app.document.querySelectorAll(".progression-event.loop-selected.loop-enabled").length, 3, "selected progression bars");
    assertEqual(app.document.querySelector("#practiceLoop").getAttribute("aria-pressed"), "true", "loop pressed state");
  });

  test("crossed loop endpoints collapse toward the edited endpoint", () => {
    app.setPracticeLoopRange({ startBar: 7 }, "test");
    assertEqual(app.practiceLoopRange(), { startBar: 7, endBar: 7, startBeat: 24, endBeat: 28 }, "later start bar");
    app.setPracticeLoopRange({ endBar: 4 }, "test");
    assertEqual(app.practiceLoopRange(), { startBar: 4, endBar: 4, startBeat: 12, endBeat: 16 }, "earlier end bar");
  });

  test("invalid loop bars are rejected without state mutation", () => {
    const before = app.practiceExerciseContext().transport;
    let rejected = false;
    try {
      app.setPracticeLoopRange({ startBar: 9 }, "test");
    } catch (error) {
      rejected = error instanceof app.RangeError;
    }
    assert(rejected, "out-of-range bar should throw RangeError");
    assertEqual(app.practiceExerciseContext().transport, before, "transport after rejected range");
  });

  test("WebMCP transport schema exposes loop bounds", () => {
    const descriptor = app.practiceWebMCPTools().find(tool => tool.name === "control_practice_transport");
    assert(descriptor.inputSchema.properties.startBar, "startBar schema is required");
    assert(descriptor.inputSchema.properties.endBar, "endBar schema is required");
  });

  test("chord backing is playable, expressive, and muteable", async () => {
    app.installPracticeExercise(config, "test");
    const descriptor = app.practiceWebMCPTools().find(tool => tool.name === "control_practice_transport");
    const before = JSON.stringify({
      progression: app.practiceExerciseContext().exercise.progression,
      melody: app.practiceExerciseContext().exercise.melody
    });
    assertEqual(app.practiceExerciseContext().audio.backingChordsMuted, false, "practice starts with backing enabled");
    assertEqual(app.practiceExerciseContext().audio.backingInstrument, "piano", "default backing instrument");
    assertEqual(app.document.querySelector("#practiceBackingMute").textContent, "Mute chords", "default backing control label");
    await descriptor.execute({ action: "backing", enabled: true });
    assertEqual(descriptor.inputSchema.properties.instrument.enum, ["guitar", "piano"], "backing instrument enum");
    const instrumentControl = app.document.querySelector("#practiceBackingInstrument");
    instrumentControl.value = "piano";
    instrumentControl.dispatchEvent(new app.Event("change", { bubbles: true }));
    assertEqual(app.practiceExerciseContext().audio.backingInstrument, "piano", "direct backing instrument state");
    const pianoLibrary = app.eval("FretwiseAudio.pianoLibrary");
    assertEqual(pianoLibrary.name, "Upright Piano KW", "sampled piano library");
    assertEqual(pianoLibrary.license, "CC0-1.0", "sampled piano license");
    assertEqual(pianoLibrary.encodedBytes, 1405512, "sampled piano payload");
    assertEqual(pianoLibrary.midiRange, [37, 76], "sampled piano range");
    assert(await app.eval("FretwiseAudio.preparePiano()"), "upright piano samples should decode");
    assertEqual(app.eval("FretwiseAudio.pianoStatus().loadedSamples"), pianoLibrary.sampleCount, "all upright piano samples loaded");
    assertEqual(app.eval("FretwiseAudio.harmonicaStatus().state"), "idle", "Harmonica samples stay unloaded until Harmonica is requested");
    assertEqual(app.performance.getEntriesByType("resource").filter(entry => entry.name.includes("/assets/harmonica/")).length, 0, "initial page load excludes Harmonica samples");
    const harmonicaLibrary = app.eval("FretwiseAudio.harmonicaLibrary");
    assertEqual(harmonicaLibrary.name, "VCSL C Diatonic Harmonica", "default sampled Harmonica library");
    assertEqual(harmonicaLibrary.license, "CC0-1.0", "sampled Harmonica license");
    assertEqual(harmonicaLibrary.midiRange, [60, 96], "sampled Harmonica range");
    assertEqual(harmonicaLibrary.maxPitchShiftSemitones, 4, "sampled Harmonica maximum pitch shift");
    assert(harmonicaLibrary.encodedBytes < 1024 * 1024, "sampled Harmonica payload should remain below one MiB");
    assertEqual(app.eval("typeof FretwiseAudio.playSynthHarmonica"), "function", "synthesized Harmonica fallback remains available");
    assert(await app.eval("FretwiseAudio.prepareHarmonica()"), "VCSL Harmonica samples should decode");
    assertEqual(app.eval("FretwiseAudio.harmonicaStatus().loadedSamples"), harmonicaLibrary.sampleCount, "all VCSL Harmonica samples loaded");
    const pianoSchedule = app.eval(`FretwiseAudio.scheduleChordProgression(${JSON.stringify(app.practiceBackingChordEvents().slice(0, 1))}, { tempo: ${config.tempo}, seed: ${config.seed}, instrument: "piano", group: "piano-test" })`);
    assertEqual(pianoSchedule.instrument, "piano", "piano scheduler routing");
    app.eval('FretwiseAudio.stopGroup("piano-test")');
    assertEqual(app.eval("FretwiseAudio.guitarStatus().state"), "idle", "Guitar samples stay unloaded until Guitar is requested");
    assertEqual(app.performance.getEntriesByType("resource").filter(entry => entry.name.includes("/assets/guitar/")).length, 0, "initial page load excludes Guitar samples");
    const guitarContext = await descriptor.execute({ action: "backing", instrument: "guitar" });
    assertEqual(guitarContext.audio.backingInstrument, "guitar", "tool backing instrument state");
    assertEqual(app.document.querySelector("#practiceBackingInstrument").value, "guitar", "visible backing instrument state");
    const guitarLibrary = app.eval("FretwiseAudio.guitarLibrary");
    assertEqual(guitarLibrary.name, "FSS Steel-String Acoustic Guitar", "sampled Guitar library");
    assertEqual(guitarLibrary.license, "GPL-3.0-or-later", "sampled Guitar license");
    assertEqual(guitarLibrary.licenseException, "FreePats sound-sample exception", "sampled Guitar license exception");
    assertEqual(guitarLibrary.midiRange, [38, 76], "sampled Guitar range");
    assert(guitarLibrary.encodedBytes < 1024 * 1024, "sampled Guitar payload should remain below one MiB");
    const instrumentMix = app.eval("FretwiseAudio.instrumentMix");
    assertEqual(instrumentMix.sampledGuitarGain, 0.24, "sampled Guitar mix gain");
    assertEqual(instrumentMix.sampledHarmonicaGain, 0.42, "sampled Harmonica mix gain");
    assertEqual(instrumentMix.sampledPianoGain, 0.36, "sampled Piano mix gain");
    assertEqual(instrumentMix.guitarHighpassHz, 70, "sampled Guitar rumble cut");
    assert(await app.eval("FretwiseAudio.prepareGuitar()"), "steel-string Guitar samples should decode");
    assertEqual(app.eval("FretwiseAudio.guitarStatus().loadedSamples"), guitarLibrary.sampleCount, "all steel-string Guitar samples loaded");
    assertEqual(descriptor.inputSchema.properties.strumsPerBar.enum, [1, 2, 4], "backing rhythm enum");
    const rhythmControl = app.document.querySelector("#practiceBackingRhythm");
    rhythmControl.value = "4";
    rhythmControl.dispatchEvent(new app.Event("change", { bubbles: true }));
    assertEqual(app.practiceExerciseContext().audio.backingStrumsPerBar, 4, "direct backing rhythm state");
    assertEqual(app.practiceExerciseContext().audio.backingChordsMuted, false, "rhythm change preserves mute state");
    const rhythmExpectations = {
      1: { offsets: [0], durationBeats: 4 },
      2: { offsets: [0, 2], durationBeats: 2 },
      4: { offsets: [0, 1, 2, 3], durationBeats: 1 }
    };
    for (const [strums, expectation] of Object.entries(rhythmExpectations)) {
      const context = await descriptor.execute({ action: "backing", strumsPerBar: Number(strums) });
      const rhythmEvents = app.practiceBackingChordEvents();
      assertEqual(context.audio.backingStrumsPerBar, Number(strums), `${strums}-strum returned rhythm`);
      assertEqual(rhythmEvents.length, config.bars * Number(strums), `${strums}-strum event count`);
      assertEqual(rhythmEvents.slice(0, Number(strums)).map(event => event.beat), expectation.offsets, `${strums}-strum first-bar onsets`);
      assert(rhythmEvents.every(event => event.durationBeats === expectation.durationBeats), `${strums}-strum slot durations`);
      assert(rhythmEvents.every(event => app.eval(`FretwiseAudio.chordExpressionProfile(${JSON.stringify(event)}, ${config.seed})`).durationBeats === expectation.durationBeats), `${strums}-strum envelope durations`);
      rhythmEvents.slice(0, Number(strums)).forEach(event => {
        const expression = app.eval(`FretwiseAudio.chordExpressionProfile(${JSON.stringify(event)}, ${config.seed})`);
        event.midis.forEach((midi, index) => {
          const playback = app.eval(`FretwiseAudio.chordPlaybackProfile(${JSON.stringify(expression)}, ${config.tempo}, ${index})`);
          assert(playback.durationSeconds + playback.staggerSeconds < playback.slotSeconds, `${strums}-strum voice must end before its next slot`);
          assert(playback.durationSeconds >= playback.slotSeconds * 0.72, `${strums}-strum voice should sustain through most of its slot`);
        });
      });
    }
    const roomEffect = app.eval("FretwiseAudio.roomEffect");
    assert(roomEffect.wetGain > 0 && roomEffect.wetGain <= 0.15, "room reverb should remain subtle");
    assert(roomEffect.decaySeconds >= 0.6 && roomEffect.decaySeconds <= 1, "room reverb should remain short");

    await descriptor.execute({ action: "backing", strumsPerBar: 1 });
    app.eval('updatePractice(state => { state.transport.playheadBeat = 1; }, "test")');
    const resumedEvent = app.practiceBackingChordEvents()[0];
    assertEqual([resumedEvent.beat, resumedEvent.durationBeats], [0, 4], "resumed overlapping backing slot");
    const resumedProfile = app.eval(`FretwiseAudio.chordExpressionProfile(${JSON.stringify({ ...resumedEvent, durationBeats: 3 })}, ${config.seed})`);
    assertEqual(resumedProfile.durationBeats, 3, "resumed remaining decay");
    app.eval('updatePractice(state => { state.transport.playheadBeat = 0; }, "test")');

    await descriptor.execute({ action: "backing", strumsPerBar: 2 });
    const events = app.practiceBackingChordEvents();
    events.forEach(event => {
      const chord = app.practiceExerciseContext().exercise.progression[Math.floor(event.beat / 4)];
      const pitchClass = value => ((value % 12) + 12) % 12;
      const expectedPitchClasses = chord.intervals.map(interval => pitchClass(chord.rootPitchClass + interval)).sort((left, right) => left - right);
      const actualPitchClasses = event.midis.map(midi => pitchClass(midi)).sort((left, right) => left - right);
      assertEqual(actualPitchClasses, expectedPitchClasses, `${event.chordSymbol} chord tones`);
      assertEqual(new Set(event.positions.map(position => position.string)).size, event.positions.length, `${event.chordSymbol} unique strings`);
      assert(event.positions.every(position => position.fret >= 0 && position.fret <= 12), `${event.chordSymbol} visible frets`);
    });

    const profile = event => app.eval(`FretwiseAudio.chordExpressionProfile(${JSON.stringify(event)}, ${config.seed})`);
    const first = profile(events[0]);
    assertEqual(first, profile(events[0]), "deterministic chord expression");
    assert(JSON.stringify(first) !== JSON.stringify(profile(events[1])), "adjacent strums should vary");
    assertEqual([first.direction, profile(events[1]).direction], ["down", "up"], "alternating strum direction");

    assert(descriptor.inputSchema.properties.action.enum.includes("backing"), "transport schema backing action");
    const muted = await descriptor.execute({ action: "backing", enabled: false });
    assertEqual(muted.audio.backingChordsMuted, true, "returned muted state");
    assertEqual(app.document.querySelector("#practiceBackingMute").getAttribute("aria-pressed"), "true", "visible muted state");
    const unmuted = await descriptor.execute({ action: "backing", enabled: true });
    assertEqual(unmuted.audio.backingChordsMuted, false, "returned unmuted state");
    assertEqual(JSON.stringify({ progression: unmuted.exercise.progression, melody: unmuted.exercise.melody }), before, "canonical state after backing controls");
  });

  test("shared melody can be muted for backing-only practice", async () => {
    app.installPracticeExercise(config, "test");
    const descriptor = app.practiceWebMCPTools().find(tool => tool.name === "control_practice_transport");
    const before = JSON.stringify(app.practiceExerciseContext().exercise.melody);
    assertEqual(app.practiceExerciseContext().audio.melodyMuted, false, "practice starts with melody audible");
    assertEqual(app.document.querySelector("#practiceMelodyMute").textContent, "Mute melody", "default melody control label");
    assert(descriptor.inputSchema.properties.action.enum.includes("melody"), "transport schema melody action");
    const muted = await descriptor.execute({ action: "melody", enabled: false });
    assertEqual(muted.audio.melodyMuted, true, "returned melody muted state");
    assertEqual(app.document.querySelector("#practiceMelodyMute").getAttribute("aria-pressed"), "true", "visible melody muted state");
    const unmuted = await descriptor.execute({ action: "melody", enabled: true });
    assertEqual(unmuted.audio.melodyMuted, false, "returned melody unmuted state");
    assertEqual(JSON.stringify(app.practiceExerciseContext().exercise.melody), before, "canonical melody after melody mute controls");
  });

  test("progression bar inspection highlights and reveals linked melody segments", () => {
    app.setWorkspaceView("practice", "test");
    app.installPracticeExercise({ ...config, bars: 12 }, "test");
    const beforeTransport = JSON.stringify(app.practiceExerciseContext().transport);
    assertEqual(app.document.querySelectorAll(".practice-event.bar-start").length, 36, "bar boundaries across three tracks");
    assert(app.document.querySelectorAll(".practice-event.bar-even").length > 0, "alternating bar bands");

    const bar = app.document.querySelector('#practiceProgression .progression-event[data-bar="10"]');
    assertEqual(bar.tagName, "BUTTON", "progression bar control semantics");
    bar.click();
    const context = app.practiceExerciseContext();
    assertEqual(context.inspectedBar, 10, "returned inspected bar");
    assertEqual(bar.getAttribute("aria-pressed"), "true", "pressed inspection state");
    assertEqual(app.document.querySelectorAll("#practiceProgression .progression-event.inspected").length, 1, "inspected progression bar");
    assertEqual([...app.document.querySelectorAll(".practice-track")].map(track => track.querySelectorAll('.practice-event[data-bar="10"].inspected').length), [4, 4, 4], "linked inspected melody events");
    assert([...app.document.querySelectorAll(".practice-track")].every(track => track.scrollLeft > 0), "linked tracks scroll to inspected bar");
    assertEqual(JSON.stringify(context.transport), beforeTransport, "transport after inspection");

    app.document.querySelector("#practiceGuitarView").click();
    const guitarOctave = app.document.querySelector("#practiceGuitarOctave");
    guitarOctave.value = "-1";
    guitarOctave.dispatchEvent(new app.Event("change", { bubbles: true }));
    app.document.querySelector("#practiceHarmonicaView").click();
    const harmonicaOctave = app.document.querySelector("#practiceHarmonicaOctave");
    harmonicaOctave.value = "1";
    harmonicaOctave.dispatchEvent(new app.Event("change", { bubbles: true }));
    assert([...app.document.querySelectorAll("#practiceProgression, .practice-track")].every(scroller => scroller.scrollLeft > 0), "inspection scroll after view and octave changes");
    assertEqual([...app.document.querySelectorAll(".practice-track")].map(track => track.querySelectorAll('.practice-event[data-bar="10"].inspected').length), [4, 4, 4], "inspection highlights after view and octave changes");
    assertEqual(app.practiceExerciseContext().inspectedBar, 10, "inspection state after view and octave changes");
    assertEqual(JSON.stringify(app.practiceExerciseContext().transport), beforeTransport, "transport after view and octave changes");

    app.document.querySelector('#practiceProgression .progression-event[data-bar="10"]').click();
    assertEqual(app.practiceExerciseContext().inspectedBar, null, "inspection toggle off");
    assertEqual(app.document.querySelectorAll("#practicePanel .inspected").length, 0, "cleared inspection styles");
    harmonicaOctave.value = "0";
    harmonicaOctave.dispatchEvent(new app.Event("change", { bubbles: true }));
    app.document.querySelector("#practiceGuitarView").click();
    const restoredGuitarOctave = app.document.querySelector("#practiceGuitarOctave");
    restoredGuitarOctave.value = "0";
    restoredGuitarOctave.dispatchEvent(new app.Event("change", { bubbles: true }));
    app.document.querySelector("#practiceHarmonicaView").click();
  });

  test("score and guitar TAB share canonical timing and follow tuning", () => {
    app.installPracticeExercise({ ...config, bars: 12 }, "test");
    const canonical = JSON.stringify(app.practiceExerciseContext().exercise.melody);
    app.document.querySelector("#practiceNotationTimeline").click();
    const notation = app.practiceExerciseContext();
    const scoreEvents = [...app.document.querySelectorAll(".practice-score-event")];
    const tabEvents = [...app.document.querySelectorAll(".practice-tab-event")];
    assertEqual(notation.timelineView, "notation", "returned notation timeline view");
    assertEqual(app.document.querySelector("#practiceNotationTimeline").getAttribute("aria-pressed"), "true", "visible notation timeline view");
    assertEqual([scoreEvents.length, tabEvents.length, app.document.querySelectorAll(".practice-notation-harmonica").length], [notation.exercise.melody.length, notation.exercise.melody.length, notation.exercise.melody.length], "notation event counts");
    assertEqual(scoreEvents.map(event => Number(event.dataset.midi)), notation.representations.map(item => item.guitar.midi), "score projected MIDI");
    assertEqual(tabEvents.map(event => [Number(event.dataset.string), Number(event.dataset.fret)]), notation.representations.map(item => [item.guitar.string, item.guitar.fret]), "TAB projected positions");
    assertEqual([...app.document.querySelectorAll(".practice-tab-tuning i")].map(label => label.title), ["E4", "B3", "G3", "D3", "A2", "E2"], "Standard TAB tuning labels");

    const standardPositions = tabEvents.map(event => [event.dataset.string, event.dataset.fret]);
    const tuning = app.document.querySelector("#practiceGuitarTuning");
    tuning.value = "DADGAD";
    tuning.dispatchEvent(new app.Event("change", { bubbles: true }));
    const dadgad = app.practiceExerciseContext();
    const dadgadEvents = [...app.document.querySelectorAll(".practice-tab-event")];
    assertEqual([...app.document.querySelectorAll(".practice-tab-tuning i")].map(label => label.title), ["D4", "A3", "G3", "D3", "A2", "D2"], "DADGAD TAB tuning labels");
    assert(JSON.stringify(standardPositions) !== JSON.stringify(dadgadEvents.map(event => [event.dataset.string, event.dataset.fret])), "TAB positions should change with tuning");
    assertEqual(dadgadEvents.map(event => [Number(event.dataset.string), Number(event.dataset.fret)]), dadgad.representations.map(item => [item.guitar.string, item.guitar.fret]), "DADGAD TAB projected positions");
    assertEqual(JSON.stringify(dadgad.exercise.melody), canonical, "canonical melody after TAB tuning change");

    app.document.querySelector('#practiceProgression [data-bar="10"]').click();
    assertEqual([...app.document.querySelectorAll(".practice-notation-track")].map(track => track.querySelectorAll('.practice-event[data-bar="10"].inspected').length), [4, 4, 4], "notation bar inspection");
    app.document.querySelector("#practiceCompactTimeline").click();
    assertEqual(app.practiceExerciseContext().timelineView, "compact", "restored compact timeline view");
    assertEqual(app.document.querySelectorAll(".practice-score-event, .practice-tab-event").length, 0, "notation events removed in compact view");
  });

  test("fretboard context reset matches Clear and preserves tuning", async () => {
    const descriptor = app.fretboardWebMCPTools().find(tool => tool.name === "set_fretboard_context");
    await descriptor.execute({ tuning: "Drop D (D A D G B E)", chordRoot: "D", scaleRoot: "E", chord: "Minor", scale: "Dorian" });
    await app.fretboardWebMCPTools().find(tool => tool.name === "set_display_mode").execute({ mode: "both", showIntervals: true });
    const context = await descriptor.execute({ reset: true });
    assertEqual(context, {
      tuning: "Drop D (D A D G B E)", chordRoot: "C", scaleRoot: "C", chord: "Major", scale: "Major / Ionian",
      chordTones: ["C", "E", "G"], scaleTones: ["C", "D", "E", "F", "G", "A", "B"], sharedTones: ["C", "E", "G"],
      chordIsContainedInScale: true, mode: "none", showIntervals: false
    }, "reset fretboard context");
  });

  test("domain tools preserve the active workspace and independent tunings", async () => {
    const practiceTool = app.practiceWebMCPTools().find(tool => tool.name === "set_practice_projection");
    const fretboardTool = app.fretboardWebMCPTools().find(tool => tool.name === "set_fretboard_context");
    const switchTool = app.workspaceWebMCPTools().find(tool => tool.name === "switch_workspace_view");
    app.installPracticeExercise(config, "test");
    app.updateFretboard({ tuning: "Standard (E A D G B E)" }, "test");
    app.setWorkspaceView("practice", "test");

    const practice = await practiceTool.execute({ guitarTuning: "Open G (D G D G B D)" });
    assertEqual(practice.exercise.guitarTuning, "Open G (D G D G B D)", "returned Practice tuning");
    assertEqual(app.document.querySelector("#practiceGuitarTuning").value, practice.exercise.guitarTuning, "visible Practice tuning");
    assertEqual(app.fretboardContext().tuning, "Standard (E A D G B E)", "unchanged Fretboard tuning");
    assertEqual(app.workspaceViewContext().activeView, "practice", "Practice tool active workspace");

    const fretboard = await fretboardTool.execute({ tuning: "Drop D (D A D G B E)" });
    assertEqual(fretboard.tuning, "Drop D (D A D G B E)", "returned Fretboard tuning");
    assertEqual(app.practiceExerciseContext().exercise.guitarTuning, "Open G (D G D G B D)", "unchanged Practice tuning");
    assertEqual(app.workspaceViewContext().activeView, "practice", "Fretboard tool active workspace");

    const switched = await switchTool.execute({ view: "fretboard" });
    assertEqual(switched.activeView, "fretboard", "explicitly switched workspace");
    assertEqual(app.practiceExerciseContext().exercise.guitarTuning, "Open G (D G D G B D)", "Practice tuning after navigation");
    assertEqual(app.fretboardContext().tuning, "Drop D (D A D G B E)", "Fretboard tuning after navigation");
    await switchTool.execute({ view: "practice" });
  });

  test("harmonica context reset matches Clear and preserves setup and phrase", async () => {
    const descriptor = app.harmonicaWebMCPTools().find(tool => tool.name === "set_harmonica_context");
    await descriptor.execute({ tuning: "Country", harpKey: "D", position: "2nd position", chordRoot: "F", scaleRoot: "A", chord: "Minor", scale: "Dorian" });
    app.updateHarmonica({ phrase: [{ tab: "+1", note: "D4", midi: 62 }] }, "test");
    await app.harmonicaWebMCPTools().find(tool => tool.name === "set_harmonica_display").execute({ mode: "both", showIntervals: true, showOverbends: true });
    const context = await descriptor.execute({ reset: true });
    assertEqual({
      tuning: context.tuning, harpKey: context.harpKey, position: context.position, chordRoot: context.chordRoot, scaleRoot: context.scaleRoot,
      chord: context.chord, scale: context.scale, mode: context.mode, showIntervals: context.showIntervals, showOverbends: context.showOverbends, phrase: context.phrase
    }, {
      tuning: "Country", harpKey: "D", position: "2nd position", chordRoot: "C", scaleRoot: "C", chord: "Major", scale: "Major / Ionian",
      mode: "none", showIntervals: false, showOverbends: false, phrase: ["+1"]
    }, "reset harmonica context");
  });

  test("WebMCP exposes the complete unique 12-tool surface", () => {
    const tools = app.allWebMCPTools();
    const names = tools.map(tool => tool.name);
    assertEqual(names, [
      "set_fretboard_context",
      "get_music_theory_context",
      "set_display_mode",
      "inspect_fret_position",
      "switch_workspace_view",
      "set_harmonica_context",
      "get_harmonica_context",
      "set_harmonica_display",
      "generate_practice_exercise",
      "get_practice_exercise",
      "set_practice_projection",
      "control_practice_transport"
    ], "WebMCP tool inventory");
    assertEqual(new Set(names).size, names.length, "WebMCP tool names must be unique");
    assertEqual(tools.filter(tool => tool.annotations?.readOnlyHint).map(tool => tool.name), [
      "get_music_theory_context",
      "inspect_fret_position",
      "get_harmonica_context",
      "get_practice_exercise"
    ], "read-only tool annotations");
    tools.forEach(tool => {
      assert(tool.title && tool.description, `${tool.name} requires a title and description`);
      assertEqual(tool.inputSchema.additionalProperties, false, `${tool.name} additionalProperties`);
      JSON.stringify(tool.inputSchema);
    });
    const generateSchema = tools.find(tool => tool.name === "generate_practice_exercise").inputSchema.properties;
    const projectionSchema = tools.find(tool => tool.name === "set_practice_projection").inputSchema.properties;
    assertEqual(generateSchema.harmonicaOctave.enum, [0, 1, 2], "generate harmonica octave enum");
    assertEqual(generateSchema.guitarOctave.enum, [0, -1, -2], "generate guitar octave enum");
    assertEqual(generateSchema.timelineView.enum, ["compact", "notation"], "generate timeline view enum");
    assertEqual(projectionSchema.harmonicaOctave.enum, [0, 1, 2], "projection harmonica octave enum");
    assertEqual(projectionSchema.guitarOctave.enum, [0, -1, -2], "projection guitar octave enum");
    assertEqual(projectionSchema.timelineView.enum, ["compact", "notation"], "projection timeline view enum");
  });

  test("Harp key and tuning controls update playable derived tab", () => {
    app.installPracticeExercise(config, "test");
    const key = app.document.querySelector("#practiceHarpKey");
    key.value = "A";
    key.dispatchEvent(new app.Event("change", { bubbles: true }));
    const afterKey = app.practiceExerciseContext();
    assertEqual(afterKey.exercise.harpKey, "A", "exercise Harp key");
    assert(afterKey.representations.every(item => item.guitar && item.harmonica), "Harp key change must remain playable");

    const tuning = app.document.querySelector("#practiceHarpTuning");
    const beforeTuning = afterKey.representations.map(item => item.harmonica.tab);
    tuning.value = "Paddy Richter";
    tuning.dispatchEvent(new app.Event("change", { bubbles: true }));
    const afterTuning = app.practiceExerciseContext();
    const visibleTabs = [...app.document.querySelectorAll(".practice-track:nth-of-type(6) strong")].map(node => node.textContent);
    assertEqual(afterTuning.exercise.harpTuning, "Paddy Richter", "exercise Harp tuning");
    assert(afterTuning.representations.some((item, index) => item.harmonica.tab !== beforeTuning[index]), "tuning should change at least one derived tab");
    assertEqual(visibleTabs, afterTuning.representations.map(item => item.harmonica.tab), "visible Harmonica track");
  });

  test("Practice projection tool updates guidance without changing canonical events", async () => {
    app.installPracticeExercise(config, "test");
    const before = JSON.stringify(app.practiceExerciseContext().exercise.melody);
    const descriptor = app.practiceWebMCPTools().find(tool => tool.name === "set_practice_projection");
    const context = await descriptor.execute({ guitarOctave: -1, guitarPath: "horizontal", instrumentView: "guitar", timelineView: "notation", showNextNote: false });
    assertEqual(JSON.stringify(context.exercise.melody), before, "canonical melody after projection");
    assertEqual(context.instrumentView, "guitar", "returned instrument view");
    assertEqual(context.guitarProjection, { octave: -1, path: "horizontal" }, "guitar projection");
    assertEqual(context.timelineView, "notation", "returned timeline view");
    assertEqual(context.showNextNote, false, "next-note preview");
    assertEqual(app.document.querySelector("#practiceGuitarView").getAttribute("aria-pressed"), "true", "visible instrument view");
    assertEqual(app.document.querySelector("#practiceNotationTimeline").getAttribute("aria-pressed"), "true", "visible timeline view");
    assert(context.representations.every(item => item.guitar && item.harmonica), "projected representations remain playable");
    app.document.querySelector("#practiceCompactTimeline").click();
  });

  test("Practice octave projections accept only fully playable instrument ranges", async () => {
    const descriptor = app.practiceWebMCPTools().find(tool => tool.name === "set_practice_projection");

    app.installPracticeExercise({ ...config, seed: 20, bars: 4 }, "test");
    const harmonicaCanonical = JSON.stringify(app.practiceExerciseContext().exercise.melody);
    const harmonica = await descriptor.execute({ harmonicaOctave: 2, instrumentView: "harmonica" });
    assertEqual(harmonica.harmonicaProjection, { octave: 2 }, "harmonica projection");
    assert(harmonica.projectionOptions.harmonicaOctaves.includes(2), "returned harmonica availability");
    assert(harmonica.representations.every((item, index) => item.harmonica.midi === harmonica.exercise.melody[index].midi + 24), "harmonica MIDI should move up two octaves");
    assert(app.practiceScheduledEvents().every((event, index) => event.midi === harmonica.exercise.melody[index].midi + 24), "harmonica audio projection");
    assertEqual(JSON.stringify(harmonica.exercise.melody), harmonicaCanonical, "canonical melody after harmonica projection");

    app.installPracticeExercise({ ...config, seed: 6, bars: 4 }, "test");
    const guitarCanonical = JSON.stringify(app.practiceExerciseContext().exercise.melody);
    const guitar = await descriptor.execute({ guitarOctave: -2, guitarPath: "vertical", instrumentView: "guitar" });
    assertEqual(guitar.guitarProjection, { octave: -2, path: "vertical" }, "guitar projection");
    assert(guitar.projectionOptions.guitarOctaves.includes(-2), "returned guitar availability");
    assert(guitar.representations.every((item, index) => item.guitar.midi === guitar.exercise.melody[index].midi - 24), "guitar MIDI should move down two octaves");
    assert(app.practiceScheduledEvents().every((event, index) => event.midi === guitar.exercise.melody[index].midi - 24), "guitar audio projection");
    assertEqual(JSON.stringify(guitar.exercise.melody), guitarCanonical, "canonical melody after guitar projection");

    const rejected = app.installPracticeExercise(config, "test");
    assertEqual(rejected.harmonicaProjection, { octave: 0 }, "unplayable retained harmonica projection fallback");
    assertEqual(rejected.guitarProjection.octave, 0, "unplayable retained guitar projection fallback");
    assertEqual(rejected.projectionOptions, {
      harmonicaOctaves: [0, 1],
      guitarOctaves: [0, -1],
      guitarPaths: ["vertical", "horizontal"]
    }, "seed 1234 available projection options");
    assert(app.document.querySelector('#practiceHarmonicaOctave option[value="2"]').disabled, "unplayable harmonica option disabled");
    assert(app.document.querySelector('#practiceGuitarOctave option[value="-2"]').disabled, "unplayable guitar option disabled");
  });

  test("Practice lesson brief matches canonical and derived exercise data", () => {
    app.installPracticeExercise(config, "test");
    const context = app.practiceExerciseContext();
    const brief = context.lessonBrief;
    assertEqual(brief.form.eventCount, context.exercise.melody.length, "brief event count");
    assertEqual(brief.form.chords, context.exercise.progression.map(chord => chord.chordSymbol), "brief progression");
    assertEqual(brief.harmonica.techniques.reduce((total, item) => total + item.count, 0), context.exercise.melody.length, "brief technique count");
    assert(brief.harmonica.dominantHoles.length > 0, "brief dominant holes");
    assert(app.document.querySelector("#practiceBrief").textContent.includes("Focus holes"), "visible lesson brief");
    assert(app.document.querySelector("#practiceFocus").textContent.includes("Practice focus"), "visible practice focus");
  });

  test("Practice playback states have distinct labels and accessible actions", () => {
    assertEqual(app.practicePlayButtonPresentation("stopped"), { label: "Play", action: "Start practice playback" }, "stopped presentation");
    assertEqual(app.practicePlayButtonPresentation("awaiting-gesture"), { label: "Play", action: "Start audio playback" }, "awaiting gesture presentation");
    assertEqual(app.practicePlayButtonPresentation("count-in"), { label: "Cancel", action: "Cancel count-in" }, "count-in presentation");
    assertEqual(app.practicePlayButtonPresentation("playing"), { label: "Pause", action: "Pause practice playback" }, "playing presentation");
    assertEqual(app.practicePlayButtonPresentation("paused"), { label: "Resume", action: "Resume practice playback" }, "paused presentation");
  });

  test("agent playback requires explicit page-session consent", async () => {
    app.installPracticeExercise(config, "test");
    app.controlPracticeTransport("play", { source: "webmcp" });
    assertEqual(app.practiceExerciseContext().transport.status, "awaiting-gesture", "playback before consent");

    app.applyPracticeAgentPlaybackConsent(true);
    app.controlPracticeTransport("play", { source: "webmcp" });
    assertEqual(app.practiceExerciseContext().transport.status, "count-in", "playback after consent");
    assertEqual(app.practiceExerciseContext().audio.agentPlaybackAllowed, true, "reported consent");
    app.stopPracticePlayback(false, "test");
    app.applyPracticeAgentPlaybackConsent(false);
  });

  let passed = 0;
  for (const current of tests) {
    const row = document.createElement("li");
    try {
      await current.execute();
      row.className = "pass";
      row.textContent = `PASS  ${current.name}`;
      passed++;
    } catch (error) {
      row.className = "fail";
      row.textContent = `FAIL  ${current.name}: ${error.message}`;
    }
    results.append(row);
  }
  summary.textContent = `${passed} of ${tests.length} tests passed`;
  document.title = passed === tests.length ? "PASS - SonicViz regression tests" : "FAIL - SonicViz regression tests";
});