/**
 * A neuma watches and listens (Design note, 2026-11-14: the pure half of watch-plan.js. The clock a being
 * writes, the part one call covers, captions read into lines (YouTube's rolling automatic captions
 * said once), the downloader's arguments (never a machine's own yt-dlp config or plugins, always the
 * guarded proxy, the link after `--`), what a failure means, and the pins.
 */
import { describe, expect, test } from 'vitest';
import {
  MAX_WINDOW_S, WINDOW_S, clock, fetchFailure, ffmpegFor, isWatchableUrl, linesIn, momentsIn, paragraphs, parseCaptions, parseClock,
  watchedFileName, windowOf, ytDlpArgs, ytDlpFor,
} from '../../backend/services/watch/watch-plan.js';

describe('the clock', () => {
  test('reads the ways a being writes a time', () => {
    expect(parseClock('12:30')).toBe(750);
    expect(parseClock('1:02:03')).toBe(3723);
    expect(parseClock('90')).toBe(90);
    expect(parseClock('90s')).toBe(90);
    expect(parseClock('1h2m3s')).toBe(3723);
    expect(parseClock('2m')).toBe(120);
    expect(parseClock(45)).toBe(45);
    expect(parseClock('')).toBeNull();
    expect(parseClock('soon')).toBeNull();
    expect(parseClock('1:2:3:4')).toBeNull();
  });

  test('writes m:ss, and h:mm:ss past an hour', () => {
    expect(clock(0)).toBe('0:00');
    expect(clock(75.9)).toBe('1:15');
    expect(clock(3723)).toBe('1:02:03');
  });
});

describe('the part one call covers', () => {
  test('ten minutes from the start, then from where the last part ended, never past the end', () => {
    expect(windowOf({ duration: 3130 })).toEqual({ start: 0, end: WINDOW_S, last: false });
    expect(windowOf({ from: '50:00', duration: 3130 })).toEqual({ start: 3000, end: 3130, last: true });
    expect(windowOf({ from: '10:00', to: '2:00:00', duration: 9000 })).toEqual({ start: 600, end: 600 + MAX_WINDOW_S, last: false });
    // asked past the end: the last part is given, not nothing
    expect(windowOf({ from: '9:00:00', duration: 3130 })).toMatchObject({ start: 3130 - WINDOW_S, end: 3130, last: true });
    // a length nobody knows
    expect(windowOf({ duration: null })).toEqual({ start: 0, end: WINDOW_S, last: false });
  });

  test('frames are spread evenly across a part, the first at its start', () => {
    expect(momentsIn(0, 90, 9)).toEqual([0, 10, 20, 30, 40, 50, 60, 70, 80]);
    expect(momentsIn(10, 10, 4)).toEqual([]);
  });
});

describe('captions', () => {
  // the shape YouTube's automatic captions take: each cue repeats the line before it, with timing tags
  const ROLLING = `WEBVTT
Kind: captions
Language: en

00:00:00.320 --> 00:00:02.990 align:start position:0%
 
the<00:00:00.640><c> central</c><00:00:01.040><c> bank</c><00:00:01.360><c> raised</c><00:00:01.680><c> rates</c>

00:00:02.990 --> 00:00:03.000 align:start position:0%
the central bank raised rates


00:00:03.000 --> 00:00:05.990 align:start position:0%
the central bank raised rates
again<00:00:03.400><c> in</c><00:00:03.600><c> March</c>

00:00:25.000 --> 00:00:27.000
A new &amp; separate point.
`;

  test('a rolling automatic track is said once, its tags gone', () => {
    expect(parseCaptions(ROLLING)).toEqual([
      { at: 0.32, text: 'the central bank raised rates' },
      { at: 3, text: 'again in March' },
      { at: 25, text: 'A new & separate point.' },
    ]);
  });

  test('SRT reads the same, and lines gather into timed paragraphs', () => {
    const srt = '1\n00:00:01,000 --> 00:00:02,000\nHello there.\n\n2\n00:00:03,500 --> 00:00:04,000\nGeneral Kenobi.\n\n3\n00:01:10,000 --> 00:01:12,000\n<i>Later.</i>\n';
    const lines = parseCaptions(srt);
    expect(lines).toEqual([{ at: 1, text: 'Hello there.' }, { at: 3.5, text: 'General Kenobi.' }, { at: 70, text: 'Later.' }]);
    expect(paragraphs(lines)).toEqual([{ at: 1, text: 'Hello there. General Kenobi.' }, { at: 70, text: 'Later.' }]);
    expect(linesIn(paragraphs(lines), 60, 120)).toEqual([{ at: 70, text: 'Later.' }]);
  });
});

