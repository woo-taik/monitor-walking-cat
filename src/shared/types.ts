export type Pose = 'sitting' | 'walking' | 'sleeping' | 'held' | 'stretching' | 'grooming' | 'petted' | 'pawing';
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
  version: 3;
  displayId: string;
  displayLabel: string;
  relativeX: number;
  relativeY: number;
  size: number;
  roaming: boolean;
  floorOnly: boolean;
  clickThrough: boolean;
  allWorkspaces: boolean;
  keepAwake: boolean;
  presets: PositionPreset[];
}
export interface PositionPreset {
  id: string;
  name: string;
  displayId: string;
  displayLabel: string;
  relativeX: number;
  relativeY: number;
}
export type Anchor = 'bottom-left' | 'bottom-center' | 'bottom-right';
export interface PreferencesSnapshot {
  size: number;
  roaming: boolean;
  floorOnly: boolean;
  clickThrough: boolean;
  allWorkspaces: boolean;
  keepAwake: boolean;
  hidden: boolean;
  paused: boolean;
  platform: string;
  displayId: string;
  displays: { id: string; name: string }[];
  presets: PositionPreset[];
}
export type PreferencesCommand =
  | { kind: 'size'; value: number }
  | { kind: 'roaming' | 'floor-only' | 'click-through' | 'all-workspaces' | 'keep-awake' | 'hidden' | 'paused'; value: boolean }
  | { kind: 'display'; id: string }
  | { kind: 'anchor'; anchor: Anchor; displayId: string }
  | { kind: 'save-position'; name: string }
  | { kind: 'load-position' | 'delete-position'; id: string };
export interface PreferencesAPI {
  read(): Promise<PreferencesSnapshot>;
  change(command: PreferencesCommand): Promise<{ snapshot: PreferencesSnapshot; notice?: string }>;
  onChange(callback: (snapshot: PreferencesSnapshot) => void): () => void;
}
export interface PetAPI {
  onState(callback: (state: PetState) => void): () => void;
  onCursor(callback: (point: Point) => void): () => void;
  onResetInput(callback: () => void): () => void;
  ready(): void;
  hover(overCat: boolean): void;
  press(): void;
  pet(): void;
  beginDrag(): void;
  endDrag(): void;
  openMenu(point: Point): void;
}
