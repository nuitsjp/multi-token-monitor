import { createRootRoute, Outlet } from '@tanstack/react-router';
import { OverviewProvider } from '../app/overview.tsx';
import { MenuIcon } from '../components/MenuIcon.tsx';
import { SideMenu } from '../components/SideMenu.tsx';

export const Route = createRootRoute({ component: Root });

function Root() {
  return (
    <OverviewProvider>
      <header className="top-bar">
        <span className="brand-logo">
          <MenuIcon name="logo" size={17} />
        </span>
        <span className="brand-name">Token Monitor Analytics</span>
      </header>
      <div className="app-shell">
        <SideMenu />
        <div className="app-content">
          <Outlet />
        </div>
      </div>
    </OverviewProvider>
  );
}
