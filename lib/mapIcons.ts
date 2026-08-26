// ============================================================
// Travel Story — 地图图标（纯 SVG data-URL，无 React 依赖）
//
// 交通工具用「Q 版卡通侧面视角」插画：粗描边、大眼睛、腮红、
// 高饱和配色（风格参考用户给的卡通小汽车，自行绘制）。
// 每种交通工具两帧动画（颠簸 / 摆腿 / 冒烟 / 火焰 / 光束…），
// 播放时由引擎按时间切帧。
// 地点类别标记用 Phosphor 实心图标 + 墨色圆底。
//
// 统一 viewBox 0 0 120 80，车辆默认朝右（+x = 东）。
// 朝西行驶（bearing ∈ (180°, 360°)）时引擎会改用 flip=true 的
// 水平镜像版本，并把 icon-rotate 设为 bearing+90°（正立车头朝西），
// 否则 icon-rotate = bearing-90° —— 保证侧面视角的载具永不颠倒。
// ============================================================

import type { StopType, Transport } from "./types";

const INK = "#33291F";
const PAPER = "#F6F1E4";

// ------------------------------------------------------------
// 通用小部件：大眼睛 / 腮红 / 微笑 / 车轮
// ------------------------------------------------------------

/** 卡通大眼睛（瞳孔朝右 = 朝前看） */
const EYE = (cx: number, cy: number, r: number) => `
  <circle cx="${cx}" cy="${cy}" r="${r}" fill="#FFFFFF" stroke="${INK}" stroke-width="1.8"/>
  <circle cx="${cx + r * 0.3}" cy="${cy + r * 0.06}" r="${r * 0.46}" fill="${INK}"/>
  <circle cx="${cx + r * 0.02}" cy="${cy - r * 0.26}" r="${r * 0.18}" fill="#FFFFFF"/>`;

/** 腮红 */
const BLUSH = (cx: number, cy: number, r = 3.4) =>
  `<ellipse cx="${cx}" cy="${cy}" rx="${r}" ry="${r * 0.62}" fill="#FF9FB2" opacity="0.65"/>`;

/** 微笑 */
const SMILE = (cx: number, cy: number, w = 7) =>
  `<path d="M${cx - w / 2},${cy} Q${cx},${cy + w * 0.5} ${cx + w / 2},${cy}" fill="none" stroke="${INK}" stroke-width="1.9" stroke-linecap="round"/>`;

/** 大轮子（黑胎 + 白毂 + 墨心） */
const WHEEL = (cx: number, cy: number, r: number) => `
  <circle cx="${cx}" cy="${cy}" r="${r}" fill="${INK}"/>
  <circle cx="${cx}" cy="${cy}" r="${r * 0.55}" fill="#F4F1EA"/>
  <circle cx="${cx}" cy="${cy}" r="${r * 0.22}" fill="${INK}"/>`;

/** 镂空车轮（自行车） */
const RING_WHEEL = (cx: number, cy: number, r: number) => `
  <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${INK}" stroke-width="3.4"/>
  <circle cx="${cx}" cy="${cy}" r="2.4" fill="${INK}"/>`;

/** 烟囱冒出的烟圈（两帧大小/位置交替 → 冒烟动效） */
const SMOKE = (cx: number, cy: number, f: number) =>
  f
    ? `<circle cx="${cx}" cy="${cy}" r="5" fill="#EDEAE2" stroke="${INK}" stroke-width="1.6"/>
       <circle cx="${cx + 8}" cy="${cy - 8}" r="3.6" fill="#EDEAE2" stroke="${INK}" stroke-width="1.6"/>
       <circle cx="${cx - 2}" cy="${cy - 13}" r="2.6" fill="#EDEAE2" stroke="${INK}" stroke-width="1.6"/>`
    : `<circle cx="${cx + 1}" cy="${cy + 2}" r="3.4" fill="#EDEAE2" stroke="${INK}" stroke-width="1.6"/>
       <circle cx="${cx + 7}" cy="${cy - 5}" r="2.4" fill="#EDEAE2" stroke="${INK}" stroke-width="1.6"/>`;

// ------------------------------------------------------------
// 每种交通工具的 Q 版插画（不含外层 <svg>），f = 动画帧（0/1）
// ------------------------------------------------------------

