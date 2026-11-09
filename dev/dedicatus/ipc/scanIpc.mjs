import fs from 'node:fs';
import path from 'node:path';
// dev/dedicatus/ipc/scanIpc.mjs
// 读出主进程注册的 IPC 通道和 preload 调用的通道（零依赖，按文本扫描）。D605（通道的信任级别与来源校验）和
// D606（preload 与主进程对得上）的契约测试用它。识别字符串字面量和本文件的字符串常量；循环里拼出的通道名认不出。

const listCjs = (root, dir) => fs.readdirSync(path.join(root, dir), { withFileTypes: true }).flatMap(entry => {
    const relative = path.posix.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === 'node_modules' ? [] : listCjs(root, relative);
    return entry.name.endsWith('.cjs') ? [relative] : [];
});

const lineOf = (text, index) => text.slice(0, index).split('\n').length;

/**
 * 收 `event` 的守卫开头，前面允许有注释：第一条语句是 `if (!isX(event))` / `if (!isX(event.sender))`
 * （前面可以用 `||` 连着别的条件，比如只在某个平台上开放：`if (process.platform !== 'win32' || !isX(event.sender))`；
 * `&&` 连着的不算，那样只在条件成立时才校验），或者 `assertX(event)`。
 */
const GUARD_FIRST_STATEMENT = /^(?:async\s+)?(?:function\s*\w*\s*)?\(?\s*(?:event|_event|e)\b[^{]*\{\s*(?:\/\/[^\n]*\n\s*)*(?:if\s*\(\s*(?:[^{&]*?\|\|\s*)?!\s*is\w+\(\s*(?:event|e)(?:\.sender)?\s*\)|assert\w*\(\s*(?:event|e)\s*\))/;
/** 表达式体直接按来源二选一：`(event) => (isX(event.sender) ? 真的值 : 受限的值)`。 */
const GUARD_TERNARY = /^(?:async\s+)?\(?\s*(?:event|e)\s*\)?\s*=>\s*\(?\s*is\w+\(\s*(?:event|e)(?:\.sender)?\s*\)\s*\?/;
/** HiFi 读回应只接受原请求页面：参数检查和 pendingReads 查找之后，先拒绝不同 sender，再交回字节。 */
const GUARD_PENDING_READ = /^\(event, readId, response\) => \{\s*if \(typeof readId !== 'string'\) throw [^;]+;\s*const read = pendingReads\.get\(readId\);\s*if \(!read\) return;\s*if \(event\?\.sender\?\.id !== read\.webContentsId\) \{\s*throw new Error\(/;

/**
 * 校验来源的处理函数工厂：名字 → 定义它的文件、它交给 isTrusted 的是什么（event 还是 webContents）、
 * 工厂本身校验来源的那一句。契约测试读这些文件，确认工厂还在校验。
 * @type {Record<string, { file: string, trustedTakes: 'event' | 'webContents', check: RegExp }>}
 */
export const GUARD_FACTORIES = {
    createSenderGuardedHandler: { file: 'electron/ipcAccessGuard.cjs', trustedTakes: 'event', check: /if \(!isTrusted\(event\)\)/ },
    createCompanionRequestHandler: { file: 'electron/appleMusic/companionIpc.cjs', trustedTakes: 'webContents', check: /if \(!isTrusted\(event\.sender\)/ },
};

const FACTORY_NAMES = Object.keys(GUARD_FACTORIES).join('|');
/** 同一文件里直接交回守卫工厂结果的本地包装：`const guarded = (…) => createSenderGuardedHandler(`、`function guarded(…) { return createSenderGuardedHandler(`。 */
const LOCAL_WRAPPERS = new RegExp(String.raw`(?:\b(?:const|let)\s+(\w+)\s*=\s*(?:\([^)]*\)|\w+)\s*=>\s*\(?\s*|\bfunction\s+(\w+)\s*\([^)]*\)\s*\{\s*return\s+)(${FACTORY_NAMES})\(`, 'g');
/** 本地注册包装：第一条语句就将 channel 和处理函数交给来源守卫，不把任意同名函数当成守卫。 */
const LOCAL_REGISTRARS = new RegExp(String.raw`\bconst\s+(\w+)\s*=\s*\(\s*(\w+)\s*,[^)]*\)\s*=>\s*\{\s*ipcMain\.(handle|on|handleOnce|once)\(\s*\2\s*,\s*(${FACTORY_NAMES})\(`, 'g');
/** 交给工厂的判断函数：只认 `isTrusted: isX` 这种直接给名字的；写成箭头函数的自己决定交什么，不追究（null）。 */
const trustedCheckOf = text => /isTrusted:\s*([\w.]+)\b(?!\s*\()/.exec(text)?.[1] ?? null;

/**
 * 本文件里守卫工厂的本地包装（#654：同一组通道共用一个 `guarded(channel, handler)`）：包装名 → 工厂、交给工厂的判断函数。
 * @returns {Map<string, { factory: string, isTrusted: string | null }>}
 */
const localWrappers = text => {
    const wrappers = new Map();
    for (const match of text.matchAll(LOCAL_WRAPPERS)) {
        const body = text.slice(match.index, match.index + match[0].length + 600);
        wrappers.set(match[1] ?? match[2], { factory: match[3], isTrusted: trustedCheckOf(body) });
    }
    return wrappers;
};

/**
 * 主进程注册的通道。经本地包装交给守卫工厂的，factory 记工厂、via 记包装名。
 * @returns {{ file: string, line: number, channel: string, kind: string, guarded: boolean, factory: string | null, isTrusted: string | null, via?: string }[]}
 */
export function scanMainChannels(root) {
    const found = [];
    for (const file of listCjs(root, 'electron')) {
        if (file === 'electron/preload.cjs') continue;
        const text = fs.readFileSync(path.join(root, file), 'utf8');
        const channelConstants = new Map([...text.matchAll(/\bconst\s+(\w+)\s*=\s*(['"`])([^'"`]+)\2\s*;/g)].map(match => [match[1], match[3]]));
        const wrappers = localWrappers(text);
        for (const registration of text.matchAll(LOCAL_REGISTRARS)) {
            const name = registration[1];
            const body = text.slice(registration.index + registration[0].length, registration.index + registration[0].length + 600);
            const calls = new RegExp(String.raw`\b${name}\(\s*(?:(['"\x60])([^'"\x60]+)\1|(\w+))\s*,`, 'g');
            for (const call of text.matchAll(calls)) {
                const channel = call[2] ?? channelConstants.get(call[3]);
                if (!channel) continue;
                found.push({
                    file,
                    line: lineOf(text, call.index),
                    channel,
                    kind: registration[3],
                    guarded: true,
                    factory: registration[4],
                    isTrusted: trustedCheckOf(body),
                    via: name,
                });
            }
        }
        for (const match of text.matchAll(/ipcMain\.(handle|on|handleOnce|once)\(\s*(?:(['"`])([^'"`]+)\2|(\w+))\s*,\s*/g)) {
            const channel = match[3] ?? channelConstants.get(match[4]);
            if (!channel) continue;
            const rest = text.slice(match.index + match[0].length, match.index + match[0].length + 600);
            const direct = Object.keys(GUARD_FACTORIES).find(name => rest.startsWith(`${name}(`)) ?? null;
            const via = direct ? null : [...wrappers.keys()].find(name => rest.startsWith(`${name}(`)) ?? null;
            const factory = direct ?? (via ? wrappers.get(via).factory : null);
            found.push({
                file,
                line: lineOf(text, match.index),
                channel,
                kind: match[1],
                guarded: factory !== null || GUARD_FIRST_STATEMENT.test(rest) || GUARD_TERNARY.test(rest) || GUARD_PENDING_READ.test(rest),
                factory,
                isTrusted: direct ? trustedCheckOf(rest) : via ? wrappers.get(via).isTrusted : null,
                ...(via ? { via } : {}),
            });
        }
    }
    return found;
}

/**
 * preload 调用的通道。
 * @returns {{ line: number, channel: string, kind: string }[]}
 */
export function scanPreloadChannels(root) {
    const text = fs.readFileSync(path.join(root, 'electron/preload.cjs'), 'utf8');
    return [...text.matchAll(/ipcRenderer\.(invoke|send|sendSync|on|once|removeListener|removeAllListeners)\(\s*(['"`])([^'"`]+)\2/g)]
        .map(match => ({ line: lineOf(text, match.index), channel: match[3], kind: match[1] }));
}
