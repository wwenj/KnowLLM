import { Navigate, createBrowserRouter } from "react-router-dom";
import { AppLayout } from "@/components/AppLayout";
import { NotFound } from "@/components/NotFound";
import { Chat } from "@/pages/Chat";
import { DeepAgent } from "@/pages/DeepAgent";
import { LlmWiki } from "@/pages/LlmWiki";

export const router = createBrowserRouter([
  {
    path: "/",
    element: <AppLayout />,
    children: [
      { index: true, element: <Navigate to="/llm-wiki" replace /> },
      { path: "chat", element: <Chat /> },
      { path: "agents", element: <DeepAgent /> },
      { path: "llm-wiki", element: <LlmWiki /> },
    ],
  },
  { path: "*", element: <NotFound /> },
]);
