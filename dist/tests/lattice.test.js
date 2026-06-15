import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import { findLatticeDir, listLatticeFiles, parseSections, } from '../src/lattice.js';
const basicDir = join(import.meta.dirname, 'cases', 'basic-project');
const basicLat = join(basicDir, 'lat.md');
describe('findLatticeDir', () => {
    it('finds .lat in the given directory', () => {
        expect(findLatticeDir(basicDir)).toBe(basicLat);
    });
    it('returns null when no .lat exists', () => {
        expect(findLatticeDir('/')).toBeNull();
    });
});
describe('listLatticeFiles', () => {
    it('lists .md files sorted alphabetically', async () => {
        const files = await listLatticeFiles(basicLat);
        expect(files).toEqual([
            join(basicLat, 'dev-process.md'),
            join(basicLat, 'notes.md'),
        ]);
    });
});
describe('parseSections', () => {
    it('handles multiple top-level headings', () => {
        const sections = parseSections('multi.md', '# First\n\n# Second\n');
        expect(sections).toHaveLength(2);
        expect(sections[0].id).toBe('multi#First');
        expect(sections[1].id).toBe('multi#Second');
    });
    it('uses file stem without .md extension', () => {
        const sections = parseSections('/path/to/notes.md', '# Hello');
        expect(sections[0].file).toBe('notes');
    });
});
