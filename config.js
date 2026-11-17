// ===== 網站設定：只需要改這個檔案 =====
window.APP_CONFIG = {
  // 貼上 GAS「部署」後拿到的網址（以 /exec 結尾）
  // 留空白 = 示範模式（用假資料，方便先看畫面；示範模式管理密碼是 demo）
  GAS_URL: 'https://script.google.com/macros/s/AKfycbxQ49ZlX_fNSbIYT5gQX24DUF39cFX9HKCs5N6R9Fyo4UClAVoFKsHNId7HoB4zbGLC2w/exec',

  CLASS_NAME: '704 生物課',

  // 低分組加權：總分最低的兩組被抽到的機會要乘幾倍（1.5 = 多 50%；想更明顯可以改 2）
  LOW_BOOST: 1.5,

  // 音樂清單：每台電腦都會出現的預設歌曲
  // url 可以是 YouTube 網址，或是放在 GitHub 上的 mp3 檔名（例如 'music/calm.mp3'）
  // 範例（把前面的 // 拿掉就會生效）：
  MUSIC: [
    // { title: '專心讀書音樂', url: 'https://www.youtube.com/watch?v=影片代碼' },
    // { title: '下課音樂', url: 'music/break.mp3' },
  ],
};
