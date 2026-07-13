const REQUIRED_SELECTORS = {
  overlay: "#overlay",
  startButton: "#start-button",
  coordinates: "#coordinates",
  status: "#status",
  speed: "#speed",
  routeInfo: "#route-info",
  locationForm: "#location-form",
  locationInput: "#location-input",
};

function queryRequired(root, selector, name) {
  const element = root.querySelector(selector);
  if (!element) {
    throw new Error(`Required UI element '${name}' was not found (${selector}).`);
  }
  return element;
}

function formatCoordinate(value) {
  return Number.isFinite(value) ? value.toFixed(6) : "--";
}

function formatAltitude(value) {
  return Number.isFinite(value) ? `${value.toFixed(1)} m` : "--";
}

function formatSpeed(value) {
  return Number.isFinite(value) ? `${value.toFixed(0)} km/h` : "0 km/h";
}

export class GameUi {
  constructor(root = document) {
    this.root = root;
    this.elements = Object.fromEntries(
      Object.entries(REQUIRED_SELECTORS).map(([name, selector]) => [
        name,
        queryRequired(root, selector, name),
      ]),
    );

    this.modeButtons = [...root.querySelectorAll("[data-mode]")];
    this.presetButtons = [...root.querySelectorAll("[data-lat][data-lon]")];
  }

  setStatus(message, type = "info") {
    const { status } = this.elements;
    status.textContent = message;
    status.dataset.type = type;
  }

  setOverlayVisible(visible) {
    this.elements.overlay.classList.toggle("hidden", !visible);
  }

  setPlaying(playing) {
    document.body.classList.toggle("is-playing", playing);
  }

  setActiveMode(mode) {
    for (const button of this.modeButtons) {
      const isActive = button.dataset.mode === mode;
      button.classList.toggle("active", isActive);
      button.setAttribute("aria-pressed", String(isActive));
    }
  }

  updateTelemetry(state) {
    this.elements.coordinates.textContent = [
      `緯度 ${formatCoordinate(state.latitude)}`,
      `経度 ${formatCoordinate(state.longitude)}`,
      `高度 ${formatAltitude(state.altitude)}`,
    ].join(" / ");

    this.elements.speed.textContent = `${state.modeLabel} / ${formatSpeed(state.speedKmh)}`;

    if (state.routeName) {
      const progress = Number.isFinite(state.routeProgress)
        ? ` / ${(state.routeProgress * 100).toFixed(1)}%`
        : "";
      this.elements.routeInfo.textContent = `${state.routeName}${progress}`;
      this.elements.routeInfo.hidden = false;
    } else {
      this.elements.routeInfo.hidden = true;
    }
  }

  clearLocationInput() {
    this.elements.locationInput.value = "";
  }

  getLocationQuery() {
    return this.elements.locationInput.value;
  }

  onStart(handler) {
    this.elements.startButton.addEventListener("click", handler);
  }

  onLocationSubmit(handler) {
    this.elements.locationForm.addEventListener("submit", (event) => {
      event.preventDefault();
      handler(this.getLocationQuery());
    });
  }

  onModeSelect(handler) {
    for (const button of this.modeButtons) {
      button.addEventListener("click", () => handler(button.dataset.mode));
    }
  }

  onPresetSelect(handler) {
    for (const button of this.presetButtons) {
      button.addEventListener("click", () => {
        handler({
          latitude: Number(button.dataset.lat),
          longitude: Number(button.dataset.lon),
          label: button.textContent.trim(),
        });
      });
    }
  }
}
