import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";

// Hide loading screen once React is ready
const hideLoading = () => {
  const loading = document.getElementById("loading");
  if (loading) {
    loading.style.opacity = "0";
    loading.style.transition = "opacity 0.3s ease-out";
    setTimeout(() => {
      loading.remove();
    }, 300);
  }
};

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

// Hide loading screen after a short delay to ensure app is rendered
setTimeout(hideLoading, 100);
