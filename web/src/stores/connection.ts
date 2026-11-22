import * as http from '../utils/http';
import { StorageKey, storage } from '../utils/storage';
import { Config, ShortcutKey, ShortcutType } from '../utils/type';
import { usePlayStore } from './play';
import { useSettingStore } from './setting';
import { registerServiceWorker } from '../sw/register';
import { LyricManager } from '../utils/lyric';
import * as local from '../utils/api/local';
import { ElMessage } from 'element-plus/es/components/message/index';
import { messageOption } from '../utils/utils';

export class MusicConnection {
  webSocketClient?: http.CommunicationClient;
  // WebSocket 重连退避：1s → 2s → 4s → 8s → 16s → 30s（上限），并附带 ±20% 抖动
  private wsRetryTimes = 0;
  private wsRetryTimer?: number;
  private wsConnectTimer?: number;
  private wsConnecting = false;
  private static readonly WsRetryBase = 1000;
  private static readonly WsRetryMax = 30000;
  private static readonly WsConnectTimeout = 8000;
  play = usePlayStore();
  setting = useSettingStore();
  public config: Config = {
    remote: false,
    storage: false,
    file: false,
    list: false,
    lyric: false,
    client: false,
    shortcut: false,
    gpu: false
  };

  constructor() {
    this.init();
    this.registerShortcut();
    // 标签页切回前台时立即补连，避免后台定时器节流导致最长要等 30s 才恢复
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'visible') return;
      if (this.wsConnecting) return;
      if (this.webSocketClient?.readyState === WebSocket.OPEN) return;
      this.wsRetryTimes = 0;
      this.connectWebSocket();
    });
  }

  async init() {
    try {
      const res = await fetch(`//${http.httpAddress}/config`);
      const remoteConfig: Config = await res.json();
      this.config.remote = Boolean(remoteConfig.remote);
      this.config.storage = Boolean(remoteConfig.storage);
      this.config.file = Boolean(remoteConfig.file);
      this.config.list = Boolean(remoteConfig.list);
      this.config.client = Boolean(remoteConfig.client);
      this.config.shortcut = Boolean(remoteConfig.shortcut);
      this.config.gpu = Boolean(remoteConfig.gpu);
      this.config.lyric = Boolean(remoteConfig.lyric);
      this.config.platform = remoteConfig.platform || '';
    } catch {}

    if (!this.config.remote) {
      registerServiceWorker();
    }
    this.config.remote && http.setRemoteMode(true);
    this.config.storage && storage.setRemoteMode(true);
    this.config.lyric && LyricManager.setRemoteMode(true);
    this.config.file && local.setRemoteMode(true);
    const storages = await storage.getAll();
    storages[StorageKey.ProxyAddress] &&
      http.setProxyAddress(storages[StorageKey.ProxyAddress]);
    const localProxy = http.getGlobalHttpProxy();
    if (localProxy && !storages[StorageKey.HttpProxy]) {
      await storage.setValue(StorageKey.HttpProxy, localProxy);
      storages[StorageKey.HttpProxy] = localProxy;
    } else if (storages[StorageKey.HttpProxy]) {
      http.setGlobalHttpProxy(storages[StorageKey.HttpProxy]);
    }
    await this.play.initValue(this.config, storages);
    await this.setting.initValue(this.config, storages);
    await import('../style/main.css');
    document.documentElement.style.opacity = '1';
    console.log('musiche loaded');
    this.connectWebSocket();
    if (this.setting.pageValue.savePlayProgress) {
      try {
        const progress = parseInt(
          localStorage.getItem(StorageKey.Progress) || '0'
        );
        if (progress > 0 && progress < 1000) {
          this.play.changeProgress(progress);
        }
      } catch {}
    }
    if (this.setting.pageValue.playAtRun) {
      this.play.play();
    }
  }

  registerShortcut() {
    document.addEventListener('keyup', this.onKeyUp.bind(this));
  }

  onKeyUp(event: KeyboardEvent) {
    const target = event.target as HTMLElement;
    if (target?.tagName == 'INPUT' || target?.tagName == 'TEXTAREA') return;
    if (
      !this.config.shortcut &&
      this.setting.pageValue.systemMediaShortcutUsed
    ) {
      switch (event.key) {
        case 'MediaPlayPause':
          if (this.play.playStatus.playing) this.play.pause();
          else this.play.play();
          return;
        case 'MediaTrackPrevious':
          this.play.last();
          return;
        case 'MediaTrackNext':
          this.play.next();
          return;
        case 'MediaStop':
          this.play.pause();
          return;
        // case 'AudioVolumeMute':
        // case 'AudioVolumeUp':
        // case 'AudioVolumeDown':
      }
    }
    const shortcutTypes = Object.keys(this.setting.pageValue.shortcut);
    for (let i = 0; i < shortcutTypes.length; i++) {
      const shortcut = (this.setting.pageValue.shortcut as any)[
        shortcutTypes[i]
      ] as ShortcutKey;
      if (shortcut.ctrlKey && !event.ctrlKey) continue;
      if (shortcut.shiftKey && !event.shiftKey) continue;
      if (shortcut.altKey && !event.altKey) continue;
      if (shortcut.metaKey && !event.metaKey) continue;
      if (shortcut.key !== event.code) continue;
      switch (shortcutTypes[i] as ShortcutType) {
        case 'play':
          if (this.play.playStatus.playing) this.play.pause();
          else this.play.play();
          break;
        case 'last':
          this.play.last();
          break;
        case 'next':
          this.play.next();
          break;
        case 'plus':
          this.play.changeVolume(this.play.playStatus.volume + 10);
          break;
        case 'minus':
          this.play.changeVolume(this.play.playStatus.volume - 10);
          break;
        case 'love':
          this.play.addMyLove([this.play.music]);
          break;
        case 'lover':
          if (this.play.music.id && this.play.music.type) {
            let exist =
              this.play.myLover[this.play.music.type + this.play.music.id];
            this.play.addMyLove([this.play.music], exist);
          }
          break;
      }
    }
  }

  sendWsMessage(message: string) {
    if (!this.webSocketClient) return;
    this.webSocketClient.readyState == WebSocket.OPEN &&
      this.webSocketClient.send(message);
  }

  sendWsStatus() {
    if (this.play.checkingStatus) return;
    this.sendWsMessage('/status\n');
  }

  wsMessage(result: any) {
    if (!result) return;
    try {
      switch (result.type) {
        case 'status':
          this.play.setStatus(result.data);
          break;
        case 'maximized':
          this.setting.setMaximized(result.data);
          break;
        case 'playOrPause':
          if (this.play.playStatus.playing) this.play.pause();
          else this.play.play();
          break;
        case 'play':
          this.play.play();
          break;
        case 'pause':
          this.play.pause();
          break;
        case 'remove':
          const musicIndex = this.play.musicList.findIndex(
            m => m.id == result.data.id && m.type == result.data.type
          );
          if (musicIndex >= 0) {
            ElMessage(
              messageOption(
                `当前音乐[${this.play.musicList[musicIndex].name}]无法播放`
              )
            );
            this.play.musicList.splice(musicIndex, 1);
          }
          break;
        case 'next':
          this.play.next(result.data);
          break;
        case 'last':
          this.play.last();
          break;
        case 'loop':
          this.play.setSortType(result.data);
          break;
        case 'lyric':
          this.play.showDesktopLyric(Boolean(result.data));
          break;
        case 'show':
          if (this.play.music.id && this.play.musicList.length > 0)
            this.play.playDetailShow = true;
          break;
        case 'lover':
          if (
            (this.play.music.type && this.play.music.id) ||
            (result.data.type && result.data.id)
          ) {
            const type = result.data.type || this.play.music.type;
            const id = result.data.id || this.play.music.id;
            let exist = this.play.myLover[type + id];
            const music = this.play.musicList.find(
              m => m.id == id && m.type == type
            );
            this.play.addMyLove([music || this.play.music], exist);
          }
          break;
      }
    } catch {}
  }
  wsOpen() {
    this.wsConnecting = false;
    if (this.wsConnectTimer) {
      clearTimeout(this.wsConnectTimer);
      this.wsConnectTimer = undefined;
    }
    if (this.wsRetryTimes > 0) {
      console.log(`WebSocket reconnected after ${this.wsRetryTimes} attempt(s)`);
    }
    this.wsRetryTimes = 0;
    // 重连后主动对一次状态：服务端握手时也会推一次，这里兜住错过的几秒
    this.sendWsStatus();
  }

  wsClose() {
    this.wsConnecting = false;
    if (this.wsConnectTimer) {
      clearTimeout(this.wsConnectTimer);
      this.wsConnectTimer = undefined;
    }
    // 已有待执行的重连任务时直接返回，避免 close 重复触发导致定时器叠加、重连风暴
    if (this.wsRetryTimer) return;
    const base = Math.min(
      MusicConnection.WsRetryBase * Math.pow(2, this.wsRetryTimes),
      MusicConnection.WsRetryMax
    );
    // 抖动 ±20%：多标签页/多设备同时掉线时不会在同一毫秒一起重连
    const delay = Math.round(base * (0.8 + Math.random() * 0.4));
    this.wsRetryTimes++;
    console.log(`WebSocket closed, retry #${this.wsRetryTimes} in ${delay}ms`);
    this.wsRetryTimer = window.setTimeout(() => {
      this.wsRetryTimer = undefined;
      this.connectWebSocket();
    }, delay);
  }

  private connectWebSocket() {
    if (this.wsRetryTimer) {
      clearTimeout(this.wsRetryTimer);
      this.wsRetryTimer = undefined;
    }
    if (this.wsConnectTimer) {
      clearTimeout(this.wsConnectTimer);
      this.wsConnectTimer = undefined;
    }
    this.wsConnecting = true;
    this.webSocketClient = http.wsClient(
      this.wsMessage.bind(this),
      this.wsClose.bind(this),
      this.wsOpen.bind(this)
    );
    // 握手超时：设备休眠 / AP 隔离时浏览器 TCP 可能长时间不报错，主动断开交给退避重连
    this.wsConnectTimer = window.setTimeout(() => {
      this.wsConnectTimer = undefined;
      if (this.wsConnecting) this.webSocketClient?.close?.();
    }, MusicConnection.WsConnectTimeout);
    // 本地播放模式（无真实 WebSocket）不会收到 open/close，直接复位
    if (this.webSocketClient.readyState === WebSocket.CLOSED) {
      this.wsConnecting = false;
    }
  }
}
