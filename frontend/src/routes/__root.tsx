import { createRootRoute, Outlet } from '@tanstack/react-router';
import { OverviewProvider } from '../app/overview.tsx';
import { SideMenu } from '../components/SideMenu.tsx';

export const Route = createRootRoute({ component: Root });

function Root() {
  return (
    <OverviewProvider>
      <div className="app-shell">
        <SideMenu />
        <div className="app-content">
          <Outlet />
        </div>
      </div>
    </OverviewProvider>
  );
}
