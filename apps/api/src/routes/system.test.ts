import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cpuPercent, parseMeminfo, parseProcStat } from './system.ts';

test('parseProcStat reads the summary cpu line', () => {
  assert.deepEqual(parseProcStat('cpu  100 0 50 800 50 0 0 0 0 0\ncpu0 1 2 3 4 5 6 7 8 9 10\n'), { busy: 150, total: 1000 });
  assert.equal(parseProcStat('nothing here'), undefined);
});

test('cpuPercent between two snapshots', () => {
  assert.equal(cpuPercent({ busy: 150, total: 1000 }, { busy: 350, total: 1500 }), 40);
  assert.equal(cpuPercent({ busy: 1, total: 1 }, { busy: 1, total: 1 }), 0);
  assert.equal(cpuPercent({ busy: 0, total: 0 }, { busy: 10, total: 10 }), 100);
});

test('parseMeminfo gives total and available in MB', () => {
  assert.deepEqual(parseMeminfo('MemTotal:       32768000 kB\nMemFree:  1000 kB\nMemAvailable:   16384000 kB\n'), { totalMb: 32000, availableMb: 16000 });
  assert.equal(parseMeminfo('MemTotal: 1 kB'), undefined);
});
