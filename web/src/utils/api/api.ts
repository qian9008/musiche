import {
  Music,
  MusicType,
  PlatformAPI,
  Playlist,
  PlaylistSearchItem,
  RankingType,
  UserInfo,
  LoginStatus,
  MusicQuality
} from '../type';
import * as cloud from './cloud';
import * as qq from './qq';
import * as migu from './migu';
import * as local from './local';

const musicAPI: Map<MusicType, PlatformAPI> = new Map([
  ['cloud', cloud as PlatformAPI],
  ['qq', qq as PlatformAPI],
  ['migu', migu as PlatformAPI],
  ['local', local as PlatformAPI]
]);

export async function search(
  type: MusicType,
  keywords: string,
  offset: number
): Promise<{
  total: number;
  list: Music[];
}> {
  const func = musicAPI.get(type)?.search;
  try {
    if (func) return await func(keywords, offset);
  } catch (e) {
    console.error(e);
  }
  return {
    total: 0,
    list: []
  };
}

export async function searchPlaylist(
  type: MusicType,
  keywords: string,
  offset: number
): Promise<{
  total: number;
  list: PlaylistSearchItem[];
}> {
  const func = musicAPI.get(type)?.searchPlaylist;
  try {
    if (func) return await func(keywords, offset);
  } catch (e) {
    console.error(e);
  }
  return {
    total: 0,
    list: []
  };
}

export async function recommend(
  type: MusicType,
  offset: number
): Promise<{
  total: number;
  list: Playlist[];
}> {
  const func = musicAPI.get(type)?.recommend;
  try {
    if (func) return await func(offset);
  } catch (e) {
    console.error(e);
  }
  return {
    total: 0,
    list: []
  };
}

export async function playlistDetail(
  type: MusicType,
  id: string,
  offset: number
): Promise<{
  total: number;
  list: Music[];
  playlist: Playlist | null;
}> {
  const func = musicAPI.get(type)?.playlistDetail;
  try {
    if (func) return await func(id, offset);
  } catch (e) {
    console.error(e);
  }
  return {
    total: 0,
    list: [],
    playlist: null
  };
}

export async function albumDetail(
  type: MusicType,
  id: string,
  offset: number
): Promise<{
  total: number;
  list: Music[];
  playlist: Playlist | null;
}> {
  const func = musicAPI.get(type)?.albumDetail;
  try {
    if (func) return await func(id, offset);
  } catch (e) {
    console.error(e);
  }
  return {
    total: 0,
    list: [],
    playlist: null
  };
}

export async function ranking(
  type: MusicType,
  ranking: RankingType,
  offset: number
): Promise<{
  total: number;
  list: Music[];
}> {
  const func = musicAPI.get(type)?.ranking;
  try {
    if (func) return await func(ranking, offset);
  } catch (e) {
    console.error(e);
  }
  return {
    total: 0,
    list: []
  };
}

export function rankingPlaylist(
  type: MusicType,
  ranking: RankingType
): Playlist | null {
  const func = musicAPI.get(type)?.rankingPlaylist;
  try {
    if (func) return func(ranking);
  } catch (e) {
    console.error(e);
  }
  return null;
}

export async function musicDetail(music: Music): Promise<Music | null> {
  const func = musicAPI.get(music.type)?.musicDetail;
  try {
    if (func) return await func(music);
  } catch (e) {
    console.error(e);
  }
  return null;
}

export async function qrCodeKey(type: MusicType): Promise<{
  key: string;
  url: string;
} | null> {
  const func = musicAPI.get(type)?.qrCodeKey;
  try {
    if (func) return await func();
  } catch (e) {
    console.error(e);
  }
  return null;
}

export async function loginStatus(
  type: MusicType,
  key: string
): Promise<{
  status: LoginStatus;
  user?: UserInfo;
}> {
  const func = musicAPI.get(type)?.loginStatus;
  try {
    if (func) return await func(key);
  } catch (e) {
    console.error(e);
  }
  return { status: 'fail' };
}