const CARTOON: Record<Transport, (f: number) => string> = {
  // 小汽车：圆胖红车，车身上下颠簸「一晃一晃」（轮子不动）。
  // 短陡的车尾在左、长机盖朝右前伸，琥珀大灯 + 眼睛在车头（右），
  // 红色尾灯在车尾（左）——形状与脸同向，不会读反。
  car: (f) => `
    <g transform="translate(0,${f ? -2.6 : 0})">
      <path d="M10,58 Q8,47 16,42 L26,40 L42,23 Q46,17 54,17 L74,17 Q82,17 86,23 L94,38 Q108,41 111,49 Q113,54 108,58 Z" fill="#FF4B3C" stroke="${INK}" stroke-width="2.8" stroke-linejoin="round"/>
      <path d="M44,39 L52,22 Q54,20 58,20 L62,20 L62,39 Z" fill="#AEE3F8" stroke="${INK}" stroke-width="2.2" stroke-linejoin="round"/>
      <path d="M66,20 L72,20 Q78,20 81,25 L88,38 L66,38 Z" fill="#AEE3F8" stroke="${INK}" stroke-width="2.2" stroke-linejoin="round"/>
      <path d="M55,26 L58,22 L58,31 Z" fill="#FFFFFF" opacity="0.7"/>
      <rect x="9" y="46" width="5" height="8" rx="1.6" fill="#D93729" stroke="${INK}" stroke-width="1.6"/>
      <circle cx="106" cy="51" r="3.8" fill="#FFE27A" stroke="${INK}" stroke-width="1.8"/>
      ${EYE(96, 44, 5.2)}
      ${BLUSH(87, 51)}
      ${SMILE(98, 53, 7)}
    </g>
    ${WHEEL(30, 63, 12)}${WHEEL(88, 63, 12)}`,

  // 巴士：胖黄巴，大眼睛在前挡风里，颠簸同汽车
  bus: (f) => `
    <g transform="translate(0,${f ? -2.2 : 0})">
      <rect x="10" y="20" width="100" height="38" rx="15" fill="#FFC93C" stroke="${INK}" stroke-width="2.8"/>
      <rect x="17" y="27" width="15" height="12" rx="4" fill="#AEE3F8" stroke="${INK}" stroke-width="2"/>
      <rect x="36" y="27" width="15" height="12" rx="4" fill="#AEE3F8" stroke="${INK}" stroke-width="2"/>
      <rect x="55" y="27" width="15" height="12" rx="4" fill="#AEE3F8" stroke="${INK}" stroke-width="2"/>
      <rect x="74" y="27" width="13" height="12" rx="4" fill="#AEE3F8" stroke="${INK}" stroke-width="2"/>
      <rect x="91" y="25" width="15" height="16" rx="5" fill="#AEE3F8" stroke="${INK}" stroke-width="2.2"/>
      ${EYE(99, 33, 4.2)}
      ${BLUSH(98, 48)}
      ${SMILE(98, 51, 8)}
      <rect x="14" y="45" width="20" height="4" rx="2" fill="#FFFFFF" opacity="0.5"/>
    </g>
    ${WHEEL(30, 63, 12)}${WHEEL(90, 63, 12)}`,

  // 火车：蒸汽小火车，烟囱冒烟 + 车身「一缩一缩」脉冲
  train: (f) => `
    ${SMOKE(90, 12, f)}
    <g transform="translate(60,48) scale(${f ? 1.045 : 1}) translate(-60,-48)">
      <rect x="14" y="24" width="32" height="31" rx="7" fill="#3CA7E8" stroke="${INK}" stroke-width="2.8"/>
      <rect x="20" y="30" width="15" height="13" rx="4" fill="#AEE3F8" stroke="${INK}" stroke-width="2"/>
      ${EYE(28, 36, 3.8)}
      ${BLUSH(23, 47, 2.8)}
      <rect x="44" y="34" width="54" height="21" rx="10" fill="#FF4B3C" stroke="${INK}" stroke-width="2.8"/>
      <circle cx="58" cy="34" r="6" fill="#FFC93C" stroke="${INK}" stroke-width="2.2"/>
      <rect x="84" y="18" width="11" height="18" rx="3" fill="${INK}"/>
      <rect x="81" y="14" width="17" height="7" rx="3.5" fill="${INK}"/>
      <circle cx="102" cy="44" r="4" fill="#FFE27A" stroke="${INK}" stroke-width="1.8"/>
      <path d="M96,55 L113,55 L105,45 Z" fill="#D93729" stroke="${INK}" stroke-width="2" stroke-linejoin="round"/>
      ${SMILE(70, 46, 8)}
    </g>
    ${WHEEL(28, 63, 10)}${WHEEL(54, 62, 13)}${WHEEL(84, 62, 13)}
    <path d="M54,62 L84,62" stroke="#C9C2B2" stroke-width="4" stroke-linecap="round"/>`,

  // 地铁：银灰车体 + 蓝色带，受电弓架在车顶，脸在车头挡风里；
  // 两帧：车身上下轻颠 + 受电弓火花/车灯光晕交替
  subway: (f) => `
    <path d="M46,22 L56,10 L66,22" fill="none" stroke="${INK}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M52,10 L60,10" stroke="${INK}" stroke-width="2.4" stroke-linecap="round"/>
    ${f ? `<circle cx="56" cy="7" r="2" fill="#FFE27A"/>` : ""}
    <g transform="translate(0,${f ? -1.8 : 0})">
      <rect x="8" y="22" width="104" height="36" rx="15" fill="#EDF1F5" stroke="${INK}" stroke-width="2.8"/>
      <path d="M12,44 L108,44 L108,50 L12,50 Z" fill="#3CA7E8"/>
      <rect x="18" y="29" width="16" height="11" rx="3.5" fill="#AEE3F8" stroke="${INK}" stroke-width="2"/>
      <rect x="40" y="29" width="16" height="11" rx="3.5" fill="#AEE3F8" stroke="${INK}" stroke-width="2"/>
      <rect x="62" y="29" width="16" height="11" rx="3.5" fill="#AEE3F8" stroke="${INK}" stroke-width="2"/>
      <path d="M84,27 Q104,27 107,36 L107,41 L84,41 Z" fill="#AEE3F8" stroke="${INK}" stroke-width="2.2" stroke-linejoin="round"/>
      ${EYE(96, 34, 4.2)}
      ${BLUSH(94, 47, 2.6)}
      ${SMILE(96, 51, 6)}
      <circle cx="105" cy="52" r="3.2" fill="#FFE27A" stroke="${INK}" stroke-width="1.6"/>
      ${f ? `<circle cx="105" cy="52" r="5.4" fill="#FFE27A" opacity="0.35"/>` : ""}
    </g>
    <rect x="22" y="56" width="20" height="8" rx="3" fill="${INK}"/>
    <rect x="76" y="56" width="20" height="8" rx="3" fill="${INK}"/>
    <circle cx="32" cy="66" r="3.4" fill="#4A4440"/>
    <circle cx="86" cy="66" r="3.4" fill="#4A4440"/>
    <path d="M4,71 L116,71" stroke="#C9C2B2" stroke-width="3.4" stroke-linecap="round"/>`,

  // 飞机：圆胖白机身 + 大舷窗眼睛，上下浮动 + 速度线交替
  plane: (f) => `
    <g transform="translate(0,${f ? -3 : 0})">
      <path d="M${f ? 2 : 5},45 L13,45 M${f ? 4 : 7},52 L15,52" stroke="#B9D8EA" stroke-width="2.6" stroke-linecap="round"/>
      <path d="M22,44 L12,25 Q18,22 24,27 L32,42 Z" fill="#FF4B3C" stroke="${INK}" stroke-width="2.4" stroke-linejoin="round"/>
      <path d="M14,50 Q14,41 26,39 L76,32 Q100,29 106,37 Q109,41 104,45 L80,53 L30,57 Q16,58 14,50 Z" fill="#FFFFFF" stroke="${INK}" stroke-width="2.8" stroke-linejoin="round"/>
      <path d="M54,40 L40,59 Q48,61 56,57 L68,42 Z" fill="#3CA7E8" stroke="${INK}" stroke-width="2.4" stroke-linejoin="round"/>
      <circle cx="46" cy="46" r="2.4" fill="#AEE3F8" stroke="${INK}" stroke-width="1.5"/>
      <circle cx="56" cy="44" r="2.4" fill="#AEE3F8" stroke="${INK}" stroke-width="1.5"/>
      <circle cx="66" cy="42" r="2.4" fill="#AEE3F8" stroke="${INK}" stroke-width="1.5"/>
      ${EYE(88, 40, 4.6)}
      ${BLUSH(83, 47, 3)}
      ${SMILE(89, 48, 6)}
    </g>`,

  // 轮船：烟囱在船尾冒烟、白船楼、船头（右）有脸 + 船头浪花，船身随浪起伏
  ship: (f) => `
    ${SMOKE(26, 9, f)}
    <g transform="translate(0,${f ? -1.8 : 0})">
      <rect x="20" y="15" width="12" height="30" rx="4" fill="#FFC93C" stroke="${INK}" stroke-width="2.4"/>
      <rect x="20" y="15" width="12" height="7" rx="3.5" fill="${INK}"/>
      <rect x="38" y="26" width="42" height="20" rx="6" fill="#FFFFFF" stroke="${INK}" stroke-width="2.6"/>
      <circle cx="48" cy="36" r="3.2" fill="#AEE3F8" stroke="${INK}" stroke-width="1.7"/>
      <circle cx="59" cy="36" r="3.2" fill="#AEE3F8" stroke="${INK}" stroke-width="1.7"/>
      <circle cx="70" cy="36" r="3.2" fill="#AEE3F8" stroke="${INK}" stroke-width="1.7"/>
      <path d="M12,45 L104,45 Q110,45 108,51 L100,63 Q96,67 88,67 L36,67 Q27,67 22,61 Z" fill="#FF4B3C" stroke="${INK}" stroke-width="2.8" stroke-linejoin="round"/>
      <path d="M14,51 L107,51" stroke="#FFFFFF" stroke-width="3.4" opacity="0.85"/>
      ${EYE(96, 58, 4)}
      ${BLUSH(87, 61.5, 2.8)}
      ${SMILE(95, 63, 6)}
    </g>
    <path d="M${f ? 2 : 5},62 Q9,58 ${f ? 15 : 18},62" fill="none" stroke="#7CC7EE" stroke-width="2.8" stroke-linecap="round"/>
    <path d="M${f ? 102 : 99},68 Q109,${f ? 61 : 63} ${f ? 117 : 114},66" fill="none" stroke="#7CC7EE" stroke-width="2.8" stroke-linecap="round"/>`,

  // 皮划艇：红色梭形小艇 + 橙衣划手，双头桨左右交替入水（带水花），
  // 艇身随划桨节奏轻晃
  kayak: (f) => `
    <path d="M0,60 Q15,52 30,60 Q45,68 60,60 Q75,52 90,60 Q105,68 120,60 L120,80 L0,80 Z" fill="#B7E3F7"/>
    <g transform="translate(0,${f ? -1.2 : 0.8}) rotate(${f ? -2 : 2} 60 55)">
      <path d="M${f ? "84,58 L44,18" : "36,58 L76,18"}" stroke="${INK}" stroke-width="3.2" stroke-linecap="round"/>
      <ellipse cx="${f ? 86 : 34}" cy="61" rx="4.6" ry="7" fill="#FFC93C" stroke="${INK}" stroke-width="1.8" transform="rotate(${f ? 35 : -35} ${f ? 86 : 34} 61)"/>
      <ellipse cx="${f ? 42 : 78}" cy="15" rx="4.2" ry="6.4" fill="#FFC93C" stroke="${INK}" stroke-width="1.8" transform="rotate(${f ? -35 : 35} ${f ? 42 : 78} 15)"/>
      <path d="M58,52 Q54,38 60,29" fill="none" stroke="#FF8A3C" stroke-width="9" stroke-linecap="round"/>
      <path d="M60,34 L${f ? "68,42" : "50,40"}" stroke="#FF8A3C" stroke-width="4.6" stroke-linecap="round"/>
      <circle cx="63" cy="19" r="8.5" fill="#FFD9B3" stroke="${INK}" stroke-width="2.4"/>
      <path d="M55,14 Q61,6 70,11 L69,14 Q61,9 55,14 Z" fill="#3CA7E8" stroke="${INK}" stroke-width="1.8" stroke-linejoin="round"/>
      ${EYE(66, 18, 2.8)}
      ${BLUSH(69, 22.5, 2.1)}
      <path d="M14,58 Q60,68 106,58 Q110,53 102,51 L18,51 Q10,53 14,58 Z" fill="#FF4B3C" stroke="${INK}" stroke-width="2.6" stroke-linejoin="round"/>
      <ellipse cx="59" cy="52" rx="11" ry="3.6" fill="${INK}"/>
      <path d="M20,54 L98,54" stroke="#FFFFFF" stroke-width="2" opacity="0.7"/>
    </g>
    ${f
      ? `<circle cx="89" cy="66" r="3" fill="#FFFFFF"/><circle cx="95" cy="61" r="2.1" fill="#FFFFFF"/>`
      : `<circle cx="31" cy="66" r="3" fill="#FFFFFF"/><circle cx="25" cy="61" r="2.1" fill="#FFFFFF"/>`}
    <path d="M0,60 Q15,52 30,60 Q45,68 60,60 Q75,52 90,60 Q105,68 120,60" fill="none" stroke="#3CA7E8" stroke-width="2.8" stroke-linecap="round"/>`,

  // 摩托车：黄盔骑手前倾，车身弹跳 + 尾气圈交替
  motorcycle: (f) => `
    <circle cx="${f ? 10 : 7}" cy="58" r="${f ? 3.4 : 2.4}" fill="#EDEAE2" stroke="${INK}" stroke-width="1.5"/>
    ${WHEEL(28, 62, 13)}${WHEEL(92, 62, 13)}
    <g transform="translate(0,${f ? -1.8 : 0})">
      <path d="M28,62 L48,46 L70,46 L84,56 L92,62" fill="none" stroke="${INK}" stroke-width="4.6" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="M44,46 Q52,33 68,35 L78,46 Z" fill="#FF4B3C" stroke="${INK}" stroke-width="2.4" stroke-linejoin="round"/>
      <path d="M76,40 L88,27" stroke="${INK}" stroke-width="4" stroke-linecap="round"/>
      <path d="M84,28 L93,25" stroke="${INK}" stroke-width="3.4" stroke-linecap="round"/>
      <path d="M52,31 Q47,40 51,47" fill="none" stroke="#3CA7E8" stroke-width="8.5" stroke-linecap="round"/>
      <path d="M53,47 L63,55" stroke="#2B3A55" stroke-width="5" stroke-linecap="round"/>
      <path d="M55,33 L77,29" stroke="#3CA7E8" stroke-width="5" stroke-linecap="round"/>
      <circle cx="56" cy="21" r="9.5" fill="#FFC93C" stroke="${INK}" stroke-width="2.4"/>
      <path d="M52,15 Q62,11 66,18 L64,25 Q55,27 50,22 Z" fill="#DFF3FC" stroke="${INK}" stroke-width="1.8"/>
      <circle cx="59" cy="19" r="1.9" fill="${INK}"/>
    </g>`,

  // 自行车：橙衣骑手，双腿交替蹬车
  bicycle: (f) => `
    ${RING_WHEEL(26, 62, 14)}${RING_WHEEL(94, 62, 14)}
    <path d="M26,62 L50,40 L64,62 Z M50,40 L72,40 L94,62" fill="none" stroke="#3CA7E8" stroke-width="3.6" stroke-linejoin="round" stroke-linecap="round"/>
    <path d="M45,36 L56,36" stroke="${INK}" stroke-width="4" stroke-linecap="round"/>
    <path d="M72,40 L78,30 M73,29 L84,29" stroke="${INK}" stroke-width="3.4" stroke-linecap="round"/>
    <circle cx="64" cy="62" r="4" fill="#F4F1EA" stroke="${INK}" stroke-width="2.4"/>
    <path d="M64,62 L${f ? "58,68" : "70,56"}" stroke="${INK}" stroke-width="3" stroke-linecap="round"/>
    <path d="M59,23 Q54,33 58,43" fill="none" stroke="#FF8A3C" stroke-width="8.5" stroke-linecap="round"/>
    <path d="M61,29 L78,31" stroke="#FF8A3C" stroke-width="4.6" stroke-linecap="round"/>
    ${f
      ? `<path d="M58,43 L54,55 L57,67" fill="none" stroke="#2B3A55" stroke-width="5.6" stroke-linecap="round" stroke-linejoin="round"/>
         <path d="M58,43 L66,50 L71,55" fill="none" stroke="#2B3A55" stroke-width="5.6" stroke-linecap="round" stroke-linejoin="round"/>`
      : `<path d="M58,43 L64,52 L69,57" fill="none" stroke="#2B3A55" stroke-width="5.6" stroke-linecap="round" stroke-linejoin="round"/>
         <path d="M58,43 L52,54 L50,62" fill="none" stroke="#2B3A55" stroke-width="5.6" stroke-linecap="round" stroke-linejoin="round"/>`}
    <circle cx="62" cy="14" r="8.5" fill="#FFD9B3" stroke="${INK}" stroke-width="2.4"/>
    ${EYE(65, 13, 2.8)}
    ${BLUSH(68, 17.5, 2.2)}
    <path d="M54,10 Q60,2 68,7 L67,10 Q60,6 54,10 Z" fill="#FF8A3C" stroke="${INK}" stroke-width="1.8" stroke-linejoin="round"/>`,

  // 电动车（ Vespa 踏板）：绿色车身 + 紫衣骑手，骑行弹跳
  scooter: (f) => `
    ${WHEEL(30, 63, 11)}${WHEEL(88, 63, 11)}
    <g transform="translate(0,${f ? -1.8 : 0})">
      <path d="M30,62 Q25,47 40,43 L54,43 Q60,43 60,50 L57,57 Z" fill="#4CC96F" stroke="${INK}" stroke-width="2.4" stroke-linejoin="round"/>
      <rect x="33" y="38" width="22" height="8" rx="4" fill="${INK}"/>
      <path d="M56,55 L74,55" stroke="${INK}" stroke-width="5" stroke-linecap="round"/>
      <path d="M72,56 Q69,36 81,27 Q90,21 92,28 L88,51 Q86,58 79,58 Z" fill="#4CC96F" stroke="${INK}" stroke-width="2.4" stroke-linejoin="round"/>
      <path d="M84,27 L92,20" stroke="${INK}" stroke-width="3.6" stroke-linecap="round"/>
      <circle cx="93" cy="19" r="2.8" fill="${INK}"/>
      <circle cx="85" cy="34" r="3.6" fill="#FFE27A" stroke="${INK}" stroke-width="1.7"/>
      <path d="M85,52 L88,63" stroke="${INK}" stroke-width="3.6" stroke-linecap="round"/>
      <path d="M47,26 Q42,37 47,47" fill="none" stroke="#9B6BFF" stroke-width="8.5" stroke-linecap="round"/>
      <path d="M47,47 L61,55" stroke="#2B3A55" stroke-width="5" stroke-linecap="round"/>
      <path d="M50,31 L82,25" stroke="#9B6BFF" stroke-width="4.6" stroke-linecap="round"/>
      <circle cx="51" cy="16" r="8.5" fill="#FFD9B3" stroke="${INK}" stroke-width="2.4"/>
      ${EYE(54, 15, 2.8)}
      ${BLUSH(57, 19.5, 2.2)}
      <path d="M43,12 Q50,4 59,8 L58,11 Q50,7 43,12 Z" fill="#4CC96F" stroke="${INK}" stroke-width="1.8" stroke-linejoin="round"/>
    </g>`,

  // 步行：背包小人，双腿交替迈步 + 手臂前后摆（走路动作）
  walk: (f) => `
    <rect x="39" y="27" width="13" height="17" rx="5" fill="#3CA7E8" stroke="${INK}" stroke-width="2.2"/>
    <path d="M55,27 Q52,37 56,47" fill="none" stroke="#FF4B3C" stroke-width="9" stroke-linecap="round"/>
    ${f
      ? `<path d="M56,33 L68,39" stroke="#FF4B3C" stroke-width="5.4" stroke-linecap="round"/>
         <path d="M56,47 L66,56 L70,67" fill="none" stroke="#2B3A55" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>
         <path d="M56,47 L48,57 L43,65" fill="none" stroke="#2B3A55" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>`
      : `<path d="M56,33 L46,41" stroke="#FF4B3C" stroke-width="5.4" stroke-linecap="round"/>
         <path d="M56,47 L64,57 L62,67" fill="none" stroke="#2B3A55" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>
         <path d="M56,47 L50,55 L52,66" fill="none" stroke="#2B3A55" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>`}
    <circle cx="58" cy="16" r="10" fill="#FFD9B3" stroke="${INK}" stroke-width="2.6"/>
    ${EYE(62, 14, 3)}
    ${BLUSH(66, 19, 2.4)}
    ${SMILE(63, 21, 5)}
    <path d="M47,12 Q58,0 69,12 L69,15 Q58,8 47,15 Z" fill="#FFC93C" stroke="${INK}" stroke-width="2" stroke-linejoin="round"/>`,

  // 小马：棕马红鞍，四腿两帧交错（小跑）+ 尾巴摆动
  horse: (f) => `
    <path d="M32,40 Q${f ? "20,38 17,48" : "22,34 16,42"}" fill="none" stroke="#8A562F" stroke-width="5" stroke-linecap="round"/>
    ${f
      ? `<path d="M44,56 L41,70 M57,58 L57,72 M67,58 L70,71 M77,55 L81,67" stroke="#8A562F" stroke-width="4.8" stroke-linecap="round"/>`
      : `<path d="M44,56 L47,69 M57,58 L53,71 M67,58 L64,71 M77,55 L75,69" stroke="#8A562F" stroke-width="4.8" stroke-linecap="round"/>`}
    <ellipse cx="56" cy="45" rx="27" ry="14" fill="#C98A4B" stroke="${INK}" stroke-width="2.8"/>
    <path d="M76,40 Q82,20 94,15 Q103,12 103,21 L99,29 Q91,33 87,44 Z" fill="#C98A4B" stroke="${INK}" stroke-width="2.6" stroke-linejoin="round"/>
    <path d="M93,14 L95,6 L100,12 Z" fill="#C98A4B" stroke="${INK}" stroke-width="1.8" stroke-linejoin="round"/>
    <path d="M77,34 Q83,18 93,12" fill="none" stroke="#8A562F" stroke-width="5" stroke-linecap="round"/>
    ${EYE(95, 21, 2.8)}
    ${BLUSH(90, 27, 2.4)}
    <rect x="46" y="27" width="22" height="11" rx="5" fill="#FF4B3C" stroke="${INK}" stroke-width="2.2"/>
    <circle cx="99" cy="27" r="1.6" fill="${INK}"/>`,

  // 飞碟：玻璃罩里绿皮大眼外星人，灯珠轮换色 + 底部光束闪烁 + 漂浮
  ufo: (f) => `
    <path d="M46,54 L74,54 L${f ? "86,78 L34,78" : "80,74 L40,74"} Z" fill="#B9F6CA" opacity="${f ? 0.55 : 0.22}"/>
    <g transform="translate(0,${f ? -2.5 : 0})">
      <path d="M42,42 Q44,20 60,20 Q76,20 78,42 Z" fill="#AEE3F8" opacity="0.9" stroke="${INK}" stroke-width="2.4" stroke-linejoin="round"/>
      <circle cx="60" cy="32" r="7.5" fill="#7CE38B" stroke="${INK}" stroke-width="2.2"/>
      <circle cx="56.8" cy="31" r="2.6" fill="${INK}"/>
      <circle cx="63.2" cy="31" r="2.6" fill="${INK}"/>
      <circle cx="57.6" cy="30" r="0.9" fill="#FFFFFF"/>
      <circle cx="64" cy="30" r="0.9" fill="#FFFFFF"/>
      <path d="M60,24.5 L60,14" stroke="${INK}" stroke-width="2" stroke-linecap="round"/>
      <circle cx="60" cy="12" r="2.6" fill="#FF4B3C" stroke="${INK}" stroke-width="1.6"/>
      <ellipse cx="60" cy="47" rx="35" ry="13" fill="#C9CFD6" stroke="${INK}" stroke-width="2.8"/>
      <ellipse cx="60" cy="44" rx="24" ry="6" fill="#E8ECF0" opacity="0.7"/>
      ${[34, 47, 60, 73, 86]
        .map((x, i) => {
          const colors = ["#FF4B3C", "#FFC93C", "#4CC96F", "#3CA7E8", "#FF9FB2"];
          const c = colors[(i + (f ? 1 : 0)) % colors.length];
          return `<circle cx="${x}" cy="${50 + (i === 2 ? 3 : i === 1 || i === 3 ? 2 : 0)}" r="2.8" fill="${c}" stroke="${INK}" stroke-width="1.4"/>`;
        })
        .join("")}
    </g>`,

  // 自由泳：蓝色水面 + 戴红泳帽的小人。两帧是自由泳的完整划水循环：
  // 帧0 手臂前伸入水（前方溅水花），帧1 手臂空中移臂（身后推水水花+打腿），
  // 身体随划水上下轻伏；前层波浪线盖住身体下半部，营造半浸在水里的感觉。
  swim: (f) => `
    <path d="M0,58 Q15,50 30,58 Q45,66 60,58 Q75,50 90,58 Q105,66 120,58 L120,80 L0,80 Z" fill="#B7E3F7"/>
    <g transform="translate(0,${f ? -1.6 : 0.6})">
      <path d="M40,60 L${f ? "24,64" : "27,54"}" stroke="#E8BF96" stroke-width="5.5" stroke-linecap="round"/>
      <path d="M40,58 Q60,52 78,46" fill="none" stroke="#FFD9B3" stroke-width="9.5" stroke-linecap="round"/>
      <path d="M72,48 Q64,57 55,60" fill="none" stroke="#F0C49C" stroke-width="5" stroke-linecap="round" opacity="0.75"/>
      ${f
        ? `<path d="M76,45 Q88,28 100,34" fill="none" stroke="#FFD9B3" stroke-width="5.8" stroke-linecap="round"/>`
        : `<path d="M76,45 Q88,42 101,45" fill="none" stroke="#FFD9B3" stroke-width="5.8" stroke-linecap="round"/>`}
      <circle cx="86" cy="37" r="10" fill="#FFD9B3" stroke="${INK}" stroke-width="2.4"/>
      <path d="M76,33 Q79,24 88,25 Q95,27 95,35 Q85,29 76,33 Z" fill="#FF4B3C" stroke="${INK}" stroke-width="1.8" stroke-linejoin="round"/>
      ${EYE(89, 38, 2.8)}
      ${BLUSH(92, 42.5, 2.1)}
      <path d="M79,32 Q86,26 94,30" fill="none" stroke="#AEE3F8" stroke-width="2" stroke-linecap="round"/>
    </g>
    <path d="M0,58 Q15,50 30,58 Q45,66 60,58 Q75,50 90,58 Q105,66 120,58" fill="none" stroke="#3CA7E8" stroke-width="3" stroke-linecap="round"/>
    ${f
      ? `<circle cx="46" cy="52" r="3" fill="#FFFFFF"/><circle cx="38" cy="46" r="2.2" fill="#FFFFFF"/><circle cx="53" cy="45" r="1.8" fill="#FFFFFF"/>`
      : `<circle cx="105" cy="49" r="3.2" fill="#FFFFFF"/><circle cx="112" cy="54" r="2.2" fill="#FFFFFF"/><circle cx="110" cy="43" r="1.8" fill="#FFFFFF"/>`}`,

  // 火箭：胖白火箭红头锥，尾焰大小交替（喷射）
  rocket: (f) => `
    ${f
      ? `<path d="M34,40 Q14,34 2,44 Q14,54 34,50 Z" fill="#FF8A3C" stroke="${INK}" stroke-width="2" stroke-linejoin="round"/>
         <path d="M32,43 Q20,40 12,44 Q20,49 32,48 Z" fill="#FFE27A"/>`
      : `<path d="M34,41 Q20,37 10,44 Q20,51 34,49 Z" fill="#FF8A3C" stroke="${INK}" stroke-width="2" stroke-linejoin="round"/>
         <path d="M32,43 Q23,41 17,44 Q23,48 32,47 Z" fill="#FFE27A"/>`}
    <path d="M38,37 L26,25 Q35,23 42,30 Z" fill="#FF4B3C" stroke="${INK}" stroke-width="2.4" stroke-linejoin="round"/>
    <path d="M38,53 L26,65 Q35,67 44,59 Z" fill="#FF4B3C" stroke="${INK}" stroke-width="2.4" stroke-linejoin="round"/>
    <path d="M36,36 Q60,25 92,33 Q105,37 107,44 Q105,51 92,55 Q60,63 36,53 Q29,44 36,36 Z" fill="#FFFFFF" stroke="${INK}" stroke-width="2.8" stroke-linejoin="round"/>
    <path d="M88,32 Q102,36 107,44 Q102,52 88,56 Q95,44 88,32 Z" fill="#FF4B3C" stroke="${INK}" stroke-width="2.4" stroke-linejoin="round"/>
    <circle cx="66" cy="43" r="6.5" fill="#AEE3F8" stroke="${INK}" stroke-width="2.4"/>
    <circle cx="68" cy="41" r="2" fill="#FFFFFF"/>
    ${BLUSH(80, 48, 3)}
    ${SMILE(82, 51, 6)}`,
};

