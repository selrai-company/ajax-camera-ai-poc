/**
 * Folds the v1.1 contract additions into the base interfaces without editing types.ts.
 * types.ts documents that CameraEvent always gains `track` + `moments` and Brief gains
 * the BriefExtras fields; module augmentation makes TypeScript see them everywhere.
 */

declare module "./types" {
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  interface CameraEvent extends CameraEventAnnotations {}
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  interface Brief extends BriefExtras {}

  // Frontend addition (optional, not yet in the backend contract): number for the
  // "Call guard" tel: link on guarded sites. The UI hides the button when it's absent.
  interface Site {
    guard_phone?: string | null;
  }
}

export type * from "./types";
