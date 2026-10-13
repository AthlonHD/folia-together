import type { LocalSong } from '../types';
import { isValidLocalCoverAssetId, isLocalCoverWebRuntimeSupported } from './localCoverBinaryStore';
import { getSizedCoverUrl } from '../utils/coverUrl';
import { isStageRemoteMode } from './stageRemote';
import { withStageTokenQuery } from './stageMode';

// src/services/localCoverAssetUrl.ts
// Resolves content-addressed local covers to stable Electron or same-origin Web resource URLs.

const WEB_COVER_PATH_PREFIX = '/__folia_cover/';
// 遥控模式下封面由 Host 经中继提供(见 hostLocalLibraryRpc);不用 /__folia_cover/,
// 因为遥控页所在的源上可能注册过本地封面的 Service Worker,会把那个路径当成本机封面去读
const HOST_COVER_PATH_PREFIX = '/stage/local/cover/';

const hasElectronCoverProtocol = (): boolean => (
  typeof window !== 'undefined' && typeof window.electron?.hasLocalCoverAsset === 'function'
);

export const getLocalCoverAssetUrl = (assetId: string | undefined, size?: number): string | null => {
  if (!isValidLocalCoverAssetId(assetId)) return null;
  let url: string;
  if (isStageRemoteMode()) {
    // 图片请求带不了请求头,令牌放在查询参数里
    url = withStageTokenQuery(`${HOST_COVER_PATH_PREFIX}${encodeURIComponent(assetId)}`);
  } else if (hasElectronCoverProtocol()) {
    url = `folia-cover://asset/${encodeURIComponent(assetId)}`;
  } else {
    if (!isLocalCoverWebRuntimeSupported()) return null;
    url = `${WEB_COVER_PATH_PREFIX}${encodeURIComponent(assetId)}`;
  }
  return size ? getSizedCoverUrl(url, size) : url;
};

export const isLocalCoverAssetUrl = (url: string | null | undefined): url is string => (
  typeof url === 'string'
  && (url.startsWith('folia-cover://asset/') || url.startsWith(WEB_COVER_PATH_PREFIX) || url.startsWith(HOST_COVER_PATH_PREFIX))
);

export const getPreferredLocalSongCoverUrl = (song: LocalSong): string | null => {
  const localCoverUrl = getLocalCoverAssetUrl(song.localCoverAssetId, 1024);
  return song.useOnlineCover
    ? song.onlineMetadata?.coverUrl || localCoverUrl
    : localCoverUrl || song.onlineMetadata?.coverUrl || null;
};
