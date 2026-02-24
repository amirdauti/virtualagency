import React from "react";
import ReactDOM from "react-dom/client";
import { LegalPage } from "./LegalPage";
import "./styles/globals.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <LegalPage kind="terms" />
  </React.StrictMode>
);