describe('the downloader', () => {
  const base = { dir: '/data/watch/cache/k', proxy: 'http://127.0.0.1:4567', cacheDir: '/data/watch/tools/yt-dlp-cache' };

  test('ignores any yt-dlp config and plugin, goes only through the guarded proxy, and takes the link after --', () => {
    const args = ytDlpArgs({ ...base, url: 'https://www.youtube.com/watch?v=abc', want: 'video', ffmpegDir: '/x/ffmpeg', jsRuntime: '/opt/neuma/neuma' });
    for (const flag of ['--ignore-config', '--no-plugin-dirs', '--no-update', '--no-playlist']) expect(args).toContain(flag);
    expect(args[args.indexOf('--proxy') + 1]).toBe(base.proxy);
    expect(args[args.indexOf('--downloader') + 1]).toBe('native');
    expect(args[args.indexOf('--js-runtimes') + 1]).toBe('node:/opt/neuma/neuma');
    expect(args[args.indexOf('--ffmpeg-location') + 1]).toBe('/x/ffmpeg');
    expect(args.slice(-2)).toEqual(['--', 'https://www.youtube.com/watch?v=abc']);
    expect(args).not.toContain('--exec');
  });

  test('asks first for the record and the captions only; listening asks for the sound only', () => {
    const info = ytDlpArgs({ ...base, url: 'https://x.com/a/status/1', want: 'info' });
    expect(info).toEqual(expect.arrayContaining(['--skip-download', '--write-info-json', '--write-subs', '--write-auto-subs']));
    const audio = ytDlpArgs({ ...base, url: 'https://soundcloud.com/a/b', want: 'audio' });
    expect(audio[audio.indexOf('--format') + 1]).toBe('ba/b');
  });

  test('takes an http or https link and nothing else', () => {
    expect(isWatchableUrl('https://vimeo.com/1')).toBe(true);
    expect(isWatchableUrl('file:///etc/passwd')).toBe(false);
    expect(isWatchableUrl('--exec=rm -rf ~')).toBe(false);
    expect(() => ytDlpArgs({ ...base, url: 'file:///etc/passwd', want: 'info' })).toThrow(/http or https/);
  });

  test('a failure says what it means, and asks for the update only when the site changed', () => {
    expect(fetchFailure('WARNING: x\nERROR: Unsupported URL: https://example.com/')).toMatchObject({ stale: false, why: /no video or audio/ });
    expect(fetchFailure('ERROR: [youtube] abc: Sign in to confirm your age')).toMatchObject({ stale: false, why: /signed-in account/ });
    expect(fetchFailure('ERROR: [youtube] abc: Unable to extract nsig function code')).toMatchObject({ stale: true });
    expect(fetchFailure("ERROR: [youtube] abc: Sign in to confirm you're not a bot")).toMatchObject({ stale: true, why: /not a bot/ });
    expect(fetchFailure('ERROR: Unable to download webpage: Tunnel connection failed: 403 refused by the platform')).toMatchObject({ why: /inside this computer/ });
  });

  test('the transcript is filed under its date and title', () => {
    expect(watchedFileName('Fed Chair: Press Conference (March 2026)!', new Date('2026-11-14T09:00:00Z'))).toBe('2026-11-14-fed-chair-press-conference-march-2026.md');
  });
});

describe('the pins', () => {
  test('yt-dlp and ffmpeg are pinned for Linux, Windows and macOS, each to a size and a SHA-256', () => {
    for (const [platform, arch] of [['linux', 'x64'], ['win32', 'x64'], ['darwin', 'arm64'], ['linux', 'arm64']]) {
      const yt = ytDlpFor(platform, arch);
      expect(yt.url).toMatch(/^https:\/\/github\.com\/yt-dlp\/yt-dlp\/releases\/download\/\d{4}\.\d{2}\.\d{2}\//);
      expect(yt.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(yt.size).toBeGreaterThan(1e7);
      const ff = ffmpegFor(platform, arch);
      for (const tool of [ff.ffmpeg, ff.ffprobe]) {
        expect(tool.sha256).toMatch(/^[0-9a-f]{64}$/);
        expect(tool.url).toMatch(/^https:\/\/github\.com\/eugeneware\/ffmpeg-static\/releases\/download\/b6\.1\.1\/ff(mpeg|probe)-/);
      }
    }
    expect(ytDlpFor('win32', 'x64').bin).toBe('yt-dlp.exe');
    expect(ffmpegFor('win32', 'x64').ffmpeg.bin).toBe('ffmpeg.exe');
    expect(ytDlpFor('aix', 'ppc64')).toBeNull();
  });
});
