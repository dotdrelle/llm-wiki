const FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
const INTERVAL_MS = 40;

export class Spinner {
  private timer: ReturnType<typeof setInterval> | undefined;
  private frame = 0;
  private label: string;
  private subLabel: string | (() => string) | undefined;
  private readonly tty: boolean;
  private subWritten = false;

  constructor(label: string) {
    this.label = label;
    this.tty = process.stderr.isTTY ?? false;
  }

  update(label: string): void {
    this.label = label;
  }

  updateSub(label: string | (() => string) | undefined): void {
    const wasEmpty = this.subLabel === undefined;
    this.subLabel = label;
    if (wasEmpty && label !== undefined && this.timer !== undefined) {
      this.render();
    }
  }

  start(): void {
    if (!this.tty) return;
    this.frame = 0;
    this.subWritten = false;
    this.timer = setInterval(() => this.render(), INTERVAL_MS);
  }

  private render(): void {
    const up = this.subWritten ? '\x1b[1A' : '';
    const spinFrame = FRAMES[this.frame % FRAMES.length];
    this.frame++;

    const sub = typeof this.subLabel === 'function' ? this.subLabel() : this.subLabel;

    if (sub !== undefined) {
      process.stderr.write(`${up}\r${spinFrame} ${this.label}\x1b[K\n  ${sub}\x1b[J`);
      this.subWritten = true;
    } else {
      process.stderr.write(`${up}\r${spinFrame} ${this.label}\x1b[K\x1b[J`);
      this.subWritten = false;
    }
  }

  stop(): void {
    if (!this.tty) return;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
    const up = this.subWritten ? '\x1b[1A' : '';
    process.stderr.write(`${up}\r\x1b[J`);
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
