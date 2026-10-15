// src/utils/forkVersion.ts
// 本 Fork 自己的版本号(根目录 FORK_VERSION,由 vite define 在构建期注入),与上游的 package.json 版本互不影响:
// 上游版本号照旧标明基于哪一版上游,Fork 版本号记录本 Fork 自己的功能与修复迭代。
// 没有 define 的环境(单测等)返回 null。

export const getForkVersion = (): string | null => {
    const version = typeof __FORK_VERSION__ === 'undefined' ? '' : __FORK_VERSION__;
    return /^\d+\.\d+\.\d+$/.test(version) ? version : null;
};
