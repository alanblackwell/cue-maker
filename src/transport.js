// One clock for the whole app. With a proxy loaded, the <video> element is the
// master; without one, an internal clock stands in so cues can be sketched
// without picture. Emits 'play', 'pause' and 'seek'.

export class Transport extends EventTarget {
  constructor(video) {
    super();
    this.video = video;
    this.hasVideo = false;
    this.fallbackDuration = 60;
    this._t = 0;
    this._playing = false;
    this._anchorT = 0;
    this._anchorPerf = 0;
    const forward = (from, to) =>
      video.addEventListener(from, () => {
        if (this.hasVideo) this.dispatchEvent(new Event(to));
      });
    forward('playing', 'play');
    forward('pause', 'pause');
    forward('waiting', 'pause');
    forward('ended', 'pause');
    forward('seeked', 'seek');
  }

  load(url) {
    return new Promise((resolve, reject) => {
      const v = this.video;
      const cleanup = () => {
        v.removeEventListener('loadedmetadata', ok);
        v.removeEventListener('error', bad);
      };
      const ok = () => {
        cleanup();
        this.hasVideo = true;
        resolve();
      };
      const bad = () => {
        cleanup();
        this.hasVideo = false;
        reject(new Error("This browser can't play that video. Export an H.264 proxy from Final Cut and try again."));
      };
      this.pause();
      this.hasVideo = false;
      v.addEventListener('loadedmetadata', ok);
      v.addEventListener('error', bad);
      v.src = url;
      v.load();
    });
  }

  get duration() {
    return this.hasVideo && Number.isFinite(this.video.duration) ? this.video.duration : this.fallbackDuration;
  }

  get time() {
    if (this.hasVideo) return this.video.currentTime;
    if (!this._playing) return this._t;
    return Math.min(this.duration, this._anchorT + (performance.now() - this._anchorPerf) / 1000);
  }

  get playing() {
    return this.hasVideo ? !this.video.paused && !this.video.ended : this._playing;
  }

  play() {
    if (this.hasVideo) return this.video.play();
    if (this._playing) return;
    if (this._t >= this.duration) this._t = 0;
    this._anchorT = this._t;
    this._anchorPerf = performance.now();
    this._playing = true;
    this.dispatchEvent(new Event('play'));
  }

  pause() {
    if (this.hasVideo) return this.video.pause();
    if (!this._playing) return;
    this._t = this.time;
    this._playing = false;
    this.dispatchEvent(new Event('pause'));
  }

  toggle() {
    return this.playing ? this.pause() : this.play();
  }

  seek(t) {
    t = Math.max(0, Math.min(this.duration, t));
    if (this.hasVideo) {
      this.video.currentTime = t;
      return;
    }
    this._t = t;
    this._anchorT = t;
    this._anchorPerf = performance.now();
    this.dispatchEvent(new Event('seek'));
  }
}
