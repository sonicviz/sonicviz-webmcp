const N = ["C", "C♯", "D", "E♭", "E", "F", "F♯", "G", "A♭", "A", "B♭", "B"];

const TUNINGS = {
  "Standard (E A D G B E)": [4, 9, 2, 7, 11, 4],
  "Drop D (D A D G B E)": [2, 9, 2, 7, 11, 4],
  DADGAD: [2, 9, 2, 7, 9, 2],
  "Open G (D G D G B D)": [2, 7, 2, 7, 11, 2],
  "Open D (D A D F♯ A D)": [2, 9, 2, 6, 9, 2]
};

const CHORDS = {
  Major: [0, 4, 7],
  Minor: [0, 3, 7],
  Augmented: [0, 4, 8],
  "Dominant 7": [0, 4, 7, 10],
  "Major 7": [0, 4, 7, 11],
  "Minor 7": [0, 3, 7, 10],
  "Sus 4": [0, 5, 7],
  Diminished: [0, 3, 6]
};

const SCALES = {
  "Major / Ionian": [0, 2, 4, 5, 7, 9, 11],
  "Natural minor / Aeolian": [0, 2, 3, 5, 7, 8, 10],
  "Harmonic minor": [0, 2, 3, 5, 7, 8, 11],
  Dorian: [0, 2, 3, 5, 7, 9, 10],
  Phrygian: [0, 1, 3, 5, 7, 8, 10],
  Mixolydian: [0, 2, 4, 5, 7, 9, 10],
  "Major pentatonic": [0, 2, 4, 7, 9],
  "Minor pentatonic": [0, 3, 5, 7, 10],
  Blues: [0, 3, 5, 6, 7, 10]
};

const $ = id => document.getElementById(id);
const mod = value => (value + 12) % 12;
const note = value => N[mod(value)];

function intervalName(semitones) {
  return ["1", "♭2", "2", "♭3", "3", "4", "♯4 / ♭5", "5", "♭6", "6", "♭7", "7"][mod(semitones)];
}

function fill(id, values) {
  $(id).innerHTML = Object.keys(values).map(value => `<option>${value}</option>`).join("");
}

function theoryToneSummary(root, intervals) {
  return intervals.map(interval =>
    `<span class="theory-tone interval-${interval}"><b>${note(root + interval)}</b><small>${intervalName(interval)}</small></span>`
  ).join("");
}

function intervalLegendMarkup() {
  return Array.from({ length: 12 }, (_, interval) =>
    `<span class="interval-swatch interval-${interval}">${intervalName(interval)}</span>`
  ).join("");
}

function diatonicTriads(root, scaleIntervals) {
  if (scaleIntervals.length !== 7) return [];
  const roman = ["I", "II", "III", "IV", "V", "VI", "VII"];
  const qualities = {
    "0,4,7": { chord: "Major", suffix: "", degreeSuffix: "" },
    "0,3,7": { chord: "Minor", suffix: "m", degreeSuffix: "" },
    "0,3,6": { chord: "Diminished", suffix: "°", degreeSuffix: "°" },
    "0,4,8": { chord: "Augmented", suffix: "+", degreeSuffix: "+" }
  };

  return scaleIntervals.map((rootOffset, index) => {
    const thirdIndex = index + 2;
    const fifthIndex = index + 4;
    const third = scaleIntervals[thirdIndex % 7] + (thirdIndex >= 7 ? 12 : 0) - rootOffset;
    const fifth = scaleIntervals[fifthIndex % 7] + (fifthIndex >= 7 ? 12 : 0) - rootOffset;
    const quality = qualities[`0,${third},${fifth}`];
    if (!quality) return null;
    const degree = quality.chord === "Minor" || quality.chord === "Diminished" ? roman[index].toLowerCase() : roman[index];
    const chordRoot = mod(root + rootOffset);
    return {
      root: chordRoot,
      chord: quality.chord,
      symbol: `${note(chordRoot)}${quality.suffix}`,
      degree: `${degree}${quality.degreeSuffix}`
    };
  }).filter(Boolean);
}

function renderQuickChords(elementId, root, scaleName, selectedRoot, selectedChord, chordVisible, onSelect) {
  const container = $(elementId);
  const triads = diatonicTriads(root, SCALES[scaleName]);
  container.replaceChildren();
  if (!triads.length) {
    container.hidden = true;
    return;
  }

  container.hidden = false;
  const heading = document.createElement("div");
  heading.className = "quick-chord-heading";
  heading.textContent = `${note(root)} ${scaleName} chords`;
  const buttons = document.createElement("div");
  buttons.className = "quick-chord-buttons";
  triads.forEach(triad => {
    const button = document.createElement("button");
    const selected = chordVisible && triad.root === selectedRoot && triad.chord === selectedChord;
    button.type = "button";
    button.className = `quick-chord quality-${triad.chord.toLowerCase()}`;
    button.classList.toggle("active", selected);
    button.setAttribute("aria-pressed", String(selected));
    button.setAttribute("aria-label", `Show ${triad.symbol}, ${triad.degree} chord`);
    button.innerHTML = `<strong>${triad.symbol}</strong><small>${triad.degree}</small>`;
    button.onclick = () => onSelect(triad);
    buttons.append(button);
  });
  container.append(heading, buttons);
}