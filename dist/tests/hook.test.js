import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { mkdtempSync, rmSync, writeFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
const casesDir = join(import.meta.dirname, 'cases');
const cliPath = join(import.meta.dirname, '..', 'dist', 'src', 'cli', 'index.js');
/** Build a numstat string from [added, removed, file] tuples. */
function numstat(files) {
    return files.map(([a, r, f]) => `${a}\t${r}\t${f}`).join('\n');
}
/** Create a temp dir with a fake `git` script that outputs the given numstat. */
function makeFakeGitDir(output) {
    const dir = mkdtempSync(join(tmpdir(), 'lat-hook-'));
    const gitScript = join(dir, 'git');
    writeFileSync(gitScript, '#!/bin/sh\n' + "cat <<'NUMSTAT'\n" + output + '\nNUMSTAT\n');
    chmodSync(gitScript, 0o755);
    return dir;
}
/** Run `lat hook <agent> <event>` against a test case dir. */
function runHook(agent, event, caseDir, opts = {}) {
    const stdinJson = JSON.stringify({
        stop_hook_active: opts.stopHookActive ?? false,
    });
    const env = {
        ...process.env,
    };
    if (opts.fakeBinDir) {
        env.PATH = opts.fakeBinDir + ':' + env.PATH;
    }
    const result = spawnSync('node', [cliPath, 'hook', agent, event], {
        cwd: caseDir,
        encoding: 'utf-8',
        input: stdinJson,
        env,
    });
    return {
        stdout: result.stdout ?? '',
        stderr: result.stderr ?? '',
        exitCode: result.status ?? 1,
    };
}
function runStopHook(agent, caseDir, opts = {}) {
    return runHook(agent, agent === 'claude' ? 'Stop' : 'stop', caseDir, opts);
}
const clean = join(casesDir, 'hook-clean');
const broken = join(casesDir, 'error-broken-links');
describe('hook stop', () => {
    // @lat: [[tests/hook#Exits silently when check passes and no diff]]
    it('exits silently when check passes and no diff', () => {
        const fakeBinDir = makeFakeGitDir('');
        try {
            const { stdout, stderr } = runStopHook('claude', clean, { fakeBinDir });
            expect(stdout).toBe('');
            expect(stderr).toBe('');
        }
        finally {
            rmSync(fakeBinDir, { recursive: true });
        }
    });
    // @lat: [[tests/hook#Blocks when lat check fails]]
    it('blocks when lat check fails', () => {
        const { stdout } = runStopHook('claude', broken);
        const parsed = JSON.parse(stdout);
        expect(parsed.decision).toBe('block');
        expect(parsed.reason).toContain('lat check');
        expect(parsed.reason).toContain('error');
    });
    // @lat: [[tests/hook#Blocks when code diff is large but lat.md/ not updated]]
    it('blocks when code diff is large but lat.md/ not updated', () => {
        const fakeBinDir = makeFakeGitDir(numstat([[80, 30, 'src/big-refactor.ts']]));
        try {
            const { stdout } = runStopHook('claude', clean, { fakeBinDir });
            const parsed = JSON.parse(stdout);
            expect(parsed.decision).toBe('block');
            expect(parsed.reason).toContain('110');
            expect(parsed.reason).toContain('lat.md/');
        }
        finally {
            rmSync(fakeBinDir, { recursive: true });
        }
    });
    // @lat: [[tests/hook#Exits silently when lat.md/ changes are proportional]]
    it('exits silently when lat.md/ changes are proportional', () => {
        const fakeBinDir = makeFakeGitDir(numstat([[60, 40, 'src/feature.ts'], [8, 2, 'lat.md/feature.md']]));
        try {
            const { stdout } = runStopHook('claude', clean, { fakeBinDir });
            expect(stdout).toBe('');
        }
        finally {
            rmSync(fakeBinDir, { recursive: true });
        }
    });
    // @lat: [[tests/hook#Exits silently when code diff is below threshold]]
    it('exits silently when code diff is below threshold', () => {
        const fakeBinDir = makeFakeGitDir(numstat([[2, 1, 'src/tiny.ts']]));
        try {
            const { stdout } = runStopHook('claude', clean, { fakeBinDir });
            expect(stdout).toBe('');
        }
        finally {
            rmSync(fakeBinDir, { recursive: true });
        }
    });
    // @lat: [[tests/hook#Blocks with both messages when check fails and diff needs sync]]
    it('blocks with both messages when check fails and diff needs sync', () => {
        const fakeBinDir = makeFakeGitDir(numstat([[50, 60, 'src/refactor.ts']]));
        try {
            const { stdout } = runStopHook('claude', broken, { fakeBinDir });
            const parsed = JSON.parse(stdout);
            expect(parsed.decision).toBe('block');
            expect(parsed.reason).toContain('Update `lat.md/`');
            expect(parsed.reason).toContain('lat check` until it passes');
        }
        finally {
            rmSync(fakeBinDir, { recursive: true });
        }
    });
    // @lat: [[tests/hook#Exits silently on second pass when check passes]]
    it('exits silently on second pass when check passes', () => {
        const { stdout, stderr } = runStopHook('claude', clean, {
            stopHookActive: true,
        });
        expect(stdout).toBe('');
        expect(stderr).toBe('');
    });
    // @lat: [[tests/hook#Prints stderr warning on second pass when check still fails]]
    it('prints stderr warning on second pass when check still fails', () => {
        const { stdout, stderr } = runStopHook('claude', broken, {
            stopHookActive: true,
        });
        expect(stdout).toBe('');
        expect(stderr).toContain('still failing');
    });
    // @lat: [[tests/hook#Ignores non-code files in diff]]
    it('ignores non-code files in diff', () => {
        const fakeBinDir = makeFakeGitDir(numstat([[150, 50, 'README.md']]));
        try {
            const { stdout } = runStopHook('claude', clean, { fakeBinDir });
            expect(stdout).toBe('');
        }
        finally {
            rmSync(fakeBinDir, { recursive: true });
        }
    });
    // @lat: [[tests/hook#Cursor stop hook returns follow-up work instead of a Claude block]]
    it('returns a Cursor follow-up message when stop needs more work', () => {
        const fakeBinDir = makeFakeGitDir(numstat([[80, 30, 'src/big-refactor.ts']]));
        try {
            const { stdout } = runStopHook('cursor', clean, { fakeBinDir });
            const parsed = JSON.parse(stdout);
            expect(parsed.followup_message).toContain('lat.md/');
            expect(parsed.followup_message).toContain('110');
            expect(parsed.decision).toBeUndefined();
        }
        finally {
            rmSync(fakeBinDir, { recursive: true });
        }
    });
});
