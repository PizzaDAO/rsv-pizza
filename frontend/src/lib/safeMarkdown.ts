import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';
import type { PluggableList } from 'unified';

/**
 * forno-81402: remark-gfm's autolink-literal builds a lookbehind regex at call
 * time, which throws on iOS < 16.4 and blanked the whole page. Detect support
 * once and only include remarkGfm when it is safe.
 */
function supportsLookbehind(): boolean {
  try {
    new RegExp('(?<=a)b');
    return true;
  } catch {
    return false;
  }
}

export const markdownRemarkPlugins: PluggableList = supportsLookbehind()
  ? [remarkGfm, remarkBreaks]
  : [remarkBreaks];
