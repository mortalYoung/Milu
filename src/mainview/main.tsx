import { createRoot } from "react-dom/client";
import { App } from "./App";
import { boot } from "./lib/controllers";
import "./style.css";

boot();
createRoot(document.getElementById("app")!).render(<App />);
