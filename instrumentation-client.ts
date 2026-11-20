import { navigationStarted } from "./app/_components/speedClock";

/** A page change starts here; SpeedTracker reports it once the new page is on screen. */
export function onRouterTransitionStart() {
  navigationStarted();
}
