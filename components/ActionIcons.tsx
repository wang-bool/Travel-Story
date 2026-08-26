// ============================================================
// Travel Story — 首页三动作的手绘风图标
//
// 全部内联 SVG + currentColor：自动适配深色按钮 / 幽灵按钮及其
// hover 反色，不需要换色逻辑。默认静态，悬停时动起来：
//   DoorIcon       紧闭的大门 → 悬停时门扇绕合页打开，透出暖光
//   PenPaperIcon   笔搁在纸上 → 悬停时笔来回走字，纸上逐行写出内容
//   FootstepsIcon  一双脚印   → 悬停时左右脚交替迈步
// 动画全部走 CSS（globals.css 的 .btn:hover 作用域），SVG 里只留结构。
// ============================================================

/** 紧闭的大门（悬停打开） */
export function DoorIcon({ size = 18 }: { size?: number }) {
  return (
    <svg
      className="icon icon-door"
      width={size}
      height={size}
      viewBox="0 0 18 18"
      fill="none"
      aria-hidden="true"
    >
      {/* 门框 */}
      <rect x="3.5" y="2" width="11" height="14" rx="1" stroke="currentColor" strokeWidth="1.4" />
      {/* 门内透出的暖光（悬停门开时才看见；暖黄色，
          不能用主题朱红——悬停时按钮底色就是它，会隐身） */}
      <rect className="door-light" x="4.8" y="3.3" width="8.4" height="11.4" fill="#f2c14e" />
      {/* 门板：合页在左，悬停时绕左边透视旋开 */}
      <g className="door-panel">
        <rect x="4.8" y="3.3" width="8.4" height="11.4" stroke="currentColor" strokeWidth="1.3" />
        <circle cx="11.2" cy="9" r="0.85" fill="currentColor" />
      </g>
    </svg>
  );
}

/** 笔在纸上（悬停开始书写，纸上逐行出现内容） */
export function PenPaperIcon({ size = 18 }: { size?: number }) {
  return (
    <svg
      className="icon icon-pen"
      width={size}
      height={size}
      viewBox="0 0 18 18"
      fill="none"
      aria-hidden="true"
    >
      {/* 纸 */}
      <rect x="2.5" y="3.5" width="13" height="12" rx="1.2" stroke="currentColor" strokeWidth="1.3" />
      {/* 纸上的三行字：pathLength=1，用 dashoffset 控制「写出来」 */}
      <path className="wl wl-1" d="M5 7.4 H13" pathLength={1} stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      <path className="wl wl-2" d="M5 9.9 H13" pathLength={1} stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      <path className="wl wl-3" d="M5 12.4 H10.2" pathLength={1} stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      {/* 笔：先平移旋转到纸的右上角，动画只动内部 .pen-body */}
      <g transform="translate(11.8,3.6) rotate(35)">
        <g className="pen-body">
          <rect x="-1.05" y="-6.2" width="2.1" height="6.6" rx="1.05" fill="currentColor" />
          <path d="M-1.05 0.4 H1.05 L0 2.9 Z" fill="currentColor" />
        </g>
      </g>
    </svg>
  );
}

/** 一双脚印（悬停交替迈步） */
export function FootstepsIcon({ size = 18 }: { size?: number }) {
  return (
    <svg
      className="icon icon-feet"
      width={size}
      height={size}
      viewBox="0 0 18 18"
      fill="none"
      aria-hidden="true"
    >
      {/* 左脚（落后，在左下） */}
      <g className="foot foot-l">
        <ellipse cx="5.2" cy="11.2" rx="2" ry="3.1" transform="rotate(-16 5.2 11.2)" fill="currentColor" />
        <circle cx="6.9" cy="6.5" r="1.1" fill="currentColor" />
      </g>
      {/* 右脚（领先，在右上） */}
      <g className="foot foot-r">
        <ellipse cx="12.6" cy="7.2" rx="2" ry="3.1" transform="rotate(-16 12.6 7.2)" fill="currentColor" />
        <circle cx="14.3" cy="2.5" r="1.1" fill="currentColor" />
      </g>
    </svg>
  );
}
