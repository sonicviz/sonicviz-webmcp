const PRACTICE_DEFAULTS = {
  seed: 1234,
  key: "G",
  level: "beginner",
  style: "blues",
  bars: 8,
  tempo: 72,
  harpKey: "C",
  harpTuning: "Major Richter",
  guitarTuning: Object.keys(TUNINGS)[0]
};

const PRACTICE_STYLES = {
  blues: { scale: [0, 3, 5, 6, 7, 10], sequence: ["I7", "IV7", "I7", "I7", "IV7", "IV7", "I7", "I7", "V7", "IV7", "I7", "V7"] },
  "I-IV-V-I": { scale: SCALES["Major / Ionian"], sequence: ["I", "IV", "V", "I"] },
  "I-vi-IV-V": { scale: SCALES["Major / Ionian"], sequence: ["I", "vi", "IV", "V"] },
  "ii-V-I": { scale: SCALES["Major / Ionian"], sequence: ["ii", "V7", "I"] },
  minor: { scale: SCALES["Natural minor / Aeolian"], sequence: ["i", "VI", "III", "VII"] }
};

const PRACTICE_LEVELS = {
  beginner: { allowedKinds: ["natural"], maximumBendDepth: 0, density: 1 },
  intermediate: { allowedKinds: ["natural", "bend"], maximumBendDepth: 1, density: 2 },
  advanced: { allowedKinds: ["natural", "bend"], maximumBendDepth: 3, density: 2 },
  pro: { allowedKinds: ["natural", "bend", "overbend"], maximumBendDepth: 4, density: 2 }
};

const PRACTICE_DEGREES = {
  I: { degree: "I", offset: 0, quality: "major", intervals: [0, 4, 7] },
  I7: { degree: "I", offset: 0, quality: "dominant 7", intervals: [0, 4, 7, 10] },
  IV: { degree: "IV", offset: 5, quality: "major", intervals: [0, 4, 7] },
  IV7: { degree: "IV", offset: 5, quality: "dominant 7", intervals: [0, 4, 7, 10] },
  V: { degree: "V", offset: 7, quality: "major", intervals: [0, 4, 7] },
  V7: { degree: "V", offset: 7, quality: "dominant 7", intervals: [0, 4, 7, 10] },
  vi: { degree: "vi", offset: 9, quality: "minor", intervals: [0, 3, 7] },
  ii: { degree: "ii", offset: 2, quality: "minor", intervals: [0, 3, 7] },
  i: { degree: "i", offset: 0, quality: "minor", intervals: [0, 3, 7] },
  VI: { degree: "VI", offset: 8, quality: "major", intervals: [0, 4, 7] },
  III: { degree: "III", offset: 3, quality: "major", intervals: [0, 4, 7] },
  VII: { degree: "VII", offset: 10, quality: "major", intervals: [0, 4, 7] }
};

const practiceState = FretwiseSession.registerSlice("practice", {
  exercise: null,
  instrumentView: "harmonica",
  showNextNote: true,
  harmonicaOctave: 0,
  guitarOctave: 0,
  guitarPath: "vertical",
  backingMuted: false,
  backingInstrument: "piano",
  backingStrumsPerBar: 2,
  melodyMuted: false,
  inspectedBar: null,
  timelineView: "compact",
  transport: { status: "stopped", playheadBeat: 0, loop: false, loopStartBar: 1, loopEndBar: PRACTICE_DEFAULTS.bars, tempo: PRACTICE_DEFAULTS.tempo, awaitingUserGesture: false }
});

let practiceAnimation = null;
let practiceStartedAt = 0;
let practiceFollowedEventId = null;
let practiceSyncingScroll = false;
let practiceResetPending = false;
let practiceCountIn = null;
let practiceAgentPlaybackAllowed = false;

function practiceSoundingDuration(event, index) {
  const next = practiceState.exercise?.melody[index + 1];
  const repeatsImmediately = next?.midi === event.midi && Math.abs(next.beat - event.beat - event.durationBeats) < 0.001;
  if (!repeatsImmediately) return event.durationBeats;
  const gapBeats = Math.min(event.durationBeats * 0.25, practiceState.transport.tempo * 0.08 / 60);
  return event.durationBeats - gapBeats;
}

function seededRandom(seed) {
  let value = seed >>> 0;
  return () => {
    value += 0x6D2B79F5;
    let mixed = value;
    mixed = Math.imul(mixed ^ mixed >>> 15, mixed | 1);
    mixed ^= mixed + Math.imul(mixed ^ mixed >>> 7, mixed | 61);
    return ((mixed ^ mixed >>> 14) >>> 0) / 4294967296;
  };
}

function midiName(midi) {
  return `${note(midi)}${Math.floor(midi / 12) - 1}`;
}

function practiceGuitarOpenMidis(tuning) {
  let previousMidi = 35;
  return TUNINGS[tuning].map(pitch => {
    let midi = 36 + mod(pitch);
    while (midi <= previousMidi) midi += 12;
    previousMidi = midi;
    return midi;
  });
}

function guitarPositionsForMidi(midi, tuning) {
  return practiceGuitarOpenMidis(tuning).flatMap((openMidi, index) => {
    const fret = midi - openMidi;
    return fret >= 0 && fret <= 12 ? [{ string: 6 - index, fret }] : [];
  });
}

function guitarPositionForMidi(midi, tuning) {
  const positions = guitarPositionsForMidi(midi, tuning);
  positions.sort((left, right) => left.fret - right.fret || left.string - right.string);
  return positions[0] ?? null;
}

function deriveGuitarPositions(exercise, octave = practiceState.guitarOctave, path = practiceState.guitarPath) {
  const octaveOffset = octave * 12;
  const targets = exercise.melody.map(event => event.midi + octaveOffset);
  const candidates = targets.map(midi => guitarPositionsForMidi(midi, exercise.guitarTuning));
  if (candidates.some(positions => !positions.length)) return targets.map(() => null);

  let preferredString = null;
  if (path === "horizontal") {
    preferredString = [1, 2, 3, 4, 5, 6].sort((left, right) => {
      const leftCount = candidates.filter(positions => positions.some(position => position.string === left)).length;
      const rightCount = candidates.filter(positions => positions.some(position => position.string === right)).length;
      return rightCount - leftCount || right - left;
    })[0];
  }

  let previous = null;
  return candidates.map((positions, index) => {
    const ranked = [...positions].sort((left, right) => {
      if (!previous) {
        if (path === "horizontal") {
          return Number(right.string === preferredString) - Number(left.string === preferredString) || left.fret - right.fret;
        }
        return Math.abs(left.fret - 5) - Math.abs(right.fret - 5) || right.string - left.string;
      }
      const score = position => path === "horizontal"
        ? Math.abs(position.string - previous.string) * 24 + Math.abs(position.fret - previous.fret)
        : Math.abs(position.fret - previous.fret) * 4 + Math.abs(position.string - previous.string);
      return score(left) - score(right) || right.string - left.string;
    });
    previous = ranked[0];
    return { ...previous, midi: targets[index], note: midiName(targets[index]), octaveOffset: octave };
  });
}

