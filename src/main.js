import "cesium/Build/Cesium/Widgets/widgets.css";
import "./style.css";
import { GameApp } from "./app.js";

const app = new GameApp();

app.start().catch((error) => {
  console.error("SuperGame failed to start.", error);

  const status = document.querySelector("#status");
  if (status) {
    status.textContent = `起動に失敗しました: ${error.message}`;
    status.dataset.type = "error";
  }
});

window.addEventListener("beforeunload", () => app.destroy(), { once: true });
