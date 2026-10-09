import { Link, useRouterState } from '@tanstack/react-router';
import { NavLink } from '@mantine/core';
import { MenuIcon } from './MenuIcon.tsx';

// 名前はデータの値をそのまま表示する。空文字で届く値は並べない。
export const joinLabels = (...values: (string | null)[]) => values.filter(Boolean).join(' · ');

// 左の縦メニュー。
export function SideMenu() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });

  return (
    <nav aria-label="Menu" className="side-menu">
      <div className="brand">
        <span className="brand-logo">
          <MenuIcon name="logo" size={17} />
        </span>
        <span className="brand-name">Token Monitor Analytics</span>
      </div>
      <NavLink
        component={Link}
        to="/"
        label="Home"
        leftSection={<MenuIcon name="home" />}
        active={pathname === '/'}
      />
      <NavLink
        component={Link}
        to="/by-hub"
        label="By hub"
        leftSection={<MenuIcon name="hub" />}
        active={pathname === '/by-hub'}
      />
      <NavLink
        component={Link}
        to="/by-model"
        label="By model"
        leftSection={<MenuIcon name="model" />}
        active={pathname === '/by-model'}
      />
      <NavLink
        component={Link}
        to="/by-device"
        label="By device"
        leftSection={<MenuIcon name="devices" />}
        active={pathname === '/by-device'}
      />
      <NavLink
        component={Link}
        to="/settings"
        label="Settings"
        className="side-menu-bottom"
        leftSection={<MenuIcon name="settings" />}
        active={pathname === '/settings'}
      />
    </nav>
  );
}
