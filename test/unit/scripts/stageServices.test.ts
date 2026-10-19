import { createRequire } from 'node:module';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// test/unit/scripts/stageServices.test.ts
// Which Netease API the server starts: the repository's, unless API_DIR names a real api-enhanced folder.

const require = createRequire(import.meta.url);
const { resolveNeteaseService } = require('../../../scripts/stageServices.cjs') as typeof import('../../../scripts/stageServices.cjs');

const REPO = 'C:/repo';

describe('resolveNeteaseService', () => {
    it('runs the repository\'s Netease API when API_DIR is not set', () => {
        const { service, note } = resolveNeteaseService({ env: {}, repo: REPO, exists: () => false });
        expect(service.cmd).toBe('node scripts/start-netease-api.cjs');
        expect(service.cwd).toBe(REPO);
        expect(service.env).toEqual({ NETEASE_PORT: '4000' });
        expect(note).toBeUndefined();
    });

    it('uses an external api-enhanced folder only when API_DIR holds an app.js', () => {
        const { service } = resolveNeteaseService({ env: { API_DIR: 'D:/api-enhanced' }, repo: REPO, exists: (file: string) => file === path.join('D:/api-enhanced', 'app.js') });
        expect(service.cmd).toBe('node app.js');
        expect(service.cwd).toBe('D:/api-enhanced');
        expect(service.env).toMatchObject({ PORT: '4000', ENABLE_GENERAL_UNBLOCK: 'false' });
    });

    it('does not start something that exits at once when API_DIR is not an api-enhanced folder (it was the repository itself)', () => {
        const { service, note } = resolveNeteaseService({ env: { API_DIR: REPO }, repo: REPO, exists: () => false });
        expect(service.cmd).toBe('node scripts/start-netease-api.cjs');
        expect(note).toMatch(/no app\.js/);
    });

    it('ignores a blank API_DIR', () => {
        expect(resolveNeteaseService({ env: { API_DIR: '  ' }, repo: REPO, exists: () => true }).service.cmd).toBe('node scripts/start-netease-api.cjs');
    });
});
