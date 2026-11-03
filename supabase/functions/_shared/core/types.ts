export type Vec3 = { x: number; y: number; z: number };

export type Star = Vec3 & {
  id: string;
  localRadius: number;
  regionId: number;
  brightness: number;
};

export type PublicDock = {
  id: string;
  songId: string;
  isSample: boolean;
  shipColour: string;
  updatedAt: string;
};

export type Encounter = {
  songId: string;
  dock: PublicDock;
  othersCount: number;
  distance: number;
};
