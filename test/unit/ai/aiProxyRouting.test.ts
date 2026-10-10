import { afterEach, describe, expect, it } from 'vitest';
import { readConfiguredProxyUrl } from '../../../dev/ai/aiProxyRouting.mjs';

// 自托管服务器访问境外 AI 服务时,代理地址的读取顺序:显式配置 > 环境变量(Windows 系统代理在最后,这里不碰)。

const PROXY_ENV = ['AI_PROXY_URL', 'HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy'];
const saved = Object.fromEntries(PROXY_ENV.map(key => [key, process.env[key]]));

afterEach(() => {
    for (const key of PROXY_ENV) {
        if (saved[key] === undefined) delete process.env[key];
        else process.env[key] = saved[key];
    }
});

const clearProxyEnv = () => PROXY_ENV.forEach(key => delete process.env[key]);

describe('readConfiguredProxyUrl', () => {
    it('adds a scheme to a bare host:port', () => {
        clearProxyEnv();
        process.env.AI_PROXY_URL = '127.0.0.1:7890';
        expect(readConfiguredProxyUrl()).toBe('http://127.0.0.1:7890');
    });

    it('keeps a full proxy url as given', () => {
        clearProxyEnv();
        process.env.HTTPS_PROXY = 'http://10.0.0.2:3128';
        expect(readConfiguredProxyUrl()).toBe('http://10.0.0.2:3128');
    });

    it('prefers the explicit AI proxy over the generic environment variables', () => {
        clearProxyEnv();
        process.env.AI_PROXY_URL = 'http://127.0.0.1:1111';
        process.env.HTTPS_PROXY = 'http://127.0.0.1:2222';
        expect(readConfiguredProxyUrl()).toBe('http://127.0.0.1:1111');
    });

    it('ignores a SOCKS proxy it cannot use', () => {
        clearProxyEnv();
        process.env.AI_PROXY_URL = 'socks5://127.0.0.1:1080';
        // 不可用的显式配置不会被当成代理;结果只可能是 null 或系统代理(这里不关心具体值)
        expect(readConfiguredProxyUrl()).not.toBe('socks5://127.0.0.1:1080');
    });
});
