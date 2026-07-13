const BLOCKED_BROWSER_KEYS = new Set([
  "Space",
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
]);

function isEditableTarget(target) {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    target?.isContentEditable === true
  );
}

export class InputState {
  constructor(pointerElement) {
    this.pointerElement = pointerElement;
    this.keys = new Set();
    this.lookDeltaX = 0;
    this.lookDeltaY = 0;
    this.listeners = new AbortController();

    this.#bindEvents(this.listeners.signal);
  }

  #bindEvents(signal) {
    window.addEventListener(
      "keydown",
      (event) => {
        if (isEditableTarget(event.target)) return;

        if (
          document.pointerLockElement === this.pointerElement &&
          BLOCKED_BROWSER_KEYS.has(event.code)
        ) {
          event.preventDefault();
        }

        this.keys.add(event.code);
      },
      { passive: false, signal },
    );

    window.addEventListener(
      "keyup",
      (event) => {
        this.keys.delete(event.code);
      },
      { signal },
    );

    window.addEventListener("blur", () => this.clear(), { signal });

    document.addEventListener(
      "pointerlockchange",
      () => {
        if (document.pointerLockElement !== this.pointerElement) {
          this.clear();
        }
      },
      { signal },
    );

    document.addEventListener(
      "mousemove",
      (event) => {
        if (document.pointerLockElement !== this.pointerElement) return;

        this.lookDeltaX += event.movementX;
        this.lookDeltaY += event.movementY;
      },
      { signal },
    );
  }

  isPressed(...codes) {
    return codes.some((code) => this.keys.has(code));
  }

  consumeLookDelta() {
    const delta = {
      x: this.lookDeltaX,
      y: this.lookDeltaY,
    };

    this.lookDeltaX = 0;
    this.lookDeltaY = 0;
    return delta;
  }

  clear() {
    this.keys.clear();
    this.lookDeltaX = 0;
    this.lookDeltaY = 0;
  }

  dispose() {
    this.listeners.abort();
    this.clear();
  }
}
