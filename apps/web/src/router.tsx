import { Navigate, createBrowserRouter } from "react-router-dom";
import { AppLayout } from "@/components/AppLayout";
import { NotFound } from "@/components/NotFound";
import { DeepAgent } from "@/pages/DeepAgent";
import { LlmWikiAgentEvaluation } from "@/pages/LlmWikiAgentEvaluation";
import { LlmWikiEvaluation } from "@/pages/LlmWikiEvaluation";
import { LlmWikiNext } from "@/pages/LlmWikiNext";

export const router = createBrowserRouter([
  {
    path: "/",
    element: <AppLayout />,
    children: [
      { index: true, element: <Navigate to="/llm-wiki-next" replace /> },
      { path: "agents", element: <DeepAgent /> },
      { path: "llm-wiki-next", element: <LlmWikiNext /> },
      { path: "evaluations/llm-wiki-compile", element: <LlmWikiEvaluation /> },
      { path: "evaluations/llm-wiki-agent", element: <LlmWikiAgentEvaluation /> },
    ],
  },
  { path: "*", element: <NotFound /> },
]);
