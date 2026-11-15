export interface TextFieldConfig {
  key: string;
  label: string;
  defaultX: number;
  defaultY: number;
  boxWidth: number;
  boxHeight: number;
  color: string;
  fontFamily: string;
  maxFontSize: number;
  minFontSize?: number;
  hidden?: boolean;
  /** Time field only: color of the date part (defaults to the GPP red). */
  dateColor?: string;
}

export interface CanvasPositions {
  [key: string]: { x: number; y: number };
}

/** Slot for one doge-speak phrase (canvas px, top-left anchored). See dogeSpeak.ts. */
export interface DogeSpeakSlot {
  x: number;
  y: number;
  fontSize: number;
  maxWidth: number;
}

export interface FormatConfig {
  /** Doge templates only: draw Much-Wow style doge-speak phrases at these slots. */
  dogeSpeak?: { slots: DogeSpeakSlot[] };
  id: string;
  label: string;
  templatePath: string;
  fullResUrl: string;
  canvasWidth: number;
  canvasHeight: number;
  fullResWidth: number;
  fullResHeight: number;
  previewMaxWidth: number;
  previewMaxHeight?: number;
  textFields: TextFieldConfig[];
  sponsorBox: {
    defaultX: number;
    defaultY: number;
    width: number;
    height: number;
    /** Preferred number of rows for the sponsor grid auto-sizing. Default 2.
     *  Drives both autoLogoSize and the flex-wrap target (wider logos = fewer
     *  per row). */
    defaultRows?: number;
    /** Multiplier applied to the auto-computed logo size. >1 makes logos
     *  larger (and likely wraps to more rows than the heuristic intended). */
    logoScale?: number;
  };
  dbImageField: string;
  dbTimestampField: string;
  storageKey: (partyId: string) => string;
  /** Color for hover outlines and drag handles. Default white. Use a dark
   *  shade for light-background templates where the default would vanish. */
  handleColor?: string;
}

export interface CanvasConfig {
  positions: CanvasPositions;
  poppedLogos: Record<string, { x: number; y: number }>;
  logoSizes: Record<string, number>;
  sponsorBoxSize: { width: number; height: number };
  editVenueName?: string | null;
  editStreetAddress?: string | null;
  editCity?: string | null;
  editTime?: string | null;
}
