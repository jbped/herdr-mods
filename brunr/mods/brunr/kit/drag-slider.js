// A slider that shows a value Spotify reports and lets the person drag it to a new one.
// The hard part is telling the two apart: while the person drags, a reading must not pull the knob back.
import { SliderState } from "gpui-base";

/** @typedef {import("gpui-kit").Context} Context */

export class DragSlider {
  /**
   * @param {number} max the value at the right end. The left end is 0.
   * @param {(value: number, cx: Context) => void} onRelease runs once, when the person lets go
   */
  constructor(max, onRelease) {
    /** Herdr's own slider state. Views hand it to the Slider parts. */
    this.state = SliderState.new({ min: 0, max, step: 1, value: 0 });
    /** @type {number} the value this code last put on the slider */
    this.shown = 0;
    /** @type {boolean} true from the first drag movement until release */
    this.dragging = false;
    // A change to a value this code did not set came from the person.
    this.state.on("change", (value) => { if (value !== this.shown) this.dragging = true; });
    this.state.on("release", (value, cx) => {
      this.dragging = false;
      this.shown = Number(value);
      onRelease(this.shown, cx);
    });
  }

  /** Moves the knob to a reported value. Ignored mid-drag. @param {number} value */
  show(value) {
    if (this.dragging) return;
    this.shown = Math.round(value);
    this.state.set_value(this.shown);
  }
}
