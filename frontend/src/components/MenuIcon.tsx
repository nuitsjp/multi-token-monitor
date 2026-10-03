const paths = {
  home: <path d="M3 11l9-8 9 8M5 10v10h5v-6h4v6h5V10" />,
  hub: (
    <>
      <rect x="3" y="4" width="18" height="6" rx="1.5" />
      <rect x="3" y="14" width="18" height="6" rx="1.5" />
      <path d="M7 7h.01M7 17h.01" />
    </>
  ),
  model: <path d="M12 3l8 4.5v9L12 21l-8-4.5v-9zM12 12l8-4.5M12 12v9M12 12L4 7.5" />,
  limits: <path d="M4.5 17a8.5 8.5 0 1 1 15 0M12 14l4-5" />,
  devices: (
    <>
      <rect x="3" y="4" width="18" height="12" rx="2" />
      <path d="M8 20h8M12 16v4" />
    </>
  ),
  activity: (
    <>
      <rect x="3" y="4" width="18" height="17" rx="2" />
      <path d="M3 9h18M8 2v4M16 2v4" />
    </>
  ),
  logo: <path d="M4 18V9M10 18V5M16 18v-7M22 18H2" />,
};

export type MenuIconName = keyof typeof paths;

// メニューと、Homeの対応する区画の見出しで同じアイコンを使う。
export function MenuIcon({ name, size = 18 }: { name: MenuIconName; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      // 文字の見た目の中心は行の中心より文字サイズの約6%下にあるため、アイコンもその分下げる。
      style={{ display: 'block', transform: `translateY(${size * 0.06}px)` }}
    >
      {paths[name]}
    </svg>
  );
}
