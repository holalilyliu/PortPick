// 示意圖的座標原點在左上，x 向右、y 向下。實際距離由商品目錄內的經緯度計算。
window.PORTPICK_STORE_MAP = {
  background: 'store-map-base.svg',
  width: 600,
  height: 320,
  stores: {
    qianhai: { x: 95, y: 188 },
    futian:  { x: 298, y: 145 }
  },
  ports: {
    shenzhenbay: { x: 186, y: 249 },
    futian:      { x: 387, y: 232 },
    huanggang:   { x: 448, y: 213 },
    luohu:       { x: 512, y: 192 }
  }
};
