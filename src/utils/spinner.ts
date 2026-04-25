const FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
const INTERVAL_MS = 80;

export class Spinner {
  private timer: ReturnType<typeof setInterval> | undefined;
  private frame = 0;
  private label: string;
  private readonly tty: boolean;

  constructor(label: string) {
    this.label = label;
    this.tty = process.stderr.isTTY ?? false;
  }

  update(label: string): void {
    this.label = label;
  }

  start(): void {
    if (!this.tty) return;
    this.frame = 0;
    this.timer = setInterval(() => {
      process.stderr.write(`\r${FRAMES[this.frame % FRAMES.length]} ${this.label}`);
      this.frame++;
    }, INTERVAL_MS);
  }

  stop(): void {
    if (!this.tty) return;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
    process.stderr.write('\r\x1b[K');
  }
}

export async function withSpinner<T>(label: string, fn: () => Promise<T>): Promise<T> {
  const spinner = new Spinner(label);
  spinner.start();
  try {
    return await fn();
  } finally {
    spinner.stop();
  }
}
