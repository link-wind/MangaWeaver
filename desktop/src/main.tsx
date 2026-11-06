import { createRoot } from "react-dom/client";
import App from "./App";
import {TooltipProvider} from "./components/ui/tooltip";
import "./style.css";
import "./workbench.css";
import "./canvas.css";
createRoot(document.getElementById("root")!).render(<TooltipProvider><App/></TooltipProvider>);
