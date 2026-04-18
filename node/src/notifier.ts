export class Notifier {
  private resolvers: Array<() => void> = [];

  wait(): Promise<void> {
    return new Promise<void>((resolve) => {
      this.resolvers.push(resolve);
    });
  }

  notify(): void {
    const pending = this.resolvers;
    this.resolvers = [];
    for (const r of pending) r();
  }

  get waiters(): number {
    return this.resolvers.length;
  }
}
