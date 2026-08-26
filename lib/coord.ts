// ============================================================
// Travel Story — 坐标转换（GCJ-02 → WGS-84）
//
// 背景：底图用 OpenFreeMap（OSM 派生，WGS-84）。高德 API 返回的是
// GCJ-02「火星坐标」（国测局加密偏移），直接投到 OSM 底图会偏移
// 几十到几百米。这里实现标准算法还原成 WGS-84：
//   gcj02ToWgs84（火星 → WGS-84，迭代逼近，精度约 1–2 米）
// 加密只作用于中国境内（outOfChina 判断），境外坐标原样通过。
// 对旅行规划精度足够。仅做数学转换，不涉及私密数据。
// ============================================================

const PI = Math.PI;
const A = 6378245.0; // 长半轴
const EE = 0.00669342162296594323; // 偏心率平方

/** 是否在中国大陆区域（国测局的偏移只作用于此范围） */
export function outOfChina(lat: number, lon: number): boolean {
  return lon < 72.004 || lon > 137.8347 || lat < 0.8293 || lat > 55.8271;
}

function transformLat(x: number, y: number): number {
  let ret =
    -100.0 +
    2.0 * x +
    3.0 * y +
    0.2 * y * y +
    0.1 * x * y +
    0.2 * Math.sqrt(Math.abs(x));
  ret +=
    ((20.0 * Math.sin(6.0 * x * PI) + 20.0 * Math.sin(2.0 * x * PI)) * 2.0) / 3.0;
  ret +=
    ((20.0 * Math.sin(y * PI) + 40.0 * Math.sin((y / 3.0) * PI)) * 2.0) / 3.0;
  ret +=
    ((160.0 * Math.sin((y / 12.0) * PI) + 320.0 * Math.sin((y * PI) / 30.0)) *
      2.0) /
    3.0;
  return ret;
}

function transformLon(x: number, y: number): number {
  let ret =
    300.0 +
    x +
    2.0 * y +
    0.1 * x * x +
    0.1 * x * y +
    0.1 * Math.sqrt(Math.abs(x));
  ret +=
    ((20.0 * Math.sin(6.0 * x * PI) + 20.0 * Math.sin(2.0 * x * PI)) * 2.0) /
    3.0;
  ret +=
    ((20.0 * Math.sin(x * PI) + 40.0 * Math.sin((x / 3.0) * PI)) * 2.0) / 3.0;
  ret +=
    ((150.0 * Math.sin((x / 12.0) * PI) + 300.0 * Math.sin((x / 30.0) * PI)) *
      2.0) /
    3.0;
  return ret;
}

/** 前向：WGS-84 → GCJ-02（高德坐标系）。国内模式（高德底图）渲染前统一转换用 */
export function wgs84ToGcj02(lat: number, lon: number): { lat: number; lon: number } {
  if (outOfChina(lat, lon)) return { lat, lon };
  const dLat = transformLat(lon - 105.0, lat - 35.0);
  const dLon = transformLon(lon - 105.0, lat - 35.0);
  const radLat = (lat / 180.0) * PI;
  let magic = Math.sin(radLat);
  magic = 1 - EE * magic * magic;
  const sqrtMagic = Math.sqrt(magic);
  const mLat = (dLat * 180.0) / (((A * (1 - EE)) / (magic * sqrtMagic)) * PI);
  const mLon = (dLon * 180.0) / ((A / sqrtMagic) * Math.cos(radLat) * PI);
  return { lat: lat + mLat, lon: lon + mLon };
}

/**
 * 逆向：GCJ-02 → WGS-84
 * 迭代逼近：每轮用前向函数算出当前位置的偏移，把差值回加，
 * 3 轮后收敛到约 1–2 米精度。
 */
export function gcj02ToWgs84(lat: number, lon: number): { lat: number; lon: number } {
  if (outOfChina(lat, lon)) return { lat, lon };
  let wgsLat = lat;
  let wgsLon = lon;
  for (let i = 0; i < 3; i++) {
    const g = wgs84ToGcj02(wgsLat, wgsLon);
    wgsLat += lat - g.lat;
    wgsLon += lon - g.lon;
  }
  return { lat: wgsLat, lon: wgsLon };
}
