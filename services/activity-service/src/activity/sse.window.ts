/**
 * Remembers the sequences already written to one stream, so the live hub and the periodic
 * catch-up read cannot emit the same row twice. It is bounded: a stream that falls very far
 * behind may re-send a row rather than grow without limit, and every frame carries an id a
 * client can key on.
 */
export class SentWindow {
  private readonly seen = new Set<number>();
  private readonly order: number[] = [];
  private highest: number | null = null;

  constructor(private readonly capacity = 1024) {}

  has(seq: number): boolean {
    return this.seen.has(seq);
  }

  add(seq: number): void {
    if (this.seen.has(seq)) {
      return;
    }
    this.seen.add(seq);
    this.order.push(seq);
    this.highest = this.highest === null ? seq : Math.max(this.highest, seq);

    if (this.order.length > this.capacity) {
      const dropped = this.order.shift();
      if (dropped !== undefined) {
        this.seen.delete(dropped);
      }
    }
  }

  /** The furthest sequence this stream has delivered, used as the saved resume point. */
  get reached(): number | null {
    return this.highest;
  }
}
