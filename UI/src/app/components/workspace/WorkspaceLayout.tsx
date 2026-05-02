import { Outlet } from "react-router";
import { Toaster } from "../ui/sonner";

export function WorkspaceLayout() {
  return (
    <div className="h-screen w-screen overflow-hidden bg-[var(--color-background)]">
      <Outlet />
      <Toaster />
    </div>
  );
}
