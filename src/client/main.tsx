import React from "react";
import { createRoot } from "react-dom/client";
import { CopilotChat, CopilotKit } from "@copilotkit/react-core/v2";
import "@copilotkit/react-core/v2/styles.css";
import "./styles.css";

const resourceId =
  localStorage.getItem("mastra-resource-id") ?? crypto.randomUUID();
localStorage.setItem("mastra-resource-id", resourceId);

function App() {
  return (
    <CopilotKit
      runtimeUrl="/api/copilotkit"
      headers={{ "x-mastra-resource-id": resourceId }}
    >
      <main className="app-shell">
        <section className="intro-panel">
          <p className="eyebrow">WEATHER DESK / 01</p>
          <h1>Plan the day around the sky.</h1>
          <p className="lede">
            Ask for current conditions, a forecast, or a weather-aware plan for
            your next trip.
          </p>
          <div className="prompt-grid" aria-label="Suggested prompts">
            <span>Beijing this weekend</span>
            <span>Rain-safe afternoon in London</span>
            <span>What should I pack for Tokyo?</span>
          </div>
          <p className="status-line"><span /> Live weather assistant</p>
        </section>
        <section className="chat-panel">
          <CopilotChat
            agentId="weatherAgent"
            labels={{
              modalHeaderTitle: "Weather Copilot",
              welcomeMessageText: "Where are you headed?",
              chatInputPlaceholder: "Ask about a city, forecast, or plan...",
            }}
          />
        </section>
      </main>
    </CopilotKit>
  );
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);