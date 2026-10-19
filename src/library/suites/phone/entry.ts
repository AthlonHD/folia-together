import React from 'react';
import type { LibrarySuiteManifest } from '../../core/suite/suite.contract';

// src/library/suites/phone/entry.ts
// 手机版 suite(deviceOnly:不出现在选项里,也不改写用户的 suite 选择;手机布局生效时宿主直接用它)。
// 只实现集合页与歌手页:竖向列表,点整行播放、「+」入队;首页与账户沿用默认 suite(网格)。
// 数据、筛选、播放范围全部来自 Library Core,与网格 / TUI 共用同一套资源与动作。
// 没有信息面板、编辑模式、批量管理、排序等桌面向的功能——这些动作在手机集合页里没有入口(声明里不列)。

const PhoneCollectionSurface = React.lazy(() => import('./PhoneCollectionSurface'));
const PhoneArtistSurface = React.lazy(() => import('./PhoneArtistSurface'));

const phone: LibrarySuiteManifest = {
    id: 'phone',
    labelKey: 'libraryTui.rendererPhone',
    deviceOnly: 'phone',
    surfaces: {
        collection: {
            component: PhoneCollectionSurface,
            actions: [
                'play',
                'enqueue',
                'play-scope',
                'enqueue-scope',
                'filter',
                'reload',
                'resume-sync',
                'remove-entry',
                'subscribe',
                'rename',
                'delete-collection',
                'open-album',
                'open-artist',
            ],
        },
        artist: {
            component: PhoneArtistSurface,
            actions: ['play', 'enqueue', 'play-scope', 'enqueue-scope', 'filter', 'reload', 'resume-sync', 'open-album', 'open-artist'],
        },
    },
};

export default phone;
