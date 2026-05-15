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
}

export interface CanvasPositions {
  [key: string]: { x: number; y: number };
}

export interface FormatConfig {
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
