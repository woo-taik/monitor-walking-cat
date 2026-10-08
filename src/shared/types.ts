export type Pose = 'sitting' | 'walking' | 'sleeping' | 'held' | 'stretching' | 'grooming' | 'petted';
export interface Point { x: number; y: number }
export interface Bounds extends Point { width: number; height: number }
export interface PetState {
  pose: Pose;
  facingRight: boolean;
  time: number;
  size: number;
  clickThrough: boolean;
  frozen: boolean;
  poseTime: number;
  gaitTime: number;
  speed: number;
}
export interface Settings {
  version: 2;
  displayId: string;
  displayLabel: string;
  relativeX: number;
  relativeY: number;
  size: number;
  roaming: boolean;
  floorOnly: boolean;
  clickThrough: boolean;
  allWorkspaces: boolean;
}
export interface PetAPI {
  onState(callback: (state: PetState) => void): () => void;
  onCursor(callback: (point: Point) => void): () => void;
  ready(): void;
  hover(overCat: boolean): void;
  press(): void;
  pet(): void;
  beginDrag(): void;
  endDrag(): void;
  openMenu(point: Point): void;
}
