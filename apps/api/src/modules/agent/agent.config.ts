import * as path from "node:path";
import { getDataRoot } from "../../config/data-root";

export const agentConfig = {
  runRoot: path.join(getDataRoot(), "agents", "runs"),
  defaultFastModel: process.env.AGENT_FAST_MODEL || "",
  defaultMainModel: process.env.AGENT_MAIN_MODEL || ""
};
