/**
 * Sequentieller Rate-Limiter für die Notion API.
 * Erzwingt einen Mindestabstand (minIntervalMs) zwischen API-Aufrufen.
 */
export class NotionRateLimiter {
  private lastRequestTime = 0;
  private minIntervalMs: number;
  private sleepFn: (ms: number) => Promise<void>;
  private chain = Promise.resolve();

  constructor(
    minIntervalMs: number,
    sleepFn: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
  ) {
    this.minIntervalMs = minIntervalMs;
    this.sleepFn = sleepFn;
  }

  /**
   * Reiht eine asynchrone Operation in die Warteschlange ein.
   * Wartet bei Bedarf, um das Mindestintervall einzuhalten.
   */
  public schedule<T>(fn: () => Promise<T>): Promise<T> {
    const nextInChain = () =>
      new Promise<T>((resolve, reject) => {
        const run = async () => {
          const now = Date.now();
          const elapsed = now - this.lastRequestTime;
          const waitTime = this.minIntervalMs - elapsed;

          if (waitTime > 0) {
            await this.sleepFn(waitTime);
          }

          try {
            const result = await fn();
            resolve(result);
          } catch (err) {
            reject(err);
          } finally {
            this.lastRequestTime = Date.now();
          }
        };
        run().catch(reject);
      });

    const resultPromise = this.chain.then(nextInChain);

    // Verhindere, dass Fehler in der Kette zukünftige Aufrufe blockieren
    this.chain = resultPromise.then(
      () => {},
      () => {}
    );

    return resultPromise;
  }
}
