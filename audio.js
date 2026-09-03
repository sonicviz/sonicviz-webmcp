const FretwiseAudio = (() => {
  let context;
  let output;
  let directOutput;
  const scheduledSources = new Map();
  const groupGenerations = new Map();
  const roomEffect = Object.freeze({ decaySeconds: 0.82, preDelaySeconds: 0.014, wetGain: 0.11 });
  const instrumentMix = Object.freeze({ sampledGuitarGain: 0.24, sampledHarmonicaGain: 0.42, sampledPianoGain: 0.36, guitarHighpassHz: 70 });
  const harmonicaLibrary = Object.freeze({
    id: "versilian",
    name: "VCSL C Diatonic Harmonica",
    license: "CC0-1.0",
    sampleCount: 9,
    encodedBytes: 993514,
    midiRange: Object.freeze([60, 96]),
    maxPitchShiftSemitones: 4
  });
  const harmonicaSampleDefinitions = Object.freeze([
    [60, 7.9], [64, 5.6], [72, 6.4], [76, 8.7], [79, 4.9],
    [84, 5.3], [88, 0], [91, -0.9], [96, -3.4]
  ].map(([midi, gainDb]) => Object.freeze({ midi, gainDb, url: `assets/harmonica/vcsl-special20-c/${midi}.flac` })));
  const harmonicaSamples = new Map();
  let harmonicaSamplePromise = null;
  let harmonicaSampleError = null;
  const guitarLibrary = Object.freeze({
    name: "FSS Steel-String Acoustic Guitar",
    license: "GPL-3.0-or-later",
    licenseException: "FreePats sound-sample exception",
    sampleCount: 8,
    encodedBytes: 885637,
    midiRange: Object.freeze([38, 76])
  });
  const guitarSampleDefinitions = Object.freeze([
    [40, "40.flac"],
    [45, "45.flac"],
    [50, "50.flac"],
    [55, "55.flac"],
    [60, "60.flac"],
    [65, "65.flac"],
    [70, "70.flac"],
    [75, "75.flac"]
  ].map(([midi, file]) => Object.freeze({ midi, url: `assets/guitar/fss-steel-string/${file}` })));
  const guitarSamples = new Map();
  let guitarSamplePromise = null;
  let guitarSampleError = null;
  const pianoLibrary = Object.freeze({
    name: "Upright Piano KW",
    license: "CC0-1.0",
    sampleCount: 12,
    encodedBytes: 1405512,
    midiRange: Object.freeze([37, 76])
  });
  const pianoSampleDefinitions = Object.freeze([
    [39, "D%232vH.flac"],
    [42, "F%232vH.flac"],
    [47, "B2vH.flac"],
    [51, "D%233vH.flac"],
    [54, "F%233vH.flac"],
    [57, "A3vH.flac"],
    [60, "C4vH.flac"],
    [63, "D%234vH.flac"],
    [66, "F%234vH.flac"],
    [69, "A4vH.flac"],
    [72, "C5vH.flac"],
    [75, "D%235vH.flac"]
  ].map(([midi, file]) => Object.freeze({ midi, url: `assets/piano/upright-kw/${file}` })));
  const pianoSamples = new Map();
  let pianoSamplePromise = null;
  let pianoSampleError = null;

  function trackSource(source, group) {
    if (!group) return;
    if (!scheduledSources.has(group)) scheduledSources.set(group, new Set());
    scheduledSources.get(group).add(source);
    source.addEventListener("ended", () => scheduledSources.get(group)?.delete(source), { once: true });
  }

  function stopGroup(group) {
    groupGenerations.set(group, (groupGenerations.get(group) ?? 0) + 1);
    const sources = scheduledSources.get(group);
    if (!sources) return;
    sources.forEach(source => {
      try { source.stop(); } catch {}
    });
    scheduledSources.delete(group);
  }

  function groupGeneration(group) {
    return group ? groupGenerations.get(group) ?? 0 : null;
  }

  function audioContext() {
    if (context) return context;
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return null;

    context = new AudioContext();
    const compressor = context.createDynamicsCompressor();
    compressor.threshold.value = -18;
    compressor.knee.value = 12;
    compressor.ratio.value = 4;
    compressor.attack.value = 0.003;
    compressor.release.value = 0.18;
    const master = context.createGain();
    const dry = context.createGain();
    const reverb = context.createConvolver();
    const preDelay = context.createDelay();
    const reverbHighpass = context.createBiquadFilter();
    const reverbLowpass = context.createBiquadFilter();
    const wet = context.createGain();
    output = context.createGain();
    directOutput = master;
    master.gain.value = 0.72;
    dry.gain.value = 0.93;
    wet.gain.value = roomEffect.wetGain;
    preDelay.delayTime.value = roomEffect.preDelaySeconds;
    reverbHighpass.type = "highpass";
    reverbHighpass.frequency.value = 150;
    reverbLowpass.type = "lowpass";
    reverbLowpass.frequency.value = 4800;
    const impulseLength = Math.floor(context.sampleRate * roomEffect.decaySeconds);
    const impulse = context.createBuffer(2, impulseLength, context.sampleRate);
    let noise = 0x6D2B79F5;
    for (let channel = 0; channel < impulse.numberOfChannels; channel++) {
      const samples = impulse.getChannelData(channel);
      for (let index = 0; index < samples.length; index++) {
        noise ^= noise << 13;
        noise ^= noise >>> 17;
        noise ^= noise << 5;
        const envelope = Math.pow(1 - index / samples.length, 2.6);
        samples[index] = ((noise >>> 0) / 2147483647.5 - 1) * envelope;
      }
    }
    reverb.buffer = impulse;
    output.connect(dry).connect(master);
    output.connect(preDelay).connect(reverb).connect(reverbHighpass).connect(reverbLowpass).connect(wet).connect(master);
    master.connect(compressor).connect(context.destination);
    return context;
  }

  function frequency(midi) {
    return 440 * Math.pow(2, (midi - 69) / 12);
  }

  function expressionUnit(seed, eventId, channel) {
    let value = (Number(seed) >>> 0) ^ 0x811C9DC5;
    const text = `${eventId ?? "note"}:${channel}`;
    for (let index = 0; index < text.length; index++) {
      value ^= text.charCodeAt(index);
      value = Math.imul(value, 0x01000193);
    }
    value ^= value >>> 16;
    value = Math.imul(value, 0x7FEB352D);
    value ^= value >>> 15;
    return (value >>> 0) / 4294967295;
  }

  function expressionProfile(event, seed = 0) {
    const beatInBar = ((event.beat ?? 0) % 4 + 4) % 4;
    const accent = beatInBar < 0.001 ? 1.06 : Math.abs(beatInBar - 2) < 0.001 ? 1.015 : 0.97;
    return {
      gain: accent * (0.97 + expressionUnit(seed, event.id, "gain") * 0.06),
      attack: 0.026 + expressionUnit(seed, event.id, "attack") * 0.018,
      release: 0.09 + expressionUnit(seed, event.id, "release") * 0.05,
      brightness: 0.9 + expressionUnit(seed, event.id, "brightness") * 0.2,
      filterQ: 1.15 + expressionUnit(seed, event.id, "filter-q") * 0.5,
      vibratoRate: 4.8 + expressionUnit(seed, event.id, "vibrato-rate") * 0.55,
      vibratoDepth: 3.4 + expressionUnit(seed, event.id, "vibrato-depth") * 2,
      vibratoDelay: 0.18 + expressionUnit(seed, event.id, "vibrato-delay") * 0.16,
      reedBlend: 0.94 + expressionUnit(seed, event.id, "reed-blend") * 0.12,
      lateExpression: 0.93 + expressionUnit(seed, event.id, "late-expression") * 0.08,
      pluckAttack: 0.003 + expressionUnit(seed, event.id, "pluck-attack") * 0.005,
      stringDamping: 0.988 + expressionUnit(seed, event.id, "string-damping") * 0.008,
      stringResonance: 0.5 + expressionUnit(seed, event.id, "string-resonance") * 0.25,
      bodyResonance: 0.9 + expressionUnit(seed, event.id, "body-resonance") * 0.2,
      pluckPosition: 0.18 + expressionUnit(seed, event.id, "pluck-position") * 0.46,
      noiseSeed: expressionUnit(seed, event.id, "string-noise")
    };
  }

  function chordExpressionProfile(event, seed = 0) {
    const downstroke = (event.strumIndex ?? 0) % 2 === 0;
    const strongBeat = (event.beat ?? 0) % 4 === 0;
    return {
      gain: (strongBeat ? 0.38 : downstroke ? 0.34 : 0.29) * (0.94 + expressionUnit(seed, event.id, "chord-gain") * 0.12),
      attack: 0.004 + expressionUnit(seed, event.id, "chord-attack") * 0.004,
      brightness: (downstroke ? 0.94 : 0.82) + expressionUnit(seed, event.id, "chord-brightness") * 0.12,
      strumSpread: 0.018 + expressionUnit(seed, event.id, "chord-spread") * 0.016,
      decayShape: event.durationBeats >= 4 ? 1.25 : event.durationBeats >= 2 ? 1.12 : 0.92,
      durationBeats: event.durationBeats,
      direction: downstroke ? "down" : "up",
      noiseSeed: expressionUnit(seed, event.id, "chord-noise")
    };
  }

  function chordPlaybackProfile(expression, tempo, stringIndex) {
    const slotSeconds = expression.durationBeats * 60 / tempo;
    const guardSeconds = Math.min(0.045, slotSeconds * 0.06);
    const staggerSeconds = stringIndex * expression.strumSpread;
    return {
      slotSeconds,
      guardSeconds,
      staggerSeconds,
      durationSeconds: Math.max(0.08, slotSeconds - staggerSeconds - guardSeconds)
    };
  }

  function resume() {
    const current = audioContext();
    if (current?.state === "suspended") current.resume();
    return current;
  }

  async function unlock() {
    const current = audioContext();
    if (!current) return false;
    if (current.state !== "running") {
      try {
        await current.resume();
      } catch {
        return false;
      }
    }
    return current.state === "running";
  }

  function playSynthHarmonica(midi, options = {}) {
    const current = resume();
    if (!current) return false;
    const start = options.startTime ?? current.currentTime + (options.delay ?? 0);
    const duration = options.duration ?? 0.58;
    const end = start + duration;
    const expression = options.expression ?? expressionProfile({ id: `audition-${midi}`, beat: 0 });
    const attackEnd = start + Math.min(expression.attack, duration * 0.22);
    const releaseStart = end - Math.min(expression.release, duration * 0.35);
    const settleTime = attackEnd + Math.max(0.001, (releaseStart - attackEnd) * 0.32);
    const peakGain = 0.16 * expression.gain;
    const voice = current.createGain();
    const filter = current.createBiquadFilter();
    const vibrato = current.createOscillator();
    const vibratoDepth = current.createGain();

    voice.gain.setValueAtTime(0.0001, start);
    voice.gain.exponentialRampToValueAtTime(peakGain, attackEnd);
    voice.gain.exponentialRampToValueAtTime(peakGain * 0.9, settleTime);
    voice.gain.exponentialRampToValueAtTime(peakGain * expression.lateExpression, releaseStart);
    voice.gain.exponentialRampToValueAtTime(0.0001, end);
    filter.type = "lowpass";
    const filterCenter = Math.min(5200, frequency(midi) * 7 * expression.brightness);
    filter.frequency.setValueAtTime(filterCenter * 0.88, start);
    filter.frequency.linearRampToValueAtTime(filterCenter, settleTime);
    filter.frequency.linearRampToValueAtTime(filterCenter * 0.94, end);
    filter.Q.value = expression.filterQ;
    vibrato.frequency.value = expression.vibratoRate;
    vibratoDepth.gain.setValueAtTime(0, start);
    const vibratoStart = start + duration * expression.vibratoDelay;
    vibratoDepth.gain.setValueAtTime(0, vibratoStart);
    vibratoDepth.gain.linearRampToValueAtTime(expression.vibratoDepth, Math.min(releaseStart, vibratoStart + duration * 0.3));
    vibrato.connect(vibratoDepth);

    [
      { type: "sawtooth", detune: -3, level: 0.5 * expression.reedBlend },
      { type: "triangle", detune: 3, level: 0.75 * (2 - expression.reedBlend) }
    ].forEach(partial => {
      const oscillator = current.createOscillator();
      const level = current.createGain();
      oscillator.type = partial.type;
      oscillator.frequency.value = frequency(midi);
      oscillator.detune.value = partial.detune;
      level.gain.value = partial.level;
      vibratoDepth.connect(oscillator.detune);
      oscillator.connect(level).connect(filter);
      trackSource(oscillator, options.group);
      oscillator.start(start);
      oscillator.stop(end + 0.03);
    });

    filter.connect(voice).connect(output);
    vibrato.start(start);
    trackSource(vibrato, options.group);
    vibrato.stop(end + 0.03);
    return true;
  }

  function prepareHarmonica() {
    const current = audioContext();
    if (!current) return Promise.resolve(false);
    if (harmonicaSamples.size === harmonicaSampleDefinitions.length) return Promise.resolve(true);
    if (harmonicaSamplePromise) return harmonicaSamplePromise;
    harmonicaSampleError = null;
    harmonicaSamplePromise = Promise.all(harmonicaSampleDefinitions.map(async definition => {
      const response = await fetch(definition.url);
      if (!response.ok) throw new Error(`Unable to load harmonica sample ${definition.url}.`);
      const buffer = await current.decodeAudioData(await response.arrayBuffer());
      return [definition.midi, { buffer, gainDb: definition.gainDb }];
    })).then(samples => {
      samples.forEach(([midi, sample]) => harmonicaSamples.set(midi, sample));
      return true;
    }).catch(error => {
      harmonicaSampleError = error;
      harmonicaSamples.clear();
      console.warn("Fretwise could not load the harmonica samples; using synthesized harmonica fallback.", error);
      return false;
    });
    return harmonicaSamplePromise;
  }

  function nearestHarmonicaSample(midi) {
    return [...harmonicaSamples.entries()].reduce((nearest, entry) =>
      !nearest || Math.abs(entry[0] - midi) < Math.abs(nearest[0] - midi) ? entry : nearest
    , null);
  }

  function renderSampledHarmonica(midi, options = {}) {
    const current = resume();
    const sample = nearestHarmonicaSample(midi);
    if (!current || !sample || midi < harmonicaLibrary.midiRange[0] || midi > harmonicaLibrary.midiRange[1]) return false;
    const expression = options.expression ?? expressionProfile({ id: `harmonica-${midi}`, beat: 0 });
    const start = options.startTime ?? current.currentTime + (options.delay ?? 0);
    const requestedDuration = options.duration ?? 0.58;
    const playbackRate = Math.pow(2, (midi - sample[0]) / 12);
    const duration = Math.min(requestedDuration, sample[1].buffer.duration / playbackRate);
    const end = start + duration;
    const attackEnd = start + Math.min(0.018, duration * 0.14);
    const releaseStart = Math.max(attackEnd + 0.01, end - Math.min(expression.release, duration * 0.3));
    const calibratedGain = instrumentMix.sampledHarmonicaGain * Math.pow(10, sample[1].gainDb / 20) * (expression.gain ?? 1);
    const source = current.createBufferSource();
    const filter = current.createBiquadFilter();
    const envelope = current.createGain();
    source.buffer = sample[1].buffer;
    source.playbackRate.value = playbackRate;
    filter.type = "lowpass";
    filter.frequency.value = Math.min(7200, frequency(midi) * 9 * (expression.brightness ?? 1));
    filter.Q.value = 0.5;
    envelope.gain.setValueAtTime(0.0001, start);
    envelope.gain.exponentialRampToValueAtTime(calibratedGain, attackEnd);
    envelope.gain.setValueAtTime(calibratedGain * (expression.lateExpression ?? 1), releaseStart);
    envelope.gain.exponentialRampToValueAtTime(0.0001, end);
    source.connect(filter).connect(envelope).connect(output);
    trackSource(source, options.group);
    source.start(start);
    source.stop(end + 0.03);
    return true;
  }

  function playHarmonica(midi, options = {}) {
    if (midi < harmonicaLibrary.midiRange[0] || midi > harmonicaLibrary.midiRange[1]) return playSynthHarmonica(midi, options);
    if (harmonicaSamples.size === harmonicaSampleDefinitions.length) return renderSampledHarmonica(midi, options);
    const current = resume();
    if (!current) return false;
    const start = options.startTime ?? current.currentTime + (options.delay ?? 0);
    const duration = options.duration ?? 0.58;
    const generation = groupGeneration(options.group);
    if (start <= current.currentTime + 0.05) {
      prepareHarmonica();
      return playSynthHarmonica(midi, options);
    }
    prepareHarmonica().then(ready => {
      if (generation !== groupGeneration(options.group)) return;
      const deferredStart = Math.max(start, current.currentTime + 0.005);
      const remainingDuration = start + duration - deferredStart;
      if (remainingDuration <= 0.01) return;
      const deferredOptions = { ...options, startTime: deferredStart, duration: remainingDuration };
      if (ready) renderSampledHarmonica(midi, deferredOptions);
      else playSynthHarmonica(midi, deferredOptions);
    });
    return true;
  }

  function harmonicaStatus() {
    return {
      state: harmonicaSamples.size === harmonicaSampleDefinitions.length ? "ready" : harmonicaSampleError ? "fallback" : harmonicaSamplePromise ? "loading" : "idle",
      loadedSamples: harmonicaSamples.size,
      id: harmonicaLibrary.id,
      name: harmonicaLibrary.name,
      license: harmonicaLibrary.license,
      sampleCount: harmonicaLibrary.sampleCount,
      encodedBytes: harmonicaLibrary.encodedBytes,
      midiRange: harmonicaLibrary.midiRange,
      maxPitchShiftSemitones: harmonicaLibrary.maxPitchShiftSemitones
    };
  }

  function playSynthGuitar(midi, options = {}) {
    const current = resume();
    if (!current) return false;
    const expression = options.expression ?? expressionProfile({ id: `audition-${midi}`, beat: 0 });
    const start = options.startTime ?? current.currentTime + (options.delay ?? 0);
    const duration = options.duration ?? 1.35;
    const gain = expression.gain ?? 1;
    const attack = expression.pluckAttack ?? expression.attack ?? 0.006;
    const brightness = expression.brightness ?? 1;
    const stringDamping = expression.stringDamping ?? 0.992;
    const normalizedDamping = Math.max(0, Math.min(1, (stringDamping - 0.988) / 0.008));
    const decayShape = expression.decayShape ?? 0.82 + normalizedDamping * 0.28;
    const sampleDamping = Math.exp(Math.log(0.001) / (current.sampleRate * duration * decayShape));
    const pluckPosition = expression.pluckPosition ?? 0.4;
    const sampleCount = Math.max(1, Math.ceil(current.sampleRate * duration));
    const period = current.sampleRate / frequency(midi);
    const initialSampleCount = Math.ceil(period) + 2;
    const stringBuffer = current.createBuffer(1, sampleCount, current.sampleRate);
    const samples = stringBuffer.getChannelData(0);
    let noise = Math.floor((expression.noiseSeed ?? Math.random()) * 4294967295) >>> 0;

    for (let index = 0; index < initialSampleCount && index < samples.length; index++) {
      noise ^= noise << 13;
      noise ^= noise >>> 17;
      noise ^= noise << 5;
      samples[index] = (noise >>> 0) / 2147483647.5 - 1;
    }
    const pluckOffset = Math.max(1, Math.round(period * pluckPosition));
    for (let index = pluckOffset; index < initialSampleCount && index < samples.length; index++) {
      samples[index] -= samples[index - pluckOffset] * 0.48;
    }
    for (let index = initialSampleCount; index < samples.length; index++) {
      const delayedIndex = index - period;
      const lowerIndex = Math.floor(delayedIndex);
      const fraction = delayedIndex - lowerIndex;
      const delayed = samples[lowerIndex] * (1 - fraction) + samples[lowerIndex + 1] * fraction;
      const previous = samples[Math.max(0, lowerIndex - 1)] * (1 - fraction) + samples[lowerIndex] * fraction;
      samples[index] = sampleDamping * (delayed * 0.58 + previous * 0.42);
    }

    const string = current.createBufferSource();
    const envelope = current.createGain();
    const filter = current.createBiquadFilter();
    const lowerBody = current.createBiquadFilter();
    const upperBody = current.createBiquadFilter();
    string.buffer = stringBuffer;
    envelope.gain.setValueAtTime(0.0001, start);
    envelope.gain.exponentialRampToValueAtTime(0.42 * gain, start + attack);
    envelope.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(Math.min(6800, frequency(midi) * 12 * brightness), start);
    filter.frequency.exponentialRampToValueAtTime(Math.max(950, frequency(midi) * 3), start + duration);
    filter.Q.value = expression.stringResonance ?? 0.62;
    lowerBody.type = "peaking";
    lowerBody.frequency.value = 115;
    lowerBody.Q.value = 0.8;
    lowerBody.gain.value = 3.2 * (expression.bodyResonance ?? 1);
    upperBody.type = "peaking";
    upperBody.frequency.value = 230;
    upperBody.Q.value = 1.1;
    upperBody.gain.value = 2.4 * (expression.bodyResonance ?? 1);
    string.connect(filter).connect(lowerBody).connect(upperBody).connect(envelope).connect(output);
    trackSource(string, options.group);
    string.start(start);
    string.stop(start + duration + 0.03);

    const excitationLength = Math.max(1, Math.floor(current.sampleRate * 0.018));
    const excitationBuffer = current.createBuffer(1, excitationLength, current.sampleRate);
    const excitationSamples = excitationBuffer.getChannelData(0);
    for (let index = 0; index < excitationSamples.length; index++) {
      noise ^= noise << 13;
      noise ^= noise >>> 17;
      noise ^= noise << 5;
      excitationSamples[index] = ((noise >>> 0) / 2147483647.5 - 1) * (1 - index / excitationSamples.length);
    }
    const excitation = current.createBufferSource();
    const excitationFilter = current.createBiquadFilter();
    const excitationGain = current.createGain();
    excitation.buffer = excitationBuffer;
    excitationFilter.type = "bandpass";
    excitationFilter.frequency.value = Math.min(4800, frequency(midi) * 5);
    excitationFilter.Q.value = 0.9;
    excitationGain.gain.value = 0.025 * gain;
    excitation.connect(excitationFilter).connect(excitationGain).connect(lowerBody);
    trackSource(excitation, options.group);
    excitation.start(start);
    return true;
  }

  function prepareGuitar() {
    const current = audioContext();
    if (!current) return Promise.resolve(false);
    if (guitarSamples.size === guitarSampleDefinitions.length) return Promise.resolve(true);
    if (guitarSamplePromise) return guitarSamplePromise;
    guitarSampleError = null;
    guitarSamplePromise = Promise.all(guitarSampleDefinitions.map(async definition => {
      const response = await fetch(definition.url);
      if (!response.ok) throw new Error(`Unable to load guitar sample ${definition.url}.`);
      const buffer = await current.decodeAudioData(await response.arrayBuffer());
      return [definition.midi, buffer];
    })).then(samples => {
      samples.forEach(([midi, buffer]) => guitarSamples.set(midi, buffer));
      return true;
    }).catch(error => {
      guitarSampleError = error;
      guitarSamples.clear();
      console.warn("Fretwise could not load the steel-string guitar samples; using physical-string synthesis fallback.", error);
      return false;
    });
    return guitarSamplePromise;
  }

  function nearestGuitarSample(midi) {
    return [...guitarSamples.entries()].reduce((nearest, entry) =>
      !nearest || Math.abs(entry[0] - midi) < Math.abs(nearest[0] - midi) ? entry : nearest
    , null);
  }

  function renderSampledGuitar(midi, options = {}) {
    const current = resume();
    const sample = nearestGuitarSample(midi);
    if (!current || !sample) return false;
    const expression = options.expression ?? expressionProfile({ id: `guitar-${midi}`, beat: 0 });
    const start = options.startTime ?? current.currentTime + (options.delay ?? 0);
    const requestedDuration = options.duration ?? 1.35;
    const playbackRate = Math.pow(2, (midi - sample[0]) / 12);
    const duration = Math.min(requestedDuration, sample[1].duration / playbackRate);
    const end = start + duration;
    const releaseStart = Math.max(start + 0.01, end - Math.min(0.11, duration * 0.16));
    const source = current.createBufferSource();
    const envelope = current.createGain();
    const highpass = current.createBiquadFilter();
    const filter = current.createBiquadFilter();
    source.buffer = sample[1];
    source.playbackRate.value = playbackRate;
    highpass.type = "highpass";
    highpass.frequency.value = instrumentMix.guitarHighpassHz;
    highpass.Q.value = 0.7;
    filter.type = "lowpass";
    filter.frequency.value = 5200 + 1800 * (expression.brightness ?? 1);
    filter.Q.value = 0.45;
    envelope.gain.setValueAtTime(0.0001, start);
    envelope.gain.exponentialRampToValueAtTime(instrumentMix.sampledGuitarGain * (expression.gain ?? 1), start + 0.004);
    envelope.gain.setValueAtTime(instrumentMix.sampledGuitarGain * (expression.gain ?? 1), releaseStart);
    envelope.gain.exponentialRampToValueAtTime(0.0001, end);
    source.connect(highpass).connect(filter).connect(envelope).connect(output);
    trackSource(source, options.group);
    source.start(start);
    source.stop(end + 0.03);
    return true;
  }

  function playGuitar(midi, options = {}) {
    if (guitarSamples.size === guitarSampleDefinitions.length) return renderSampledGuitar(midi, options);
    const current = resume();
    if (!current) return false;
    const start = options.startTime ?? current.currentTime + (options.delay ?? 0);
    const duration = options.duration ?? 1.35;
    const generation = groupGeneration(options.group);
    prepareGuitar().then(ready => {
      if (generation !== groupGeneration(options.group)) return;
      const deferredStart = Math.max(start, current.currentTime + 0.005);
      const remainingDuration = start + duration - deferredStart;
      if (remainingDuration <= 0.01) return;
      const deferredOptions = { ...options, startTime: deferredStart, duration: remainingDuration };
      if (ready) renderSampledGuitar(midi, deferredOptions);
      else playSynthGuitar(midi, deferredOptions);
    });
    return true;
  }

  function guitarStatus() {
    return {
      state: guitarSamples.size === guitarSampleDefinitions.length ? "ready" : guitarSampleError ? "fallback" : guitarSamplePromise ? "loading" : "idle",
      loadedSamples: guitarSamples.size,
      ...guitarLibrary
    };
  }

  function playSynthPiano(midi, options = {}) {
    const current = resume();
    if (!current) return false;
    const expression = options.expression ?? expressionProfile({ id: `piano-${midi}`, beat: 0 });
    const start = options.startTime ?? current.currentTime + (options.delay ?? 0);
    const duration = options.duration ?? 1.8;
    const gain = expression.gain ?? 1;
    const brightness = expression.brightness ?? 1;
    const end = start + duration;
    const filter = current.createBiquadFilter();
    const lowerBody = current.createBiquadFilter();
    const upperBody = current.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(Math.min(7800, 3600 * brightness + frequency(midi) * 5), start);
    filter.frequency.exponentialRampToValueAtTime(Math.max(1500, frequency(midi) * 4), end);
    filter.Q.value = 0.55;
    lowerBody.type = "peaking";
    lowerBody.frequency.value = 190;
    lowerBody.Q.value = 0.9;
    lowerBody.gain.value = 2.2;
    upperBody.type = "peaking";
    upperBody.frequency.value = 520;
    upperBody.Q.value = 1.2;
    upperBody.gain.value = 1.5;
    filter.connect(lowerBody).connect(upperBody).connect(output);

    [
      { multiple: 1, level: 0.3, decay: 1, detune: 0 },
      { multiple: 2, level: 0.13, decay: 0.68, detune: 0.7 },
      { multiple: 3, level: 0.065, decay: 0.42, detune: -1.1 },
      { multiple: 4, level: 0.032, decay: 0.26, detune: 1.8 }
    ].forEach(partial => {
      const oscillator = current.createOscillator();
      const envelope = current.createGain();
      const partialEnd = start + Math.max(0.09, duration * partial.decay);
      oscillator.type = "sine";
      oscillator.frequency.value = frequency(midi) * partial.multiple;
      oscillator.detune.value = partial.detune;
      envelope.gain.setValueAtTime(0.0001, start);
      envelope.gain.exponentialRampToValueAtTime(partial.level * gain, start + 0.004);
      envelope.gain.exponentialRampToValueAtTime(partial.level * gain * 0.52, start + Math.min(0.12, duration * 0.18));
      envelope.gain.exponentialRampToValueAtTime(0.0001, partialEnd);
      oscillator.connect(envelope).connect(filter);
      trackSource(oscillator, options.group);
      oscillator.start(start);
      oscillator.stop(partialEnd + 0.03);
    });

    const hammerLength = Math.max(1, Math.floor(current.sampleRate * 0.014));
    const hammerBuffer = current.createBuffer(1, hammerLength, current.sampleRate);
    const hammerSamples = hammerBuffer.getChannelData(0);
    let noise = Math.floor((expression.noiseSeed ?? Math.random()) * 4294967295) >>> 0;
    for (let index = 0; index < hammerSamples.length; index++) {
      noise ^= noise << 13;
      noise ^= noise >>> 17;
      noise ^= noise << 5;
      hammerSamples[index] = ((noise >>> 0) / 2147483647.5 - 1) * Math.pow(1 - index / hammerSamples.length, 2);
    }
    const hammer = current.createBufferSource();
    const hammerFilter = current.createBiquadFilter();
    const hammerGain = current.createGain();
    hammer.buffer = hammerBuffer;
    hammerFilter.type = "bandpass";
    hammerFilter.frequency.value = Math.min(5200, 1800 + frequency(midi) * 4);
    hammerFilter.Q.value = 0.8;
    hammerGain.gain.value = 0.026 * gain;
    hammer.connect(hammerFilter).connect(hammerGain).connect(output);
    trackSource(hammer, options.group);
    hammer.start(start);
    return true;
  }

  function preparePiano() {
    const current = audioContext();
    if (!current) return Promise.resolve(false);
    if (pianoSamples.size === pianoSampleDefinitions.length) return Promise.resolve(true);
    if (pianoSamplePromise) return pianoSamplePromise;
    pianoSampleError = null;
    pianoSamplePromise = Promise.all(pianoSampleDefinitions.map(async definition => {
      const response = await fetch(definition.url);
      if (!response.ok) throw new Error(`Unable to load piano sample ${definition.url}.`);
      const buffer = await current.decodeAudioData(await response.arrayBuffer());
      return [definition.midi, buffer];
    })).then(samples => {
      samples.forEach(([midi, buffer]) => pianoSamples.set(midi, buffer));
      return true;
    }).catch(error => {
      pianoSampleError = error;
      pianoSamples.clear();
      console.warn("Fretwise could not load the upright piano samples; using synthesized piano fallback.", error);
      return false;
    });
    return pianoSamplePromise;
  }

  function nearestPianoSample(midi) {
    return [...pianoSamples.entries()].reduce((nearest, entry) =>
      !nearest || Math.abs(entry[0] - midi) < Math.abs(nearest[0] - midi) ? entry : nearest
    , null);
  }

  function renderSampledPiano(midi, options = {}) {
    const current = resume();
    const sample = nearestPianoSample(midi);
    if (!current || !sample) return false;
    const expression = options.expression ?? expressionProfile({ id: `piano-${midi}`, beat: 0 });
    const start = options.startTime ?? current.currentTime + (options.delay ?? 0);
    const requestedDuration = options.duration ?? 1.8;
    const playbackRate = Math.pow(2, (midi - sample[0]) / 12);
    const duration = Math.min(requestedDuration, sample[1].duration / playbackRate);
    const end = start + duration;
    const releaseStart = Math.max(start + 0.01, end - Math.min(0.12, duration * 0.18));
    const source = current.createBufferSource();
    const envelope = current.createGain();
    source.buffer = sample[1];
    source.playbackRate.value = playbackRate;
    envelope.gain.setValueAtTime(0.0001, start);
    envelope.gain.exponentialRampToValueAtTime(instrumentMix.sampledPianoGain * (expression.gain ?? 1), start + 0.004);
    envelope.gain.setValueAtTime(instrumentMix.sampledPianoGain * (expression.gain ?? 1), releaseStart);
    envelope.gain.exponentialRampToValueAtTime(0.0001, end);
    source.connect(envelope).connect(output);
    trackSource(source, options.group);
    source.start(start);
    source.stop(end + 0.03);
    return true;
  }

  function playPiano(midi, options = {}) {
    if (pianoSamples.size === pianoSampleDefinitions.length) return renderSampledPiano(midi, options);
    const current = resume();
    if (!current) return false;
    const start = options.startTime ?? current.currentTime + (options.delay ?? 0);
    const duration = options.duration ?? 1.8;
    const generation = groupGeneration(options.group);
    preparePiano().then(ready => {
      if (generation !== groupGeneration(options.group)) return;
      const deferredStart = Math.max(start, current.currentTime + 0.005);
      const remainingDuration = start + duration - deferredStart;
      if (remainingDuration <= 0.01) return;
      const deferredOptions = {
        ...options,
        startTime: deferredStart,
        duration: remainingDuration
      };
      if (ready) renderSampledPiano(midi, deferredOptions);
      else playSynthPiano(midi, deferredOptions);
    });
    return true;
  }

  function pianoStatus() {
    return {
      state: pianoSamples.size === pianoSampleDefinitions.length ? "ready" : pianoSampleError ? "fallback" : pianoSamplePromise ? "loading" : "idle",
      loadedSamples: pianoSamples.size,
      ...pianoLibrary
    };
  }

  function status() {
    return { available: Boolean(window.AudioContext || window.webkitAudioContext), state: context?.state ?? "not-started" };
  }

  function currentTime() {
    return context?.currentTime ?? null;
  }

  function scheduleCountIn(options = {}) {
    const tempo = options.tempo ?? 80;
    const beats = options.beats ?? 4;
    const group = options.group ?? "count-in";
    const secondsPerBeat = 60 / tempo;
    stopGroup(group);
    const current = resume();
    if (!current) return { beats, tempo, startTime: null, endTime: null };
    const startTime = current.currentTime + 0.04;

    for (let beat = 0; beat < beats; beat++) {
      const start = startTime + beat * secondsPerBeat;
      const oscillator = current.createOscillator();
      const envelope = current.createGain();
      oscillator.type = "square";
      oscillator.frequency.value = beat === 0 ? 1320 : 880;
      envelope.gain.setValueAtTime(0.0001, start);
      envelope.gain.exponentialRampToValueAtTime(beat === 0 ? 0.2 : 0.14, start + 0.004);
      envelope.gain.exponentialRampToValueAtTime(0.0001, start + 0.055);
      oscillator.connect(envelope).connect(directOutput);
      trackSource(oscillator, group);
      oscillator.start(start);
      oscillator.stop(start + 0.06);
    }

    return { beats, tempo, startTime, endTime: startTime + beats * secondsPerBeat };
  }

  function scheduleMelody(events, options = {}) {
    const tempo = options.tempo ?? 80;
    const startBeat = options.startBeat ?? 0;
    const secondsPerBeat = 60 / tempo;
    stopGroup(options.group ?? "practice");
    const current = resume();
    const startTime = options.startTime ?? current?.currentTime ?? null;
    const playNote = options.instrument === "guitar" ? playGuitar : playHarmonica;
    events.filter(event => event.beat + event.durationBeats > startBeat).forEach(event => {
      const delay = Math.max(0, event.beat - startBeat) * secondsPerBeat;
      const soundingDurationBeats = event.soundingDurationBeats ?? event.durationBeats * 0.88;
      const duration = Math.max(0.08, soundingDurationBeats * secondsPerBeat);
      playNote(event.midi, {
        startTime: startTime === null ? undefined : startTime + delay,
        delay,
        duration,
        expression: expressionProfile(event, options.seed),
        group: options.group ?? "practice"
      });
    });
    return { eventCount: events.length, startBeat, tempo, startTime };
  }

  function scheduleChordProgression(events, options = {}) {
    const tempo = options.tempo ?? 80;
    const startBeat = options.startBeat ?? 0;
    const secondsPerBeat = 60 / tempo;
    const current = resume();
    const startTime = options.startTime ?? current?.currentTime ?? null;
    const instrument = options.instrument === "piano" ? "piano" : "guitar";
    const playChordNote = instrument === "piano" ? playPiano : playGuitar;
    events.filter(event => event.beat + event.durationBeats > startBeat).forEach(event => {
      const remainingDurationBeats = event.beat < startBeat
        ? event.beat + event.durationBeats - startBeat
        : event.durationBeats;
      const expression = chordExpressionProfile({ ...event, durationBeats: remainingDurationBeats }, options.seed);
      const midis = [...event.midis].sort((left, right) => expression.direction === "down" ? left - right : right - left);
      const delay = Math.max(0, event.beat - startBeat) * secondsPerBeat;
      const strumStart = startTime === null ? undefined : startTime + delay;
      midis.forEach((midi, index) => {
        const noteExpression = {
          ...expression,
          strumSpread: instrument === "piano" ? expression.strumSpread * 0.18 : expression.strumSpread,
          noiseSeed: expression.noiseSeed + index / 17
        };
        const playback = chordPlaybackProfile(noteExpression, tempo, index);
        playChordNote(midi, {
          startTime: strumStart === undefined ? undefined : strumStart + playback.staggerSeconds,
          delay: delay + playback.staggerSeconds,
          duration: playback.durationSeconds,
          expression: noteExpression,
          group: options.group ?? "practice"
        });
      });
    });
    return { eventCount: events.length, startBeat, tempo, startTime, instrument };
  }

  return { chordExpressionProfile, chordPlaybackProfile, expressionProfile, guitarLibrary, guitarStatus, harmonicaLibrary, harmonicaStatus, instrumentMix, pianoLibrary, pianoStatus, playGuitar, playHarmonica, playPiano, playSynthGuitar, playSynthHarmonica, prepareGuitar, prepareHarmonica, preparePiano, roomEffect, scheduleChordProgression, scheduleCountIn, scheduleMelody, stopGroup, status, currentTime, unlock };
})();