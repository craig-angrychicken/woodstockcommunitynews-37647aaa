import { useState } from "react";
import { Link } from "react-router-dom";
import { NavLink } from "@/components/NavLink";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { User, ChevronDown } from "lucide-react";

export const Navigation = () => {
  return (
    <nav className="sticky top-0 z-50 bg-nav border-b border-nav-border">
      <div className="mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex h-16 items-center justify-between">
          <div className="flex items-center gap-8">
            <Link to="/" className="text-xl font-semibold text-foreground">
              Woodstock Wire Admin
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
            </div>
          </div>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className="gap-2">
                <User className="h-4 w-4" />
                <span className="hidden sm:inline">Account</span>
                <ChevronDown className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48 bg-popover z-50">
              <DropdownMenuLabel>My Account</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem>Profile</DropdownMenuItem>
              <DropdownMenuItem>Settings</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem className="text-destructive">
                Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </nav>
  );
};