function harpEntries(harpKey, tuning, level) {
  const keyOffset = N.indexOf(harpKey);
  const levelProfile = PRACTICE_LEVELS[level];
  if (!levelProfile) throw new RangeError(`Unsupported practice level: ${level}`);
  const kindRank = { natural: 0, bend: 1, overbend: 2 };
  const entries = harmonicaRows(tuning).filter(row => levelProfile.allowedKinds.includes(row.kind)).flatMap(row =>
    row.notes.flatMap((baseMidi, hole) => baseMidi === null ? [] : [{
      midi: baseMidi + keyOffset,
      tab: harmonicaTab(row, hole),
      technique: row.label,
      kind: row.kind,
      breath: row.symbol === "+" ? "blow" : "draw",
      bendDepth: row.kind === "natural" ? 0 : row.kind === "overbend" ? 4 : (row.suffix.match(/'/g) ?? []).length,
      hole: hole + 1
    }])
  ).filter(entry => entry.bendDepth <= levelProfile.maximumBendDepth);
  entries.sort((left, right) => left.midi - right.midi || kindRank[left.kind] - kindRank[right.kind]);
  return entries.filter((entry, index) => !entries.slice(0, index).some(previous => previous.midi === entry.midi));
}

function deriveHarmonicaPositions(exercise, octave = practiceState.harmonicaOctave) {
  const octaveOffset = octave * 12;
  const harp = harpEntries(exercise.harpKey, exercise.harpTuning, exercise.level);
  return exercise.melody.map(event => {
    const midi = event.midi + octaveOffset;
    const position = harp.find(entry => entry.midi === midi);
    return position ? { ...position, midi, note: midiName(midi), octaveOffset: octave } : null;
  });
}

function resolvedProgression(config) {
  const root = N.indexOf(config.key);
  const style = PRACTICE_STYLES[config.style];
  return Array.from({ length: config.bars }, (_, index) => {
    const definition = PRACTICE_DEGREES[style.sequence[index % style.sequence.length]];
    const rootPitchClass = mod(root + definition.offset);
    const suffix = definition.quality === "minor" ? "m" : definition.quality === "dominant 7" ? "7" : "";
    return {
      bar: index + 1,
      startBeat: index * 4,
      durationBeats: 4,
      degree: definition.degree,
      rootPitchClass,
      quality: definition.quality,
      intervals: [...definition.intervals],
      chordSymbol: `${note(rootPitchClass)}${suffix}`
    };
  });
}

function practiceChordVoicing(chord, tuning) {
  const pitchClasses = chord.intervals.map(interval => mod(chord.rootPitchClass + interval));
  const candidates = pitchClasses.map(pitchClass => practiceGuitarOpenMidis(tuning).flatMap((openMidi, index) =>
    Array.from({ length: 13 }, (_, fret) => ({ midi: openMidi + fret, string: 6 - index, fret }))
      .filter(position => mod(position.midi) === pitchClass)
  ));
  let best = null;

  function consider(positions, index = 0) {
    if (index === candidates.length) {
      const byPitch = [...positions].sort((left, right) => left.midi - right.midi);
      const frets = positions.map(position => position.fret);
      const strings = positions.map(position => position.string).sort((left, right) => left - right);
      const score = (mod(byPitch[0].midi) === chord.rootPitchClass ? 0 : 500)
        + (Math.max(...frets) - Math.min(...frets)) * 4
        + (byPitch.at(-1).midi - byPitch[0].midi)
        + (strings.at(-1) - strings[0] - strings.length + 1) * 6
        + Math.abs(byPitch[0].midi - 43) * 0.25;
      if (!best || score < best.score) best = { score, positions: byPitch };
      return;
    }
    candidates[index].forEach(position => {
      if (positions.some(selected => selected.string === position.string || selected.midi === position.midi)) return;
      consider([...positions, position], index + 1);
    });
  }

  consider([]);
  return best?.positions ?? [];
}

function playableMelodyNotes(config) {
  return harpEntries(config.harpKey, config.harpTuning, config.level).filter(entry =>
    guitarPositionForMidi(entry.midi, config.guitarTuning)
  );
}

function chooseMelodyMidi(candidates, target, random) {
  const ranked = [...candidates].sort((left, right) => Math.abs(left.midi - target) - Math.abs(right.midi - target) || left.midi - right.midi);
  return ranked[Math.floor(random() * Math.min(3, ranked.length))].midi;
}

function generatePracticeExercise(input = {}) {
  const config = { ...PRACTICE_DEFAULTS, ...input };
  config.seed = Number(config.seed);
  config.bars = Number(config.bars);
  config.tempo = Number(config.tempo);
  const progression = resolvedProgression(config);
  const playable = playableMelodyNotes(config);
  if (!playable.length) throw new RangeError("No notes are playable on both instruments for this setup.");

  const random = seededRandom(config.seed);
  const rootPitchClass = N.indexOf(config.key);
  const scalePitchClasses = new Set(PRACTICE_STYLES[config.style].scale.map(interval => mod(rootPitchClass + interval)));
  const density = PRACTICE_LEVELS[config.level]?.density;
  if (!density) throw new RangeError(`Unsupported practice level: ${config.level}`);
  const melody = [];
  const motif = [];
  let previousMidi = playable.find(entry => mod(entry.midi) === rootPitchClass)?.midi ?? playable[0].midi;

  for (let slot = 0; slot < config.bars * 4 * density; slot++) {
    const beat = slot / density;
    const chord = progression[Math.floor(beat / 4)];
    const strongBeat = Number.isInteger(beat) && Math.floor(beat) % 2 === 0;
    const chordPitchClasses = new Set(chord.intervals.map(interval => mod(chord.rootPitchClass + interval)));
    let candidates = playable.filter(entry => strongBeat ? chordPitchClasses.has(mod(entry.midi)) : scalePitchClasses.has(mod(entry.midi)));
    if (!candidates.length) candidates = playable.filter(entry => scalePitchClasses.has(mod(entry.midi)));
    if (!candidates.length) candidates = playable;
    const motifSlot = slot % (4 * density);
    const target = slot >= 4 * density && motif[motifSlot] !== undefined ? motif[motifSlot] : previousMidi;
    let midi = chooseMelodyMidi(candidates, target, random);
    if (slot === config.bars * 4 * density - 1) {
      const tonic = playable.filter(entry => mod(entry.midi) === rootPitchClass);
      if (tonic.length) midi = chooseMelodyMidi(tonic, previousMidi, random);
    }
    if (slot < 4 * density) motif.push(midi);
    melody.push({ id: `note-${slot + 1}`, beat, durationBeats: 1 / density, midi });
    previousMidi = midi;
  }

  return {
    id: `exercise-${config.seed}-${config.key}-${config.style}-${config.bars}`,
    seed: config.seed,
    key: config.key,
    tempo: config.tempo,
    meter: "4/4",
    level: config.level,
    style: config.style,
    bars: config.bars,
    harpKey: config.harpKey,
    harpTuning: config.harpTuning,
    guitarTuning: config.guitarTuning,
    progression,
    melody
  };
}

function derivePracticeRepresentations(exercise) {
  const guitarPositions = deriveGuitarPositions(exercise);
  const harmonicaPositions = deriveHarmonicaPositions(exercise);
  return exercise.melody.map((event, index) => {
    const harpPosition = harmonicaPositions[index];
    return {
      eventId: event.id,
      beat: event.beat,
      durationBeats: event.durationBeats,
      note: midiName(event.midi),
      guitar: guitarPositions[index],
      harmonica: harpPosition ? {
        midi: harpPosition.midi,
        note: harpPosition.note,
        octaveOffset: harpPosition.octaveOffset,
        tab: harpPosition.tab,
        technique: harpPosition.technique,
        breath: harpPosition.breath,
        bendDepth: harpPosition.bendDepth,
        hole: harpPosition.hole
      } : null
    };
  });
}

const PRACTICE_STAFF_SPELLINGS = [
  { letter: 0, accidental: "" }, { letter: 0, accidental: "♯" },
  { letter: 1, accidental: "" }, { letter: 2, accidental: "♭" },
  { letter: 2, accidental: "" }, { letter: 3, accidental: "" },
  { letter: 3, accidental: "♯" }, { letter: 4, accidental: "" },
  { letter: 5, accidental: "♭" }, { letter: 5, accidental: "" },
  { letter: 6, accidental: "♭" }, { letter: 6, accidental: "" }
];

function practiceStaffPlacement(midi) {
  const spelling = PRACTICE_STAFF_SPELLINGS[mod(midi)];
  const octave = Math.floor(midi / 12) - 1;
  const step = octave * 7 + spelling.letter - 30;
  const ledgerSteps = [];
  if (step <= -2) for (let ledger = -2; ledger >= step; ledger -= 2) ledgerSteps.push(ledger);
  if (step >= 10) for (let ledger = 10; ledger <= step; ledger += 2) ledgerSteps.push(ledger);
  return { ...spelling, step, bottom: 22 + step * 4, ledgerSteps };
}

function practiceTimelineEventClasses(item) {
  const barIndex = Math.floor(item.beat / 4);
  return `bar-${barIndex % 2 === 0 ? "odd" : "even"} ${item.beat % 4 === 0 ? "bar-start" : ""}`;
}

function practiceTimelineEventAttributes(item) {
  return `data-event-id="${item.eventId}" data-start-beat="${item.beat}" data-duration-beats="${item.durationBeats}" data-sounding-duration-beats="${item.soundingDurationBeats}" data-bar="${Math.floor(item.beat / 4) + 1}"`;
}

function renderPracticeCompactTracks(representations) {
  const rows = [
    ["Pitch", item => `<strong>${item.note}</strong><small>Beat ${item.beat + 1}</small>`],
    ["Guitar", item => `<strong>S${item.guitar.string} F${item.guitar.fret}</strong><small>${item.guitar.note}</small>`],
    ["Harmonica", item => `<strong>${item.harmonica.tab}</strong><small>${item.harmonica.note} · ${item.harmonica.technique}</small>`]
  ];
  return rows.map(([label, content]) => `
    <div class="practice-track-label">${label}</div>
    <div class="practice-track">${representations.map(item => `
      <div class="practice-event ${practiceTimelineEventClasses(item)}" ${practiceTimelineEventAttributes(item)}>${content(item)}</div>`).join("")}
    </div>`).join("");
}

function renderPracticeNotationTracks(representations, exercise) {
  const tuning = practiceGuitarOpenMidis(exercise.guitarTuning).reverse();
  const score = representations.map(item => {
    const placement = practiceStaffPlacement(item.guitar.midi);
    const direction = placement.step >= 4 ? "down" : "up";
    const duration = item.durationBeats <= 0.5 ? "eighth" : "quarter";
    return `<div class="practice-event practice-score-event ${practiceTimelineEventClasses(item)}" ${practiceTimelineEventAttributes(item)} data-midi="${item.guitar.midi}" aria-label="${item.guitar.note}, beat ${item.beat + 1}">
      <span class="practice-staff-lines" aria-hidden="true"></span>
      ${placement.ledgerSteps.map(step => `<i class="practice-ledger" style="--ledger-bottom:${22 + step * 4}px" aria-hidden="true"></i>`).join("")}
      <span class="practice-score-note ${direction} ${duration}" style="--note-bottom:${placement.bottom}px" aria-hidden="true"><b>${placement.accidental}</b><i></i><em></em></span>
    </div>`;
  }).join("");
  const guitarTab = representations.map(item => `
    <div class="practice-event practice-tab-event ${practiceTimelineEventClasses(item)}" ${practiceTimelineEventAttributes(item)} data-midi="${item.guitar.midi}" data-string="${item.guitar.string}" data-fret="${item.guitar.fret}" aria-label="${item.guitar.note}, string ${item.guitar.string}, fret ${item.guitar.fret}, beat ${item.beat + 1}">
      <span class="practice-tab-lines" aria-hidden="true"></span>
      <strong class="practice-tab-fret" style="--tab-top:${8 + (item.guitar.string - 1) * 11}px">${item.guitar.fret}</strong>
    </div>`).join("");
  const harmonica = representations.map(item => `
    <div class="practice-event practice-notation-harmonica ${practiceTimelineEventClasses(item)}" ${practiceTimelineEventAttributes(item)}>
      <strong>${item.harmonica.tab}</strong><small>${item.harmonica.note}</small>
    </div>`).join("");
  return `
    <div class="practice-track-label practice-score-label"><span>Score</span><strong aria-hidden="true">𝄞</strong></div>
    <div class="practice-track practice-notation-track practice-score-track">${score}</div>
    <div class="practice-track-label practice-tab-label"><strong>TAB</strong><span class="practice-tab-tuning">${tuning.map(midi => `<i title="${midiName(midi)}">${note(midi)}</i>`).join("")}</span></div>
    <div class="practice-track practice-notation-track practice-guitar-tab-track" data-tuning="${exercise.guitarTuning}">${guitarTab}</div>
    <div class="practice-track-label">Harmonica</div>
    <div class="practice-track practice-notation-track practice-harmonica-tab-track">${harmonica}</div>`;
}

function practiceLessonBrief(exercise) {
  const representations = derivePracticeRepresentations(exercise);
  const techniqueCounts = {};
  const holeCounts = {};
  representations.forEach(item => {
    const harmonica = item.harmonica;
    techniqueCounts[harmonica.technique] = (techniqueCounts[harmonica.technique] ?? 0) + 1;
    holeCounts[harmonica.hole] = (holeCounts[harmonica.hole] ?? 0) + 1;
  });
  const dominantHoles = Object.entries(holeCounts)
    .sort((left, right) => right[1] - left[1] || Number(left[0]) - Number(right[0]))
    .slice(0, 3)
    .map(([hole, count]) => ({ hole: Number(hole), count }));
  const guitar = representations.map(item => item.guitar);
  const frets = guitar.map(position => position.fret);
  const fretShifts = guitar.slice(1).map((position, index) => Math.abs(position.fret - guitar[index].fret));
  const stringChanges = guitar.slice(1).filter((position, index) => position.string !== guitar[index].string).length;
  const midis = exercise.melody.map(event => event.midi);
  const harpKey = N.indexOf(exercise.harpKey);
  const lessonKey = N.indexOf(exercise.key);
  const position = Object.entries(HARP_POSITIONS).find(([, offset]) => mod(harpKey + offset) === lessonKey)?.[0] ?? null;
  const techniques = Object.entries(techniqueCounts).map(([name, count]) => ({ name, count }));
  const bendTechniques = techniques.filter(item => /bend/i.test(item.name));
  const density = exercise.melody.length / (exercise.bars * 4);
  const focusParts = [
    dominantHoles.length ? `Center on hole${dominantHoles.length === 1 ? "" : "s"} ${dominantHoles.map(item => item.hole).join(", ")}.` : "",
    bendTechniques.length ? `Isolate ${bendTechniques.map(item => item.name.toLowerCase()).join(" and ")}.` : "Keep the natural blow/draw changes even.",
    Math.max(0, ...fretShifts) >= 5 ? `On guitar, rehearse the largest ${Math.max(...fretShifts)}-fret move separately.` : ""
  ].filter(Boolean);
  return {
    setup: {
      key: exercise.key,
      style: exercise.style,
      level: exercise.level,
      meter: exercise.meter,
      harpKey: exercise.harpKey,
      harpTuning: exercise.harpTuning,
      position
    },
    form: {
      bars: exercise.bars,
      chords: exercise.progression.map(chord => chord.chordSymbol),
      eventCount: exercise.melody.length,
      eventsPerBeat: density
    },
    melody: {
      lowestNote: midiName(Math.min(...midis)),
      highestNote: midiName(Math.max(...midis)),
      uniquePitchCount: new Set(midis).size
    },
    harmonica: { techniques, dominantHoles },
    guitar: {
      minimumFret: Math.min(...frets),
      maximumFret: Math.max(...frets),
      maximumFretShift: Math.max(0, ...fretShifts),
      stringChanges
    },
    focus: focusParts.join(" ")
  };
}

function practiceExerciseContext() {
  const exercise = practiceState.exercise;
  const availableHarmonicaOctaves = exercise
    ? [0, 1, 2].filter(octave => deriveHarmonicaPositions(exercise, octave).every(Boolean))
    : [];
  const availableGuitarOctaves = exercise
    ? [0, -1, -2].filter(octave => deriveGuitarPositions(exercise, octave).every(Boolean))
    : [];
  return {
    exercise,
    representations: exercise ? derivePracticeRepresentations(exercise) : [],
    lessonBrief: exercise ? practiceLessonBrief(exercise) : null,
    instrumentView: practiceState.instrumentView,
    harmonicaProjection: { octave: practiceState.harmonicaOctave },
    guitarProjection: { octave: practiceState.guitarOctave, path: practiceState.guitarPath },
    projectionOptions: {
      harmonicaOctaves: availableHarmonicaOctaves,
      guitarOctaves: availableGuitarOctaves,
      guitarPaths: ["vertical", "horizontal"]
    },
    inspectedBar: practiceState.inspectedBar,
    timelineView: practiceState.timelineView,
    showNextNote: practiceState.showNextNote,
    transport: { ...practiceState.transport },
    audio: {
      ...FretwiseAudio.status(),
      agentPlaybackAllowed: practiceAgentPlaybackAllowed,
      backingChordsMuted: practiceState.backingMuted,
      backingInstrument: practiceState.backingInstrument,
      backingStrumsPerBar: practiceState.backingStrumsPerBar,
      melodyMuted: practiceState.melodyMuted
    }
  };
}

function applyPracticeAgentPlaybackConsent(allowed) {
  const control = $("practiceAgentPlayback");
  practiceAgentPlaybackAllowed = allowed;
  control.checked = practiceAgentPlaybackAllowed;
  return practiceAgentPlaybackAllowed;
}

async function setPracticeAgentPlaybackAllowed(enabled) {
  if (!enabled) return applyPracticeAgentPlaybackConsent(false);
  practiceAgentPlaybackAllowed = applyPracticeAgentPlaybackConsent(await FretwiseAudio.unlock());
  if (!practiceAgentPlaybackAllowed) $("practicePosition").textContent = "Audio permission was not granted. Press Play to start audio.";
  return practiceAgentPlaybackAllowed;
}

function updatePractice(change, source = "ui", record = true) {
  FretwiseSession.update("practice", change, { source, record });
}

function installPracticeExercise(input, source = "ui") {
  const exercise = generatePracticeExercise(input);
  const requestedHarmonicaOctave = Number(input.harmonicaOctave ?? practiceState.harmonicaOctave);
  const requestedGuitarOctave = Number(input.guitarOctave ?? practiceState.guitarOctave);
  const harmonicaOctave = [0, 1, 2].includes(requestedHarmonicaOctave) && deriveHarmonicaPositions(exercise, requestedHarmonicaOctave).every(Boolean)
    ? requestedHarmonicaOctave : 0;
  const guitarOctave = [0, -1, -2].includes(requestedGuitarOctave) && deriveGuitarPositions(exercise, requestedGuitarOctave).every(Boolean)
    ? requestedGuitarOctave : 0;
  stopPracticePlayback(false);
  updatePractice(state => {
    state.exercise = exercise;
    state.inspectedBar = null;
    state.harmonicaOctave = harmonicaOctave;
    state.guitarOctave = guitarOctave;
    if (input.guitarPath) state.guitarPath = input.guitarPath;
    if (["compact", "notation"].includes(input.timelineView)) state.timelineView = input.timelineView;
    state.transport = { status: "stopped", playheadBeat: 0, loop: false, loopStartBar: 1, loopEndBar: exercise.bars, tempo: exercise.tempo, awaitingUserGesture: false };
  }, source);
  syncPracticeControls();
  renderPractice();
  return practiceExerciseContext();
}

function applyPracticeTuning(property, value, source = "ui") {
  const current = practiceState.exercise;
  if (!current || current[property] === value) return practiceExerciseContext();
  const candidate = { ...current, [property]: value };
  const representations = derivePracticeRepresentations(candidate);
  const remainsPlayable = representations.every(item => item.guitar && item.harmonica);

  if (!remainsPlayable) return installPracticeExercise(candidate, source);

  stopPracticePlayback(false, source);
  updatePractice(state => {
    state.exercise = candidate;
    if (state.transport.status === "playing") state.transport.status = "paused";
  }, source);
  syncPracticeControls();
  renderPractice();
  return practiceExerciseContext();
}

function practiceTotalBeats() {
  return practiceState.exercise ? practiceState.exercise.bars * 4 : 0;
}

function practiceLoopRange() {
  const bars = practiceState.exercise?.bars ?? 0;
  const startBar = Math.max(1, Math.min(bars, Number(practiceState.transport.loopStartBar) || 1));
  const endBar = Math.max(startBar, Math.min(bars, Number(practiceState.transport.loopEndBar) || bars));
  return { startBar, endBar, startBeat: (startBar - 1) * 4, endBeat: endBar * 4 };
}

function setPracticeLoopRange(changes, source = "ui") {
  const bars = practiceState.exercise?.bars ?? 0;
  const current = practiceLoopRange();
  let startBar = changes.startBar === undefined ? current.startBar : Number(changes.startBar);
  let endBar = changes.endBar === undefined ? current.endBar : Number(changes.endBar);
  if (!Number.isInteger(startBar) || startBar < 1 || startBar > bars || !Number.isInteger(endBar) || endBar < 1 || endBar > bars) {
    throw new RangeError(`Loop bars must be whole numbers from 1 to ${bars}.`);
  }
  if (changes.startBar !== undefined && startBar > endBar) endBar = startBar;
  if (changes.endBar !== undefined && endBar < startBar) startBar = endBar;
  updatePractice(state => {
    state.transport.loopStartBar = startBar;
    state.transport.loopEndBar = endBar;
    if (state.transport.loop) {
      const startBeat = (startBar - 1) * 4;
      const endBeat = endBar * 4;
      if (state.transport.playheadBeat < startBeat || state.transport.playheadBeat >= endBeat) state.transport.playheadBeat = startBeat;
    }
  }, source);
  if (["playing", "count-in"].includes(practiceState.transport.status)) {
    FretwiseAudio.stopGroup("practice");
    schedulePracticeAudio(practiceState.transport.status === "count-in" ? practiceCountIn?.endTime ?? null : null);
  }
  renderPractice();
  return practiceExerciseContext();
}

function setPracticePlayhead(beat) {
  updatePractice(state => { state.transport.playheadBeat = beat; }, "audio", false);
  syncPracticeTransport();
  updatePracticePlayhead();
}

function updatePracticePlayhead() {
  const beat = practiceState.transport.playheadBeat;
  const total = practiceTotalBeats();
  const showCurrentEvent = practiceState.transport.status === "playing" || practiceState.transport.status === "paused";
  document.querySelectorAll("#practicePanel [data-start-beat]").forEach(element => {
    const start = Number(element.dataset.startBeat);
    const duration = Number(element.dataset.soundingDurationBeats ?? element.dataset.durationBeats);
    element.classList.toggle("active", showCurrentEvent && beat >= start && beat < start + duration);
  });
  const activeIndex = showCurrentEvent ? practiceState.exercise?.melody.findIndex((event, index) =>
    beat >= event.beat && beat < event.beat + practiceSoundingDuration(event, index)
  ) ?? -1 : -1;
  const activeEvent = activeIndex >= 0 ? practiceState.exercise.melody[activeIndex] : null;
  const nextEvent = showCurrentEvent ? activeIndex >= 0
    ? practiceState.exercise?.melody[activeIndex + 1] ?? null
    : practiceState.exercise?.melody.find(event => event.beat > beat) ?? null
    : null;
  if (practiceResetPending && beat < 0.25) {
    setPracticeScrollRatio(0);
  } else if (activeEvent?.id !== practiceFollowedEventId) {
    practiceFollowedEventId = activeEvent?.id ?? null;
    followPracticeEvent(activeIndex);
  }
  if (beat >= 0.25) practiceResetPending = false;
  updatePracticeInstrument(activeEvent, nextEvent);
  $("practicePlayhead").style.width = `${total ? Math.min(100, beat / total * 100) : 0}%`;
  const shownBeat = Math.min(Math.floor(beat % 4) + 1, 4);
  const shownBar = Math.min(Math.floor(beat / 4) + 1, practiceState.exercise?.bars ?? 1);
  $("practicePosition").textContent = `Bar ${shownBar} of ${practiceState.exercise?.bars ?? 0} · beat ${shownBeat}`;
}

function followPracticeEvent(activeIndex) {
  if (activeIndex < 0) return;
  const track = document.querySelector(".practice-track");
  const event = track?.children[activeIndex];
  if (!event) return;
  const eventLeft = event.getBoundingClientRect().left - track.getBoundingClientRect().left + track.scrollLeft;
  const target = Math.max(0, eventLeft - (track.clientWidth - event.offsetWidth) / 2);
  const maximum = Math.max(1, track.scrollWidth - track.clientWidth);
  setPracticeScrollRatio(target / maximum);
}

function syncPracticeInspection() {
  document.querySelectorAll("#practicePanel [data-bar]").forEach(element => {
    const inspected = Number(element.dataset.bar) === practiceState.inspectedBar;
    element.classList.toggle("inspected", inspected);
    if (element.classList.contains("progression-event")) element.setAttribute("aria-pressed", String(inspected));
  });
}

function revealPracticeInspection() {
  if (practiceState.inspectedBar === null) return;
  const track = document.querySelector(".practice-track");
  const event = track?.querySelector(`[data-bar="${practiceState.inspectedBar}"]`);
  if (!track || !event) return;
  const eventLeft = event.getBoundingClientRect().left - track.getBoundingClientRect().left + track.scrollLeft;
  const target = Math.max(0, eventLeft - 12);
  const maximum = Math.max(1, track.scrollWidth - track.clientWidth);
  setPracticeScrollRatio(target / maximum);
}

function inspectPracticeBar(bar, source = "ui") {
  const nextBar = practiceState.inspectedBar === bar ? null : bar;
  if (!Number.isInteger(bar) || bar < 1 || bar > (practiceState.exercise?.bars ?? 0)) {
    throw new RangeError(`Inspection bar must be a whole number from 1 to ${practiceState.exercise?.bars ?? 0}.`);
  }
  updatePractice({ inspectedBar: nextBar }, source);
  syncPracticeInspection();
  if (nextBar === null) return practiceExerciseContext();
  revealPracticeInspection();
  return practiceExerciseContext();
}

function practiceScrollers() {
  return [...document.querySelectorAll("#practiceProgression, .practice-track")];
}

function setPracticeScrollRatio(ratio, source = null) {
  practiceSyncingScroll = true;
  practiceScrollers().forEach(scroller => {
    if (scroller === source) return;
    const maximum = Math.max(0, scroller.scrollWidth - scroller.clientWidth);
    scroller.scrollLeft = Math.max(0, Math.min(1, ratio)) * maximum;
  });
  requestAnimationFrame(() => { practiceSyncingScroll = false; });
}

function resetPracticeView() {
  practiceFollowedEventId = null;
  practiceResetPending = true;
  setPracticeScrollRatio(0);
  updatePracticePlayhead();
  $("practiceInstrumentStage").scrollLeft = 0;
}

function setupPracticeScrollSync() {
  practiceScrollers().forEach(scroller => {
    scroller.onscroll = () => {
      if (practiceSyncingScroll) return;
      const maximum = scroller.scrollWidth - scroller.clientWidth;
      setPracticeScrollRatio(maximum > 0 ? scroller.scrollLeft / maximum : 0, scroller);
    };
  });
}

function practiceActiveRepresentation(event, representations = null) {
  if (!event || !practiceState.exercise) return null;
  const derived = representations ?? derivePracticeRepresentations(practiceState.exercise);
  return derived.find(item => item.eventId === event.id) ?? null;
}

function updatePracticeInstrument(event, nextEvent = null) {
  const representations = practiceState.exercise ? derivePracticeRepresentations(practiceState.exercise) : [];
  const representation = practiceActiveRepresentation(event, representations);
  const nextRepresentation = practiceState.showNextNote ? practiceActiveRepresentation(nextEvent, representations) : null;
  document.querySelectorAll("#practiceInstrumentStage .active, #practiceInstrumentStage .next").forEach(element => {
    element.classList.remove("active", "next", "breath-blow", "breath-draw", "depth-0", "depth-1", "depth-2", "depth-3", "depth-4", "next-breath-blow", "next-breath-draw", "next-depth-0", "next-depth-1", "next-depth-2", "next-depth-3", "next-depth-4");
  });
  document.querySelectorAll(".practice-harp-hole strong").forEach(element => { element.textContent = ""; });
  document.querySelectorAll(".practice-harp-next, .practice-fret-next").forEach(element => { element.textContent = ""; });
  $("practiceNextReadout").textContent = "";

  if (nextRepresentation && practiceState.instrumentView === "guitar") {
    const position = nextRepresentation.guitar;
    const marker = document.querySelector(`.practice-fret[data-string="${position.string}"][data-fret="${position.fret}"]`);
    marker?.classList.add("next");
    const label = marker?.querySelector(".practice-fret-next");
    if (label) label.textContent = note(position.midi);
    $("practiceNextReadout").textContent = `Next: ${position.note} · string ${position.string}, fret ${position.fret}`;
  } else if (nextRepresentation) {
    const position = nextRepresentation.harmonica;
    const hole = document.querySelector(`.practice-harp-hole[data-hole="${position.hole}"]`);
    hole?.classList.add("next", `next-breath-${position.breath}`, `next-depth-${position.bendDepth}`);
    const tab = hole?.querySelector(".practice-harp-next");
    if (tab) tab.textContent = position.tab;
    $("practiceNextReadout").textContent = `Next: ${position.note} · ${position.tab} · ${position.technique}`;
  }

  if (!representation) {
    const transportActive = practiceState.transport.status === "playing" || practiceState.transport.status === "paused";
    $("practiceInstrumentReadout").textContent = transportActive && practiceState.transport.playheadBeat > 0 ? "Release" : "Ready at bar 1.";
    return;
  }
  if (practiceState.instrumentView === "guitar") {
    const position = representation.guitar;
    const marker = document.querySelector(`.practice-fret[data-string="${position.string}"][data-fret="${position.fret}"]`);
    marker?.classList.add("active");
    $("practiceInstrumentReadout").textContent = `${position.note} · string ${position.string}, fret ${position.fret}`;
  } else {
    const position = representation.harmonica;
    const hole = document.querySelector(`.practice-harp-hole[data-hole="${position.hole}"]`);
    hole?.classList.add("active", `breath-${position.breath}`, `depth-${position.bendDepth}`);
    const tab = hole?.querySelector("strong");
    if (tab) tab.textContent = position.tab;
    $("practiceInstrumentReadout").textContent = `${position.note} · ${position.tab} · ${position.technique}`;
  }
}

function renderPracticeInstrument() {
  const exercise = practiceState.exercise;
  if (!exercise) return;
  $("practiceGuitarView").setAttribute("aria-pressed", String(practiceState.instrumentView === "guitar"));
  $("practiceHarmonicaView").setAttribute("aria-pressed", String(practiceState.instrumentView === "harmonica"));
  $("practiceInstrumentLegend").hidden = practiceState.instrumentView !== "harmonica";
  $("practiceHarmonicaOptions").hidden = practiceState.instrumentView !== "harmonica";
  $("practiceGuitarOptions").hidden = practiceState.instrumentView !== "guitar";
  $("practiceHarmonicaOctave").value = practiceState.harmonicaOctave;
  [...$("practiceHarmonicaOctave").options].forEach(option => {
    option.disabled = deriveHarmonicaPositions(exercise, Number(option.value)).some(position => !position);
  });
  [...$("practiceGuitarOctave").options].forEach(option => {
    option.disabled = deriveGuitarPositions(exercise, Number(option.value)).some(position => !position);
  });
  if (practiceState.instrumentView === "guitar") {
    $("practiceGuitarOctave").value = practiceState.guitarOctave;
    $("practiceGuitarPath").value = practiceState.guitarPath;
    const opens = practiceGuitarOpenMidis(exercise.guitarTuning).reverse();
    $("practiceInstrumentStage").innerHTML = `<div class="practice-fretboard-view">
      <div class="practice-fret-corner">String</div>${Array.from({ length: 13 }, (_, fret) =>
        `<div class="practice-fret-number ${[3, 5, 7, 9, 12].includes(fret) ? "landmark" : ""}">${fret}</div>`
      ).join("")}${opens.map((openMidi, index) => {
      const string = index + 1;
      return `<div class="practice-string-label">${string} · ${note(openMidi)}</div>${Array.from({ length: 13 }, (_, fret) =>
        `<div class="practice-fret ${fret === 0 ? "nut" : ""} ${[3, 5, 7, 9].includes(fret) && string === 3 ? "single-inlay" : ""} ${fret === 12 && [2, 4].includes(string) ? "double-inlay" : ""}" data-string="${string}" data-fret="${fret}" data-note="${note(openMidi + fret)}" title="String ${string}, fret ${fret}: ${midiName(openMidi + fret)}"><span class="practice-fret-next"></span></div>`
      ).join("")}`;
    }).join("")}</div>`;
  } else {
    $("practiceInstrumentLegend").innerHTML = `
      <span><i class="breath-blow depth-0"></i>Blow</span>
      <span><i class="breath-blow depth-1"></i>Blow bend</span>
      <span><i class="breath-blow depth-2"></i>Blow deep bend</span>
      <span><i class="breath-draw depth-0"></i>Draw</span>
      <span><i class="breath-draw depth-1"></i>Draw bend</span>
      <span><i class="breath-draw depth-2"></i>Draw deeper</span>
      <span><i class="breath-draw depth-3"></i>Draw deepest</span>`;
    $("practiceInstrumentStage").innerHTML = `<div class="practice-harp-view">${Array.from({ length: 10 }, (_, index) => `
      <div class="practice-harp-position"><span>${index + 1}</span><div class="practice-harp-hole" data-hole="${index + 1}"><strong></strong><small class="practice-harp-next"></small></div></div>`).join("")}</div>`;
  }
  $("practiceNextPreview").checked = practiceState.showNextNote;
}

function setPracticeInstrumentView(view, source = "ui") {
  updatePractice({ instrumentView: view }, source);
  renderPracticeInstrument();
  updatePracticePlayhead();
  revealPracticeInspection();
  rescheduleActivePracticeAudio();
  return practiceExerciseContext();
}

function setPracticeTimelineView(view, source = "ui") {
  if (!["compact", "notation"].includes(view)) return practiceExerciseContext();
  updatePractice({ timelineView: view }, source);
  renderPractice();
  return practiceExerciseContext();
}

function rescheduleActivePracticeAudio() {
  if (!["playing", "count-in"].includes(practiceState.transport.status)) return;
  FretwiseAudio.stopGroup("practice");
  schedulePracticeAudio(practiceState.transport.status === "count-in" ? practiceCountIn?.endTime ?? null : null);
}

function setPracticeHarmonicaOctave(value, source = "ui") {
  const octave = Number(value);
  const allowed = [0, 1, 2].includes(octave);
  const playable = allowed && deriveHarmonicaPositions(practiceState.exercise, octave).every(Boolean);
  if (!playable) {
    $("practiceInstrumentReadout").textContent = "That octave is outside this harmonica's playable holes.";
    renderPracticeInstrument();
    return practiceExerciseContext();
  }
  updatePractice({ harmonicaOctave: octave }, source);
  renderPractice();
  rescheduleActivePracticeAudio();
  return practiceExerciseContext();
}

function setPracticeGuitarProjection(property, value, source = "ui") {
  const previous = practiceState[property];
  if (property === "guitarOctave" && ![0, -1, -2].includes(Number(value))) return practiceExerciseContext();
  updatePractice({ [property]: value }, source);
  if (deriveGuitarPositions(practiceState.exercise).some(position => !position)) {
    updatePractice({ [property]: previous }, source, false);
    $("practiceInstrumentReadout").textContent = "That octave is outside this tuning's visible 0–12 fret range.";
    renderPracticeInstrument();
    return practiceExerciseContext();
  }
  renderPractice();
  rescheduleActivePracticeAudio();
  return practiceExerciseContext();
}

function setPracticeProjection(options, source = "ui") {
  for (const property of ["harpKey", "harpTuning", "guitarTuning"]) {
    if (options[property] !== undefined) applyPracticeTuning(property, options[property], source);
  }
  if (options.harmonicaOctave !== undefined) setPracticeHarmonicaOctave(options.harmonicaOctave, source);
  if (options.guitarOctave !== undefined) setPracticeGuitarProjection("guitarOctave", options.guitarOctave, source);
  if (options.guitarPath !== undefined) setPracticeGuitarProjection("guitarPath", options.guitarPath, source);
  if (options.instrumentView !== undefined) setPracticeInstrumentView(options.instrumentView, source);
  if (options.timelineView !== undefined) setPracticeTimelineView(options.timelineView, source);
  if (options.showNextNote !== undefined) {
    updatePractice({ showNextNote: options.showNextNote }, source);
    renderPracticeInstrument();
    updatePracticePlayhead();
  }
  return practiceExerciseContext();
}

function practiceScheduledEvents() {
  const loopRange = practiceLoopRange();
  const startBeat = practiceState.transport.playheadBeat;
  const octave = practiceState.instrumentView === "harmonica" ? practiceState.harmonicaOctave : practiceState.guitarOctave;
  return practiceState.exercise.melody.map((event, index) => ({
    ...event,
    midi: event.midi + octave * 12,
    soundingDurationBeats: practiceSoundingDuration(event, index)
  })).filter(event => event.beat + event.durationBeats > startBeat && (!practiceState.transport.loop || event.beat < loopRange.endBeat));
}

function practiceBackingChordEvents() {
  if (!practiceState.exercise) return [];
  const loopRange = practiceLoopRange();
  const startBeat = practiceState.transport.playheadBeat;
  const durationBeats = 4 / practiceState.backingStrumsPerBar;
  const offsets = Array.from({ length: practiceState.backingStrumsPerBar }, (_, index) => index * durationBeats);
  return practiceState.exercise.progression.flatMap(chord => {
    const positions = practiceChordVoicing(chord, practiceState.exercise.guitarTuning);
    return offsets.map((offset, strumIndex) => ({
      id: `chord-${chord.bar}-${strumIndex + 1}`,
      beat: chord.startBeat + offset,
      durationBeats,
      strumIndex,
      chordSymbol: chord.chordSymbol,
      positions,
      midis: positions.map(position => position.midi)
    }));
  }).filter(event => event.beat + event.durationBeats > startBeat && (!practiceState.transport.loop || event.beat < loopRange.endBeat));
}

function schedulePracticeAudio(startTime = null) {
  const melodyEvents = practiceState.melodyMuted ? [] : practiceScheduledEvents();
  const schedule = FretwiseAudio.scheduleMelody(melodyEvents, {
    tempo: practiceState.transport.tempo,
    startBeat: practiceState.transport.playheadBeat,
    seed: practiceState.exercise.seed,
    instrument: practiceState.instrumentView,
    group: "practice",
    startTime: startTime ?? undefined
  });
  if (!practiceState.backingMuted) {
    FretwiseAudio.scheduleChordProgression(practiceBackingChordEvents(), {
      tempo: practiceState.transport.tempo,
      startBeat: practiceState.transport.playheadBeat,
      seed: practiceState.exercise.seed,
      instrument: practiceState.backingInstrument,
      group: "practice",
      startTime: schedule.startTime ?? undefined
    });
  }
  const secondsPerBeat = 60 / practiceState.transport.tempo;
  const clock = schedule.startTime ?? performance.now() / 1000;
  practiceStartedAt = clock - practiceState.transport.playheadBeat * secondsPerBeat;
}

function practiceTick(timestamp) {
  if (!["count-in", "playing"].includes(practiceState.transport.status)) return;
  const clock = FretwiseAudio.currentTime() ?? timestamp / 1000;
  if (practiceState.transport.status === "count-in") {
    const elapsedBeats = Math.max(0, Math.floor((clock - practiceCountIn.startTime) / practiceCountIn.secondsPerBeat));
    const remaining = Math.max(1, practiceCountIn.beats - elapsedBeats);
    $("practicePosition").textContent = `Count in · ${remaining}`;
    $("practicePosition").classList.add("counting-in");
    if (clock < practiceCountIn.endTime) {
      practiceAnimation = requestAnimationFrame(practiceTick);
      return;
    }
    updatePractice(state => { state.transport.status = "playing"; }, "audio", false);
    practiceCountIn = null;
    $("practicePosition").classList.remove("counting-in");
    syncPracticeTransport();
  }
  let beat = (clock - practiceStartedAt) * practiceState.transport.tempo / 60;
  const total = practiceTotalBeats();
  const loopRange = practiceLoopRange();
  const playbackEnd = practiceState.transport.loop ? loopRange.endBeat : total;
  if (beat >= playbackEnd) {
    if (!practiceState.transport.loop) {
      updatePractice(state => {
        state.transport.status = "stopped";
        state.transport.playheadBeat = total;
      }, "audio", false);
      syncPracticeTransport();
      updatePracticePlayhead();
      return;
    }
    beat = loopRange.startBeat + (beat - loopRange.startBeat) % (loopRange.endBeat - loopRange.startBeat);
    setPracticePlayhead(beat);
    schedulePracticeAudio();
  } else {
    setPracticePlayhead(beat);
  }
  practiceAnimation = requestAnimationFrame(practiceTick);
}

function startPracticePlayback(source = "ui") {
  if (!practiceState.exercise) return;
  if (source !== "ui" && !practiceAgentPlaybackAllowed) {
    updatePractice(state => {
      state.transport.status = "awaiting-gesture";
      state.transport.awaitingUserGesture = true;
    }, source);
    syncPracticeTransport();
    return;
  }
  const loopRange = practiceLoopRange();
  if (practiceState.transport.loop && (practiceState.transport.playheadBeat < loopRange.startBeat || practiceState.transport.playheadBeat >= loopRange.endBeat)) {
    practiceState.transport.playheadBeat = loopRange.startBeat;
  } else if (practiceState.transport.playheadBeat >= practiceTotalBeats()) {
    practiceState.transport.playheadBeat = 0;
  }
  updatePractice(state => {
    state.transport.status = "count-in";
    state.transport.awaitingUserGesture = false;
  }, source);
  updatePracticePlayhead();
  const beats = 4;
  const secondsPerBeat = 60 / practiceState.transport.tempo;
  const scheduledCountIn = FretwiseAudio.scheduleCountIn({ beats, tempo: practiceState.transport.tempo, group: "practice-count-in" });
  const fallbackStart = performance.now() / 1000 + 0.04;
  practiceCountIn = {
    beats,
    secondsPerBeat,
    startTime: scheduledCountIn.startTime ?? fallbackStart,
    endTime: scheduledCountIn.endTime ?? fallbackStart + beats * secondsPerBeat
  };
  $("practicePosition").textContent = `Count in · ${beats}`;
  $("practicePosition").classList.add("counting-in");
  schedulePracticeAudio(practiceCountIn.endTime);
  cancelAnimationFrame(practiceAnimation);
  practiceAnimation = requestAnimationFrame(practiceTick);
  syncPracticeTransport();
}

function stopPracticePlayback(record = true, source = "ui") {
  FretwiseAudio.stopGroup("practice");
  FretwiseAudio.stopGroup("practice-count-in");
  cancelAnimationFrame(practiceAnimation);
  practiceAnimation = null;
  const cancelledInitialCountIn = practiceState.transport.status === "count-in" && practiceState.transport.playheadBeat === 0;
  practiceCountIn = null;
  $("practicePosition")?.classList.remove("counting-in");
  if (["playing", "count-in", "awaiting-gesture"].includes(practiceState.transport.status)) {
    updatePractice(state => {
      state.transport.status = cancelledInitialCountIn ? "stopped" : "paused";
      state.transport.awaitingUserGesture = false;
    }, source, record);
  }
  syncPracticeTransport();
  updatePracticePlayhead();
}

function stepPractice(direction, source = "ui") {
  stopPracticePlayback(false, source);
  const beats = [...new Set(practiceState.exercise.melody.map(event => event.beat))];
  const current = practiceState.transport.playheadBeat;
  const next = direction > 0 ? beats.find(beat => beat > current + 0.001) ?? practiceTotalBeats() : [...beats].reverse().find(beat => beat < current - 0.001) ?? 0;
  updatePractice(state => {
    state.transport.status = "paused";
    state.transport.playheadBeat = next;
  }, source);
  syncPracticeTransport();
  updatePracticePlayhead();
}

function setPracticeTempo(tempo, source = "ui") {
  const wasActive = ["playing", "count-in"].includes(practiceState.transport.status);
  if (wasActive) stopPracticePlayback(false, source);
  updatePractice(state => {
    state.transport.tempo = Number(tempo);
    state.exercise.tempo = Number(tempo);
  }, source);
  $("practiceTempo").value = tempo;
  if (wasActive) startPracticePlayback(source);
  syncPracticeTransport();
}

function controlPracticeTransport(action, options = {}) {
  const source = options.source ?? "ui";
  if (options.tempo !== undefined) setPracticeTempo(options.tempo, source);
  if (action === "play") startPracticePlayback(source);
  if (action === "pause") stopPracticePlayback(true, source);
  if (action === "restart") {
    const wasPlaying = ["playing", "count-in"].includes(practiceState.transport.status);
    stopPracticePlayback(false, source);
    updatePractice(state => {
      state.transport.status = "stopped";
      state.transport.playheadBeat = state.transport.loop ? (state.transport.loopStartBar - 1) * 4 : 0;
      state.transport.awaitingUserGesture = false;
    }, source);
    resetPracticeView();
    if (wasPlaying) startPracticePlayback(source);
  }
  if (action === "next") stepPractice(1, source);
  if (action === "previous") stepPractice(-1, source);
  if (action === "loop") {
    const hasBounds = options.startBar !== undefined || options.endBar !== undefined;
    if (hasBounds) {
      setPracticeLoopRange({ startBar: options.startBar, endBar: options.endBar }, source);
    }
    updatePractice(state => {
      if (options.enabled !== undefined) {
        state.transport.loop = options.enabled;
      } else if (hasBounds) {
        state.transport.loop = true;
      } else {
        state.transport.loop = !state.transport.loop;
      }
      if (state.transport.loop) {
        const range = practiceLoopRange();
        if (state.transport.playheadBeat < range.startBeat || state.transport.playheadBeat >= range.endBeat) state.transport.playheadBeat = range.startBeat;
      }
    }, source);
    if (["playing", "count-in"].includes(practiceState.transport.status)) {
      FretwiseAudio.stopGroup("practice");
      schedulePracticeAudio(practiceState.transport.status === "count-in" ? practiceCountIn?.endTime ?? null : null);
    }
    renderPractice();
  }
  if (action === "backing") {
    const change = {};
    if (options.enabled !== undefined) change.backingMuted = !options.enabled;
    if (options.instrument !== undefined) {
      if (!["guitar", "piano"].includes(options.instrument)) throw new RangeError("Backing instrument must be guitar or piano.");
      change.backingInstrument = options.instrument;
    }
    if (options.strumsPerBar !== undefined) {
      const strumsPerBar = Number(options.strumsPerBar);
      if (![1, 2, 4].includes(strumsPerBar)) throw new RangeError("Backing strums per bar must be 1, 2, or 4.");
      change.backingStrumsPerBar = strumsPerBar;
    }
    if (options.enabled === undefined && options.instrument === undefined && options.strumsPerBar === undefined) change.backingMuted = !practiceState.backingMuted;
    updatePractice(change, source);
    if (change.backingInstrument === "piano") FretwiseAudio.preparePiano();
    if (change.backingInstrument === "guitar") FretwiseAudio.prepareGuitar();
    rescheduleActivePracticeAudio();
  }
  if (action === "melody") {
    updatePractice({ melodyMuted: options.enabled === undefined ? !practiceState.melodyMuted : !options.enabled }, source);
    rescheduleActivePracticeAudio();
  }
  syncPracticeTransport();
  return practiceExerciseContext();
}

function syncPracticeControls() {
  const exercise = practiceState.exercise;
  if (!exercise) return;
  for (const key of ["seed", "key", "level", "style", "bars", "tempo", "harpKey", "harpTuning", "guitarTuning"]) {
    $(`practice${key[0].toUpperCase()}${key.slice(1)}`).value = exercise[key];
  }
}

function practicePlayButtonPresentation(status) {
  return {
    stopped: { label: "Play", action: "Start practice playback" },
    "awaiting-gesture": { label: "Play", action: "Start audio playback" },
    "count-in": { label: "Cancel", action: "Cancel count-in" },
    playing: { label: "Pause", action: "Pause practice playback" },
    paused: { label: "Resume", action: "Resume practice playback" }
  }[status] ?? { label: "Play", action: "Start practice playback" };
}

function syncPracticeTransport() {
  if (!$("practicePlay")) return;
  const transport = practiceState.transport;
  const loopRange = practiceLoopRange();
  const playButton = practicePlayButtonPresentation(transport.status);
  $("practicePlay").textContent = playButton.label;
  $("practicePlay").dataset.status = transport.status;
  $("practicePlay").setAttribute("aria-label", playButton.action);
  $("practiceLoop").setAttribute("aria-pressed", String(transport.loop));
  $("practiceLoop").classList.toggle("active", transport.loop);
  $("practiceBackingMute").textContent = practiceState.backingMuted ? "Unmute chords" : "Mute chords";
  $("practiceBackingMute").setAttribute("aria-label", practiceState.backingMuted ? "Unmute backing chords" : "Mute backing chords");
  $("practiceBackingMute").setAttribute("aria-pressed", String(practiceState.backingMuted));
  $("practiceMelodyMute").textContent = practiceState.melodyMuted ? "Unmute melody" : "Mute melody";
  $("practiceMelodyMute").setAttribute("aria-label", practiceState.melodyMuted ? "Unmute shared melody" : "Mute shared melody");
  $("practiceMelodyMute").setAttribute("aria-pressed", String(practiceState.melodyMuted));
  $("practiceBackingInstrument").value = practiceState.backingInstrument;
  $("practiceBackingRhythm").value = practiceState.backingStrumsPerBar;
  $("practiceLoopStart").value = loopRange.startBar;
  $("practiceLoopEnd").value = loopRange.endBar;
  $("practiceLoopStart").setAttribute("aria-describedby", "practicePosition");
  $("practiceLoopEnd").setAttribute("aria-describedby", "practicePosition");
  if (practiceState.exercise) {
    const exercise = practiceState.exercise;
    $("practiceSummary").textContent = `${exercise.level} · ${exercise.bars} bars · ${transport.tempo} BPM · ${exercise.harpKey} ${exercise.harpTuning} · ${exercise.guitarTuning}`;
  }
  if (transport.status === "awaiting-gesture") $("practicePosition").textContent = "Press Play to allow audio in this browser.";
}

function renderPractice() {
  const exercise = practiceState.exercise;
  if (!exercise) return;
  const loopRange = practiceLoopRange();
  const loopOptions = Array.from({ length: exercise.bars }, (_, index) => `<option value="${index + 1}">${index + 1}</option>`).join("");
  $("practiceLoopStart").innerHTML = loopOptions;
  $("practiceLoopEnd").innerHTML = loopOptions;
  const representations = derivePracticeRepresentations(exercise).map((item, index) => ({
    ...item,
    soundingDurationBeats: practiceSoundingDuration(exercise.melody[index], index)
  }));
  $("practiceTitle").textContent = `${exercise.key} ${exercise.style === "blues" ? "blues" : exercise.style} lesson`;
  $("practiceSummary").textContent = `${exercise.level} · ${exercise.bars} bars · ${practiceState.transport.tempo} BPM · ${exercise.harpKey} ${exercise.harpTuning} · ${exercise.guitarTuning}`;
  const brief = practiceLessonBrief(exercise);
  const position = brief.setup.position ? ` · ${brief.setup.position}` : "";
  const techniqueSummary = brief.harmonica.techniques.map(item => `${item.name} ${item.count}`).join(" · ");
  const dominantHoles = brief.harmonica.dominantHoles.map(item => item.hole).join(", ");
  $("practiceBrief").innerHTML = `
    <div><small>Setup</small><strong>${brief.setup.key} ${brief.setup.style}</strong><span>${brief.setup.harpKey} ${brief.setup.harpTuning}${position} · ${brief.setup.level}</span></div>
    <div><small>Form</small><strong>${brief.form.chords.join(" · ")}</strong><span>${brief.form.eventCount} notes · ${brief.form.eventsPerBeat} per beat · ${brief.melody.lowestNote}–${brief.melody.highestNote} · ${brief.melody.uniquePitchCount} pitches</span></div>
    <div><small>Harmonica</small><strong>Focus holes ${dominantHoles}</strong><span>${techniqueSummary}</span></div>
    <div><small>Guitar</small><strong>Frets ${brief.guitar.minimumFret}–${brief.guitar.maximumFret}</strong><span>Largest move ${brief.guitar.maximumFretShift} frets · ${brief.guitar.stringChanges} string changes</span></div>`;
  $("practiceFocus").innerHTML = `<strong>Practice focus</strong><span>${brief.focus}</span>`;
  $("practiceProgression").innerHTML = exercise.progression.map(chord => `
    <button type="button" class="progression-event ${chord.bar >= loopRange.startBar && chord.bar <= loopRange.endBar ? "loop-selected" : ""} ${practiceState.transport.loop ? "loop-enabled" : ""}" data-start-beat="${chord.startBeat}" data-duration-beats="${chord.durationBeats}" data-bar="${chord.bar}" aria-pressed="${practiceState.inspectedBar === chord.bar}" aria-label="Inspect bar ${chord.bar}, ${chord.chordSymbol}">
      <small>Bar ${chord.bar} · ${chord.degree}</small><strong>${chord.chordSymbol}</strong>
    </button>`).join("");
  $("practiceTracks").innerHTML = practiceState.timelineView === "notation"
    ? renderPracticeNotationTracks(representations, exercise)
    : renderPracticeCompactTracks(representations);
  $("practiceCompactTimeline").setAttribute("aria-pressed", String(practiceState.timelineView === "compact"));
  $("practiceNotationTimeline").setAttribute("aria-pressed", String(practiceState.timelineView === "notation"));
  document.querySelectorAll("#practiceProgression .progression-event").forEach(element => {
    element.onclick = () => inspectPracticeBar(Number(element.dataset.bar));
  });
  practiceFollowedEventId = null;
  renderPracticeInstrument();
  setupPracticeScrollSync();
  syncPracticeTransport();
  updatePracticePlayhead();
  syncPracticeInspection();
  revealPracticeInspection();
}

function practiceWebMCPTools() {
  return [
    {
      name: "generate_practice_exercise",
      title: "Generate practice exercise",
      description: "Use this when Practice is the active tab or the user explicitly names Practice or the current lesson to create one complete deterministic guitar-and-harmonica exercise, optionally request a playable harmonica octave 0/+1/+2, guitar octave 0/-1/-2, and Compact or Score + TAB timeline, and return canonical events, derived representations, and available projection options. Practice guitar tuning is independent from the standalone Fretboard explorer. This tool does not switch tabs; if the user explicitly asks to switch to Practice, call switch_workspace_view first. An unavailable requested octave falls back to 0 without transposing canonical MIDI.",
      inputSchema: {
        type: "object",
        required: ["key", "level", "style", "bars", "tempo", "harpKey"],
        properties: {
          seed: { type: "integer", minimum: 0, maximum: 2147483647 },
          key: { type: "string", enum: N },
          level: { type: "string", enum: Object.keys(PRACTICE_LEVELS) },
          style: { type: "string", enum: Object.keys(PRACTICE_STYLES) },
          bars: { type: "integer", enum: [4, 8, 12] },
          tempo: { type: "integer", minimum: 40, maximum: 180 },
          harpKey: { type: "string", enum: N },
          harpTuning: { type: "string", enum: Object.keys(HARP_TUNINGS) },
          guitarTuning: { type: "string", enum: Object.keys(TUNINGS) },
          harmonicaOctave: { type: "integer", enum: [0, 1, 2] },
          guitarOctave: { type: "integer", enum: [0, -1, -2] },
          guitarPath: { type: "string", enum: ["vertical", "horizontal"] },
          timelineView: { type: "string", enum: ["compact", "notation"] }
        },
        additionalProperties: false
      },
      execute: async args => {
        installPracticeExercise(args, "webmcp");
        return practiceExerciseContext();
      }
    },
    {
      name: "get_practice_exercise",
      title: "Get practice exercise",
      description: "Use this read-only tool to inspect the current canonical progression and MIDI melody, derived guitar/harmonica positions, Compact or Score + TAB timeline state, available octave projections, deterministic lesson brief, transport state, and the active instrument view. Because Practice state can change through direct UI actions, confirm the current state with this tool before telling the user that a requested view or projection is already set.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: true },
      execute: async () => practiceExerciseContext()
    },
    {
      name: "set_practice_projection",
      title: "Set practice projection",
      description: "Use this when Practice is the active tab or the user explicitly names Practice or the current lesson to change its guitar tuning, Harp setup, playable octaves, guitar path, visible instrument, Compact or Score + TAB timeline, or next-note preview without requesting a new lesson. Never use set_fretboard_context for Practice guitar tuning, and never mirror this tuning to the standalone Fretboard explorer unless the user explicitly asks to change both. This tool is idempotent and safe to call repeatedly: Practice state can change through direct UI actions and other tools at any time, so when the user asks to switch a view or projection, call this tool (or first confirm the current state with get_practice_exercise) rather than replying that it is already set from memory. This tool does not switch tabs; if the user explicitly asks to switch to Practice, call switch_workspace_view first. An octave is applied only when every note exists on that instrument; otherwise the current projection is preserved.",
      inputSchema: {
        type: "object",
        properties: {
          harpKey: { type: "string", enum: N },
          harpTuning: { type: "string", enum: Object.keys(HARP_TUNINGS) },
          guitarTuning: { type: "string", enum: Object.keys(TUNINGS) },
          harmonicaOctave: { type: "integer", enum: [0, 1, 2] },
          guitarOctave: { type: "integer", enum: [0, -1, -2] },
          guitarPath: { type: "string", enum: ["vertical", "horizontal"] },
          instrumentView: { type: "string", enum: ["guitar", "harmonica"] },
          timelineView: { type: "string", enum: ["compact", "notation"] },
          showNextNote: { type: "boolean" }
        },
        additionalProperties: false
      },
      execute: async options => {
        return setPracticeProjection(options, "webmcp");
      }
    },
    {
      name: "control_practice_transport",
      title: "Control practice transport",
      description: "Use this when Practice is the active tab or the user explicitly names Practice or the current lesson to navigate, loop, pause, play, change tempo, configure its deterministic chord backing layer, or mute the shared melody. This tool does not switch tabs; if the user explicitly asks to switch to Practice, call switch_workspace_view first. For action loop, explicit startBar/endBar bounds enable looping over that phrase and are idempotent (repeating the same request keeps it enabled); a bare loop call toggles; enabled overrides either. Backing starts enabled with piano selected. For action backing, enabled controls mute state, instrument selects guitar or piano, and strumsPerBar selects 1 whole-bar, 2 half-bar, or 4 quarter-note chord attacks. For action melody, enabled controls the shared-melody mute state (the melody starts audible); a bare melody call toggles it for backing-only practice. Agent play requests start audio only after the user enables page-session agent playback; otherwise they wait for a direct Play press.",
      inputSchema: {
        type: "object",
        required: ["action"],
        properties: {
          action: { type: "string", enum: ["play", "pause", "restart", "next", "previous", "loop", "tempo", "backing", "melody"] },
          enabled: { type: "boolean" },
          startBar: { type: "integer", minimum: 1, maximum: 12 },
          endBar: { type: "integer", minimum: 1, maximum: 12 },
          tempo: { type: "integer", minimum: 40, maximum: 180 },
          instrument: { type: "string", enum: ["guitar", "piano"] },
          strumsPerBar: { type: "integer", enum: [1, 2, 4] }
        },
        additionalProperties: false
      },
      execute: async ({ action, ...options }) => {
        return controlPracticeTransport(action, { ...options, source: "webmcp" });
      }
    }
  ];
}

function setupPractice() {
  for (const id of ["practiceKey", "practiceHarpKey"]) $(id).innerHTML = N.map(name => `<option>${name}</option>`).join("");
  fill("practiceHarpTuning", HARP_TUNINGS);
  fill("practiceGuitarTuning", TUNINGS);
  $("generatePractice").onclick = () => installPracticeExercise({
    seed: Number($("practiceSeed").value),
    key: $("practiceKey").value,
    level: $("practiceLevel").value,
    style: $("practiceStyle").value,
    bars: Number($("practiceBars").value),
    tempo: Number($("practiceTempo").value),
    harpKey: $("practiceHarpKey").value,
    harpTuning: $("practiceHarpTuning").value,
    guitarTuning: $("practiceGuitarTuning").value
  });
  $("practicePlay").onclick = () => ["playing", "count-in"].includes(practiceState.transport.status) ? stopPracticePlayback() : startPracticePlayback();
  $("practiceRestart").onclick = () => controlPracticeTransport("restart");
  $("practicePrevious").onclick = () => controlPracticeTransport("previous");
  $("practiceNext").onclick = () => controlPracticeTransport("next");
  $("practiceLoop").onclick = () => controlPracticeTransport("loop");
  $("practiceBackingMute").onclick = () => controlPracticeTransport("backing");
  $("practiceMelodyMute").onclick = () => controlPracticeTransport("melody");
  $("practiceBackingInstrument").onchange = event => controlPracticeTransport("backing", { instrument: event.target.value });
  $("practiceBackingRhythm").onchange = event => controlPracticeTransport("backing", { strumsPerBar: Number(event.target.value) });
  $("practiceLoopStart").onchange = event => setPracticeLoopRange({ startBar: Number(event.target.value) });
  $("practiceLoopEnd").onchange = event => setPracticeLoopRange({ endBar: Number(event.target.value) });
  $("practiceAgentPlayback").onchange = event => setPracticeAgentPlaybackAllowed(event.target.checked);
  $("practiceAgentPlayback").disabled = !FretwiseAudio.status().available;
  $("practiceGuitarView").onclick = () => setPracticeInstrumentView("guitar");
  $("practiceHarmonicaView").onclick = () => setPracticeInstrumentView("harmonica");
  $("practiceCompactTimeline").onclick = () => setPracticeTimelineView("compact");
  $("practiceNotationTimeline").onclick = () => setPracticeTimelineView("notation");
  $("practiceNextPreview").onchange = event => {
    updatePractice({ showNextNote: event.target.checked });
    updatePracticePlayhead();
  };
  $("practiceHarmonicaOctave").onchange = event => setPracticeHarmonicaOctave(Number(event.target.value));
  $("practiceGuitarOctave").onchange = event => setPracticeGuitarProjection("guitarOctave", Number(event.target.value));
  $("practiceGuitarPath").onchange = event => setPracticeGuitarProjection("guitarPath", event.target.value);
  $("practiceTempo").onchange = event => setPracticeTempo(Number(event.target.value));
  $("practiceHarpKey").onchange = event => applyPracticeTuning("harpKey", event.target.value);
  $("practiceHarpTuning").onchange = event => applyPracticeTuning("harpTuning", event.target.value);
  $("practiceGuitarTuning").onchange = event => applyPracticeTuning("guitarTuning", event.target.value);
  installPracticeExercise(PRACTICE_DEFAULTS, "setup");
}

setupPractice();