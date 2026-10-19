// src/components/app/togetherUpdate/buildCommit.ts
// The commit this build was made from (set at build time by vite), 'dev' when run from a working tree.

export const getBuildCommit = (): string => (typeof __BUILD_COMMIT__ === 'undefined' ? 'dev' : __BUILD_COMMIT__);
