class TrackQueue {
  constructor() {
    this.items = [];
  }

  enqueue(track) {
    this.items.push(track);
    return this.items.length;
  }

  dequeue() {
    if (this.items.length === 0) {
      return null;
    }

    return this.items.shift();
  }

  clear() {
    this.items = [];
  }

  snapshot() {
    return this.items.map((item) => ({ ...item }));
  }

  get length() {
    return this.items.length;
  }
}

module.exports = {
  TrackQueue
};