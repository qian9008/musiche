<script setup lang="ts">
import { Ref, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { useDebounceFn } from '@vueuse/core';
import * as api from '../utils/api/api';
import { MusicType, Playlist } from '../utils/type';
import PlaylistEle from '../components/Playlist.vue';
import AnimalPage from '../components/AnimalPage.vue';
import { useSettingStore } from '../stores/setting';
import { musicTypeAll } from '../utils/platform';
import { storage, StorageKey } from '../utils/storage';
import { Refresh } from '@element-plus/icons-vue';
const { currentRoute, replace } = useRouter();
const setting = useSettingStore();
const playlist: Ref<Playlist[]> = ref([]);
const loading = ref(false);
const scrollBar = ref();
// 注意：watch 回调会注入 (newVal, oldVal)，不能用 getPlaylist.bind(null, true)
// 否则路由对象会落到 force 参数上导致 TTL 永远失效。用箭头函数显式丢弃参数。
const unWatch = watch(currentRoute, () => getPlaylist(true));
const onScroll = useDebounceFn(checkScrollBottom, 200);
let total = 0;
async function prepareRouter(key: string, type: MusicType) {
  if (key == 'yours') {
    for (let i = 0; i < musicTypeAll.length; i++) {
      if (!musicTypeAll.includes(type) || !setting.userInfo[type].cookie) {
        if (setting.userInfo[musicTypeAll[i]].cookie) {
          replace('/yours/' + musicTypeAll[i]);
          return true;
        }
        if (i === musicTypeAll.length - 1) {
          replace('/');
          return true;
        }
      }
    }
    if (await api.userInfo(type, setting.userInfo[type].cookie!)) {
      return false;
    } else {
      if (typeof setting.userInfo[type].cookie === 'string') {
        setting.userInfo[type].cookie = '';
      } else {
        setting.userInfo[type].cookie = {};
      }
      replace('/');
      return true;
    }
  } else if (key == 'recommend') {
    if (!musicTypeAll.includes(type)) {
      replace('/recommend/cloud');
      return true;
    }
  } else {
    return true;
  }
  return false;
}
// 歌单秒开 + TTL 限流：
// - 缓存存 { time, list }，time 为写入时间戳。结构变化见下方兼容处理。
// - 进入页面(clear=true)：缓存新鲜(10 分钟内)则直接用缓存、不发请求；
//   缓存过期则先秒开显示旧缓存，再后台拉新无感替换。
// - 手动刷新(force=true)：忽略 TTL，强制拉新；仍先显示旧缓存避免空白。
// - 缓存只存首页(offset=0)，滚动分页(offset>0)不读缓存、不重写。
// - 旧版本缓存是裸数组 Playlist[]，读到时 time 视为 0(已过期)，会自动重拉并升级结构。
const PLAYLIST_TTL = 10 * 60 * 1000;
interface PlaylistCacheData {
  time: number;
  list: Playlist[];
}
function playlistCacheKey(key: string, type: MusicType): string {
  return `${StorageKey.PlaylistCache}:${key}:${type}`;
}

async function getPlaylist(clear: boolean = true, force: boolean = false) {
  if (loading.value) return;
  await setting.waitLoaded();
  const type = currentRoute.value.params.type?.toString() as MusicType;
  const key = currentRoute.value.meta.key!.toString();
  if (await prepareRouter(key, type)) {
    return;
  }
  // 顶部平台选择器状态：即使命中 TTL 直接返回也必须设置，否则从其他页面切回时 Header 平台不对
  setting.currentMusicType = type as MusicType;
  setting.currentMusicTypeShow = true;

  const cacheKey = playlistCacheKey(key, type);
  let cacheTime = 0;
  if (clear) {
    // 首页加载：读缓存秒开显示，解析 time 供 TTL 判断
    try {
      const cached = await storage.getValue<PlaylistCacheData | Playlist[]>(cacheKey, []);
      let list: Playlist[] = [];
      if (Array.isArray(cached)) {
        // 旧格式裸数组，无时间戳
        list = cached;
      } else if (cached && Array.isArray(cached.list)) {
        list = cached.list;
        cacheTime = cached.time || 0;
      }
      if (list.length) {
        playlist.value.splice(0, playlist.value.length, ...list);
        // 用缓存条数维持滚动分页可继续，待真实数据到齐后修正
        total = list.length;
      }
    } catch {}
  }

  // TTL 命中：首页、非强制刷新、缓存新鲜 → 直接用缓存，不发请求
  if (clear && !force && cacheTime > 0 && Date.now() - cacheTime < PLAYLIST_TTL) {
    return;
  }

  loading.value = true;
  // 分页加载(offset>0)不清空列表；首页仅在无缓存可显示时清空
  clear && !playlist.value.length && playlist.value.splice(0, playlist.value.length);
  let result = null;
  // 首页从 offset=0 拉；分页从当前列表长度继续往后拉
  const offset = clear ? 0 : playlist.value.length;
  if (key === 'yours') {
    result = await api.yours(setting.currentMusicType, offset);
  } else {
    result = await api.recommend(setting.currentMusicType, offset);
  }
  if (clear) {
    // 首页新数据到齐：整体替换列表，并更新缓存（带时间戳）
    playlist.value.splice(0, playlist.value.length, ...result.list);
    total = result.total;
    if (result.list.length) {
      try {
        const data: PlaylistCacheData = { time: Date.now(), list: result.list };
        await storage.setValue(cacheKey, data);
      } catch {}
    }
  } else {
    // 分页：追加到列表尾部
    result.list.map((m: Playlist) => playlist.value.push(m));
    total = result.total;
  }
  loading.value = false;
  if (await needContinueLoading()) getPlaylist(false);
}

// 手动刷新：强制忽略 TTL 重新拉取首页数据
function onRefresh() {
  getPlaylist(true, true);
}

async function needContinueLoading() {
  await new Promise(resolve => {
    nextTick(resolve.bind(null, null));
  });
  try {
    return (
      scrollBar.value.wrapRef.children[0].children[0].offsetHeight <
        scrollBar.value.wrapRef.offsetHeight && total > playlist.value.length
    );
  } catch {}
  return false;
}
function checkScrollBottom(e: any) {
  if (
    total > playlist.value.length &&
    !loading.value &&
    e.scrollTop + scrollBar.value.wrapRef.offsetHeight >
      scrollBar.value.wrapRef.children[0].children[0].offsetHeight - 50
  ) {
    getPlaylist(false);
  }
}
onMounted(() => getPlaylist());
onUnmounted(unWatch);
</script>

<template>
  <AnimalPage>
    <div class="music-recommend-wrapper">
      <div class="music-recommend-toolbar">
        <el-button
          :icon="Refresh"
          :loading="loading"
          size="small"
          text
          bg
          title="刷新歌单（忽略缓存重新拉取）"
          @click="onRefresh">
          刷新
        </el-button>
      </div>
      <el-scrollbar ref="scrollBar" class="music-recommend" @scroll="onScroll">
        <PlaylistEle :loading="loading" :list="playlist" />
      </el-scrollbar>
    </div>
  </AnimalPage>
</template>

<style lang="less" scoped>
.music-recommend-wrapper {
  height: 100%;
  display: flex;
  flex-direction: column;
  padding: 0 var(--music-page-padding-horizontal);
  @media (max-width: 800px) {
    padding: 0 10px;
  }
}
.music-recommend-toolbar {
  flex: 0 0 auto;
  display: flex;
  justify-content: flex-end;
  padding: 4px 2px 8px;
}
.music-recommend {
  flex: 1 1 auto;
  min-height: 0;
}
</style>
