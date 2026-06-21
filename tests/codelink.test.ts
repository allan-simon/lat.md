import { describe, it, expect, afterEach } from 'vitest';
import {
  splitSourceTarget,
  isSourceFileTarget,
  blobUrl,
  sourceHrefFor,
  detectRepo,
  type Repo,
} from '../src/codelink.js';

const repo: Repo = { base: 'https://github.com/o/r', ref: 'abc123' };

// @lat: [[tests/codelink#Target parsing]]
describe('splitSourceTarget / isSourceFileTarget', () => {
  it('splits file and symbol path', () => {
    expect(splitSourceTarget('src/foo.ts#bar')).toEqual({
      file: 'src/foo.ts',
      symbol: 'bar',
    });
    expect(splitSourceTarget('src/foo.ts')).toEqual({
      file: 'src/foo.ts',
      symbol: '',
    });
    expect(splitSourceTarget('src/a.ts#Cls#method').symbol).toBe('Cls#method');
  });

  it('detects source-file targets by extension', () => {
    expect(isSourceFileTarget('src/foo.ts#bar')).toBe(true);
    expect(isSourceFileTarget('lib/app.py')).toBe(true);
    expect(isSourceFileTarget('cli#search#Hybrid Search')).toBe(false);
  });
});

// @lat: [[tests/codelink#Blob URLs]]
describe('blobUrl / sourceHrefFor', () => {
  it('builds a blob URL with and without a line', () => {
    expect(blobUrl(repo, 'src/x.ts', 5)).toBe(
      'https://github.com/o/r/blob/abc123/src/x.ts#L5',
    );
    expect(blobUrl(repo, 'src/x.ts')).toBe(
      'https://github.com/o/r/blob/abc123/src/x.ts',
    );
  });

  it('sourceHrefFor returns a line-pinned URL, or null without a repo', () => {
    const lineMap = new Map([['src/x.ts#foo', 12]]);
    const withRepo = sourceHrefFor(repo, lineMap);
    expect(withRepo('src/x.ts#foo')).toBe(
      'https://github.com/o/r/blob/abc123/src/x.ts#L12',
    );
    // unknown symbol → file link without a line
    expect(withRepo('src/x.ts#bar')).toBe(
      'https://github.com/o/r/blob/abc123/src/x.ts',
    );
    expect(sourceHrefFor(null, lineMap)('src/x.ts#foo')).toBeNull();
  });
});

// @lat: [[tests/codelink#Repo detection]]
describe('detectRepo', () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
  });

  it('uses GitHub Actions env when present', () => {
    process.env.GITHUB_REPOSITORY = 'o/r';
    process.env.GITHUB_SHA = 'deadbeef';
    delete process.env.GITHUB_SERVER_URL;
    expect(detectRepo('/tmp')).toEqual({
      base: 'https://github.com/o/r',
      ref: 'deadbeef',
    });
  });
});
