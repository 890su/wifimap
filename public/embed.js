/* Auto-size Wi-Fi Planner iframes from { type: 'wifiplan:height', height }. */
;(function () {
  function apply(event) {
    var data = event.data
    if (!data || data.type !== 'wifiplan:height' || typeof data.height !== 'number') return
    var frames = document.querySelectorAll('iframe')
    for (var i = 0; i < frames.length; i++) {
      if (frames[i].contentWindow === event.source) {
        frames[i].style.height = Math.max(480, Math.round(data.height)) + 'px'
      }
    }
  }
  window.addEventListener('message', apply)
})()
