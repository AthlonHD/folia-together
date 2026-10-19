'use strict';

// scripts/stageServices.cjs
// Which Netease API stage-all.cjs starts. The repository's own (scripts/start-netease-api.cjs, the same code and patches as the desktop app)
// is the default; an external api-enhanced folder is used only when API_DIR names a folder that really has an app.js.
//
// A setting that does not point at an api-enhanced folder falls back to the repository's API instead of starting something that exits at once:
// the launcher itself used to export API_DIR for its own working directory, and that made the API fail to start.

const path = require('path');

/**
 * @param {{ env: Record<string, string | undefined>, repo: string, exists?: (file: string) => boolean }} options
 * @returns {{ service: { name: string, cwd: string, cmd: string, env: Record<string, string> }, note?: string }}
 */
function resolveNeteaseService({ env, repo, exists = require('fs').existsSync }) {
    const legacyDir = (env.API_DIR || '').trim();
    if (legacyDir && exists(path.join(legacyDir, 'app.js'))) {
        return {
            service: { name: 'API  ', cwd: legacyDir, cmd: 'node app.js', env: { ENABLE_GENERAL_UNBLOCK: 'false', PORT: '4000' } },
        };
    }
    return {
        service: { name: 'API  ', cwd: repo, cmd: 'node scripts/start-netease-api.cjs', env: { NETEASE_PORT: '4000' } },
        note: legacyDir ? `API_DIR is set to "${legacyDir}" but there is no app.js in it; using the Netease API of this repository` : undefined,
    };
}

module.exports = { resolveNeteaseService };
