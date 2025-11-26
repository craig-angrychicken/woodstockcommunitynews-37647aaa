import { Link } from "react-router-dom";
import { NavLink } from "@/components/NavLink";
import { UserMenu } from "@/components/UserMenu";

export const Navigation = () => {
  return (
    <nav className="sticky top-0 z-50 bg-nav border-b border-nav-border">
      <div className="mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex h-16 items-center justify-between">
          <div className="flex items-center gap-8">
            <Link to="/" className="text-xl font-semibold text-foreground">
              Woodstock Community News Admin
            </Link>
            
            <div className="hidden md:flex items-center gap-1">
              <NavLink
                to="/"
                end
                className="px-3 py-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
                activeClassName="text-primary"
              >
                Dashboard
              </NavLink>
              <NavLink
                to="/stories"
                className="px-3 py-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
                activeClassName="text-primary"
              >
                Stories
              </NavLink>
              <NavLink
                to="/manual-query"
                className="px-3 py-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
                activeClassName="text-primary"
              >
                Fetch Artifacts
              </NavLink>
              <NavLink
                to="/ai-journalist"
                className="px-3 py-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
                activeClassName="text-primary"
              >
                AI Journalist
              </NavLink>
              <NavLink
                to="/artifacts"
                className="px-3 py-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
                activeClassName="text-primary"
              >
                Artifacts
              </NavLink>
              <NavLink
                to="/prompts"
                className="px-3 py-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
                activeClassName="text-primary"
              >
                Prompts
              </NavLink>
              <NavLink
                to="/sources"
                className="px-3 py-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
                activeClassName="text-primary"
              >
                Sources
              </NavLink>
              <NavLink
                to="/models"
                className="px-3 py-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
                activeClassName="text-primary"
              >
                Models
              </NavLink>
            </div>
          </div>

          <UserMenu />
        </div>
      </div>
    </nav>
  );
};