/**
 * 车辆卡通插画（侧面视角，默认朝右）。
 * @param frame 动画帧（0/1），两帧交替产生动效
 * @param flip  水平镜像（朝西行驶时用，保证载具正立不颠倒）
 */
export function vehicleIconSvg(transport: Transport, frame = 0, flip = false): string {
  const draw = CARTOON[transport] ?? CARTOON.car;
  const inner = draw(frame ? 1 : 0);
  const body = flip
    ? `<g transform="translate(120,0) scale(-1,1)">${inner}</g>`
    : inner;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80" viewBox="0 0 120 80">${body}</svg>`;
}

// Phosphor fill 256x256 path（地点类别标记）
const STOP_TYPE_PATH: Record<StopType, string> = {
  attraction: "M239.18,97.26A16.38,16.38,0,0,0,224.92,86l-59-4.76L143.14,26.15a16.36,16.36,0,0,0-30.27,0L90.11,81.23,31.08,86a16.46,16.46,0,0,0-9.37,28.86l45,38.83L53,211.75a16.38,16.38,0,0,0,24.5,17.82L128,198.49l50.53,31.08A16.4,16.4,0,0,0,203,211.75l-13.76-58.07,45-38.83A16.43,16.43,0,0,0,239.18,97.26Z",
  museum: "M24,104H48v64H32a8,8,0,0,0,0,16H224a8,8,0,0,0,0-16H208V104h24a8,8,0,0,0,4.19-14.81l-104-64a8,8,0,0,0-8.38,0l-104,64A8,8,0,0,0,24,104ZM248,208a8,8,0,0,1-8,8H16a8,8,0,0,1,0-16H240A8,8,0,0,1,248,208Z",
  park: "M232,192H200V168h24a8,8,0,0,0,7.76-9.94l-32-128a8,8,0,0,0-15.52,0l-32,128A8,8,0,0,0,160,168h24v24H120V176h8a8,8,0,0,0,0-16h-8V144h8a8,8,0,0,0,0-16H40a8,8,0,0,0,0,16h8v16H40a8,8,0,0,0,0,16h8v16H24a8,8,0,0,0,0,16H232a8,8,0,0,0,0-16Zm-128,0H64V176h40Zm0-32H64V144h40Zm12-64A28,28,0,1,0,88,68,28,28,0,0,0,116,96Zm0-40a12,12,0,1,1-12,12A12,12,0,0,1,116,56Z",
  zoo: "M212,80a28,28,0,1,0,28,28A28,28,0,0,0,212,80ZM72,108a28,28,0,1,0-28,28A28,28,0,0,0,72,108ZM92,88A28,28,0,1,0,64,60,28,28,0,0,0,92,88Zm72,0a28,28,0,1,0-28-28,28,28,0,0,0,28,28Zm23.12,100.86a35.3,35.3,0,0,1-16.87-21.14,44,44,0,0,0-84.5,0A35.25,35.25,0,0,1,69,148.82,40,40,0,0,0,88,224a40,40,0,0,0,15.52-3.13,64.09,64.09,0,0,1,48.87,0,40,40,0,0,0,34.73-72Z",
  hotel: "M216,72H32V48a8,8,0,0,0-16,0V208a8,8,0,0,0,16,0V176H240v32a8,8,0,0,0,16,0V112A40,40,0,0,0,216,72ZM32,88h72v72H32Zm88,72V88h96a24,24,0,0,1,24,24v48Z",
  airport: "M235.58,128.84,160,91.06V48a32,32,0,0,0-64,0V91.06L20.42,128.84A8,8,0,0,0,16,136v32a8,8,0,0,0,9.57,7.84L96,161.76v18.93L82.34,194.34A8,8,0,0,0,80,200v32a8,8,0,0,0,11,7.43l37-14.81,37,14.81A8,8,0,0,0,176,232V200a8,8,0,0,0-2.34-5.66L160,180.69V161.76l70.43,14.08A8,8,0,0,0,240,168V136A8,8,0,0,0,235.58,128.84Z",
  station: "M223.72,117.9,201.33,35.79A16,16,0,0,0,185.89,24H70.11A16,16,0,0,0,54.67,35.79L32.28,117.9a8.08,8.08,0,0,0,0,4.2l22.39,82.11A16,16,0,0,0,70.11,216H80L65.6,235.2a8,8,0,1,0,12.8,9.6L100,216h56l21.6,28.8a8,8,0,1,0,12.8-9.6L176,216h9.89a16,16,0,0,0,15.44-11.79l22.39-82.11A8.08,8.08,0,0,0,223.72,117.9Z",
  beach: "M240,126.63A112.44,112.44,0,0,0,51.75,53.75a111.56,111.56,0,0,0-35.7,72.88A16,16,0,0,0,32,144h88v56a32,32,0,0,0,64,0,8,8,0,0,0-16,0,16,16,0,0,1-32,0V144h88a16,16,0,0,0,16-17.37Z",
  lake: "M222.16,177.25a8,8,0,0,1-1,11.25c-17.36,14.39-32.86,19.5-47,19.5-18.58,0-34.82-8.82-49.93-17-25.35-13.76-47.24-25.64-79.07.74a8,8,0,1,1-10.22-12.31c40.17-33.28,70.32-16.92,96.93-2.48,25.35,13.75,47.24,25.63,79.07-.74A8,8,0,0,1,222.16,177.25ZM45.11,79.8c31.83-26.37,53.72-14.49,79.07-.74,15.11,8.2,31.35,17,49.93,17,14.14,0,29.64-5.12,47-19.5a8,8,0,1,0-10.22-12.31c-31.83,26.38-53.72,14.5-79.07.74C105.21,50.58,75.06,34.22,34.89,67.5A8,8,0,1,0,45.11,79.8Z",
  mountain: "M164,80a28,28,0,1,0-28-28A28,28,0,0,0,164,80Zm90.88,155.92-54.56-92.08A15.87,15.87,0,0,0,186.55,96h0a15.85,15.85,0,0,0-13.76,7.84L146.63,148l-44.84-76.1a16,16,0,0,0-27.58,0L1.11,195.94A8,8,0,0,0,8,208H248a8,8,0,0,0,6.88-12.08Z",
  restaurant: "M72,88V40a8,8,0,0,1,16,0V88a8,8,0,0,1-16,0ZM216,40V224a8,8,0,0,1-16,0V176H152a8,8,0,0,1-8-8,268.75,268.75,0,0,1,7.22-56.88c9.78-40.49,28.32-67.63,53.63-78.47A8,8,0,0,1,216,40ZM119.89,38.69a8,8,0,1,0-15.78,2.63L112,88.63a32,32,0,0,1-64,0l7.88-47.31a8,8,0,1,0-15.78-2.63l-8,48A8.17,8.17,0,0,0,32,88a48.07,48.07,0,0,0,40,47.32V224a8,8,0,0,0,16,0V135.32A48.07,48.07,0,0,0,128,88a8.17,8.17,0,0,0-.11-1.31Z",
  scenic: "M208,32H48A16,16,0,0,0,32,48V208a16,16,0,0,0,16,16H208a16,16,0,0,0-16-16V48A16,16,0,0,0,208,32ZM48,48H208v77.38l-24.69-24.7a16,16,0,0,0-22.62,0L53.37,208H48ZM208,208H76l96-96,36,36v60ZM96,120A24,24,0,1,0,72,96,24,24,0,0,0,96,120Z",
  city: "M240,208h-8V88a8,8,0,0,0-8-8H160a8,8,0,0,0-8,8v40H104V40a8,8,0,0,0-8-8H32a8,8,0,0,0-8,8V208H16a8,8,0,0,0,0,16H240a8,8,0,0,0,0-16ZM72,184a8,8,0,0,1-16,0V168a8,8,0,0,1,16,0Zm0-48a8,8,0,0,1-16,0V120a8,8,0,0,1,16,0Zm0-48a8,8,0,0,1-16,0V72a8,8,0,0,1,16,0Zm64,96a8,8,0,0,1-16,0V168a8,8,0,0,1,16,0Zm64,0a8,8,0,0,1-16,0V168a8,8,0,0,1,16,0Zm0-48a8,8,0,0,1-16,0V120a8,8,0,0,1,16,0Z",
  tower: "M208,80a8,8,0,0,0-8,8v16H188.85L184,55.2A8,8,0,0,0,181.31,50h0L138.44,11.88l-.2-.17a16,16,0,0,0-20.48,0l-.2.17L74.68,50v0A7.93,7.93,0,0,0,72,55.2L67.15,104H56V88a8,8,0,0,0-16,0v24a8,8,0,0,0,8,8H65.54l-9.47,94.48A16,16,0,0,0,72,232H184a16,16,0,0,0,15.92-17.56L190.46,120H208a8,8,0,0,0,8-8V88A8,8,0,0,0,208,80ZM87.24,64h81.52l4,40H136V88a8,8,0,0,0-16,0v16H83.23ZM72,216l4.81-48H179.19L184,216Z",
  skyscraper: "M232,224H208V32h8a8,8,0,0,0,0-16H40a8,8,0,0,0,0,16h8V224H24a8,8,0,0,0,0,16H232a8,8,0,0,0,0-16ZM88,56h24a8,8,0,0,1,0,16H88a8,8,0,0,1,0-16Zm0,40h24a8,8,0,0,1,0,16H88a8,8,0,0,1,0-16Zm-8,48a8,8,0,0,1,8-8h24a8,8,0,0,1,0,16H88A8,8,0,0,1,80,144Zm72,80H104V184h48Zm16-72H144a8,8,0,0,1,0-16h24a8,8,0,0,1,0,16Zm0-40H144a8,8,0,0,1,0-16h24a8,8,0,0,1,0,16Zm0-40H144a8,8,0,0,1,0-16h24a8,8,0,0,1,0,16Z",
  skyline: "M239.73,208H224V96a16,16,0,0,0-16-16H164a4,4,0,0,0-4,4V208H144V32.41a16.43,16.43,0,0,0-6.16-13,16,16,0,0,0-18.72-.69L39.12,72A16,16,0,0,0,32,85.34V208H16.27A8.18,8.18,0,0,0,8,215.47,8,8,0,0,0,16,224H240a8,8,0,0,0,8-8.53A8.18,8.18,0,0,0,239.73,208ZM76,184a8,8,0,0,1-8.53,8A8.18,8.18,0,0,1,60,183.72V168.27A8.19,8.19,0,0,1,67.47,160,8,8,0,0,1,76,168Zm0-56a8,8,0,0,1-8.53,8A8.19,8.19,0,0,1,60,127.72V112.27A8.19,8.19,0,0,1,67.47,104,8,8,0,0,1,76,112Zm40,56a8,8,0,0,1-8.53,8,8.18,8.18,0,0,1-7.47-8.26V168.27a8.19,8.19,0,0,1,7.47-8.26,8,8,0,0,1,8.53,8Zm0-56a8,8,0,0,1-8.53,8,8.19,8.19,0,0,1-7.47-8.26V112.27a8.19,8.19,0,0,1,7.47-8.26,8,8,0,0,1,8.53,8Z",
  garden: "M245.83,121.63a15.53,15.53,0,0,0-9.52-7.33,73.55,73.55,0,0,0-22.17-2.22c4-19.85,1-35.55-2-44.86a16.17,16.17,0,0,0-18.8-10.88,85.53,85.53,0,0,0-28.55,12.12,94.58,94.58,0,0,0-27.11-33.25,16.05,16.05,0,0,0-19.26,0A94.58,94.58,0,0,0,91.26,68.46,85.53,85.53,0,0,0,62.71,56.34,16.14,16.14,0,0,0,43.92,67.22c-3,9.31-6,25-2.06,44.86a73.55,73.55,0,0,0-22.17,2.22,15.53,15.53,0,0,0-9.52,7.33,16,16,0,0,0-1.6,12.26c3.39,12.58,13.8,36.49,45.33,55.33S113.13,208,128.05,208s42.67,0,74-18.78c31.53-18.84,41.94-42.75,45.33-55.33A16,16,0,0,0,245.83,121.63ZM62.1,175.49C35.47,159.57,26.82,140.05,24,129.7a59.61,59.61,0,0,1,22.5-1.17,129.08,129.08,0,0,0,9.15,19.41,142.28,142.28,0,0,0,34,39.56A114.92,114.92,0,0,1,62.1,175.49ZM128,190.4c-9.33-6.94-32-28.23-32-71.23C96,76.7,118.38,55.24,128,48c9.62,7.26,32,28.72,32,71.19C160,162.17,137.33,183.46,128,190.4Zm104-60.68c-2.77,10.24-11.4,29.81-38.09,45.77a114.92,114.92,0,0,1-27.55,12,142.28,142.28,0,0,0,34-39.56,129.08,129.08,0,0,0,9.15-19.41A59.69,59.69,0,0,1,232,129.71Z",
  forest: "M231.19,195.51A8,8,0,0,1,224,200H136v40a8,8,0,0,1-16,0V200H32a8,8,0,0,1-6.31-12.91l46-59.09H48a8,8,0,0,1-6.34-12.88l80-104a8,8,0,0,1,12.68,0l80,104A8,8,0,0,1,208,128H184.36l45.95,59.09A8,8,0,0,1,231.19,195.51Z",
  river: "M216,40H40A16,16,0,0,0,24,56V200a16,16,0,0,0,16,16H216a16,16,0,0,0,16-16V56A16,16,0,0,0,216,40Zm-4.78,91.44c-16.68,35-31.06,50.56-46.65,50.56-19.68,0-31.39-24.56-43.79-50.56C112,113,101,90,91.43,90c-3.74,0-14.37,4-32.21,41.44a8,8,0,0,1-14.44-6.88C61.46,89.59,75.84,74,91.43,74c19.68,0,31.39,24.56,43.79,50.56C144,143,155,166,164.57,166c3.74,0,14.37-4,32.21-41.44a8,8,0,1,1,14.44,6.88Z",
  sea: "M239.55,226.65A8,8,0,0,1,232,232H24a8,8,0,0,1-5-14.25c1.63-1.3,38.53-30.26,98.29-33.45A120,120,0,0,1,114,146.37c1.73-21.71,10.91-50.63,42.95-72.48a66.28,66.28,0,0,0-15-1.87l-1.67,0c-19,.62-30.94,11.71-36.5,33.92A8,8,0,0,1,96,112a7.66,7.66,0,0,1-2-.24,8,8,0,0,1-5.82-9.7c9.25-36.95,33.11-45.42,51.5-46a81.43,81.43,0,0,1,21.68,2.45c-3.82-6.33-9.42-12.93-17.21-16.25-10-4.24-22.17-2.39-36.31,5.51a8,8,0,0,1-7.8-14c18.74-10.45,35.72-12.54,50.48-6.2,12.49,5.36,20.73,15.78,25.88,25,6.17-9.64,13.87-16.17,22.38-18.94,11.86-3.87,24.64-.72,38,9.37a8,8,0,0,1-9.64,12.76c-8.91-6.73-16.77-9.06-23.34-6.93-7.3,2.35-12.87,10-16.38,16.61A70.46,70.46,0,0,1,208,73.07c14.61,8.35,32,26.05,32,62.94a8,8,0,0,1-16,0c0-23.46-8.06-40-24-49a50.49,50.49,0,0,0-5.75-2.8,55.64,55.64,0,0,1,5.06,33.06,59.41,59.41,0,0,1-8.86,23.41,8,8,0,0,1-13.09-9.2c.75-1.09,16.33-24.38-3.26-49.37-27,15.21-41.89,37.25-44.16,65.59a104.27,104.27,0,0,0,3.83,36.44c62.65,1.81,101.52,32.33,103.2,33.66A8,8,0,0,1,239.55,226.65ZM52,168a28,28,0,1,0-28-28A28,28,0,0,0,52,168Z",
  temple: "M216,216H200V115.31L211.31,104A15.86,15.86,0,0,0,216,92.69V48a16,16,0,0,0-16-16H180a8,8,0,0,0-8,8V64H148V40a8,8,0,0,0-8-8H116a8,8,0,0,0-8,8V64H84V40a8,8,0,0,0-8-8H56A16,16,0,0,0,40,48V92.69A15.86,15.86,0,0,0,44.69,104L56,115.31V216H40a8,8,0,0,0,0,16H216a8,8,0,0,0,0-16ZM112,168a16,16,0,0,1,32,0v48H112Z",
  bridge: "M232,160h-8V120.5c1.63.81,3.29,1.57,5,2.26a8,8,0,0,0,6-14.83A55.78,55.78,0,0,1,200,56a8,8,0,0,0-16,0A56,56,0,0,1,72,56a8,8,0,0,0-16,0,55.78,55.78,0,0,1-35,51.93,8,8,0,0,0,6,14.83c1.71-.69,3.37-1.45,5-2.26V160H24.6c-6.31,0-8.6,4.78-8.6,8a8,8,0,0,0,8,8H56v24a8,8,0,0,0,16,0V176H184v24a8,8,0,0,0,16,0V176h32a8,8,0,0,0,0-16ZM72,152a8,8,0,0,1-16,0V104.12a8,8,0,0,1,16,0Zm40,0a8,8,0,0,1-16,0V132.32a8,8,0,0,1,16,0Zm48,0a8,8,0,0,1-16,0V132.32a8,8,0,0,1,16,0Zm40,0a8,8,0,0,1-16,0V104.12a8,8,0,0,1,16,0Z",
  other: "M128,64a40,40,0,1,0,40,40A40,40,0,0,0,128,64Zm0,64a24,24,0,1,1,24-24A24,24,0,0,1,128,128Zm0-112a88.1,88.1,0,0,0-88,88c0,31.4,14.51,64.68,42,96.25a254.19,254.19,0,0,0,41.45,38.3,8,8,0,0,0,9.18,0A254.19,254.19,0,0,0,174,200.25c27.45-31.57,42-64.85,42-96.25A88.1,88.1,0,0,0,128,16Z",
};

/** 地点类别标记：深墨圆底 + 白色类别图标 */
export function stopTypeIconSvg(type: StopType): string {
  const d = STOP_TYPE_PATH[type] ?? STOP_TYPE_PATH.other;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48">
    <circle cx="24" cy="24" r="22" fill="${INK}"/>
    <g transform="translate(9 9) scale(0.12)" fill="${PAPER}"><path d="${d}"/></g>
  </svg>`;
}

export function iconDataUrl(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
