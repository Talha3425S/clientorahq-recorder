// Where recorded chunks go. MemorySink is the default; swap in an IndexedDB
// sink for the library so a long recording is not held in RAM.
export interface ChunkSink {
  readonly id?: string;
  add(chunk: Blob): void | Promise<void>;
  finish(type: string): Promise<Blob>;
  discard(): void | Promise<void>;
}

export class MemorySink implements ChunkSink {
  private parts: Blob[] = [];
  add(chunk: Blob) {
    this.parts.push(chunk);
  }
  async finish(type: string) {
    return new Blob(this.parts, { type });
  }
  discard() {
    this.parts = [];
  }
}