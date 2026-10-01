"use client";

import { useEffect, useRef } from "react";

/* The hero's date input, bounded to the window the product can actually search.
 *
 * /fares' own picker refuses past dates and anything beyond Amtrak's booking
 * horizon, and the landing page's input had neither bound — so the front door
 * would happily send 2020-01-01, which /fares rendered as "Wed, Jan 1" with no
 * year and then failed on after a round trip.
 *
 * The landing page is fully static, so there is no request-time clock to render
 * `min`/`max` from. They are set from the reader's own clock, in an effect
 * rather than an inline script: setting them before hydration changes
 * attributes on an element React is about to claim, and React reports the
 * mismatch rather than accepting it.
 */
const WINDOW_MAX_DAYS = 330; // Amtrak sells about eleven months ahead.

export function HeroDateField() {
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const input = ref.current;
    if (!input) return;
    const iso = (date: Date) =>
      `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    const today = new Date();
    input.min = iso(today);
    const horizon = new Date(today);
    horizon.setDate(horizon.getDate() + WINDOW_MAX_DAYS);
    input.max = iso(horizon);
  }, []);

  return (
    <label className="hero-field hero-field-date">
      <span className="micro">Date · today if blank</span>
      <input ref={ref} name="on" type="date" />
    </label>
  );
}
