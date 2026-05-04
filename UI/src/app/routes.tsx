import { createBrowserRouter } from "react-router";
import { WorkspaceLayout } from "./components/workspace/WorkspaceLayout";
import { ProjectView } from "./components/workspace/ProjectView";
import { MyWorkspaceView } from "./components/workspace/MyWorkspaceView";
import { AiDesignView } from "./components/workspace/AiDesignView";
import { Welcome } from "./components/workspace/Welcome";

export const router = createBrowserRouter([
  {
    path: "/",
    Component: WorkspaceLayout,
    children: [
      { index: true, Component: Welcome },
      { path: "project/:projectId", Component: ProjectView },
      { path: "project/:projectId/workspace", Component: MyWorkspaceView },
      { path: "project/:projectId/design", Component: AiDesignView },
    ],
  },
]);