// 账号信息校验缓存：进入「我的音乐」会重复打平台接口（如网易云 nuser/account/get）。
// 同一 cookie 在 TTL 内复用结果；cookie 变化则 key 变化重新校验。
const userInfoCache = new Map<string, { time: number; value: UserInfo }>();
const USER_INFO_TTL = 5 * 60 * 1000;

export async function userInfo(
  type: MusicType,
  cookie: Record<string, string> | string
): Promise<UserInfo | null> {
  const cookieKey = typeof cookie === 'string' ? cookie : JSON.stringify(cookie);
  const cacheKey = type + ':' + cookieKey;
  const cached = userInfoCache.get(cacheKey);
  if (cached && Date.now() - cached.time < USER_INFO_TTL) return cached.value;
  const func = musicAPI.get(type)?.userInfo;
  try {
    if (func) {
      const result = await func(cookie);
      // 只缓存成功结果；失败时下次进页仍会重新校验并重置登录
      if (result) userInfoCache.set(cacheKey, { time: Date.now(), value: result });
      return result;
    }
  } catch (e) {
    console.error(e);
  }
  return null;
}

export async function yours(
  type: MusicType,
  offset: number
): Promise<{
  total: number;
  list: Playlist[];
}> {
  const func = musicAPI.get(type)?.yours;
  try {
    if (func) return await func(offset);
  } catch (e) {
    console.error(e);
  }
  return {
    total: 0,
    list: []
  };
}

export async function musicById(
  type: MusicType,
  id: string
): Promise<Music | null> {
  const func = musicAPI.get(type)?.musicById;
  try {
    if (func) return await func(id);
  } catch (e) {
    console.error(e);
  }
  return null;
}

export async function parseLink(link: string): Promise<{
  type: MusicType;
  linkType: 'playlist' | 'music';
  id: string;
} | null> {
  try {
    for (let key of musicAPI.keys()) {
      const func = musicAPI.get(key)?.parseLink;
      if (func) {
        const result = await func(link);
        if (result) {
          return {
            ...result,
            type: key
          };
        }
      }
    }
  } catch (e) {}
  return null;
}

const lyricCache = new Map<string, string>();
export async function lyric(music: Music): Promise<string> {
  const cache = lyricCache.get(music.type + music.id);
  if (cache) return cache;
  var text = '';
  try {
    text = (await musicAPI.get(music.type)?.lyric?.call(null, music)) || '';
  } catch (e) {
    console.error('get lyric err', e);
  }
  if (!text && music.type === 'local') {
    try {
      text =
        (await musicAPI.get('cloud')?.lyricFuzzyMatch?.call(null, music)) || '';
    } catch (e) {
      console.error('fuzzy match lyric err', e);
    }
  }
  if (text) {
    lyricCache.set(music.type + music.id, text);
    return text;
  }
  return '';
}

export function setDownloadQuality(quality: MusicQuality) {
  for (let key of musicAPI.keys()) {
    musicAPI.get(key)?.setDownloadQuality?.call(null, quality);
  }
}

export function setPlayQuality(quality: MusicQuality) {
  for (let key of musicAPI.keys()) {
    musicAPI.get(key)?.setPlayQuality?.call(null, quality);
  }
}

export async function downloadUrl(music: Music): Promise<string> {
  try {
    return (
      (await musicAPI.get(music.type)?.downloadUrl?.call(null, music)) || ''
    );
  } catch {}
  return '';
}

export function subscribeCookieChanged(
  type: MusicType,
  func: ((cookie: string | Record<string, string>) => void) | null
) {
  musicAPI.get(type)?.subscribeCookieChanged?.call(null, func);
}

export async function refreshCookie(
  type: MusicType,
  cookie: string | Record<string, string>
): Promise<string | Record<string, string>> {
  const result = await musicAPI.get(type)?.refreshCookie?.call(null, cookie);
  return result || cookie;
}

export function getCookie(type: MusicType) {
  switch (type) {
    case 'cloud':
      return cloud.getCookie();
    case 'qq':
      return qq.getCookie();
    case 'migu':
      return migu.getCookie();
  }
  return '';
}
