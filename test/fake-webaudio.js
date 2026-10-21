// A minimal stand-in for the Web Audio API, strict about the rules real
// browsers enforce (non-negative finite times, non-zero exponential targets),
// so instrument and scheduler code can be exercised under Node.

function checkTime(t, what) {
  if (!Number.isFinite(t) || t < 0) throw new RangeError(`${what}: bad time ${t}`);
}
function checkValue(v, what) {
  if (!Number.isFinite(v)) throw new TypeError(`${what}: non-finite value ${v}`);
}

class FakeParam {
  constructor(value = 0) {
    this.value = value;
    this.events = [];
  }
  setValueAtTime(v, t) { checkValue(v, 'setValueAtTime'); checkTime(t, 'setValueAtTime'); this.events.push(['set', v, t]); return this; }
  linearRampToValueAtTime(v, t) { checkValue(v, 'linearRamp'); checkTime(t, 'linearRamp'); this.events.push(['lin', v, t]); return this; }
  exponentialRampToValueAtTime(v, t) {
    checkValue(v, 'exponentialRamp');
    checkTime(t, 'exponentialRamp');
    if (v === 0) throw new RangeError('exponentialRamp to zero');
    this.events.push(['exp', v, t]);
    return this;
  }
  setTargetAtTime(v, t, c) { checkValue(v, 'setTarget'); checkTime(t, 'setTarget'); if (!(c > 0)) throw new RangeError('timeConstant'); return this; }
  cancelScheduledValues(t) { checkTime(t, 'cancel'); return this; }
}

class FakeNode {
  constructor(ctx, params = {}) {
    this.context = ctx;
    for (const [k, v] of Object.entries(params)) this[k] = new FakeParam(v);
    ctx.nodes.push(this);
  }
  connect(dest) {
    if (!dest) throw new TypeError('connect to nothing');
    return dest;
  }
}

class FakeSource extends FakeNode {
  start(when = 0, offset = 0) {
    checkTime(when, 'start');
    checkTime(offset, 'start offset');
    if (this.started !== undefined) throw new Error('InvalidStateError: started twice');
    this.started = when;
  }
  stop(when = 0) {
    checkTime(when, 'stop');
    if (this.started === undefined) throw new Error('InvalidStateError: stop before start');
    this.stopped = when;
  }
}

class FakeBuffer {
  constructor(channels, length, sampleRate) {
    if (!(length > 0)) throw new RangeError(`buffer length ${length}`);
    this.numberOfChannels = channels;
    this.length = length;
    this.sampleRate = sampleRate;
    this.duration = length / sampleRate;
    this.data = Array.from({ length: channels }, () => new Float32Array(length));
  }
  getChannelData(c) { return this.data[c]; }
}

export class FakeContext {
  constructor({ sampleRate = 48000, length = 0, numberOfChannels = 2 } = {}) {
    this.sampleRate = sampleRate;
    this.length = length;
    this.numberOfChannels = numberOfChannels;
    this.currentTime = 0;
    this.baseLatency = 0.01;
    this.outputLatency = 0.02;
    this.state = 'running';
    this.nodes = [];
    this.destination = new FakeNode(this);
  }
  createGain() { return new FakeNode(this, { gain: 1 }); }
  createBiquadFilter() { const n = new FakeNode(this, { frequency: 350, Q: 1, gain: 0 }); n.type = 'lowpass'; return n; }
  createStereoPanner() { return new FakeNode(this, { pan: 0 }); }
  createWaveShaper() { return new FakeNode(this); }
  createConvolver() { return new FakeNode(this); }
  createDynamicsCompressor() { return new FakeNode(this, { threshold: -24, knee: 30, ratio: 12, attack: 0.003, release: 0.25 }); }
  createOscillator() { const n = new FakeSource(this); n.frequency = new FakeParam(440); n.detune = new FakeParam(0); n.type = 'sine'; return n; }
  createBufferSource() { const n = new FakeSource(this); n.playbackRate = new FakeParam(1); return n; }
  createBuffer(ch, len, sr) { return new FakeBuffer(ch, len, sr); }
  resume() { this.state = 'running'; return Promise.resolve(); }
  suspend(t) { checkTime(t, 'suspend'); return new Promise(() => {}); }
  startRendering() { return Promise.resolve(new FakeBuffer(this.numberOfChannels, this.length, this.sampleRate)); }
  get sources() { return this.nodes.filter(n => n instanceof FakeSource); }
}
