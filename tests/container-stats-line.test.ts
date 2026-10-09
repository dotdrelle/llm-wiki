import { describe, expect, it } from 'vitest';
import { CONTAINER_STATS_SCRIPT } from '../src/chat/runtime/containerStatsScript.ts';
import { CHAT_HTML } from '../src/chat/chatHtml.ts';

const { containerStatsText } = new Function('$', `${CONTAINER_STATS_SCRIPT}\nreturn { containerStatsText };`)(() => null) as {
  containerStatsText: (stats: unknown) => { text: string; title: string };
};

describe('container stats line of the Run execution view', () => {
  it('sums the workspace containers on one line, details in the tooltip', () => {
    const { text, title } = containerStatsText({
      state: 'live', project: 'wiki-juno', containers: 2, cpuPercent: 142.3,
      memUsedBytes: 1.5 * 1024 ** 3, memLimitBytes: 8 * 1024 ** 3, netRxBytes: 12 * 1024 ** 2, netTxBytes: 3 * 1024 ** 2,
      perContainer: [{ name: 'wiki-juno-serve-1', cpuPercent: 100, memUsedBytes: 1024 ** 3 }],
    });
    expect(text).toBe('wiki-juno · 2 containers · CPU 142.3% · MEM 1.5 GiB / 8.0 GiB · NET ↓12.0 MiB ↑3.0 MiB');
    expect(title).toBe('wiki-juno-serve-1 — CPU 100.0% · MEM 1.0 GiB');
  });

  it('says why there is nothing to show', () => {
    expect(containerStatsText({ state: 'unavailable', error: 'docker command not found' }))
      .toEqual({ text: 'Container stats unavailable', title: 'docker command not found' });
    expect(containerStatsText({ state: 'empty', project: 'wiki-juno' }).text).toBe('wiki-juno · no container running');
  });

  it('sits in the canvas, polled only while on screen', () => {
    expect(CHAT_HTML).toContain('id="runtime-graph-stats"');
    expect(CONTAINER_STATS_SCRIPT).toContain("stage.offsetParent===null||document.hidden");
    expect(CONTAINER_STATS_SCRIPT).toContain("fetch('/api/runtime/workspace-stats'");
  });
});
