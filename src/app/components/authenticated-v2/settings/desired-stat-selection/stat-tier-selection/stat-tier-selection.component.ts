/*
 * Copyright (c) 2023 D2ArmorPicker by Mijago.
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
 */

import {
  Component,
  EventEmitter,
  Input,
  OnChanges,
  OnInit,
  OnDestroy,
  Output,
  ViewChild,
  ElementRef,
  AfterViewChecked,
  AfterViewInit,
} from "@angular/core";
import { ArmorStat } from "../../../../../data/enum/armor-stat";

@Component({
  selector: "app-stat-tier-selection",
  templateUrl: "./stat-tier-selection.component.html",
  styleUrls: ["./stat-tier-selection.component.scss"],
})
export class StatTierSelectionComponent
  implements OnInit, OnChanges, OnDestroy, AfterViewChecked, AfterViewInit
{
  readonly TierRange = new Array(11);
  @Input() stat: ArmorStat = ArmorStat.StatWeapon;
  @Input() statsByMods: number = 0;
  @Input() maximumAvailableTier: number = 20;
  @Input() selectedTier: number = 0;
  @Input() locked: boolean = false;
  @Output() selectedTierChange = new EventEmitter<number>();
  @Output() lockedChange = new EventEmitter<boolean>();

  @ViewChild("valueInput") valueInput!: ElementRef<HTMLInputElement>;
  @ViewChild("valueSlider") valueSlider!: ElementRef<HTMLInputElement>;

  selectedValue: number = 0;
  public hoveredValue: number | null = null;
  public statValues: number[] = [];
  public editingValue: boolean = false;
  private shouldSelectText: boolean = false;

  public currentAnimatedMaxValue: number = 0;
  private animationTimeouts: Set<number> = new Set();

  constructor() {}

  ngOnInit(): void {
    // Generate values from 0 to 200
    this.statValues = Array.from({ length: 201 }, (_, i) => i);
    this.currentAnimatedMaxValue = this.maximumAvailableTier * 10;
  }

  ngOnChanges() {
    this.selectedValue = this.selectedTier * 10;
    this.animateMaxTierChange();
  }

  ngOnDestroy(): void {
    this.clearAnimationTimeouts();
  }

  ngAfterViewChecked() {
    if (this.editingValue && this.valueInput) {
      this.valueInput.nativeElement.focus();
      const inputElem = this.valueInput.nativeElement;

      if (this.shouldSelectText) {
        inputElem.select();
        this.shouldSelectText = false;
      } else {
        const valueLength = inputElem.value.length;
        inputElem.setSelectionRange(valueLength, valueLength);
      }
    }
  }

  ngAfterViewInit() {
    const slider = this.valueSlider.nativeElement;
    const DRAG_THRESHOLD = this.DRAG_THRESHOLD;

    const onMouseDown = (e: MouseEvent | TouchEvent) => {
      this.dragging = false;
      this.startX = e instanceof MouseEvent ? e.clientX : (e as TouchEvent).touches[0].clientX;

      document.addEventListener("mousemove", onMouseMove);
      document.addEventListener("touchmove", onMouseMove);

      document.addEventListener("mouseup", onMouseUp, { once: true });
      document.addEventListener("touchend", onMouseUp, { once: true });
    };

    const onMouseMove = (e: MouseEvent | TouchEvent) => {
      const clientX = e instanceof MouseEvent ? e.clientX : (e as TouchEvent).touches[0].clientX;
      if (!this.dragging && Math.abs(clientX - this.startX) > DRAG_THRESHOLD) {
        this.dragging = true;
      }
      this.setValueFromSlider();
    };

    const onMouseUp = (e: MouseEvent | TouchEvent) => {
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("touchmove", onMouseMove);
    };

    slider.addEventListener("mousedown", onMouseDown);
    slider.addEventListener("touchstart", onMouseDown);

    slider.addEventListener("click", (e: MouseEvent) => {
      if (this.dragging) {
        // Dragged!
        console.log("Slider dragged, not clicking.");
        this.selectedTierChange.emit(this.selectedTier);
      } else {
        // Clicked!
        console.log("Slider clicked, snapping to nearest tier.");
        const snapped = Math.round(parseInt(slider.value) / 10) * 10;
        if (snapped !== +slider.value && +slider.value < this.maximumAvailableTier * 10) {
          slider.value = snapped.toString();
          this.setValueFromSlider();
        }
        this.selectedTierChange.emit(this.selectedTier);
      }
    });
  }

  dragging = false;
  startX = 0;
  DRAG_THRESHOLD = 5; // pixels
  lastVal = +this.selectedValue;
  lastTime = performance.now();
  FAST_DELTA = 5; // this many units of change …
  FAST_WINDOW = 200; // …within this many ms = “fast”

  setValueFromSlider() {
    const inputElem = this.valueSlider.nativeElement;
    let newValue = parseInt(inputElem.value);
    let newTierValue = newValue / 10;

    if (this.locked) {
      inputElem.value = this.selectedValue.toString(); // Reset to last valid value
      return;
    }

    if (+this.valueSlider.nativeElement.value == this.selectedValue) return;

    if (newValue <= this.maximumAvailableTier * 10) {
      const now = performance.now();
      const dt = now - this.lastTime;
      const dv = Math.abs(newValue - this.lastVal);

      /* Is the motion fast? (big jump in a short time) */
      const fast = dv >= this.FAST_DELTA && dt <= this.FAST_WINDOW;

      //this.valueSlider.nativeElement.step = (fast ? 5 : 1).toString();

      if (fast) {
        const snapped = Math.round(parseInt(this.valueSlider.nativeElement.value) / 5) * 5;
        if (snapped !== +this.valueSlider.nativeElement.value) newValue = snapped;
      }

      this.lastTime = now;
      this.lastVal = +this.valueSlider.nativeElement.value;
    } else {
      newTierValue = this.maximumAvailableTier;
      inputElem.value = newTierValue.toString(); // Reset to last valid value
    }
    this.selectedTier = newTierValue;
    this.selectedValue = this.selectedTier * 10;
    this.valueSlider.nativeElement.value = this.selectedValue.toString();
  }

  setValue(newValue: number) {
    if (newValue <= this.maximumAvailableTier) {
      console.log("Setting value to: " + newValue);
      this.selectedTier = newValue;
      this.selectedTierChange.emit(newValue);
    }
  }

  setValueMob(inputEvent: any) {
    let newValue = parseInt(inputEvent);
    newValue = Math.min(Math.max(newValue, 0), 200);
    this.setValue(newValue / 10);
  }

  isAddedByConfigMods(index: number) {
    return (
      index > 0 &&
      ((this.selectedTier - index >= 0 && this.selectedTier - index < this.statsByMods) || // on the right
        // ( index <= this.statsByMods) // on the left
        (this.selectedTier < this.statsByMods && index <= this.statsByMods))
    );
  }

  toggleLockState() {
    this.locked = !this.locked;
    this.lockedChange.emit(this.locked);
  }

  /**
   * Optimized hover handling for immediate response
   */
  handleHover(value: number): void {
    if (value <= this.maximumAvailableTier * 10) {
      // Use requestAnimationFrame for smoother UI updates
      requestAnimationFrame(() => {
        this.hoveredValue = value;
      });
    }
  }

  /**
   * Clear hover state immediately
   */
  clearHover(): void {
    this.hoveredValue = null;
  }

  commitValueEdit(value: string | number) {
    let num = Number(value);
    if (isNaN(num)) {
      num = this.selectedValue;
    }
    num = Math.round(num);
    num = Math.max(0, Math.min(num, this.maximumAvailableTier * 10));
    this.selectedValue = num;
    this.selectedTier = num / 10;
    this.selectedTierChange.emit(this.selectedTier);
    this.editingValue = false;
    this.shouldSelectText = false;
  }

  cancelValueEdit() {
    this.editingValue = false;
    this.shouldSelectText = false;
  }

  startValueEdit() {
    this.editingValue = true;
    this.shouldSelectText = true;
  }

  /**
   * Check if this is the sixth stat (weapon stat)
   */
  isSixthStat(): boolean {
    return this.stat === ArmorStat.StatMelee;
  }

  /**
   * Get the position percentage for the selected value label
   */
  getSelectedValuePosition(): number {
    // Calculate percentage position based on selectedValue (0-200 range)
    return (this.selectedValue / 200) * 100;
  }

  /**
   * Animate the maximum tier change with cascading effect
   */
  private animateMaxTierChange(): void {
    // Clear any existing animation timeouts
    this.clearAnimationTimeouts();

    const targetMaxValue = this.maximumAvailableTier * 10;
    const startValue = this.currentAnimatedMaxValue;

    if (startValue === targetMaxValue) {
      return; // No change needed
    }

    // Skip animation if going from 0 to initial value (e.g., 0->200)
    if (startValue === 0) {
      this.currentAnimatedMaxValue = targetMaxValue;
      return;
    }

    const direction = targetMaxValue > startValue ? 1 : -1;
    const steps = Math.abs(targetMaxValue - startValue);

    // Animation delay between each step (in milliseconds)
    const stepDelay = 10; // Fast animation

    for (let i = 1; i <= steps; i++) {
      const timeout = window.setTimeout(() => {
        this.currentAnimatedMaxValue = startValue + direction * i;

        // Force change detection to update the UI
        // This will trigger the CSS class updates through the template bindings
      }, stepDelay * i);

      this.animationTimeouts.add(timeout);
    }
  }

  /**
   * Clear all pending animation timeouts
   */
  private clearAnimationTimeouts(): void {
    this.animationTimeouts.forEach((timeout) => window.clearTimeout(timeout));
    this.animationTimeouts.clear();
  }

  /**
   * Check if a stat value is currently animating (for smooth transitions)
   */
  isStatValueAnimating(value: number): boolean {
    const currentMax = this.currentAnimatedMaxValue;
    const targetMax = this.maximumAvailableTier * 10;

    if (currentMax === targetMax) {
      return false;
    }

    // Value is in the range being animated
    const minRange = Math.min(currentMax, targetMax);
    const maxRange = Math.max(currentMax, targetMax);

    return value > minRange && value <= maxRange;
  }
}
