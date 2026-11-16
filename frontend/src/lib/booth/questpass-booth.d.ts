/**
 * Types for the vendored QuestPass Booth custom elements (v1.3.0). Only what we use.
 * The booth's own types are not vendored (dist/types is skipped on purpose).
 */
import type { DetailedHTMLProps, HTMLAttributes } from 'react';

export interface BoothPerson {
  name?: string;
  handle?: string;
  network?: 'telegram' | 'x' | 'instagram';
  avatar?: Blob | string;
}

export interface BoothPhotoDetail {
  blob: Blob;
  frame: string;
  ratio: string;
  name: string;
}

export interface BoothElement extends HTMLElement {
  config: Record<string, any>;
  person: BoothPerson;
}

export interface EditorElement extends HTMLElement {
  config: Record<string, any>;
}

declare module 'react' {
  namespace JSX {
    interface IntrinsicElements {
      'questpass-booth': DetailedHTMLProps<HTMLAttributes<BoothElement>, BoothElement>;
      'questpass-booth-editor': DetailedHTMLProps<HTMLAttributes<EditorElement>, EditorElement>;
    }
  }
}
