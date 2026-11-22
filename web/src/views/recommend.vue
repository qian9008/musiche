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
const { currentRoute, replace } = useRouter();
const setting = useSettingStore();
const playlist: Ref<Playlist[]> = ref([]);
const loading = ref(false);
const scrollBar = ref();
const unWatch = watch(currentRoute, getPlaylist.bind(null, true));
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
// 歌单秒开：首次加载时先显示上次缓存的歌单，后台再拉新数据无感替换。
// 设计要点：
// - 缓存只存首页(offset=0)，滚动分页(offset>0)不读缓存、不重写。
// - 秒开只在首次进入时启用，此时用户尚未滚动，替换列表不会冲突。
// - 后台拉新成功后才更新缓存，失败时保留旧缓存不报错。
function playlistCacheKey(key: string, type: MusicType): string {
  return `${StorageKey.PlaylistCache}:${key}:${type}`;
}

async function getPlaylist(clear: boolean = true) {
  if (loading.value) return;
  await setting.waitLoaded();
  const type = currentRoute.value.params.type?.toString() as MusicType;
  const key = currentRoute.value.meta.key!.toString();
  if (await prepareRouter(key, type)) {
    return;
  }
  const cacheKey = playlistCacheKey(key, type);
  // 首页加载：先用缓存秒开显示，loading 不挡列表
  if (clear) {
    try {
      const cached = await storage.getValue<Playlist[]>(cacheKey, []);
      if (cached && cached.length) {
        playlist.value.splice(0, playlist.value.length, ...cached);
        // 用缓存条数维持滚动分页可继续，待真实数据到齐后修正
        total = cached.length;
      }
    } catch {}
  }
  loading.value = true;
  // 分页加载(offset>0)不清空列表；首页仅在无缓存可显示时清空
  clear && !playlist.value.length && playlist.value.splice(0, playlist.value.length);
  setting.currentMusicType = type as MusicType;
  setting.currentMusicTypeShow = true;
  let result = null;
  // 首页从 offset=0 拉；分页从当前列表长度继续往后拉
  const offset = clear ? 0 : playlist.value.length;
  if (key === 'yours') {
    result = await api.yours(setting.currentMusicType, offset);
  } else {
    result = await api.recommend(setting.currentMusicType, offset);
  }
  if (clear) {
    // 首页新数据到齐：整体替换列表，并更新缓存
    playlist.value.splice(0, playlist.value.length, ...result.list);
    total = result.total;
    if (result.list.length) {
      try {
        await storage.setValue(cacheKey, result.list);
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
onMounted(getPlaylist);
onUnmounted(unWatch);
</script>

<template>
  <AnimalPage>
    <el-scrollbar ref="scrollBar" class="music-recommend" @scroll="onScroll">
      <PlaylistEle :loading="loading" :list="playlist" />
    </el-scrollbar>
  </AnimalPage>
</template>

<style lang="less" scoped>
.music-recommend {
  height: 100%;
  padding: 0 var(--music-page-padding-horizontal);
  @media (max-width: 800px) {
    padding: 0 10px;
  }
}
</style>
