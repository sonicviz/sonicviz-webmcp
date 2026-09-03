const FretwiseSession = (() => {
  const slices = Object.create(null);
  const history = [];
  const listeners = new Set();
  const historyLimit = 100;

  function snapshot(value) {
    if (value instanceof Set) return [...value];
    if (Array.isArray(value)) return value.map(snapshot);
    if (value && typeof value === "object") {
      return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, snapshot(item)]));
    }
    return value;
  }

  function registerSlice(name, initialState) {
    if (!slices[name]) slices[name] = initialState;
    return slices[name];
  }

  function update(name, change, options = {}) {
    const target = slices[name];
    if (!target) throw new RangeError(`Unknown session state slice: ${name}`);
    const before = snapshot(target);
    if (typeof change === "function") change(target);
    else Object.assign(target, change);
    const after = snapshot(target);

    if (options.record !== false && JSON.stringify(before) !== JSON.stringify(after)) {
      history.push({
        scope: name,
        source: options.source ?? "ui",
        timestamp: new Date().toISOString(),
        before,
        after
      });
      if (history.length > historyLimit) history.shift();
    }

    listeners.forEach(listener => listener({ name, state: after }));
    return target;
  }

  function getState() {
    return snapshot(slices);
  }

  function getHistory() {
    return snapshot(history);
  }

  function subscribe(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  return { registerSlice, update, getState, getHistory, subscribe };
})();